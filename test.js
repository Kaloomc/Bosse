// Vérifications rapides : npm test (aucun réseau, toutes les données sont fictives)
const test = require('node:test');
const assert = require('node:assert');
const { joursEntre, ajouterJours, indiceJourSemaine, debutSemaine, aujourdhui } = require('./temps');
const { partEcheance, partAnciennete, retardHebdo, candidats, classer, proposer } = require('./choix');
const { duree, hexDe } = require('./projets');
const demo = require('./demo');
const fs = require('fs');
const os = require('os');
const path = require('path');
const chrono = require('./chrono');
const { totaux, appliquerSeance } = require('./seances');
const stockage = require('./stockage');

process.env.APP_PASSWORD = 'mot-de-passe-test';
process.env.NOTION_ESPACE_MS = '0';
process.env.DUREE_CACHE_MS = '60'; // mémoire des données de Notion : 60 ms en test (60 s en vrai)
process.env.DOSSIER_DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'bosse-test-')); // jamais le vrai dossier data/
delete process.env.NOTION_TOKEN;
const app = require('./server');
const notion = require('./notion');
const synchro = require('./synchro');
test.after(() => fs.rmSync(process.env.DOSSIER_DONNEES, { recursive: true, force: true }));

const AUJ = '2026-11-07'; // un samedi

// --- Dates ---------------------------------------------------------------------------
test('dates : écart en jours, lundi = 0, début de semaine', () => {
  assert.strictEqual(joursEntre('2026-11-01', '2026-11-07'), 6);
  assert.strictEqual(joursEntre('2026-11-07', '2026-11-01'), -6);
  assert.strictEqual(joursEntre('2026-03-28', '2026-03-30'), 2); // passage à l'heure d'été
  assert.strictEqual(ajouterJours('2026-12-30', 3), '2027-01-02');
  assert.strictEqual(indiceJourSemaine('2026-11-02'), 0); // lundi
  assert.strictEqual(indiceJourSemaine(AUJ), 5); // samedi
  assert.strictEqual(indiceJourSemaine('2026-11-08'), 6); // dimanche
  assert.strictEqual(debutSemaine(AUJ), '2026-11-02');
  assert.match(aujourdhui(), /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(aujourdhui(new Date('2026-11-07T23:30:00Z')), '2026-11-08'); // minuit passé à Paris
});

test('durées et couleurs', () => {
  assert.strictEqual(duree(45), '45 min');
  assert.strictEqual(duree(60), '1 h');
  assert.strictEqual(duree(95), '1 h 35');
  assert.strictEqual(duree(null), '0 min');
  assert.strictEqual(hexDe('Turquoise'), '#2de2d0');
  assert.strictEqual(hexDe(null), '#8b93ff');
});

// --- Choix de l'action ---------------------------------------------------------------------
test('échéance, ancienneté, retard hebdo : parts entre 0 et 1', () => {
  assert.strictEqual(partEcheance(null), 0);
  assert.strictEqual(partEcheance(-3), 1);
  assert.strictEqual(partEcheance(0), 1);
  assert.strictEqual(partEcheance(3), 0.9);
  assert.strictEqual(partEcheance(5), 0.7);
  assert.strictEqual(partEcheance(10), 0.4);
  assert.strictEqual(partEcheance(60), 0.05);
  assert.strictEqual(partAnciennete(null), 1);
  assert.strictEqual(partAnciennete(7), 0.5);
  assert.strictEqual(partAnciennete(40), 1);
  // objectif 240 min, mercredi (indice 2) : attendu 240 × 3/7 ≈ 103 min
  assert.ok(Math.abs(retardHebdo({ objectif: 240, fait: 0, indiceJour: 2 }) - 3 / 7) < 1e-9);
  assert.strictEqual(retardHebdo({ objectif: 240, fait: 200, indiceJour: 2 }), 0); // en avance
  assert.strictEqual(retardHebdo({ objectif: null, fait: 0, indiceJour: 2 }), 0);
  assert.strictEqual(retardHebdo({ objectif: 240, fait: undefined, indiceJour: 2 }), 0); // temps de la semaine inconnu
});

const projet = (id, extra = {}) => ({ id, nom: id, statut: 'En cours', priorite: null, echeance: null, derniereActivite: AUJ, prochaineEtape: '', objectifHebdo: null, hex: '#fff', ...extra });
const tache = (id, projetId, extra = {}) => ({ id, titre: id, projetId, statut: 'À faire', priorite: null, echeance: null, duree: null, derniereFois: null, ...extra });
const choisir = (projets, taches, ctx = {}) => classer(candidats(projets, taches), { aujourdhui: AUJ, ...ctx });

test('une échéance proche passe avant une priorité haute', () => {
  const cl = choisir(
    [projet('A', { priorite: 'Haute' }), projet('B')],
    [tache('t-a', 'A'), tache('t-b', 'B', { echeance: '2026-11-09' })],
  );
  assert.strictEqual(cl[0].id, 't-b');
  assert.match(cl[0].raisons[0], /Échéance dans 2 jours/);
});

test('exemple chiffré : examen dans 5 jours, priorité haute, jamais révisé, 240 min d’objectif un mercredi', () => {
  // échéance 0,7 × 40 = 28 ; retard (240 × 3/7 − 0) ÷ 240 = 3/7 → 3/7 × 20 ≈ 8,6 ; ancienneté 1 × 20 ; priorité 1 × 20 → 76,6
  const mercredi = '2026-11-04';
  const p = projet('exam', { priorite: 'Haute', echeance: '2026-11-09', objectifHebdo: 240, derniereActivite: null });
  const [c] = classer(candidats([p], [tache('t', 'exam')]), { aujourdhui: mercredi, semaine: new Map() });
  assert.strictEqual(c.score, 77);
  assert.deepStrictEqual(c.raisons, ['Échéance dans 5 jours', '0 min sur 4 h cette semaine', 'Pas encore travaillé', 'Priorité haute']);
});

test('la tâche hérite du projet : échéance la plus proche, priorité, dernière activité', () => {
  const [c] = choisir([projet('P', { priorite: 'Haute', echeance: '2026-11-10', derniereActivite: '2026-10-20' })], [tache('t', 'P', { echeance: '2026-11-20', priorite: 'Basse' })]);
  assert.strictEqual(c.echeance, '2026-11-10'); // la plus proche des deux
  assert.strictEqual(c.priorite, 'Basse'); // celle de la tâche l'emporte
  assert.match(c.raisons.join('|'), /Pas touché depuis 18 jours/);
});

test('seuls les projets « En cours » comptent ; les tâches faites ou d’un projet en pause sont ignorées', () => {
  const cl = choisir(
    [projet('actif'), projet('pause', { statut: 'En pause' }), projet('idee', { statut: 'Idée' }), projet('fini', { statut: 'Terminé' }), projet('vide', { statut: null })],
    [tache('ok', 'actif'), tache('dans-pause', 'pause'), tache('fait', 'actif', { statut: 'Fait' }), tache('hors-projet', null), tache('projet-inconnu', 'fantome')],
  );
  assert.deepStrictEqual(cl.map((c) => c.id).sort(), ['hors-projet', 'ok'].sort());
});

test('un projet en cours sans tâche est proposé avec sa prochaine étape', () => {
  const cl = choisir([projet('Taotl', { prochaineEtape: 'finir les animations' }), projet('Vlog')], []);
  const titres = Object.fromEntries(cl.map((c) => [c.projet.id, c.titre]));
  assert.strictEqual(titres.Taotl, 'finir les animations');
  assert.strictEqual(titres.Vlog, 'Avancer sur Vlog');
  assert.ok(cl.every((c) => c.type === 'projet' && c.id.startsWith('projet:')));
  // un projet qui a une tâche ouverte n'apparaît pas en plus
  assert.strictEqual(choisir([projet('Taotl', { prochaineEtape: 'x' })], [tache('t', 'Taotl')]).length, 1);
});

test('retard hebdo : compté seulement quand le temps de la semaine est connu', () => {
  const p = projet('G', { objectifHebdo: 210, derniereActivite: AUJ }); // samedi : attendu 6/7 = 180 min
  const sans = choisir([p], [tache('t', 'G')]);
  const avec = choisir([p], [tache('t', 'G')], { semaine: new Map([['G', 30]]) });
  assert.strictEqual(sans[0].score, 0);
  assert.ok(avec[0].score > 10); // retard (180−30)/210 × 20 ≈ 14
  assert.match(avec[0].raisons[0], /30 min sur 3 h 30 cette semaine/);
});

test('« Autre chose » préfère un autre projet, puis tourne en rond sans planter', () => {
  const projets = [projet('A', { priorite: 'Haute' }), projet('B', { priorite: 'Moyenne' })];
  const taches = [tache('a1', 'A'), tache('a2', 'A'), tache('b1', 'B'), tache('libre', null)];
  const cl = choisir(projets, taches);
  const p1 = proposer(cl, []);
  assert.strictEqual(p1.action.id, 'a1');
  const p2 = proposer(cl, ['a1']);
  assert.notStrictEqual(p2.action.projet?.id, 'A'); // pas a2 : on change de projet
  const p3 = proposer(cl, ['a1', p2.action.id]);
  assert.notStrictEqual(p3.action.projet?.id, 'A');
  assert.notStrictEqual(p3.action.id, p2.action.id);
  // tout refusé : retour au premier, avec « toutVu »
  const fin = proposer(cl, cl.map((c) => c.id));
  assert.strictEqual(fin.action.id, cl[0].id);
  assert.strictEqual(fin.toutVu, true);
  // rien du tout
  assert.deepStrictEqual(proposer([], []), { action: null, restantes: 0, toutVu: false });
});

test('égalité de score : échéance la plus proche, puis ordre de création', () => {
  const cl = choisir([], [tache('z', null), tache('a', null)]);
  assert.deepStrictEqual(cl.map((c) => c.id), ['z', 'a']); // même score : l'ordre de Notion est gardé
});

test('données de démo : valides pour le choix', () => {
  const d = demo(AUJ);
  const cl = classer(candidats(d.projets, d.taches), { aujourdhui: AUJ });
  assert.ok(cl.length >= 5);
  assert.ok(!cl.some((c) => c.id === 't9')); // tâche d'un projet en pause
  assert.strictEqual(cl[0].id, 't3'); // l'examen dans 6 jours, priorité haute
});

// --- Notion (faux fetch) : lecture seule -----------------------------------------------------
const PAGE = '26c33363-9d2b-482c-b4ac-344522c31bf3';
const BASE_PROJETS = 'd5d82250-5a73-4f9b-a4f0-679c73ad9d75';
const BASE_TACHES = '77f8a7d3-8bdd-4652-8f5d-bb9b999da190';
const BASE_SESSIONS = '9bdd49bb-b595-41e0-b796-c6031688ce76';
const txt = (type, s) => ({ type, [type]: s ? [{ plain_text: s }] : [] });
const sel = (n) => ({ type: 'select', select: n ? { name: n } : null });
const date = (d) => ({ type: 'date', date: d ? { start: d } : null });
const nb = (n) => ({ type: 'number', number: n });


// Schémas de base (réponse de GET /databases/…) : celui créé par BOSSE !, et ceux des anciennes bases du prototype Open Space.
const prop = (type, extra = {}) => ({ type, ...extra });
const statutsOptions = (...noms) => ({ select: { options: noms.map((name) => ({ name })) } });
const SCHEMA_TACHES = { properties: { 'Tâche': prop('title'), Projet: prop('relation'), Statut: prop('select', statutsOptions('À faire', 'Fait')), 'Priorité': prop('select'), 'Échéance': prop('date'), 'Durée estimée (min)': prop('number'), Notes: prop('rich_text'), 'Temps passé (min)': prop('number'), 'Dernière fois': prop('date') } };
const SCHEMA_SESSIONS = { properties: { Titre: prop('title'), 'Début': prop('date'), 'Durée (min)': prop('number'), 'Tâche': prop('relation'), Projet: prop('relation'), Bilan: prop('rich_text'), 'Prochaine étape': prop('rich_text'), Origine: prop('select') } };
const SCHEMA_MUSIQUE = { properties: { Titre: prop('title'), 'Lien YouTube': prop('url'), 'Désactivé': prop('checkbox') } };
const ANCIEN_TACHES = { properties: { Nom: prop('title'), 'Estimation (min)': prop('number'), 'Priorité': prop('select'), Projet: prop('relation'), Statut: prop('select', statutsOptions('À faire', 'En cours', 'Fait', 'Bloquée')), 'Terminée le': prop('date'), 'Échéance': prop('date') } };
const ANCIEN_SESSIONS = { properties: { Nom: prop('title'), 'Début': prop('date'), Fin: prop('date'), 'Durée (min)': prop('number'), Note: prop('rich_text'), 'Pause (min)': prop('number'), 'Pause depuis': prop('date'), Projet: prop('relation'), Source: prop('select'), 'Tâches faites': prop('relation') } };

function fauxNotion() {
  const appels = [];
  const reponses = {
    [`GET /databases/${BASE_PROJETS}`]: { id: BASE_PROJETS, parent: { type: 'page_id', page_id: PAGE } },
    [`GET /databases/${BASE_TACHES}`]: SCHEMA_TACHES,
    [`GET /databases/${BASE_SESSIONS}`]: SCHEMA_SESSIONS,
    [`GET /blocks/${PAGE}/children?page_size=100`]: { results: [
      { type: 'child_database', id: BASE_SESSIONS, child_database: { title: 'Sessions de travail' } },
      { type: 'child_database', id: BASE_TACHES, child_database: { title: 'Tâches' } },
    ], next_cursor: null },
    [`POST /databases/${BASE_PROJETS}/query`]: { results: [
      { id: 'p1', url: 'https://notion/p1', properties: { Nom: txt('title', 'Taotl'), Statut: sel('En cours'), 'Catégorie': sel('Autre'), 'Priorité': sel(null), Couleur: sel('Vert'),
        'Échéance': date(null), 'Prochaine étape': txt('rich_text', 'finir les animation'), 'Dernière activité': date('2026-10-16'), 'Temps cumulé (min)': nb(207),
        'Objectif de temps hebdo (min)': nb(null), Logo: { type: 'files', files: [{ name: 'l.png', type: 'file', file: { url: 'https://s3/l.png' } }] }, 'Icône': txt('rich_text', '') } },
      { id: 'p2', url: 'https://notion/p2', properties: { Nom: txt('title', 'Kalooflix'), Statut: sel(null), Logo: { type: 'files', files: [] } } },
    ], next_cursor: null },
    [`POST /databases/${BASE_TACHES}/query`]: { results: [
      { id: 't1', url: 'https://notion/t1', properties: { 'Tâche': txt('title', 'Inception'), Projet: { type: 'relation', relation: [{ id: 'p1' }] }, Statut: sel(null), 'Priorité': sel('Haute'),
        'Échéance': date('2026-11-20T10:00:00.000+01:00'), 'Durée estimée (min)': nb(45), 'Temps passé (min)': nb(null), 'Dernière fois': date(null), Notes: txt('rich_text', 'à voir') } },
    ], next_cursor: null },
    [`POST /databases/${BASE_SESSIONS}/query`]: { results: [
      { id: 's1', properties: { Titre: txt('title', 'Inception · 30 min'), 'Début': date('2026-11-06T18:00:00.000+01:00'), 'Durée (min)': nb(30), 'Tâche': { type: 'relation', relation: [{ id: 't1' }] }, Projet: { type: 'relation', relation: [{ id: 'p1' }] }, Bilan: txt('rich_text', 'ok') } },
      { id: 's2', properties: { Titre: txt('title', 'sans date'), 'Début': date(null), 'Durée (min)': nb(10) } },
    ], next_cursor: null },
  };
  const original = global.fetch;
  global.fetch = async (url, options = {}) => {
    const chemin = String(url).replace('https://api.notion.com/v1', '');
    const cle = `${options.method || 'GET'} ${chemin}`;
    appels.push({ cle, body: options.body && JSON.parse(options.body) });
    const data = reponses[cle];
    return { ok: !!data, status: data ? 200 : 404, headers: { get: () => null }, json: async () => data || { message: `inattendu : ${cle}` } };
  };
  return { appels, restaurer: () => { global.fetch = original; } };
}

test('Notion : lecture des projets, des tâches et des séances, sans aucune écriture', async () => {
  process.env.NOTION_TOKEN = 'secret-test';
  process.env.NOTION_BASE_PROJETS = BASE_PROJETS;
  notion.oublier();
  const faux = fauxNotion();
  try {
    const { projets, taches, sessions } = await notion.lireTout();
    assert.deepStrictEqual(projets[0], {
      id: 'p1', nom: 'Taotl', type: 'Projet', statut: 'En cours', categorie: 'Autre', priorite: null, couleur: 'Vert', hex: '#5be37d', echeance: null,
      prochaineEtape: 'finir les animation', derniereActivite: '2026-10-16', tempsCumule: 207, objectifHebdo: null, logo: true, logoLien: '', icone: '', resume: '', url: 'https://notion/p1',
    });
    assert.strictEqual(projets[1].statut, null); // Kalooflix : statut vide
    assert.strictEqual(projets[1].logo, false);
    assert.deepStrictEqual(taches[0], {
      id: 't1', titre: 'Inception', projetId: 'p1', statut: 'À faire', priorite: 'Haute', echeance: '2026-11-20', duree: 45, tempsPasse: 0, derniereFois: null, notes: 'à voir', url: 'https://notion/t1',
    });
    // Séances : celle sans date est ignorée ; la date garde l'heure.
    assert.deepStrictEqual(sessions, [{ id: 's1', debut: '2026-11-06T18:00:00.000+01:00', duree: 30, tacheId: 't1', projetId: 'p1', titre: 'Inception · 30 min', bilan: 'ok', origine: null, fin: null }]);
    // La base « Tâches » est retrouvée par son titre, dans la page qui contient « Mes projets ».
    assert.ok(faux.appels.some((a) => a.cle === `GET /blocks/${PAGE}/children?page_size=100`));
    // Tâches déjà faites exclues côté Notion.
    assert.deepStrictEqual(faux.appels.find((a) => a.cle === `POST /databases/${BASE_TACHES}/query`).body.filter, { property: 'Statut', select: { does_not_equal: 'Fait' } });
    // Lecture seule ici : seules des requêtes GET et des « query » (POST) partent.
    for (const a of faux.appels) assert.ok(a.cle.startsWith('GET ') || /^POST \/databases\/[\w-]+\/query$/.test(a.cle), `requête inattendue : ${a.cle}`);
  } finally {
    faux.restaurer();
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_BASE_PROJETS;
    notion.oublier();
  }
});

test('Notion : messages d’erreur clairs (variable manquante, base introuvable)', async () => {
  process.env.NOTION_TOKEN = 'secret-test';
  notion.oublier();
  try {
    await assert.rejects(notion.lireTout(), /NOTION_BASE_PROJETS manquant/);
    process.env.NOTION_BASE_PROJETS = '00000000000000000000000000000000';
    const faux = fauxNotion();
    try {
      await assert.rejects(notion.lireTout(), /pas celui de la source de données/);
    } finally {
      faux.restaurer();
    }
  } finally {
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_BASE_PROJETS;
    notion.oublier();
  }
});

// --- HTTP (mode démo) ----------------------------------------------------------------------------
let serveur, base, cookie;
test.before(() => new Promise((ok) => {
  serveur = app.listen(0, () => {
    base = `http://localhost:${serveur.address().port}`;
    ok();
  });
}));
test.after(() => serveur.close());

const appeler = (chemin, options = {}) => fetch(base + chemin, { ...options, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }), ...options.headers }, body: options.body && JSON.stringify(options.body) });

