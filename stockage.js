// Fichiers JSON dans data/ (ignoré par Git) : l'état du chrono et les envois en attente vers Notion.
const fs = require('fs');
const path = require('path');

const dossier = () => process.env.DOSSIER_DONNEES || path.join(__dirname, 'data'); // autre dossier : pour les tests

function lire(nom, defaut = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dossier(), nom), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return defaut;
    throw err; // fichier abîmé : on s'arrête plutôt que de l'écraser
  }
}

function ecrire(nom, valeur) {
  fs.mkdirSync(dossier(), { recursive: true });
  const f = path.join(dossier(), nom);
  fs.writeFileSync(f + '.tmp', JSON.stringify(valeur, null, 1));
  fs.renameSync(f + '.tmp', f); // remplacement d'un coup : jamais de fichier à moitié écrit
}

module.exports = { lire, ecrire };
