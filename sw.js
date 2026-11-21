// Service worker: keeps the app screens available with no signal.
// It never stores database responses; data always comes from the server.
const CACHE = 'fleet-erp-shell-v3';
const SHELL = [
  './', 'index.html', 'styles.css', 'config.js', 'manifest.webmanifest',
  'js/main.js', 'js/modules.js', 'js/docstatus.js', 'js/api.js', 'js/api.firebase.js', 'js/api.demo.js', 'js/ui.js',
  'js/views/dashboard.js', 'js/views/trucks.js', 'js/views/drivers.js', 'js/views/attendance.js', 'js/views/modules.js', 'js/views/users.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
const CDN_SCRIPT = /^https:\/\/www\.gstatic\.com\/firebasejs\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN_SCRIPT.test(req.url)) return;   // Firebase data calls go through the SDK, not here

  // Network first so updates show up as soon as there is signal; cache is the fallback.
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
