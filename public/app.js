// --- Outils ------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ico = (nom) => `<svg class="ico" aria-hidden="true"><use href="#i-${nom}"/></svg>`;

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    body: options.body && JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/connexion')) location.hash = '#connexion';
  if (!res.ok) throw new Error(data.erreur || 'Erreur serveur');
  return data;
}

// Petit message en bas de l'écran, avec un bouton facultatif (ex. « Annuler »).
let minuteurToast;
function toast(texte, action) {
  const el = $('#toast');
  el.textContent = texte;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.libelle;
    b.addEventListener('click', () => { el.classList.remove('visible'); action.faire(); });
    el.append(b);
  }
  el.classList.add('visible');
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => el.classList.remove('visible'), action ? 7000 : 3500);
}

// 95 min → "1 h 35" ; 30 → "30 min"
function duree(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${h} h`;
}

// "2026-11-13" → "ven. 13 nov." (avec « demain », « dans 3 j »… pour les échéances proches)
function echeance(iso) {
  const jours = Math.round((Date.parse(iso.slice(0, 10) + 'T12:00:00') - Date.now()) / 864e5);
  const date = new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  if (jours < 0) return { texte: `En retard · ${date}`, classe: 'retard' };
  if (jours <= 1) return { texte: jours === 0 ? 'Aujourd’hui' : 'Demain', classe: 'proche' };
  if (jours <= 7) return { texte: `${date} · dans ${jours} j`, classe: 'proche' };
  return { texte: date, classe: '' };
}
const puceEcheance = (iso) => {
  if (!iso) return '';
  const e = echeance(iso);
  return `<span class="puce ${e.classe}">${ico('calendar')}${esc(e.texte)}</span>`;
};

// Logo du projet (ou initiale sur sa couleur si le logo manque).
function pastille(p, taille = '') {
  const initiale = esc((p?.icone || p?.nom || '•').trim().slice(0, 2).toUpperCase());
  if (!p) return `<span class="pastille ${taille}" style="--c:var(--accent)">•</span>`;
  const logo = p.logo ? `<img src="/api/logo/${esc(p.id)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="pastille ${taille}" style="--c:${esc(p.hex)}"><b>${initiale}</b>${logo}</span>`;
}

const barre = (valeur, max) => {
  const pc = max > 0 ? Math.min(100, (valeur / max) * 100) : 0;
  return `<div class="barre" role="progressbar" aria-valuemin="0" aria-valuemax="${Math.round(max)}" aria-valuenow="${Math.round(valeur)}"><div style="width:${pc}%"></div></div>`;
};

// « Cette semaine » : une ligne par projet avec sa barre vers l'objectif hebdo (ou juste le temps, sans objectif).
const carteSemaine = (liste) => (liste?.length ? `
  <section class="carte semaine">
    <h3>Cette semaine</h3>
    ${liste.slice(0, 5).map((p) => `
      <div class="semaine-ligne" style="--c:${esc(p.hex)}">
        ${pastille(p, 'petite')}
        <div class="semaine-corps">
          <div class="semaine-tete"><span class="semaine-nom">${esc(p.nom)}</span><span class="semaine-temps">${duree(p.minutes)}${p.objectif ? ` / ${duree(p.objectif)}` : ''}</span></div>
          ${p.objectif ? barre(p.minutes, p.objectif) : ''}
        </div>
      </div>`).join('')}
  </section>` : '');

const ligneTotaux = (t) => `Aujourd’hui ${duree(t.jour)} · Cette semaine ${duree(t.semaine)}`;

// --- Choix refusés avec « Autre chose » (gardés jusqu'à minuit) ------------------------------
const jourLocal = () => new Date().toLocaleDateString('sv-SE');
function exclus() {
  try {
    const e = JSON.parse(localStorage.getItem('bosse-exclus') || '{}');
    return e.jour === jourLocal() ? e.ids : [];
  } catch {
    return [];
  }
}
function memoriserExclus(ids) {
  try {
    localStorage.setItem('bosse-exclus', JSON.stringify({ jour: jourLocal(), ids }));
  } catch {}
}

// --- Son et écran allumé pendant le chrono -------------------------------------------------------
// Le son n'est autorisé par le navigateur qu'après un appui : on le prépare quand tu lances le chrono.
let audio = null;
function preparerSon() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch {}
}
function sonnerFin() {
  try { navigator.vibrate?.([300, 150, 300, 150, 600]); } catch {}
  try {
    if (!audio) return;
    [0, 0.35, 0.7].forEach((retard) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audio.currentTime + retard);
      g.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + retard + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + retard + 0.28);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + retard);
      o.stop(audio.currentTime + retard + 0.3);
    });
  } catch {}
}
let veille = null;
async function garderEcranAllume() {
  try { veille = await navigator.wakeLock?.request('screen'); } catch {}
}
function relacherEcran() {
  try { veille?.release(); } catch {}
  veille = null;
}

// --- Radio (musique pendant le chrono) ------------------------------------------------------------------
const musiqueActive = () => {
  try { return localStorage.getItem('bosse-musique') !== 'non'; } catch { return true; }
};
function majMusique(e) {
  $('#musique-titre').textContent = e.titre || 'Musique';
  $('#m-lecture').innerHTML = ico(e.joue ? 'pause' : 'play');
  $('#m-son').innerHTML = ico(e.coupe ? 'mute' : 'volume');
  $('#m-son').setAttribute('aria-label', e.coupe ? 'Remettre le son' : 'Couper le son');
  const note = $('#musique-note');
  note.textContent = e.erreur || (e.bloque ? 'Le navigateur bloque le démarrage automatique : touche ▶ pour lancer la musique.' : e.actif && !e.titre ? 'Chargement de la musique…' : '');
  note.hidden = !note.textContent;
}
Radio.surChangement(majMusique);
$('#m-lecture').addEventListener('click', () => (Radio.etat.joue ? Radio.pause() : Radio.etat.actif ? Radio.reprendre() : Radio.demarrer()));
$('#m-suivante').addEventListener('click', () => Radio.suivante());
$('#m-son').addEventListener('click', () => Radio.basculerSon());

// --- Lancer un chrono (depuis « Maintenant » ou une tâche) ------------------------------------------
async function lancerChrono(id, origine) {
  preparerSon();
  try {
    await api('/api/chrono/demarrer', { method: 'POST', body: { id, origine } });
    location.hash = '#chrono';
  } catch (err) {
    toast(err.message);
    if (/déjà lancé/.test(err.message)) location.hash = '#chrono';
  }
}

// --- Écran « Maintenant » ----------------------------------------------------------------------
// La carte d'une action : projet (logo, couleur), titre, raison du choix, prochaine étape, durée, échéance, priorité.
function carteAction(a) {
  const projet = a.projet;
  const etape = a.type === 'tache' && projet?.prochaineEtape ? `<p class="etape"><b>Prochaine étape du projet</b>${esc(projet.prochaineEtape)}</p>` : '';
  return `
    <article class="action" style="--c:${esc(projet ? projet.hex : '#8b93ff')}">
      <header class="action-tete">
        ${pastille(projet, 'grande')}
        <div><span class="projet-nom">${esc(projet ? projet.nom : 'Hors projet')}</span>
        ${projet?.categorie ? `<span class="categorie">${esc(projet.categorie)}</span>` : ''}</div>
      </header>
      <h1 class="action-titre">${esc(a.titre)}</h1>
      ${a.raison ? `<p class="raison">${esc(a.raison)}</p>` : ''}
      ${etape}
      <div class="action-pied">
        <span class="puce">${ico('timer')}${duree(a.duree)}</span>
        ${puceEcheance(a.echeance)}
        ${a.priorite ? `<span class="puce prio-${esc(a.priorite)}">Priorité ${esc(a.priorite.toLowerCase())}</span>` : ''}
      </div>
    </article>`;
}

