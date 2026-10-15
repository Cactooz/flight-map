import { parseFlightCsv, parseAirportField } from './csv.js';
import { createMap, BASEMAPS } from './map.js';
import { greatCircle, mercatorPx, distanceKm, lineLengthKm, sampleLine, createPolygonIndex } from './geo.js';
import { MODES, routeTrip, searchPlaces, parseTrackFile } from './trips.js';
import { COUNTRIES, CONTINENTS, TCC_CONTINENTS } from './countries.js';

const d3 = window.d3;
const topojson = window.topojson;

const LS_FLIGHTS = 'flightmap.flights.v1';
// v2 stores changes on top of data/visited.json instead of replacing it.
const LS_VISITED = 'flightmap.visited.v2';
const LS_TRIPS = 'flightmap.trips.v1';
const LS_VIEW = 'flightmap.view.v1';

// --------------------------------------------------------------- storage

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

// ----------------------------------------------------------------- state

const state = {
  airports: {}, // IATA -> [name, city, cc, lat, lon, icao, tccIndex]
  icao: new Map(),
  tcc: [],
  features: [],
  tccAt: () => -1,
  flights: [],
  unresolved: [],
  flightSource: 'bundled',
  trips: [],
  tripSource: 'bundled',
  manual: new Map(), // destination id -> how it was visited ('plane' | 'car' | 'train' | 'boat' | 'other')
  year: 'all',
  sel: { airport: null, route: null, trip: null, dest: null, anyAirport: null },
  view: { flights: true, trips: true, heat: false, allAirports: false, rail: false, basemap: 'dark', globe: false },
  draft: null, // { id, mode, name, date, waypoints: [], clickToAdd }
  searchResults: [],
  countryFilter: 'all',
  countryView: 'countries', // 'countries' | 'tcc'
  tccGroup: 'region', // 'region' | 'continent'
  countrySearch: '',
};

let M; // map wrapper
let evidenceCache = null;

const $ = (sel) => document.querySelector(sel);
const fmt = d3.format(',');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const VISIT_MODES = {
  plane: { label: 'Airplane', icon: '✈️' },
  car: { label: 'Car', icon: '🚗' },
  train: { label: 'Train', icon: '🚆' },
  boat: { label: 'Boat', icon: '🚢' },
  other: { label: 'Other / unknown', icon: '📍' },
};
const TRIP_TO_VISIT = { road: 'car', train: 'train', boat: 'boat', other: 'other' };

/** visited.json is either ["id", …] or { "id": "mode", … }. */
function normalizeVisited(data, known) {
  const m = new Map();
  const entries = Array.isArray(data) ? data.map((id) => [id, 'other']) : Object.entries(data || {});
  for (const [id, mode] of entries) if (known.has(id)) m.set(id, VISIT_MODES[mode] ? mode : 'other');
  return m;
}

function applyVisitedChanges(base, changes, known) {
  const m = new Map(base);
  for (const [id, mode] of Object.entries(changes?.set || {})) if (known.has(id)) m.set(id, mode);
  for (const id of changes?.removed || []) m.delete(id);
  return m;
}

function saveVisited() {
  const set = {};
  const removed = [];
  for (const [id, mode] of state.manual) if (state.bundledVisited.get(id) !== mode) set[id] = mode;
  for (const id of state.bundledVisited.keys()) if (!state.manual.has(id)) removed.push(id);
  store.set(LS_VISITED, Object.keys(set).length || removed.length ? { set, removed } : null);
}

// ------------------------------------------------------------- loading

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

function resolveAirport(ref) {
  if (ref.iata && state.airports[ref.iata]) return ref.iata;
  if (ref.icao && state.icao.has(ref.icao)) return state.icao.get(ref.icao);
  return null;
}

function setFlights(rows, source) {
  const flights = [];
  const unresolved = [];
  for (const r of rows) {
    const from = resolveAirport(r.from);
    const to = resolveAirport(r.to);
    if (from && to) flights.push({ ...r, from, to });
    else unresolved.push(r);
  }
  state.flights = flights.sort((a, b) => (a.date + a.depTime).localeCompare(b.date + b.depTime));
  state.unresolved = unresolved;
  state.flightSource = source;
  state.sel.airport = state.sel.route = null;
  evidenceCache = null;
}

function setTrips(trips, source) {
  state.trips = trips;
  state.tripSource = source;
  evidenceCache = null;
}

function saveTrips() {
  const ok = store.set(LS_TRIPS, { source: 'edited', trips: state.trips });
  state.tripSource = 'edited';
  if (!ok) alert('Could not save trips in this browser (storage full?). Export trips.json to keep them.');
}

function serializeRows(rows) {
  return rows.map((r) => ({ ...r, from: { iata: r.from.iata, icao: r.from.icao, label: r.from.label }, to: { iata: r.to.iata, icao: r.to.icao, label: r.to.label } }));
}

async function init() {
  const [airports, tcc, shapes, csvText, visited, trips] = await Promise.all([
    loadJson('data/airports.json'),
    loadJson('data/tcc.json'),
    loadJson('data/tcc-shapes.json'),
    loadText('data/flights.csv').catch(() => ''),
    loadJson('data/visited.json').catch(() => []),
    loadJson('data/trips.json').catch(() => []),
  ]);
  state.airports = airports;
  for (const [iata, a] of Object.entries(airports)) if (a[5] && !state.icao.has(a[5])) state.icao.set(a[5], iata);
  state.tcc = tcc;
  state.features = topojson.feature(shapes, shapes.objects.tcc).features;
  state.tccAt = createPolygonIndex(state.features);
  state.bundledCsv = csvText;
  state.bundledTrips = trips;

  const saved = store.get(LS_FLIGHTS, null);
  if (saved && Array.isArray(saved.rows)) setFlights(saved.rows, saved.source || 'imported');
  else setFlights(csvText ? parseFlightCsv(csvText) : [], 'bundled');

  const savedTrips = store.get(LS_TRIPS, null);
  if (savedTrips && Array.isArray(savedTrips.trips)) setTrips(savedTrips.trips, savedTrips.source || 'edited');
  else setTrips(trips, 'bundled');

  const known = new Set(tcc.map((t) => t.id));
  state.bundledVisited = normalizeVisited(visited, known);
  state.manual = applyVisitedChanges(state.bundledVisited, store.get(LS_VISITED, null), known);
  state.countryIdx = new Map(COUNTRIES.map((c) => [c.iso, c]));
  Object.assign(state.view, store.get(LS_VIEW, {}));

  M = createMap($('#map'), { onHover, onClick, onMove: hideTooltip });
  await M.ready;
  initControls();
  initPanel();
  buildYearFilter();
  M.setData('allAirports', allAirportsGeoJson());
  applyView();
  update();
  $('#loading').remove();
}

// ---------------------------------------------------------- derived data

const inYear = (date) => state.year === 'all' || (date || '').startsWith(state.year);
const filteredFlights = () => state.flights.filter((f) => inYear(f.date));
const filteredTrips = () => state.trips.filter((t) => inYear(t.date));

function routeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function aggregate(flights) {
  const routes = new Map();
  const airports = new Map();
  for (const f of flights) {
    const key = routeKey(f.from, f.to);
    let r = routes.get(key);
    if (!r) {
      const [a, b] = key.split('|');
      r = { key, a, b, ab: 0, ba: 0, flights: [] };
      routes.set(key, r);
    }
    if (f.from === r.a) r.ab++;
    else r.ba++;
    r.flights.push(f);
    for (const code of new Set([f.from, f.to])) {
      let ap = airports.get(code);
      if (!ap) airports.set(code, (ap = { code, count: 0, routes: new Set() }));
      ap.count++;
      ap.routes.add(key);
    }
  }
  for (const r of routes.values()) r.total = r.ab + r.ba;
  return { routes: [...routes.values()], airports: [...airports.values()] };
}

