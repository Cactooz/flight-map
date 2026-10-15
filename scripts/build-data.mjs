// Builds the static data files the site loads:
//   data/airports.json    IATA -> [name, municipality, country, lat, lon, icao, tccIndex,
//                         servedCity, cityLon, cityLat]
//   data/tcc.json         TCC destinations with marker position
//   data/tcc-shapes.json  TopoJSON, one geometry per TCC destination
//   vendor/*.js           d3 + topojson-client browser builds
//
// Sources: OurAirports (ourairports-data-js), Natural Earth 10m ADM1 polygons
// (downloaded once into .cache/; @geo-insight/data says which countries to
// take from it) and Natural Earth countries (world-atlas).

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoArea, geoCentroid } from 'd3-geo';
import { group as d3group } from 'd3-array';
import { topology } from 'topojson-server';
import { presimplify, simplify, sphericalTriangleArea } from 'topojson-simplify';
import { feature, merge } from 'topojson-client';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { AIRPORT_CITY, CITY_POSITION } from '../src/airport-cities.js';
import { TCC, idOf } from '../src/tcc-list.js';
import { COUNTRIES, TERRITORY_PARENT, DEBATED, CONTINENT_BY_REGION, CONTINENT_OVERRIDES } from '../src/countries.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = (name) => join(root, 'node_modules', name);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---------------------------------------------------------------- matching

const entries = TCC.map((e, i) => {
  const rCountries = (e.r || []).map((r) => r.split('-')[0]);
  return {
    ...e,
    id: idOf(e),
    index: i,
    boxCountries: new Set(e.bc || [...(e.c || []), ...rCountries]),
  };
});

const numbers = entries.flatMap((e) => e.n).sort((a, b) => a - b);
if (numbers.length !== 330 || numbers.some((n, i) => n !== i + 1)) throw new Error('TCC numbers must cover 1..330 exactly once');

// Sovereign country each destination belongs to (territories count their parent).
const countryIsos = new Set(COUNTRIES.map((c) => c.iso));
for (const e of entries) {
  const num = e.n[0];
  if (DEBATED.includes(num)) e.sov = null;
  else e.sov = TERRITORY_PARENT[num] || e.c?.[0] || e.r?.[0].split('-')[0];
  if (e.sov && !countryIsos.has(e.sov)) throw new Error(`${e.name}: unknown country ${e.sov}`);
}
for (const id of Object.keys(CONTINENT_OVERRIDES)) {
  if (!entries.some((e) => e.id === id)) throw new Error(`Continent override for unknown destination ${id}`);
}
const sovs = new Set(entries.map((e) => e.sov));
for (const c of COUNTRIES) if (!sovs.has(c.iso)) throw new Error(`No destination for country ${c.name}`);

const ids = new Set();
for (const e of entries) {
  if (ids.has(e.id)) throw new Error(`Duplicate TCC id ${e.id}`);
  ids.add(e.id);
}

const byAirport = new Map();
const byRegion = new Map();
const byCountry = new Map();
const boxed = [];
for (const e of entries) {
  for (const a of e.ap || []) byAirport.set(a, e);
  for (const r of e.r || []) byRegion.set(r, e);
  for (const c of e.c || []) {
    if (byCountry.has(c)) throw new Error(`Country ${c} is default for both ${byCountry.get(c).id} and ${e.id}`);
    byCountry.set(c, e);
  }
  if (e.box) boxed.push(e);
}

const inBox = ([w, s, e, n], lon, lat) => lon >= w && lon <= e && lat >= s && lat <= n;

/** Resolve a place (airport or polygon part) to a TCC entry, or null. */
function match({ iata, cc, region, lon, lat }) {
  if (iata && byAirport.has(iata)) return byAirport.get(iata);
  for (const e of boxed) {
    if (e.boxCountries.has(cc) && inBox(e.box, lon, lat)) return e;
  }
  if (region && byRegion.has(region)) return byRegion.get(region);
  return byCountry.get(cc) || null;
}

// ---------------------------------------------------------------- airports