async function chargerMaintenant() {
  const zone = $('#maintenant-contenu');
  const refus = exclus();
  const d = await api('/api/maintenant' + (refus.length ? `?exclus=${encodeURIComponent(refus.join(','))}` : ''));
  const a = d.action;
  if (!a) {
    zone.innerHTML = `<div class="vide"><h1>Rien à faire</h1><p>Aucune tâche ni projet en cours. Ajoute une tâche (onglet Tâches), puis reviens ici.</p></div>`;
    return;
  }
  zone.innerHTML = `
    <p class="sur-titre">L’action du moment</p>
    ${carteAction(a)}
    <button class="btn-principal" type="button" id="lancer">${ico('timer')}Lancer le chrono · ${duree(a.duree)}</button>
    <button class="btn-lien" type="button" id="autre">${ico('skip')}Autre chose</button>
    ${d.toutVu ? '<p class="note">Tu as fait le tour des choix : retour au premier.</p>' : ''}
    <p class="note">${esc(ligneTotaux(d.totaux))}</p>
    ${carteSemaine(d.projetsSemaine)}
    <p class="note discret">${d.total} choix possible${d.total > 1 ? 's' : ''} · score ${a.score}/100</p>`;
  $('#lancer').addEventListener('click', () => lancerChrono(a.id));
  $('#autre').addEventListener('click', () => {
    memoriserExclus(d.toutVu ? [] : [...new Set([...refus, a.id])]);
    chargerMaintenant().catch((e) => toast(e.message));
  });
}

// --- Écran « Chrono » (compte à rebours) -------------------------------------------------------------
let tic = null; // minuteur d'affichage
const RAYON = 90;
const CIRCONFERENCE = 2 * Math.PI * RAYON;
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};

function arreterChrono() {
  clearInterval(tic);
  tic = null;
  relacherEcran();
  document.title = 'BOSSE !';
}

async function chargerChrono() {
  const { chrono: c0 } = await api('/api/chrono');
  if (!c0) return void (location.hash = '#maintenant');
  if (c0.etat === 'fini') return void (location.hash = '#bilan');
  let c = c0;
  let t0 = performance.now();
  let sonne = false;
  const projet = c.candidat.projet;
  $('#chrono-contenu').innerHTML = `
    <article class="chrono" style="--c:${esc(projet ? projet.hex : '#8b93ff')}">
      <header class="action-tete">${pastille(projet)}<span class="projet-nom">${esc(projet ? projet.nom : 'Hors projet')}</span></header>
      <h1 class="chrono-titre">${esc(c.candidat.titre)}</h1>
      <div class="anneau">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle class="anneau-fond" cx="100" cy="100" r="${RAYON}"/>
          <circle class="anneau-progres" id="progres" cx="100" cy="100" r="${RAYON}" stroke-dasharray="${CIRCONFERENCE}" stroke-dashoffset="${CIRCONFERENCE}" transform="rotate(-90 100 100)"/>
        </svg>
        <div class="anneau-centre"><div class="temps" id="temps" role="timer"></div><div class="sous-temps" id="sous-temps"></div></div>
      </div>
      <div class="chrono-actions">
        <button class="btn-lien" type="button" id="btn-pause"></button>
        <button class="btn-lien" type="button" id="btn-plus">${ico('plus')}10 min</button>
      </div>
      <button class="btn-principal" type="button" id="btn-terminer">${ico('check')}Terminer</button>
      <button class="btn-lien discret" type="button" id="btn-annuler">Annuler cette séance</button>
    </article>`;

  const maj = (nouveau) => { c = nouveau; t0 = performance.now(); sonne = sonne && c.dureePrevueMs - c.ecouleMs <= 0; };
  function dessiner() {
    const ecoule = c.ecouleMs + (c.etat === 'en cours' ? performance.now() - t0 : 0);
    const reste = c.dureePrevueMs - ecoule;
    $('#temps').textContent = reste > 0 ? mmss(reste) : `+${mmss(-reste)}`;
    $('#sous-temps').textContent = c.etat === 'pause' ? 'En pause' : reste > 0 ? 'restant' : 'temps écoulé';
    $('#temps').classList.toggle('depasse', reste <= 0);
    $('#progres').classList.toggle('en-pause', c.etat === 'pause');
    $('#progres').style.strokeDashoffset = CIRCONFERENCE * (1 - Math.min(1, ecoule / c.dureePrevueMs));
    $('#btn-pause').innerHTML = c.etat === 'pause' ? `${ico('play')}Reprendre` : `${ico('pause')}Pause`;
    document.title = `${reste > 0 ? mmss(reste) : '⏰'} · BOSSE !`;
    if (reste <= 0 && c.etat === 'en cours' && !sonne) {
      sonne = true;
      sonnerFin();
      toast('Temps écoulé ! Termine, ou ajoute 10 min.');
    }
  }
  const action = (chemin, corps) => api(chemin, { method: 'POST', body: corps }).then((r) => { maj(r.chrono); dessiner(); }).catch((e) => toast(e.message));
  $('#btn-pause').addEventListener('click', () => {
    const reprise = c.etat === 'pause';
    reprise ? Radio.reprendre() : Radio.pause();
    action(reprise ? '/api/chrono/reprendre' : '/api/chrono/pause');
  });
  $('#btn-plus').addEventListener('click', () => action('/api/chrono/ajouter', { minutes: 10 }));
  $('#btn-terminer').addEventListener('click', async () => {
    try {
      await api('/api/chrono/terminer', { method: 'POST' });
      Radio.arreter();
      location.hash = '#bilan';
    } catch (e) { toast(e.message); }
  });
  $('#btn-annuler').addEventListener('click', async () => {
    if (!confirm('Annuler cette séance ? Le temps ne sera pas enregistré.')) return;
    try {
      await api('/api/chrono', { method: 'DELETE' });
      Radio.arreter();
      location.hash = '#maintenant';
    } catch (e) { toast(e.message); }
  });
  dessiner();
  clearInterval(tic);
  tic = setInterval(dessiner, 250);
  garderEcranAllume();
  // La musique démarre avec le chrono (et reste en place si l'écran est redessiné).
  $('#musique').hidden = !musiqueActive();
  if (musiqueActive()) {
    majMusique(Radio.etat);
    if (!Radio.etat.actif) Radio.demarrer();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (location.hash === '#chrono') { chargerChrono().catch(() => {}); } // le temps a passé : on relit l'état du serveur
  }
});

