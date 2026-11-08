// Données fictives du mode démo (sans NOTION_TOKEN) : mêmes formes que ce que renvoie notion.js.
// Les dates sont calculées par rapport à aujourd'hui pour que le choix de l'action reste intéressant.
const { ajouterJours } = require('./temps');
const { hexDe } = require('./projets');

module.exports = function demo(aujourdhui) {
  const il = (n) => ajouterJours(aujourdhui, -n);
  const dans = (n) => ajouterJours(aujourdhui, n);
  const projet = (id, nom, extra) => ({
    id, nom, type: 'Projet', statut: 'En cours', categorie: null, priorite: null, couleur: 'Bleu', hex: hexDe('Bleu'), echeance: null,
    prochaineEtape: '', derniereActivite: null, tempsCumule: 0, objectifHebdo: null, logo: false, icone: '', url: null, ...extra,
  });
  const projets = [
    projet('p-42', 'Tronc commun 42', { categorie: 'École 42', priorite: 'Haute', couleur: 'Jaune', hex: hexDe('Jaune'), objectifHebdo: 600 }),
    projet('p-gorgee', 'Gorgée', { categorie: 'Jeu / dev', couleur: 'Violet', hex: hexDe('Violet'), derniereActivite: il(22), tempsCumule: 39, objectifHebdo: 180 }),
    projet('p-taotl', 'Taotl', { categorie: 'Autre', couleur: 'Vert', hex: hexDe('Vert'), derniereActivite: il(22), tempsCumule: 207, prochaineEtape: 'finir les animations' }),
    projet('p-vlog', 'Montage du dernier vlog', { categorie: 'Vidéo / vlog', couleur: 'Rose', hex: hexDe('Rose') }),
    projet('p-lire', 'Lire', { type: 'Activité', couleur: 'Turquoise', hex: hexDe('Turquoise'), objectifHebdo: 120, prochaineEtape: 'Lire un chapitre' }),
    projet('p-pause', 'Projet en pause', { statut: 'En pause', couleur: 'Orange', hex: hexDe('Orange') }),
  ];
  const tache = (id, titre, projetId, extra) => ({
    id, titre, projetId, statut: 'À faire', priorite: null, echeance: null, duree: 30, tempsPasse: 0, derniereFois: null, notes: '', url: null, ...extra,
  });
  const taches = [
    tache('t1', 'ft_irc : partie réseau (en binôme)', 'p-42', { priorite: 'Haute' }),
    tache('t2', 'Inception', 'p-42', { priorite: 'Haute' }),
    tache('t3', 'Réviser l’Exam Rank 05', 'p-42', { priorite: 'Haute', echeance: dans(6) }),
    tache('t4', 'Gorgée : finaliser le jeu', 'p-gorgee', { priorite: 'Moyenne' }),
    tache('t5', 'Gorgée : agent Claude testeur (jouabilité et design)', 'p-gorgee', { priorite: 'Moyenne' }),
    tache('t6', 'Gorgée : nom de domaine gorgee.fr (OVH)', 'p-gorgee', { priorite: 'Basse' }),
    tache('t7', 'Ranger le bureau', null, {}),
    tache('t8', 'Appeler la banque', null, { priorite: 'Moyenne', echeance: dans(2) }),
    tache('t9', 'Tâche d’un projet en pause', 'p-pause', {}),
  ];
  // Séances de la semaine (la veille et aujourd'hui) : pour voir le retard hebdo et les totaux dans la démo.
  const sessions = [
    { id: 's1', debut: il(1), duree: 30, tacheId: 't4', projetId: 'p-gorgee', titre: 'Gorgée : finaliser le jeu', bilan: '' },
  ];
  return { projets, taches, sessions };
};
