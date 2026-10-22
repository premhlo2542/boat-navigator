// Service worker: precached app shell + runtime cache of map tiles the user has actually viewed.
// Tiles are NOT bulk-downloaded (OpenStreetMap tile policy forbids it); only visited areas work offline.
const SHELL = 'bn-shell-v1';
const TILES = 'bn-tiles-v1';
const MAX_TILES = 1200;
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'vendor/leaflet.js', 'vendor/leaflet.css',
  'js/main.js', 'js/app.js', 'js/ui.js', 'js/views.js', 'js/util.js', 'js/db.js', 'js/store.js', 'js/gps.js',
  'js/alerts.js', 'js/nav.js', 'js/trip.js', 'js/gpx.js', 'js/map.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const TILE_HOSTS = ['tile.openstreetmap.org', 'basemaps.cartocdn.com', 'tiles.openseamap.org'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('bn-shell') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

let puts = 0;
async function trimTiles(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    // Re-request in CORS mode so the stored response is not opaque (opaque entries waste large quota).
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      cache.put(req.url, res.clone());
      if (++puts % 50 === 0) trimTiles(cache);
    }
    return res;
  } catch {
    try { return await fetch(req); } catch { return Response.error(); }
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return void e.respondWith(tile(req));
  if (url.origin !== location.origin) return; // search API etc.: network only
  // Same-origin: stale-while-revalidate so a deploy shows up on the next load.
  e.respondWith(
    caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || (req.mode === 'navigate' ? c.match('index.html') : Response.error());
    }),
  );
});