// --- Écran « Bilan » -------------------------------------------------------------------------------------
async function chargerBilan() {
  const { chrono: c } = await api('/api/chrono');
  if (!c) return void (location.hash = '#maintenant');
  if (c.etat !== 'fini') return void (location.hash = '#chrono');
  const cand = c.candidat;
  const projet = cand.projet;
  const peutTerminer = !(cand.type === 'projet' && projet?.type === 'Activité'); // une activité ne se termine pas
  const caseTermine = cand.type === 'projet' ? 'Projet terminé' : 'Tâche terminée';
  $('#bilan-contenu').innerHTML = `
    <form id="form-bilan" class="carte bilan" style="--c:${esc(projet ? projet.hex : '#8b93ff')}">
      <header class="action-tete">${pastille(projet)}<div><span class="projet-nom">${esc(projet ? projet.nom : 'Hors projet')}</span><span class="categorie">${esc(cand.titre)}</span></div></header>
      <h2>Bilan de la séance</h2>
      <label for="b-duree">Temps travaillé (minutes)</label>
      <div class="pas">
        <button type="button" class="btn-lien" id="b-moins" aria-label="5 minutes de moins">−5</button>
        <input id="b-duree" type="number" inputmode="numeric" min="1" max="600" value="${c.minutes}" required>
        <button type="button" class="btn-lien" id="b-plus" aria-label="5 minutes de plus">+5</button>
      </div>
      <p class="aide" id="b-aide" hidden>Ça fait beaucoup : le chrono a peut-être tourné trop longtemps. Corrige la durée si besoin.</p>
      <label for="b-bilan">Où j’en suis</label>
      <textarea id="b-bilan" rows="3" maxlength="2000" placeholder="Ce qui est fait, ce qui bloque…"></textarea>
      ${projet ? `<label for="b-etape">Prochaine étape</label><input id="b-etape" type="text" maxlength="500" value="${esc(projet.prochaineEtape || '')}" placeholder="Par quoi continuer ?">` : ''}
      ${peutTerminer ? `<label class="case"><input id="b-termine" type="checkbox"> ${caseTermine}</label>` : ''}
      <button class="btn-principal" type="submit">${ico('check')}Enregistrer</button>
      <p class="message" role="alert"></p>
    </form>`;
  const champ = $('#b-duree');
  const aide = () => { $('#b-aide').hidden = !(Number(champ.value) > 180); };
  aide();
  champ.addEventListener('input', aide);
  $('#b-moins').addEventListener('click', () => { champ.value = Math.max(1, Number(champ.value || 0) - 5); aide(); });
  $('#b-plus').addEventListener('click', () => { champ.value = Math.min(600, Number(champ.value || 0) + 5); aide(); });
  $('#form-bilan').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const bouton = ev.submitter;
    bouton.disabled = true;
    try {
      const r = await api('/api/bilan', { method: 'POST', body: {
        duree: Number(champ.value), bilan: $('#b-bilan').value, prochaineEtape: $('#b-etape')?.value ?? '', termine: $('#b-termine')?.checked === true,
      } });
      memoriserExclus([]);
      $('#bilan-contenu').innerHTML = `
        <div class="termine ${r.message.objectifAtteint ? 'reussi' : ''}">
          <p class="sur-titre">Séance enregistrée</p>
          <p class="grand">${duree(r.duree)}</p>
          <h2 class="bravo">${esc(r.message.titre)}</h2>
          ${r.message.lignes.map((l) => `<p class="ligne-bravo">${esc(l)}</p>`).join('')}
          ${carteSemaine(r.projetsSemaine)}
          ${r.enAttente ? '<p class="note">Notion est injoignable : la séance est gardée sur le serveur et sera envoyée plus tard.</p>' : ''}
          <button class="btn-principal" type="button" id="suite">${ico('zap')}Action suivante</button>
        </div>`;
      $('#suite').addEventListener('click', () => { location.hash = '#maintenant'; });
    } catch (err) {
      $('#form-bilan .message').textContent = err.message;
      bouton.disabled = false;
    }
  });
}

// --- La feuille de modification --------------------------------------------------------------------------------------
// Une seule fenêtre sert à créer ou modifier n'importe quoi (projet, activité, tâche, séance, lien de musique) :
// feuille({ titre, champs, valeurs, enregistrer(valeurs), supprimer() }) ; champs : [{ nom, label, type, options, … }].
let feuilleCourante = null;
const champHtml = (c, valeur) => {
  const id = `f-${c.nom}`;
  const v = valeur ?? '';
  const aide = c.aide ? `<p class="aide-champ">${esc(c.aide)}</p>` : '';
  if (c.type === 'checkbox') return `<label class="case"><input id="${id}" type="checkbox"${valeur ? ' checked' : ''}> ${esc(c.label)}</label>${aide}`;
  const etiquette = `<label for="${id}">${esc(c.label)}</label>`;
  if (c.type === 'select') return `${etiquette}<select id="${id}">${c.options.map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(v) ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>${aide}`;
  if (c.type === 'textarea') return `${etiquette}<textarea id="${id}" rows="3" maxlength="${c.max || 2000}" placeholder="${esc(c.placeholder || '')}">${esc(v)}</textarea>${aide}`;
  const attrs = [c.min != null && `min="${c.min}"`, c.max != null && `max="${c.max}"`, c.step && `step="${c.step}"`, c.maxlength && `maxlength="${c.maxlength}"`, c.placeholder && `placeholder="${esc(c.placeholder)}"`, c.requis && 'required'].filter(Boolean).join(' ');
  return `${etiquette}<input id="${id}" type="${c.type}" value="${esc(v)}" ${attrs} autocomplete="off">${aide}`;
};
function lireChamps(champs) {
  const sortie = {};
  for (const c of champs) {
    const el = $(`#f-${c.nom}`);
    sortie[c.nom] = c.type === 'checkbox' ? el.checked : c.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim();
  }
  return sortie;
}
// Les champs qui ont changé (une valeur vide et « rien » sont la même chose).
const changements = (avant, apres) => Object.fromEntries(Object.entries(apres).filter(([k, v]) => (avant[k] ?? '') !== (v ?? '')));

function feuille({ titre, champs, valeurs = {}, libelle = 'Enregistrer', enregistrer, supprimer, confirmation }) {
  $('#feuille-titre').textContent = titre;
  $('#feuille-champs').innerHTML = champs.map((c) => champHtml(c, valeurs[c.nom])).join('');
  $('#feuille-message').textContent = '';
  $('#feuille-ok').textContent = libelle;
  $('#feuille-ok').disabled = false;
  $('#feuille-suppr').hidden = !supprimer;
  feuilleCourante = { champs, enregistrer, supprimer, confirmation };
  const dlg = $('#feuille');
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  $('#feuille-champs input, #feuille-champs select, #feuille-champs textarea')?.focus();
}
function fermerFeuille() {
  const dlg = $('#feuille');
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
  feuilleCourante = null;
}
$('#feuille-fermer').addEventListener('click', fermerFeuille);
$('#feuille').addEventListener('click', (ev) => { if (ev.target === $('#feuille')) fermerFeuille(); }); // un appui à côté ferme
$('#feuille').addEventListener('close', () => { feuilleCourante = null; });
$('#feuille-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!feuilleCourante) return;
  const manque = feuilleCourante.champs.find((c) => c.requis && !$(`#f-${c.nom}`).value.trim());
  if (manque) return void ($('#feuille-message').textContent = `${manque.label} : à remplir.`);
  $('#feuille-ok').disabled = true;
  try {
    await feuilleCourante.enregistrer(lireChamps(feuilleCourante.champs));
    fermerFeuille();
  } catch (err) {
    $('#feuille-message').textContent = err.message;
    $('#feuille-ok').disabled = false;
  }
});
$('#feuille-suppr').addEventListener('click', async () => {
  if (!feuilleCourante?.supprimer || !confirm(feuilleCourante.confirmation || 'Supprimer ? Cette action part à la corbeille de Notion (récupérable).')) return;
  try {
    await feuilleCourante.supprimer();
    fermerFeuille();
  } catch (err) {
    $('#feuille-message').textContent = err.message;
  }
});

let optionsLues = null;
const options = async () => (optionsLues ??= await api('/api/options'));
const choixListe = (valeurs, vide) => [...(vide ? [{ v: '', l: vide }] : []), ...valeurs.map((v) => ({ v, l: v }))];

