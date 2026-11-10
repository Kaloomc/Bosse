// Liens avec Notion (API officielle, https://developers.notion.com), même accès que Repax, Agendix, Argenx et Brief.
// NOTION_TOKEN         : jeton de l'intégration Notion (reste sur le serveur)
// NOTION_BASE_PROJETS  : identifiant (ou lien) de la base « Mes projets ». C'est l'identifiant de la BASE, pas celui de la
//                        source de données (« collection://… »). Les bases « Tâches » et « Sessions de travail » sont
//                        retrouvées par leur titre dans la page qui contient « Mes projets » (la page « Projet »).
// NOTION_BASE_TACHES, NOTION_BASE_SESSIONS, NOTION_BASE_MUSIQUE (facultatifs) : identifiants de ces bases, si on ne veut pas les chercher par titre.
//
// Les bases « Tâches » et « Sessions de travail » existaient déjà dans la page (prototype « Open Space », avec les vraies tâches et les
// vraies séances) avec d'autres noms de colonnes : « Nom », « Estimation (min) », « Note », « Fin », « Tâches faites », « Source »…
// L'appli ne leur impose donc pas ses noms : elle lit le schéma réel de chaque base et, pour chaque information, prend la première
// colonne qui existe parmi plusieurs noms possibles (voir CHERCHE). Le titre est la colonne de type « titre », quel que soit son nom.
// Une information sans colonne (par ex. « Temps passé » dans l'ancienne base de tâches) n'est simplement ni lue ni écrite.
// Si la page contient plusieurs bases du même titre, la PREMIÈRE est utilisée (NOTION_BASE_… pour en choisir une autre).
//
// Ce que BOSSE ! écrit dans Notion, et rien d'autre (un test le vérifie) :
//   - « Sessions de travail » : une ligne par séance ;
//   - « Mes projets » : Temps cumulé (min), Dernière activité, Prochaine étape, et Statut → Terminé si tu le demandes ;
//     Objectif de temps hebdo (min) si tu le modifies dans l'appli ; une nouvelle ligne quand tu ajoutes une activité
//     (avec la propriété « Type », ajoutée à la base si elle manque) ;
//   - « Tâches » : Temps passé (min), Dernière fois, Statut (Fait / À faire), et les tâches créées dans l'appli.
//   - « Sessions de travail » : aussi modifiées et supprimées (séances oubliées, corrections) ; le temps cumulé du projet et de la
//     tâche est alors ajusté de la différence ;
//   - « Musique » : liens ajoutés, modifiés, désactivés ou supprimés depuis l'appli ;
//   - tout champ d'un projet, d'une activité ou d'une tâche qu'on modifie dans l'appli (nom, statut, couleur, logo par lien…).
// Les suppressions mettent la page à la corbeille de Notion (récupérable).
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
// Pour chaque information : les noms de colonne possibles, du préféré au moins préféré.
const CHERCHE = {
  taches: { projet: ['Projet'], statut: ['Statut'], priorite: ['Priorité'], echeance: ['Échéance'], duree: ['Durée estimée (min)', 'Estimation (min)'], notes: ['Notes', 'Note'], tempsPasse: ['Temps passé (min)'], derniereFois: ['Dernière fois'], termineLe: ['Terminée le'] },
  sessions: { debut: ['Début'], fin: ['Fin'], duree: ['Durée (min)'], tache: ['Tâche', 'Tâches faites'], projet: ['Projet'], bilan: ['Bilan', 'Note'], prochaineEtape: ['Prochaine étape'], origine: ['Origine', 'Source'] },
  musique: { lien: ['Lien YouTube'], desactive: ['Désactivé'] },
};
// Les noms de colonne de la structure créée par BOSSE ! (sert si le schéma ne peut pas être lu, et aux tests).
const DEFAUT = {
  taches: { titre: 'Tâche', projet: 'Projet', statut: 'Statut', priorite: 'Priorité', echeance: 'Échéance', duree: 'Durée estimée (min)', notes: 'Notes', tempsPasse: 'Temps passé (min)', derniereFois: 'Dernière fois', termineLe: null },
  sessions: { titre: 'Titre', debut: 'Début', fin: null, duree: 'Durée (min)', tache: 'Tâche', projet: 'Projet', bilan: 'Bilan', prochaineEtape: 'Prochaine étape', origine: 'Origine' },
  musique: { titre: 'Titre', lien: 'Lien YouTube', desactive: 'Désactivé' },
};