test('mot de passe : refus sans cookie, refus si faux, accès avec le bon', async () => {
  assert.strictEqual((await appeler('/api/maintenant')).status, 401);
  assert.strictEqual((await appeler('/api/projets')).status, 401);
  assert.strictEqual((await appeler('/api/etat')).status, 200); // seul /api/etat est public
  const mauvais = await appeler('/api/connexion', { method: 'POST', body: { motDePasse: 'faux' } });
  assert.strictEqual(mauvais.status, 401);
  const bon = await appeler('/api/connexion', { method: 'POST', body: { motDePasse: 'mot-de-passe-test' } });
  assert.strictEqual(bon.status, 200);
  const set = bon.headers.get('set-cookie');
  assert.match(set, /^bosse=[a-f0-9]{64}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax/);
  cookie = set.split(';')[0];
  assert.strictEqual((await appeler('/api/maintenant')).status, 200);
});

test('/api/etat : mode démo', async () => {
  const e = await (await appeler('/api/etat')).json();
  assert.deepStrictEqual(e, { mode: 'demo', motDePasse: true });
});

test('/api/maintenant : une action avec ses raisons, et « Autre chose » en change', async () => {
  const d = await (await appeler('/api/maintenant')).json();
  assert.ok(d.action.titre && d.action.raison);
  assert.strictEqual(d.action.id, 't3'); // examen proche
  assert.ok(d.action.projet.hex.startsWith('#'));
  assert.ok(d.total >= 5 && d.classement.length === 5);
  const d2 = await (await appeler(`/api/maintenant?exclus=${d.action.id}`)).json();
  assert.notStrictEqual(d2.action.id, d.action.id);
  assert.notStrictEqual(d2.action.projet?.id, d.action.projet.id);
  // tout refusé : retour au premier
  const tous = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 'projet:p-taotl', 'projet:p-vlog', 'projet:p-lire']; // les 11 choix de la démo
  assert.strictEqual(d.total, tous.length);
  const d3 = await (await appeler(`/api/maintenant?exclus=${encodeURIComponent(tous.join(','))}`)).json();
  assert.strictEqual(d3.toutVu, true);
  assert.strictEqual(d3.action.id, d.action.id);
});

test('/api/projets et /api/taches', async () => {
  const projets = await (await appeler('/api/projets')).json();
  assert.ok(projets.every((p) => p.hex && typeof p.tachesOuvertes === 'number'));
  assert.ok(!projets.some((p) => p.nom === 'Projet en pause')); // seuls les projets en cours
  assert.strictEqual(projets.find((p) => p.nom === 'Gorgée').tachesOuvertes, 3);
  const taches = await (await appeler('/api/taches')).json();
  assert.ok(taches.some((t) => t.projet === null && t.titre === 'Ranger le bureau')); // to-do hors projet
  assert.strictEqual(taches.find((t) => t.id === 't9').projetActif, false);
  assert.ok(taches.every((t) => t.duree === 30));
});

test('/api/logo et /api/notion/rafraichir : inutiles en démo', async () => {
  assert.strictEqual((await appeler('/api/logo/p-42')).status, 404);
  const r = await appeler('/api/notion/rafraichir', { method: 'POST' });
  assert.strictEqual(r.status, 400);
});

test('l’appli installable : manifeste, service worker, page', async () => {
  const m = await (await fetch(base + '/manifest.json')).json();
  assert.strictEqual(m.name, 'BOSSE !');
  assert.strictEqual(m.display, 'standalone');
  assert.strictEqual((await fetch(base + '/sw.js')).status, 200);
  assert.strictEqual((await fetch(base + '/icons/icon-192.png')).status, 200);
  assert.match(await (await fetch(base + '/')).text(), /<title>BOSSE !<\/title>/);
});

// ==========================================================================================
// Étape 1b : chrono, bilan, séances, écritures Notion
// ==========================================================================================

// --- Le compte à rebours (machine à états, heures passées en paramètre) ---------------------
const MIN = 60e3;
test('chrono : temps travaillé = fin − début − pauses', () => {
  const t0 = 1_000_000;
  const candidat = { id: 't', type: 'tache', titre: 'x', tacheId: 't', projetId: null, projet: null };
  let s = chrono.demarrer(candidat, 25, t0);
  assert.strictEqual(s.dureePrevueMs, 25 * MIN);
  assert.strictEqual(chrono.ecoule(s, t0 + 10 * MIN), 10 * MIN);
  s = chrono.pause(s, t0 + 10 * MIN);
  assert.strictEqual(chrono.ecoule(s, t0 + 30 * MIN), 10 * MIN); // en pause : le temps ne court plus
  s = chrono.reprendre(s, t0 + 30 * MIN); // 20 min de pause
  assert.strictEqual(chrono.ecoule(s, t0 + 35 * MIN), 15 * MIN);
  s = chrono.ajouter(s, 10);
  assert.strictEqual(s.dureePrevueMs, 35 * MIN);
  s = chrono.terminer(s, t0 + 40 * MIN);
  assert.strictEqual(s.etat, 'fini');
  assert.strictEqual(chrono.ecoule(s, t0 + 999 * MIN), 20 * MIN); // figé après la fin
  assert.strictEqual(chrono.minutes(chrono.ecoule(s, 0)), 20);
  assert.strictEqual(chrono.terminer(s, t0 + 50 * MIN), s); // terminer deux fois ne change rien
});

test('chrono : terminer pendant une pause ne compte pas la pause ; transitions interdites refusées', () => {
  const t0 = 5_000;
  let s = chrono.demarrer({}, 30, t0);
  s = chrono.pause(s, t0 + 5 * MIN);
  s = chrono.terminer(s, t0 + 20 * MIN);
  assert.strictEqual(chrono.ecoule(s, 0), 5 * MIN);
  assert.throws(() => chrono.pause(s, 0), /pas en cours/);
  assert.throws(() => chrono.reprendre(s, 0), /pas en pause/);
  assert.throws(() => chrono.ajouter(s, 10), /terminé/);
  assert.throws(() => chrono.demarrer({}, 0, 0), /Durée/);
  assert.throws(() => chrono.demarrer({}, 999, 0), /Durée/);
  assert.strictEqual(chrono.minutes(20_000), 1); // quelques secondes comptent pour 1 minute
  assert.strictEqual(chrono.minutes(0), 0);
});

// --- Séances : totaux et effet d'une séance --------------------------------------------------
test('totaux : jour, semaine (lundi → dimanche, heure de Paris), par projet', () => {
  const s = (debut, duree, projetId) => ({ id: debut, debut, duree, projetId });
  const t = totaux([
    s('2026-11-01', 100, 'A'), // dimanche de la semaine d'avant : hors semaine
    s('2026-11-02T08:00:00+01:00', 30, 'A'), // lundi
    s('2026-11-06T23:30:00+01:00', 20, 'B'), // vendredi soir
    s('2026-11-07T00:30:00+01:00', 15, 'A'), // samedi, passé minuit à Paris : aujourd'hui
    s('2026-11-07', 45, null), // aujourd'hui, sans projet
  ], AUJ);
  assert.strictEqual(t.semaine, 110);
  assert.strictEqual(t.jour, 60);
  assert.strictEqual(t.parProjetSemaine.get('A'), 45);
  assert.strictEqual(t.parProjetSemaine.get('B'), 20);
  assert.strictEqual(t.parProjetJour.get('A'), 15);
  assert.strictEqual(t.parProjetJour.has('B'), false);
});

test('une séance met à jour séance, projet et tâche en mémoire', () => {
  const d = { projets: [projet('P', { tempsCumule: 100, derniereActivite: '2026-10-01', prochaineEtape: 'avant' })], taches: [tache('T', 'P')], sessions: [] };
  appliquerSeance(d, { id: 's', debut: '2026-11-07T10:00:00+01:00', fin: '2026-11-07T10:30:00+01:00', duree: 30, tacheId: 'T', projetId: 'P', titre: 'T', type: 'tache', prochaineEtape: 'après', termine: true });
  assert.strictEqual(d.sessions.length, 1);
  assert.strictEqual(d.projets[0].tempsCumule, 130);
  assert.strictEqual(d.projets[0].derniereActivite, '2026-11-07');
  assert.strictEqual(d.projets[0].prochaineEtape, 'après');
  assert.strictEqual(d.projets[0].statut, 'En cours'); // « terminé » concerne la tâche, pas le projet
  assert.strictEqual(d.taches[0].statut, 'Fait');
  assert.strictEqual(d.taches[0].tempsPasse, 30);
  // projet proposé sans tâche : « terminé » termine le projet
  appliquerSeance(d, { id: 's2', debut: '2026-11-07', fin: '2026-11-07', duree: 10, tacheId: null, projetId: 'P', titre: 'x', type: 'projet', termine: true });
  assert.strictEqual(d.projets[0].statut, 'Terminé');
});

// --- Choix : ajustements ---------------------------------------------------------------------
test('objectif de la semaine atteint : −50 ; déjà une heure aujourd’hui : −20 (sauf échéance dépassée)', () => {
  const p = projet('G', { objectifHebdo: 120, derniereActivite: '2026-10-01', priorite: 'Haute' });
  const base = choisir([p], [tache('t', 'G')], { semaine: new Map([['G', 0]]) })[0].score;
  const atteint = choisir([p], [tache('t', 'G')], { semaine: new Map([['G', 120]]) })[0];
  assert.ok(base - atteint.score >= 50, `${base} → ${atteint.score}`);
  assert.ok(atteint.raisons.includes('Objectif de la semaine atteint'));
  const sans = choisir([p], [tache('t', 'G')], { semaine: new Map([['G', 0]]), jour: new Map() })[0].score;
  const deja = choisir([p], [tache('t', 'G')], { semaine: new Map([['G', 0]]), jour: new Map([['G', 60]]) })[0];
  assert.strictEqual(sans - deja.score, 20);
  assert.ok(deja.raisons.includes('Déjà 1 h aujourd’hui'));
  const enRetard = projet('E', { echeance: '2026-11-01', objectifHebdo: 120 });
  const a = choisir([enRetard], [tache('t', 'E')], { semaine: new Map(), jour: new Map() })[0].score;
  const b = choisir([enRetard], [tache('t', 'E')], { semaine: new Map(), jour: new Map([['E', 90]]) })[0].score;
  assert.strictEqual(a, b); // échéance dépassée : pas de malus
});