const coord = (code) => {
  const a = state.airports[code];
  return [a[4], a[3]];
};

const airportKm = (a, b) => distanceKm(coord(a), coord(b));

/**
 * Destinations visited, from all flights (airport locations) and trips
 * (points along road/rail routes, ports for boat trips).
 */
function evidence() {
  if (evidenceCache) return evidenceCache;
  const m = new Map();
  const add = (idx, kind, value) => {
    if (idx < 0) return;
    if (!m.has(idx)) m.set(idx, { airports: new Set(), trips: new Set() });
    m.get(idx)[kind].add(value);
  };
  for (const f of state.flights) {
    for (const code of [f.from, f.to]) add(state.airports[code][6], 'airports', code);
  }
  for (const t of state.trips) {
    // Stops and endpoints count even when they sit just off the simplified
    // coastline; for boats only those count (not the sea in between).
    const ends = [...t.waypoints.map((w) => [w.lon, w.lat]), t.coords[0], t.coords[t.coords.length - 1]].filter(Boolean);
    for (const p of ends) add(state.tccAt.near(p), 'trips', t.id);
    if (t.mode !== 'boat') for (const p of sampleLine(t.coords, 8)) add(state.tccAt(p), 'trips', t.id);
  }
  evidenceCache = m;
  return m;
}

function visitStatus(idx) {
  if (evidence().has(idx)) return 'auto';
  if (state.manual.has(state.tcc[idx].id)) return 'manual';
  return '';
}

// How a destination was visited: plane for airports, the trip modes, plus any manual entry.
function visitModes(idx) {
  const modes = new Set();
  const e = evidence().get(idx);
  if (e?.airports.size) modes.add('plane');
  for (const id of e?.trips || []) {
    const t = state.trips.find((x) => x.id === id);
    if (t) modes.add(TRIP_TO_VISIT[t.mode] || 'other');
  }
  const m = state.manual.get(state.tcc[idx].id);
  // "Other / unknown" (e.g. imported from the TCC sheet) is only shown when nothing else is known.
  if (m && (m !== 'other' || !modes.size)) modes.add(m);
  return [...modes];
}

const modeIcons = (modes) => modes.map((m) => VISIT_MODES[m]?.icon || '').join(' ');

/** Sovereign countries visited: a territory (Crete, Tasmania…) also counts its parent country. */
function visitedCountries() {
  const m = new Map();
  state.tcc.forEach((t, idx) => {
    if (!t.sov || !visitStatus(idx)) return;
    if (!m.has(t.sov)) m.set(t.sov, { country: state.countryIdx.get(t.sov), dests: [], modes: new Set() });
    const v = m.get(t.sov);
    v.dests.push(idx);
    for (const mode of visitModes(idx)) v.modes.add(mode);
  });
  return m;
}

const visitedCount = () => state.tcc.filter((_, i) => visitStatus(i)).length;
// Count by the official TCC numbering (330), where Russia, Turkey and Egypt count twice.
const officialCount = () => d3.sum(state.tcc, (t, i) => (visitStatus(i) ? t.n.length : 0));

// ------------------------------------------------------------- map data

function routeScales(routes) {
  const maxTotal = d3.max(routes, (r) => r.total) || 1;
  const maxDir = d3.max(routes, (r) => Math.max(r.ab, r.ba)) || 1;
  const t = (n) => (maxTotal === 1 ? 0.35 : Math.log(n) / Math.log(maxTotal));
  return {
    maxTotal,
    width: (r) => 1.2 + 5.3 * Math.sqrt(r.total / maxTotal),
    // Same hue throughout; saturation (and a little brightness) grows with use.
    color: (n) => d3.hsl(32, 0.12 + 0.88 * t(n), 0.62 - 0.08 * t(n)).formatHex(),
    // Arrow length (px) for the busier direction of a route.
    arrowBase: (r) => 6 + 9 * Math.sqrt(Math.max(r.ab, r.ba) / maxDir),
  };
}

function flightGeoJson(routes, scales) {
  const lines = [];
  const arrows = [];
  const loops = [];
  const ui = Math.max(0.6, Math.min(1, $('#map').clientWidth / 1100));
  for (const r of routes) {
    if (r.a === r.b) {
      // Same departure and arrival airport (e.g. a helicopter sightseeing tour).
      loops.push({
        type: 'Feature',
        properties: { key: r.key, a: r.a, b: r.b, color: scales.color(r.total), s: (0.6 + 0.4 * Math.sqrt(r.total / scales.maxTotal)) * ui },
        geometry: { type: 'Point', coordinates: coord(r.a) },
      });
      continue;
    }
    const A = coord(r.a);
    const B = coord(r.b);
    const line = greatCircle(A, B);
    const color = scales.color(r.total);
    lines.push({
      type: 'Feature',
      properties: { key: r.key, a: r.a, b: r.b, color, w: scales.width(r) },
      geometry: { type: 'LineString', coordinates: line },
    });
    const [ax, ay] = mercatorPx(line[0]);
    const [bx, by] = mercatorPx(line[line.length - 1]);
    const len = Math.hypot(bx - ax, by - ay);
    const base = scales.arrowBase(r);
    const maxDir = Math.max(r.ab, r.ba);
    const both = r.ab > 0 && r.ba > 0;
    for (const [count, forward] of [[r.ab, true], [r.ba, false]]) {
      if (!count) continue;
      // Arrows sit apart so both are visible; each points in its direction of
      // travel and its size is proportional to its number of flights.
      const t = both ? (forward ? 0.62 : 0.38) : 0.5;
      // Sample from the (unwrapped) line so the arrow sits on the same world copy.
      const i = Math.round(t * (line.length - 1));
      const j = forward ? Math.min(i + 1, line.length - 1) : Math.max(i - 1, 0);
      const p = line[i];
      const [px, py] = mercatorPx(p);
      const [qx, qy] = mercatorPx(line[j]);
      arrows.push({
        type: 'Feature',
        properties: {
          key: r.key,
          a: r.a,
          b: r.b,
          color: d3.color(color).brighter(0.9).formatHex(),
          rot: (Math.atan2(qx - px, -(qy - py)) * 180) / Math.PI,
          s: ((base * count) / maxDir / 32) * ui,
          base,
          len,
        },
        geometry: { type: 'Point', coordinates: p },
      });
    }
  }
  const fc = (features) => ({ type: 'FeatureCollection', features });
  return { lines: fc(lines), arrows: fc(arrows), loops: fc(loops) };
}

function airportsGeoJson(airports) {
  const maxCount = d3.max(airports, (a) => a.count) || 1;
  return {
    type: 'FeatureCollection',
    features: airports
      .slice()
      .sort((a, b) => a.count - b.count)
      .map((a) => ({
        type: 'Feature',
        properties: { code: a.code, count: a.count, r: 3 + 4 * Math.sqrt(a.count / maxCount) },
        geometry: { type: 'Point', coordinates: coord(a.code) },
      })),
  };
}

function allAirportsGeoJson() {
  return {
    type: 'FeatureCollection',
    features: Object.entries(state.airports).map(([code, a]) => ({
      type: 'Feature',
      properties: { code },
      geometry: { type: 'Point', coordinates: [a[4], a[3]] },
    })),
  };
}

