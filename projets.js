// Couleurs des projets : la propriété « Couleur » de Notion est traduite en teinte lumineuse pour le fond sombre.
const COULEURS = {
  Bleu: '#4da3ff',
  Orange: '#ff9f43',
  Turquoise: '#2de2d0',
  Jaune: '#ffd84d',
  Rose: '#ff6fb5',
  Vert: '#5be37d',
  Violet: '#a78bfa',
  Rouge: '#ff5c6c',
};
const COULEUR_DEFAUT = '#8b93ff'; // projet sans couleur, et tâche hors projet

const hexDe = (nom) => COULEURS[nom] || COULEUR_DEFAUT;

// Minutes → "1 h 05", "45 min".
function duree(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  return reste ? `${h} h ${String(reste).padStart(2, '0')}` : `${h} h`;
}

module.exports = { COULEURS, COULEUR_DEFAUT, hexDe, duree };