// --- Notion : écritures (faux fetch), uniquement les champs prévus ------------------------------
const BASE_MUSIQUE = '0e611578-86d3-411b-9cf5-61b2c28b7bd6';
const IDS = { projets: BASE_PROJETS, taches: BASE_TACHES, sessions: BASE_SESSIONS, musique: BASE_MUSIQUE };
function fauxApi(gerer, { schemas = {} } = {}) {
  const appels = [];
  const original = global.fetch;
  const defauts = { [BASE_TACHES]: SCHEMA_TACHES, [BASE_SESSIONS]: SCHEMA_SESSIONS, [BASE_MUSIQUE]: SCHEMA_MUSIQUE, ...schemas };
  global.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('https://api.notion.com/')) return original(url, options); // le reste (nos propres requêtes vers le serveur de test) passe normalement
    const chemin = String(url).replace('https://api.notion.com/v1', '');
    const corps = options.body && JSON.parse(options.body);
    const cle = `${options.method || 'GET'} ${chemin}`;
    const schema = !options.method || options.method === 'GET' ? defauts[chemin.replace('/databases/', '')] : null;
    if (schema && chemin.startsWith('/databases/')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => schema }; // lecture du schéma : pas comptée
    appels.push({ cle, body: corps });
    const r = gerer(cle, corps) ?? { status: 404, data: { message: `inattendu : ${cle}` } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, headers: { get: () => null }, json: async () => r.data ?? r };
  };
  return { appels, restaurer: () => { global.fetch = original; } };
}
const avecNotion = async (fonction) => {
  const avant = { token: process.env.NOTION_TOKEN };
  process.env.NOTION_TOKEN = 'secret-test';
  process.env.NOTION_BASE_PROJETS = IDS.projets;
  process.env.NOTION_BASE_TACHES = IDS.taches;
  process.env.NOTION_BASE_SESSIONS = IDS.sessions;
  process.env.NOTION_BASE_MUSIQUE = IDS.musique;
  notion.oublier();
  try {
    await fonction();
  } finally {
    delete process.env.NOTION_BASE_TACHES;
    delete process.env.NOTION_BASE_SESSIONS;
    delete process.env.NOTION_BASE_MUSIQUE;
    delete process.env.NOTION_BASE_PROJETS;
    if (avant.token === undefined) delete process.env.NOTION_TOKEN;
    notion.oublier();
    fs.rmSync(path.join(process.env.DOSSIER_DONNEES, 'attente.json'), { force: true });
  }
};
const cles = (o) => Object.keys(o).sort();

const SEANCE = { id: 'seance-1', debut: '2026-11-07T10:00:00+01:00', fin: '2026-11-07T10:30:00+01:00', duree: 30, tacheId: 't1', projetId: 'p1', titre: 'Inception', type: 'tache', bilan: 'Fait la moitié', prochaineEtape: 'Finir la partie 2', termine: true };
const versNotion = { creerSession: notion.creerSession, majProjet: notion.majProjet, majTache: notion.majTache };

function notionComplet(options = {}) {
  let sessions = 0;
  return fauxApi((cle, body) => {
    if (cle === 'POST /pages' && body.parent.database_id === IDS.sessions) return { id: `sess-${++sessions}`, properties: {} };
    if (cle === 'GET /pages/p1') return { properties: { 'Temps cumulé (min)': nb(207) } };
    if (cle === 'GET /pages/t1') return { properties: { 'Temps passé (min)': nb(null) } };
    if (cle === 'PATCH /pages/p1') return options.echecProjet?.() ? { status: 400, data: { message: 'boom' } } : { properties: {} };
    if (cle === 'PATCH /pages/t1') return { properties: {} };
    return null;
  });
}

test('Notion : une séance n’écrit que les champs prévus, avec les bonnes valeurs', async () => {
  await avecNotion(async () => {
    const faux = notionComplet();
    try {
      synchro.enfiler(SEANCE);
      await synchro.traiter(versNotion);
      assert.deepStrictEqual(synchro.etat().attente, 0);
      const ecritures = faux.appels.filter((a) => !a.cle.startsWith('GET '));
      assert.strictEqual(ecritures.length, 3); // une séance, un projet, une tâche : rien d'autre

      const session = ecritures[0];
      assert.strictEqual(session.cle, 'POST /pages');
      assert.strictEqual(session.body.parent.database_id, IDS.sessions);
      assert.deepStrictEqual(cles(session.body.properties), ['Bilan', 'Durée (min)', 'Début', 'Origine', 'Projet', 'Prochaine étape', 'Titre', 'Tâche'].sort());
      assert.strictEqual(session.body.properties['Durée (min)'].number, 30);
      assert.strictEqual(session.body.properties['Début'].date.start, '2026-11-07T10:00:00+01:00');
      assert.deepStrictEqual(session.body.properties['Tâche'].relation, [{ id: 't1' }]);
      assert.deepStrictEqual(session.body.properties.Projet.relation, [{ id: 'p1' }]);
      assert.strictEqual(session.body.properties.Origine.select.name, 'Chrono');

      const projetMaj = ecritures[1];
      assert.strictEqual(projetMaj.cle, 'PATCH /pages/p1');
      assert.deepStrictEqual(cles(projetMaj.body.properties), ['Dernière activité', 'Prochaine étape', 'Temps cumulé (min)']); // pas de Statut : c'est la tâche qui est terminée
      assert.strictEqual(projetMaj.body.properties['Temps cumulé (min)'].number, 237); // 207 + 30
      assert.strictEqual(projetMaj.body.properties['Dernière activité'].date.start, '2026-11-07');

      const tacheMaj = ecritures[2];
      assert.strictEqual(tacheMaj.cle, 'PATCH /pages/t1');
      assert.deepStrictEqual(cles(tacheMaj.body.properties), ['Dernière fois', 'Statut', 'Temps passé (min)']);
      assert.strictEqual(tacheMaj.body.properties['Temps passé (min)'].number, 30);
      assert.strictEqual(tacheMaj.body.properties.Statut.select.name, 'Fait');
    } finally {
      faux.restaurer();
    }
  });
});

test('Notion : sans prochaine étape ni « terminé », ces champs ne sont pas touchés ; projet terminé = Statut du projet', async () => {
  await avecNotion(async () => {
    const faux = notionComplet();
    try {
      synchro.enfiler({ ...SEANCE, id: 'seance-2', prochaineEtape: '', termine: false });
      synchro.enfiler({ ...SEANCE, id: 'seance-3', tacheId: null, type: 'projet', prochaineEtape: '', termine: true });
      await synchro.traiter(versNotion);
      const patchs = faux.appels.filter((a) => a.cle.startsWith('PATCH '));
      assert.deepStrictEqual(cles(patchs[0].body.properties), ['Dernière activité', 'Temps cumulé (min)']);
      assert.deepStrictEqual(cles(patchs[1].body.properties), ['Dernière fois', 'Temps passé (min)']);
      assert.deepStrictEqual(cles(patchs[2].body.properties), ['Dernière activité', 'Statut', 'Temps cumulé (min)']); // séance 3 : projet terminé
      assert.strictEqual(patchs[2].body.properties.Statut.select.name, 'Terminé');
      assert.strictEqual(patchs.length, 3); // séance 3 n'a pas de tâche
    } finally {
      faux.restaurer();
    }
  });
});

test('Notion en panne : la séance reste en attente, puis part sans doublon', async () => {
  await avecNotion(async () => {
    let panne = true;
    const faux = notionComplet({ echecProjet: () => panne });
    try {
      synchro.enfiler(SEANCE);
      await synchro.traiter(versNotion);
      assert.deepStrictEqual(synchro.etat().attente, 1);
      assert.match(synchro.etat().erreur, /boom/);
      assert.ok(stockage.lire('attente.json')[0].faits.session, 'la ligne de séance est déjà créée');
      panne = false;
      await synchro.traiter(versNotion);
      assert.strictEqual(synchro.etat().attente, 0);
      assert.strictEqual(synchro.etat().erreur, null);
      // La séance n'a été créée qu'une seule fois, malgré le deuxième essai.
      assert.strictEqual(faux.appels.filter((a) => a.cle === 'POST /pages').length, 1);
      assert.strictEqual(faux.appels.filter((a) => a.cle === 'PATCH /pages/t1').length, 1);
    } finally {
      faux.restaurer();
    }
  });
});

test('Notion : tâche créée dans l’appli, cochée, décochée', async () => {
  await avecNotion(async () => {
    const faux = fauxApi((cle, body) => {
      if (cle === 'POST /pages') return { id: 'nouvelle', url: 'https://notion/nouvelle', properties: {
        'Tâche': txt('title', body.properties['Tâche'].title[0].text.content), Projet: { type: 'relation', relation: body.properties.Projet?.relation || [] },
        Statut: sel('À faire'), 'Priorité': sel(body.properties['Priorité']?.select.name), 'Échéance': date(body.properties['Échéance']?.date.start),
        'Durée estimée (min)': nb(body.properties['Durée estimée (min)'].number),
      } };
      if (cle === 'PATCH /pages/nouvelle') return { properties: {} };
      return null;
    });
    try {
      const t = await notion.creerTache({ titre: 'Appeler la banque', projetId: null, duree: 15, priorite: 'Moyenne', echeance: '2026-11-12' });
      assert.deepStrictEqual(t, { id: 'nouvelle', titre: 'Appeler la banque', projetId: null, statut: 'À faire', priorite: 'Moyenne', echeance: '2026-11-12', duree: 15, tempsPasse: 0, derniereFois: null, notes: '', url: 'https://notion/nouvelle' });
      await notion.statutTache('nouvelle', true);
      await notion.statutTache('nouvelle', false);
      const [creation, fait, defait] = faux.appels;
      assert.strictEqual(creation.body.parent.database_id, IDS.taches);
      assert.deepStrictEqual(cles(creation.body.properties), ['Durée estimée (min)', 'Priorité', 'Statut', 'Tâche', 'Échéance'].sort()); // pas de relation : hors projet
      assert.deepStrictEqual(fait.body, { properties: { Statut: { select: { name: 'Fait' } } } });
      assert.deepStrictEqual(defait.body, { properties: { Statut: { select: { name: 'À faire' } } } });
    } finally {
      faux.restaurer();
    }
  });
});

// --- HTTP : la séance de bout en bout (mode démo) ---------------------------------------------------
const json = async (chemin, options) => {
  const r = await appeler(chemin, options);
  return { status: r.status, corps: await r.json().catch(() => ({})) };
};
const post = (chemin, body) => json(chemin, { method: 'POST', body });

test('séance complète : démarrer, pause, reprendre, +10 min, terminer, bilan', async () => {
  assert.strictEqual((await json('/api/chrono')).corps.chrono, null);
  assert.strictEqual((await post('/api/chrono/pause')).status, 409); // rien en cours
  assert.strictEqual((await post('/api/bilan', { duree: 20 })).status, 409); // pas de séance terminée
  assert.strictEqual((await post('/api/chrono/demarrer', { id: 'inconnu' })).status, 404);
  assert.strictEqual((await post('/api/chrono/demarrer', { id: 't3', duree: 0 })).status, 400);

  const d = await post('/api/chrono/demarrer', { id: 't3', duree: 25 });
  assert.strictEqual(d.status, 200);
  assert.strictEqual(d.corps.chrono.etat, 'en cours');
  assert.strictEqual(d.corps.chrono.dureePrevueMs, 25 * MIN);
  assert.strictEqual(d.corps.chrono.candidat.projet.nom, 'Tronc commun 42');
  assert.strictEqual((await post('/api/chrono/demarrer', { id: 't1' })).status, 409); // un seul chrono à la fois
  assert.strictEqual((await json('/api/maintenant')).corps.chronoEnCours, true);
  // Le chrono est gardé dans un fichier : il survit à un redémarrage du serveur.
  assert.strictEqual(stockage.lire('chrono.json').etat, 'en cours');

  assert.strictEqual((await post('/api/chrono/pause')).corps.chrono.etat, 'pause');
  assert.strictEqual((await post('/api/chrono/pause')).status, 409);
  assert.strictEqual((await post('/api/chrono/reprendre')).corps.chrono.etat, 'en cours');
  assert.strictEqual((await post('/api/chrono/ajouter', { minutes: 10 })).corps.chrono.dureePrevueMs, 35 * MIN);
  assert.strictEqual((await post('/api/bilan', { duree: 20 })).status, 409); // pas encore terminé

  const fini = await post('/api/chrono/terminer');
  assert.strictEqual(fini.corps.chrono.etat, 'fini');
  assert.ok(fini.corps.chrono.minutes >= 1);
  assert.strictEqual((await post('/api/bilan', { duree: 0 })).status, 400);
  assert.strictEqual((await post('/api/bilan', { duree: 601 })).status, 400);

  const avant = (await json('/api/projets')).corps.find((p) => p.nom === 'Tronc commun 42');
  const bilan = await post('/api/bilan', { duree: 40, bilan: 'Parsing terminé', prochaineEtape: 'Gérer les signaux', termine: true });
  assert.strictEqual(bilan.status, 200);
  assert.strictEqual(bilan.corps.duree, 40);
  assert.strictEqual(bilan.corps.totaux.jour, 40);
  assert.ok(bilan.corps.totaux.semaine >= 40);
  assert.strictEqual(bilan.corps.enAttente, false);

  assert.strictEqual((await json('/api/chrono')).corps.chrono, null);
  assert.strictEqual((await post('/api/bilan', { duree: 40 })).status, 409); // pas de deuxième enregistrement
  const apres = (await json('/api/projets')).corps.find((p) => p.nom === 'Tronc commun 42');
  assert.strictEqual(apres.tempsCumule, avant.tempsCumule + 40);
  assert.strictEqual(apres.tempsJour, 40);
  assert.strictEqual(apres.tempsSemaine, avant.tempsSemaine + 40);
  assert.strictEqual(apres.prochaineEtape, 'Gérer les signaux');
  assert.ok(apres.tachesOuvertes < avant.tachesOuvertes); // la tâche est terminée
  assert.ok(!(await json('/api/taches')).corps.some((t) => t.id === 't3'));
  const maintenant = (await json('/api/maintenant')).corps;
  assert.strictEqual(maintenant.totaux.jour, 40);
  assert.notStrictEqual(maintenant.action.id, 't3');
});

test('annuler un chrono ne garde rien', async () => {
  await post('/api/chrono/demarrer', { id: 't1' });
  const avant = (await json('/api/maintenant')).corps.totaux;
  assert.strictEqual((await json('/api/chrono', { method: 'DELETE' })).corps.chrono, null);
  assert.deepStrictEqual((await json('/api/maintenant')).corps.totaux, avant);
  assert.strictEqual((await json('/api/chrono')).corps.chrono, null);
});

test('tâches : ajouter (avec contrôles), cocher, décocher', async () => {
  assert.strictEqual((await post('/api/taches', { titre: '   ' })).status, 400);
  assert.strictEqual((await post('/api/taches', { titre: 'x', projetId: 'fantome' })).status, 400);
  assert.strictEqual((await post('/api/taches', { titre: 'x', projetId: 'p-pause' })).status, 400); // projet pas « En cours »
  assert.strictEqual((await post('/api/taches', { titre: 'x', duree: 2 })).status, 400);
  assert.strictEqual((await post('/api/taches', { titre: 'x', priorite: 'Urgente' })).status, 400);
  assert.strictEqual((await post('/api/taches', { titre: 'x', echeance: '31/12/2026' })).status, 400);

  const ajout = await post('/api/taches', { titre: ' Préparer la soutenance ', projetId: 'p-gorgee', duree: 20, priorite: 'Basse', echeance: '2026-12-01' });
  assert.strictEqual(ajout.status, 201);
  assert.strictEqual(ajout.corps.titre, 'Préparer la soutenance');
  assert.strictEqual(ajout.corps.projet.nom, 'Gorgée');
  assert.strictEqual(ajout.corps.duree, 20);
  const horsProjet = await post('/api/taches', { titre: 'Acheter un câble' });
  assert.strictEqual(horsProjet.corps.projet, null);
  assert.strictEqual(horsProjet.corps.duree, 30); // durée par défaut
  assert.ok((await json('/api/taches')).corps.some((t) => t.id === ajout.corps.id));

  const id = ajout.corps.id;
  assert.strictEqual((await json(`/api/taches/${id}`, { method: 'PATCH', body: { fait: true } })).corps.statut, 'Fait');
  assert.ok(!(await json('/api/taches')).corps.some((t) => t.id === id));
  assert.strictEqual((await json(`/api/taches/${id}`, { method: 'PATCH', body: { fait: false } })).corps.statut, 'À faire');
  assert.ok((await json('/api/taches')).corps.some((t) => t.id === id));
  assert.strictEqual((await json('/api/taches/inconnue', { method: 'PATCH', body: { fait: true } })).status, 404);
  assert.strictEqual((await json(`/api/taches/${id}`, { method: 'PATCH', body: { fait: 'oui' } })).status, 400);
});