function tripsGeoJson(trips) {
  return {
    type: 'FeatureCollection',
    features: trips.map((t) => ({
      type: 'Feature',
      properties: { id: t.id, mode: t.mode, color: (MODES[t.mode] || MODES.other).color },
      geometry: { type: 'LineString', coordinates: t.coords },
    })),
  };
}

function heatGeoJson(trips, airports) {
  const features = [];
  for (const t of trips) {
    const step = Math.max(2, lineLengthKm(t.coords) / 4000);
    for (const p of sampleLine(t.coords, step)) features.push({ type: 'Feature', properties: { w: 1 }, geometry: { type: 'Point', coordinates: p } });
  }
  for (const a of airports) {
    features.push({ type: 'Feature', properties: { w: Math.min(12, 2 + a.count) }, geometry: { type: 'Point', coordinates: coord(a.code) } });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Map fill status: the destination's own visit status, or 'country' for the
 * other parts of a visited country (Scotland and Wales when you've been to
 * England). Separate dependencies with their own country code (Greenland,
 * Puerto Rico…) are not filled.
 */
function landStatus(idx, countries) {
  const st = visitStatus(idx);
  if (st) return st;
  const t = state.tcc[idx];
  return t.sov && t.cc === t.sov && countries.has(t.sov) ? 'country' : '';
}

function landGeoJson() {
  const countries = visitedCountries();
  return {
    type: 'FeatureCollection',
    features: state.features.map((f) => ({ ...f, properties: { idx: f.id, status: f.id >= 0 ? landStatus(f.id, countries) : '' } })),
  };
}

function markersGeoJson() {
  return {
    type: 'FeatureCollection',
    features: state.tcc
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => t.pt && (!t.shape || t.area < 60))
      .map(({ t, idx }) => ({ type: 'Feature', properties: { idx, status: visitStatus(idx) }, geometry: { type: 'Point', coordinates: t.pt } })),
  };
}

function draftGeoJson() {
  const d = state.draft;
  if (!d) return { type: 'FeatureCollection', features: [] };
  const pts = d.waypoints.map((w) => [w.lon, w.lat]);
  const features = pts.map((c, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: c } }));
  if (pts.length > 1) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
  return { type: 'FeatureCollection', features };
}

function drawCountries() {
  M.setData('land', landGeoJson());
  M.setData('markers', markersGeoJson());
}

function drawMovements() {
  const flights = filteredFlights();
  const trips = filteredTrips();
  const agg = aggregate(flights);
  state.agg = agg;
  const scales = routeScales(agg.routes);
  agg.routes.sort((x, y) => x.total - y.total);
  const { lines, arrows, loops } = flightGeoJson(agg.routes, scales);
  M.setData('routes', lines);
  M.setData('arrows', arrows);
  M.setData('loops', loops);
  M.setData('airports', airportsGeoJson(agg.airports));
  M.setAirportLabels(agg.airports.map((a) => ({ code: a.code, count: a.count, lngLat: coord(a.code) })));
  M.setData('trips', tripsGeoJson(trips));
  M.setData('heat', heatGeoJson(trips, agg.airports));
  applyHighlight();
  drawLegend(scales);
}

function applyHighlight() {
  const { airport, route, trip, dest } = state.sel;
  const connected = new Set();
  if (state.agg && (airport || route)) {
    for (const r of state.agg.routes) {
      if (route ? r.key === route : r.a === airport || r.b === airport) connected.add(r.a).add(r.b);
    }
  }
  M.setHighlight({ airport, route, trip, dest, connected: [...connected] });
  M.setLabelFilter((code, count, z) => {
    if (airport || route) return connected.has(code);
    if (trip) return false;
    return z >= 4 || count >= 6;
  });
}

function applyView() {
  const v = state.view;
  M.setVisible(['routes', 'routes-hit', 'arrows', 'loops', 'airports'], v.flights);
  document.body.classList.toggle('hide-labels', !v.flights);
  M.setVisible(['trips', 'trips-boat', 'trips-hit'], v.trips);
  M.setVisible('heat', v.heat);
  M.setVisible('all-airports', v.allAirports);
  M.setVisible('rail', v.rail);
  M.setBasemap(v.basemap);
  M.setProjection(v.globe ? 'globe' : 'mercator');
  store.set(LS_VIEW, v);
}

function drawLegend(scales) {
  const stops = d3.range(0, 1.01, 0.1).map((t) => scales.color(Math.max(1, Math.round(Math.exp(t * Math.log(scales.maxTotal))))));
  const modes = new Set(state.trips.map((t) => t.mode));
  $('#legend').innerHTML = `
    <div>Flights per route</div>
    <div class="grad" style="background:linear-gradient(90deg, ${stops.join(',')})"></div>
    <div class="scale"><span>1</span><span>${scales.maxTotal}</span></div>
    ${Object.entries(MODES)
      .filter(([k]) => modes.has(k))
      .map(([k, m]) => `<div><span class="ln ${k === 'boat' ? 'dashed' : ''}" style="--c:${m.color}"></span>${m.label}</div>`)
      .join('')}
    <div><span class="sw" style="background:var(--auto)"></span>Visited (flights / trips)</div>
    <div><span class="sw" style="background:var(--manual)"></span>Visited (added manually)</div>
    <div><span class="sw" style="background:var(--auto);opacity:0.45"></span>Rest of a visited country</div>`;
}

// --------------------------------------------------------------- tooltip

