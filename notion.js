// Liens avec Notion (API officielle, https://developers.notion.com), même accès que Repax, Agendix, Argenx et Brief.
// NOTION_TOKEN         : jeton de l'intégration Notion (reste sur le serveur)
// NOTION_BASE_PROJETS  : identifiant (ou lien) de la base « Mes projets ». C'est l'identifiant de la BASE, pas celui de la
//                        source de données (« collection://… »). Les bases « Tâches » et « Sessions de travail » sont
//                        retrouvées par leur titre dans la page qui contient « Mes projets » (la page « Projet »).
// NOTION_BASE_TACHES, NOTION_BASE_SESSIONS, NOTION_BASE_MUSIQUE (facultatifs) : identifiants de ces bases, si on ne veut pas les chercher par titre.
//
// Ce que BOSSE ! écrit dans Notion, et rien d'autre (un test le vérifie) :
//   - « Sessions de travail » : une ligne par séance ;
//   - « Mes projets » : Temps cumulé (min), Dernière activité, Prochaine étape, et Statut → Terminé si tu le demandes ;
//   - « Tâches » : Temps passé (min), Dernière fois, Statut (Fait / À faire), et les tâches créées dans l'appli.
// La base « Musique » (liens YouTube) est seulement lue.
const { hexDe, duree: dureeTexte } = require('./projets');
const { aujourdhui, debutSemaine, ajouterJours } = require('./temps');

const VERSION = '2022-06-28';
const TITRE_TACHES = 'Tâches';
const TITRE_SESSIONS = 'Sessions de travail';
const TITRE_MUSIQUE = 'Musique';

const token = () => process.env.NOTION_TOKEN;
const identifiant = (s) => (s || '').match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Notion accepte environ 3 requêtes par seconde : on les espace de 340 ms (NOTION_ESPACE_MS pour les tests).
let prochain = 0;
const tour = () => {
  const espace = Number(process.env.NOTION_ESPACE_MS ?? 340);
  const t = Math.max(Date.now(), prochain);
  prochain = t + espace;
  return pause(t - Date.now());
};