test('/api/synchro : rien en attente en démo', async () => {
  const s = (await json('/api/synchro')).corps;
  assert.strictEqual(s.attente, 0);
  assert.strictEqual(s.erreur, null);
});

// ==========================================================================================
// Étape 2 : la radio (bibliothèque de liens YouTube)
// ==========================================================================================
const { analyserLien, entrees: entreesMusique } = require('./musique');

test('liens YouTube : vidéo, playlist, formats courts, liens refusés', () => {
  assert.deepStrictEqual(analyserLien('https://www.youtube.com/watch?v=NVx5ZJCY6w4'), { type: 'video', videoId: 'NVx5ZJCY6w4' });
  assert.deepStrictEqual(analyserLien('https://youtu.be/NVx5ZJCY6w4?si=abc'), { type: 'video', videoId: 'NVx5ZJCY6w4' });
  assert.deepStrictEqual(analyserLien('https://m.youtube.com/watch?pp=xyz&v=O7RnNTXPvvo'), { type: 'video', videoId: 'O7RnNTXPvvo' });
  assert.deepStrictEqual(analyserLien('https://www.youtube.com/playlist?list=PLkiZ51pp3-2b6WJBHrWh5gVJaZg5fcTPI'), { type: 'playlist', playlistId: 'PLkiZ51pp3-2b6WJBHrWh5gVJaZg5fcTPI' });
  assert.deepStrictEqual(analyserLien('https://music.youtube.com/playlist?list=PLxA687tYuMWjyiNm2Sb-kZQZEJTRuGQzD'), { type: 'playlist', playlistId: 'PLxA687tYuMWjyiNm2Sb-kZQZEJTRuGQzD' });
  // vidéo + liste dans le même lien : la vidéo seule est lue
  assert.deepStrictEqual(analyserLien('https://www.youtube.com/watch?v=NVx5ZJCY6w4&list=PLabcdef123'), { type: 'video', videoId: 'NVx5ZJCY6w4' });
  assert.strictEqual(analyserLien('https://exemple.com/watch?v=NVx5ZJCY6w4'), null); // pas YouTube
  assert.strictEqual(analyserLien('https://youtube.com.pirate.test/watch?v=NVx5ZJCY6w4'), null);
  assert.strictEqual(analyserLien('javascript:alert(1)'), null);
  assert.strictEqual(analyserLien('pas un lien'), null);
  assert.strictEqual(analyserLien('https://www.youtube.com/watch?v=<script>'), null);
  assert.strictEqual(analyserLien(''), null);
});

test('bibliothèque : les lignes désactivées et les liens invalides sont écartés', () => {
  const liste = entreesMusique([
    { id: '1', titre: 'Mix A', lien: 'https://www.youtube.com/watch?v=NVx5ZJCY6w4', desactive: false },
    { id: '2', titre: 'Mix B (désactivé)', lien: 'https://www.youtube.com/watch?v=O7RnNTXPvvo', desactive: true },
    { id: '3', titre: 'Lien cassé', lien: 'n’importe quoi', desactive: false },
    { id: '4', titre: '', lien: 'https://www.youtube.com/playlist?list=PLkiZ51pp3-2b6WJBHrWh5gVJaZg5fcTPI', desactive: false },
  ]);
  assert.deepStrictEqual(liste, [
    { id: '1', titre: 'Mix A', type: 'video', videoId: 'NVx5ZJCY6w4' },
    { id: '4', titre: 'Sans titre', type: 'playlist', playlistId: 'PLkiZ51pp3-2b6WJBHrWh5gVJaZg5fcTPI' },
  ]);
});

test('Notion : la base « Musique » est seulement lue', async () => {
  await avecNotion(async () => {
    const faux = fauxApi((cle) => {
      if (cle === `POST /databases/${IDS.musique}/query`) return { results: [
        { id: 'm1', properties: { Titre: txt('title', 'Mix A'), 'Lien YouTube': { type: 'url', url: 'https://www.youtube.com/watch?v=NVx5ZJCY6w4' }, 'Désactivé': { type: 'checkbox', checkbox: false } } },
        { id: 'm2', properties: { Titre: txt('title', 'Mix B'), 'Lien YouTube': { type: 'url', url: null }, 'Désactivé': { type: 'checkbox', checkbox: true } } },
      ], next_cursor: null };
      return null;
    });
    try {
      const lignes = await notion.lireMusique();
      assert.deepStrictEqual(lignes, [
        { id: 'm1', titre: 'Mix A', lien: 'https://www.youtube.com/watch?v=NVx5ZJCY6w4', desactive: false },
        { id: 'm2', titre: 'Mix B', lien: '', desactive: true },
      ]);
      for (const a of faux.appels) assert.ok(/^POST \/databases\/[\w-]+\/query$/.test(a.cle), `requête inattendue : ${a.cle}`);
    } finally {
      faux.restaurer();
    }
  });
});

test('Notion : la base « Musique » est retrouvée par son titre à côté de « Mes projets »', async () => {
  process.env.NOTION_TOKEN = 'secret-test';
  process.env.NOTION_BASE_PROJETS = BASE_PROJETS;
  notion.oublier();
  const faux = fauxApi((cle) => {
    if (cle === `GET /databases/${BASE_PROJETS}`) return { parent: { type: 'page_id', page_id: PAGE } };
    if (cle === `GET /blocks/${PAGE}/children?page_size=100`) return { results: [
      { type: 'child_database', id: BASE_TACHES, child_database: { title: 'Tâches' } },
      { type: 'child_database', id: BASE_SESSIONS, child_database: { title: 'Sessions de travail' } },
      { type: 'child_database', id: BASE_MUSIQUE, child_database: { title: 'Musique' } },
    ], next_cursor: null };
    if (cle === `POST /databases/${BASE_MUSIQUE}/query`) return { results: [], next_cursor: null };
    return null;
  });
  try {
    assert.deepStrictEqual(await notion.lireMusique(), []);
    assert.ok(faux.appels.some((a) => a.cle === `POST /databases/${BASE_MUSIQUE}/query`));
  } finally {
    faux.restaurer();
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_BASE_PROJETS;
    notion.oublier();
  }
});

test('/api/musique : bibliothèque de démonstration, protégée par le mot de passe', async () => {
  const sansCookie = await fetch(base + '/api/musique');
  assert.strictEqual(sansCookie.status, 401);
  const { status, corps } = await json('/api/musique');
  assert.strictEqual(status, 200);
  assert.ok(corps.entrees.length >= 3);
  assert.ok(corps.entrees.every((e) => e.id && e.titre && (e.videoId || e.playlistId)));
  assert.ok(corps.entrees.some((e) => e.type === 'playlist'));
});

test('la page charge la radio avant l’appli', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.ok(html.indexOf('radio.js') > 0 && html.indexOf('radio.js') < html.indexOf('app.js'));
  assert.match(html, /id="lecteur-yt"/);
  assert.strictEqual((await fetch(base + '/radio.js')).status, 200);
});

// ==========================================================================================
// Étape 3 : encouragements et résumé de la semaine
// ==========================================================================================
const { construire: encourager } = require('./encouragements');

const base3 = (extra) => ({
  duree: 30, titre: 'Inception', projet: { nom: 'Gorgée', objectifHebdo: 180 }, tacheTerminee: false, projetTermine: false,
  totaux: { jour: 90, semaine: 240 }, projetSemaine: 90, projetsSemaine: [{ nom: 'Gorgée', minutes: 90 }, { nom: 'Taotl', minutes: 150 }], graine: 'seance-1', ...extra,
});

test('encouragement : l’exemple du brief (temps du jour, de la semaine, « dont … sur ft_irc »)', () => {
  const m = encourager(base3({ duree: 30, projet: { nom: 'ft_irc', objectifHebdo: null }, totaux: { jour: 120, semaine: 360 }, projetsSemaine: [{ nom: 'ft_irc', minutes: 180 }, { nom: 'Taotl', minutes: 180 }] }));
  assert.ok(m.lignes.includes('Tu as travaillé 2 h aujourd’hui, 6 h cette semaine, dont 3 h sur ft_irc.'), m.lignes.join(' | '));
});

test('encouragement : « plus que 40 min pour atteindre ton objectif de la semaine sur Gorgée »', () => {
  const m = encourager(base3({ projetSemaine: 140 }));
  assert.ok(m.lignes.includes('Plus que 40 min pour atteindre ton objectif de la semaine sur Gorgée.'), m.lignes.join(' | '));
  assert.strictEqual(m.objectifAtteint, false);
});

test('encouragement : objectif atteint avec cette séance (une seule fois), puis « déjà atteint »', () => {
  const atteint = encourager(base3({ projetSemaine: 180 })); // avant : 150 < 180 → franchi maintenant
  assert.strictEqual(atteint.objectifAtteint, true);
  assert.match(atteint.lignes[0], /Tu as atteint ton objectif de la semaine sur Gorgée \(3 h sur 3 h\)\. Tout le reste est du bonus\./);
  const apres = encourager(base3({ duree: 20, projetSemaine: 200 })); // avant : 180, déjà atteint
  assert.strictEqual(apres.objectifAtteint, false);
  assert.ok(apres.lignes.includes('L’objectif de la semaine sur Gorgée est déjà atteint.'));
});

test('encouragement : première séance du jour, objectif encore loin, tâche terminée, hors projet', () => {
  const premiere = encourager(base3({ totaux: { jour: 30, semaine: 100 } }));
  assert.ok(['Première séance du jour : bravo', 'C’est lancé, bravo', 'Le plus dur est fait'].includes(premiere.titre));
  const loin = encourager(base3({ projetSemaine: 90 })); // reste 1 h 30
  assert.ok(loin.lignes.includes('Objectif Gorgée : il te reste 1 h 30 cette semaine.'), loin.lignes.join(' | '));
  const finie = encourager(base3({ tacheTerminee: true }));
  assert.strictEqual(finie.lignes[0], 'Tâche terminée : Inception.');
  const libre = encourager(base3({ projet: null }));
  assert.ok(libre.lignes.at(-1).includes('dont 1 h 30 sur Gorgée')); // sans projet : le plus travaillé de la semaine
  assert.ok(!libre.lignes.some((l) => l.startsWith('Objectif')));
});

test('encouragement : les variantes de phrase dépendent de la séance, de façon stable', () => {
  const titres = new Set();
  for (let i = 0; i < 12; i++) titres.add(encourager(base3({ graine: `seance-${i}` })).titre);
  assert.ok(titres.size >= 2, 'plusieurs formulations possibles');
  assert.strictEqual(encourager(base3({ graine: 'x' })).titre, encourager(base3({ graine: 'x' })).titre);
});

test('API : le bilan renvoie un message d’encouragement et la semaine par projet', async () => {
  const avant = (await json('/api/maintenant')).corps;
  assert.ok(Array.isArray(avant.projetsSemaine));
  assert.ok(avant.projetsSemaine.every((p) => p.nom && p.hex && typeof p.minutes === 'number'));
  assert.strictEqual((await post('/api/chrono/demarrer', { id: 't1', duree: 20 })).status, 200);
  await post('/api/chrono/terminer');
  const r = await post('/api/bilan', { duree: 15, bilan: '', prochaineEtape: '', termine: false });
  assert.strictEqual(r.status, 200);
  assert.ok(r.corps.message.titre.length > 0);
  assert.ok(r.corps.message.lignes.some((l) => /Tu as travaillé .* aujourd’hui, .* cette semaine/.test(l)));
  const tronc = r.corps.projetsSemaine.find((p) => p.nom === 'Tronc commun 42');
  assert.ok(tronc && tronc.minutes >= 15 && tronc.objectif === 600);
  assert.ok(r.corps.message.lignes.some((l) => l.includes('dont') && l.includes('Tronc commun 42')));
  // Triés du plus travaillé au moins travaillé
  const minutes = r.corps.projetsSemaine.map((p) => p.minutes);
  assert.deepStrictEqual(minutes, [...minutes].sort((a, b) => b - a));
});

// ==========================================================================================
// Étape 4 : la roue
// ==========================================================================================
const { groupes, tirer, POIDS_OBJECTIF_ATTEINT } = require('./choix');

const roue = (projets, taches, ctx = {}) => groupes(choisir(projets, taches, ctx), { aujourdhui: AUJ, ...ctx });

test('roue : un projet en retard a plus de chances, un projet à l’objectif atteint en garde peu', () => {
  // samedi : on attend 6/7 de l'objectif ; tout le monde a travaillé aujourd'hui (ancienneté 0), aucune échéance
  const A = projet('A', { objectifHebdo: 210 }); // fait 30 sur 180 attendus → retard 150/210
  const B = projet('B'); // pas d'objectif
  const C = projet('C', { objectifHebdo: 100 }); // objectif atteint
  const g = roue([A, B, C], [tache('a', 'A'), tache('b', 'B'), tache('c', 'C')], { semaine: new Map([['A', 30], ['C', 100]]) });
  assert.deepStrictEqual(g.map((x) => x.cle), ['A', 'B', 'C']); // du plus probable au moins probable
  assert.ok(Math.abs(g[0].poids - (1 + 4 * (150 / 210))) < 1e-9);
  assert.strictEqual(g[1].poids, 1);
  assert.strictEqual(g[2].poids, POIDS_OBJECTIF_ATTEINT);
  assert.ok(g[0].retard > 0 && g[2].atteint && !g[1].atteint);
  assert.ok(Math.abs(g.reduce((s, x) => s + x.probabilite, 0) - 1) < 1e-9);
});

test('roue : ancienneté et échéance comptent ; une part par projet, tâches libres regroupées', () => {
  const P = projet('P', { derniereActivite: null, echeance: '2026-11-01' }); // jamais travaillé, échéance dépassée
  const g = roue([P, projet('Q')], [tache('p1', 'P'), tache('p2', 'P'), tache('p3', 'P'), tache('l1', null), tache('l2', null)]);
  assert.strictEqual(g.length, 3); // P, Q (sans tâche : proposé lui-même) et « libre »
  const part = (cle) => g.find((x) => x.cle === cle);
  assert.strictEqual(part('P').poids, 1 + 2 * 1 + 2 * 1); // 1 + ancienneté + échéance
  assert.strictEqual(part('P').candidats.length, 3);
  assert.strictEqual(part('libre').projet, null);
  assert.strictEqual(part('libre').candidats.length, 2);
  assert.strictEqual(part('Q').poids, 1);
  // la meilleure tâche du groupe est la première
  assert.deepStrictEqual(part('P').candidats.map((c) => c.score), [...part('P').candidats.map((c) => c.score)].sort((a, b) => b - a));
});

test('roue : sans objectif connu (temps de la semaine inconnu), pas de retard', () => {
  const g = roue([projet('A', { objectifHebdo: 600 })], [tache('a', 'A')]);
  assert.strictEqual(g[0].retard, 0);
  assert.strictEqual(g[0].poids, 1);
});