function showTooltip(ev, html) {
  const tip = $('#tooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const box = $('#map-wrap').getBoundingClientRect();
  const { x, y } = ev.point;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = `${Math.max(4, Math.min(x + 14, box.width - w - 8))}px`;
  tip.style.top = `${y + 14 + h > box.height ? y - h - 10 : y + 14}px`;
}

function hideTooltip() {
  $('#tooltip').hidden = true;
}

function airportName(code) {
  const a = state.airports[code];
  return a ? `${a[1] || a[0]}` : code;
}

const isLoop = (r) => r.a === r.b;
const routeTitle = (r) => (isLoop(r) ? `${r.a} ⟲ local flight` : `${r.a} ⇄ ${r.b}`);
const routeSub = (r) =>
  isLoop(r) ? `${esc(airportName(r.a))} · starts and ends here` : `${esc(airportName(r.a))} – ${esc(airportName(r.b))} · ${fmt(Math.round(airportKm(r.a, r.b)))} km`;

function findRoute(key) {
  return state.agg.routes.find((r) => r.key === key);
}

const regionsOf = (t) => [t.region, ...(t.also || [])];

function onHover(hit, ev) {
  if (!hit) return hideTooltip();
  const p = hit.props;
  if (hit.kind === 'airport' || hit.kind === 'any-airport') {
    const ap = state.airports[p.code];
    const agg = state.agg.airports.find((a) => a.code === p.code);
    showTooltip(
      ev,
      `<div class="t-title">${p.code} · ${esc(ap[1] || '')}</div>
       <div class="t-sub">${esc(ap[0])}</div>
       ${agg ? `<div>${agg.count} flights · ${agg.routes.size} routes</div>` : ''}`,
    );
  } else if (hit.kind === 'route') {
    const r = findRoute(p.key);
    if (!r) return hideTooltip();
    showTooltip(
      ev,
      `<div class="t-title">${routeTitle(r)}</div>
       ${isLoop(r) ? `<div>Flights: <b>${r.total}</b></div>` : `<div>${r.a} → ${r.b}: <b>${r.ab}</b></div><div>${r.b} → ${r.a}: <b>${r.ba}</b></div>`}
       <div class="t-sub">${routeSub(r)}</div>`,
    );
  } else if (hit.kind === 'trip') {
    const t = state.trips.find((x) => x.id === p.id);
    if (!t) return hideTooltip();
    showTooltip(ev, `<div class="t-title">${MODES[t.mode]?.icon || ''} ${esc(t.name || 'Trip')}</div><div class="t-sub">${esc(t.date)} · ${fmt(Math.round(lineLengthKm(t.coords)))} km</div>`);
  } else if (hit.kind === 'dest') {
    const t = state.tcc[p.idx];
    const st = visitStatus(p.idx);
    const inCountry = !st && landStatus(p.idx, visitedCountries()) === 'country';
    showTooltip(
      ev,
      `<div class="t-title">${esc(t.name)}</div><div class="t-sub">${esc(regionsOf(t).join(' · '))}</div>
       <div>${st ? `Visited ${modeIcons(visitModes(p.idx))}` : inCountry ? `Not visited (but you've been to ${esc(state.countryIdx.get(t.sov).name)})` : 'Not visited'}</div>`,
    );
  } else if (hit.kind === 'draft') {
    const w = state.draft?.waypoints[p.i];
    if (w) showTooltip(ev, `<div class="t-title">${p.i + 1}. ${esc(w.name)}</div>`);
    else hideTooltip();
  }
}

function onClick(hit, ev) {
  hideTooltip();
  const d = state.draft;
  if (d?.clickToAdd && (!hit || hit.kind === 'dest' || hit.kind === 'any-airport' || hit.kind === 'airport')) {
    if (hit && (hit.kind === 'any-airport' || hit.kind === 'airport')) {
      const code = hit.props.code;
      addWaypoint({ name: `${code} · ${airportName(code)}`, lon: coord(code)[0], lat: coord(code)[1] });
    } else {
      const { lng, lat } = ev.lngLat.wrap();
      const idx = state.tccAt([lng, lat]);
      addWaypoint({ name: `${idx >= 0 ? `${state.tcc[idx].name} ` : ''}(${lat.toFixed(3)}, ${lng.toFixed(3)})`, lon: +lng.toFixed(5), lat: +lat.toFixed(5) });
    }
    return;
  }
  if (!hit) return clearSelection();
  if (hit.kind === 'airport') selectAirport(hit.props.code);
  else if (hit.kind === 'any-airport') select({ anyAirport: hit.props.code });
  else if (hit.kind === 'route') select({ route: hit.props.key });
  else if (hit.kind === 'trip') select({ trip: hit.props.id });
  else if (hit.kind === 'dest') select({ dest: hit.props.idx });
}

// ------------------------------------------------------------- selection

function select(sel) {
  state.sel = { airport: null, route: null, trip: null, dest: null, anyAirport: null, ...sel };
  applyHighlight();
  if (!state.draft) showTab('overview');
  renderOverview();
}

function clearSelection() {
  select({});
}

function selectAirport(code) {
  select({ airport: state.sel.airport === code ? null : code });
}

// ----------------------------------------------------------------- panel

function initControls() {
  const v = state.view;
  $('#layers').innerHTML = `
    <label><input type="checkbox" data-view="flights" ${v.flights ? 'checked' : ''}/> Flights</label>
    <label><input type="checkbox" data-view="trips" ${v.trips ? 'checked' : ''}/> Road / rail / sea trips</label>
    <label><input type="checkbox" data-view="heat" ${v.heat ? 'checked' : ''}/> Heatmap</label>
    <label><input type="checkbox" data-view="allAirports" ${v.allAirports ? 'checked' : ''}/> All airports</label>
    <label><input type="checkbox" data-view="rail" ${v.rail ? 'checked' : ''}/> Railway lines</label>
    <label><input type="checkbox" data-view="globe" ${v.globe ? 'checked' : ''}/> Globe</label>
    <label class="basemap">Map <select data-view="basemap">${Object.entries(BASEMAPS)
      .map(([k, b]) => `<option value="${k}" ${k === v.basemap ? 'selected' : ''}>${b.label}</option>`)
      .join('')}</select></label>`;
  $('#layers').addEventListener('change', (ev) => {
    const key = ev.target.dataset.view;
    if (!key) return;
    state.view[key] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
    applyView();
  });
  $('#layers-toggle').onclick = () => $('#layers').classList.toggle('open');
}

function initPanel() {
  for (const btn of document.querySelectorAll('.tabs button')) btn.onclick = () => showTab(btn.dataset.tab);

  $('#year-filter').onchange = (ev) => {
    state.year = ev.target.value;
    state.sel.route = state.sel.trip = null;
    update();
  };

  $('#country-search').oninput = (ev) => {
    state.countrySearch = ev.target.value.trim().toLowerCase();
    renderCountries();
  };
  for (const r of document.querySelectorAll('input[name="cfilter"]')) {
    r.onchange = () => {
      state.countryFilter = r.value;
      renderCountries();
    };
  }
  $('#country-list').addEventListener('change', (ev) => {
    const id = ev.target.dataset.id;
    if (id) setManual(id, ev.target.value);
  });
  for (const b of document.querySelectorAll('[data-tgroup]')) {
    b.onclick = () => {
      state.tccGroup = b.dataset.tgroup;
      renderCountries();
    };
  }
  for (const b of document.querySelectorAll('[data-cview]')) {
    b.onclick = () => {
      state.countryView = b.dataset.cview;
      renderCountries();
    };
  }
  $('#country-list').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-focus]');
    if (el) focusDestination(+el.dataset.focus);
  });

  // Delegated actions anywhere in the panel.
  $('#panel').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    ev.preventDefault();
    const { action, value } = el.dataset;
    if (action === 'airport') {
      selectAirport(value);
      M.flyTo(coord(value), 4);
    } else if (action === 'route') select({ route: value });
    else if (action === 'close') clearSelection();
    else if (action === 'set-visit') {
      const [idx, mode] = value.split(':');
      setManual(state.tcc[+idx].id, mode);
    } else if (action === 'trip') {
      select({ trip: value });
      const t = state.trips.find((x) => x.id === value);
      if (t) M.fitCoords(t.coords);
    } else if (action === 'delete-trip') deleteTrip(value);
    else if (action === 'edit-trip') editTrip(value);
    else if (action === 'new-trip') startDraft();
    else if (action === 'reroute') rerouteStraight();
    else if (action === 'cancel-draft') cancelDraft();
    else if (action === 'save-draft') saveDraft();
    else if (action === 'wp-remove') removeWaypoint(+value);
    else if (action === 'wp-up') moveWaypoint(+value, -1);
    else if (action === 'wp-down') moveWaypoint(+value, 1);
    else if (action === 'add-result') addWaypoint(state.searchResults[+value]);
  });

  initDataTab();
  initTripsTab();
}

