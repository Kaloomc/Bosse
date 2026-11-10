// Choix de « l'action du moment ». Fonctions pures (aucun accès à Notion ni à l'horloge) : faciles à tester.
//
// Chaque candidat reçoit un score de 0 à 100 :
//   échéance 40 · ancienneté de la dernière fois 20 · priorité 20 · retard sur l'objectif hebdo 20.
// Le candidat au meilleur score est proposé, avec les raisons de ce choix.
const { joursEntre, indiceJourSemaine } = require('./temps');
const { duree } = require('./projets');

const POIDS = { echeance: 40, anciennete: 20, priorite: 20, retard: 20 };
const PRIORITE = { Haute: 1, Moyenne: 0.5, Basse: 0 };
const DUREE_DEFAUT = 30; // minutes
const JOURS_ANCIENNETE_MAX = 14;
const MALUS_OBJECTIF_ATTEINT = 50;
const MALUS_DEJA_TRAVAILLE = 20;
const SEUIL_DEJA_TRAVAILLE = 60; // minutes

// Échéance : plus elle approche, plus ça compte. Pas d'échéance = 0.
function partEcheance(jours) {
  if (jours == null) return 0;
  if (jours <= 0) return 1;
  if (jours <= 3) return 0.9;
  if (jours <= 7) return 0.7;
  if (jours <= 14) return 0.4;
  if (jours <= 30) return 0.15;
  return 0.05;
}

// Ancienneté : 14 jours sans y toucher = maximum. Jamais travaillé = maximum.
const partAnciennete = (jours) => (jours == null ? 1 : Math.min(1, Math.max(0, jours) / JOURS_ANCIENNETE_MAX));

// Retard sur l'objectif de la semaine : on « attend » une part de l'objectif proportionnelle au jour
// (lundi 1/7 … dimanche 7/7) ; le retard est ce qui manque, en part de l'objectif (0 à 1).
function retardHebdo({ objectif, fait, indiceJour }) {
  if (!objectif || objectif <= 0 || fait == null) return 0;
  const attendu = (objectif * (indiceJour + 1)) / 7;
  return Math.min(1, Math.max(0, (attendu - fait) / objectif));
}

const plusTot = (a, b) => (a && b ? (a < b ? a : b) : a || b || null);
const plusRecent = (a, b) => (a && b ? (a > b ? a : b) : a || b || null);

// Transforme les projets « En cours » et les tâches à faire en liste de candidats.
//  - une tâche d'un projet qui n'est pas « En cours » n'est pas proposée ;
//  - un projet « En cours » sans tâche ouverte est proposé lui-même (son action = sa prochaine étape).
function candidats(projets, taches) {
  const actifs = new Map(projets.filter((p) => p.statut === 'En cours').map((p) => [p.id, p]));
  const sortie = [];
  const avecTache = new Set();
  taches.forEach((t, i) => {
    if (t.statut === 'Fait' || t.statut === 'Bloquée') return; // terminée, ou bloquée : pas proposée comme action
    const projet = t.projetId ? actifs.get(t.projetId) : null;
    if (t.projetId && !projet) return;
    if (projet) avecTache.add(projet.id);
    sortie.push({
      type: 'tache', id: t.id, titre: t.titre, duree: t.duree || DUREE_DEFAUT, projet: projet || null,
      echeance: plusTot(t.echeance, projet?.echeance), priorite: t.priorite || projet?.priorite || null,
      derniere: plusRecent(t.derniereFois, projet?.derniereActivite), ordre: i, url: t.url, notes: t.notes || '',
    });
  });
  let n = taches.length;
  for (const p of actifs.values()) {
    if (avecTache.has(p.id)) continue;
    sortie.push({
      type: 'projet', id: `projet:${p.id}`, titre: p.prochaineEtape || (p.type === 'Activité' ? p.nom : `Avancer sur ${p.nom}`), duree: DUREE_DEFAUT, projet: p,
      echeance: p.echeance, priorite: p.priorite, derniere: p.derniereActivite, ordre: n++, url: p.url, notes: '',
    });
  }
  return sortie;
}

