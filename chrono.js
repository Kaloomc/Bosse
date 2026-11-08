// Le compte à rebours, sous forme de machine à états. Fonctions pures : l'heure est toujours passée en paramètre (ms).
// L'état complet est gardé par le serveur (data/chrono.json) : si le téléphone met l'appli en veille ou si tu changes
// d'appareil, le chrono continue. Le temps travaillé = heure de fin − début − pauses (jamais un compteur qui tourne).
//
// état : { etat: 'en cours' | 'pause' | 'fini', candidat, debut, dureePrevueMs, pauseDepuis, pausesMs, fin }
const MINUTE = 60e3;
const DUREE_MIN = 1; // minutes
const DUREE_MAX = 240;

class ErreurChrono extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

function demarrer(candidat, dureeMin, maintenant) {
  if (!Number.isFinite(dureeMin) || dureeMin < DUREE_MIN || dureeMin > DUREE_MAX) throw new ErreurChrono(`Durée de ${DUREE_MIN} à ${DUREE_MAX} minutes.`, 400);
  return { etat: 'en cours', candidat, debut: maintenant, dureePrevueMs: Math.round(dureeMin) * MINUTE, pauseDepuis: null, pausesMs: 0, fin: null };
}

// Temps travaillé jusqu'à maintenant (ms), sans les pauses.
function ecoule(s, maintenant) {
  const arret = s.etat === 'fini' ? s.fin : s.etat === 'pause' ? s.pauseDepuis : maintenant;
  return Math.max(0, arret - s.debut - s.pausesMs);
}

function pause(s, maintenant) {
  if (s.etat !== 'en cours') throw new ErreurChrono('Le chrono n’est pas en cours.');
  return { ...s, etat: 'pause', pauseDepuis: maintenant };
}

function reprendre(s, maintenant) {
  if (s.etat !== 'pause') throw new ErreurChrono('Le chrono n’est pas en pause.');
  return { ...s, etat: 'en cours', pausesMs: s.pausesMs + (maintenant - s.pauseDepuis), pauseDepuis: null };
}

// « +10 min » : allonge la durée prévue.
function ajouter(s, minutes) {
  if (s.etat === 'fini') throw new ErreurChrono('Le chrono est terminé.');
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) throw new ErreurChrono('Ajout de 1 à 120 minutes.', 400);
  return { ...s, dureePrevueMs: s.dureePrevueMs + Math.round(minutes) * MINUTE };
}

// Fin de la séance (le chrono s'arrête ; le bilan suit). Terminer deux fois ne change rien.
function terminer(s, maintenant) {
  if (s.etat === 'fini') return s;
  const pausesMs = s.pausesMs + (s.etat === 'pause' ? maintenant - s.pauseDepuis : 0);
  return { ...s, etat: 'fini', pausesMs, pauseDepuis: null, fin: maintenant };
}

// Minutes travaillées, arrondies à la minute la plus proche (au moins 1 si on a travaillé un peu).
const minutes = (ms) => Math.max(ms > 0 ? 1 : 0, Math.round(ms / MINUTE));

module.exports = { MINUTE, DUREE_MIN, DUREE_MAX, ErreurChrono, demarrer, ecoule, pause, reprendre, ajouter, terminer, minutes };