test('tirage : proportionnel aux poids, reproductible avec un générateur fixe', () => {
  const liste = [{ poids: 3 }, { poids: 1 }, { poids: 0.5 }];
  assert.strictEqual(tirer(liste, () => 0), 0);
  assert.strictEqual(tirer(liste, () => 0.69), 1); // 0,69 × 4,5 = 3,1 : juste après la première part
  assert.strictEqual(tirer(liste, () => 0.999999), 2);
  assert.strictEqual(tirer([], () => 0.5), -1);
  assert.strictEqual(tirer([{ poids: 2 }], () => 0.99), 0);
  // 30 000 tirages avec un générateur congruentiel : les fréquences suivent les probabilités (à 1,5 point près)
  let graine = 42;
  const rng = () => ((graine = (graine * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const compte = [0, 0, 0];
  for (let i = 0; i < 30000; i++) compte[tirer(liste, rng)]++;
  [3, 1, 0.5].forEach((p, i) => assert.ok(Math.abs(compte[i] / 30000 - p / 4.5) < 0.015, `part ${i} : ${compte[i] / 30000}`));
});

test('API roue : parts valides, tirage cohérent, protégé par le mot de passe', async () => {
  assert.strictEqual((await fetch(base + '/api/roue')).status, 401);
  assert.strictEqual((await fetch(base + '/api/roue/tirer', { method: 'POST' })).status, 401);
  const { corps } = await json('/api/roue');
  assert.ok(corps.parts.length >= 2);
  assert.ok(corps.parts.every((p) => p.nom && p.hex.startsWith('#') && p.probabilite > 0 && p.nbChoix >= 1));
  assert.ok(Math.abs(corps.parts.reduce((s, p) => s + p.probabilite, 0) - 1) < 1e-6);
  const vus = new Set();
  for (let i = 0; i < 40; i++) {
    const r = (await post('/api/roue/tirer')).corps;
    assert.ok(Number.isInteger(r.index) && r.index >= 0 && r.index < r.parts.length);
    assert.strictEqual(r.action.projet?.id ?? null, r.parts[r.index].id); // l'action est bien dans le projet tiré
    vus.add(r.index);
  }
  assert.ok(vus.size >= 2, 'le tirage varie');
});

test('séance venue de la roue : origine « Roue » jusque dans Notion', async () => {
  const choisi = (await post('/api/roue/tirer')).corps.action;
  const d = await post('/api/chrono/demarrer', { id: choisi.id, duree: 10, origine: 'roue' });
  assert.strictEqual(d.corps.chrono.candidat.origine, 'Roue');
  await json('/api/chrono', { method: 'DELETE' });
  const normal = await post('/api/chrono/demarrer', { id: choisi.id, duree: 10 });
  assert.strictEqual(normal.corps.chrono.candidat.origine, 'Chrono');
  await json('/api/chrono', { method: 'DELETE' });

  await avecNotion(async () => {
    const faux = fauxApi((cle, corps) => (cle === 'POST /pages' ? { id: 'sess', properties: {} } : null));
    try {
      await notion.creerSession({ ...SEANCE, origine: 'Roue' });
      await notion.creerSession({ ...SEANCE, origine: 'Chrono' });
      await notion.creerSession({ ...SEANCE });
      assert.deepStrictEqual(faux.appels.map((a) => a.body.properties.Origine.select.name), ['Roue', 'Chrono', 'Chrono']);
    } finally {
      faux.restaurer();
    }
  });
});

test('la page contient la roue et son lien dans la navigation', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /id="roue-g"/);
  assert.match(html, /href="#roue"/);
  assert.match(html, /id="tourner"/);
});

// ==========================================================================================
// Étape 6 : activités, enveloppes, découpage en étapes
// ==========================================================================================
const { analyserEtapes, lireDuree } = require('./public/etapes.js');

test('durées écrites à la main : 45, 45 min, 1 h, 1h30, 1,5 h', () => {
  assert.strictEqual(lireDuree('45'), 45);
  assert.strictEqual(lireDuree('45 min'), 45);
  assert.strictEqual(lireDuree('1 h'), 60);
  assert.strictEqual(lireDuree('1h30'), 90);
  assert.strictEqual(lireDuree('1 h 30'), 90);
  assert.strictEqual(lireDuree('1,5 h'), 90);
  assert.strictEqual(lireDuree('2 heures'), 120);
  assert.strictEqual(lireDuree('bientôt'), null);
  assert.strictEqual(lireDuree(''), null);
});

test('découpage : une étape par ligne, puces et numéros ignorés, 30 minutes par défaut', () => {
  const { etapes, total } = analyserEtapes('- Brancher le serveur\n\n  2. Acheter le nom de domaine (15 min)\n* [ ] Tester avec 8 téléphones\r\n[x] Page d’accueil (45 min)');
  assert.deepStrictEqual(etapes, [
    { titre: 'Brancher le serveur', duree: 30 },
    { titre: 'Acheter le nom de domaine', duree: 15 },
    { titre: 'Tester avec 8 téléphones', duree: 30 },
    { titre: 'Page d’accueil', duree: 45 }, // 45 min : pas coupé (seuil : plus de 45)
  ]);
  assert.strictEqual(total, 120);
  assert.deepStrictEqual(analyserEtapes('').etapes, []);
  assert.deepStrictEqual(analyserEtapes('  \n \n').etapes, []);
});

test('découpage : les étapes de plus de 45 min sont coupées en blocs d’environ 30 min (si demandé)', () => {
  const { etapes } = analyserEtapes('Serveur temps réel (2 h)\nDocumentation (1h)\nDomaine (50 min)');
  assert.deepStrictEqual(etapes.map((e) => e.titre), [
    'Serveur temps réel (1/4)', 'Serveur temps réel (2/4)', 'Serveur temps réel (3/4)', 'Serveur temps réel (4/4)',
    'Documentation (1/2)', 'Documentation (2/2)', 'Domaine (1/2)', 'Domaine (2/2)',
  ]);
  assert.deepStrictEqual(etapes.map((e) => e.duree), [30, 30, 30, 30, 30, 30, 25, 25]);
  // sans couper : une seule tâche, avec sa durée
  assert.deepStrictEqual(analyserEtapes('Serveur temps réel (2 h)', { couper: false }).etapes, [{ titre: 'Serveur temps réel', duree: 120 }]);
  // une parenthèse qui n'est pas une durée reste dans le titre ; durée absurde ignorée
  assert.deepStrictEqual(analyserEtapes('Partie (2)\nÉtape (bientôt)\nMini (3 min)').etapes.map((e) => e.titre), ['Partie (2)', 'Étape (bientôt)', 'Mini (3 min)']);
  // plafond : 240 min au maximum, 8 blocs au maximum
  assert.strictEqual(analyserEtapes('Énorme (10 h)').etapes.length, 8);
});

test('activité sans tâche : proposée sous son nom (ou sa prochaine étape)', () => {
  const cl = choisir([projet('Lire', { type: 'Activité' }), projet('Réviser', { type: 'Activité', prochaineEtape: 'Chapitre 3' }), projet('Taotl')], []);
  const titres = Object.fromEntries(cl.map((c) => [c.projet.id, c.titre]));
  assert.strictEqual(titres.Lire, 'Lire'); // pas « Avancer sur Lire »
  assert.strictEqual(titres['Réviser'], 'Chapitre 3');
  assert.strictEqual(titres.Taotl, 'Avancer sur Taotl');
});

test('API : les activités sont distinguées des projets, avec leur enveloppe', async () => {
  const projets = (await json('/api/projets')).corps;
  const lire = projets.find((p) => p.nom === 'Lire');
  assert.strictEqual(lire.type, 'Activité');
  assert.strictEqual(lire.objectifHebdo, 120);
  assert.strictEqual(projets.find((p) => p.nom === 'Gorgée').type, 'Projet');
  const sem = (await json('/api/maintenant')).corps.projetsSemaine.find((p) => p.nom === 'Lire');
  assert.strictEqual(sem.type, 'Activité');
  assert.strictEqual(sem.objectif, 120);
});

test('API : ajouter une activité (avec contrôles)', async () => {
  assert.strictEqual((await post('/api/activites', { nom: '  ' })).status, 400);
  assert.strictEqual((await post('/api/activites', { nom: 'Lire' })).status, 400); // existe déjà
  assert.strictEqual((await post('/api/activites', { nom: 'Dessiner', objectifHebdo: 5 })).status, 400);
  assert.strictEqual((await post('/api/activites', { nom: 'Dessiner', objectifHebdo: 9999 })).status, 400);
  assert.strictEqual((await post('/api/activites', { nom: 'Dessiner', couleur: 'Fuchsia' })).status, 400);
  const ok = await post('/api/activites', { nom: ' Dessiner ', objectifHebdo: 90, couleur: 'Rose' });
  assert.strictEqual(ok.status, 201);
  assert.deepStrictEqual([ok.corps.nom, ok.corps.type, ok.corps.hex], ['Dessiner', 'Activité', '#ff6fb5']);
  const sansEnveloppe = await post('/api/activites', { nom: 'Méditer' });
  assert.strictEqual(sansEnveloppe.status, 201);
  const projets = (await json('/api/projets')).corps;
  assert.strictEqual(projets.find((p) => p.nom === 'Dessiner').objectifHebdo, 90);
  assert.strictEqual(projets.find((p) => p.nom === 'Méditer').objectifHebdo, null);
  // une activité sans tâche devient un choix possible
  const roueParts = (await json('/api/roue')).corps.parts;
  assert.ok(roueParts.some((p) => p.nom === 'Dessiner' && p.type === 'Activité'));
});

test('API : modifier l’objectif de la semaine d’un projet ou d’une activité', async () => {
  const lire = (await json('/api/projets')).corps.find((p) => p.nom === 'Lire');
  assert.strictEqual((await json(`/api/projets/${lire.id}`, { method: 'PATCH', body: { objectifHebdo: 180 } })).corps.objectifHebdo, 180);
  assert.strictEqual((await json('/api/projets')).corps.find((p) => p.nom === 'Lire').objectifHebdo, 180);
  assert.strictEqual((await json(`/api/projets/${lire.id}`, { method: 'PATCH', body: { objectifHebdo: null } })).corps.objectifHebdo, null);
  assert.strictEqual((await json(`/api/projets/${lire.id}`, { method: 'PATCH', body: { objectifHebdo: 0 } })).corps.objectifHebdo, null);
  assert.strictEqual((await json(`/api/projets/${lire.id}`, { method: 'PATCH', body: { objectifHebdo: 7 } })).status, 400);
  assert.strictEqual((await json(`/api/projets/${lire.id}`, { method: 'PATCH', body: { objectifHebdo: 'beaucoup' } })).status, 400);
  assert.strictEqual((await json(`/api/projets/${lire.id}`, { method: 'PATCH', body: {} })).status, 400);
  assert.strictEqual((await json('/api/projets/inconnu', { method: 'PATCH', body: { objectifHebdo: 60 } })).status, 404);
  await json(`/api/projets/${lire.id}`, { method: 'PATCH', body: { objectifHebdo: 120 } }); // remet l'état de départ
});

test('API : découper un chantier crée une tâche par étape, dans l’ordre', async () => {
  assert.strictEqual((await post('/api/taches/lot', { etapes: [] })).status, 400);
  assert.strictEqual((await post('/api/taches/lot', { projetId: 'p-pause', etapes: [{ titre: 'x' }] })).status, 400);
  assert.strictEqual((await post('/api/taches/lot', { etapes: [{ titre: '  ' }] })).status, 400);
  assert.strictEqual((await post('/api/taches/lot', { etapes: [{ titre: 'x', duree: 1 }] })).status, 400);
  assert.strictEqual((await post('/api/taches/lot', { etapes: Array.from({ length: 31 }, (_, i) => ({ titre: `étape ${i}` })) })).status, 400);

  const etapes = analyserEtapes('Brancher le serveur (1 h)\nDomaine (15 min)\nTester').etapes;
  const r = await post('/api/taches/lot', { projetId: 'p-gorgee', etapes });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.corps.creees, 4);
  assert.deepStrictEqual(r.corps.taches.map((t) => [t.titre, t.duree]), [['Brancher le serveur (1/2)', 30], ['Brancher le serveur (2/2)', 30], ['Domaine', 15], ['Tester', 30]]);
  assert.ok(r.corps.taches.every((t) => t.projet.nom === 'Gorgée'));
  const liste = (await json('/api/taches')).corps;
  assert.ok(r.corps.taches.every((t) => liste.some((x) => x.id === t.id)));
  const horsProjet = await post('/api/taches/lot', { etapes: [{ titre: 'Ranger' }] });
  assert.strictEqual(horsProjet.corps.taches[0].projet, null);
});

test('Notion : une activité est créée avec son type, son enveloppe et sa couleur (la propriété « Type » est ajoutée si elle manque)', async () => {
  await avecNotion(async () => {
    let typeExiste = false;
    const faux = fauxApi((cle, corps) => {
      if (cle === `GET /databases/${IDS.projets}`) return { properties: typeExiste ? { Type: {} } : { Nom: {} } };
      if (cle === `PATCH /databases/${IDS.projets}`) { typeExiste = true; return {}; }
      if (cle === 'POST /pages') return { id: 'act', url: 'https://notion/act', properties: {
        Nom: txt('title', corps.properties.Nom.title[0].text.content), Type: sel('Activité'), Statut: sel('En cours'), Couleur: sel(corps.properties.Couleur?.select.name),
        'Objectif de temps hebdo (min)': nb(corps.properties['Objectif de temps hebdo (min)']?.number ?? null) } };
      return null;
    });
    try {
      const a = await notion.creerActivite({ nom: 'Lire', objectifHebdo: 120, couleur: 'Turquoise' });
      assert.deepStrictEqual([a.nom, a.type, a.statut, a.couleur, a.hex, a.objectifHebdo], ['Lire', 'Activité', 'En cours', 'Turquoise', '#2de2d0', 120]);
      const [verif, ajoutType, creation] = faux.appels;
      assert.strictEqual(verif.cle, `GET /databases/${IDS.projets}`);
      assert.deepStrictEqual(ajoutType.body, { properties: { Type: { select: { options: [{ name: 'Projet', color: 'blue' }, { name: 'Activité', color: 'green' }] } } } });
      assert.strictEqual(creation.body.parent.database_id, IDS.projets);
      assert.deepStrictEqual(cles(creation.body.properties), ['Couleur', 'Nom', 'Objectif de temps hebdo (min)', 'Statut', 'Type']);
      assert.strictEqual(creation.body.properties.Statut.select.name, 'En cours');
      // la propriété existe maintenant : une 2e activité ne la recrée pas, et sans enveloppe ni couleur ces champs ne sont pas écrits
      await notion.creerActivite({ nom: 'Réviser', objectifHebdo: null, couleur: null });
      const apres = faux.appels.slice(3);
      assert.strictEqual(apres.filter((x) => x.cle.startsWith('PATCH')).length, 0);
      assert.deepStrictEqual(cles(apres.find((x) => x.cle === 'POST /pages').body.properties), ['Nom', 'Statut', 'Type']);
    } finally {
      faux.restaurer();
    }
  });
});

