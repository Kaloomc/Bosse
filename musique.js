// Bibliothèque de musique : des liens YouTube (playlists et vidéos) rangés dans la base Notion « Musique ».
// La radio de BOSSE ! pioche dedans pendant le chrono. Ici : lecture des liens, sans rien écrire dans Notion.

const HOTES = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);
const IDENTIFIANT = /^[\w-]{6,64}$/;

// Un lien YouTube → { type: 'video', videoId } ou { type: 'playlist', playlistId }, ou null si ce n'est pas un lien reconnu.
//  - youtube.com/watch?v=… et youtu.be/… : une vidéo (même si le lien contient aussi une liste : la vidéo seule est lue) ;
//  - youtube.com/playlist?list=… : une playlist.
function analyserLien(lien) {
  let url;
  try {
    url = new URL(String(lien).trim());
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol) || !HOTES.has(url.hostname)) return null;
  const video = url.hostname.endsWith('youtu.be') ? url.pathname.slice(1).split('/')[0] : url.searchParams.get('v');
  if (video && IDENTIFIANT.test(video)) return { type: 'video', videoId: video };
  const liste = url.searchParams.get('list');
  if (liste && IDENTIFIANT.test(liste)) return { type: 'playlist', playlistId: liste };
  return null;
}

// Lignes de la base → entrées lisibles par le lecteur (les liens invalides et les lignes « Désactivé » sont écartés).
function entrees(lignes) {
  return lignes
    .filter((l) => !l.desactive)
    .map((l) => ({ id: l.id, titre: l.titre || 'Sans titre', ...analyserLien(l.lien || '') }))
    .filter((e) => e.type);
}

// Bibliothèque du mode démo : quelques mix pour essayer (les vrais liens sont dans Notion).
const DEMO = [
  { id: 'm1', titre: 'Mac Miller 1 hour chill mix', lien: 'https://www.youtube.com/watch?v=NVx5ZJCY6w4' },
  { id: 'm2', titre: 'Mac Miller 1 Hour of Chill Songs', lien: 'https://www.youtube.com/watch?v=O7RnNTXPvvo' },
  { id: 'm3', titre: 'Playlist : best of mac miller', lien: 'https://www.youtube.com/playlist?list=PLkiZ51pp3-2b6WJBHrWh5gVJaZg5fcTPI' },
];

module.exports = { analyserLien, entrees, DEMO };
