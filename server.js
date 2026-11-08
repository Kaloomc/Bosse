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
const { aujourdhui, isoParis, ajouterJours, jourDe } = require('./temps');
const { duree: dureeTexte } = require('./projets');
const { COULEURS, hexDe } = require('./projets');
const bibliotheque = require('./musique');
const edition = require('./edition');
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
    statut: t.statut, notes: t.notes || '', projetId: t.projetId || null, tempsPasse: t.tempsPasse || 0,
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

// --- Tâches ----------------------------------------------------------------------------------------------
// Tâches à faire : celles sans projet d'abord (to-do simple), puis celles de chaque projet (le tri est fait par l'écran).
// ?statut=faites : les tâches terminées (les plus récentes d'abord), pour les rétablir ou les corriger.
app.get('/api/taches', async (req, res) => {
  const d = await donnees();
  if (req.query.statut === 'faites') {
    const faites = notion.actif ? await notion.lireTachesFaites() : d.taches.filter((t) => t.statut === 'Fait');
    return res.json(faites.map((t) => publicTache(t, d)));
  }
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

// Modifier une tâche : titre, projet, durée, priorité, échéance, notes, et « fait » (vrai : terminée, faux : à refaire).
// Seuls les champs envoyés changent. Une tâche terminée peut être modifiée ou rétablie.
app.patch('/api/taches/:id', async (req, res) => {
  const d = await donnees();
  const champs = edition.champsTache(req.body);
  verifier(Object.keys(champs).length, 'Rien à modifier.');
  verifier(!champs.projetId || d.projets.some((p) => p.id === champs.projetId), 'Projet inconnu.');
  const tache = d.taches.find((t) => t.id === req.params.id);
  verifier(tache || notion.actif, 'Tâche introuvable : rafraîchis la liste.', 404); // en mode Notion, une tâche terminée n'est plus en mémoire
  const relue = notion.actif ? await notion.modifierTache(req.params.id, champs) : null;
  let cible = tache;
  if (tache) Object.assign(tache, champs);
  else if (relue && relue.statut !== 'Fait') d.taches = [...d.taches, (cible = relue)]; // une tâche rétablie revient dans la liste
  else cible = relue;
  res.json(publicTache(cible, d));
});

// Supprimer une tâche (mise à la corbeille de Notion : récupérable).
app.delete('/api/taches/:id', async (req, res) => {
  const d = await donnees();
  verifier(d.taches.some((t) => t.id === req.params.id) || notion.actif, 'Tâche introuvable : rafraîchis la liste.', 404);
  if (notion.actif) await notion.supprimerPage(req.params.id);
  d.taches = d.taches.filter((t) => t.id !== req.params.id);
  res.json({ ok: true });
});

// --- Projets et activités ----------------------------------------------------------------------------------
// Ce que l'écran montre d'un projet, avec de quoi pré-remplir le formulaire de modification.
const detailProjet = (p, d, t) => ({
  ...publicProjet(p), statut: p.statut, priorite: p.priorite, echeance: p.echeance, tempsCumule: p.tempsCumule, derniereActivite: p.derniereActivite,
  objectifHebdo: p.objectifHebdo, resume: p.resume || '', logoLien: p.logoLien || '', url: p.url,
  tempsSemaine: t.parProjetSemaine.get(p.id) || 0, tempsJour: t.parProjetJour.get(p.id) || 0,
  tachesOuvertes: d.taches.filter((x) => x.projetId === p.id && x.statut !== 'Fait').length,
});

// Projets et activités « En cours » (?tous=1 : tous les statuts, pour retrouver une idée, une pause, un projet terminé).
app.get('/api/projets', async (req, res) => {
  const d = await donnees();
  const t = lesTotaux(d);
  res.json(d.projets
    .filter((p) => req.query.tous || p.statut === 'En cours')
    .map((p) => detailProjet(p, d, t))
    .sort((a, b) => b.tachesOuvertes - a.tachesOuvertes || a.nom.localeCompare(b.nom, 'fr')));
});

// Les listes déroulantes des formulaires : catégories (lues dans Notion), statuts, priorités, couleurs.
const CATEGORIES_DEMO = ['École 42', 'Vidéo / vlog', 'Jeu / dev', 'Autre'];
let optionsLues = null; // { t, categories }
app.get('/api/options', async (req, res) => {
  if (notion.actif && (!optionsLues || Date.now() - optionsLues.t > 10 * 60e3)) {
    try {
      optionsLues = { t: Date.now(), categories: (await notion.lireOptions()).categories };
    } catch (err) {
      console.error('Notion (options) :', err.message);
    }
  }
  res.json({ categories: optionsLues?.categories?.length ? optionsLues.categories : CATEGORIES_DEMO, statuts: edition.STATUTS, priorites: PRIORITES, couleurs: Object.keys(COULEURS), types: edition.TYPES });
});

// Les champs d'un projet tels qu'ils sont gardés en mémoire (la couleur donne la teinte, le logo est un lien).
function appliquerProjet(p, champs) {
  const { logo, ...reste } = champs;
  Object.assign(p, reste);
  if ('couleur' in champs) p.hex = hexDe(champs.couleur);
  if ('logo' in champs) Object.assign(p, { logoLien: logo || '', logo: !!logo });
}

// Nouveau projet ou nouvelle activité (type Projet par défaut). Seul le nom est obligatoire.
async function creerProjetOuActivite(req, res, typeImpose) {
  const d = await donnees();
  const champs = edition.champsProjet({ ...req.body, ...(typeImpose && { type: typeImpose }) }, { creation: true });
  champs.type ??= 'Projet';
  verifier(!d.projets.some((p) => p.nom.toLowerCase() === champs.nom.toLowerCase() && p.statut === 'En cours'), 'Il existe déjà un projet ou une activité « En cours » avec ce nom.');
  const aEcrire = Object.fromEntries(Object.entries(champs).filter(([, v]) => v !== null && v !== ''));
  let projet;
  if (notion.actif) projet = await notion.creerProjet(aEcrire);
  else {
    projet = { id: `p-${crypto.randomUUID()}`, nom: champs.nom, type: champs.type, statut: 'En cours', categorie: null, priorite: null, couleur: null, hex: hexDe(null), echeance: null, prochaineEtape: '', derniereActivite: null, tempsCumule: 0, objectifHebdo: null, logo: false, logoLien: '', icone: '', resume: '', url: null };
    appliquerProjet(projet, aEcrire);
  }
  d.projets = [...d.projets, projet];
  res.status(201).json(detailProjet(projet, d, lesTotaux(d)));
}
app.post('/api/projets', (req, res) => creerProjetOuActivite(req, res, null));
app.post('/api/activites', (req, res) => creerProjetOuActivite(req, res, 'Activité')); // le formulaire « + Activité » : même chose, type imposé

// Modifier un projet ou une activité : nom, type, statut, catégorie, priorité, échéance, prochaine étape, objectif de la semaine
// (objectifHebdo : minutes, ou null / 0 pour l'enlever), couleur, icône, résumé, logo (un lien vers une image, ou null pour l'enlever).
// Seuls les champs envoyés changent.
app.patch('/api/projets/:id', async (req, res) => {
  const d = await donnees();
  const projet = d.projets.find((p) => p.id === req.params.id);
  verifier(projet, 'Projet introuvable : rafraîchis la liste.', 404);
  const champs = edition.champsProjet(req.body);
  verifier(Object.keys(champs).length, 'Rien à modifier.');
  if (notion.actif) await notion.modifierProjet(projet.id, champs);
  appliquerProjet(projet, champs);
  res.json(detailProjet(projet, d, lesTotaux(d)));
});

// Supprimer un projet ou une activité (corbeille de Notion : récupérable). Ses séances et ses tâches restent dans Notion.
app.delete('/api/projets/:id', async (req, res) => {
  const d = await donnees();
  verifier(d.projets.some((p) => p.id === req.params.id), 'Projet introuvable : rafraîchis la liste.', 404);
  if (notion.actif) await notion.supprimerPage(req.params.id);
  d.projets = d.projets.filter((p) => p.id !== req.params.id);
  res.json({ ok: true });
});

// --- Séances : historique, séance oubliée, corrections ---------------------------------------------------------
// Les totaux du projet et de la tâche suivent : une séance corrigée ou supprimée change le temps cumulé de la différence.
const publicSeance = (s, d) => {
  const projet = s.projetId && d.projets.find((p) => p.id === s.projetId);
  return {
    id: s.id, jour: jourDe(s.debut), debut: s.debut, duree: s.duree, bilan: s.bilan || '', origine: s.origine || null, titre: s.titre,
    projetId: s.projetId || null, projetNom: projet?.nom ?? null, projetHex: projet?.hex ?? null, tacheId: s.tacheId || null,
  };
};
const trier = (liste) => [...liste].sort((a, b) => jourDe(b.debut).localeCompare(jourDe(a.debut)) || b.debut.localeCompare(a.debut));

// Ajuste en mémoire le temps cumulé du projet et le temps passé de la tâche (jamais sous zéro).
function ajusterMemoire(d, { projetId, tacheId, delta }) {
  const projet = projetId && d.projets.find((p) => p.id === projetId);
  if (projet) projet.tempsCumule = Math.max(0, (projet.tempsCumule || 0) + delta);
  const tache = tacheId && d.taches.find((t) => t.id === tacheId);
  if (tache) tache.tempsPasse = Math.max(0, (tache.tempsPasse || 0) + delta);
}

// L'historique (45 jours par défaut, 366 au maximum), les plus récentes d'abord.
app.get('/api/seances', async (req, res) => {
  const d = await donnees();
  const jours = Math.min(366, Math.max(1, Math.round(Number(req.query.jours)) || 45));
  const depuis = ajouterJours(aujourdhui(), -jours);
  const liste = notion.actif ? await notion.lireSeances(depuis) : (d.sessions || []).filter((s) => jourDe(s.debut) >= depuis);
  res.json({ depuis, seances: trier(liste).map((s) => publicSeance(s, d)) });
});

// Séance oubliée : { jour, duree, bilan, tacheId ou projetId }. Envoyée à Notion comme une séance de chrono (origine « Ajout manuel »).
app.post('/api/seances', async (req, res) => {
  const d = await donnees();
  const champs = edition.champsSeance(req.body, aujourdhui(), { creation: true });
  const tache = req.body?.tacheId ? d.taches.find((t) => t.id === req.body.tacheId) : null;
  verifier(!req.body?.tacheId || tache, 'Tâche inconnue.');
  const projetId = tache ? tache.projetId : req.body?.projetId || null;
  const projet = projetId ? d.projets.find((p) => p.id === projetId) : null;
  verifier(!projetId || projet, 'Projet inconnu.');
  const seance = {
    id: crypto.randomUUID(), debut: champs.jour, fin: null, duree: champs.duree, tacheId: tache?.id || null, projetId: projet?.id || null,
    titre: tache?.titre || projet?.nom || 'Séance hors projet', type: tache ? 'tache' : 'projet', origine: 'Ajout manuel',
    bilan: champs.bilan || '', prochaineEtape: '', termine: false,
  };
  appliquerSeance(d, seance);
  let attente = 0;
  let erreur = null;
  if (notion.actif) {
    synchro.enfiler(seance);
    await envoyerEnAttente();
    ({ attente, erreur } = synchro.etat());
  }
  const t = lesTotaux(d);
  res.status(201).json({ ok: true, totaux: { jour: t.jour, semaine: t.semaine }, enAttente: attente > 0, erreur });
});

// Retrouve une séance (en mémoire en démo ; relue dans Notion sinon, l'historique n'étant pas gardé).
async function trouverSeance(d, id) {
  if (notion.actif) return notion.lireSeance(id);
  return (d.sessions || []).find((s) => s.id === id) || null;
}

// Corriger une séance : durée, bilan, jour.
app.patch('/api/seances/:id', async (req, res) => {
  const d = await donnees();
  const champs = edition.champsSeance(req.body, aujourdhui());
  verifier(Object.keys(champs).length, 'Rien à modifier.');
  const s = await trouverSeance(d, req.params.id);
  verifier(s, 'Séance introuvable.', 404);
  const delta = champs.duree === undefined ? 0 : champs.duree - s.duree;
  const nouveau = { duree: champs.duree, bilan: champs.bilan, debut: champs.jour === undefined ? undefined : s.debut.includes('T') ? champs.jour + s.debut.slice(10) : champs.jour };
  if (champs.duree !== undefined && /\s·\s[^·]+$/.test(s.titre || '')) nouveau.titre = `${s.titre.replace(/\s·\s[^·]+$/, '')} · ${dureeTexte(champs.duree)}`; // le titre porte la durée
  if (notion.actif) {
    await notion.modifierSeance(s.id, Object.fromEntries(Object.entries(nouveau).filter(([, v]) => v !== undefined)));
    if (delta) await notion.ajusterTemps({ projetId: s.projetId, tacheId: s.tacheId, delta });
  }
  const enMemoire = (d.sessions || []).find((x) => x.id === s.id);
  if (enMemoire) Object.assign(enMemoire, Object.fromEntries(Object.entries(nouveau).filter(([, v]) => v !== undefined)));
  if (delta) ajusterMemoire(d, { projetId: s.projetId, tacheId: s.tacheId, delta });
  res.json(publicSeance({ ...s, ...Object.fromEntries(Object.entries(nouveau).filter(([, v]) => v !== undefined)) }, d));
});

// Supprimer une séance : son temps est retiré du projet et de la tâche.
app.delete('/api/seances/:id', async (req, res) => {
  const d = await donnees();
  const s = await trouverSeance(d, req.params.id);
  verifier(s, 'Séance introuvable.', 404);
  if (notion.actif) {
    await notion.supprimerPage(s.id);
    try {
      await notion.ajusterTemps({ projetId: s.projetId, tacheId: s.tacheId, delta: -s.duree });
    } catch (err) {
      throw echec(502, `Séance supprimée, mais le temps cumulé n’a pas pu être corrigé (${err.message}).`);
    }
  }
  d.sessions = (d.sessions || []).filter((x) => x.id !== s.id);
  ajusterMemoire(d, { projetId: s.projetId, tacheId: s.tacheId, delta: -s.duree });
  res.json({ ok: true });
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

// --- Bibliothèque de musique (liens YouTube de la base Notion « Musique ») --------------------------------------
// Les lignes sont gardées 5 minutes ; la radio ne reçoit que les liens valides et non désactivés (?tout=1 : tout, pour l'écran de gestion).
let cacheMusique = null; // { t, lignes, message }
const demoMusique = bibliotheque.DEMO.map((l) => ({ ...l, desactive: false })); // démo : tout reste en mémoire
async function lignesMusique() {
  if (!notion.actif) return { lignes: demoMusique, message: null };
  if (!cacheMusique || Date.now() - cacheMusique.t > 5 * 60e3) {
    const lignes = await notion.lireMusique();
    cacheMusique = { t: Date.now(), lignes: lignes || [], message: lignes ? null : 'La base « Musique » n’est pas dans la même page que « Mes projets ».' };
  }
  return cacheMusique;
}
app.get('/api/musique', async (req, res) => {
  const { lignes, message } = await lignesMusique();
  if (req.query.tout) {
    return res.json({ message, lignes: lignes.map((l) => ({ id: l.id, titre: l.titre || 'Sans titre', lien: l.lien, desactive: !!l.desactive, valide: !!bibliotheque.analyserLien(l.lien || '') })) });
  }
  res.json({ entrees: bibliotheque.entrees(lignes), message });
});

app.post('/api/musique', async (req, res) => {
  const champs = edition.champsLien(req.body, { creation: true });
  const { lignes } = await lignesMusique();
  const ligne = notion.actif ? await notion.creerLien(champs) : { id: `m-${crypto.randomUUID()}`, ...champs, desactive: false };
  if (notion.actif) cacheMusique = null;
  else lignes.push(ligne);
  res.status(201).json(ligne);
});

app.patch('/api/musique/:id', async (req, res) => {
  const champs = edition.champsLien(req.body);
  verifier(Object.keys(champs).length, 'Rien à modifier.');
  const { lignes } = await lignesMusique();
  const ligne = lignes.find((l) => l.id === req.params.id);
  verifier(ligne, 'Lien introuvable : rafraîchis la liste.', 404);
  if (notion.actif) {
    await notion.modifierLien(ligne.id, champs);
    cacheMusique = null;
  } else Object.assign(ligne, champs);
  res.json({ ...ligne, ...champs });
});

app.delete('/api/musique/:id', async (req, res) => {
  const { lignes } = await lignesMusique();
  verifier(lignes.some((l) => l.id === req.params.id), 'Lien introuvable : rafraîchis la liste.', 404);
  if (notion.actif) {
    await notion.supprimerPage(req.params.id);
    cacheMusique = null;
  } else lignes.splice(lignes.findIndex((l) => l.id === req.params.id), 1);
  res.json({ ok: true });
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
