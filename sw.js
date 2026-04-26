const CACHE = 'smartmemo-v6';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  'https://unpkg.com/react@18.3.1/umd/react.development.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(SHELL.map(u => c.add(u).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) {
      // Stale-while-revalidate: refresh in background
      fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(e.request);
      if (res && res.status === 200 && res.type !== 'opaque') {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      }
      return res;
    } catch {
      // Offline navigation fallback to the app shell
      if (e.request.mode === 'navigate') {
        const shell = await caches.match('./index.html') || await caches.match('./');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
