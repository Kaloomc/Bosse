// La petite radio : un lecteur YouTube intégré qui pioche dans la bibliothèque (base Notion « Musique »).
// Une playlist est lue en ordre aléatoire ; une vidéo, jusqu'au bout, puis une autre est tirée au hasard.
// « Suivante » passe au morceau suivant d'une playlist, ou tire un autre élément de la bibliothèque.
//
// YouTube décide si le son peut démarrer tout seul : sur ordinateur, le clic sur « Lancer le chrono » suffit ;
// sur iPhone, Safari peut exiger un appui sur le bouton ▶ du lecteur. Dans ce cas `bloque` passe à vrai et l'écran le dit.
const Radio = (() => {
  const ETATS = { FINI: 0, LECTURE: 1, PAUSE: 2, MISE_EN_MEMOIRE: 3 };
  let chargementApi = null;
  let creation = null;
  let joueur = null;
  let biblio = null;
  let courant = null;
  let coupe = false;
  let erreursDeSuite = 0;
  let minuteurBlocage = null;
  let jouaitALEcran = false; // la musique jouait-elle quand l'écran était allumé ?
  let ecouteur = () => {};
  const etat = { actif: false, joue: false, bloque: false, titre: '', erreur: null };
  const prevenir = () => ecouteur({ ...etat, coupe });

  // Le script de YouTube n'est chargé qu'au premier besoin.
  function chargerApi() {
    chargementApi ??= new Promise((ok, ko) => {
      if (window.YT?.Player) return ok();
      window.onYouTubeIframeAPIReady = ok;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { chargementApi = null; ko(new Error('YouTube est injoignable : pas de musique pour le moment.')); };
      document.head.append(s);
    });
    return chargementApi;
  }

  function creerJoueur() {
    creation ??= new Promise((ok, ko) => {
      try {
        joueur = new YT.Player('lecteur-yt', {
          host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
          events: { onReady: () => ok(), onStateChange: surEtat, onError: surErreur },
        });
      } catch (e) {
        creation = null;
        ko(e);
      }
    });
    return creation;
  }

  async function bibliotheque() {
    if (!biblio) {
      const r = await api('/api/musique');
      biblio = r.entrees;
      if (!biblio.length) throw new Error(r.message || 'Bibliothèque vide : ajoute des liens dans la base « Musique » de Notion.');
    }
    return biblio;
  }

  const tirer = (sauf) => {
    const autres = biblio.filter((e) => e.id !== sauf?.id);
    const liste = autres.length ? autres : biblio;
    return liste[Math.floor(Math.random() * liste.length)];
  };

  function lire(entree) {
    courant = entree;
    etat.titre = entree.titre;
    etat.bloque = false;
    if (entree.type === 'playlist') {
      joueur.loadPlaylist({ list: entree.playlistId, listType: 'playlist', index: 0 });
      joueur.setShuffle(true);
      joueur.setLoop(true);
    } else {
      joueur.loadVideoById(entree.videoId);
    }
    if (coupe) joueur.mute();
    // Si rien ne joue au bout de 2 secondes, le navigateur a bloqué le démarrage automatique.
    clearTimeout(minuteurBlocage);
    minuteurBlocage = setTimeout(() => {
      if (etat.actif && !etat.joue && !etat.erreur) { etat.bloque = true; prevenir(); }
    }, 2000);
    prevenir();
  }

  function surEtat(e) {
    etat.joue = e.data === ETATS.LECTURE || e.data === ETATS.MISE_EN_MEMOIRE;
    if (document.visibilityState === 'visible') jouaitALEcran = etat.joue; // l'état « voulu » : celui d'avant la mise en veille
    if (e.data === ETATS.LECTURE) { etat.bloque = false; erreursDeSuite = 0; }
    if (e.data === ETATS.FINI && courant?.type === 'video') suivante();
    prevenir();
  }

  // Vidéo supprimée ou intégration interdite : on passe à une autre (trois essais de suite au maximum).
  function surErreur() {
    if (++erreursDeSuite > 3) {
      etat.erreur = 'Ces vidéos ne peuvent pas être lues ici : vérifie les liens de la base « Musique ».';
      prevenir();
      return;
    }
    suivante();
  }

  async function demarrer() {
    if (etat.actif) return;
    etat.actif = true;
    etat.erreur = null;
    prevenir();
    try {
      await chargerApi();
      await bibliotheque();
      await creerJoueur();
      if (!etat.actif) return; // arrêtée entre-temps
      lire(tirer());
    } catch (e) {
      etat.erreur = e.message;
      etat.actif = false;
      prevenir();
    }
  }

  function suivante() {
    if (!joueur || !biblio?.length) return demarrer();
    if (courant?.type === 'playlist') {
      const i = joueur.getPlaylistIndex?.() ?? -1;
      const n = joueur.getPlaylist?.()?.length ?? 0;
      if (n && i >= 0 && i < n - 1) return void joueur.nextVideo();
    }
    lire(tirer(courant));
  }

  const pause = () => { try { joueur?.pauseVideo(); } catch {} };
  const reprendre = () => { try { if (etat.actif) joueur?.playVideo(); } catch {} };
  function basculerSon() {
    coupe = !coupe;
    try { coupe ? joueur?.mute() : joueur?.unMute(); } catch {}
    prevenir();
  }
  function arreter() {
    clearTimeout(minuteurBlocage);
    if (!etat.actif && !etat.joue) return;
    try { joueur?.stopVideo(); } catch {}
    Object.assign(etat, { actif: false, joue: false, bloque: false, erreur: null });
    courant = null;
    prevenir();
  }

  // Quand le téléphone s'éteint ou que l'appli passe en arrière-plan, iOS et YouTube coupent le son d'un lecteur intégré : on ne
  // peut pas l'empêcher depuis une page web. Au retour, la musique repart toute seule si elle jouait avant.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !jouaitALEcran || !etat.actif) return;
    setTimeout(() => { if (etat.actif && !etat.joue) reprendre(); }, 400);
  });

  return { demarrer, suivante, pause, reprendre, basculerSon, arreter, surChangement: (f) => { ecouteur = f; }, get etat() { return { ...etat, coupe }; } };
})();
