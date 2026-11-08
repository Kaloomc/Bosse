// Le message d'encouragement de fin de séance. Des règles et des phrases : pas de modèle d'IA, donc gratuit,
// instantané et toujours exact (les chiffres viennent des séances enregistrées).
//
// Ordre de priorité du message principal :
//   1. objectif de la semaine atteint avec cette séance ;
//   2. objectif tout proche (45 minutes ou moins) ;
//   3. première séance de la journée ;
//   4. sinon, un simple bravo. Les totaux du jour et de la semaine suivent toujours.
const { duree } = require('./projets');

const PROCHE = 45; // minutes : en dessous, on dit « plus que … »

// Une variante parmi plusieurs, toujours la même pour une même séance (testable, sans hasard).
const variante = (liste, graine) => liste[[...String(graine)].reduce((s, c) => s + c.charCodeAt(0), 0) % liste.length];

// ctx : {
//   duree          minutes de cette séance
//   projet         { nom, objectifHebdo } du projet de la séance, ou null (tâche hors projet)
//   titre          titre de la tâche (ou de l'action)
//   tacheTerminee, projetTermine   cases cochées au bilan
//   totaux         { jour, semaine } en minutes, cette séance comprise
//   projetSemaine  minutes de la semaine sur ce projet, cette séance comprise
//   projetsSemaine [{ nom, minutes }] tous les projets de la semaine, du plus travaillé au moins travaillé
//   graine         identifiant de la séance (choisit les variantes)
// }
function construire(ctx) {
  const { projet, totaux } = ctx;
  const objectif = projet?.objectifHebdo || null;
  const reste = objectif ? objectif - ctx.projetSemaine : null;
  const atteintMaintenant = objectif && ctx.projetSemaine - ctx.duree < objectif && ctx.projetSemaine >= objectif;
  const premiereDuJour = totaux.jour - ctx.duree <= 0;
  const lignes = [];

  if (ctx.tacheTerminee) lignes.push(`Tâche terminée : ${ctx.titre}.`);
  if (ctx.projetTermine && projet) lignes.push(`Projet terminé : ${projet.nom}.`);

  let titre;
  if (atteintMaintenant) {
    titre = variante(['Objectif atteint !', 'Objectif de la semaine atteint', 'Mission accomplie'], ctx.graine);
    lignes.push(`Tu as atteint ton objectif de la semaine sur ${projet.nom} (${duree(ctx.projetSemaine)} sur ${duree(objectif)}). Tout le reste est du bonus.`);
  } else if (objectif && reste > 0 && reste <= PROCHE) {
    titre = variante(['Presque !', 'Tu y es presque', 'Dernière ligne droite'], ctx.graine);
    lignes.push(`Plus que ${duree(reste)} pour atteindre ton objectif de la semaine sur ${projet.nom}.`);
  } else if (premiereDuJour) {
    titre = variante(['Première séance du jour : bravo', 'C’est lancé, bravo', 'Le plus dur est fait'], ctx.graine);
  } else {
    titre = variante(['Bien joué !', 'Beau travail', 'Séance validée', 'Ça avance'], ctx.graine);
  }

  // « Tu as travaillé 2 h aujourd'hui, 6 h cette semaine, dont 3 h sur ft_irc. » : « dont » = le projet de la séance, sinon le plus travaillé.
  const dont = (projet && ctx.projetsSemaine.find((p) => p.nom === projet.nom)) || ctx.projetsSemaine[0];
  lignes.push(`Tu as travaillé ${duree(totaux.jour)} aujourd’hui, ${duree(totaux.semaine)} cette semaine${dont ? `, dont ${duree(dont.minutes)} sur ${dont.nom}` : ''}.`);

  if (objectif && !atteintMaintenant) {
    if (reste > PROCHE) lignes.push(`Objectif ${projet.nom} : il te reste ${duree(reste)} cette semaine.`);
    else if (reste <= 0) lignes.push(`L’objectif de la semaine sur ${projet.nom} est déjà atteint.`);
  }
  return { titre, lignes, objectifAtteint: !!atteintMaintenant };
}

module.exports = { construire, PROCHE };