const oaDir = join(pkgDir('ourairports-data-js'), 'dist', 'data');
const basic = readJson(join(oaDir, 'basic_info.json'));
const codes = new Map(readJson(join(oaDir, 'codes.json')).map((x) => [x.id, x]));
const coords = new Map(readJson(join(oaDir, 'coordinates.json')).map((x) => [x.id, x]));
const regions = new Map(readJson(join(oaDir, 'region.json')).map((x) => [x.id, x]));

// ------------------------------------------------------- airport cities

// World cities (GeoNames, population >= 1000) to place the city each airport
// serves at the city itself rather than at the airport.
const worldCities = createRequire(import.meta.url)('all-the-cities');
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const citiesByName = new Map();
for (const c of worldCities) {
  for (const n of new Set([c.name, ...(c.altName ? c.altName.split(',') : [])].map(norm))) {
    if (!n) continue;
    if (!citiesByName.has(n)) citiesByName.set(n, []);
    citiesByName.get(n).push(c);
  }
}
const kmBetween = ([x1, y1], [x2, y2]) => {
  const la = ((y1 + y2) / 2) * (Math.PI / 180);
  return Math.hypot((x1 - x2) * 111.32 * Math.cos(la), (y1 - y2) * 110.57);
};
/** [name, lon, lat] of the city an airport serves (falls back to the airport's position). */
function airportCity(iata, municipality, name, lon, lat) {
  const label = AIRPORT_CITY[iata] || (municipality || name).split(',')[0].split('/')[0].replace(/\s*\(.*\)\s*$/, '').trim();
  if (CITY_POSITION[label]) return [label, ...CITY_POSITION[label]];
  const near = (citiesByName.get(norm(label)) || []).filter((c) => kmBetween(c.loc.coordinates, [lon, lat]) < 100);
  const best = near.sort((a, b) => b.population - a.population)[0];
  return best ? [label, +best.loc.coordinates[0].toFixed(4), +best.loc.coordinates[1].toFixed(4)] : [label, lon, lat];
}

const typeRank = { large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3, heliport: 4, balloonport: 5, closed: 9 };
const airports = {};
const airportRank = {};
const unmatchedAirportCountries = new Set();
for (const b of basic) {
  const iata = (b.iata_code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(iata)) continue;
  const rank = typeRank[b.type] ?? 8;
  if (iata in airportRank && airportRank[iata] <= rank) continue;
  const c = coords.get(b.id);
  const r = regions.get(b.id);
  const k = codes.get(b.id);
  if (!c || !r) continue;
  const lat = +c.latitude_deg;
  const lon = +c.longitude_deg;
  const e = match({ iata, cc: r.iso_country, region: r.iso_region, lon, lat });
  if (!e) unmatchedAirportCountries.add(r.iso_country);
  airportRank[iata] = rank;
  airports[iata] = [
    b.name,
    r.municipality || '',
    r.iso_country,
    Math.round(lat * 1e4) / 1e4,
    Math.round(lon * 1e4) / 1e4,
    (k && (k.gps_code || k.ident)) || '',
    e ? e.index : -1,
    ...airportCity(iata, r.municipality, b.name, Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4),
  ];
}

// ------------------------------------------------------------------ shapes

const parts = new Map(); // entry index -> polygon coordinate arrays
const unassigned = [];

function addGeometry(geom, cc, region) {
  if (!geom) return;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (let poly of polys) {
    // d3-geo expects clockwise exterior rings; GeoJSON sources use the
    // opposite (RFC 7946) order, which d3 reads as "everything but this".
    if (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) poly = poly.map((ring) => ring.slice().reverse());
    const [lon, lat] = geoCentroid({ type: 'Polygon', coordinates: poly });
    const e = match({ cc, region, lon, lat });
    if (!e) {
      unassigned.push(poly);
      if (process.env.DEBUG) console.log('unassigned', cc, region, lon.toFixed(1), lat.toFixed(1));
      continue;
    }
    if (!parts.has(e.index)) parts.set(e.index, []);
    parts.get(e.index).push(poly);
  }
}

