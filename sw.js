// Service worker: keeps a copy of the whole site so it opens and works
// offline after one online visit. Same-origin requests go to the network
// first (so updates show up when online) and fall back to the cached copy.
// Cross-origin requests (map tiles, routing, place search) are not cached.

const CACHE = 'travel-map-v1';

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/app.js',
  'src/countries.js',
  'src/csv.js',
  'src/geo.js',
  'src/map.js',
  'src/rail.js',
  'src/trips.js',
  'src/style.css',
  'vendor/d3.min.js',
  'vendor/topojson-client.min.js',
  'vendor/maplibre-gl.mjs',
  'vendor/maplibre-gl-worker.mjs',
  'vendor/maplibre-gl.css',
  'vendor/searoute.mjs',
  'data/airports.json',
  'data/tcc.json',
  'data/tcc-shapes.json',
  'data/flights.csv',
  'data/visited.json',
  'data/trips.json',
  'data/cities.json',
  'data/rail.json',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
