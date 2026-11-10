// Contrôle de ce qui est saisi dans l'appli quand on crée ou modifie un projet, une activité, une tâche, une séance ou un lien de musique.
// Chaque fonction renvoie uniquement les champs présents dans la demande (pour une modification) et refuse le reste avec un message clair.
// Fonctions pures : rien n'est écrit ici.
const { COULEURS } = require('./projets');
const { analyserLien } = require('./musique');

const STATUTS = ['Idée', 'En cours', 'En pause', 'Terminé'];
const PRIORITES = ['Haute', 'Moyenne', 'Basse'];
const TYPES = ['Projet', 'Activité'];
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

const refuser = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
const present = (corps, cle) => Object.hasOwn(corps ?? {}, cle);

const texte = (v, max, nom) => {
  const s = String(v ?? '').trim();
  if (s.length > max) refuser(`${nom} : ${max} caractères au maximum.`);
  return s;
};
const jourOuNull = (v, nom) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !JOUR.test(v) || Number.isNaN(Date.parse(v))) refuser(`${nom} : date invalide.`);
  return v;
};
const choixOuNull = (v, liste, nom) => {
  if (v == null || v === '') return null;
  if (!liste.includes(v)) refuser(`${nom} inconnu.`);
  return v;
};
const minutes = (v, min, max, nom) => {
  const n = Math.round(Number(v));
  if (v === '' || v === null || typeof v === 'boolean' || !Number.isFinite(n) || n < min || n > max) refuser(`${nom} : de ${min} à ${max} minutes.`);
  return n;
};
const lienImage = (v) => {
  if (v == null || v === '') return null;
  let url;
  try {
    url = new URL(String(v).trim());
  } catch {
    return refuser('Logo : ce n’est pas un lien.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.href.length > 2000) refuser('Logo : lien http(s) de 2000 caractères au maximum.');
  return url.href;
};

// Projet ou activité. creation : le nom est obligatoire. Renvoie les champs à écrire (null = vider le champ).
function champsProjet(corps, { creation = false } = {}) {
  const c = {};
  if (creation || present(corps, 'nom')) {
    c.nom = texte(corps?.nom, 100, 'Nom');
    if (!c.nom) refuser('Donne un nom.');
  }
  if (present(corps, 'type')) {
    if (!TYPES.includes(corps.type)) refuser('Type : Projet ou Activité.');
    c.type = corps.type;
  }
  if (present(corps, 'statut')) {
    if (!STATUTS.includes(corps.statut)) refuser('Statut inconnu.');
    c.statut = corps.statut;
  }
  if (present(corps, 'categorie')) c.categorie = texte(corps.categorie, 60, 'Catégorie') || null;
  if (present(corps, 'priorite')) c.priorite = choixOuNull(corps.priorite, PRIORITES, 'Priorité');
  if (present(corps, 'echeance')) c.echeance = jourOuNull(corps.echeance, 'Échéance');
  if (present(corps, 'prochaineEtape')) c.prochaineEtape = texte(corps.prochaineEtape, 500, 'Prochaine étape');
  if (present(corps, 'objectifHebdo')) {
    const v = corps.objectifHebdo;
    c.objectifHebdo = v === null || v === '' || v === 0 ? null : minutes(v, 15, 3000, 'Objectif de la semaine');
  }
  if (present(corps, 'couleur')) c.couleur = choixOuNull(corps.couleur, Object.keys(COULEURS), 'Couleur');
  if (present(corps, 'icone')) c.icone = texte(corps.icone, 8, 'Icône');
  if (present(corps, 'resume')) c.resume = texte(corps.resume, 2000, 'Résumé');
  if (present(corps, 'logo')) c.logo = lienImage(corps.logo);
  return c;
}

// Tâche. « fait » (vrai / faux) devient le statut « Fait » / « À faire » ; « statut » choisit un des statuts de la base
// (statuts : la liste lue dans Notion, par ex. À faire, En cours, Fait, Bloquée). Le projet est vérifié par le serveur (il doit exister).
function champsTache(corps, { statuts = ['À faire', 'Fait'] } = {}) {
  const c = {};
  if (present(corps, 'titre')) {
    c.titre = texte(corps.titre, 200, 'Titre');
    if (!c.titre) refuser('Donne un titre à la tâche.');
  }
  if (present(corps, 'projetId')) c.projetId = corps.projetId || null;
  if (present(corps, 'duree')) c.duree = minutes(corps.duree, 5, 240, 'Durée');
  if (present(corps, 'priorite')) c.priorite = choixOuNull(corps.priorite, PRIORITES, 'Priorité');
  if (present(corps, 'echeance')) c.echeance = jourOuNull(corps.echeance, 'Échéance');
  if (present(corps, 'notes')) c.notes = texte(corps.notes, 2000, 'Notes');
  if (present(corps, 'fait')) {
    if (typeof corps.fait !== 'boolean') refuser('« fait » : vrai ou faux.');
    c.statut = corps.fait ? 'Fait' : 'À faire';
  }
  if (present(corps, 'statut')) {
    if (!statuts.includes(corps.statut)) refuser(`Statut inconnu (${statuts.join(', ')}).`);
    c.statut = corps.statut;
  }
  return c;
}

// Séance : durée, bilan, jour (pas dans le futur, pas plus d'un an en arrière).
function champsSeance(corps, aujourdhui, { creation = false } = {}) {
  const c = {};
  if (creation || present(corps, 'duree')) c.duree = minutes(corps?.duree, 1, 600, 'Durée');
  if (present(corps, 'bilan')) c.bilan = texte(corps.bilan, 2000, 'Bilan');
  if (creation || present(corps, 'jour')) {
    const j = jourOuNull(corps?.jour, 'Jour');
    if (!j) refuser('Indique le jour de la séance.');
    if (j > aujourdhui) refuser('Le jour de la séance ne peut pas être dans le futur.');
    if (Date.parse(aujourdhui) - Date.parse(j) > 366 * 864e5) refuser('Le jour de la séance est trop ancien (un an au maximum).');
    c.jour = j;
  }
  return c;
}

// Lien de musique : un lien YouTube (vidéo ou playlist), un titre, et la case « désactivé ».
function champsLien(corps, { creation = false } = {}) {
  const c = {};
  if (creation || present(corps, 'titre')) c.titre = texte(corps?.titre, 200, 'Titre') || 'Sans titre';
  if (creation || present(corps, 'lien')) {
    const lien = texte(corps?.lien, 500, 'Lien');
    if (!analyserLien(lien)) refuser('Ce lien n’est pas une vidéo ou une playlist YouTube.');
    c.lien = lien;
  }
  if (present(corps, 'desactive')) {
    if (typeof corps.desactive !== 'boolean') refuser('« desactive » : vrai ou faux.');
    c.desactive = corps.desactive;
  }
  return c;
}

module.exports = { STATUTS, PRIORITES, TYPES, champsProjet, champsTache, champsSeance, champsLien };
