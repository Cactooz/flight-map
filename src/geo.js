// Small geometry helpers (all coordinates are [lon, lat]).

const d3 = window.d3;
const EARTH_KM = 6371;

export const distanceKm = (a, b) => d3.geoDistance(a, b) * EARTH_KM;

export function lineLengthKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += distanceKm(coords[i - 1], coords[i]);
  return km;
}

/** Shifts longitudes by multiples of 360 so the line never jumps across the antimeridian. */
export function unwrap(coords) {
  const out = [];
  let offset = 0;
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    if (i > 0) {
      const prev = coords[i - 1][0];
      const d = lon - prev;
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    out.push([lon + offset, lat]);
  }
  return out;
}

export function greatCircle(a, b, segments) {
  const n = segments ?? Math.max(8, Math.min(128, Math.round(distanceKm(a, b) / 80)));
  const interp = d3.geoInterpolate(a, b);
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(interp(i / n));
  return unwrap(pts);
}

/** Web-mercator pixel position at zoom 0 (512px world). Longitude may be unwrapped. */
export function mercatorPx([lon, lat]) {
  const x = ((lon + 180) / 360) * 512;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 512;
  return [x, y];
}

/** Points every `stepKm` along a line (plus its vertices' endpoints). */
export function sampleLine(coords, stepKm) {
  const out = [];
  if (!coords.length) return out;
  out.push(coords[0]);
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const seg = distanceKm(a, b);
    if (!seg) continue;
    let t = stepKm - carry;
    if (t <= seg) {
      const interp = d3.geoInterpolate(a, b);
      for (; t <= seg; t += stepKm) out.push(interp(t / seg));
    }
    carry = seg - (t - stepKm);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

/** Douglas-Peucker in lon/lat degrees (good enough for display-sized tolerances). */
export function simplify(coords, tolerance) {
  if (coords.length <= 2) return coords.slice();
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = coords[s];
    const [x2, y2] = coords[e];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = coords[i];
      let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + t * dx - x;
      const py = y1 + t * dy - y;
      const d = px * px + py * py;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
}

/** Spatial lookup of which polygon feature (TCC destination) contains a point. */
export function createPolygonIndex(features) {
  const items = features
    .filter((f) => f.id >= 0)
    .map((f) => {
      const [[w, s], [e, n]] = d3.geoBounds(f);
      return { f, w, s, e, n };
    });
  const cache = new Map();
  const at = (pt) => {
    const lon = ((((pt[0] + 180) % 360) + 360) % 360) - 180;
    const key = `${lon.toFixed(2)},${pt[1].toFixed(2)}`;
    if (cache.has(key)) return cache.get(key);
    let hit = -1;
    for (const it of items) {
      if (pt[1] < it.s || pt[1] > it.n) continue;
      const inLon = it.w <= it.e ? lon >= it.w && lon <= it.e : lon >= it.w || lon <= it.e;
      if (!inLon) continue;
      if (d3.geoContains(it.f, [lon, pt[1]])) {
        hit = it.f.id;
        break;
      }
    }
    cache.set(key, hit);
    return hit;
  };
  /**
   * Like `at`, but if the point is in the sea (ports, coastal roads on the
   * simplified coastline) it looks for land within ~`radiusDeg`.
   */
  at.near = (pt, radiusDeg = 0.3) => {
    const hit = at(pt);
    if (hit >= 0) return hit;
    for (let r = 0.05; r <= radiusDeg + 1e-9; r += 0.05) {
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180;
        const h = at([pt[0] + (r * Math.cos(rad)) / Math.cos((pt[1] * Math.PI) / 180), pt[1] + r * Math.sin(rad)]);
        if (h >= 0) return h;
      }
    }
    return -1;
  };
  return at;
}