// Schéma d'une base (réponse de GET /databases/…) → { titre, information: nom de colonne ou null }.
function champsDe(base, cherche) {
  const props = base.properties || {};
  const noms = { titre: Object.entries(props).find(([, p]) => p.type === 'title')?.[0] ?? null };
  for (const [info, candidats] of Object.entries(cherche)) noms[info] = candidats.find((c) => props[c]) ?? null;
  return noms;
}

let bases = null; // promesse { projets, taches, sessions, musique, champs, doublons }, gardée en mémoire ; en cas d'erreur on cherche de nouveau
async function trouverBases() {
  const projets = identifiant(process.env.NOTION_BASE_PROJETS);
  if (!projets) throw new Error('NOTION_BASE_PROJETS manquant : indique l’identifiant ou le lien de la base « Mes projets ».');
  let taches = identifiant(process.env.NOTION_BASE_TACHES);
  let sessions = identifiant(process.env.NOTION_BASE_SESSIONS);
  let musique = identifiant(process.env.NOTION_BASE_MUSIQUE);
  const doublons = { taches: 0, sessions: 0, musique: 0 };
  if (!taches || !sessions || !musique) {
    let base;
    try {
      base = await api('GET', `/databases/${projets}`);
    } catch (err) {
      throw new Error(`${err.message} (NOTION_BASE_PROJETS doit être l’identifiant de la base « Mes projets », pas celui de la source de données « collection://… », et l’intégration doit être connectée à sa page.)`);
    }
    const parent = base.parent?.page_id;
    if (!parent) throw new Error('« Mes projets » n’est pas dans une page : indique NOTION_BASE_TACHES et NOTION_BASE_SESSIONS.');
    const trouvees = { [TITRE_TACHES]: [], [TITRE_SESSIONS]: [], [TITRE_MUSIQUE]: [] };
    let curseur;
    do {
      const r = await api('GET', `/blocks/${parent}/children?page_size=100${curseur ? `&start_cursor=${curseur}` : ''}`);
      for (const b of r.results) if (b.type === 'child_database' && trouvees[b.child_database.title]) trouvees[b.child_database.title].push(b.id);
      curseur = Object.values(trouvees).every((l) => l.length) ? null : r.next_cursor;
    } while (curseur);
    if (!taches) [taches] = trouvees[TITRE_TACHES];
    if (!sessions) [sessions] = trouvees[TITRE_SESSIONS];
    if (!musique) [musique] = trouvees[TITRE_MUSIQUE];
    doublons.taches = Math.max(0, trouvees[TITRE_TACHES].length - 1);
    doublons.sessions = Math.max(0, trouvees[TITRE_SESSIONS].length - 1);
    doublons.musique = Math.max(0, trouvees[TITRE_MUSIQUE].length - 1);
    if (!taches) throw new Error(`La base « ${TITRE_TACHES} » n’est pas dans la même page que « Mes projets ».`);
  }
  // Le schéma réel de chaque base : quelles colonnes existent, et comment elles s'appellent.
  const champs = { taches: DEFAUT.taches, sessions: DEFAUT.sessions, musique: DEFAUT.musique, statutsTache: ['À faire', 'Fait'], origines: null };
  for (const [cle, id] of [['taches', taches], ['sessions', sessions], ['musique', musique]]) {
    if (!id) continue;
    try {
      const schema = await api('GET', `/databases/${id}`);
      champs[cle] = champsDe(schema, CHERCHE[cle]);
      if (!champs[cle].titre) champs[cle].titre = DEFAUT[cle].titre;
      if (cle === 'taches') champs.statutsTache = (schema.properties?.[champs.taches.statut]?.select?.options ?? []).map((o) => o.name);
    } catch (err) {
      console.error(`Notion (schéma de « ${cle} ») :`, err.message, '- noms de colonnes par défaut');
    }
  }
  if (!champs.statutsTache.length) champs.statutsTache = ['À faire', 'Fait'];
  return { projets, taches, sessions: sessions || null, musique: musique || null, champs, doublons };
}
const getBases = () => (bases ??= trouverBases().catch((err) => { bases = null; throw err; }));