// Full-resolution Natural Earth 10m ADM1 (@geo-insight/data is the same data
// heavily simplified, which turned Andorra into a triangle and lost
// Singapore). Only countries @geo-insight/data has ADM1 for are taken from it,
// so the codes match the rules in src/tcc-list.js; the rest (Kosovo,
// Somaliland, ...) come from world-atlas below.
const NE_ADM1_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';
const neAdm1Path = join(root, '.cache', 'ne_10m_admin_1_states_provinces.geojson');
if (!existsSync(neAdm1Path)) {
  mkdirSync(dirname(neAdm1Path), { recursive: true });
  console.log('Downloading Natural Earth 10m ADM1 (~40 MB)...');
  execFileSync('curl', ['-sSfL', '-o', neAdm1Path, NE_ADM1_URL], { stdio: 'inherit' });
}
const adm1Dir = join(pkgDir('@geo-insight/data'), 'dist', 'assets', 'adm1');
const adm0WithAdm1 = new Set();
const adm0IsoWithAdm1 = new Set();
for (const file of readdirSync(adm1Dir)) {
  const fc = readJson(join(adm1Dir, file));
  adm0WithAdm1.add(fc.adm0);
  adm0IsoWithAdm1.add(fc.adm0iso);
}
for (const f of readJson(neAdm1Path).features) {
  if (!adm0IsoWithAdm1.has(f.properties.adm0_a3)) continue;
  const iso = f.properties.iso_3166_2 || '';
  addGeometry(f.geometry, iso.split('-')[0], iso);
}

// Countries / disputed areas that have no ADM1 file come from world-atlas.
const WORLD_ATLAS_CC = {
  Somaliland: ['XS'],
  Kosovo: ['XK'],
  'N. Cyprus': ['XN'],
  'Indian Ocean Ter.': ['CX'],
  'W. Sahara': ['EH'],
  'S. Sudan': ['SS'],
  Palestine: ['PS'],
  Åland: ['AX'],
  'Siachen Glacier': ['IN', 'IN-LA'],
  'Ashmore and Cartier Is.': ['AU'],
  Dhekelia: ['XB'],
  Akrotiri: ['XB'],
  'Cyprus U.N. Buffer Zone': ['CY'],
  'USNB Guantanamo Bay': ['CU'],
  Baikonur: ['KZ'],
  'Coral Sea Is.': ['AU'],
  // Drawn as land but not part of any destination.
  'Spratly Is.': [],
  'Clipperton I.': [],
  'Bajo Nuevo Bank': [],
  'Serranilla Bank': [],
  'Scarborough Reef': [],
};
const wa = readJson(join(pkgDir('world-atlas'), 'countries-10m.json'));
for (const f of feature(wa, wa.objects.countries).features) {
  if (f.id && adm0WithAdm1.has(f.id)) continue;
  const cc = WORLD_ATLAS_CC[f.properties.name];
  if (!cc) {
    console.warn(`world-atlas feature without ADM1 or mapping: ${f.id} ${f.properties.name}`);
    continue;
  }
  addGeometry(f.geometry, cc[0] || '--', cc[1]);
}

// One topology with every polygon part, so that neighbouring ADM1 parts share
// arcs and can be dissolved into a single outline per destination.
const partFeatures = [];
for (const e of entries) {
  for (const poly of parts.get(e.index) || []) {
    partFeatures.push({ type: 'Feature', properties: { e: e.index }, geometry: { type: 'Polygon', coordinates: poly } });
  }
}
for (const poly of unassigned) {
  partFeatures.push({ type: 'Feature', properties: { e: -1 }, geometry: { type: 'Polygon', coordinates: poly } });
}
const partsTopo = topology({ p: { type: 'FeatureCollection', features: partFeatures } }, 1e6);
const geomsByEntry = d3group(partsTopo.objects.p.geometries, (g) => g.properties.e);
const features = [...geomsByEntry].map(([e, geoms]) => ({
  type: 'Feature',
  id: e,
  properties: {},
  geometry: merge(partsTopo, geoms),
}));

let topo = topology({ tcc: { type: 'FeatureCollection', features } });
// Drop points whose triangle covers less than SIMPLIFY_KM2 km² (spherical
// area), so small countries like Andorra and Singapore keep a real outline
// while coastlines stay light enough to load quickly.
const SIMPLIFY_KM2 = +(process.env.SIMPLIFY_KM2 || 1);
topo = presimplify(topo, sphericalTriangleArea);
topo = simplify(topo, SIMPLIFY_KM2 / 6371 ** 2);

