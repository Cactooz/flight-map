import { parseFlightCsv, parseAirportField } from './csv.js';

const d3 = window.d3;
const topojson = window.topojson;

const LS_FLIGHTS = 'flightmap.flights.v1';
const LS_VISITED = 'flightmap.visited.v1';

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
    } catch {
      /* storage unavailable (private mode etc.) */
    }
  },
};

// ----------------------------------------------------------------- state

const state = {
  airports: {}, // IATA -> [name, city, cc, lat, lon, icao, tccIndex]
  icao: new Map(),
  tcc: [],
  shapes: null,
  flights: [], // resolved flights
  flightSource: 'bundled',
  unresolved: [],
  manualVisited: new Set(),
  year: 'all',
  selectedAirport: null,
  selectedRoute: null,
  selectedDest: null,
  countryFilter: 'all',
  countrySearch: '',
};

const $ = (sel) => document.querySelector(sel);
const fmt = d3.format(',');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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

/** Turns parsed CSV rows into flights with known airports. */
function resolveFlights(rows) {
  const flights = [];
  const unresolved = [];
  for (const r of rows) {
    const from = resolveAirport(r.from);
    const to = resolveAirport(r.to);
    if (!from || !to) {
      unresolved.push(r);
      continue;
    }
    flights.push({ ...r, from, to });
  }
  return { flights, unresolved };
}

function setFlights(rows, source) {
  const { flights, unresolved } = resolveFlights(rows);
  state.flights = flights.sort((a, b) => (a.date + a.depTime).localeCompare(b.date + b.depTime));
  state.unresolved = unresolved;
  state.flightSource = source;
  state.selectedAirport = null;
  state.selectedRoute = null;
  buildYearFilter();
}

// The CSV rows are stored (not the resolved objects) so the airport database
// can be updated without invalidating saved data.
function serializeRows(rows) {
  return rows.map((r) => ({ ...r, from: { iata: r.from.iata, icao: r.from.icao, label: r.from.label }, to: { iata: r.to.iata, icao: r.to.icao, label: r.to.label } }));
}

async function init() {
  const [airports, tcc, shapes, csvText, visited] = await Promise.all([
    loadJson('data/airports.json'),
    loadJson('data/tcc.json'),
    loadJson('data/tcc-shapes.json'),
    loadText('data/flights.csv').catch(() => ''),
    loadJson('data/visited.json').catch(() => []),
  ]);
  state.airports = airports;
  for (const [iata, a] of Object.entries(airports)) if (a[5] && !state.icao.has(a[5])) state.icao.set(a[5], iata);
  state.tcc = tcc;
  state.shapes = shapes;
  state.bundledCsv = csvText;
  state.bundledVisited = new Set(visited);

  const saved = store.get(LS_FLIGHTS, null);
  if (saved && Array.isArray(saved.rows)) setFlights(saved.rows, saved.source || 'imported');
  else setFlights(csvText ? parseFlightCsv(csvText) : [], 'bundled');

  state.manualVisited = new Set(store.get(LS_VISITED, null) ?? visited);

  initMap();
  initPanel();
  update();
  $('#loading').remove();
}

// ---------------------------------------------------------- derived data

