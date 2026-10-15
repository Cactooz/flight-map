// Builds data/rail.json, a compact world railway network used to route train
// trips offline (when the BRouter rail router can't be reached).
//
// Source: Natural Earth 10m railroads, e.g.
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_railroads.geojson
//   node scripts/build-rail.mjs ne_10m_railroads.geojson
//
// Output: { q, lines } where each line is [x0, y0, dx1, dy1, …] in units of
// 1/q degrees (delta encoded). Points shared by several lines (junctions) are
// kept exactly so the browser can rebuild the graph from shared coordinates.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const Q = 1e4; // ~10 m
const SIMPLIFY_DEG = 0.0015; // ~150 m
const BRIDGE_KM = 0.3; // join line ends this close to another line

const src = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let lines = [];
for (const f of src.features) {
  const g = f.geometry;
  if (!g) continue;
  for (const l of g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]) {
    const q = l.map(([x, y]) => [Math.round(x * Q), Math.round(y * Q)]);
    const dedup = q.filter((p, i) => i === 0 || p[0] !== q[i - 1][0] || p[1] !== q[i - 1][1]);
    if (dedup.length > 1) lines.push(dedup);
  }
}

const key = (p) => p[0] * 4e6 + p[1];
const uses = new Map();
for (const l of lines) for (const p of new Set(l.map(key))) uses.set(p, (uses.get(p) || 0) + 1);

const km = (a, b) => {
  const la = ((a[1] + b[1]) / 2 / Q) * (Math.PI / 180);
  return Math.hypot(((a[0] - b[0]) / Q) * 111.32 * Math.cos(la), ((a[1] - b[1]) / Q) * 110.57);
};

// Bridge small gaps: connect each line end to the nearest vertex of another line.
const grid = new Map();
const cell = (p) => `${Math.floor(p[0] / 50)},${Math.floor(p[1] / 50)}`; // ~0.005 degree cells
lines.forEach((l, li) => l.forEach((p) => {
  const c = cell(p);
  if (!grid.has(c)) grid.set(c, []);
  grid.get(c).push([p, li]);
}));
const bridges = [];
lines.forEach((l, li) => {
  for (const end of [l[0], l[l.length - 1]]) {
    if (uses.get(key(end)) > 1) continue;
    const [cx, cy] = cell(end).split(',').map(Number);
    let best = null;
    let bd = BRIDGE_KM;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [p, lj] of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (lj === li) continue;
          const d = km(end, p);
          if (d < bd) [best, bd] = [p, d];
        }
      }
    }
    if (best) {
      bridges.push([end, best]);
      uses.set(key(best), (uses.get(key(best)) || 0) + 1);
      uses.set(key(end), (uses.get(key(end)) || 0) + 1);
    }
  }
});
lines.push(...bridges);

// Douglas–Peucker that never drops shared vertices (junctions).
function simplify(l) {
  const keep = l.map((p, i) => i === 0 || i === l.length - 1 || uses.get(key(p)) > 1);
  const tol = SIMPLIFY_DEG * Q;
  const anchors = keep.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
  for (let a = 0; a < anchors.length - 1; a++) {
    const stack = [[anchors[a], anchors[a + 1]]];
    while (stack.length) {
      const [s, e] = stack.pop();
      const [x1, y1] = l[s];
      const [x2, y2] = l[e];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let md = 0;
      let mi = -1;
      for (let i = s + 1; i < e; i++) {
        const [x, y] = l[i];
        const t = len2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2)) : 0;
        const d = (x1 + t * dx - x) ** 2 + (y1 + t * dy - y) ** 2;
        if (d > md) [md, mi] = [d, i];
      }
      if (md > tol * tol) {
        keep[mi] = true;
        stack.push([s, mi], [mi, e]);
      }
    }
  }
  return l.filter((_, i) => keep[i]);
}

let vertices = 0;
const out = lines.map((l) => {
  const s = simplify(l);
  vertices += s.length;
  const enc = [s[0][0], s[0][1]];
  for (let i = 1; i < s.length; i++) enc.push(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  return enc;
});
writeFileSync(join(root, 'data', 'rail.json'), JSON.stringify({ q: Q, lines: out }));
console.log(`rail lines: ${out.length} (${bridges.length} gap bridges), vertices: ${vertices}`);