test('Notion : modifier l’objectif n’écrit que « Objectif de temps hebdo (min) » ; les tâches sont lues dans l’ordre de création', async () => {
  await avecNotion(async () => {
    const faux = fauxApi((cle) => {
      if (cle === 'PATCH /pages/p1') return {};
      if (cle === `POST /databases/${IDS.taches}/query`) return { results: [], next_cursor: null };
      if (cle === `POST /databases/${IDS.projets}/query`) return { results: [{ id: 'p1', properties: { Nom: txt('title', 'Lire'), Type: sel('Activité'), Statut: sel('En cours') } }, { id: 'p2', properties: { Nom: txt('title', 'Taotl'), Statut: sel('En cours') } }], next_cursor: null };
      if (cle === `POST /databases/${IDS.sessions}/query`) return { results: [], next_cursor: null };
      return null;
    });
    try {
      await notion.majObjectif('p1', 150);
      await notion.majObjectif('p1', null);
      assert.deepStrictEqual(faux.appels[0].body, { properties: { 'Objectif de temps hebdo (min)': { number: 150 } } });
      assert.deepStrictEqual(faux.appels[1].body, { properties: { 'Objectif de temps hebdo (min)': { number: null } } });
      const { projets } = await notion.lireTout();
      assert.deepStrictEqual(projets.map((p) => [p.nom, p.type]), [['Lire', 'Activité'], ['Taotl', 'Projet']]); // sans « Type » : Projet
      const requeteTaches = faux.appels.find((a) => a.cle === `POST /databases/${IDS.taches}/query`);
      assert.deepStrictEqual(requeteTaches.body.sorts, [{ timestamp: 'created_time', direction: 'ascending' }]);
    } finally {
      faux.restaurer();
    }
  });
});

test('la page contient la feuille de modification, les écrans séances et musique, le découpage, et charge etapes.js avant l’appli', async () => {
  const html = await (await fetch(base + '/')).text();
  for (const id of ['nouveau-projet', 'filtres-projets', 'form-decoupe', 'decouper-taches', 'd-texte', 'd-apercu', 'feuille', 'feuille-form', 'voir-faites', 'seances-contenu', 'ajouter-seance', 'bibliotheque-contenu', 'ajouter-lien']) assert.match(html, new RegExp(`id="${id}"`));
  assert.ok(html.indexOf('etapes.js') > 0 && html.indexOf('etapes.js') < html.indexOf('app.js'));
  assert.strictEqual((await fetch(base + '/etapes.js')).status, 200);
});

// ==========================================================================================
// Tout modifier dans l'appli : tâches, projets, séances, musique
// ==========================================================================================
const edition = require('./edition');
const refuse = (f, message) => assert.throws(f, (e) => e.status === 400 && message.test(e.message), `doit refuser (${message})`);

test('saisie d’un projet : seuls les champs envoyés, tout est contrôlé', () => {
  assert.deepStrictEqual(edition.champsProjet({ nom: '  Taotl  ', statut: 'En pause', priorite: 'Haute', echeance: '2026-12-01', objectifHebdo: 90, couleur: 'Rose', icone: 'TA', logo: 'https://exemple.fr/logo.png' }, { creation: true }), {
    nom: 'Taotl', statut: 'En pause', priorite: 'Haute', echeance: '2026-12-01', objectifHebdo: 90, couleur: 'Rose', icone: 'TA', logo: 'https://exemple.fr/logo.png',
  });
  assert.deepStrictEqual(edition.champsProjet({ prochaineEtape: 'finir les animations' }), { prochaineEtape: 'finir les animations' }); // le reste n'est pas touché
  assert.deepStrictEqual(edition.champsProjet({ objectifHebdo: null, priorite: '', echeance: null, couleur: null, logo: null, categorie: '' }), { objectifHebdo: null, priorite: null, echeance: null, couleur: null, logo: null, categorie: null }); // vider un champ
  assert.strictEqual(edition.champsProjet({ objectifHebdo: 0 }).objectifHebdo, null);
  refuse(() => edition.champsProjet({}, { creation: true }), /nom/i);
  refuse(() => edition.champsProjet({ nom: '   ' }), /nom/i);
  refuse(() => edition.champsProjet({ nom: 'x'.repeat(101) }), /100 caractères/);
  refuse(() => edition.champsProjet({ type: 'Autre' }), /Type/);
  refuse(() => edition.champsProjet({ statut: 'Fini' }), /Statut/);
  refuse(() => edition.champsProjet({ priorite: 'Urgente' }), /Priorité/);
  refuse(() => edition.champsProjet({ echeance: '12/01/2026' }), /Échéance/);
  refuse(() => edition.champsProjet({ objectifHebdo: 5 }), /de 15 à 3000/);
  refuse(() => edition.champsProjet({ couleur: 'Fuchsia' }), /Couleur/);
  refuse(() => edition.champsProjet({ icone: 'beaucoup trop long' }), /Icône/);
  refuse(() => edition.champsProjet({ logo: 'javascript:alert(1)' }), /Logo/);
  refuse(() => edition.champsProjet({ logo: 'pas un lien' }), /Logo/);
});

test('saisie d’une tâche, d’une séance, d’un lien de musique', () => {
  assert.deepStrictEqual(edition.champsTache({ titre: ' Inception ', projetId: '', duree: 45, priorite: 'Basse', echeance: null, notes: 'à voir', fait: true }), {
    titre: 'Inception', projetId: null, duree: 45, priorite: 'Basse', echeance: null, notes: 'à voir', statut: 'Fait',
  });
  assert.strictEqual(edition.champsTache({ fait: false }).statut, 'À faire');
  refuse(() => edition.champsTache({ titre: ' ' }), /titre/i);
  refuse(() => edition.champsTache({ duree: 2 }), /de 5 à 240/);
  refuse(() => edition.champsTache({ duree: '' }), /Durée/);
  refuse(() => edition.champsTache({ fait: 'oui' }), /fait/);

  assert.deepStrictEqual(edition.champsSeance({ jour: '2026-11-05', duree: 40, bilan: ' ok ' }, AUJ, { creation: true }), { duree: 40, jour: '2026-11-05', bilan: 'ok' });
  assert.deepStrictEqual(edition.champsSeance({ bilan: 'x' }, AUJ), { bilan: 'x' });
  refuse(() => edition.champsSeance({ jour: '2026-11-08', duree: 10 }, AUJ, { creation: true }), /futur/);
  refuse(() => edition.champsSeance({ jour: '2024-01-01', duree: 10 }, AUJ, { creation: true }), /trop ancien/);
  refuse(() => edition.champsSeance({ duree: 10 }, AUJ, { creation: true }), /jour/i);
  refuse(() => edition.champsSeance({ jour: AUJ }, AUJ, { creation: true }), /Durée/);
  refuse(() => edition.champsSeance({ duree: 0 }, AUJ), /de 1 à 600/);

  assert.deepStrictEqual(edition.champsLien({ titre: '', lien: 'https://youtu.be/NVx5ZJCY6w4' }, { creation: true }), { titre: 'Sans titre', lien: 'https://youtu.be/NVx5ZJCY6w4' });
  assert.deepStrictEqual(edition.champsLien({ desactive: true }), { desactive: true });
  refuse(() => edition.champsLien({ titre: 'x', lien: 'https://exemple.com/musique.mp3' }, { creation: true }), /YouTube/);
  refuse(() => edition.champsLien({ titre: 'x' }, { creation: true }), /YouTube/);
  refuse(() => edition.champsLien({ desactive: 'oui' }), /vrai ou faux/);
});