// Score d'un candidat et raisons, de la plus importante à la moins importante.
// ctx : { aujourdhui: "2026-11-07", semaine?: Map(idProjet → minutes cette semaine), jour?: Map(idProjet → minutes aujourd'hui) }
// Sans « semaine » (temps de la semaine inconnu), le retard hebdo et l'objectif atteint ne sont pas comptés.
function noter(c, ctx) {
  const raisons = [];
  const jEch = c.echeance ? joursEntre(ctx.aujourdhui, c.echeance) : null;
  const ptsEch = POIDS.echeance * partEcheance(jEch);
  if (jEch != null && ptsEch > 0) {
    raisons.push({ pts: ptsEch + 1000, texte: jEch < 0 ? `Échéance dépassée de ${-jEch} jour${-jEch > 1 ? 's' : ''}` : jEch === 0 ? 'Échéance aujourd’hui' : jEch === 1 ? 'Échéance demain' : `Échéance dans ${jEch} jours` });
  }

  let ptsRetard = 0;
  const objectif = c.projet?.objectifHebdo;
  if (objectif && ctx.semaine) {
    const fait = ctx.semaine.get(c.projet.id) || 0;
    const r = retardHebdo({ objectif, fait, indiceJour: indiceJourSemaine(ctx.aujourdhui) });
    ptsRetard = POIDS.retard * r;
    if (r > 0) raisons.push({ pts: ptsRetard + 500, texte: `${duree(fait)} sur ${duree(objectif)} cette semaine` });
  }

  const jAnc = c.derniere ? joursEntre(c.derniere, ctx.aujourdhui) : null;
  const ptsAnc = POIDS.anciennete * partAnciennete(jAnc);
  if (jAnc == null) raisons.push({ pts: ptsAnc, texte: 'Pas encore travaillé' });
  else if (jAnc >= 3) raisons.push({ pts: ptsAnc, texte: `Pas touché depuis ${jAnc} jours` });

  const ptsPrio = POIDS.priorite * (PRIORITE[c.priorite] ?? 0);
  if (c.priorite === 'Haute') raisons.push({ pts: ptsPrio, texte: 'Priorité haute' });

  // Ajustements : objectif de la semaine atteint → bien derrière ceux qui ont du retard ;
  // déjà une heure ou plus aujourd'hui sur ce projet → on tourne (sauf échéance dépassée).
  let malus = 0;
  if (objectif && ctx.semaine && (ctx.semaine.get(c.projet.id) || 0) >= objectif) {
    malus -= MALUS_OBJECTIF_ATTEINT;
    raisons.push({ pts: -1, texte: 'Objectif de la semaine atteint' });
  }
  if (c.projet && ctx.jour && (ctx.jour.get(c.projet.id) || 0) >= SEUIL_DEJA_TRAVAILLE && !(jEch != null && jEch <= 0)) {
    malus -= MALUS_DEJA_TRAVAILLE;
    raisons.push({ pts: -2, texte: `Déjà ${duree(ctx.jour.get(c.projet.id))} aujourd’hui` });
  }

  const score = Math.min(100, Math.max(0, Math.round(ptsEch + ptsRetard + ptsAnc + ptsPrio + malus)));
  raisons.sort((a, b) => b.pts - a.pts);
  return { score, raisons: raisons.map((r) => r.texte) };
}

// Candidats notés et triés : meilleur score d'abord ; à égalité, échéance la plus proche, puis ordre de création.
function classer(liste, ctx) {
  return liste
    .map((c) => ({ ...c, ...noter(c, ctx) }))
    .sort((a, b) => b.score - a.score || (a.echeance || '9999').localeCompare(b.echeance || '9999') || a.ordre - b.ordre);
}