// Ce que l'appli utilise réellement (pour l'écran Réglages) : bases trouvées en double, statuts possibles d'une tâche, colonnes gérées.
async function infosBases() {
  const b = await getBases();
  return {
    doublons: b.doublons, statutsTache: b.champs.statutsTache,
    capacites: { notesTaches: !!b.champs.taches.notes, tempsParTache: !!b.champs.taches.tempsPasse, bilanSeances: !!b.champs.sessions.bilan },
  };
}

// Toutes les pages d'une base (avec un filtre Notion facultatif).
async function pages(id, filter, sorts) {
  const sortie = [];
  let curseur;
  do {
    const r = await api('POST', `/databases/${id}/query`, { page_size: 100, ...(filter && { filter }), ...(sorts && { sorts }), ...(curseur && { start_cursor: curseur }) });
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
// Le titre d'une page : sa colonne de type « titre », quel que soit son nom (« Nom », « Tâche », « Titre »…).
const titreDe = (page) => texte(Object.values(page.properties || {}).find((p) => p.type === 'title'));

function lireProjet(page) {
  const p = page.properties;
  const couleur = choix(p['Couleur']);
  return {
    id: page.id, nom: titreDe(page) || 'Sans nom', type: choix(p['Type']) === 'Activité' ? 'Activité' : 'Projet', statut: choix(p['Statut']), categorie: choix(p['Catégorie']),
    priorite: choix(p['Priorité']), couleur, hex: hexDe(couleur), echeance: jour(p['Échéance']),
    prochaineEtape: texte(p['Prochaine étape']), derniereActivite: jour(p['Dernière activité']),
    tempsCumule: nombre(p['Temps cumulé (min)']) ?? 0, objectifHebdo: nombre(p['Objectif de temps hebdo (min)']),
    logo: (p['Logo']?.files?.length ?? 0) > 0, logoLien: p['Logo']?.files?.[0]?.external?.url ?? '', icone: texte(p['Icône']),
    resume: texte(p['Objectif / résumé']), url: page.url,
  };
}

// n : les noms de colonne réels de la base (voir champsDe) ; par défaut, ceux de la structure BOSSE !.
function lireTache(page, n = DEFAUT.taches) {
  const p = page.properties;
  return {
    id: page.id, titre: titreDe(page) || 'Sans titre', projetId: p[n.projet]?.relation?.[0]?.id ?? null,
    statut: choix(p[n.statut]) || 'À faire', priorite: choix(p[n.priorite]), echeance: jour(p[n.echeance]),
    duree: nombre(p[n.duree]), tempsPasse: nombre(p[n.tempsPasse]) ?? 0,
    derniereFois: jour(p[n.derniereFois]), notes: texte(p[n.notes]), url: page.url,
  };
}

// L'ancienne base utilise « Source » (Assis / Manuel / Secrétaire) ; BOSSE ! parle de Chrono / Ajout manuel / Roue.
const ORIGINE_LUE = { Assis: 'Chrono', Manuel: 'Ajout manuel' };
function lireSession(page, n = DEFAUT.sessions) {
  const p = page.properties;
  const debut = p[n.debut]?.date?.start;
  if (!debut) return null;
  const origine = choix(p[n.origine]);
  return {
    id: page.id, debut, fin: (n.fin ? p[n.fin]?.date?.start : p[n.debut]?.date?.end) ?? null, duree: nombre(p[n.duree]) ?? 0,
    tacheId: p[n.tache]?.relation?.[0]?.id ?? null, projetId: p[n.projet]?.relation?.[0]?.id ?? null,
    titre: titreDe(page), bilan: texte(p[n.bilan]), origine: n.origine === 'Source' ? ORIGINE_LUE[origine] ?? origine : origine,
  };
}

// Tout ce qu'il faut pour l'écran : les projets, les tâches pas encore faites et les séances de la semaine
// (à partir de la veille du lundi : la date exacte est vérifiée ensuite à l'heure de Paris).
async function lireTout() {
  const b = await getBases();
  const projets = await pages(b.projets);
  // Tâches dans l'ordre de création : à score égal, la première écrite passe d'abord (utile pour une liste d'étapes).
  const taches = await pages(b.taches, { property: b.champs.taches.statut, select: { does_not_equal: 'Fait' } }, [{ timestamp: 'created_time', direction: 'ascending' }]);
  const depuis = ajouterJours(debutSemaine(aujourdhui()), -1);
  const sessions = b.sessions ? await pages(b.sessions, { property: b.champs.sessions.debut, date: { on_or_after: depuis } }) : [];
  return {
    projets: projets.map(lireProjet), taches: taches.map((t) => lireTache(t, b.champs.taches)),
    sessions: sessions.map((s) => lireSession(s, b.champs.sessions)).filter(Boolean),
  };
}

// Les liens de la base « Musique ». null si la base n'existe pas.
async function lireMusique() {
  const b = await getBases();
  if (!b.musique) return null;
  const n = b.champs.musique;
  return (await pages(b.musique)).map((page) => ({
    id: page.id, titre: titreDe(page), lien: page.properties[n.lien]?.url ?? '', desactive: page.properties[n.desactive]?.checkbox === true,
  }));
}

// --- Écritures ------------------------------------------------------------------------------------
const morceaux = (s, n) => (s.length ? s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) : []);
const riche = (s) => ({ rich_text: morceaux(String(s ?? ''), 2000).slice(0, 100).map((c) => ({ text: { content: c } })) });
const relation = (id) => ({ relation: id ? [{ id }] : [] });
const enTitre = (v) => ({ title: [{ text: { content: String(v ?? '').slice(0, 200) } }] });
const selection = (v) => ({ select: v ? { name: v } : null });
const date = (v) => ({ date: v ? { start: v } : null });
const nombreN = (v) => ({ number: v ?? null });
const champs = async () => (await getBases()).champs; // les noms de colonne réels (taches, sessions, musique)

// Chaque information modifiable : [la colonne dans le schéma, comment l'écrire]. Une colonne absente de la base n'est jamais écrite.
const REGLES_TACHE = {
  titre: ['titre', enTitre], projetId: ['projet', relation], duree: ['duree', nombreN], priorite: ['priorite', selection],
  echeance: ['echeance', date], notes: ['notes', riche], statut: ['statut', (v) => ({ select: { name: v } })],
};
const proprietes = (regles, noms, valeurs) => {
  const sortie = {};
  for (const [k, v] of Object.entries(valeurs)) {
    const regle = regles[k];
    const nom = regle && noms[regle[0]];
    if (nom) sortie[nom] = regle[1](v);
  }
  return sortie;
};
// Quand une tâche passe à « Fait », la colonne « Terminée le » (si la base en a une) reçoit la date ; si on la rétablit, elle est vidée.
const avecTermineLe = (props, noms, statut, jourFait = aujourdhui()) => {
  if (statut !== undefined && noms.termineLe) props[noms.termineLe] = date(statut === 'Fait' ? jourFait : null);
  return props;
};

// Une ligne dans « Sessions de travail ». Renvoie l'identifiant de la page créée.
const ORIGINE_ECRITE = { Chrono: 'Assis', Roue: 'Assis', 'Ajout manuel': 'Manuel' }; // vers la colonne « Source » de l'ancienne base
async function creerSession(s) {
  const b = await getBases();
  if (!b.sessions) throw new Error(`La base « ${TITRE_SESSIONS} » n’est pas dans la même page que « Mes projets ».`);
  const n = b.champs.sessions;
  const origine = ['Roue', 'Ajout manuel'].includes(s.origine) ? s.origine : 'Chrono'; // « Roue » : projet tiré au sort ; « Ajout manuel » : séance oubliée
  const properties = {
    [n.titre]: enTitre(`${s.titre} · ${dureeTexte(s.duree)}`),
    // Une colonne « Fin » séparée (ancienne base) la reçoit ; sinon la date de début devient une période début → fin.
    [n.debut]: n.fin ? { date: { start: s.debut } } : { date: { start: s.debut, end: s.fin || null } },
  };
  if (n.fin && s.fin) properties[n.fin] = { date: { start: s.fin } };
  if (n.duree) properties[n.duree] = { number: s.duree };
  if (n.tache && s.tacheId) properties[n.tache] = relation(s.tacheId);
  if (n.projet && s.projetId) properties[n.projet] = relation(s.projetId);
  if (n.bilan) properties[n.bilan] = riche(s.bilan);
  if (n.prochaineEtape) properties[n.prochaineEtape] = riche(s.prochaineEtape);
  if (n.origine) properties[n.origine] = { select: { name: n.origine === 'Source' ? ORIGINE_ECRITE[origine] : origine } };
  const page = await api('POST', '/pages', { parent: { database_id: b.sessions }, properties });
  return page.id;
}

// Le temps cumulé est relu juste avant d'écrire (si tu l'as modifié dans Notion entre-temps, rien n'est écrasé).
async function majProjet(id, { duree, jour: j, prochaineEtape, termine }) {
  const page = await api('GET', `/pages/${id}`);
  const actuel = nombre(page.properties?.['Temps cumulé (min)']) ?? 0;
  const properties = { 'Temps cumulé (min)': { number: actuel + duree } };
  const derniere = jour(page.properties?.['Dernière activité']);
  if (!derniere || j > derniere) properties['Dernière activité'] = { date: { start: j } }; // une séance ajoutée après coup ne fait pas reculer la date
  if (prochaineEtape) properties['Prochaine étape'] = riche(prochaineEtape);
  if (termine) properties['Statut'] = { select: { name: 'Terminé' } };
  await api('PATCH', `/pages/${id}`, { properties });
}

// Temps passé et dernière fois (si la base de tâches a ces colonnes), et « Fait » (+ « Terminée le ») si la tâche est terminée.
async function majTache(id, { duree, jour: j, fait }) {
  const n = (await champs()).taches;
  const properties = {};
  if (n.tempsPasse || n.derniereFois) {
    const page = await api('GET', `/pages/${id}`);
    if (n.tempsPasse) properties[n.tempsPasse] = { number: (nombre(page.properties?.[n.tempsPasse]) ?? 0) + duree };
    const derniere = jour(page.properties?.[n.derniereFois]);
    if (n.derniereFois && (!derniere || j > derniere)) properties[n.derniereFois] = { date: { start: j } };
  }
  if (fait) {
    if (n.statut) properties[n.statut] = { select: { name: 'Fait' } };
    avecTermineLe(properties, n, 'Fait', j);
  }
  if (Object.keys(properties).length) await api('PATCH', `/pages/${id}`, { properties });
}

// La propriété « Type » (Projet / Activité) de « Mes projets » : ajoutée à la base si elle manque (une seule vérification par démarrage).
let typeVerifie = false;
async function assurerType() {
  if (typeVerifie) return;
  const b = await getBases();
  const base = await api('GET', `/databases/${b.projets}`);
  if (!base.properties?.Type) {
    await api('PATCH', `/databases/${b.projets}`, { properties: { Type: { select: { options: [{ name: 'Projet', color: 'blue' }, { name: 'Activité', color: 'green' }] } } } });
  }
  typeVerifie = true;
}

// Nouvelle activité (une ligne de « Mes projets » de type Activité) : objectifHebdo = son enveloppe de temps par semaine, en minutes.
async function creerActivite({ nom, objectifHebdo, couleur }) {
  return creerProjet({ nom, type: 'Activité', ...(couleur && { couleur }), ...(objectifHebdo && { objectifHebdo }) });
}

// Modifier l'objectif de temps de la semaine d'un projet ou d'une activité (null : pas d'objectif).
async function majObjectif(id, minutes) {
  await api('PATCH', `/pages/${id}`, { properties: { 'Objectif de temps hebdo (min)': { number: minutes ?? null } } });
}

// Nouvelle tâche créée dans l'appli.
async function creerTache({ titre, projetId, duree, priorite, echeance }) {
  const b = await getBases();
  const n = b.champs.taches;
  const page = await api('POST', '/pages', {
    parent: { database_id: b.taches },
    properties: proprietes(REGLES_TACHE, n, { titre, ...(projetId && { projetId }), statut: 'À faire', ...(priorite && { priorite }), ...(echeance && { echeance }), duree }),
  });
  return lireTache(page, n);
}

// Cocher / décocher une tâche.
async function statutTache(id, fait) {
  const n = (await champs()).taches;
  await api('PATCH', `/pages/${id}`, { properties: avecTermineLe({ [n.statut]: { select: { name: fait ? 'Fait' : 'À faire' } } }, n, fait ? 'Fait' : 'À faire') });
}

// --- Modifier et supprimer (tâches, projets, séances, musique) ------------------------------------
// Chaque champ modifiable a sa correspondance dans Notion ; un champ qui n'est pas dans ces tables n'est jamais écrit.
const NOMS_PROJET = { nom: 'Nom', type: 'Type', statut: 'Statut', categorie: 'Catégorie', priorite: 'Priorité', echeance: 'Échéance', prochaineEtape: 'Prochaine étape', objectifHebdo: 'Objectif de temps hebdo (min)', couleur: 'Couleur', icone: 'Icône', resume: 'Objectif / résumé', logo: 'Logo' };
const REGLES_PROJET = {
  nom: ['nom', enTitre], type: ['type', selection], statut: ['statut', selection], categorie: ['categorie', selection], priorite: ['priorite', selection],
  echeance: ['echeance', date], prochaineEtape: ['prochaineEtape', riche], objectifHebdo: ['objectifHebdo', nombreN], couleur: ['couleur', selection], icone: ['icone', riche],
  resume: ['resume', riche], logo: ['logo', (v) => ({ files: v ? [{ type: 'external', name: 'logo', external: { url: v } }] : [] })], // un lien vers une image
};

// Modifier une tâche : seuls les champs donnés sont écrits.
async function modifierTache(id, valeurs) {
  const n = (await champs()).taches;
  const properties = avecTermineLe(proprietes(REGLES_TACHE, n, valeurs), n, valeurs.statut);
  const page = await api('PATCH', `/pages/${id}`, { properties });
  return lireTache(page, n);
}

// Nouveau projet ou nouvelle activité (type Projet / Activité) avec les champs donnés.
async function creerProjet({ nom, type = 'Projet', ...reste }) {
  if (type === 'Activité') await assurerType();
  const b = await getBases();
  const page = await api('POST', '/pages', {
    parent: { database_id: b.projets },
    properties: proprietes(REGLES_PROJET, NOMS_PROJET, { nom, type, statut: 'En cours', ...reste }),
  });
  return lireProjet(page);
}

// Modifier un projet ou une activité : seuls les champs donnés sont écrits (changer le type ajoute la propriété « Type » si besoin).
async function modifierProjet(id, valeurs) {
  if (valeurs.type) await assurerType();
  const page = await api('PATCH', `/pages/${id}`, { properties: proprietes(REGLES_PROJET, NOMS_PROJET, valeurs) });
  return lireProjet(page);
}

// Les choix possibles pour les listes déroulantes : catégories de « Mes projets », statuts d'une tâche.
async function lireOptions() {
  const b = await getBases();
  const base = await api('GET', `/databases/${b.projets}`);
  const noms = (prop) => (base.properties?.[prop]?.select?.options ?? []).map((o) => o.name);
  return { categories: noms('Catégorie'), statutsTache: b.champs.statutsTache };
}

// Mettre une page à la corbeille de Notion (tâche, projet, séance, lien de musique) : récupérable depuis Notion.
async function supprimerPage(id) {
  await api('PATCH', `/pages/${id}`, { archived: true });
}

// Les tâches terminées (les plus récemment modifiées d'abord), pour les rétablir ou les corriger.
async function lireTachesFaites(max = 50) {
  const b = await getBases();
  const r = await api('POST', `/databases/${b.taches}/query`, { page_size: max, filter: { property: b.champs.taches.statut, select: { equals: 'Fait' } }, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] });
  return r.results.map((t) => lireTache(t, b.champs.taches));
}