// Simplification can collapse tiny islands into rings with the wrong winding
// order (d3 would then fill the whole globe). Fix those up and re-encode.
const fixed = feature(topo, topo.objects.tcc).features.map((f) => {
  const polys = f.geometry ? (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) : [];
  const ok = [];
  for (let poly of polys) {
    if (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) poly = poly.map((ring) => ring.slice().reverse());
    if (geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) continue;
    ok.push(poly);
  }
  return { ...f, geometry: { type: 'MultiPolygon', coordinates: ok } };
});
topo = topology({ tcc: { type: 'FeatureCollection', features: fixed } }, 1e5);

// ------------------------------------------------------------- tcc.json

const tccOut = entries.map((e) => {
  const polys = parts.get(e.index);
  let pt = e.pt;
  let area = 0;
  if (polys) {
    let best = null;
    for (const p of polys) {
      const g = { type: 'Polygon', coordinates: p };
      const a = geoArea(g);
      area += a;
      if (!best || a > best.a) best = { a, g };
    }
    if (!pt) pt = geoCentroid(best.g);
  }
  if (!pt && e.box) pt = [(e.box[0] + e.box[2]) / 2, (e.box[1] + e.box[3]) / 2];
  if (!pt) console.warn(`No geometry or marker position for ${e.name}`);
  return {
    id: e.id,
    n: e.n,
    cont: CONTINENT_OVERRIDES[idOf(e)] || [CONTINENT_BY_REGION[e.region]],
    sov: e.sov,
    // The destination's own ISO country code; when it equals `sov` the
    // destination is an integral part of that country (Scotland, Crete, Hawaii)
    // rather than a separate dependency (Greenland, Aruba, Puerto Rico).
    cc: e.c?.[0] || e.r?.[0].split('-')[0] || e.bc?.[0] || null,
    // A territory / sub-national part of its country (e.g. Crete, England, Dubai).
    ...(TERRITORY_PARENT[e.n[0]] && e.n.length === 1 ? { part: true } : {}),
    name: e.name,
    region: e.region,
    ...(e.also ? { also: e.also } : {}),
    pt: pt ? pt.map((v) => Math.round(v * 100) / 100) : null,
    shape: !!polys,
    // Steradians * 1e6, used to decide which destinations get a marker.
    area: Math.round(area * 1e6),
  };
});

// ------------------------------------------------------------------ write

mkdirSync(join(root, 'data'), { recursive: true });
mkdirSync(join(root, 'vendor'), { recursive: true });
writeFileSync(join(root, 'data', 'airports.json'), JSON.stringify(airports));
writeFileSync(join(root, 'data', 'tcc.json'), JSON.stringify(tccOut, null, 0).replace(/\},\{/g, '},\n{'));
writeFileSync(join(root, 'data', 'tcc-shapes.json'), JSON.stringify(topo));
copyFileSync(join(pkgDir('d3'), 'dist', 'd3.min.js'), join(root, 'vendor', 'd3.min.js'));
copyFileSync(join(pkgDir('topojson-client'), 'dist', 'topojson-client.min.js'), join(root, 'vendor', 'topojson-client.min.js'));
for (const f of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) {
  copyFileSync(join(pkgDir('maplibre-gl'), 'dist', f), join(root, 'vendor', f));
}
// Offline sea routing (Eurostat maritime network) for boat trips, loaded on demand.
await build({
  entryPoints: [join(root, 'scripts', 'searoute-entry.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  platform: 'browser',
  outfile: join(root, 'vendor', 'searoute.mjs'),
  logLevel: 'warning',
});

console.log(`airports: ${Object.keys(airports).length}`);
console.log(`tcc entries: ${entries.length}, with shapes: ${parts.size}`);
console.log(`unassigned polygon parts: ${unassigned.length}`);
if (unmatchedAirportCountries.size) console.log(`countries with unmatched airports: ${[...unmatchedAirportCountries].sort().join(' ')}`);