// Le choix à afficher. « exclus » = ce que l'utilisateur a déjà refusé avec « Autre chose ».
// On préfère un autre projet que ceux déjà refusés (sinon on tournerait dans les tâches d'un même projet),
// puis, à défaut, n'importe quel candidat non refusé. Quand tout a été refusé : retour au premier, avec toutVu.
function proposer(classement, exclus = []) {
  const refus = new Set(exclus);
  const projetsRefuses = new Set(classement.filter((c) => refus.has(c.id) && c.projet).map((c) => c.projet.id));
  const reste = classement.filter((c) => !refus.has(c.id));
  const neuf = reste.filter((c) => !c.projet || !projetsRefuses.has(c.projet.id));
  const action = neuf[0] || reste[0] || null;
  if (!action) return { action: classement[0] || null, restantes: 0, toutVu: classement.length > 0 };
  return { action, restantes: reste.length - 1, toutVu: false };
}

// --- La roue ------------------------------------------------------------------------------------------
// La roue tire un PROJET (ou « Hors projet » pour les tâches sans projet), pas une tâche : sinon un projet qui a neuf
// tâches occuperait neuf parts. Une fois le projet tiré, on propose sa meilleure tâche (celle de l'action du moment).
//
// Poids d'une part : 1 + 4 × retard sur l'objectif hebdo + 2 × ancienneté + 2 × échéance.
// Un projet en gros retard a donc jusqu'à 5 fois plus de chances qu'un projet à jour (sans objectif, ni échéance, ni
// ancienneté : poids 1). Un projet qui a atteint son objectif de la semaine garde une petite chance (0,3).
const POIDS_OBJECTIF_ATTEINT = 0.3;

// Regroupe un classement (voir `classer`) par projet et donne à chaque groupe son poids et sa probabilité.
// Les groupes sont triés du plus probable au moins probable. Chaque groupe garde ses candidats, meilleur score d'abord.
function groupes(classement, ctx) {
  const parCle = new Map();
  for (const c of classement) {
    const cle = c.projet ? c.projet.id : 'libre';
    if (!parCle.has(cle)) parCle.set(cle, []);
    parCle.get(cle).push(c);
  }
  const indiceJour = indiceJourSemaine(ctx.aujourdhui);
  const liste = [...parCle].map(([cle, candidats]) => {
    const projet = candidats[0].projet;
    const objectif = projet?.objectifHebdo || null;
    const fait = objectif && ctx.semaine ? ctx.semaine.get(projet.id) || 0 : null;
    const retard = fait == null ? 0 : retardHebdo({ objectif, fait, indiceJour });
    const atteint = fait != null && fait >= objectif;
    const derniere = candidats.map((c) => c.derniere).filter(Boolean).sort().at(-1) ?? null; // le travail le plus récent du groupe
    const anciennete = partAnciennete(derniere ? joursEntre(derniere, ctx.aujourdhui) : null);
    const echeance = Math.max(...candidats.map((c) => (c.echeance ? partEcheance(joursEntre(ctx.aujourdhui, c.echeance)) : 0)));
    const poids = atteint ? POIDS_OBJECTIF_ATTEINT : 1 + 4 * retard + 2 * anciennete + 2 * echeance;
    return { cle, projet, candidats, poids, retard, atteint };
  });
  const total = liste.reduce((s, g) => s + g.poids, 0);
  return liste
    .map((g) => ({ ...g, probabilite: g.poids / total }))
    .sort((a, b) => b.poids - a.poids || (a.projet?.nom || '~').localeCompare(b.projet?.nom || '~', 'fr'));
}

// Tire un groupe au hasard, avec des chances proportionnelles aux poids. rng() : nombre de 0 (compris) à 1 (exclu).
function tirer(liste, rng = Math.random) {
  if (!liste.length) return -1;
  let reste = rng() * liste.reduce((s, g) => s + g.poids, 0);
  for (let i = 0; i < liste.length; i++) {
    reste -= liste[i].poids;
    if (reste < 0) return i;
  }
  return liste.length - 1;
}

module.exports = { POIDS, POIDS_OBJECTIF_ATTEINT, DUREE_DEFAUT, partEcheance, partAnciennete, retardHebdo, candidats, noter, classer, proposer, groupes, tirer };
