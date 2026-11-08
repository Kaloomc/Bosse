const express = require('express');
const path = require('path');
const crypto = require('crypto');
const notion = require('./notion');
const demo = require('./demo');
const choix = require('./choix');
const chrono = require('./chrono');
const stockage = require('./stockage');
const synchro = require('./synchro');
const { totaux, appliquerSeance } = require('./seances');
const { aujourdhui, isoParis } = require('./temps');
const { COULEURS, hexDe } = require('./projets');
const bibliotheque = require('./musique');
const encouragements = require('./encouragements');

const app = express();
app.set('trust proxy', 1); // derrière le proxy inversé du NAS
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Mot de passe (obligatoire pour être joignable depuis le réseau) ----------
// Sans APP_PASSWORD, le serveur n'écoute que sur 127.0.0.1 (cet ordinateur seulement).
// Avec, l'API demande de se connecter une fois ; un cookie garde la session un an.
const MOT_DE_PASSE = process.env.APP_PASSWORD;
const signer = (s) => crypto.createHmac('sha256', s).update('bosse').digest('hex');
const jeton = MOT_DE_PASSE && signer(MOT_DE_PASSE);
const egal = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.post('/api/connexion', async (req, res) => {
  if (!MOT_DE_PASSE) return res.json({ ok: true });
  const essai = String(req.body?.motDePasse ?? '');
  if (!egal(signer(essai), jeton)) {
    await new Promise((r) => setTimeout(r, 1000)); // freine les essais en série
    return res.status(401).json({ erreur: 'Mot de passe incorrect' });
  }
  res.setHeader('Set-Cookie', `bosse=${jeton}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (!MOT_DE_PASSE || req.path === '/etat') return next();
  const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)bosse=([a-f0-9]+)/)?.[1] || '';
  if (egal(cookie, jeton)) return next();
  res.status(401).json({ erreur: 'Connexion nécessaire' });
});

// --- Outils ------------------------------------------------------------------------------------
const echec = (status, message) => Object.assign(new Error(message), { status });
const verifier = (ok, message, status = 400) => {
  if (!ok) throw echec(status, message);
};
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITES = ['Haute', 'Moyenne', 'Basse'];

// --- Données : Notion (ou démo), gardées 60 secondes en mémoire -------------------------------
// { projets, taches, sessions } : les séances de la semaine servent au retard hebdo et aux totaux.
// Après chaque écriture, les données en mémoire sont mises à jour tout de suite (sans attendre une nouvelle lecture).
const DUREE_CACHE = 60e3;
let cache = null; // { t, d }
let enCours = null;
let demoDonnees = null;

async function donnees({ force = false } = {}) {
  if (!notion.actif) return (demoDonnees ??= demo(aujourdhui())); // démo : tout reste en mémoire
  if (!force && cache && Date.now() - cache.t < DUREE_CACHE) return cache.d;
  enCours ??= (async () => {
    try {
      const d = await notion.lireTout();
      cache = { t: Date.now(), d };
      return d;
    } catch (err) {
      if (!cache) throw err;
      console.error('Notion (lecture) :', err.message, '- on garde les dernières données');
      return cache.d; // Notion injoignable : on affiche ce qu'on avait
    } finally {
      enCours = null;
    }
  })();
  return enCours;
}

// Un candidat tel que l'écran l'affiche.
const publicProjet = (p) => p && { id: p.id, nom: p.nom, type: p.type || 'Projet', hex: p.hex, couleur: p.couleur, logo: p.logo, icone: p.icone, categorie: p.categorie, prochaineEtape: p.prochaineEtape };
const publicCandidat = (c) => ({
  id: c.id, type: c.type, titre: c.titre, duree: c.duree, echeance: c.echeance, priorite: c.priorite, score: c.score,
  raisons: c.raisons, raison: c.raisons.slice(0, 2).join(' · '), url: c.url, notes: c.notes, projet: publicProjet(c.projet),
});
const publicTache = (t, d) => {
  const p = t.projetId ? d.projets.find((x) => x.id === t.projetId) : null;
  return {
    id: t.id, titre: t.titre, duree: t.duree || choix.DUREE_DEFAUT, priorite: t.priorite, echeance: t.echeance, url: t.url,
    projet: publicProjet(p), projetActif: !t.projetId || p?.statut === 'En cours',
  };
};

const lesTotaux = (d) => totaux(d.sessions || [], aujourdhui());

// Le temps de la semaine par projet « En cours » (ceux qui ont un objectif ou du temps cette semaine), du plus travaillé au moins travaillé.
function projetsSemaine(d, t) {
  return d.projets
    .filter((p) => p.statut === 'En cours')
    .map((p) => ({ id: p.id, nom: p.nom, type: p.type || 'Projet', hex: p.hex, logo: p.logo, icone: p.icone, minutes: t.parProjetSemaine.get(p.id) || 0, objectif: p.objectifHebdo || null }))
    .filter((p) => p.minutes > 0 || p.objectif)
    .sort((a, b) => b.minutes - a.minutes || (b.objectif || 0) - (a.objectif || 0) || a.nom.localeCompare(b.nom, 'fr'));
}
const contexte = (d) => {
  const t = lesTotaux(d);
  return { aujourdhui: aujourdhui(), semaine: t.parProjetSemaine, jour: t.parProjetJour };
};
const classement = (d) => choix.classer(choix.candidats(d.projets, d.taches), contexte(d));

// --- Envoi des séances vers Notion ------------------------------------------------------------------
const versNotion = { creerSession: notion.creerSession, majProjet: notion.majProjet, majTache: notion.majTache };
const envoyerEnAttente = () => (notion.actif ? synchro.traiter(versNotion) : Promise.resolve());

// --- Routes ---------------------------------------------------------------------------------------
app.get('/api/etat', (req, res) => {
  res.json({ mode: notion.actif ? 'notion' : 'demo', motDePasse: !!MOT_DE_PASSE });
});

// L'action du moment. ?exclus=id1,id2 : ce qui a déjà été refusé avec « Autre chose ».
app.get('/api/maintenant', async (req, res) => {
  const d = await donnees();
  const exclus = String(req.query.exclus ?? '').split(',').filter(Boolean).slice(0, 200);
  const cl = classement(d);
  const p = choix.proposer(cl, exclus);
  const t = lesTotaux(d);
  res.json({
    action: p.action && publicCandidat(p.action), restantes: p.restantes, toutVu: p.toutVu, total: cl.length,
    totaux: { jour: t.jour, semaine: t.semaine }, projetsSemaine: projetsSemaine(d, t), chronoEnCours: !!etatChrono,
    classement: cl.slice(0, 5).map((c) => ({ id: c.id, titre: c.titre, score: c.score })),
  });
});

// --- La roue ------------------------------------------------------------------------------------------
// Les parts de la roue : un projet (ou « Hors projet ») par part, avec ses chances de sortir (retard sur l'objectif hebdo,
// ancienneté, échéance : voir choix.js). Le tirage se fait ici, sur le serveur.
const publicPart = (g) => ({
  cle: g.cle, id: g.projet?.id || null, nom: g.projet?.nom || 'Hors projet', type: g.projet?.type || 'Projet', hex: g.projet?.hex || '#8b93ff', logo: !!g.projet?.logo, icone: g.projet?.icone || '',
  poids: Math.round(g.poids * 100) / 100, probabilite: g.probabilite, retard: g.retard > 0, atteint: g.atteint, nbChoix: g.candidats.length,
});
const aleatoire = () => crypto.randomInt(0, 1e9) / 1e9;

app.get('/api/roue', async (req, res) => {
  const d = await donnees();
  res.json({ parts: choix.groupes(classement(d), contexte(d)).map(publicPart) });
});

// Tire un projet : renvoie les parts (pour dessiner la roue), l'indice de la part tirée et l'action à faire dans ce projet.
app.post('/api/roue/tirer', async (req, res) => {
  const d = await donnees();
  const liste = choix.groupes(classement(d), contexte(d));
  verifier(liste.length, 'Rien à tirer au sort : ajoute une tâche ou un projet en cours.', 409);
  const index = choix.tirer(liste, aleatoire);
  res.json({ parts: liste.map(publicPart), index, action: publicCandidat(liste[index].candidats[0]) });
});

// Découper un gros chantier : crée plusieurs tâches d'un coup (une par étape), dans l'ordre. Corps : { projetId, etapes: [{ titre, duree }] }.
// Si Notion s'arrête en route, on dit combien de tâches sont déjà créées (elles restent dans la liste).
app.post('/api/taches/lot', async (req, res) => {
  const d = await donnees();
  const projetId = req.body?.projetId || null;
  verifier(!projetId || d.projets.some((p) => p.id === projetId && p.statut === 'En cours'), 'Projet inconnu ou pas « En cours ».');
  const etapes = req.body?.etapes;
  verifier(Array.isArray(etapes) && etapes.length >= 1, 'Écris au moins une étape.');
  verifier(etapes.length <= 30, '30 étapes au maximum à la fois.');
  const propres = etapes.map((e) => {
    const titre = String(e?.titre ?? '').trim().slice(0, 200);
    const duree = e?.duree == null ? choix.DUREE_DEFAUT : Math.round(Number(e.duree));
    verifier(titre, 'Une étape n’a pas de titre.');
    verifier(Number.isFinite(duree) && duree >= 5 && duree <= 240, 'Durée d’une étape : de 5 à 240 minutes.');
    return { titre, projetId, duree, priorite: null, echeance: null };
  });
  const creees = [];
  try {
    for (const infos of propres) {
      const tache = notion.actif
        ? await notion.creerTache(infos)
        : { id: `t-${crypto.randomUUID()}`, statut: 'À faire', tempsPasse: 0, derniereFois: null, notes: '', url: null, ...infos };
      d.taches = [...d.taches, tache];
      creees.push(tache);
    }
  } catch (err) {
    throw echec(502, `${creees.length} tâche${creees.length > 1 ? 's' : ''} créée${creees.length > 1 ? 's' : ''} sur ${propres.length} avant l’erreur : ${err.message}`);
  }
  res.status(201).json({ creees: creees.length, taches: creees.map((t) => publicTache(t, d)) });
});

// Nouvelle activité (lire, réviser, brainstormer avec Claude…) : une ligne « Activité » de « Mes projets », avec son enveloppe
// de temps par semaine (en minutes, facultative) et sa couleur.
app.post('/api/activites', async (req, res) => {
  const d = await donnees();
  const nom = String(req.body?.nom ?? '').trim().slice(0, 100);
  verifier(nom, 'Donne un nom à l’activité.');
  verifier(!d.projets.some((p) => p.nom.toLowerCase() === nom.toLowerCase() && p.statut === 'En cours'), 'Il existe déjà un projet ou une activité « En cours » avec ce nom.');
  const objectifHebdo = req.body?.objectifHebdo == null || req.body.objectifHebdo === '' ? null : Math.round(Number(req.body.objectifHebdo));
  verifier(objectifHebdo === null || (Number.isFinite(objectifHebdo) && objectifHebdo >= 15 && objectifHebdo <= 3000), 'Enveloppe de 15 à 3000 minutes par semaine.');
  const couleur = req.body?.couleur || null;
  verifier(!couleur || Object.hasOwn(COULEURS, couleur), 'Couleur inconnue.');
  const infos = { nom, objectifHebdo, couleur };
  const activite = notion.actif
    ? await notion.creerActivite(infos)
    : { id: `p-${crypto.randomUUID()}`, nom, type: 'Activité', statut: 'En cours', categorie: null, priorite: null, couleur, hex: hexDe(couleur), echeance: null, prochaineEtape: '', derniereActivite: null, tempsCumule: 0, objectifHebdo, logo: false, icone: '', url: null };
  d.projets = [...d.projets, activite];
  res.status(201).json(publicProjet(activite));
});

// Modifier l'objectif de temps de la semaine d'un projet ou d'une activité (objectifHebdo: minutes, ou null pour l'enlever).
app.patch('/api/projets/:id', async (req, res) => {
  const d = await donnees();
  const projet = d.projets.find((p) => p.id === req.params.id);
  verifier(projet, 'Projet introuvable : rafraîchis la liste.', 404);
  const brut = req.body?.objectifHebdo;
  verifier(brut === null || Number.isFinite(brut), 'Indique l’objectif en minutes par semaine (ou rien pour l’enlever).');
  const objectifHebdo = brut === null || brut === 0 ? null : Math.round(brut);
  verifier(objectifHebdo === null || (objectifHebdo >= 15 && objectifHebdo <= 3000), 'Objectif de 15 à 3000 minutes par semaine.');
  if (notion.actif) await notion.majObjectif(projet.id, objectifHebdo);
  projet.objectifHebdo = objectifHebdo;
  res.json({ id: projet.id, objectifHebdo });
});

// Projets et activités « En cours », avec leurs tâches ouvertes et le temps de la semaine.
app.get('/api/projets', async (req, res) => {
  const d = await donnees();
  const t = lesTotaux(d);
  const ouvertes = new Map();
  for (const x of d.taches) if (x.projetId && x.statut !== 'Fait') ouvertes.set(x.projetId, (ouvertes.get(x.projetId) || 0) + 1);
  res.json(d.projets
    .filter((p) => p.statut === 'En cours')
    .map((p) => ({
      ...publicProjet(p), priorite: p.priorite, echeance: p.echeance, tempsCumule: p.tempsCumule, derniereActivite: p.derniereActivite,
      objectifHebdo: p.objectifHebdo, tempsSemaine: t.parProjetSemaine.get(p.id) || 0, tempsJour: t.parProjetJour.get(p.id) || 0,
      tachesOuvertes: ouvertes.get(p.id) || 0, url: p.url,
    }))
    .sort((a, b) => b.tachesOuvertes - a.tachesOuvertes || a.nom.localeCompare(b.nom, 'fr')));
});

// Tâches à faire : celles sans projet d'abord (to-do simple), puis celles de chaque projet (le tri est fait par l'écran).
app.get('/api/taches', async (req, res) => {
  const d = await donnees();
  res.json(d.taches.filter((t) => t.statut !== 'Fait').map((t) => publicTache(t, d)));
});

// Nouvelle tâche. projetId absent ou vide : to-do hors projet.
app.post('/api/taches', async (req, res) => {
  const d = await donnees();
  const titre = String(req.body?.titre ?? '').trim().slice(0, 200);
  verifier(titre, 'Donne un titre à la tâche.');
  const projetId = req.body?.projetId || null;
  verifier(!projetId || d.projets.some((p) => p.id === projetId && p.statut === 'En cours'), 'Projet inconnu ou pas « En cours ».');
  const duree = req.body?.duree == null ? choix.DUREE_DEFAUT : Math.round(Number(req.body.duree));
  verifier(Number.isFinite(duree) && duree >= 5 && duree <= 240, 'Durée de 5 à 240 minutes.');
  const priorite = req.body?.priorite || null;
  verifier(!priorite || PRIORITES.includes(priorite), 'Priorité inconnue.');
  const echeance = req.body?.echeance || null;
  verifier(!echeance || (JOUR.test(echeance) && !Number.isNaN(Date.parse(echeance))), 'Échéance invalide.');
  const infos = { titre, projetId, duree, priorite, echeance };
  const tache = notion.actif
    ? await notion.creerTache(infos)
    : { id: `t-${crypto.randomUUID()}`, statut: 'À faire', tempsPasse: 0, derniereFois: null, notes: '', url: null, ...infos };
  d.taches = [...d.taches, tache];
  res.status(201).json(publicTache(tache, d));
});

// Cocher (fait: true) ou décocher (fait: false) une tâche.
app.patch('/api/taches/:id', async (req, res) => {
  const d = await donnees();
  const tache = d.taches.find((t) => t.id === req.params.id);
  verifier(tache, 'Tâche introuvable : rafraîchis la liste.', 404);
  verifier(typeof req.body?.fait === 'boolean', 'Indique « fait » : vrai ou faux.');
  if (notion.actif) await notion.statutTache(tache.id, req.body.fait);
  tache.statut = req.body.fait ? 'Fait' : 'À faire';
  res.json({ id: tache.id, statut: tache.statut });
});

// --- Chrono (compte à rebours) ---------------------------------------------------------------------
let etatChrono = stockage.lire('chrono.json'); // gardé dans un fichier : le chrono survit à un redémarrage du serveur
const sauverChrono = (s) => {
  etatChrono = s;
  if (s) stockage.ecrire('chrono.json', s);
  else stockage.ecrire('chrono.json', null);
};
const vueChrono = (s) => {
  if (!s) return null;
  const ecouleMs = chrono.ecoule(s, Date.now());
  return { etat: s.etat, candidat: s.candidat, dureePrevueMs: s.dureePrevueMs, ecouleMs, minutes: chrono.minutes(ecouleMs), debut: s.debut };
};
const actuel = () => {
  verifier(etatChrono, 'Aucun chrono en cours.', 409);
  return etatChrono;
};

app.get('/api/chrono', (req, res) => res.json({ chrono: vueChrono(etatChrono) }));

app.post('/api/chrono/demarrer', async (req, res) => {
  verifier(!etatChrono, 'Un chrono est déjà lancé.', 409);
  const d = await donnees();
  const c = classement(d).find((x) => x.id === req.body?.id);
  verifier(c, 'Ce choix n’existe plus : rafraîchis la liste.', 404);
  const dureeMin = req.body?.duree == null ? c.duree : Number(req.body.duree);
  sauverChrono(chrono.demarrer({
    id: c.id, type: c.type, titre: c.titre, tacheId: c.type === 'tache' ? c.id : null,
    projetId: c.projet?.id || null, projet: publicProjet(c.projet), origine: req.body?.origine === 'roue' ? 'Roue' : 'Chrono', // « Roue » : tiré au sort
  }, dureeMin, Date.now()));
  res.json({ chrono: vueChrono(etatChrono) });
});

const transition = (fonction) => (req, res) => {
  sauverChrono(fonction(actuel(), Date.now(), req.body));
  res.json({ chrono: vueChrono(etatChrono) });
};
app.post('/api/chrono/pause', transition((s, now) => chrono.pause(s, now)));
app.post('/api/chrono/reprendre', transition((s, now) => chrono.reprendre(s, now)));
app.post('/api/chrono/ajouter', transition((s, now, corps) => chrono.ajouter(s, Number(corps?.minutes ?? 10))));
app.post('/api/chrono/terminer', transition((s, now) => chrono.terminer(s, now)));

app.delete('/api/chrono', (req, res) => {
  sauverChrono(null);
  res.json({ chrono: null });
});

// --- Bilan : enregistre la séance terminée ---------------------------------------------------------------
// Corps : { duree (minutes, corrigeable), bilan (où j'en suis), prochaineEtape, termine }.
// La séance est d'abord mise en attente dans un fichier, puis envoyée à Notion : si Notion est injoignable,
// elle part plus tard (enAttente: true dans la réponse) et rien n'est perdu.
app.post('/api/bilan', async (req, res) => {
  const s = etatChrono;
  verifier(s && s.etat === 'fini', 'Aucune séance terminée à enregistrer.', 409);
  const duree = Math.round(Number(req.body?.duree));
  verifier(Number.isFinite(duree) && duree >= 1 && duree <= 600, 'Durée de 1 à 600 minutes.');
  const bilan = String(req.body?.bilan ?? '').trim().slice(0, 2000);
  const prochaine = String(req.body?.prochaineEtape ?? '').trim().slice(0, 500);
  const d = await donnees();
  const c = s.candidat;
  const projet = c.projetId && d.projets.find((p) => p.id === c.projetId);
  const seance = {
    id: crypto.randomUUID(), debut: isoParis(new Date(s.debut)), fin: isoParis(new Date(s.fin)), duree,
    tacheId: c.tacheId, projetId: c.projetId, titre: c.titre, type: c.type, origine: c.origine === 'Roue' ? 'Roue' : 'Chrono', bilan,
    prochaineEtape: projet && prochaine && prochaine !== projet.prochaineEtape ? prochaine : '', // écrit seulement si tu l'as changée
    termine: req.body?.termine === true,
  };
  sauverChrono(null); // plus de séance en cours : un deuxième envoi du formulaire est refusé
  appliquerSeance(d, seance);
  let attente = 0;
  let erreur = null;
  if (notion.actif) {
    synchro.enfiler(seance);
    await envoyerEnAttente();
    ({ attente, erreur } = synchro.etat());
  }
  const t = lesTotaux(d);
  const semaine = projetsSemaine(d, t);
  const message = encouragements.construire({
    duree, titre: c.titre, projet: projet ? { nom: projet.nom, objectifHebdo: projet.objectifHebdo } : null,
    tacheTerminee: seance.termine && c.type === 'tache', projetTermine: seance.termine && c.type === 'projet',
    totaux: { jour: t.jour, semaine: t.semaine }, projetSemaine: t.parProjetSemaine.get(c.projetId) || 0,
    projetsSemaine: semaine, graine: seance.id,
  });
  res.json({ duree, totaux: { jour: t.jour, semaine: t.semaine }, message, projetsSemaine: semaine, enAttente: attente > 0, erreur });
});

// Séances en attente d'envoi vers Notion.
app.get('/api/synchro', (req, res) => res.json(synchro.etat()));

// Bibliothèque de musique (liens YouTube de la base Notion « Musique »), gardée 5 minutes.
let cacheMusique = null; // { t, entrees, message }
app.get('/api/musique', async (req, res) => {
  if (!cacheMusique || Date.now() - cacheMusique.t > 5 * 60e3) {
    if (!notion.actif) cacheMusique = { t: Date.now(), entrees: bibliotheque.entrees(bibliotheque.DEMO), message: null };
    else {
      const lignes = await notion.lireMusique();
      cacheMusique = { t: Date.now(), entrees: lignes ? bibliotheque.entrees(lignes) : [], message: lignes ? null : 'La base « Musique » n’est pas dans la même page que « Mes projets ».' };
    }
  }
  res.json({ entrees: cacheMusique.entrees, message: cacheMusique.message });
});

// Logo d'un projet. Seuls les projets connus sont acceptés ; un lien Notion frais est demandé à chaque fois,
// puis l'image est gardée 30 minutes.
const logos = new Map(); // id → { t, octets, type } (octets null : pas de logo)
app.get('/api/logo/:id', async (req, res) => {
  const id = req.params.id;
  const d = await donnees();
  if (!notion.actif || !d.projets.some((p) => p.id === id && p.logo)) return res.status(404).end();
  let l = logos.get(id);
  if (!l || Date.now() - l.t > 30 * 60e3) {
    l = { t: Date.now(), ...((await notion.logo(id)) || { octets: null }) };
    logos.set(id, l);
  }
  if (!l.octets) return res.status(404).end();
  res.set({ 'Content-Type': l.type, 'Cache-Control': 'private, max-age=1800' }).send(l.octets);
});

// Bouton « Rafraîchir Notion » : oublie les identifiants de bases, renvoie ce qui attend, et relit tout.
app.post('/api/notion/rafraichir', async (req, res) => {
  if (!notion.actif) return res.status(400).json({ erreur: 'Notion n’est pas configuré (mode démo).' });
  try {
    notion.oublier();
    logos.clear();
    cacheMusique = null;
    await envoyerEnAttente();
    const d = await donnees({ force: true });
    res.json({ projets: d.projets.length, taches: d.taches.length, sessions: (d.sessions || []).length, ...synchro.etat() });
  } catch (err) {
    console.error('Notion (rafraîchir) :', err.message);
    res.status(502).json({ erreur: err.message });
  }
});

// --- Erreurs -----------------------------------------------------------------------------------
app.use((err, req, res, next) => {
  const status = err.status || (/^Notion|NOTION_|« /.test(err.message) ? 502 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ erreur: status === 500 ? 'Erreur du serveur' : err.message });
});

module.exports = app; // pour les tests

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3015;
  const pret = () => console.log(`BOSSE ! sur http://localhost:${PORT} (Notion ${notion.actif ? 'activé' : 'non configuré : mode démo'})`);
  // Séances en attente : un essai peu après le démarrage, puis toutes les 2 minutes.
  setTimeout(envoyerEnAttente, 10e3);
  setInterval(envoyerEnAttente, 2 * 60e3);
  if (MOT_DE_PASSE) app.listen(PORT, pret);
  else {
    console.warn('APP_PASSWORD manquant : BOSSE ! n’écoute que sur 127.0.0.1, il est injoignable depuis le réseau.');
    app.listen(PORT, '127.0.0.1', pret);
  }
}
