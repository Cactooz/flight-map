// Offline train routing over data/rail.json (Natural Earth railways, built by
// scripts/build-rail.mjs). Used when the online BRouter rail router fails.

import { distanceKm } from './geo.js';

let graphPromise = null;

async function loadGraph() {
  const res = await fetch('data/rail.json');
  if (!res.ok) throw new Error(`rail.json: ${res.status}`);
  const { q, lines } = await res.json();
  const ids = new Map(); // quantized "x,y" -> node id
  const xs = [];
  const ys = [];
  const adj = []; // node id -> [neighbour, km, neighbour, km, ...]
  const node = (x, y) => {
    const k = x * 4e6 + y;
    let id = ids.get(k);
    if (id === undefined) {
      id = xs.length;
      ids.set(k, id);
      xs.push(x / q);
      ys.push(y / q);
      adj.push([]);
    }
    return id;
  };
  for (const l of lines) {
    let x = l[0];
    let y = l[1];
    let prev = node(x, y);
    for (let i = 2; i < l.length; i += 2) {
      x += l[i];
      y += l[i + 1];
      const cur = node(x, y);
      const w = distanceKm([xs[prev], ys[prev]], [xs[cur], ys[cur]]);
      adj[prev].push(cur, w);
      adj[cur].push(prev, w);
      prev = cur;
    }
  }
  // Spatial grid (0.1 degree cells) for snapping stops to the nearest track.
  const grid = new Map();
  for (let i = 0; i < xs.length; i++) {
    const c = `${Math.floor(xs[i] * 10)},${Math.floor(ys[i] * 10)}`;
    if (!grid.has(c)) grid.set(c, []);
    grid.get(c).push(i);
  }
  return { xs, ys, adj, grid };
}

function snap(g, [lon, lat], maxKm) {
  const cx = Math.floor(lon * 10);
  const cy = Math.floor(lat * 10);
  let best = -1;
  let bd = maxKm;
  for (let r = 0; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const i of g.grid.get(`${cx + dx},${cy + dy}`) || []) {
          const d = distanceKm([lon, lat], [g.xs[i], g.ys[i]]);
          if (d < bd) [best, bd] = [i, d];
        }
      }
    }
    if (best >= 0 && r >= 1) break;
  }
  return best;
}

/** A* shortest path between two node ids; returns [[lon, lat], ...] or null. */
function shortest(g, from, to) {
  const target = [g.xs[to], g.ys[to]];
  const h = (i) => distanceKm([g.xs[i], g.ys[i]], target);
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  // Binary heap of [f, node].
  const heap = [[h(from), from]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [, u] = pop();
    if (u === to) break;
    const du = dist.get(u);
    const a = g.adj[u];
    for (let k = 0; k < a.length; k += 2) {
      const v = a[k];
      const nd = du + a[k + 1];
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        push([nd + h(v), v]);
      }
    }
  }
  if (!dist.has(to)) return null;
  const path = [to];
  while (path[path.length - 1] !== from) path.push(prev.get(path[path.length - 1]));
  return path.reverse().map((i) => [g.xs[i], g.ys[i]]);
}

/** Routes stops ({lon, lat}) along railway lines. Throws if a stop is far from any railway. */
export async function routeRailOffline(waypoints) {
  graphPromise ??= loadGraph();
  const g = await graphPromise;
  const coords = [];
  for (let i = 1; i < waypoints.length; i++) {
    const a = [waypoints[i - 1].lon, waypoints[i - 1].lat];
    const b = [waypoints[i].lon, waypoints[i].lat];
    const sa = snap(g, a, 25);
    const sb = snap(g, b, 25);
    if (sa < 0 || sb < 0) throw new Error(`no railway near ${waypoints[sa < 0 ? i - 1 : i].name}`);
    const path = shortest(g, sa, sb);
    if (!path) throw new Error(`no rail connection to ${waypoints[i].name}`);
    const leg = [a, ...path, b];
    coords.push(...(coords.length ? leg.slice(1) : leg));
  }
  return coords;
}
