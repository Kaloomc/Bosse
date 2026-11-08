// Envoi des séances vers Notion, avec un fichier d'attente (data/attente.json) : si Notion est injoignable en fin de séance,
// la séance est gardée et renvoyée plus tard : le temps n'est jamais perdu.
// Une séance = trois écritures, faites dans l'ordre : la ligne dans « Sessions de travail », le projet, la tâche.
// Le fichier retient celles qui sont déjà faites : un nouvel essai ne recrée jamais une séance en double.
const stockage = require('./stockage');
const { jourDe } = require('./temps');

const FICHIER = 'attente.json';
let chaine = Promise.resolve();
const etatEnvoi = { derniereReussite: null };

const file = () => stockage.lire(FICHIER, []);

function enfiler(seance) {
  stockage.ecrire(FICHIER, [...file(), { id: seance.id, creeLe: new Date().toISOString(), seance, faits: { session: null, projet: false, tache: false }, erreur: null }]);
}

async function vider(depot) {
  const f = file();
  while (f.length) {
    const it = f[0];
    const s = it.seance;
    const jour = jourDe(s.fin || s.debut);
    try {
      if (!it.faits.session) {
        it.faits.session = await depot.creerSession(s);
        stockage.ecrire(FICHIER, f);
      }
      if (s.projetId && !it.faits.projet) {
        await depot.majProjet(s.projetId, { duree: s.duree, jour, prochaineEtape: s.prochaineEtape || null, termine: !!s.termine && s.type === 'projet' });
        it.faits.projet = true;
        stockage.ecrire(FICHIER, f);
      }
      if (s.tacheId && !it.faits.tache) {
        await depot.majTache(s.tacheId, { duree: s.duree, jour, fait: !!s.termine && s.type === 'tache' });
        it.faits.tache = true;
        stockage.ecrire(FICHIER, f);
      }
      f.shift();
      it.erreur = null;
      stockage.ecrire(FICHIER, f);
      etatEnvoi.derniereReussite = new Date().toISOString();
    } catch (err) {
      console.error('Notion (envoi de séance) :', err.message);
      it.erreur = err.message;
      stockage.ecrire(FICHIER, f);
      return; // on réessaiera plus tard
    }
  }
}

// Envoie ce qui attend. Les appels s'enchaînent : jamais deux envois en même temps.
function traiter(depot) {
  chaine = chaine.then(() => vider(depot)).catch((err) => console.error('Synchro :', err));
  return chaine;
}

function etat() {
  const f = file();
  return { attente: f.length, erreur: f[0]?.erreur ?? null, derniereReussite: etatEnvoi.derniereReussite };
}

module.exports = { enfiler, traiter, etat };
