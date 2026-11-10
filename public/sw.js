// Réseau d'abord, copie en cache en secours : le dernier écran affiché reste lisible sans réseau.
self.addEventListener('install', () => self.skipWaiting());
// Version du cache : à changer quand les icônes ou les fichiers de base changent (l'ancienne copie est alors supprimée).
const CACHE = 'bosse-v3';
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    // no-cache : toujours revalider auprès du serveur (sinon une nouvelle version peut rester invisible).
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copie = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copie));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
