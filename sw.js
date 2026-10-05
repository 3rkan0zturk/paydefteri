'use strict';
const VERSION = '2.0.0';
const ROOT = new URL('./', self.location).href;
// Her depo alt dizini kendi önbelleğini kullanır.
const PREFIX = 'pay-defteri-shell-' + encodeURIComponent(ROOT) + '-';
const CACHE = PREFIX + VERSION;
const ASSETS = ['./', './index.html', './styles.css', './accounting.js', './storage.js', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable.png'].map(p => new URL(p, ROOT).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const url of ASSETS) {
        const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
        if (!response.ok || response.redirected) throw Error('Uygulama dosyası önbelleğe alınamadı: ' + url);
        await cache.put(url, response);
      }
    } catch (error) { await caches.delete(CACHE); throw error; }
    // Açık form varsa eski sürüm devam eder. Güncelleme kullanıcı isteğiyle etkinleşir.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'CHECK_READY') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const hits = await Promise.all(ASSETS.map(url => cache.match(url)));
    event.ports[0]?.postMessage({ ready: hits.every(Boolean), version: VERSION });
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(ROOT)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(async cache => await cache.match(new URL('index.html', ROOT).href) || fetch(event.request)));
  } else if (ASSETS.includes(url.href)) {
    event.respondWith(caches.open(CACHE).then(async cache => await cache.match(event.request) || fetch(event.request)));
  }
});