function initDataTab() {
  const dz = $('#drop-zone');
  dz.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    dz.classList.add('over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (ev) => {
    ev.preventDefault();
    dz.classList.remove('over');
    const file = ev.dataTransfer.files[0];
    if (file) importCsvFile(file);
  });
  $('#csv-input').onchange = (ev) => ev.target.files[0] && importCsvFile(ev.target.files[0]);
  $('#reset-flights').onclick = () => {
    store.set(LS_FLIGHTS, null);
    setFlights(state.bundledCsv ? parseFlightCsv(state.bundledCsv) : [], 'bundled');
    buildYearFilter();
    update();
  };
  $('#add-flight').onsubmit = (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const from = parseAirportField(String(fd.get('from')));
    const to = parseAirportField(String(fd.get('to')));
    if (!resolveAirport(from) || !resolveAirport(to)) {
      $('#import-warnings').innerHTML = `<p class="warn">Unknown airport code.</p>`;
      return;
    }
    const rows = currentRows();
    rows.push({ date: String(fd.get('date') || ''), flightNo: '', from, to, airline: '', aircraft: '', registration: '', depTime: '', duration: '' });
    store.set(LS_FLIGHTS, { source: 'edited', rows: serializeRows(rows) });
    setFlights(rows, 'edited');
    ev.target.reset();
    buildYearFilter();
    update();
  };
  $('#export-visited').onclick = () => {
    const obj = Object.fromEntries([...state.manual].sort(([a], [b]) => a.localeCompare(b)));
    download('visited.json', JSON.stringify(obj, null, 2) + '\n');
  };
  $('#reset-visited').onclick = () => {
    store.set(LS_VISITED, null);
    state.manual = new Map(state.bundledVisited);
    update();
  };
  $('#visited-input').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const known = new Set(state.tcc.map((t) => t.id));
      state.manual = normalizeVisited(JSON.parse(await file.text()), known);
      saveVisited();
      update();
    } catch (err) {
      alert(`Could not read visited list: ${err.message}`);
    }
    ev.target.value = '';
  };
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function currentRows() {
  const toRef = (code) => ({ iata: code, icao: state.airports[code][5], label: '' });
  return [...state.flights.map((f) => ({ ...f, from: toRef(f.from), to: toRef(f.to) })), ...state.unresolved];
}

async function importCsvFile(file) {
  try {
    const rows = parseFlightCsv(await file.text());
    if (!rows.length) throw new Error('No flights found in file.');
    store.set(LS_FLIGHTS, { source: `imported (${file.name})`, rows: serializeRows(rows) });
    setFlights(rows, `imported (${file.name})`);
    buildYearFilter();
    update();
  } catch (err) {
    $('#import-warnings').innerHTML = `<p class="warn">${esc(err.message)}</p>`;
  }
}

function setManual(id, mode) {
  if (mode) state.manual.set(id, mode);
  else state.manual.delete(id);
  saveVisited();
  drawCountries();
  renderStats();
  renderCountries();
  renderOverview();
}

function showTab(name) {
  for (const btn of document.querySelectorAll('.tabs button')) btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  for (const tab of document.querySelectorAll('.tab')) tab.hidden = tab.id !== `tab-${name}`;
}

function focusDestination(idx) {
  const f = state.features.find((d) => d.id === idx);
  const t = state.tcc[idx];
  if (f) {
    const [[w, s], [e, n]] = d3.geoBounds(f);
    const spansGlobe = e < w || e - w > 120;
    if (spansGlobe && t.pt) M.flyTo(t.pt, 4);
    else M.fitCoords([[w, s], [e, n]], 8);
  } else if (t.pt) M.flyTo(t.pt, 6);
  select({ dest: idx });
}

