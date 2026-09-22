/* Sonora — Service Worker
   - Shell do app em cache (abre offline)
   - API Audius: rede primeiro, cache como reserva
   - Capas de álbum: cache-first
   - Áudio: passa direto (streaming por range, sem cache)
*/
const VERSION = 'v1';
const SHELL_CACHE = `sonora-shell-${VERSION}`;
const API_CACHE = `sonora-api-${VERSION}`;
const ASSET_CACHE = `sonora-assets-${VERSION}`;

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/config.js',
  './js/db.js',
  './js/player.js',
  './js/ui.js',
  './js/views.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch((err) => console.warn('[sw] pré-cache falhou', err)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('sonora-') && ![SHELL_CACHE, API_CACHE, ASSET_CACHE].includes(n))
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isAudiusApi(url) {
  return url.pathname.startsWith('/v1/');
}

function isAudio(url) {
  return url.pathname.includes('/cidstream/')
    || url.pathname.endsWith('/stream')
    || url.pathname.includes('/tracks/cidstream/');
}

async function handleNavigation(request) {
  try {
    const net = await fetch(request);
    if (net && net.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('./index.html', net.clone());
    }
    return net;
  } catch {
    const cached = (await caches.match('./index.html')) || (await caches.match('./'));
    if (cached) return cached;
    return new Response('Sem conexão', { status: 503, statusText: 'Offline' });
  }
}

async function handleApi(request) {
  try {
    const net = await fetch(request);
    if (net && net.ok) {
      const copy = net.clone();
      const cache = await caches.open(API_CACHE);
      cache.put(request, copy);
    }
    return net;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('{"error":"offline"}', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) {
    // atualiza em segundo plano
    fetch(request).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        caches.open(cacheName).then((c) => c.put(request, res));
      }
    }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(request, copy));
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isAudio(url)) return;                    // áudio: navegador cuida do streaming
  if (isAudiusApi(url)) { event.respondWith(handleApi(request)); return; }
  if (request.mode === 'navigate') { event.respondWith(handleNavigation(request)); return; }

  const dest = request.destination;
  if (dest === 'image' || dest === 'font' || dest === 'style' || dest === 'script' || dest === 'manifest') {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});