// --- Écran « Projets » ---------------------------------------------------------------------------------
// Objectif de la semaine d'un projet, ou enveloppe de temps d'une activité : barre et temps restant.
function zoneObjectif(p) {
  const activite = p.type === 'Activité';
  if (!p.objectifHebdo) return `<div class="objectif"><span class="objectif-texte">Pas d’${activite ? 'enveloppe' : 'objectif'} cette semaine</span></div>`;
  const reste = p.objectifHebdo - p.tempsSemaine;
  return `<div class="objectif">${barre(p.tempsSemaine, p.objectifHebdo)}
    <span class="objectif-texte">${duree(p.tempsSemaine)} sur ${duree(p.objectifHebdo)} cette semaine${reste <= 0 ? ' · atteint' : ` · il reste ${duree(reste)}`}</span></div>`;
}

const STATUTS_FILTRES = [['En cours', 'En cours'], ['En pause', 'En pause'], ['Idée', 'Idées'], ['Terminé', 'Terminés'], ['tous', 'Tous']];
let filtreProjets = 'En cours';
let projetsParId = new Map();

const carteProjet = (p) => `
  <article class="carte projet" style="--c:${esc(p.hex)}">
    <header class="projet-tete">
      ${pastille(p)}
      <div class="projet-titre"><h3>${esc(p.nom)}</h3>${p.categorie ? `<span class="categorie">${esc(p.categorie)}</span>` : ''}</div>
      <button class="lien-notion" type="button" data-projet="${esc(p.id)}" aria-label="Modifier ${esc(p.nom)}">${ico('edit')}</button>
    </header>
    ${p.statut && p.statut !== 'En cours' ? `<span class="puce statut">${esc(p.statut)}</span>` : ''}
    ${p.prochaineEtape ? `<p class="etape-courte"><b>Prochaine étape</b> ${esc(p.prochaineEtape)}</p>` : ''}
    ${p.resume ? `<p class="resume">${esc(p.resume)}</p>` : ''}
    ${zoneObjectif(p)}
    <div class="puces">
      ${p.type === 'Activité' && !p.tachesOuvertes ? '' : `<span class="puce">${p.tachesOuvertes} tâche${p.tachesOuvertes > 1 ? 's' : ''} à faire</span>`}
      ${p.tempsCumule ? `<span class="puce">${ico('timer')}${duree(p.tempsCumule)} au total</span>` : ''}
      ${puceEcheance(p.echeance)}
      ${p.priorite ? `<span class="puce prio-${esc(p.priorite)}">Priorité ${esc(p.priorite.toLowerCase())}</span>` : ''}
    </div>
  </article>`;

async function chargerProjets() {
  const liste = await api('/api/projets?tous=1');
  projetsParId = new Map(liste.map((p) => [p.id, p]));
  const statut = (p) => p.statut || 'En cours';
  $('#filtres-projets').innerHTML = STATUTS_FILTRES.map(([cle, libelle]) => {
    const n = cle === 'tous' ? liste.length : liste.filter((p) => statut(p) === cle).length;
    return `<button type="button" class="filtre" data-filtre="${esc(cle)}" aria-pressed="${filtreProjets === cle}">${esc(libelle)} <span class="compte">${n}</span></button>`;
  }).join('');
  const visibles = filtreProjets === 'tous' ? liste : liste.filter((p) => statut(p) === filtreProjets);
  const projets = visibles.filter((p) => p.type !== 'Activité');
  const activites = visibles.filter((p) => p.type === 'Activité');
  $('#projets-contenu').innerHTML = visibles.length
    ? (projets.length ? `<h3 class="sous-titre premier">Projets</h3>${projets.map(carteProjet).join('')}` : '')
      + (activites.length ? `<h3 class="sous-titre${projets.length ? '' : ' premier'}">Activités <span class="sous-note">enveloppes de la semaine</span></h3>${activites.map(carteProjet).join('')}` : '')
    : `<div class="vide"><p>${filtreProjets === 'tous' ? 'Aucun projet.' : 'Aucun projet ou activité dans cette catégorie.'}</p></div>`;
}