function filteredFlights() {
  if (state.year === 'all') return state.flights;
  return state.flights.filter((f) => f.date.startsWith(state.year));
}

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
    for (const code of [f.from, f.to]) {
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

function distanceKm(a, b) {
  return d3.geoDistance(coord(a), coord(b)) * 6371;
}

/** TCC indices visited by flight (all years) -> list of airports. */
function flownDestinations() {
  const m = new Map();
  for (const f of state.flights) {
    for (const code of [f.from, f.to]) {
      const idx = state.airports[code][6];
      if (idx < 0) continue;
      if (!m.has(idx)) m.set(idx, new Set());
      m.get(idx).add(code);
    }
  }
  return m;
}

function visitStatus(idx, flown) {
  if (flown.has(idx)) return 'flown';
  if (state.manualVisited.has(state.tcc[idx].id)) return 'manual';
  return '';
}

// ------------------------------------------------------------------- map

const map = {};

function initMap() {
  const svg = d3.select('#map');
  map.svg = svg;
  map.root = svg.append('g');
  map.projection = d3.geoNaturalEarth1();
  map.path = d3.geoPath(map.projection);
  map.k = 1;

  map.sphere = map.root.append('path').attr('class', 'sphere');
  map.graticule = map.root.append('path').attr('class', 'graticule');
  map.land = map.root.append('g').attr('class', 'land');
  map.markers = map.root.append('g').attr('class', 'markers');
  map.routes = map.root.append('g').attr('class', 'routes');
  map.arrows = map.root.append('g').attr('class', 'arrows');
  map.airportLayer = map.root.append('g').attr('class', 'airports');

  map.features = topojson.feature(state.shapes, state.shapes.objects.tcc).features;

  map.zoom = d3
    .zoom()
    .scaleExtent([1, 60])
    .on('zoom', (ev) => {
      map.root.attr('transform', ev.transform);
      map.k = ev.transform.k;
      rescale();
    });
  svg.call(map.zoom).on('dblclick.zoom', null);
  svg.on('click', (ev) => {
    if (ev.target === svg.node() || ev.target.classList.contains('sphere') || ev.target.classList.contains('graticule')) {
      clearSelection();
    }
  });

  $('#zoom-in').onclick = () => svg.transition().duration(300).call(map.zoom.scaleBy, 1.8);
  $('#zoom-out').onclick = () => svg.transition().duration(300).call(map.zoom.scaleBy, 1 / 1.8);
  $('#zoom-reset').onclick = () => svg.transition().duration(500).call(map.zoom.transform, d3.zoomIdentity);

  new ResizeObserver(() => layout()).observe($('#map-wrap'));
  layout();
}

function layout() {
  const { width, height } = $('#map-wrap').getBoundingClientRect();
  if (!width || !height) return;
  map.width = width;
  map.height = height;
  // Smaller symbols on small screens.
  map.ui = Math.max(0.55, Math.min(1, width / 1100));
  map.svg.attr('viewBox', `0 0 ${width} ${height}`);
  // Crop the far south a little; Antarctica is mostly empty space.
  map.projection.fitExtent(
    [[8, 8], [width - 8, height - 8]],
    { type: 'MultiPoint', coordinates: [[-180, 84], [180, 84], [-180, 0], [180, 0], [-180, -62], [180, -62], [0, 84], [0, -62]] },
  );
  map.zoom.translateExtent([[-width * 0.25, -height * 0.25], [width * 1.25, height * 1.25]]).extent([[0, 0], [width, height]]);
  map.sphere.attr('d', map.path({ type: 'Sphere' }));
  map.graticule.attr('d', map.path(d3.geoGraticule10()));
  map.land.selectAll('path').attr('d', map.path);
  drawAll();
}

function drawAll() {
  if (!map.width) return;
  drawLand();
  drawFlights();
  rescale();
}

function drawLand() {
  const flown = flownDestinations();
  map.land
    .selectAll('path')
    .data(map.features, (d) => d.id)
    .join((enter) => enter.append('path').attr('d', map.path))
    .attr('class', (d) => {
      if (d.id < 0) return '';
      return `dest ${visitStatus(d.id, flown)}${state.selectedDest === d.id ? ' selected' : ''}`;
    })
    .on('mousemove', (ev, d) => d.id >= 0 && showDestTooltip(ev, d.id, flown))
    .on('mouseleave', hideTooltip)
    .on('click', (ev, d) => {
      if (d.id < 0) return;
      ev.stopPropagation();
      selectDestination(d.id);
    });

  // Markers for destinations that are too small to see (or have no polygon).
  const small = state.tcc
    .map((t, i) => ({ ...t, idx: i }))
    .filter((t) => t.pt && (!t.shape || t.area < 60));
  map.markers
    .selectAll('circle')
    .data(small, (d) => d.idx)
    .join('circle')
    .attr('class', (d) => `dest-marker ${visitStatus(d.idx, flown)}`)
    .attr('cx', (d) => map.projection(d.pt)[0])
    .attr('cy', (d) => map.projection(d.pt)[1])
    .on('mousemove', (ev, d) => showDestTooltip(ev, d.idx, flown))
    .on('mouseleave', hideTooltip)
    .on('click', (ev, d) => {
      ev.stopPropagation();
      selectDestination(d.idx);
    });
}

// Visual encodings for routes.
function routeScales(routes) {
  const maxTotal = d3.max(routes, (r) => r.total) || 1;
  const maxDir = d3.max(routes, (r) => Math.max(r.ab, r.ba)) || 1;
  const t = (n) => (maxTotal === 1 ? 0.35 : Math.log(n) / Math.log(maxTotal));
  return {
    maxTotal,
    width: (r) => 1.2 + 5.3 * Math.sqrt(r.total / maxTotal),
    // Same hue throughout; saturation (and a little brightness) grows with use.
    color: (n) => d3.hsl(32, 0.12 + 0.88 * t(n), 0.62 - 0.08 * t(n)).formatHex(),
    // Arrow length for the largest direction on a route.
    arrowBase: (r) => 7 + 11 * Math.sqrt(Math.max(r.ab, r.ba) / maxDir),
  };
}

function arrowGeometry(r, scales) {
  const A = coord(r.a);
  const B = coord(r.b);
  const interp = d3.geoInterpolate(A, B);
  const base = scales.arrowBase(r);
  const maxDir = Math.max(r.ab, r.ba);
  const out = [];
  const both = r.ab > 0 && r.ba > 0;
  const pa = map.projection(A);
  const pb = map.projection(B);
  const len = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
  for (const [count, forward] of [[r.ab, true], [r.ba, false]]) {
    if (!count) continue;
    // Arrows sit apart on the line so both are visible; each points along its
    // direction of travel and its size is proportional to its flight count.
    const t = both ? (forward ? 0.62 : 0.38) : 0.5;
    const p = map.projection(interp(t));
    const q = map.projection(interp(forward ? Math.min(t + 0.02, 1) : Math.max(t - 0.02, 0)));
    if (!p || !q) continue;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    if (Math.hypot(dx, dy) > map.width / 3) continue; // wraps around the antimeridian
    out.push({
      key: `${r.key}:${forward ? 'ab' : 'ba'}`,
      route: r,
      x: p[0],
      y: p[1],
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      size: (base * count) / maxDir,
      base,
      len,
      color: scales.color(r.total),
    });
  }
  return out;
}

function drawFlights() {
  const { routes, airports } = aggregate(filteredFlights());
  map.agg = { routes, airports };
  const scales = routeScales(routes);
  map.scales = scales;
  routes.sort((x, y) => x.total - y.total);

  const lineOf = (r) => map.path({ type: 'LineString', coordinates: [coord(r.a), coord(r.b)] });

  map.routes
    .selectAll('g.route-g')
    .data(routes, (r) => r.key)
    .join((enter) => {
      const g = enter.append('g').attr('class', 'route-g');
      g.append('path').attr('class', 'route');
      g.append('path').attr('class', 'route-hit');
      return g;
    })
    .order()
    .each(function (r) {
      const d = lineOf(r);
      const g = d3.select(this);
      g.select('.route').attr('d', d).attr('stroke', scales.color(r.total)).attr('stroke-width', scales.width(r));
      g.select('.route-hit').attr('d', d);
    })
    .on('mousemove', (ev, r) => showRouteTooltip(ev, r))
    .on('mouseleave', hideTooltip)
    .on('click', (ev, r) => {
      ev.stopPropagation();
      selectRoute(r.key);
    });

  const arrows = routes.flatMap((r) => arrowGeometry(r, scales));
  map.arrows
    .selectAll('path')
    .data(arrows, (a) => a.key)
    .join('path')
    .attr('class', 'arrow')
    .attr('d', 'M1,0 L-0.7,0.6 L-0.35,0 L-0.7,-0.6 Z')
    .attr('fill', (a) => a.color);

  const maxCount = d3.max(airports, (a) => a.count) || 1;
  airports.sort((a, b) => a.count - b.count);
  map.airportLayer
    .selectAll('g.airport')
    .data(airports, (a) => a.code)
    .join((enter) => {
      const g = enter.append('g').attr('class', 'airport');
      g.append('circle');
      g.append('text').attr('dy', '-0.7em').attr('text-anchor', 'middle');
      return g;
    })
    .order()
    .each(function (a) {
      const [x, y] = map.projection(coord(a.code));
      a.r = 2.5 + 3.5 * Math.sqrt(a.count / maxCount);
      a.x = x;
      a.y = y;
      d3.select(this).select('text').text(a.code);
    })
    .on('mousemove', (ev, a) => showAirportTooltip(ev, a))
    .on('mouseleave', hideTooltip)
    .on('click', (ev, a) => {
      ev.stopPropagation();
      selectAirport(a.code);
    });

  applyHighlight();
  drawLegend(scales);
}

/** Keeps arrows, airports and labels a constant on-screen size while zooming. */
function rescale() {
  const k = map.k;
  // On short routes the arrows would swallow the line, so both arrows of a
  // route shrink by the same factor (keeping their size ratio) until zoomed in.
  map.arrows.selectAll('path').attr('transform', (a) => {
    const fit = Math.min(1, (a.len * k * 0.18) / a.base);
    return `translate(${a.x},${a.y}) rotate(${a.angle}) scale(${(a.size * fit * map.ui) / k})`;
  });
  map.airportLayer.selectAll('g.airport').attr('transform', (a) => `translate(${a.x},${a.y})`);
  map.airportLayer.selectAll('circle').attr('r', (a) => (a.r * map.ui) / k);
  // Labels: show the busiest airports first, everything once zoomed in.
  const showAll = k > 3;
  map.airportLayer
    .selectAll('text')
    .attr('font-size', 11 / k)
    .style('stroke-width', `${3 / k}px`)
    .attr('display', (a) => (showAll || a.count >= 6 || a.code === state.selectedAirport ? null : 'none'));
  map.markers.selectAll('circle').attr('r', 3.2 / k).style('stroke-width', `${1 / k}px`);
}

function applyHighlight() {
  const selA = state.selectedAirport;
  const selR = state.selectedRoute;
  const active = (r) => (selR ? r.key === selR : selA ? r.a === selA || r.b === selA : true);
  map.routes.selectAll('g.route-g').classed('dim', (r) => !active(r));
  map.arrows.selectAll('path').classed('dim', (a) => !active(a.route));
  let connected = null;
  if (selA || selR) {
    connected = new Set();
    for (const r of map.agg.routes) if (active(r)) connected.add(r.a).add(r.b);
  }
  map.airportLayer
    .selectAll('g.airport')
    .classed('dim', (a) => connected && !connected.has(a.code))
    .classed('selected', (a) => a.code === selA);
  if (selA) map.airportLayer.selectAll('g.airport').filter((a) => a.code === selA).raise();
}

function drawLegend(scales) {
  const stops = d3.range(0, 1.01, 0.1).map((t) => scales.color(Math.max(1, Math.round(Math.exp(t * Math.log(scales.maxTotal))))));
  $('#legend').innerHTML = `
    <div>Flights per route</div>
    <div class="grad" style="background:linear-gradient(90deg, ${stops.join(',')})"></div>
    <div class="scale"><span>1</span><span>${scales.maxTotal}</span></div>
    <div><span class="sw" style="background:var(--flown)"></span>Visited by flight</div>
    <div><span class="sw" style="background:var(--manual)"></span>Visited (added manually)</div>`;
}

// --------------------------------------------------------------- tooltip

function moveTooltip(ev, html) {
  const tip = $('#tooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const box = $('#map-wrap').getBoundingClientRect();
  const x = ev.clientX - box.left;
  const y = ev.clientY - box.top;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = `${Math.min(x + 14, box.width - w - 8)}px`;
  tip.style.top = `${y + 14 + h > box.height ? y - h - 10 : y + 14}px`;
}

function hideTooltip() {
  $('#tooltip').hidden = true;
}

function airportName(code) {
  const a = state.airports[code];
  return a ? `${a[1] || a[0]}` : code;
}

function showRouteTooltip(ev, r) {
  const km = Math.round(distanceKm(r.a, r.b));
  moveTooltip(
    ev,
    `<div class="t-title">${r.a} ⇄ ${r.b}</div>
     <div>${r.a} → ${r.b}: <b>${r.ab}</b></div>
     <div>${r.b} → ${r.a}: <b>${r.ba}</b></div>
     <div class="t-sub">${esc(airportName(r.a))} – ${esc(airportName(r.b))} · ${fmt(km)} km</div>`,
  );
}

function showAirportTooltip(ev, a) {
  const ap = state.airports[a.code];
  moveTooltip(
    ev,
    `<div class="t-title">${a.code} · ${esc(ap[1] || '')}</div>
     <div class="t-sub">${esc(ap[0])}</div>
     <div>${a.count} flights · ${a.routes.size} routes</div>`,
  );
}

function showDestTooltip(ev, idx, flown) {
  const t = state.tcc[idx];
  const st = visitStatus(idx, flown);
  const via = flown.get(idx);
  moveTooltip(
    ev,
    `<div class="t-title">${esc(t.name)}</div>
     <div class="t-sub">${esc(t.region)}</div>
     <div>${st === 'flown' ? `Visited · flew to ${[...via].join(', ')}` : st === 'manual' ? 'Visited' : 'Not visited'}</div>`,
  );
}

// ------------------------------------------------------------- selection

function clearSelection() {
  state.selectedAirport = null;
  state.selectedRoute = null;
  state.selectedDest = null;
  map.land.selectAll('path').classed('selected', false);
  applyHighlight();
  renderOverview();
}

function selectAirport(code) {
  state.selectedAirport = state.selectedAirport === code ? null : code;
  state.selectedRoute = null;
  state.selectedDest = null;
  applyHighlight();
  rescale();
  showTab('overview');
  renderOverview();
}

function selectRoute(key) {
  state.selectedRoute = state.selectedRoute === key ? null : key;
  applyHighlight();
  showTab('overview');
  renderOverview();
}

function selectDestination(idx) {
  state.selectedDest = idx;
  state.selectedAirport = null;
  state.selectedRoute = null;
  map.land.selectAll('path').classed('selected', (d) => d.id === idx);
  applyHighlight();
  showTab('overview');
  renderOverview();
}

// ----------------------------------------------------------------- panel

function initPanel() {
  for (const btn of document.querySelectorAll('.tabs button')) btn.onclick = () => showTab(btn.dataset.tab);

  $('#year-filter').onchange = (ev) => {
    state.year = ev.target.value;
    state.selectedRoute = null;
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
    if (!id) return;
    toggleManual(id, ev.target.checked);
  });
  $('#country-list').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-focus]');
    if (el) focusDestination(+el.dataset.focus);
  });

  $('#tab-overview').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const { action, value } = el.dataset;
    if (action === 'airport') {
      selectAirport(value);
      focusAirport(value);
    } else if (action === 'route') selectRoute(value);
    else if (action === 'close') clearSelection();
    else if (action === 'toggle-dest') {
      const t = state.tcc[+value];
      toggleManual(t.id, !state.manualVisited.has(t.id));
    } else if (action === 'dest') focusDestination(+value);
  });

  // Data tab
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
    update();
  };
  $('#export-visited').onclick = () => {
    const blob = new Blob([JSON.stringify([...state.manualVisited].sort(), null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'visited.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#visited-input').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const ids = JSON.parse(await file.text());
      const known = new Set(state.tcc.map((t) => t.id));
      state.manualVisited = new Set(ids.filter((id) => known.has(id)));
      store.set(LS_VISITED, [...state.manualVisited]);
      update();
    } catch (err) {
      alert(`Could not read visited list: ${err.message}`);
    }
    ev.target.value = '';
  };
}

