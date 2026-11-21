// Service worker: keeps the app screens available with no signal.
// It never stores database responses; data always comes from the server.
const CACHE = 'fleet-erp-shell-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'config.js', 'manifest.webmanifest',
  'main.js', 'modules.js', 'docstatus.js', 'api.js', 'api.firebase.js', 'api.demo.js', 'ui.js',
  'dashboard.js', 'trucks.js', 'drivers.js', 'attendance.js', 'pages.js', 'users.js',
  'icon.svg', 'icon-192.png', 'icon-512.png',
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