// Créer ou modifier un projet ou une activité : tous les champs, dont le logo (un lien vers une image) et la couleur.
async function feuilleProjet(p, typeNeuf = 'Projet') {
  const o = await options();
  const creation = !p;
  const v = p || { type: typeNeuf, statut: 'En cours', couleur: typeNeuf === 'Activité' ? 'Turquoise' : 'Bleu' };
  const avant = creation ? {} : {
    nom: p.nom, type: p.type, statut: p.statut, categorie: p.categorie || null, priorite: p.priorite || null, echeance: p.echeance || null,
    prochaineEtape: p.prochaineEtape || '', objectifHebdo: p.objectifHebdo ?? null, couleur: p.couleur || null, icone: p.icone || '', logo: p.logoLien || null, resume: p.resume || '',
  };
  const categories = [...new Set([...o.categories, ...(v.categorie ? [v.categorie] : [])])];
  const activite = v.type === 'Activité';
  feuille({
    titre: creation ? (typeNeuf === 'Activité' ? 'Nouvelle activité' : 'Nouveau projet') : activite ? 'Modifier l’activité' : 'Modifier le projet',
    libelle: creation ? 'Créer' : 'Enregistrer',
    valeurs: { ...v, categorie: v.categorie || '', priorite: v.priorite || '', couleur: v.couleur || '', logo: v.logoLien || '' },
    champs: [
      { nom: 'nom', label: 'Nom', type: 'text', maxlength: 100, requis: true },
      { nom: 'type', label: 'Type', type: 'select', options: o.types.map((t) => ({ v: t, l: t === 'Activité' ? 'Activité (lire, réviser…)' : 'Projet' })) },
      { nom: 'statut', label: 'Statut', type: 'select', options: choixListe(o.statuts) },
      { nom: 'objectifHebdo', label: 'Objectif de la semaine, en minutes (enveloppe d’une activité)', type: 'number', min: 0, max: 3000, step: 15, placeholder: 'ex. 120', aide: '15 à 3000 minutes ; vide : pas d’objectif.' },
      { nom: 'prochaineEtape', label: 'Prochaine étape', type: 'text', maxlength: 500 },
      { nom: 'echeance', label: 'Échéance', type: 'date' },
      { nom: 'priorite', label: 'Priorité', type: 'select', options: choixListe(o.priorites, 'Aucune') },
      { nom: 'categorie', label: 'Catégorie', type: 'select', options: choixListe(categories, 'Aucune') },
      { nom: 'couleur', label: 'Couleur', type: 'select', options: choixListe(o.couleurs, 'Aucune') },
      { nom: 'icone', label: 'Initiales ou emoji (si pas de logo)', type: 'text', maxlength: 8, placeholder: 'ex. 42' },
      { nom: 'logo', label: 'Logo : lien vers une image', type: 'url', placeholder: 'https://…/logo.png', aide: p?.logo && !p.logoLien ? 'Un logo est déjà enregistré dans Notion : colle un lien pour le remplacer.' : 'Vide : pas de logo (ou celui qui est déjà dans Notion).' },
      { nom: 'resume', label: 'Résumé', type: 'textarea' },
    ],
    enregistrer: async (val) => {
      const charge = { ...val, categorie: val.categorie || null, priorite: val.priorite || null, echeance: val.echeance || null, couleur: val.couleur || null, logo: val.logo || null };
      if (creation) await api('/api/projets', { method: 'POST', body: charge });
      else {
        const diff = changements(avant, charge);
        if (!Object.keys(diff).length) return;
        await api(`/api/projets/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: diff });
      }
      toast(creation ? 'Ajouté' : 'Modifications enregistrées');
      await chargerProjets();
    },
    supprimer: creation ? null : async () => {
      await api(`/api/projets/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      toast('Supprimé (corbeille de Notion)');
      await chargerProjets();
    },
    confirmation: p && `Supprimer « ${p.nom} » ? Il part à la corbeille de Notion (récupérable) ; ses tâches et ses séances restent.`,
  });
}

$('#projets-contenu').addEventListener('click', (ev) => {
  const bouton = ev.target.closest('[data-projet]');
  if (bouton) feuilleProjet(projetsParId.get(bouton.dataset.projet)).catch((e) => toast(e.message));
});
$('#filtres-projets').addEventListener('click', (ev) => {
  const f = ev.target.closest('[data-filtre]');
  if (!f) return;
  filtreProjets = f.dataset.filtre;
  chargerProjets().catch((e) => toast(e.message));
});
$('#nouveau-projet').addEventListener('click', () => {
  // Un petit choix : projet ou activité (une activité a une enveloppe de temps, sans échéance ni fin)
  feuille({
    titre: 'Créer…', libelle: 'Continuer',
    champs: [{ nom: 'genre', label: 'Quoi ?', type: 'select', options: [{ v: 'Projet', l: 'Un projet (avec une fin : Gorgée, un examen…)' }, { v: 'Activité', l: 'Une activité (qui se répète : lire, réviser…)' }] }],
    enregistrer: async (val) => { setTimeout(() => feuilleProjet(null, val.genre).catch((e) => toast(e.message)), 50); },
  });
});

// --- Écran « Tâches » ------------------------------------------------------------------------------------------
let tachesParId = new Map();
let faitesVisibles = false;
async function chargerTaches() {
  const liste = await api('/api/taches');
  tachesParId = new Map(liste.map((t) => [t.id, t]));
  const groupes = new Map(); // clé → { projet, taches }
  for (const t of liste) {
    const cle = t.projet ? t.projet.id : 'aucun';
    if (!groupes.has(cle)) groupes.set(cle, { projet: t.projet, taches: [] });
    groupes.get(cle).taches.push(t);
  }
  const ordre = [...groupes.values()].sort((a, b) => (a.projet ? 1 : 0) - (b.projet ? 1 : 0) || (a.projet?.nom || '').localeCompare(b.projet?.nom || '', 'fr'));
  $('#taches-contenu').innerHTML = ordre.length ? ordre.map((g) => `
    <section class="groupe" style="--c:${esc(g.projet ? g.projet.hex : '#8b93ff')}">
      <h3 class="groupe-titre">${pastille(g.projet, 'petite')}${esc(g.projet ? g.projet.nom : 'Hors projet')}<span class="compte">${g.taches.length}</span></h3>
      <ul class="liste">${g.taches.map((t) => `
        <li class="ligne ${t.projetActif ? '' : 'en-sommeil'}">
          <button class="rond" type="button" data-fait="${esc(t.id)}" aria-label="Terminer : ${esc(t.titre)}">${ico('check')}</button>
          <button class="ligne-texte ligne-btn" type="button" data-editer="${esc(t.id)}" aria-label="Modifier : ${esc(t.titre)}"><span class="ligne-titre">${esc(t.titre)}</span>
            <span class="puces"><span class="puce">${duree(t.duree)}</span>${puceEcheance(t.echeance)}${t.priorite ? `<span class="puce prio-${esc(t.priorite)}">${esc(t.priorite)}</span>` : ''}${t.projetActif ? '' : '<span class="puce">projet en pause</span>'}${t.notes ? `<span class="puce">${ico('edit')}notes</span>` : ''}</span></button>
          ${t.projetActif ? `<button class="lancer" type="button" data-lancer="${esc(t.id)}" aria-label="Lancer le chrono : ${esc(t.titre)}">${ico('play')}</button>` : ''}
        </li>`).join('')}</ul>
    </section>`).join('') : '<div class="vide"><p>Aucune tâche à faire. Ajoute-en avec le bouton « Ajouter ».</p></div>';
  if (faitesVisibles) await chargerFaites();
}

// Les tâches terminées (les plus récentes d'abord) : on peut les rétablir, les corriger ou les supprimer.
async function chargerFaites() {
  const liste = await api('/api/taches?statut=faites');
  for (const t of liste) tachesParId.set(t.id, t);
  $('#taches-faites').innerHTML = liste.length ? `<h3 class="sous-titre">Terminées récemment</h3><ul class="liste">${liste.map((t) => `
    <li class="ligne fait" style="--c:${esc(t.projet ? t.projet.hex : '#8b93ff')}">
      <button class="rond rempli" type="button" data-retablir="${esc(t.id)}" aria-label="Rétablir : ${esc(t.titre)}">${ico('check')}</button>
      <button class="ligne-texte ligne-btn" type="button" data-editer="${esc(t.id)}" aria-label="Modifier : ${esc(t.titre)}"><span class="ligne-titre">${esc(t.titre)}</span>
        <span class="puces">${t.projet ? `<span class="puce">${esc(t.projet.nom)}</span>` : '<span class="puce">Hors projet</span>'}${t.tempsPasse ? `<span class="puce">${ico('timer')}${duree(t.tempsPasse)}</span>` : ''}</span></button>
    </li>`).join('')}</ul>` : '<div class="vide"><p>Aucune tâche terminée.</p></div>';
}
$('#voir-faites').addEventListener('click', async () => {
  faitesVisibles = !faitesVisibles;
  $('#voir-faites').textContent = faitesVisibles ? 'Masquer les tâches terminées' : 'Voir les tâches terminées';
  if (!faitesVisibles) return void ($('#taches-faites').innerHTML = '');
  try { await chargerFaites(); } catch (e) { toast(e.message); }
});
$('#taches-faites').addEventListener('click', async (ev) => {
  const edit = ev.target.closest('[data-editer]');
  const retablir = ev.target.closest('[data-retablir]');
  if (edit) return feuilleTache(tachesParId.get(edit.dataset.editer)).catch((e) => toast(e.message));
  if (!retablir) return;
  try {
    await api(`/api/taches/${encodeURIComponent(retablir.dataset.retablir)}`, { method: 'PATCH', body: { fait: false } });
    toast('Tâche rétablie');
    await chargerTaches();
  } catch (e) {
    toast(e.message);
  }
});

// Modifier une tâche : titre, projet, durée, priorité, échéance, notes, terminée ou non.
async function feuilleTache(t) {
  if (!t) return;
  const projets = await api('/api/projets?tous=1');
  const choixProjets = projets.filter((p) => p.statut === 'En cours' || p.id === t.projetId);
  const avant = { titre: t.titre, projetId: t.projetId || null, duree: t.duree, priorite: t.priorite || null, echeance: t.echeance || null, notes: t.notes || '', fait: t.statut === 'Fait' };
  feuille({
    titre: 'Modifier la tâche',
    valeurs: { ...t, projetId: t.projetId || '', priorite: t.priorite || '', fait: t.statut === 'Fait' },
    champs: [
      { nom: 'titre', label: 'Tâche', type: 'text', maxlength: 200, requis: true },
      { nom: 'projetId', label: 'Projet', type: 'select', options: [{ v: '', l: 'Hors projet (to-do simple)' }, ...choixProjets.map((p) => ({ v: p.id, l: p.nom }))] },
      { nom: 'duree', label: 'Durée estimée (min)', type: 'number', min: 5, max: 240, step: 5, requis: true },
      { nom: 'priorite', label: 'Priorité', type: 'select', options: choixListe(['Haute', 'Moyenne', 'Basse'], 'Aucune') },
      { nom: 'echeance', label: 'Échéance', type: 'date' },
      { nom: 'notes', label: 'Notes', type: 'textarea' },
      { nom: 'fait', label: 'Tâche terminée', type: 'checkbox' },
    ],
    enregistrer: async (val) => {
      const diff = changements(avant, { ...val, projetId: val.projetId || null, priorite: val.priorite || null, echeance: val.echeance || null });
      if (!Object.keys(diff).length) return;
      await api(`/api/taches/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: diff });
      toast('Tâche modifiée');
      await chargerTaches();
    },
    supprimer: async () => {
      await api(`/api/taches/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      toast('Tâche supprimée (corbeille de Notion)');
      await chargerTaches();
    },
    confirmation: `Supprimer la tâche « ${t.titre} » ? Elle part à la corbeille de Notion (récupérable).`,
  });
}

$('#taches-contenu').addEventListener('click', async (ev) => {
  const fait = ev.target.closest('[data-fait]');
  const lancer = ev.target.closest('[data-lancer]');
  const edit = ev.target.closest('[data-editer]');
  if (edit) return feuilleTache(tachesParId.get(edit.dataset.editer)).catch((e) => toast(e.message));
  if (lancer) return lancerChrono(lancer.dataset.lancer);
  if (!fait) return;
  const id = fait.dataset.fait;
  fait.disabled = true;
  try {
    await api(`/api/taches/${encodeURIComponent(id)}`, { method: 'PATCH', body: { fait: true } });
    toast('Tâche terminée', { libelle: 'Annuler', faire: async () => {
      try {
        await api(`/api/taches/${encodeURIComponent(id)}`, { method: 'PATCH', body: { fait: false } });
        chargerTaches();
      } catch (e) { toast(e.message); }
    } });
    chargerTaches();
  } catch (e) {
    toast(e.message);
    fait.disabled = false;
  }
});

$('#ajouter-tache').addEventListener('click', async () => {
  const form = $('#form-tache');
  form.hidden = !form.hidden;
  if (form.hidden) return;
  try {
    const projets = await api('/api/projets');
    $('#t-projet').innerHTML = `<option value="">Hors projet (to-do simple)</option>${projets.map((p) => `<option value="${esc(p.id)}">${esc(p.nom)}</option>`).join('')}`;
  } catch (e) { toast(e.message); }
  $('#t-titre').focus();
});

$('#form-tache').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#form-tache .message');
  msg.textContent = '';
  const bouton = ev.submitter;
  bouton.disabled = true;
  try {
    await api('/api/taches', { method: 'POST', body: {
      titre: $('#t-titre').value, projetId: $('#t-projet').value || null, duree: Number($('#t-duree').value) || 30,
      priorite: $('#t-priorite').value || null, echeance: $('#t-echeance').value || null,
    } });
    $('#form-tache').reset();
    $('#form-tache').hidden = true;
    toast('Tâche ajoutée');
    await chargerTaches();
  } catch (err) {
    msg.textContent = err.message;
  }
  bouton.disabled = false;
});

// --- Écran « Roue » ------------------------------------------------------------------------------------------------
// Une part par projet, large comme ses chances de sortir (un projet en retard sur son objectif a une plus grande part).
// Le tirage est fait par le serveur ; ici on dessine la roue et on la fait tourner jusqu'à la part tirée.
let rotationRoue = 0;
const sinceRoue = (deg, r) => {
  const rad = (deg * Math.PI) / 180;
  return [100 + r * Math.sin(rad), 100 - r * Math.cos(rad)];
};
const secteurs = (parts) => {
  let debut = 0;
  return parts.map((p) => {
    const angle = p.probabilite * 360;
    const s = { p, debut, fin: debut + angle, centre: debut + angle / 2 };
    debut += angle;
    return s;
  });
};
function dessinerRoue(parts) {
  const formes = secteurs(parts).map((s) => {
    const [x1, y1] = sinceRoue(s.debut, 96);
    const [x2, y2] = sinceRoue(s.fin, 96);
    const forme = s.fin - s.debut >= 359.9
      ? `<circle cx="100" cy="100" r="96" fill="${esc(s.p.hex)}"/>`
      : `<path d="M100 100 L${x1.toFixed(2)} ${y1.toFixed(2)} A96 96 0 ${s.fin - s.debut > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${esc(s.p.hex)}"/>`;
    const initiales = s.fin - s.debut >= 14 ? `<text class="roue-initiales" transform="rotate(${s.centre.toFixed(2)} 100 100)" x="100" y="34" text-anchor="middle">${esc((s.p.icone || s.p.nom).trim().slice(0, 2).toUpperCase())}</text>` : '';
    return forme + initiales;
  });
  $('#roue-g').innerHTML = formes.join('') + '<circle cx="100" cy="100" r="13" class="roue-moyeu"/>';
  $('#roue-legende').innerHTML = parts.map((p) => `
    <li style="--c:${esc(p.hex)}"><span class="point"></span><span class="legende-nom">${esc(p.nom)}</span>
      ${p.atteint ? '<span class="puce">objectif atteint</span>' : p.retard ? '<span class="puce proche">en retard</span>' : ''}
      <span class="legende-pc">${Math.round(p.probabilite * 100)} %</span></li>`).join('');
}

async function chargerRoue() {
  const { parts } = await api('/api/roue');
  $('#roue-resultat').innerHTML = '';
  if (!parts.length) {
    $('#roue-contenu').hidden = true;
    $('#roue-vide').hidden = false;
    return;
  }
  $('#roue-contenu').hidden = false;
  $('#roue-vide').hidden = true;
  dessinerRoue(parts);
}

async function tournerRoue() {
  const bouton = $('#tourner');
  bouton.disabled = true;
  $('#roue-resultat').innerHTML = '';
  try {
    const r = await api('/api/roue/tirer', { method: 'POST' });
    dessinerRoue(r.parts);
    const s = secteurs(r.parts)[r.index];
    // La part tirée doit s'arrêter sous le repère (en haut) : on vise un point au hasard à l'intérieur de la part.
    const decalage = (Math.random() - 0.5) * (s.fin - s.debut) * 0.7;
    const cible = Math.ceil(rotationRoue / 360) * 360 + 5 * 360 + (360 - (s.centre + decalage));
    const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const g = $('#roue-g');
    g.style.transition = reduit ? 'none' : 'transform 4.6s cubic-bezier(.12,.6,.12,1)';
    g.style.transform = `rotate(${cible}deg)`;
    rotationRoue = cible;
    await new Promise((fin) => setTimeout(fin, reduit ? 0 : 4800));
    const a = r.action;
    $('#roue-resultat').innerHTML = `
      <p class="sur-titre">La roue a choisi</p>
      ${carteAction(a)}
      <button class="btn-principal" type="button" id="roue-lancer">${ico('timer')}Lancer le chrono · ${duree(a.duree)}</button>`;
    $('#roue-lancer').addEventListener('click', () => lancerChrono(a.id, 'roue'));
  } catch (err) {
    toast(err.message);
  }
  bouton.disabled = false;
}
$('#tourner').addEventListener('click', tournerRoue);

// Découper un gros chantier : une étape par ligne → une tâche par étape (aperçu en direct, voir etapes.js).
async function remplirProjets(select, vide) {
  const projets = await api('/api/projets');
  select.innerHTML = `<option value="">${vide}</option>${projets.map((p) => `<option value="${esc(p.id)}">${esc(p.nom)}${p.type === 'Activité' ? ' (activité)' : ''}</option>`).join('')}`;
}
const apercuEtapes = () => analyserEtapes($('#d-texte').value, { couper: $('#d-couper').checked });
function majApercu() {
  const { etapes, total } = apercuEtapes();
  const zone = $('#d-apercu');
  if (!etapes.length) return void (zone.innerHTML = '');
  const trop = etapes.length > 30;
  zone.innerHTML = `<p class="${trop ? 'message' : 'resume-apercu'}">${trop ? `30 tâches au maximum à la fois (là : ${etapes.length}).` : `${etapes.length} tâche${etapes.length > 1 ? 's' : ''} · ${duree(total)} au total`}</p>
    <ol class="apercu-liste">${etapes.slice(0, 12).map((e) => `<li><span>${esc(e.titre)}</span><span class="puce">${duree(e.duree)}</span></li>`).join('')}${etapes.length > 12 ? `<li class="plus">… et ${etapes.length - 12} autres</li>` : ''}</ol>`;
}
$('#decouper-taches').addEventListener('click', async () => {
  const form = $('#form-decoupe');
  form.hidden = !form.hidden;
  if (form.hidden) return;
  try { await remplirProjets($('#d-projet'), 'Hors projet (to-do simple)'); } catch (e) { toast(e.message); }
  $('#d-texte').focus();
});
$('#d-texte').addEventListener('input', majApercu);
$('#d-couper').addEventListener('change', majApercu);
$('#form-decoupe').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#form-decoupe .message');
  msg.textContent = '';
  const { etapes } = apercuEtapes();
  if (!etapes.length) return void (msg.textContent = 'Écris au moins une étape.');
  if (etapes.length > 30) return void (msg.textContent = '30 tâches au maximum à la fois.');
  const bouton = ev.submitter;
  bouton.disabled = true;
  try {
    const r = await api('/api/taches/lot', { method: 'POST', body: { projetId: $('#d-projet').value || null, etapes } });
    $('#form-decoupe').reset();
    $('#d-apercu').innerHTML = '';
    $('#form-decoupe').hidden = true;
    toast(`${r.creees} tâche${r.creees > 1 ? 's' : ''} créée${r.creees > 1 ? 's' : ''}`);
  } catch (err) {
    msg.textContent = err.message;
  }
  await chargerTaches().catch(() => {});
  bouton.disabled = false;
});