function currentRows() {
  // Rebuild row objects (with raw airport refs) from resolved + unresolved flights.
  const toRef = (code) => ({ iata: code, icao: state.airports[code][5], label: '' });
  return [...state.flights.map((f) => ({ ...f, from: toRef(f.from), to: toRef(f.to) })), ...state.unresolved];
}

async function importCsvFile(file) {
  try {
    const rows = parseFlightCsv(await file.text());
    if (!rows.length) throw new Error('No flights found in file.');
    store.set(LS_FLIGHTS, { source: `imported (${file.name})`, rows: serializeRows(rows) });
    setFlights(rows, `imported (${file.name})`);
    update();
  } catch (err) {
    $('#import-warnings').innerHTML = `<p class="warn">${esc(err.message)}</p>`;
  }
}

function toggleManual(id, on) {
  if (on) state.manualVisited.add(id);
  else state.manualVisited.delete(id);
  store.set(LS_VISITED, [...state.manualVisited]);
  drawLand();
  rescale();
  renderStats();
  renderCountries();
  renderOverview();
}

function showTab(name) {
  for (const btn of document.querySelectorAll('.tabs button')) btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  for (const tab of document.querySelectorAll('.tab')) tab.hidden = tab.id !== `tab-${name}`;
}

function focusAirport(code) {
  const [x, y] = map.projection(coord(code));
  const k = Math.max(map.k, 4);
  map.svg
    .transition()
    .duration(600)
    .call(map.zoom.transform, d3.zoomIdentity.translate(map.width / 2 - x * k, map.height / 2 - y * k).scale(k));
}