// L'historique des séances depuis un jour donné (les plus récentes d'abord).
async function lireSeances(depuis) {
  const b = await getBases();
  if (!b.sessions) return [];
  const n = b.champs.sessions;
  const lignes = await pages(b.sessions, { property: n.debut, date: { on_or_after: depuis } }, [{ property: n.debut, direction: 'descending' }]);
  return lignes.map((l) => lireSession(l, n)).filter(Boolean);
}
async function lireSeance(id) {
  return lireSession(await api('GET', `/pages/${id}`), (await champs()).sessions);
}

// Corriger une séance : { titre, duree, bilan, debut, fin } — seuls les champs donnés sont écrits (et seulement dans les colonnes qui existent).
async function modifierSeance(id, { titre: t, duree, bilan, debut, fin }) {
  const n = (await champs()).sessions;
  const properties = {};
  if (t !== undefined) properties[n.titre] = enTitre(t);
  if (duree !== undefined && n.duree) properties[n.duree] = { number: duree };
  if (bilan !== undefined && n.bilan) properties[n.bilan] = riche(bilan);
  if (debut !== undefined) {
    // Début et fin vont ensemble : dans une colonne « Fin » séparée, ou dans la même colonne comme une période.
    properties[n.debut] = n.fin ? { date: { start: debut } } : { date: { start: debut, end: fin ?? null } };
    if (n.fin && fin !== undefined) properties[n.fin] = date(fin);
  }
  await api('PATCH', `/pages/${id}`, { properties });
}