// --- Écran « Séances » (historique, séance oubliée, corrections) ------------------------------------------------------
let seancesParId = new Map();
const jourLong = (iso) => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const sansDuree = (titre) => String(titre || '').replace(/\s·\s[^·]+$/, ''); // le titre d'une séance se termine par « · 30 min »

async function chargerSeances() {
  const { seances } = await api('/api/seances?jours=60');
  seancesParId = new Map(seances.map((s) => [s.id, s]));
  const jours = new Map();
  for (const s of seances) jours.set(s.jour, [...(jours.get(s.jour) || []), s]);
  $('#seances-contenu').innerHTML = jours.size ? [...jours].map(([jour, liste]) => `
    <section class="groupe">
      <h3 class="groupe-titre">${esc(jourLong(jour))}<span class="compte">${duree(liste.reduce((somme, s) => somme + s.duree, 0))}</span></h3>
      <ul class="liste">${liste.map((s) => `
        <li class="ligne" style="--c:${esc(s.projetHex || '#8b93ff')}">
          <button class="ligne-texte ligne-btn" type="button" data-seance="${esc(s.id)}" aria-label="Modifier la séance : ${esc(sansDuree(s.titre))}"><span class="ligne-titre">${esc(sansDuree(s.titre))}</span>
            <span class="puces"><span class="puce">${ico('timer')}${duree(s.duree)}</span>${s.projetNom ? `<span class="puce">${esc(s.projetNom)}</span>` : ''}${s.origine && s.origine !== 'Chrono' ? `<span class="puce">${esc(s.origine.toLowerCase())}</span>` : ''}</span>
            ${s.bilan ? `<span class="bilan-court">${esc(s.bilan)}</span>` : ''}</button>
        </li>`).join('')}</ul>
    </section>`).join('') : '<div class="vide"><p>Aucune séance ces 60 derniers jours.</p></div>';
}
$('#seances-contenu').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-seance]');
  if (b) feuilleSeance(seancesParId.get(b.dataset.seance));
});

