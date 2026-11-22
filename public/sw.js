// Service worker: guarda SOMENTE arquivos estáticos (nunca respostas da API com dados). Rede primeiro; cache como reserva offline.
const CACHE = 'estatico-v3';
const ESTATICO = /\.(?:js|css|svg|png|webmanifest|woff2)$|^\/$/;

self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/css/tokens.css', '/css/app.css', '/css/design.css', '/js/tema.js', '/js/main.js', '/js/core.js', '/js/scanner.js', '/icone.svg', '/icones/icone-192.png'])).catch(() => {})); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || !ESTATICO.test(url.pathname)) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