// Ajuster le temps cumulé d'un projet et le temps passé d'une tâche d'une différence (en minutes, + ou −), sans toucher aux dates.
// Utilisé quand une séance est corrigée ou supprimée : les totaux restent justes. Jamais en dessous de zéro.
async function ajusterTemps({ projetId, tacheId, delta }) {
  const n = (await champs()).taches;
  const ajuster = async (id, propriete) => {
    const page = await api('GET', `/pages/${id}`);
    const actuel = nombre(page.properties?.[propriete]) ?? 0;
    await api('PATCH', `/pages/${id}`, { properties: { [propriete]: { number: Math.max(0, actuel + delta) } } });
  };
  if (projetId) await ajuster(projetId, 'Temps cumulé (min)');
  if (tacheId && n.tempsPasse) await ajuster(tacheId, n.tempsPasse);
}

// La bibliothèque de musique : ajouter, modifier, désactiver un lien (la suppression passe par supprimerPage).
async function creerLien({ titre: t, lien }) {
  const b = await getBases();
  if (!b.musique) throw new Error(`La base « ${TITRE_MUSIQUE} » n’est pas dans la même page que « Mes projets ».`);
  const n = b.champs.musique;
  const page = await api('POST', '/pages', { parent: { database_id: b.musique }, properties: { [n.titre]: enTitre(t), [n.lien]: { url: lien } } });
  return { id: page.id, titre: t, lien, desactive: false };
}
async function modifierLien(id, { titre: t, lien, desactive }) {
  const n = (await champs()).musique;
  const properties = {};
  if (t !== undefined) properties[n.titre] = enTitre(t);
  if (lien !== undefined) properties[n.lien] = { url: lien };
  if (desactive !== undefined && n.desactive) properties[n.desactive] = { checkbox: !!desactive };
  await api('PATCH', `/pages/${id}`, { properties });
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
const oublier = () => { bases = null; typeVerifie = false; };

module.exports = {
  get actif() { return !!token(); },
  lireTout, lireMusique, logo, oublier, infosBases, lireProjet, lireTache, lireSession,
  creerSession, majProjet, majTache, creerTache, statutTache, creerActivite, majObjectif,
  modifierTache, creerProjet, modifierProjet, lireOptions, supprimerPage, lireTachesFaites, lireSeances, lireSeance, modifierSeance, ajusterTemps, creerLien, modifierLien,
};
