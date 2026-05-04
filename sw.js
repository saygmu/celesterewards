// 喬喬集點屋 service worker — 簡單離線快取
const VERSION = 'v1.0.27';
const CACHE = `celesterewards-${VERSION}`;
const ASSETS = ['./', './index.html', './style.css?v=28', './app.js?v=28', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 不快取 sync API
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request).then((r) => {
      if (e.request.method === 'GET' && r.ok) {
        const clone = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return r;
    }).catch(() => caches.match('./index.html')))
  );
});
