// Service worker: guarda la app en el dispositivo para que abra sin internet.
const APP_CACHE = 'tp-app-v4.2.0';
const APP_FILES = [
  './', 'index.html', 'app.css', 'app.js', 'firebase-config.js', 'manifest.json',
  'vendor/vosk.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/logo-sd.png', 'icons/logo-simondice.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('tp-app-') && k !== APP_CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // la nube va directo
  if (url.pathname.includes('/models/')) return; // los modelos los maneja la app en su propio caché

  // Librerías e íconos: primero la copia guardada (no cambian).
  if (url.pathname.includes('/vendor/') || url.pathname.includes('/icons/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }

  // Resto: primero la red (para recibir actualizaciones), con límite de 3 segundos;
  // si no hay conexión o tarda, la copia guardada.
  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then(c => c.put(e.request, copy)); }
      return res;
    });
    if (!cached) return net.catch(() => caches.match('index.html'));
    const timeout = new Promise(resolve => setTimeout(() => resolve(cached), 3000));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});
