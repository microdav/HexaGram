// Service worker HexaGram.
//
// Stratégie :
//  - Navigations (HTML) et API : TOUJOURS le réseau, sans passer par le cache
//    HTTP (cache: "no-store"), pour qu'un déploiement prenne effet immédiatement.
//    Repli sur le cache uniquement hors-ligne.
//  - Assets statiques (hashés, immuables) : cache-first avec rafraîchissement en
//    arrière-plan (offline OK, mise à jour transparente).
//
// Le numéro de version du cache force la purge de l'ancien shell à l'activation.
const CACHE = "hexagram-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isNavigation = req.mode === "navigate";
  const isApi = url.pathname.startsWith("/api/");

  // HTML / navigations / API : réseau frais obligatoire (pas de shell périmé).
  if (isNavigation || isApi) {
    e.respondWith(
      fetch(req, { cache: "no-store" }).catch(() => caches.match(req))
    );
    return;
  }

  // Assets statiques : cache-first + mise à jour en arrière-plan.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
