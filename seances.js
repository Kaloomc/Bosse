// Les séances de travail : totaux du jour et de la semaine, et effet d'une séance sur les données affichées.
const { aujourdhui, debutSemaine, jourDe } = require('./temps');

// Séance : { id, debut, fin, duree (min), tacheId, projetId, titre, bilan, prochaineEtape, termine, type }

// Minutes travaillées aujourd'hui et cette semaine (lundi → dimanche, heure de Paris), au total et par projet.
function totaux(sessions, auj = aujourdhui()) {
  const lundi = debutSemaine(auj);
  const r = { jour: 0, semaine: 0, parProjetSemaine: new Map(), parProjetJour: new Map() };
  const ajouter = (m, cle, min) => cle && m.set(cle, (m.get(cle) || 0) + min);
  for (const s of sessions) {
    const j = jourDe(s.debut);
    if (j < lundi || j > auj) continue;
    r.semaine += s.duree;
    ajouter(r.parProjetSemaine, s.projetId, s.duree);
    if (j === auj) {
      r.jour += s.duree;
      ajouter(r.parProjetJour, s.projetId, s.duree);
    }
  }
  return r;
}

// Applique une séance aux données en mémoire (la même chose qu'on écrit dans Notion) :
// la séance s'ajoute, le temps du projet et de la tâche augmente, la dernière activité passe à ce jour.
function appliquerSeance(d, seance) {
  const jour = jourDe(seance.fin || seance.debut);
  d.sessions = [...(d.sessions || []), { id: seance.id, debut: seance.debut, duree: seance.duree, tacheId: seance.tacheId || null, projetId: seance.projetId || null, titre: seance.titre, bilan: seance.bilan || '' }];
  const projet = seance.projetId && d.projets.find((p) => p.id === seance.projetId);
  if (projet) {
    projet.tempsCumule = (projet.tempsCumule || 0) + seance.duree;
    projet.derniereActivite = jour;
    if (seance.prochaineEtape) projet.prochaineEtape = seance.prochaineEtape;
    if (seance.termine && seance.type === 'projet') projet.statut = 'Terminé';
  }
  const tache = seance.tacheId && d.taches.find((t) => t.id === seance.tacheId);
  if (tache) {
    tache.tempsPasse = (tache.tempsPasse || 0) + seance.duree;
    tache.derniereFois = jour;
    if (seance.termine && seance.type === 'tache') tache.statut = 'Fait';
  }
}

module.exports = { totaux, appliquerSeance };