test('API : modifier, rétablir et supprimer une tâche', async () => {
  const ajout = (await post('/api/taches', { titre: 'À corriger', projetId: 'p-gorgee' })).corps;
  const id = ajout.id;
  const m = await json(`/api/taches/${id}`, { method: 'PATCH', body: { titre: ' Corrigée ', projetId: 'p-taotl', duree: 45, priorite: 'Haute', echeance: '2026-12-24', notes: 'une note' } });
  assert.strictEqual(m.status, 200);
  assert.deepStrictEqual([m.corps.titre, m.corps.projet.nom, m.corps.duree, m.corps.priorite, m.corps.echeance, m.corps.notes], ['Corrigée', 'Taotl', 45, 'Haute', '2026-12-24', 'une note']);
  // vider des champs : hors projet, sans priorité ni échéance
  const v = (await json(`/api/taches/${id}`, { method: 'PATCH', body: { projetId: null, priorite: null, echeance: null } })).corps;
  assert.deepStrictEqual([v.projet, v.priorite, v.echeance, v.projetActif], [null, null, null, true]);
  assert.strictEqual((await json(`/api/taches/${id}`, { method: 'PATCH', body: { projetId: 'fantome' } })).status, 400);
  assert.strictEqual((await json(`/api/taches/${id}`, { method: 'PATCH', body: {} })).status, 400);
  assert.strictEqual((await json(`/api/taches/${id}`, { method: 'PATCH', body: { duree: 1 } })).status, 400);
  // terminée, retrouvée dans « Terminées », rétablie
  await json(`/api/taches/${id}`, { method: 'PATCH', body: { fait: true } });
  assert.ok(!(await json('/api/taches')).corps.some((t) => t.id === id));
  const faites = (await json('/api/taches?statut=faites')).corps;
  assert.ok(faites.some((t) => t.id === id && t.statut === 'Fait'));
  await json(`/api/taches/${id}`, { method: 'PATCH', body: { fait: false } });
  assert.ok((await json('/api/taches')).corps.some((t) => t.id === id));
  // supprimer
  assert.strictEqual((await json(`/api/taches/${id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!(await json('/api/taches')).corps.some((t) => t.id === id));
  assert.strictEqual((await json(`/api/taches/${id}`, { method: 'DELETE' })).status, 404);
});

test('API : voir, créer, modifier et supprimer un projet (tous les champs, tous les statuts)', async () => {
  const tous = (await json('/api/projets?tous=1')).corps;
  assert.ok(tous.some((p) => p.nom === 'Projet en pause' && p.statut === 'En pause'));
  assert.ok(!(await json('/api/projets')).corps.some((p) => p.nom === 'Projet en pause')); // sans ?tous : seulement « En cours »
  const options = (await json('/api/options')).corps;
  assert.deepStrictEqual(options.statuts, ['Idée', 'En cours', 'En pause', 'Terminé']);
  assert.ok(options.categories.includes('École 42') && options.couleurs.includes('Turquoise') && options.priorites.length === 3);

  const c = await post('/api/projets', { nom: ' Nouveau projet ', categorie: 'Autre', priorite: 'Moyenne', echeance: '2027-01-15', prochaineEtape: 'Commencer', couleur: 'Bleu', resume: 'Un résumé', objectifHebdo: 60 });
  assert.strictEqual(c.status, 201);
  assert.deepStrictEqual([c.corps.nom, c.corps.type, c.corps.statut, c.corps.categorie, c.corps.objectifHebdo, c.corps.hex, c.corps.resume], ['Nouveau projet', 'Projet', 'En cours', 'Autre', 60, '#4da3ff', 'Un résumé']);
  assert.strictEqual((await post('/api/projets', { nom: 'nouveau PROJET' })).status, 400); // même nom (sans tenir compte des majuscules)
  assert.strictEqual((await post('/api/projets', { nom: '' })).status, 400);

  const id = c.corps.id;
  const m = (await json(`/api/projets/${id}`, { method: 'PATCH', body: { nom: 'Renommé', type: 'Activité', statut: 'En pause', couleur: 'Rose', icone: 'RE', logo: 'https://exemple.fr/l.png', categorie: null, priorite: null } })).corps;
  assert.deepStrictEqual([m.nom, m.type, m.statut, m.hex, m.icone, m.logo, m.logoLien, m.categorie, m.priorite], ['Renommé', 'Activité', 'En pause', '#ff6fb5', 'RE', true, 'https://exemple.fr/l.png', null, null]);
  const sansLogo = (await json(`/api/projets/${id}`, { method: 'PATCH', body: { logo: null } })).corps;
  assert.deepStrictEqual([sansLogo.logo, sansLogo.logoLien], [false, '']);
  assert.ok((await json('/api/projets?tous=1')).corps.some((p) => p.id === id && p.statut === 'En pause'));
  assert.ok(!(await json('/api/projets')).corps.some((p) => p.id === id)); // en pause : plus dans la liste « En cours »
  await json(`/api/projets/${id}`, { method: 'PATCH', body: { statut: 'En cours' } });
  assert.ok((await json('/api/projets')).corps.some((p) => p.id === id));
  assert.strictEqual((await json(`/api/projets/${id}`, { method: 'PATCH', body: { statut: 'Fini' } })).status, 400);
  assert.strictEqual((await json(`/api/projets/${id}`, { method: 'PATCH', body: { logo: 'javascript:alert(1)' } })).status, 400);

  assert.strictEqual((await json(`/api/projets/${id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!(await json('/api/projets?tous=1')).corps.some((p) => p.id === id));
  assert.strictEqual((await json(`/api/projets/${id}`, { method: 'DELETE' })).status, 404);
});

test('API : l’historique des séances, la séance oubliée, les corrections et la suppression ajustent les totaux', async () => {
  const projet = async () => (await json('/api/projets')).corps.find((p) => p.id === 'p-gorgee');
  const avant = await projet();
  const hist = (await json('/api/seances')).corps;
  assert.ok(hist.seances.length >= 1 && hist.seances.every((s) => s.id && s.jour && typeof s.duree === 'number'));

  assert.strictEqual((await post('/api/seances', { projetId: 'p-gorgee', duree: 40 })).status, 400); // pas de jour
  assert.strictEqual((await post('/api/seances', { projetId: 'p-gorgee', duree: 40, jour: ajouterJours(AUJ, 400) })).status, 400); // futur
  assert.strictEqual((await post('/api/seances', { projetId: 'fantome', duree: 40, jour: aujourdhui() })).status, 400);
  assert.strictEqual((await post('/api/seances', { tacheId: 'fantome', duree: 40, jour: aujourdhui() })).status, 400);
  const jour = aujourdhui();
  const ajout = await post('/api/seances', { tacheId: 't4', duree: 40, jour, bilan: 'oubliée' });
  assert.strictEqual(ajout.status, 201);
  assert.strictEqual((await projet()).tempsCumule, avant.tempsCumule + 40); // la tâche t4 est dans Gorgée : le projet suit
  const seance = (await json('/api/seances')).corps.seances.find((s) => s.bilan === 'oubliée');
  assert.deepStrictEqual([seance.duree, seance.jour, seance.projetNom, seance.titre], [40, jour, 'Gorgée', 'Gorgée : finaliser le jeu']);

  const m = await json(`/api/seances/${seance.id}`, { method: 'PATCH', body: { duree: 60, bilan: 'corrigée' } });
  assert.strictEqual(m.status, 200);
  assert.deepStrictEqual([m.corps.duree, m.corps.bilan], [60, 'corrigée']);
  assert.strictEqual((await projet()).tempsCumule, avant.tempsCumule + 60); // +20 de plus
  const veille = ajouterJours(jour, -1);
  assert.strictEqual((await json(`/api/seances/${seance.id}`, { method: 'PATCH', body: { jour: veille } })).corps.jour, veille);
  assert.strictEqual((await json(`/api/seances/${seance.id}`, { method: 'PATCH', body: { duree: 0 } })).status, 400);
  assert.strictEqual((await json(`/api/seances/${seance.id}`, { method: 'PATCH', body: {} })).status, 400);

  assert.strictEqual((await json(`/api/seances/${seance.id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await projet()).tempsCumule, avant.tempsCumule); // le temps est retiré
  assert.ok(!(await json('/api/seances')).corps.seances.some((s) => s.id === seance.id));
  assert.strictEqual((await json(`/api/seances/${seance.id}`, { method: 'DELETE' })).status, 404);
  assert.strictEqual((await json('/api/seances/inconnue', { method: 'PATCH', body: { duree: 5 } })).status, 404);
  // une séance sans projet ni tâche est possible
  const libre = await post('/api/seances', { duree: 15, jour });
  assert.strictEqual(libre.status, 201);
  const l = (await json('/api/seances')).corps.seances.find((s) => s.titre === 'Séance hors projet');
  await json(`/api/seances/${l.id}`, { method: 'DELETE' });
});

test('API : gérer la bibliothèque de musique (ajouter, modifier, désactiver, supprimer)', async () => {
  const tout = async () => (await json('/api/musique?tout=1')).corps.lignes;
  const radio = async () => (await json('/api/musique')).corps.entrees;
  const depart = (await tout()).length;
  assert.ok(depart >= 3 && (await tout()).every((l) => l.valide));

  assert.strictEqual((await post('/api/musique', { titre: 'x', lien: 'https://exemple.com/a.mp3' })).status, 400);
  assert.strictEqual((await post('/api/musique', { titre: 'x' })).status, 400);
  const ajout = await post('/api/musique', { titre: ' Mix du dimanche ', lien: 'https://www.youtube.com/watch?v=dcDqyGXtK3c' });
  assert.strictEqual(ajout.status, 201);
  const id = ajout.corps.id;
  assert.strictEqual((await tout()).length, depart + 1);
  assert.ok((await radio()).some((e) => e.id === id && e.titre === 'Mix du dimanche' && e.videoId === 'dcDqyGXtK3c'));

  assert.strictEqual((await json(`/api/musique/${id}`, { method: 'PATCH', body: { titre: 'Renommé' } })).status, 200);
  assert.ok((await radio()).some((e) => e.id === id && e.titre === 'Renommé'));
  await json(`/api/musique/${id}`, { method: 'PATCH', body: { desactive: true } });
  assert.ok(!(await radio()).some((e) => e.id === id)); // désactivé : la radio n'y touche plus
  assert.ok((await tout()).some((l) => l.id === id && l.desactive)); // mais il reste dans la liste de gestion
  await json(`/api/musique/${id}`, { method: 'PATCH', body: { desactive: false, lien: 'https://youtu.be/s1hRXtF5AFo' } });
  assert.ok((await radio()).some((e) => e.id === id && e.videoId === 's1hRXtF5AFo'));
  assert.strictEqual((await json(`/api/musique/${id}`, { method: 'PATCH', body: { lien: 'pas un lien' } })).status, 400);
  assert.strictEqual((await json(`/api/musique/${id}`, { method: 'PATCH', body: {} })).status, 400);

  assert.strictEqual((await json(`/api/musique/${id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await tout()).length, depart);
  assert.strictEqual((await json(`/api/musique/${id}`, { method: 'DELETE' })).status, 404);
  assert.strictEqual((await json('/api/musique/inconnu', { method: 'PATCH', body: { titre: 'x' } })).status, 404);
});

test('Notion : modifier une tâche, un projet, une séance, un lien : uniquement les champs envoyés', async () => {
  await avecNotion(async () => {
    const faux = fauxApi((cle, corps) => {
      if (cle.startsWith('PATCH /pages/')) return { id: cle.split('/').pop(), url: 'u', properties: {} };
      if (cle === 'POST /pages') return { id: 'nouvelle', url: 'u', properties: { Nom: txt('title', 'Neuf'), 'Titre': txt('title', 'Mix') } };
      return null;
    });
    try {
      await notion.modifierTache('t1', { titre: 'Neuf', projetId: null, duree: 45, priorite: null, echeance: '2026-12-01', notes: 'n', statut: 'Fait', inconnu: 'ignoré' });
      let b = faux.appels.at(-1).body.properties;
      assert.deepStrictEqual(cles(b), ['Durée estimée (min)', 'Notes', 'Priorité', 'Projet', 'Statut', 'Tâche', 'Échéance'].sort()); // « inconnu » n'est jamais écrit
      assert.deepStrictEqual(b.Projet, { relation: [] });
      assert.deepStrictEqual(b['Priorité'], { select: null });
      assert.deepStrictEqual(b['Échéance'], { date: { start: '2026-12-01' } });

      await notion.modifierTache('t1', { duree: 30 });
      assert.deepStrictEqual(cles(faux.appels.at(-1).body.properties), ['Durée estimée (min)']);

      await notion.modifierProjet('p1', { nom: 'Neuf', statut: 'En pause', categorie: null, objectifHebdo: null, couleur: 'Rose', logo: 'https://exemple.fr/l.png', icone: 'NE', resume: 'r', prochaineEtape: 'p', echeance: null, priorite: 'Haute', pirate: 'x' });
      b = faux.appels.at(-1).body.properties;
      assert.deepStrictEqual(cles(b), ['Catégorie', 'Couleur', 'Icône', 'Logo', 'Nom', 'Objectif / résumé', 'Objectif de temps hebdo (min)', 'Priorité', 'Prochaine étape', 'Statut', 'Échéance'].sort());
      assert.deepStrictEqual(b.Logo, { files: [{ type: 'external', name: 'logo', external: { url: 'https://exemple.fr/l.png' } }] });
      assert.deepStrictEqual(b['Objectif de temps hebdo (min)'], { number: null });
      await notion.modifierProjet('p1', { logo: null });
      assert.deepStrictEqual(faux.appels.at(-1).body.properties, { Logo: { files: [] } });

      await notion.creerProjet({ nom: 'Neuf', type: 'Projet', categorie: 'Autre', objectifHebdo: 60 });
      const creation = faux.appels.find((a) => a.cle === 'POST /pages');
      assert.strictEqual(creation.body.parent.database_id, IDS.projets);
      assert.deepStrictEqual(cles(creation.body.properties), ['Catégorie', 'Nom', 'Objectif de temps hebdo (min)', 'Statut', 'Type']);

      await notion.supprimerPage('t9');
      assert.deepStrictEqual(faux.appels.at(-1), { cle: 'PATCH /pages/t9', body: { archived: true } }); // corbeille, pas suppression définitive

      await notion.modifierSeance('s1', { titre: 'X · 40 min', duree: 40, bilan: 'b', debut: '2026-11-05' });
      assert.deepStrictEqual(cles(faux.appels.at(-1).body.properties), ['Bilan', 'Durée (min)', 'Début', 'Titre']);
      await notion.modifierSeance('s1', { bilan: 'seulement' });
      assert.deepStrictEqual(cles(faux.appels.at(-1).body.properties), ['Bilan']);

      await notion.creerLien({ titre: 'Mix', lien: 'https://youtu.be/NVx5ZJCY6w4' });
      const lien = faux.appels.filter((a) => a.cle === 'POST /pages').at(-1);
      assert.strictEqual(lien.body.parent.database_id, IDS.musique);
      assert.deepStrictEqual(cles(lien.body.properties), ['Lien YouTube', 'Titre']);
      await notion.modifierLien('m1', { desactive: true });
      assert.deepStrictEqual(faux.appels.at(-1).body.properties, { 'Désactivé': { checkbox: true } });
    } finally {
      faux.restaurer();
    }
  });
});

test('Notion : corriger ou supprimer une séance ajuste les temps sans jamais passer sous zéro ni toucher aux dates', async () => {
  await avecNotion(async () => {
    const faux = fauxApi((cle) => {
      if (cle === 'GET /pages/p1') return { properties: { 'Temps cumulé (min)': nb(50) } };
      if (cle === 'GET /pages/t1') return { properties: { 'Temps passé (min)': nb(10) } };
      if (cle.startsWith('PATCH /pages/')) return {};
      return null;
    });
    try {
      await notion.ajusterTemps({ projetId: 'p1', tacheId: 't1', delta: -30 });
      const patchs = faux.appels.filter((a) => a.cle.startsWith('PATCH'));
      assert.deepStrictEqual(patchs.map((p) => [p.cle, p.body]), [
        ['PATCH /pages/p1', { properties: { 'Temps cumulé (min)': { number: 20 } } }],
        ['PATCH /pages/t1', { properties: { 'Temps passé (min)': { number: 0 } } }], // 10 − 30 : plafonné à 0
      ]);
      await notion.ajusterTemps({ projetId: null, tacheId: null, delta: 5 });
      assert.strictEqual(faux.appels.length, 4); // rien à ajuster : aucune requête
    } finally {
      faux.restaurer();
    }
  });
});

test('une séance ajoutée après coup ne fait pas reculer « Dernière activité » (mémoire et Notion)', async () => {
  const d = { projets: [projet('P', { derniereActivite: '2026-11-06' })], taches: [], sessions: [] };
  appliquerSeance(d, { id: 's', debut: '2026-10-01', duree: 20, projetId: 'P', titre: 'x', type: 'projet' });
  assert.strictEqual(d.projets[0].derniereActivite, '2026-11-06');
  appliquerSeance(d, { id: 's2', debut: '2026-11-07', duree: 20, projetId: 'P', titre: 'x', type: 'projet' });
  assert.strictEqual(d.projets[0].derniereActivite, '2026-11-07');
  await avecNotion(async () => {
    const faux = fauxApi((cle) => (cle === 'GET /pages/p1' ? { properties: { 'Temps cumulé (min)': nb(100), 'Dernière activité': date('2026-11-06') } } : cle.startsWith('PATCH') ? {} : null));
    try {
      await notion.majProjet('p1', { duree: 20, jour: '2026-10-01' });
      assert.deepStrictEqual(cles(faux.appels.at(-1).body.properties), ['Temps cumulé (min)']); // date plus ancienne : inchangée
      await notion.majProjet('p1', { duree: 20, jour: '2026-11-07' });
      assert.deepStrictEqual(cles(faux.appels.at(-1).body.properties), ['Dernière activité', 'Temps cumulé (min)']);
    } finally {
      faux.restaurer();
    }
  });
});

test('Notion : tâches terminées et historique des séances sont lus avec les bons filtres', async () => {
  await avecNotion(async () => {
    const faux = fauxApi((cle) => {
      if (cle === `POST /databases/${IDS.taches}/query`) return { results: [{ id: 'f1', url: 'u', properties: { 'Tâche': txt('title', 'Finie'), Statut: sel('Fait') } }], next_cursor: null };
      if (cle === `POST /databases/${IDS.sessions}/query`) return { results: [{ id: 's1', properties: { Titre: txt('title', 'X · 30 min'), 'Début': date('2026-11-05'), 'Durée (min)': nb(30), Origine: sel('Ajout manuel') } }], next_cursor: null };
      if (cle === 'GET /pages/s1') return { id: 's1', properties: { Titre: txt('title', 'X · 30 min'), 'Début': date('2026-11-05'), 'Durée (min)': nb(30) } };
      return null;
    });
    try {
      const faites = await notion.lireTachesFaites();
      assert.deepStrictEqual(faites.map((t) => [t.titre, t.statut]), [['Finie', 'Fait']]);
      assert.deepStrictEqual(faux.appels[0].body, { page_size: 50, filter: { property: 'Statut', select: { equals: 'Fait' } }, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] });
      const seances = await notion.lireSeances('2026-10-01');
      assert.strictEqual(seances[0].origine, 'Ajout manuel');
      const q = faux.appels.at(-1).body;
      assert.deepStrictEqual(q.filter, { property: 'Début', date: { on_or_after: '2026-10-01' } });
      assert.deepStrictEqual(q.sorts, [{ property: 'Début', direction: 'descending' }]);
      assert.strictEqual((await notion.lireSeance('s1')).duree, 30);
      // origine « Ajout manuel » écrite dans la séance
      const faux2 = fauxApi((cle) => (cle === 'POST /pages' ? { id: 'sess' } : null));
      try {
        await notion.creerSession({ ...SEANCE, origine: 'Ajout manuel' });
        assert.strictEqual(faux2.appels[0].body.properties.Origine.select.name, 'Ajout manuel');
      } finally {
        faux2.restaurer();
      }
    } finally {
      faux.restaurer();
    }
  });
});

// ==========================================================================================
// Les bases existantes (prototype Open Space) : « Nom », « Estimation (min) », « Note », « Fin »…
// Cause du bug des tâches « sans nom » : la page contenait déjà des bases « Tâches » et « Sessions de travail » avec d'autres colonnes.
// ==========================================================================================
const ANCIENNE_TACHES = 'b2d5902e-9fc9-430e-b2d5-902e9fc9430e';
const ANCIENNE_SESSIONS = '1a87b757-4cb7-4152-a10b-a5735fb3a449';
const MON_MUSIQUE = BASE_MUSIQUE;
const SCHEMAS_ANCIENS = { [ANCIENNE_TACHES]: ANCIEN_TACHES, [ANCIENNE_SESSIONS]: ANCIEN_SESSIONS };

// La page de l'utilisateur : ses anciennes bases d'abord, puis celles créées par BOSSE ! (mêmes titres), puis la musique.
const PAGE_AVEC_DOUBLONS = { results: [
  { type: 'child_database', id: BASE_PROJETS, child_database: { title: 'Mes projets' } },
  { type: 'child_database', id: ANCIENNE_TACHES, child_database: { title: 'Tâches' } },
  { type: 'child_database', id: ANCIENNE_SESSIONS, child_database: { title: 'Sessions de travail' } },
  { type: 'child_database', id: BASE_TACHES, child_database: { title: 'Tâches' } },
  { type: 'child_database', id: BASE_SESSIONS, child_database: { title: 'Sessions de travail' } },
  { type: 'child_database', id: MON_MUSIQUE, child_database: { title: 'Musique' } },
], next_cursor: null };

async function avecAnciennesBases(gerer, fonction) {
  process.env.NOTION_TOKEN = 'secret-test';
  process.env.NOTION_BASE_PROJETS = BASE_PROJETS;
  notion.oublier();
  const faux = fauxApi((cle, corps) => {
    if (cle === `GET /databases/${BASE_PROJETS}`) return { parent: { type: 'page_id', page_id: PAGE }, properties: { Type: {} } };
    if (cle === `GET /blocks/${PAGE}/children?page_size=100`) return PAGE_AVEC_DOUBLONS;
    return gerer(cle, corps);
  }, { schemas: SCHEMAS_ANCIENS });
  try {
    await fonction(faux);
  } finally {
    faux.restaurer();
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_BASE_PROJETS;
    notion.oublier();
  }
}
const ligneAncienne = (id, nom, extra = {}) => ({ id, url: `https://notion/${id}`, properties: { Nom: txt('title', nom), Projet: { type: 'relation', relation: [{ id: 'p1' }] }, Statut: sel('À faire'), ...extra } });

test('anciennes bases : la PREMIÈRE base du titre est utilisée, les noms des tâches sont lus dans la colonne « Nom » (cause du bug)', async () => {
  await avecAnciennesBases((cle) => {
    if (cle === `POST /databases/${ANCIENNE_TACHES}/query`) return { results: [
      ligneAncienne('a1', 'UI IN game'),
      ligneAncienne('a2', 'Rajouter le loup garou', { 'Estimation (min)': nb(45), 'Priorité': sel('Haute'), Statut: sel('En cours') }),
      ligneAncienne('a3', 'bloquée par un bug', { Statut: sel('Bloquée') }),
    ], next_cursor: null };
    if (cle === `POST /databases/${ANCIENNE_SESSIONS}/query`) return { results: [
      { id: 's1', properties: { Nom: txt('title', 'Taotl — 15/10/2026'), 'Début': date('2026-11-05T09:00:00.000+01:00'), Fin: date('2026-11-05T09:45:00.000+01:00'), 'Durée (min)': nb(45), Source: sel('Assis'), Note: txt('rich_text', 'bien avancé'), Projet: { type: 'relation', relation: [{ id: 'p1' }] } } },
      { id: 's2', properties: { Nom: txt('title', 'Gorgée'), 'Début': date('2026-11-04'), 'Durée (min)': nb(null), Source: sel('Manuel') } },
    ], next_cursor: null };
    if (cle === `POST /databases/${BASE_PROJETS}/query`) return { results: [], next_cursor: null };
    return null;
  }, async (faux) => {
    const { taches, sessions } = await notion.lireTout();
    assert.deepStrictEqual(taches.map((t) => [t.titre, t.statut, t.duree, t.priorite]), [
      ['UI IN game', 'À faire', null, null], ['Rajouter le loup garou', 'En cours', 45, 'Haute'], ['bloquée par un bug', 'Bloquée', null, null], // plus aucun « Sans titre »
    ]);
    assert.ok(taches.every((t) => t.titre !== 'Sans titre' && t.projetId === 'p1'));
    assert.deepStrictEqual(sessions[0], { id: 's1', debut: '2026-11-05T09:00:00.000+01:00', fin: '2026-11-05T09:45:00.000+01:00', duree: 45, tacheId: null, projetId: 'p1', titre: 'Taotl — 15/10/2026', bilan: 'bien avancé', origine: 'Chrono' }); // « Assis » = séance au chrono
    assert.strictEqual(sessions[1].origine, 'Ajout manuel');
    // Les bases utilisées sont les anciennes (les premières) ; les doublons créés par BOSSE ! sont signalés et ignorés.
    assert.ok(faux.appels.some((a) => a.cle === `POST /databases/${ANCIENNE_TACHES}/query`));
    assert.ok(!faux.appels.some((a) => a.cle.includes(BASE_TACHES)));
    const infos = await notion.infosBases();
    assert.deepStrictEqual(infos.doublons, { taches: 1, sessions: 1, musique: 0 });
    assert.deepStrictEqual(infos.statutsTache, ['À faire', 'En cours', 'Fait', 'Bloquée']);
    assert.deepStrictEqual(infos.capacites, { notesTaches: false, tempsParTache: false, bilanSeances: true }); // pas de colonne « Notes » ni « Temps passé »
    // Le filtre « pas encore faite » porte sur la vraie colonne « Statut ».
    assert.deepStrictEqual(faux.appels.find((a) => a.cle === `POST /databases/${ANCIENNE_TACHES}/query`).body.filter, { property: 'Statut', select: { does_not_equal: 'Fait' } });
  });
});

test('anciennes bases : créer et modifier une tâche n’écrit que des colonnes qui existent (Nom, Estimation, Terminée le)', async () => {
  await avecAnciennesBases((cle, corps) => {
    if (cle === 'POST /pages') return ligneAncienne('nouvelle', corps.properties.Nom.title[0].text.content);
    if (cle.startsWith('PATCH /pages/')) return ligneAncienne('a1', 'Renommée', { 'Estimation (min)': nb(60), Statut: sel('Fait') });
    return null;
  }, async (faux) => {
    const t = await notion.creerTache({ titre: 'Appeler la banque', projetId: 'p1', duree: 20, priorite: 'Moyenne', echeance: '2026-11-12' });
    assert.strictEqual(t.titre, 'Appeler la banque');
    const creation = faux.appels.find((a) => a.cle === 'POST /pages');
    assert.strictEqual(creation.body.parent.database_id, ANCIENNE_TACHES); // dans la vraie base de tâches
    assert.deepStrictEqual(cles(creation.body.properties), ['Estimation (min)', 'Nom', 'Priorité', 'Projet', 'Statut', 'Échéance'].sort());
    assert.strictEqual(creation.body.properties['Estimation (min)'].number, 20);

    await notion.modifierTache('a1', { titre: 'Renommée', duree: 60, notes: 'pas de colonne pour ça', statut: 'Fait', priorite: null });
    const patch = faux.appels.at(-1).body.properties;
    assert.deepStrictEqual(cles(patch), ['Estimation (min)', 'Nom', 'Priorité', 'Statut', 'Terminée le'].sort()); // « notes » ignorées : pas de colonne
    assert.deepStrictEqual(patch['Terminée le'], { date: { start: aujourdhui() } });
    assert.strictEqual(patch.Nom.title[0].text.content, 'Renommée');

    await notion.modifierTache('a1', { statut: 'À faire' }); // rétablie : « Terminée le » est vidée
    assert.deepStrictEqual(faux.appels.at(-1).body.properties['Terminée le'], { date: null });
    await notion.modifierTache('a1', { statut: 'Bloquée' });
    assert.deepStrictEqual(cles(faux.appels.at(-1).body.properties), ['Statut', 'Terminée le']);
  });
});

test('anciennes bases : une séance est écrite dans « Nom », « Début » + « Fin », « Note », « Source », « Tâches faites »', async () => {
  await avecAnciennesBases((cle) => (cle === 'POST /pages' ? { id: 'sess' } : cle.startsWith('PATCH') || cle.startsWith('GET /pages/') ? { properties: {} } : null), async (faux) => {
    await notion.creerSession({ ...SEANCE, origine: 'Chrono' });
    await notion.creerSession({ ...SEANCE, id: 'x', origine: 'Ajout manuel', fin: null });
    const [a, b] = faux.appels.filter((x) => x.cle === 'POST /pages');
    assert.strictEqual(a.body.parent.database_id, ANCIENNE_SESSIONS);
    assert.deepStrictEqual(cles(a.body.properties), ['Début', 'Durée (min)', 'Fin', 'Nom', 'Note', 'Projet', 'Source', 'Tâches faites'].sort()); // pas « Titre », « Bilan », « Origine », « Prochaine étape »
    assert.deepStrictEqual(a.body.properties['Début'], { date: { start: '2026-11-07T10:00:00+01:00' } }); // la fin est dans sa propre colonne
    assert.deepStrictEqual(a.body.properties.Fin, { date: { start: '2026-11-07T10:30:00+01:00' } });
    assert.strictEqual(a.body.properties.Source.select.name, 'Assis');
    assert.strictEqual(b.body.properties.Source.select.name, 'Manuel');
    assert.strictEqual(a.body.properties.Note.rich_text[0].text.content, 'Fait la moitié');
    assert.deepStrictEqual(a.body.properties['Tâches faites'], { relation: [{ id: 't1' }] });
    assert.ok(!('Fin' in b.body.properties)); // pas de fin (séance oubliée)

    // corriger une séance : le jour change, la fin suit ; la note est « Note »
    await notion.modifierSeance('s1', { titre: 'X · 40 min', duree: 40, bilan: 'corrigé', debut: '2026-11-05T10:00:00+01:00', fin: '2026-11-05T10:40:00+01:00' });
    const patch = faux.appels.at(-1).body.properties;
    assert.deepStrictEqual(cles(patch), ['Début', 'Durée (min)', 'Fin', 'Nom', 'Note'].sort());
  });
});

test('anciennes bases : sans colonne de temps par tâche, seule la fin de tâche est écrite ; le temps du projet reste ajusté', async () => {
  await avecAnciennesBases((cle) => (cle === 'GET /pages/p1' ? { properties: { 'Temps cumulé (min)': nb(100), 'Dernière activité': date('2026-11-01') } } : cle.startsWith('PATCH') ? {} : null), async (faux) => {
    await notion.infosBases(); // la recherche des bases et la lecture des schémas se font ici, une fois
    const avant = faux.appels.length;
    await notion.majTache('t1', { duree: 30, jour: '2026-11-07', fait: false });
    assert.strictEqual(faux.appels.length, avant); // rien à écrire dans la tâche : aucune requête
    await notion.majTache('t1', { duree: 30, jour: '2026-11-07', fait: true });
    assert.deepStrictEqual(faux.appels.at(-1), { cle: 'PATCH /pages/t1', body: { properties: { Statut: { select: { name: 'Fait' } }, 'Terminée le': { date: { start: '2026-11-07' } } } } });
    await notion.ajusterTemps({ projetId: 'p1', tacheId: 't1', delta: -20 });
    const patchs = faux.appels.filter((a) => a.cle.startsWith('PATCH'));
    assert.deepStrictEqual(patchs.map((p) => p.cle), ['PATCH /pages/t1', 'PATCH /pages/p1']); // la tâche n'a pas de « Temps passé » : seul le projet est ajusté
    assert.deepStrictEqual(patchs.at(-1).body, { properties: { 'Temps cumulé (min)': { number: 80 } } });
  });
});

test('une base choisie à la main (NOTION_BASE_TACHES) l’emporte, et un schéma illisible retombe sur les noms par défaut', async () => {
  process.env.NOTION_TOKEN = 'secret-test';
  process.env.NOTION_BASE_PROJETS = BASE_PROJETS;
  process.env.NOTION_BASE_TACHES = BASE_TACHES;
  process.env.NOTION_BASE_SESSIONS = BASE_SESSIONS;
  process.env.NOTION_BASE_MUSIQUE = BASE_MUSIQUE;
  notion.oublier();
  const faux = fauxApi((cle) => (cle === `POST /databases/${BASE_TACHES}/query` ? { results: [{ id: 'x', properties: { 'Tâche': txt('title', 'Nommée'), Statut: sel('À faire') } }], next_cursor: null } : cle.startsWith('POST /databases/') ? { results: [], next_cursor: null } : null), { schemas: { [BASE_TACHES]: undefined } });
  const original = global.fetch;
  global.fetch = async (url, options) => (String(url).endsWith(`/databases/${BASE_TACHES}`) && !options?.method ? { ok: false, status: 400, headers: { get: () => null }, json: async () => ({ message: 'schéma illisible' }) } : original(url, options));
  try {
    const { taches } = await notion.lireTout();
    assert.deepStrictEqual(taches.map((t) => t.titre), ['Nommée']); // noms par défaut : la structure de BOSSE !
    assert.ok(!faux.appels.some((a) => a.cle.startsWith('GET /blocks/'))); // pas de recherche dans la page : les identifiants sont donnés
  } finally {
    global.fetch = original;
    faux.restaurer();
    for (const v of ['NOTION_TOKEN', 'NOTION_BASE_PROJETS', 'NOTION_BASE_TACHES', 'NOTION_BASE_SESSIONS', 'NOTION_BASE_MUSIQUE']) delete process.env[v];
    notion.oublier();
  }
});

test('API : statuts de tâche de la base (En cours, Bloquée…), tâche bloquée jamais proposée', async () => {
  const options = (await json('/api/options')).corps;
  assert.deepStrictEqual(options.statutsTache, ['À faire', 'Fait']); // démo : statuts de base
  assert.strictEqual(options.capacites.notesTaches, true);
  assert.strictEqual((await json('/api/synchro')).corps.bases.doublons.taches, 0);
  assert.strictEqual((await json('/api/taches/t7', { method: 'PATCH', body: { statut: 'Bloquée' } })).status, 400); // pas un statut de la base démo
  // choix : une tâche bloquée n'est pas candidate
  const cl = choisir([projet('A')], [tache('ok', 'A'), tache('bloquee', 'A', { statut: 'Bloquée' }), tache('encours', 'A', { statut: 'En cours' })]);
  assert.deepStrictEqual(cl.map((c) => c.id).sort(), ['encours', 'ok']);
  // édition : statut validé par la liste de la base
  assert.deepStrictEqual(edition.champsTache({ statut: 'Bloquée' }, { statuts: ['À faire', 'En cours', 'Fait', 'Bloquée'] }), { statut: 'Bloquée' });
  assert.throws(() => edition.champsTache({ statut: 'Bloquée' }), /Statut inconnu/);
});

test('lectures Notion : une donnée un peu ancienne est servie tout de suite et relue en arrière-plan', async () => {
  process.env.NOTION_TOKEN = 'secret-test';
  process.env.NOTION_BASE_PROJETS = BASE_PROJETS;
  process.env.NOTION_BASE_TACHES = BASE_TACHES;
  process.env.NOTION_BASE_SESSIONS = BASE_SESSIONS;
  process.env.NOTION_BASE_MUSIQUE = BASE_MUSIQUE;
  notion.oublier();
  let lectures = 0;
  const faux = fauxApi((cle) => {
    if (cle === `POST /databases/${BASE_TACHES}/query`) return { results: [{ id: 'x', url: 'u', properties: { 'Tâche': txt('title', `version ${++lectures}`), Statut: sel('À faire') } }], next_cursor: null };
    if (cle.startsWith('POST /databases/')) return { results: [], next_cursor: null };
    return null;
  });
  const titres = async () => { const r = await json('/api/taches'); assert.strictEqual(r.status, 200, JSON.stringify(r.corps)); return r.corps.map((t) => t.titre); };
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    assert.deepStrictEqual(await titres(), ['version 1']); // première visite : on attend Notion
    assert.deepStrictEqual(await titres(), ['version 1']); // encore frais : aucune nouvelle lecture
    assert.strictEqual(lectures, 1);
    await attendre(120); // les données sont maintenant « anciennes »
    assert.deepStrictEqual(await titres(), ['version 1']); // réponse immédiate avec ce qu'on avait…
    await attendre(150); // …pendant que Notion est relu en arrière-plan
    assert.strictEqual(lectures, 2);
    assert.deepStrictEqual(await titres(), ['version 2']); // la visite suivante voit la nouveauté
  } finally {
    faux.restaurer();
    for (const v of ['NOTION_TOKEN', 'NOTION_BASE_PROJETS', 'NOTION_BASE_TACHES', 'NOTION_BASE_SESSIONS', 'NOTION_BASE_MUSIQUE']) delete process.env[v];
    notion.oublier();
    await attendre(200); // laisse finir une éventuelle relecture en cours avant les tests suivants
  }
});

test('onglet Musique : un seul lecteur, hors de l’écran du chrono, avec sa liste et un onglet dans la barre', async () => {
  const html = await (await fetch(base + '/')).text();
  const finChrono = html.indexOf('</section>', html.indexOf('<section id="chrono"'));
  const lecteur = html.indexOf('id="musique"');
  assert.ok(lecteur > finChrono, 'le lecteur ne doit pas être dans la section « chrono » (le redessiner relancerait la musique)');
  assert.strictEqual((html.match(/id="lecteur-yt"/g) || []).length, 1); // un seul lecteur pour l'onglet et pour le chrono
  for (const id of ['musique-liste', 'm-lecture', 'm-suivante', 'm-son']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<nav[\s\S]*href="#musique"[\s\S]*<\/nav>/);
  const radio = await (await fetch(base + '/radio.js')).text();
  assert.match(radio, /async function demarrer\(entree\)/); // on peut lancer un élément précis, sans chrono
  assert.match(radio, /const liste = /);
  const app = await (await fetch(base + '/app.js')).text();
  assert.match(app, /\['chrono', 'musique'\]\.includes\(ecran\)/); // la musique ne s'arrête que si on quitte le chrono ET l'onglet Musique
});

test('tâches : le nom ne vient jamais d’un nom de colonne en dur, et le crayon de modification est affiché', async () => {
  const app = await (await fetch(base + '/app.js')).text();
  assert.match(app, /class="crayon"/);
  const notionSrc = require('fs').readFileSync(path.join(__dirname, 'notion.js'), 'utf8');
  assert.doesNotMatch(notionSrc, /texte\(p\['T[âa]che'\]\)/); // l'ancienne lecture qui donnait « Sans titre » sur l'ancienne base
  assert.match(notionSrc, /titreDe = /);
});