async function api(method, chemin, body) {
  for (let essai = 0; ; essai++) {
    await tour();
    const res = await fetch('https://api.notion.com/v1' + chemin, {
      method,
      headers: { Authorization: `Bearer ${token()}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && essai < 4) {
      await pause((Number(res.headers.get('retry-after')) || 1) * 1000);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Notion : ${data.message || res.status}`);
    return data;
  }
}

// --- Bases ------------------------------------------------------------------------
let bases = null; // promesse { projets, taches, sessions, musique }, gardée en mémoire ; en cas d'erreur on cherche de nouveau
async function trouverBases() {
  const projets = identifiant(process.env.NOTION_BASE_PROJETS);
  if (!projets) throw new Error('NOTION_BASE_PROJETS manquant : indique l’identifiant ou le lien de la base « Mes projets ».');
  let taches = identifiant(process.env.NOTION_BASE_TACHES);
  let sessions = identifiant(process.env.NOTION_BASE_SESSIONS);
  let musique = identifiant(process.env.NOTION_BASE_MUSIQUE);
  if (!taches || !sessions || !musique) {
    let base;
    try {
      base = await api('GET', `/databases/${projets}`);
    } catch (err) {
      throw new Error(`${err.message} (NOTION_BASE_PROJETS doit être l’identifiant de la base « Mes projets », pas celui de la source de données « collection://… », et l’intégration doit être connectée à sa page.)`);
    }
    const parent = base.parent?.page_id;
    if (!parent) throw new Error('« Mes projets » n’est pas dans une page : indique NOTION_BASE_TACHES et NOTION_BASE_SESSIONS.');
    let curseur;
    do {
      const r = await api('GET', `/blocks/${parent}/children?page_size=100${curseur ? `&start_cursor=${curseur}` : ''}`);
      const trouver = (titre) => r.results.find((b) => b.type === 'child_database' && b.child_database.title === titre)?.id;
      taches ??= trouver(TITRE_TACHES);
      sessions ??= trouver(TITRE_SESSIONS);
      musique ??= trouver(TITRE_MUSIQUE);
      curseur = taches && sessions && musique ? null : r.next_cursor;
    } while (curseur);
    if (!taches) throw new Error(`La base « ${TITRE_TACHES} » n’est pas dans la même page que « Mes projets ».`);
  }
  return { projets, taches, sessions: sessions || null, musique: musique || null };
}
const getBases = () => (bases ??= trouverBases().catch((err) => { bases = null; throw err; }));

// Toutes les pages d'une base (avec un filtre Notion facultatif).
async function pages(id, filter) {
  const sortie = [];
  let curseur;
  do {
    const r = await api('POST', `/databases/${id}/query`, { page_size: 100, ...(filter && { filter }), ...(curseur && { start_cursor: curseur }) });
    sortie.push(...r.results);
    curseur = r.next_cursor;
  } while (curseur);
  return sortie;
}

// --- Lecture des propriétés ---------------------------------------------------------------
const texte = (p) => (p?.[p.type] || []).map((t) => t.plain_text).join('');
const choix = (p) => p?.select?.name ?? null;
const nombre = (p) => (typeof p?.number === 'number' ? p.number : null);
const jour = (p) => p?.date?.start?.slice(0, 10) ?? null;

function lireProjet(page) {
  const p = page.properties;
  const couleur = choix(p['Couleur']);
  return {
    id: page.id, nom: texte(p['Nom']) || 'Sans nom', statut: choix(p['Statut']), categorie: choix(p['Catégorie']),
    priorite: choix(p['Priorité']), couleur, hex: hexDe(couleur), echeance: jour(p['Échéance']),
    prochaineEtape: texte(p['Prochaine étape']), derniereActivite: jour(p['Dernière activité']),
    tempsCumule: nombre(p['Temps cumulé (min)']) ?? 0, objectifHebdo: nombre(p['Objectif de temps hebdo (min)']),
    logo: (p['Logo']?.files?.length ?? 0) > 0, icone: texte(p['Icône']), url: page.url,
  };
}

function lireTache(page) {
  const p = page.properties;
  return {
    id: page.id, titre: texte(p['Tâche']) || 'Sans titre', projetId: p['Projet']?.relation?.[0]?.id ?? null,
    statut: choix(p['Statut']) || 'À faire', priorite: choix(p['Priorité']), echeance: jour(p['Échéance']),
    duree: nombre(p['Durée estimée (min)']), tempsPasse: nombre(p['Temps passé (min)']) ?? 0,
    derniereFois: jour(p['Dernière fois']), notes: texte(p['Notes']), url: page.url,
  };
}

function lireSession(page) {
  const p = page.properties;
  const debut = p['Début']?.date?.start;
  if (!debut) return null;
  return {
    id: page.id, debut, duree: nombre(p['Durée (min)']) ?? 0, tacheId: p['Tâche']?.relation?.[0]?.id ?? null,
    projetId: p['Projet']?.relation?.[0]?.id ?? null, titre: texte(p['Titre']), bilan: texte(p['Bilan']),
  };
}

// Tout ce qu'il faut pour l'écran : les projets, les tâches pas encore faites et les séances de la semaine
// (à partir de la veille du lundi : la date exacte est vérifiée ensuite à l'heure de Paris).
async function lireTout() {
  const b = await getBases();
  const projets = await pages(b.projets);
  const taches = await pages(b.taches, { property: 'Statut', select: { does_not_equal: 'Fait' } });
  const depuis = ajouterJours(debutSemaine(aujourdhui()), -1);
  const sessions = b.sessions ? await pages(b.sessions, { property: 'Début', date: { on_or_after: depuis } }) : [];
  return { projets: projets.map(lireProjet), taches: taches.map(lireTache), sessions: sessions.map(lireSession).filter(Boolean) };
}

// Les liens de la base « Musique » (lecture seule). Liste vide si la base n'existe pas.
async function lireMusique() {
  const b = await getBases();
  if (!b.musique) return null;
  return (await pages(b.musique)).map((page) => ({
    id: page.id, titre: texte(page.properties['Titre']), lien: page.properties['Lien YouTube']?.url ?? '', desactive: page.properties['Désactivé']?.checkbox === true,
  }));
}

// --- Écritures ------------------------------------------------------------------------------------
const morceaux = (s, n) => (s.length ? s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) : []);
const riche = (s) => ({ rich_text: morceaux(String(s ?? ''), 2000).slice(0, 100).map((c) => ({ text: { content: c } })) });
const relation = (id) => ({ relation: id ? [{ id }] : [] });

// Une ligne dans « Sessions de travail ». Renvoie l'identifiant de la page créée.
async function creerSession(s) {
  const b = await getBases();
  if (!b.sessions) throw new Error(`La base « ${TITRE_SESSIONS} » n’est pas dans la même page que « Mes projets ».`);
  const page = await api('POST', '/pages', {
    parent: { database_id: b.sessions },
    properties: {
      Titre: { title: [{ text: { content: `${s.titre} · ${dureeTexte(s.duree)}`.slice(0, 200) } }] },
      'Début': { date: { start: s.debut, end: s.fin || null } },
      'Durée (min)': { number: s.duree },
      ...(s.tacheId && { 'Tâche': relation(s.tacheId) }),
      ...(s.projetId && { Projet: relation(s.projetId) }),
      Bilan: riche(s.bilan),
      'Prochaine étape': riche(s.prochaineEtape),
      Origine: { select: { name: s.origine === 'Roue' ? 'Roue' : 'Chrono' } }, // « Roue » : projet tiré au sort
    },
  });
  return page.id;
}

// Le temps cumulé est relu juste avant d'écrire (si tu l'as modifié dans Notion entre-temps, rien n'est écrasé).
async function majProjet(id, { duree, jour: j, prochaineEtape, termine }) {
  const page = await api('GET', `/pages/${id}`);
  const actuel = nombre(page.properties?.['Temps cumulé (min)']) ?? 0;
  const properties = { 'Temps cumulé (min)': { number: actuel + duree }, 'Dernière activité': { date: { start: j } } };
  if (prochaineEtape) properties['Prochaine étape'] = riche(prochaineEtape);
  if (termine) properties['Statut'] = { select: { name: 'Terminé' } };
  await api('PATCH', `/pages/${id}`, { properties });
}

async function majTache(id, { duree, jour: j, fait }) {
  const page = await api('GET', `/pages/${id}`);
  const actuel = nombre(page.properties?.['Temps passé (min)']) ?? 0;
  const properties = { 'Temps passé (min)': { number: actuel + duree }, 'Dernière fois': { date: { start: j } } };
  if (fait) properties['Statut'] = { select: { name: 'Fait' } };
  await api('PATCH', `/pages/${id}`, { properties });
}

// Nouvelle tâche créée dans l'appli.
async function creerTache({ titre, projetId, duree, priorite, echeance }) {
  const b = await getBases();
  const page = await api('POST', '/pages', {
    parent: { database_id: b.taches },
    properties: {
      'Tâche': { title: [{ text: { content: titre } }] },
      ...(projetId && { Projet: relation(projetId) }),
      Statut: { select: { name: 'À faire' } },
      ...(priorite && { 'Priorité': { select: { name: priorite } } }),
      ...(echeance && { 'Échéance': { date: { start: echeance } } }),
      'Durée estimée (min)': { number: duree },
    },
  });
  return lireTache(page);
}

// Cocher / décocher une tâche.
async function statutTache(id, fait) {
  await api('PATCH', `/pages/${id}`, { properties: { Statut: { select: { name: fait ? 'Fait' : 'À faire' } } } });
}

// --- Logos ----------------------------------------------------------------------------------
// Les fichiers de Notion sont servis par des liens qui expirent au bout d'environ une heure : on demande un lien frais
// à chaque fois (le serveur garde ensuite l'image 30 minutes). Le lien signé n'a pas besoin du jeton : on ne l'envoie pas.
async function logo(idProjet) {
  const page = await api('GET', `/pages/${idProjet}`);
  const fichier = page.properties?.['Logo']?.files?.[0];
  const url = fichier?.file?.url || fichier?.external?.url;
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return null;
  const octets = Buffer.from(await res.arrayBuffer());
  return octets.length <= 5 * 1024 * 1024 ? { octets, type } : null;
}

// Oublie les identifiants de bases gardés en mémoire (base recréée ou renommée).
const oublier = () => { bases = null; };

module.exports = {
  get actif() { return !!token(); },
  lireTout, lireMusique, logo, oublier, lireProjet, lireTache, lireSession,
  creerSession, majProjet, majTache, creerTache, statutTache,
};