function buildYearFilter() {
  const dates = [...state.flights.map((f) => f.date), ...state.trips.map((t) => t.date)];
  const years = [...new Set(dates.map((d) => (d || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel = $('#year-filter');
  sel.innerHTML = `<option value="all">All years</option>${years.map((y) => `<option value="${y}">${y}</option>`).join('')}`;
  if (state.year !== 'all' && !years.includes(state.year)) state.year = 'all';
  sel.value = state.year;
}

function update() {
  drawCountries();
  drawMovements();
  renderStats();
  renderOverview();
  renderCountries();
  renderTrips();
  renderData();
}

function renderStats() {
  const flights = filteredFlights();
  const trips = filteredTrips();
  const flightKm = d3.sum(flights, (f) => airportKm(f.from, f.to));
  const tripKm = d3.sum(trips, (t) => lineLengthKm(t.coords));
  const items = [
    [fmt(flights.length), 'Flights'],
    [fmt(Math.round(flightKm)), 'Flight km'],
    [fmt(Math.round(tripKm)), 'Road/rail/sea km'],
    [fmt(state.agg.airports.length), 'Airports'],
    [`${visitedCountries().size}<small class="muted">/${COUNTRIES.length}</small>`, 'Countries'],
    [`${visitedCount()}<small class="muted">/${state.tcc.length}</small>`, 'TCC visited'],
  ];
  $('#stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
}

function flightRows(flights) {
  return flights
    .slice()
    .reverse()
    .map(
      (f) => `<div class="flight-row">
        <span>${esc(f.date)}</span>
        <span class="muted">${esc([f.flightNo, f.airline].filter(Boolean).join(' · ')) || '&nbsp;'}</span>
        <span>${f.from} → ${f.to}</span>
      </div>`,
    )
    .join('');
}

function card(title, sub, body) {
  return `<div class="card">
    <div class="card-head">
      <div><h3>${title}</h3>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>
      <button type="button" class="close" data-action="close" aria-label="Close">✕</button>
    </div>${body}</div>`;
}

function renderOverview() {
  const el = $('#tab-overview');
  const { routes } = state.agg;
  const { airport, route, trip, dest, anyAirport } = state.sel;
  if (airport || route || trip || dest != null || anyAirport) $('#panel').scrollTop = 0;

  if (route) {
    const r = findRoute(route);
    if (r) {
      el.innerHTML = card(
        routeTitle(r),
        routeSub(r),
        `<div class="list">${
          isLoop(r)
            ? `<div class="list-item" data-action="airport" data-value="${r.a}"><span>${r.a} → ${r.a}</span><span class="pill">${r.total}</span></div>`
            : `<div class="list-item" data-action="airport" data-value="${r.a}"><span>${r.a} → ${r.b}</span><span class="pill">${r.ab}</span></div>
               <div class="list-item" data-action="airport" data-value="${r.b}"><span>${r.b} → ${r.a}</span><span class="pill">${r.ba}</span></div>`
        }</div>
        <h2>Flights</h2>${flightRows(r.flights)}`,
      );
      return;
    }
  }

  if (airport) {
    const ap = state.airports[airport];
    const mine = routes
      .filter((r) => r.a === airport || r.b === airport)
      .map((r) => {
        const other = r.a === airport ? r.b : r.a;
        return { r, other, out: r.a === airport ? r.ab : r.ba, inn: r.a === airport ? r.ba : r.ab };
      })
      .sort((x, y) => y.r.total - x.r.total);
    const flights = filteredFlights().filter((f) => f.from === airport || f.to === airport);
    const t = state.tcc[ap[6]];
    el.innerHTML = card(
      `${airport} · ${esc(ap[1] || ap[0])}`,
      `${esc(ap[0])}${ap[5] ? ` · ${ap[5]}` : ''}${t ? ` · ${esc(t.name)}` : ''}`,
      `<div class="muted small">${flights.length} flights · ${mine.length} routes · <span title="departures">↗ ${d3.sum(mine, (m) => m.out)}</span> · <span title="arrivals">↘ ${d3.sum(mine, (m) => m.inn)}</span></div>
      <h2>Routes</h2>
      <div class="list">
        ${mine
          .map(
            (m) => `<div class="list-item" data-action="route" data-value="${m.r.key}">
              ${
                isLoop(m.r)
                  ? `<div><div>⟲ Local flights</div><div class="sub">Start and end at ${airport}</div></div><span class="pill">${m.r.total}</span>`
                  : `<div><div>${m.other} <span class="muted small">${esc(airportName(m.other))}</span></div>
              <div class="sub">${fmt(Math.round(airportKm(airport, m.other)))} km</div></div>
              <span class="dir"><span class="pill" title="${airport} → ${m.other}">→ ${m.out}</span><span class="pill" title="${m.other} → ${airport}">← ${m.inn}</span></span>`
              }
            </div>`,
          )
          .join('')}
      </div>
      <h2>Flights</h2>${flightRows(flights)}`,
    );
    return;
  }

  if (anyAirport) {
    const ap = state.airports[anyAirport];
    const t = state.tcc[ap[6]];
    el.innerHTML = card(`${anyAirport} · ${esc(ap[1] || ap[0])}`, `${esc(ap[0])}${ap[5] ? ` · ${ap[5]}` : ''}${t ? ` · ${esc(t.name)}` : ''}`, '<p class="muted">No flights recorded here.</p>');
    return;
  }

  if (trip) {
    const t = state.trips.find((x) => x.id === trip);
    if (t) {
      const dests = [...evidence()].filter(([, e]) => e.trips.has(t.id)).map(([idx]) => state.tcc[idx].name);
      el.innerHTML = card(
        `${MODES[t.mode]?.icon || ''} ${esc(t.name || 'Trip')}`,
        `${esc(t.date || 'No date')} · ${MODES[t.mode]?.label || t.mode} · ${fmt(Math.round(lineLengthKm(t.coords)))} km`,
        `${t.waypoints.length ? `<ol class="wp-view">${t.waypoints.map((w) => `<li>${esc(w.name)}</li>`).join('')}</ol>` : ''}
        ${dests.length ? `<p class="small">Destinations: ${dests.map(esc).join(', ')}</p>` : ''}
        ${t.routedBy === 'straight' ? '<p class="muted small">Drawn as straight lines (no route found).</p>' : ''}
        <div class="row"><button type="button" data-action="edit-trip" data-value="${t.id}">Edit</button><button type="button" data-action="delete-trip" data-value="${t.id}">Delete</button></div>`,
      );
      return;
    }
  }

  if (dest != null) {
    const t = state.tcc[dest];
    const st = visitStatus(dest);
    const ev = evidence().get(dest);
    const via = ev ? [...ev.airports] : [];
    const tripList = ev ? [...ev.trips].map((id) => state.trips.find((x) => x.id === id)).filter(Boolean) : [];
    el.innerHTML = card(
      esc(t.name),
      esc(regionsOf(t).join(' · ')),
      `${t.part ? `<p class="muted small">Part of ${esc(state.countryIdx.get(t.sov).name)}.</p>` : ''}
       ${via.length ? `<p>Flew to ${via.map((c) => `<a href="#" class="link-btn" data-action="airport" data-value="${c}">${c}</a>`).join(', ')}.</p>` : ''}
       ${tripList.length ? `<p>Trips: ${tripList.map((x) => `<a href="#" class="link-btn" data-action="trip" data-value="${x.id}">${esc(x.name || x.date || 'trip')}</a>`).join(', ')}.</p>` : ''}
       ${st === '' ? '<p>Not visited yet.</p>' : ''}
       <p class="small muted">${st === 'auto' ? 'Also visited (added manually):' : 'Visited by:'}</p>
       <div class="mode-btns">
         ${Object.entries(VISIT_MODES)
           .map(([k, m]) => `<button type="button" class="${state.manual.get(t.id) === k ? 'on' : ''}" data-action="set-visit" data-value="${dest}:${k}">${m.icon} ${m.label}</button>`)
           .join('')}
         ${state.manual.has(t.id) ? `<button type="button" data-action="set-visit" data-value="${dest}:">Clear</button>` : ''}
       </div>`,
    );
    return;
  }

  const top = routes
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  el.innerHTML = `
    <p class="muted small">Click an airport for its routes, a line for its flights or trip, or a country to mark it as visited.
    Line thickness and colour show how often a route was flown; arrow size shows each direction.</p>
    <h2>Most flown routes</h2>
    <div class="list">
      ${top
        .map(
          (r) => `<div class="list-item" data-action="route" data-value="${r.key}">
            <div><div>${routeTitle(r)}</div><div class="sub">${routeSub(r)}</div></div>
            ${isLoop(r) ? `<span class="pill">${r.total}</span>` : `<span class="dir"><span class="pill" title="${r.a} → ${r.b}">→ ${r.ab}</span><span class="pill" title="${r.b} → ${r.a}">← ${r.ba}</span></span>`}
          </div>`,
        )
        .join('')}
    </div>
    <h2>Airports</h2>
    <div class="list">
      ${state.agg.airports
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map(
          (a) => `<div class="list-item" data-action="airport" data-value="${a.code}">
            <div>${a.code} <span class="muted small">${esc(airportName(a.code))}</span></div>
            <span class="pill">${a.count}</span>
          </div>`,
        )
        .join('')}
    </div>`;
}

function flag(iso) {
  if (!/^[A-Z]{2}$/.test(iso) || iso === 'XK' || iso === 'XN') return '🏳️';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function bar(label, v, total) {
  return `<div class="bar-row"><span>${esc(label)}</span><span class="muted">${v} / ${total}</span><b>${pct(v, total)}%</b>
    <div class="progress"><div style="width:${pct(v, total)}%"></div></div></div>`;
}

function renderCountries() {
  for (const b of document.querySelectorAll('[data-cview]')) b.setAttribute('aria-pressed', String(b.dataset.cview === state.countryView));
  for (const b of document.querySelectorAll('[data-tgroup]')) b.setAttribute('aria-pressed', String(b.dataset.tgroup === state.tccGroup));
  $('#tcc-controls').hidden = $('#tcc-search').hidden = state.countryView !== 'tcc';
  if (state.countryView === 'tcc') renderTccList();
  else renderCountryList();
}

/** Sovereign countries: per-continent percentages and the list of visited countries. */
function renderCountryList() {
  const visited = visitedCountries();
  const conts = Object.entries(CONTINENTS).map(([code, name]) => {
    const all = COUNTRIES.filter((c) => c.continents.includes(code));
    return { name, total: all.length, v: all.filter((c) => visited.has(c.iso)).length };
  });
  const list = [...visited.values()].sort((a, b) => a.country.name.localeCompare(b.country.name));
  $('#country-progress').innerHTML = `
    <div class="progress-total"><span><b>${visited.size}</b> <span class="muted">of ${COUNTRIES.length} countries</span></span><span class="muted">${pct(visited.size, COUNTRIES.length)}%</span></div>
    <div class="progress"><div style="width:${pct(visited.size, COUNTRIES.length)}%"></div></div>
    <h2>Per continent</h2>
    ${conts.map((c) => bar(c.name, c.v, c.total)).join('')}
    <p class="muted small">Countries are the 193 UN members plus Vatican City, Palestine, Cook Islands, Niue, Kosovo, Northern Cyprus and Taiwan.
    Visiting a territory (e.g. Crete, Tasmania) counts its country. Russia, Turkey and Egypt count for both their continents.</p>`;
  $('#country-list').innerHTML = `
    <h2>Visited countries</h2>
    ${list
      .map(({ country, dests, modes }) => {
        const parts = dests.map((i) => state.tcc[i]).filter((t) => t.part);
        return `<div class="country-row" data-focus="${dests[0]}">
          <span class="flag">${flag(country.iso)}</span>
          <span><span class="name">${esc(country.name)}</span>${parts.length ? `<div class="sub">${parts.map((t) => esc(t.name.replace(/\s*\(.*\)$/, ''))).join(', ')}</div>` : ''}</span>
          <span class="modes" title="${[...modes].map((m) => VISIT_MODES[m]?.label).join(', ')}">${modeIcons([...modes])}</span>
        </div>`;
      })
      .join('')}`;
}

function renderTccList() {
  const entries = state.tcc.map((t, idx) => ({ ...t, idx, status: visitStatus(idx) }));
  // Group by TCC region or by continent. Destinations spanning two continents
  // appear in both groups but are one destination.
  const byContinent = state.tccGroup === 'continent';
  const groupsOf = byContinent ? (t) => t.cont.map((c) => TCC_CONTINENTS[c]) : regionsOf;
  const regions = new Map();
  for (const t of entries) {
    for (const r of groupsOf(t)) {
      if (!regions.has(r)) regions.set(r, []);
      regions.get(r).push(t);
    }
  }
  const order = byContinent ? Object.values(TCC_CONTINENTS).filter((c) => regions.has(c)) : [...new Set(state.tcc.map((t) => t.region))];
  const total = state.tcc.length;
  const visited = visitedCount();
  $('#country-progress').innerHTML = `
    <div class="progress-total"><span><b>${visited}</b> <span class="muted">of ${total} TCC destinations</span></span><span class="muted">${pct(visited, total)}%</span></div>
    <div class="progress"><div style="width:${pct(visited, total)}%"></div></div>
    <p class="muted small">${officialCount()} of 330 by official TCC numbering (Russia, Turkey and Egypt are one destination here but two on the TCC list).</p>
    <h2>Per ${byContinent ? 'continent' : 'TCC region'}</h2>
    ${order.map((r) => bar(r, regions.get(r).filter((t) => t.status).length, regions.get(r).length)).join('')}`;

  const q = state.countrySearch;
  const html = [];
  for (const region of order) {
    const list = regions.get(region).slice().sort((a, b) => a.name.localeCompare(b.name));
    const shown = list.filter(
      (t) =>
        (!q || t.name.toLowerCase().includes(q)) &&
        (state.countryFilter === 'all' || (state.countryFilter === 'visited' ? t.status : !t.status)),
    );
    if (!shown.length) continue;
    const v = list.filter((t) => t.status).length;
    html.push(`<div class="region"><div class="region-head">${esc(region)}<span>${v} / ${list.length} · ${pct(v, list.length)}%</span></div>`);
    for (const t of shown) {
      const other = groupsOf(t).filter((r) => r !== region);
      const manual = state.manual.get(t.id) || '';
      const autoModes = t.status === 'auto' ? visitModes(t.idx).filter((m) => m !== manual || !manual) : [];
      html.push(`<div class="country">
        <span class="name" data-focus="${t.idx}">${esc(t.name)}${other.length ? ` <span class="also" title="Also listed under ${esc(other.join(', '))}">+ ${esc(other.join(', '))}</span>` : ''}</span>
        <span class="auto-modes" title="Visited by flights / trips">${modeIcons(autoModes)}</span>
        <select data-id="${t.id}" class="visit-select ${t.status ? 'on' : ''}" aria-label="How you visited ${esc(t.name)}">
          <option value="">${t.status === 'auto' ? '✓' : '–'}</option>
          ${Object.entries(VISIT_MODES).map(([k, m]) => `<option value="${k}" ${manual === k ? 'selected' : ''}>${m.icon} ${m.label}</option>`).join('')}
        </select>
      </div>`);
    }
    html.push('</div>');
  }
  $('#country-list').innerHTML = html.join('') || '<p class="muted">No matches.</p>';
}

// ----------------------------------------------------------------- trips

function initTripsTab() {
  $('#trip-file').onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const tracks = parseTrackFile(await file.text(), file.name);
      if (!tracks.length) throw new Error('No tracks found in file.');
      const mode = $('#trip-file-mode').value;
      for (const t of tracks) {
        state.trips.push({
          id: uid(),
          mode,
          name: t.name || file.name.replace(/\.[^.]+$/, ''),
          date: t.date || '',
          waypoints: [],
          coords: t.coords,
          routedBy: 'track',
        });
      }
      saveTrips();
      evidenceCache = null;
      buildYearFilter();
      update();
      $('#trip-msg').innerHTML = `<p class="ok">Imported ${tracks.length} track(s).</p>`;
    } catch (err) {
      $('#trip-msg').innerHTML = `<p class="warn">${esc(err.message)}</p>`;
    }
  };
  $('#export-trips').onclick = () => download('trips.json', JSON.stringify(state.trips) + '\n');
  $('#import-trips').onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const trips = JSON.parse(await file.text());
      if (!Array.isArray(trips)) throw new Error('Expected a JSON array of trips.');
      setTrips(trips, 'edited');
      saveTrips();
      buildYearFilter();
      update();
    } catch (err) {
      $('#trip-msg').innerHTML = `<p class="warn">${esc(err.message)}</p>`;
    }
  };
  $('#reset-trips').onclick = () => {
    store.set(LS_TRIPS, null);
    setTrips(state.bundledTrips, 'bundled');
    buildYearFilter();
    update();
  };
  $('#trips-list').addEventListener('input', onDraftInput);
  $('#trips-list').addEventListener('change', onDraftInput);
  $('#trips-list').addEventListener('keydown', (ev) => {
    if (ev.target.id === 'wp-search' && ev.key === 'Enter') {
      ev.preventDefault();
      runSearch(ev.target.value);
    }
  });
}

function onDraftInput(ev) {
  const d = state.draft;
  const f = ev.target.dataset.field;
  if (!d || !f) return;
  d[f] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
  if (f === 'clickToAdd') $('#map-wrap').classList.toggle('adding', d.clickToAdd);
  if (f === 'mode' && ev.type === 'change') renderTrips();
}

function startDraft(base) {
  state.draft = base || { id: null, mode: 'road', name: '', date: '', waypoints: [], clickToAdd: true };
  state.searchResults = [];
  $('#map-wrap').classList.toggle('adding', state.draft.clickToAdd);
  showTab('trips');
  renderTrips();
  M.setData('draft', draftGeoJson());
}

function editTrip(id) {
  const t = state.trips.find((x) => x.id === id);
  if (!t) return;
  startDraft({ id: t.id, mode: t.mode, name: t.name, date: t.date, waypoints: t.waypoints.map((w) => ({ ...w })), clickToAdd: false, coords: t.coords, routedBy: t.routedBy });
}

function cancelDraft() {
  state.draft = null;
  $('#map-wrap').classList.remove('adding');
  M.setData('draft', draftGeoJson());
  renderTrips();
}

function addWaypoint(w) {
  if (!state.draft || !w) return;
  state.draft.waypoints.push({ name: w.name, lon: +w.lon, lat: +w.lat });
  state.searchResults = [];
  M.setData('draft', draftGeoJson());
  renderTrips();
}

function removeWaypoint(i) {
  state.draft.waypoints.splice(i, 1);
  M.setData('draft', draftGeoJson());
  renderTrips();
}

function moveWaypoint(i, delta) {
  const wps = state.draft.waypoints;
  const j = i + delta;
  if (j < 0 || j >= wps.length) return;
  [wps[i], wps[j]] = [wps[j], wps[i]];
  M.setData('draft', draftGeoJson());
  renderTrips();
}

async function runSearch(q) {
  const box = $('#wp-results');
  box.innerHTML = '<p class="muted small">Searching…</p>';
  try {
    state.searchResults = await searchPlaces(q, state.airports);
    renderSearchResults();
  } catch (err) {
    box.innerHTML = `<p class="warn">${esc(err.message)}</p>`;
  }
}

function renderSearchResults() {
  const box = $('#wp-results');
  if (!box) return;
  const res = state.searchResults || [];
  box.innerHTML = res
    .map((r, i) => `<div class="list-item" data-action="add-result" data-value="${i}"><div><div>${esc(r.name)}</div><div class="sub">${esc(r.detail)}</div></div><span class="pill">+</span></div>`)
    .join('');
}

async function saveDraft() {
  const d = state.draft;
  const msg = $('#draft-msg');
  // Imported tracks without stops keep their recorded geometry.
  const keepTrack = d.id && d.waypoints.length === 0 && d.coords;
  if (!keepTrack && d.waypoints.length < 2) {
    msg.innerHTML = '<p class="warn">Add at least two stops.</p>';
    return;
  }
  msg.innerHTML = '<p class="muted small">Finding route…</p>';
  let { coords, routedBy } = d;
  let warning = null;
  if (!keepTrack) ({ coords, routedBy, warning } = await routeTrip(d.mode, d.waypoints));
  const trip = { id: d.id || uid(), mode: d.mode, name: d.name.trim(), date: d.date, waypoints: d.waypoints, coords, routedBy };
  const i = state.trips.findIndex((t) => t.id === trip.id);
  if (i >= 0) state.trips[i] = trip;
  else state.trips.push(trip);
  saveTrips();
  evidenceCache = null;
  state.draft = null;
  $('#map-wrap').classList.remove('adding');
  M.setData('draft', draftGeoJson());
  buildYearFilter();
  update();
  $('#trip-msg').innerHTML = warning ? `<p class="warn">${esc(warning)}</p>` : '';
  select({ trip: trip.id });
  M.fitCoords(trip.coords);
}

const needsRouting = (t) => t.routedBy === 'straight' && (t.mode === 'road' || t.mode === 'train') && t.waypoints.length > 1;

/** Re-runs road/rail routing for trips saved as straight lines (e.g. added while offline). */
async function rerouteStraight() {
  const todo = state.trips.filter(needsRouting);
  let ok = 0;
  for (const [i, t] of todo.entries()) {
    $('#trip-msg').innerHTML = `<p class="muted small">Routing ${i + 1} / ${todo.length}: ${esc(t.name)}…</p>`;
    const res = await routeTrip(t.mode, t.waypoints);
    if (res.routedBy !== 'straight') {
      Object.assign(t, { coords: res.coords, routedBy: res.routedBy });
      ok++;
    }
  }
  saveTrips();
  evidenceCache = null;
  update();
  $('#trip-msg').innerHTML = `<p class="${ok === todo.length ? 'ok' : 'warn'}">Routed ${ok} of ${todo.length} trips.${ok ? ' Export trips.json to publish them.' : ''}</p>`;
}

function deleteTrip(id) {
  const t = state.trips.find((x) => x.id === id);
  if (!t || !confirm(`Delete trip "${t.name || t.date || 'trip'}"?`)) return;
  state.trips = state.trips.filter((x) => x.id !== id);
  saveTrips();
  evidenceCache = null;
  state.sel = { airport: null, route: null, trip: null, dest: null, anyAirport: null };
  update();
}

function renderTrips() {
  const el = $('#trips-list');
  const d = state.draft;
  if (d) {
    el.innerHTML = `
      <div class="card draft">
        <h3>${d.id ? 'Edit trip' : 'New trip'}</h3>
        <div class="form-grid">
          <label>Type <select data-field="mode">${Object.entries(MODES)
            .map(([k, m]) => `<option value="${k}" ${k === d.mode ? 'selected' : ''}>${m.icon} ${m.label}</option>`)
            .join('')}</select></label>
          <label>Date <input type="date" data-field="date" value="${esc(d.date)}" /></label>
          <label class="full">Name <input data-field="name" value="${esc(d.name)}" placeholder="e.g. Norway road trip" /></label>
        </div>
        <h2>Stops</h2>
        <ol class="wp-list">
          ${d.waypoints
            .map(
              (w, i) => `<li><span>${esc(w.name)}</span>
                <span class="wp-btns">
                  <button type="button" data-action="wp-up" data-value="${i}" aria-label="Move up">↑</button>
                  <button type="button" data-action="wp-down" data-value="${i}" aria-label="Move down">↓</button>
                  <button type="button" data-action="wp-remove" data-value="${i}" aria-label="Remove">✕</button>
                </span></li>`,
            )
            .join('')}
        </ol>
        ${d.waypoints.length === 0 && d.coords ? '<p class="muted small">Imported track: its recorded path is kept.</p>' : ''}
        <input id="wp-search" type="search" placeholder="Search a place or airport code, then Enter" autocomplete="off" />
        <div id="wp-results" class="list"></div>
        <label class="small check"><input type="checkbox" data-field="clickToAdd" ${d.clickToAdd ? 'checked' : ''}/> Add stops by clicking the map</label>
        <p class="muted small">${
          d.mode === 'road'
            ? 'Routed along roads (OSRM, OpenStreetMap data).'
            : d.mode === 'train'
              ? 'Routed along railway lines (BRouter rail profile, OpenStreetMap data).'
              : d.mode === 'boat'
                ? 'Routed along shipping lanes between the ports.'
                : 'Drawn as straight lines between stops.'
        }</p>
        <div id="draft-msg"></div>
        <div class="row">
          <button type="button" class="primary" data-action="save-draft">Save trip</button>
          <button type="button" data-action="cancel-draft">Cancel</button>
        </div>
      </div>`;
    renderSearchResults();
    return;
  }
  const list = filteredTrips();
  const trips = list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const byMode = d3.rollup(list, (v) => d3.sum(v, (t) => lineLengthKm(t.coords)), (t) => t.mode);
  el.innerHTML = `
    <div class="row"><button type="button" class="primary" data-action="new-trip">+ New trip</button>${
      state.trips.some(needsRouting)
        ? `<button type="button" data-action="reroute" title="Look up the actual road and rail routes for trips drawn as straight lines">Route ${state.trips.filter(needsRouting).length} straight-line trips</button>`
        : ''
    }</div>
    ${byMode.size ? `<div class="mode-sums">${[...byMode].map(([m, km]) => `<span class="pill">${MODES[m]?.icon || ''} ${fmt(Math.round(km))} km</span>`).join('')}</div>` : ''}
    <div class="list">
      ${
        trips.length
          ? trips
              .map(
                (t) => `<div class="list-item" data-action="trip" data-value="${t.id}">
                <div><div>${MODES[t.mode]?.icon || ''} ${esc(t.name || 'Trip')}</div>
                <div class="sub">${esc(t.date || 'No date')} · ${fmt(Math.round(lineLengthKm(t.coords)))} km${t.routedBy === 'straight' ? ' · straight lines' : ''}</div></div>
                <span class="pill" style="border-color:${MODES[t.mode]?.color}">${MODES[t.mode]?.label || t.mode}</span>
              </div>`,
              )
              .join('')
          : '<p class="muted">No trips yet. Add a road trip, train journey or cruise, or import a GPX/KML/GeoJSON track below.</p>'
      }
    </div>`;
}

function renderData() {
  const src = state.flightSource === 'bundled' ? 'Showing the bundled <code>data/flights.csv</code>.' : `Showing ${esc(state.flightSource)} flights stored in this browser.`;
  $('#flight-source').innerHTML = `${src} ${state.flights.length} flights loaded.`;
  $('#reset-flights').hidden = state.flightSource === 'bundled';
  $('#reset-trips').hidden = state.tripSource === 'bundled';
  const bad = state.unresolved;
  $('#import-warnings').innerHTML = bad.length
    ? `<p class="warn">${bad.length} flight(s) skipped, unknown airport: ${bad
        .slice(0, 8)
        .map((r) => esc(`${r.from.iata || r.from.icao || r.from.label} → ${r.to.iata || r.to.icao || r.to.label}`))
        .join(', ')}${bad.length > 8 ? '…' : ''}</p>`
    : '';
}

init().catch((err) => {
  console.error(err);
  $('#loading').textContent = `Failed to load: ${err.message}`;
});
