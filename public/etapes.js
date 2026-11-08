// Découper un gros chantier en étapes d'environ 30 minutes.
// On écrit une étape par ligne (avec ou sans puce ou numéro) ; une durée facultative peut suivre entre parenthèses :
//   Brancher le serveur temps réel (2 h)
//   - Acheter le nom de domaine (15 min)
//   3. Tester avec 8 téléphones (1h30)
// Sans durée : 30 minutes. Une étape de plus de 45 minutes peut être coupée en blocs d'environ 30 minutes
// (« Brancher le serveur (1/4) »… « (4/4) »), pour que chaque tâche tienne dans une séance.
// Ce fichier sert à l'écran (aperçu en direct) et aux tests : il ne dépend de rien d'autre.

const DUREE_ETAPE = 30; // minutes
const SEUIL_COUPE = 45; // au-dessus, on propose de couper
const MAX_BLOCS = 8;

// « 45 », « 45 min », « 1 h », « 1h30 », « 1 h 30 », « 1,5 h » → minutes ; null si ce n'est pas une durée.
function lireDuree(texte) {
  const t = String(texte).trim().toLowerCase().replace(',', '.');
  let m = /^(\d+(?:\.\d+)?)\s*(?:h|heures?)\s*(\d{1,2})?\s*(?:min|mn|minutes?)?$/.exec(t);
  if (m) return Math.round(parseFloat(m[1]) * 60 + (m[2] ? Number(m[2]) : 0));
  m = /^(\d+)\s*(?:min|mn|minutes?)?$/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

// Texte → { etapes: [{ titre, duree }], total (minutes) }. Les lignes vides sont ignorées.
function analyserEtapes(texte, { couper = true } = {}) {
  const etapes = [];
  for (const brut of String(texte).split(/\r?\n/)) {
    let ligne = brut.trim().replace(/^(?:[-*•–]|\d+[.)])\s*/, '').replace(/^\[[ xX]?\]\s*/, '').trim(); // puce, numéro, case à cocher
    if (!ligne) continue;
    let duree = DUREE_ETAPE;
    const fin = /\(([^()]*)\)\s*$/.exec(ligne);
    const lue = fin ? lireDuree(fin[1]) : null;
    if (lue !== null && lue >= 5) {
      duree = Math.min(240, lue);
      ligne = ligne.slice(0, fin.index).trim();
    }
    const titre = (ligne || 'Étape').slice(0, 190);
    if (couper && duree > SEUIL_COUPE) {
      const n = Math.min(MAX_BLOCS, Math.max(2, Math.round(duree / DUREE_ETAPE)));
      const bloc = Math.max(5, Math.round(duree / n / 5) * 5);
      for (let i = 1; i <= n; i++) etapes.push({ titre: `${titre} (${i}/${n})`, duree: bloc });
    } else {
      etapes.push({ titre, duree });
    }
  }
  return { etapes, total: etapes.reduce((s, e) => s + e.duree, 0) };
}

if (typeof module !== 'undefined') module.exports = { analyserEtapes, lireDuree, DUREE_ETAPE, SEUIL_COUPE };