// Corriger ou supprimer une séance : le temps cumulé du projet et de la tâche suit.
function feuilleSeance(s) {
  if (!s) return;
  feuille({
    titre: 'Modifier la séance',
    valeurs: s,
    champs: [
      { nom: 'jour', label: 'Jour', type: 'date', max: jourLocal(), requis: true, aide: `${sansDuree(s.titre)}${s.projetNom ? ` · ${s.projetNom}` : ''}` },
      { nom: 'duree', label: 'Temps travaillé (min)', type: 'number', min: 1, max: 600, requis: true },
      { nom: 'bilan', label: 'Bilan', type: 'textarea' },
    ],
    enregistrer: async (val) => {
      const diff = changements({ jour: s.jour, duree: s.duree, bilan: s.bilan }, val);
      if (!Object.keys(diff).length) return;
      await api(`/api/seances/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: diff });
      toast('Séance corrigée');
      await chargerSeances();
    },
    supprimer: async () => {
      await api(`/api/seances/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      toast('Séance supprimée');
      await chargerSeances();
    },
    confirmation: `Supprimer cette séance de ${duree(s.duree)} ? Ce temps sera aussi retiré du projet et de la tâche.`,
  });
}

// Séance oubliée : on choisit le projet (et la tâche), le jour, la durée.
$('#ajouter-seance').addEventListener('click', async () => {
  try {
    const [projets, taches] = await Promise.all([api('/api/projets'), api('/api/taches')]);
    const optionsTaches = (projetId) => [{ v: '', l: 'Aucune tâche en particulier' }, ...taches.filter((t) => (t.projetId || '') === projetId).map((t) => ({ v: t.id, l: t.titre }))];
    feuille({
      titre: 'Séance oubliée', libelle: 'Ajouter',
      valeurs: { projetId: '', tacheId: '', jour: jourLocal(), duree: 30 },
      champs: [
        { nom: 'projetId', label: 'Projet ou activité', type: 'select', options: [{ v: '', l: 'Hors projet' }, ...projets.map((p) => ({ v: p.id, l: p.nom }))] },
        { nom: 'tacheId', label: 'Tâche', type: 'select', options: optionsTaches('') },
        { nom: 'jour', label: 'Jour', type: 'date', max: jourLocal(), requis: true },
        { nom: 'duree', label: 'Temps travaillé (min)', type: 'number', min: 1, max: 600, requis: true },
        { nom: 'bilan', label: 'Bilan (facultatif)', type: 'textarea' },
      ],
      enregistrer: async (val) => {
        const r = await api('/api/seances', { method: 'POST', body: { projetId: val.projetId || null, tacheId: val.tacheId || null, jour: val.jour, duree: val.duree, bilan: val.bilan } });
        toast(r.enAttente ? 'Séance gardée : Notion est injoignable, elle partira plus tard' : 'Séance ajoutée');
        await chargerSeances();
      },
    });
    $('#f-projetId').addEventListener('change', (ev) => {
      $('#f-tacheId').innerHTML = optionsTaches(ev.target.value).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('');
    });
  } catch (e) {
    toast(e.message);
  }
});

// --- Écran « Musique » (la bibliothèque de la radio) ------------------------------------------------------------------
let liensParId = new Map();
const hoteLien = (lien) => { try { return new URL(lien).hostname.replace(/^www\./, ''); } catch { return lien; } };
async function chargerBibliotheque() {
  const r = await api('/api/musique?tout=1');
  liensParId = new Map(r.lignes.map((l) => [l.id, l]));
  $('#bibliotheque-contenu').innerHTML = (r.message ? `<p class="avertissement">${esc(r.message)}</p>` : '')
    + (r.lignes.length ? `<ul class="liste">${r.lignes.map((l) => `
      <li class="ligne ${l.desactive ? 'en-sommeil' : ''}" style="--c:var(--turquoise)">
        <button class="ligne-texte ligne-btn" type="button" data-lien="${esc(l.id)}" aria-label="Modifier : ${esc(l.titre)}"><span class="ligne-titre">${esc(l.titre)}</span>
          <span class="puces"><span class="puce">${esc(hoteLien(l.lien))}</span>${l.valide ? '' : '<span class="puce retard">lien non reconnu</span>'}${l.desactive ? '<span class="puce">désactivé</span>' : ''}</span></button>
        <button class="rond ${l.desactive ? '' : 'rempli'}" type="button" data-bascule="${esc(l.id)}" aria-label="${l.desactive ? 'Activer' : 'Désactiver'} : ${esc(l.titre)}" aria-pressed="${!l.desactive}">${ico('check')}</button>
      </li>`).join('')}</ul>` : '<div class="vide"><p>Aucun lien. Ajoute une playlist ou une vidéo YouTube.</p></div>')
    + '<p class="note gauche">La radio pioche au hasard parmi les liens cochés. Un lien décoché est gardé mais ignoré.</p>';
}
$('#bibliotheque-contenu').addEventListener('click', async (ev) => {
  const bascule = ev.target.closest('[data-bascule]');
  const edit = ev.target.closest('[data-lien]');
  if (bascule) {
    const l = liensParId.get(bascule.dataset.bascule);
    try {
      await api(`/api/musique/${encodeURIComponent(l.id)}`, { method: 'PATCH', body: { desactive: !l.desactive } });
      await chargerBibliotheque();
    } catch (e) { toast(e.message); }
  } else if (edit) feuilleLien(liensParId.get(edit.dataset.lien));
});
function feuilleLien(l) {
  const creation = !l;
  feuille({
    titre: creation ? 'Ajouter un lien' : 'Modifier le lien', libelle: creation ? 'Ajouter' : 'Enregistrer',
    valeurs: l || {},
    champs: [
      { nom: 'titre', label: 'Titre', type: 'text', maxlength: 200, placeholder: 'ex. Mac Miller 1 hour chill mix' },
      { nom: 'lien', label: 'Lien YouTube (vidéo ou playlist)', type: 'url', placeholder: 'https://www.youtube.com/watch?v=…', requis: true },
      ...(creation ? [] : [{ nom: 'desactive', label: 'Désactivé (la radio l’ignore)', type: 'checkbox' }]),
    ],
    enregistrer: async (val) => {
      if (creation) await api('/api/musique', { method: 'POST', body: { titre: val.titre, lien: val.lien } });
      else {
        const diff = changements({ titre: l.titre, lien: l.lien, desactive: l.desactive }, val);
        if (!Object.keys(diff).length) return;
        await api(`/api/musique/${encodeURIComponent(l.id)}`, { method: 'PATCH', body: diff });
      }
      toast(creation ? 'Lien ajouté' : 'Lien modifié');
      await chargerBibliotheque();
    },
    supprimer: creation ? null : async () => {
      await api(`/api/musique/${encodeURIComponent(l.id)}`, { method: 'DELETE' });
      toast('Lien supprimé');
      await chargerBibliotheque();
    },
    confirmation: l && `Supprimer « ${l.titre} » de la bibliothèque ?`,
  });
}
$('#ajouter-lien').addEventListener('click', () => feuilleLien(null));

// --- Écran « Réglages » ---------------------------------------------------------------------------------------------
async function chargerReglages() {
  const [e, s] = await Promise.all([api('/api/etat'), api('/api/synchro')]);
  $('#reglages-contenu').innerHTML = `
    <div class="carte">
      <h3>Données</h3>
      <p>${e.mode === 'notion' ? 'Reliée à Notion : projets, tâches et séances.' : 'Mode démo : données fictives, tout reste en mémoire et rien n’est lu ni écrit dans Notion.'}</p>
      ${s.attente ? `<p class="avertissement">${s.attente} séance${s.attente > 1 ? 's' : ''} en attente d’envoi vers Notion${s.erreur ? ` (${esc(s.erreur)})` : ''}. Nouvel essai toutes les 2 minutes.</p>` : ''}
      <button class="btn-lien" type="button" id="rafraichir"${e.mode === 'notion' ? '' : ' disabled'}>${ico('refresh')}Rafraîchir Notion</button>
      <p class="message" id="msg-rafraichir"></p>
    </div>
    <div class="carte">
      <h3>Musique</h3>
      <label class="case"><input id="r-musique" type="checkbox"${musiqueActive() ? ' checked' : ''}> Musique pendant le chrono</label>
      <a class="lien-carte" href="#bibliotheque">Gérer la bibliothèque de musique${ico('chevron')}</a>
    </div>
    <div class="carte">
      <h3>Séances</h3>
      <a class="lien-carte" href="#seances">Historique, séance oubliée, corrections${ico('chevron')}</a>
    </div>`;
  $('#r-musique').addEventListener('change', (ev) => {
    try { localStorage.setItem('bosse-musique', ev.target.checked ? 'oui' : 'non'); } catch {}
  });
  $('#rafraichir').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const r = await api('/api/notion/rafraichir', { method: 'POST' });
      $('#msg-rafraichir').textContent = `${r.projets} projets, ${r.taches} tâches et ${r.sessions} séances de la semaine lus.${r.attente ? ` ${r.attente} séance(s) encore en attente.` : ''}`;
    } catch (err) {
      $('#msg-rafraichir').textContent = err.message;
    }
    ev.currentTarget.disabled = false;
  });
}

