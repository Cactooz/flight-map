// Ground and sea trips: routing, place search and track file import.

import { greatCircle, simplify, unwrap, lineLengthKm } from './geo.js';

export const MODES = {
  road: { label: 'Car', icon: '🚗', color: '#4cc9f0' },
  bus: { label: 'Bus', icon: '🚌', color: '#facc15' },
  train: { label: 'Train', icon: '🚆', color: '#c084fc' },
  boat: { label: 'Boat / cruise', icon: '🚢', color: '#e2e8f0' },
  other: { label: 'Other', icon: '📍', color: '#94a3b8' },
};

// Public OpenStreetMap-based services. Fine for personal, low-volume use.
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const BROUTER = 'https://brouter.de/brouter';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Keeps stored routes small: ~100 m tolerance.
const SIMPLIFY_DEG = 0.001;

const pairs = (pts) => pts.slice(1).map((p, i) => [pts[i], p]);
const ll = (w) => [w.lon, w.lat];

function straight(waypoints) {
  const coords = [];
  for (const [a, b] of pairs(waypoints.map(ll))) {
    const seg = greatCircle(a, b);
    coords.push(...(coords.length ? seg.slice(1) : seg));
  }
  return unwrap(coords);
}

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function routeRoad(waypoints) {
  const pts = waypoints.map((w) => `${w.lon},${w.lat}`).join(';');
  const data = await fetchJson(`${OSRM}${pts}?overview=full&geometries=geojson`);
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || 'No road route found');
  return data.routes[0].geometry.coordinates;
}

async function routeTrain(waypoints) {
  const coords = [];
  // BRouter's rail profile follows OpenStreetMap railway lines. One request per
  // leg keeps long trips within its distance limits.
  for (const [a, b] of pairs(waypoints)) {
    const url = `${BROUTER}?lonlats=${a.lon},${a.lat}|${b.lon},${b.lat}&profile=rail&alternativeidx=0&format=geojson`;
    const data = await fetchJson(url, 30000);
    const line = data.features?.[0]?.geometry?.coordinates;
    if (!line?.length) throw new Error('No rail route found');
    const leg = line.map(([x, y]) => [x, y]);
    coords.push(...(coords.length ? leg.slice(1) : leg));
  }
  return coords;
}

let searoutePromise = null;
async function routeSea(waypoints) {
  searoutePromise ??= import('../vendor/searoute.mjs');
  const { seaRoute, MARNET_20KM } = await searoutePromise;
  const coords = [];
  for (const [a, b] of pairs(waypoints)) {
    const r = seaRoute(ll(a), ll(b), { antimeridian: 'unwrap', appendOriginDestination: true, network: MARNET_20KM });
    const leg = r.geometry.coordinates;
    coords.push(...(coords.length ? leg.slice(1) : leg));
  }
  return unwrap(coords);
}

// Buses follow roads too.
const ROUTERS = { road: routeRoad, bus: routeRoad, train: routeTrain, boat: routeSea };

/**
 * Computes a trip's line. Falls back to great-circle segments when the routing
 * service is unavailable, and reports which method was used.
 */
export async function routeTrip(mode, waypoints) {
  if (waypoints.length < 2) throw new Error('A trip needs at least two points.');
  const router = ROUTERS[mode];
  if (router) {
    try {
      const coords = await router(waypoints);
      return { coords: simplify(unwrap(coords), SIMPLIFY_DEG), routedBy: mode === 'boat' ? 'sea' : mode, warning: null };
    } catch (err) {
      return { coords: straight(waypoints), routedBy: 'straight', warning: `Routing failed (${err.message}); drawn as straight lines.` };
    }
  }
  return { coords: straight(waypoints), routedBy: 'straight', warning: null };
}

export function tripLengthKm(trip) {
  return lineLengthKm(trip.coords);
}

/** Place search: IATA codes from the local airport list, then OSM Nominatim. */
export async function searchPlaces(query, airports) {
  const q = query.trim();
  if (!q) return [];
  const results = [];
  const code = q.toUpperCase();
  if (/^[A-Z0-9]{3}$/.test(code) && airports[code]) {
    const a = airports[code];
    results.push({ name: `${code} · ${a[1] || a[0]}`, detail: a[0], lon: a[4], lat: a[3] });
  }
  try {
    const data = await fetchJson(`${NOMINATIM}?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, 10000);
    for (const r of data) {
      results.push({
        name: r.name || r.display_name.split(',')[0],
        detail: r.display_name,
        lon: +r.lon,
        lat: +r.lat,
      });
    }
  } catch (err) {
    if (!results.length) throw new Error(`Place search unavailable (${err.message})`);
  }
  return results;
}

// ------------------------------------------------------------ file import

function textOf(el, tag) {
  return el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
}

function parseGpx(doc) {
  const tracks = [];
  for (const trk of [...doc.getElementsByTagName('trk'), ...doc.getElementsByTagName('rte')]) {
    const pts = [...trk.getElementsByTagName('trkpt'), ...trk.getElementsByTagName('rtept')];
    const coords = pts.map((p) => [+p.getAttribute('lon'), +p.getAttribute('lat')]);
    const time = pts[0] ? textOf(pts[0], 'time') : '';
    if (coords.length > 1) tracks.push({ name: textOf(trk, 'name'), date: time.slice(0, 10), coords });
  }
  return tracks;
}

function parseKml(doc) {
  const tracks = [];
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const coords = [];
    for (const ls of pm.getElementsByTagName('LineString')) {
      const txt = textOf(ls, 'coordinates');
      for (const tuple of txt.split(/\s+/)) {
        const [x, y] = tuple.split(',').map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) coords.push([x, y]);
      }
    }
    for (const c of pm.getElementsByTagName('gx:coord')) {
      const [x, y] = c.textContent.trim().split(/\s+/).map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) coords.push([x, y]);
    }
    const when = textOf(pm, 'begin') || textOf(pm, 'when');
    if (coords.length > 1) tracks.push({ name: textOf(pm, 'name'), date: when.slice(0, 10), coords });
  }
  return tracks;
}

function parseGeoJson(obj) {
  const tracks = [];
  const visit = (geom, props = {}) => {
    if (!geom) return;
    const name = props.name || props.title || '';
    const date = String(props.date || props.time || props.startTime || '').slice(0, 10);
    if (geom.type === 'LineString') tracks.push({ name, date, coords: geom.coordinates });
    else if (geom.type === 'MultiLineString') geom.coordinates.forEach((c) => tracks.push({ name, date, coords: c }));
    else if (geom.type === 'GeometryCollection') geom.geometries.forEach((g) => visit(g, props));
  };
  if (obj.type === 'FeatureCollection') obj.features.forEach((f) => visit(f.geometry, f.properties || {}));
  else if (obj.type === 'Feature') visit(obj.geometry, obj.properties || {});
  else visit(obj);
  return tracks.filter((t) => t.coords.length > 1);
}

/** Reads GPX, KML or GeoJSON tracks into [{ name, date, coords }]. */
export function parseTrackFile(text, filename) {
  const lower = filename.toLowerCase();
  let tracks;
  if (lower.endsWith('.json') || lower.endsWith('.geojson')) {
    tracks = parseGeoJson(JSON.parse(text));
  } else {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not parse file as XML.');
    tracks = lower.endsWith('.kml') ? parseKml(doc) : parseGpx(doc);
  }
  return tracks.map((t) => ({ ...t, coords: simplify(unwrap(t.coords.map(([x, y]) => [x, y])), SIMPLIFY_DEG) }));
}