function focusDestination(idx) {
  const f = map.features.find((d) => d.id === idx);
  let x;
  let y;
  let k;
  if (f) {
    const [[x0, y0], [x1, y1]] = map.path.bounds(f);
    k = Math.min(40, 0.7 / Math.max((x1 - x0) / map.width, (y1 - y0) / map.height));
    // Multi-part shapes spanning the globe (e.g. France with overseas parts) fall back to the marker.
    if (k < 1.5 && state.tcc[idx].pt) {
      [x, y] = map.projection(state.tcc[idx].pt);
      k = 4;
    } else {
      x = (x0 + x1) / 2;
      y = (y0 + y1) / 2;
    }
  } else if (state.tcc[idx].pt) {
    [x, y] = map.projection(state.tcc[idx].pt);
    k = 10;
  } else return;
  map.svg
    .transition()
    .duration(700)
    .call(map.zoom.transform, d3.zoomIdentity.translate(map.width / 2 - x * k, map.height / 2 - y * k).scale(k));
  selectDestination(idx);
}

function buildYearFilter() {
  const years = [...new Set(state.flights.map((f) => f.date.slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel = $('#year-filter');
  sel.innerHTML = `<option value="all">All years</option>${years.map((y) => `<option value="${y}">${y}</option>`).join('')}`;
  if (state.year !== 'all' && !years.includes(state.year)) state.year = 'all';
  sel.value = state.year;
}

function update() {
  drawAll();
  renderStats();
  renderOverview();
  renderCountries();
  renderData();
}

function renderStats() {
  const flights = filteredFlights();
  const { routes, airports } = map.agg || aggregate(flights);
  const km = d3.sum(flights, (f) => distanceKm(f.from, f.to));
  const flown = flownDestinations();
  const visited = state.tcc.filter((t, i) => visitStatus(i, flown)).length;
  const items = [
    [fmt(flights.length), 'Flights'],
    [fmt(Math.round(km)), 'Kilometres'],
    [(km / 40075).toFixed(1) + '×', 'Around earth'],
    [fmt(airports.length), 'Airports'],
    [fmt(routes.length), 'Routes'],
    [`${visited}<small class="muted">/${state.tcc.length}</small>`, 'TCC visited'],
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

function renderOverview() {
  const el = $('#tab-overview');
  if (state.selectedRoute || state.selectedAirport || state.selectedDest != null) $('#panel').scrollTop = 0;
  const { routes } = map.agg;

  if (state.selectedRoute) {
    const r = routes.find((x) => x.key === state.selectedRoute);
    if (r) {
      el.innerHTML = `
        <div class="card">
          <div class="card-head">
            <div><h3>${r.a} ⇄ ${r.b}</h3><div class="muted small">${esc(airportName(r.a))} – ${esc(airportName(r.b))} · ${fmt(Math.round(distanceKm(r.a, r.b)))} km</div></div>
            <button type="button" class="close" data-action="close" aria-label="Close">✕</button>
          </div>
          <div class="list">
            <div class="list-item" data-action="airport" data-value="${r.a}"><span>${r.a} → ${r.b}</span><span class="pill">${r.ab}</span></div>
            <div class="list-item" data-action="airport" data-value="${r.b}"><span>${r.b} → ${r.a}</span><span class="pill">${r.ba}</span></div>
          </div>
          <h2>Flights</h2>
          ${flightRows(r.flights)}
        </div>`;
      return;
    }
  }

  if (state.selectedAirport) {
    const code = state.selectedAirport;
    const ap = state.airports[code];
    const mine = routes
      .filter((r) => r.a === code || r.b === code)
      .map((r) => {
        const other = r.a === code ? r.b : r.a;
        const out = r.a === code ? r.ab : r.ba;
        const inn = r.a === code ? r.ba : r.ab;
        return { r, other, out, inn };
      })
      .sort((x, y) => y.r.total - x.r.total);
    const flights = filteredFlights().filter((f) => f.from === code || f.to === code);
    const dest = state.tcc[ap[6]];
    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <h3>${code} · ${esc(ap[1] || ap[0])}</h3>
            <div class="muted small">${esc(ap[0])}${ap[5] ? ` · ${ap[5]}` : ''}${dest ? ` · ${esc(dest.name)}` : ''}</div>
          </div>
          <button type="button" class="close" data-action="close" aria-label="Close">✕</button>
        </div>
        <div class="muted small">${flights.length} flights · ${mine.length} routes · <span title="departures">↗ ${d3.sum(mine, (m) => m.out)}</span> · <span title="arrivals">↘ ${d3.sum(mine, (m) => m.inn)}</span></div>
        <h2>Routes</h2>
        <div class="list">
          ${mine
            .map(
              (m) => `<div class="list-item" data-action="route" data-value="${m.r.key}">
                <div><div>${m.other} <span class="muted small">${esc(airportName(m.other))}</span></div>
                <div class="sub">${fmt(Math.round(distanceKm(code, m.other)))} km</div></div>
                <span class="dir"><span class="pill" title="${code} → ${m.other}">→ ${m.out}</span><span class="pill" title="${m.other} → ${code}">← ${m.inn}</span></span>
              </div>`,
            )
            .join('')}
        </div>
        <h2>Flights</h2>
        ${flightRows(flights)}
      </div>`;
    return;
  }

  if (state.selectedDest != null) {
    const idx = state.selectedDest;
    const t = state.tcc[idx];
    const flown = flownDestinations();
    const st = visitStatus(idx, flown);
    const via = [...(flown.get(idx) || [])];
    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div><h3>${esc(t.name)}</h3><div class="muted small">${esc(t.region)}</div></div>
          <button type="button" class="close" data-action="close" aria-label="Close">✕</button>
        </div>
        ${
          st === 'flown'
            ? `<p>Visited by flight via ${via.map((c) => `<a href="#" class="link-btn" data-action="airport" data-value="${c}">${c}</a>`).join(', ')}.</p>`
            : `<p>${st === 'manual' ? 'Marked as visited.' : 'Not visited yet.'}</p>
               <button type="button" data-action="toggle-dest" data-value="${idx}">${st === 'manual' ? 'Unmark as visited' : 'Mark as visited'}</button>`
        }
      </div>`;
    return;
  }

  const top = routes
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
  el.innerHTML = `
    <p class="muted small">Click an airport to see its routes, a line for its flights, or a country to mark it as visited.
    Line thickness and colour show how often a route was flown; arrow size shows each direction.</p>
    <h2>Most flown routes</h2>
    <div class="list">
      ${top
        .map(
          (r) => `<div class="list-item" data-action="route" data-value="${r.key}">
            <div><div>${r.a} ⇄ ${r.b}</div><div class="sub">${esc(airportName(r.a))} – ${esc(airportName(r.b))}</div></div>
            <span class="dir"><span class="pill" title="${r.a} → ${r.b}">→ ${r.ab}</span><span class="pill" title="${r.b} → ${r.a}">← ${r.ba}</span></span>
          </div>`,
        )
        .join('')}
    </div>
    <h2>Airports</h2>
    <div class="list">
      ${map.agg.airports
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 12)
        .map(
          (a) => `<div class="list-item" data-action="airport" data-value="${a.code}">
            <div><div>${a.code} <span class="muted small">${esc(airportName(a.code))}</span></div></div>
            <span class="pill">${a.count}</span>
          </div>`,
        )
        .join('')}
    </div>`;
}

function renderCountries() {
  const flown = flownDestinations();
  const regions = d3.group(
    state.tcc.map((t, i) => ({ ...t, idx: i, status: visitStatus(i, flown) })),
    (t) => t.region,
  );
  const total = state.tcc.length;
  const visited = state.tcc.filter((t, i) => visitStatus(i, flown)).length;
  $('#country-progress').innerHTML = `
    <div class="progress-total"><span><b>${visited}</b> <span class="muted">of ${total} TCC destinations</span></span><span class="muted">${Math.round((visited / total) * 100)}%</span></div>
    <div class="progress"><div style="width:${(visited / total) * 100}%"></div></div>`;

  const q = state.countrySearch;
  const html = [];
  for (const [region, list] of regions) {
    const shown = list.filter(
      (t) =>
        (!q || t.name.toLowerCase().includes(q)) &&
        (state.countryFilter === 'all' || (state.countryFilter === 'visited' ? t.status : !t.status)),
    );
    if (!shown.length) continue;
    const v = list.filter((t) => t.status).length;
    html.push(`<div class="region"><div class="region-head">${esc(region)}<span>${v} / ${list.length}</span></div>`);
    for (const t of shown) {
      const via = flown.get(t.idx);
      html.push(`<div class="country">
        <input type="checkbox" data-id="${t.id}" ${t.status ? 'checked' : ''} ${t.status === 'flown' ? 'disabled title="Visited by flight"' : ''} aria-label="${esc(t.name)}" />
        <span class="name" data-focus="${t.idx}">${esc(t.name)}</span>
        ${via ? `<span class="badge" title="Flights to ${[...via].join(', ')}">✈ ${[...via].slice(0, 3).join(' ')}${via.size > 3 ? '…' : ''}</span>` : '<span></span>'}
      </div>`);
    }
    html.push('</div>');
  }
  $('#country-list').innerHTML = html.join('') || '<p class="muted">No matches.</p>';
}

function renderData() {
  const src = state.flightSource === 'bundled' ? 'Showing the bundled <code>data/flights.csv</code>.' : `Showing ${esc(state.flightSource)} flights stored in this browser.`;
  $('#flight-source').innerHTML = `${src} ${state.flights.length} flights loaded.`;
  $('#reset-flights').hidden = state.flightSource === 'bundled';
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