// --- Navigation ----------------------------------------------------------------------------------------------------------
const ECRANS = { maintenant: chargerMaintenant, chrono: chargerChrono, bilan: chargerBilan, projets: chargerProjets, taches: chargerTaches, roue: chargerRoue, seances: chargerSeances, bibliotheque: chargerBibliotheque, reglages: chargerReglages };
const SANS_NAV = ['connexion', 'chrono', 'bilan'];

async function afficher() {
  arreterChrono();
  const nom = location.hash.slice(1) || 'maintenant';
  const ecran = nom === 'connexion' || ECRANS[nom] ? nom : 'maintenant';
  document.querySelectorAll('.ecran').forEach((s) => { s.hidden = s.id !== ecran; });
  if (ecran !== 'chrono') Radio.arreter();
  $('#nav').hidden = SANS_NAV.includes(ecran);
  const onglet = { seances: 'reglages', bibliotheque: 'reglages' }[ecran] || ecran; // ces écrans se rangent sous « Réglages »
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('actif', a.getAttribute('href') === '#' + onglet));
  if (ecran === 'connexion') return $('#mdp').focus();
  try {
    // Un chrono est en cours (ou en attente de bilan) : on y retourne, d'où qu'on vienne.
    if (!SANS_NAV.includes(ecran)) {
      const { chrono: c } = await api('/api/chrono');
      if (c) return void (location.hash = c.etat === 'fini' ? '#bilan' : '#chrono');
    }
    await ECRANS[ecran]();
  } catch (err) {
    if (location.hash !== '#connexion') {
      const zone = $(`#${ecran} > div:last-child`);
      if (zone) zone.innerHTML = `<div class="vide erreur"><p>${esc(err.message)}</p></div>`;
    }
  }
}

$('#form-connexion').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#form-connexion .message');
  msg.textContent = '';
  try {
    await api('/api/connexion', { method: 'POST', body: { motDePasse: $('#mdp').value } });
    $('#mdp').value = '';
    location.hash = '#maintenant';
    afficher();
  } catch (err) {
    msg.textContent = err.message;
  }
});

window.addEventListener('hashchange', afficher);
afficher();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
