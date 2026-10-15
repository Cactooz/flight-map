"""Routes train trips in data/trips.json along railway lines, offline.

Uses Natural Earth's global railroads (download ne_10m_railroads.geojson from
https://github.com/nvkelso/natural-earth-vector/tree/master/geojson) as a
graph and finds the shortest path between consecutive stops. Useful when the
BRouter rail router is unreachable. Adjust BOX and VIA for other regions.

    python3 scripts/rail-route.py ne_10m_railroads.geojson
"""
import json, heapq, math, sys
d = json.load(open(sys.argv[1]))
BOX = [3.0, 45.5, 11.0, 54.0]  # Netherlands + Switzerland and the area between

def inb(c):
    return BOX[0] <= c[0] <= BOX[2] and BOX[1] <= c[1] <= BOX[3]

def km(a, b):
    la = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(la), (a[1] - b[1]) * 110.57)

key = lambda c: (round(c[0], 5), round(c[1], 5))
adj = {}
lines = []
for f in d['features']:
    g = f['geometry']
    for l in (g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]):
        if not any(inb(c) for c in l):
            continue
        l = [key(c) for c in l]
        lines.append(l)
        for a, b in zip(l, l[1:]):
            w = km(a, b)
            adj.setdefault(a, {})[b] = w
            adj.setdefault(b, {})[a] = w

# Bridge small gaps: connect each line end to the nearest node of another line within 0.3 km.
nodes = list(adj)
grid = {}
for n in nodes:
    grid.setdefault((int(n[0] * 50), int(n[1] * 50)), []).append(n)
def near(p, maxkm):
    best, bd = None, maxkm
    gx, gy = int(p[0] * 50), int(p[1] * 50)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for n in grid.get((gx + dx, gy + dy), []):
                if n == p:
                    continue
                dd = km(p, n)
                if dd < bd:
                    best, bd = n, dd
    return best, bd
bridged = 0
for l in lines:
    for end in (l[0], l[-1]):
        n, dd = near(end, 0.3)
        if n and n not in adj[end]:
            adj[end][n] = adj.setdefault(n, {})[end] = dd
            bridged += 1
print('nodes', len(adj), 'bridged', bridged, file=sys.stderr)

def snap(p):
    best = min(adj, key=lambda n: km(p, n))
    return best, km(p, best)

def route(a, b):
    sa, da = snap(a)
    sb, db = snap(b)
    dist = {sa: 0}
    prev = {}
    pq = [(0, sa)]
    while pq:
        dcur, u = heapq.heappop(pq)
        if u == sb:
            break
        if dcur > dist[u]:
            continue
        for v, w in adj[u].items():
            nd = dcur + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if sb not in dist:
        return None
    path = [sb]
    while path[-1] != sa:
        path.append(prev[path[-1]])
    path.reverse()
    return {'coords': [list(a)] + [list(c) for c in path] + [list(b)], 'km': dist[sb], 'snap': (round(da, 2), round(db, 2)), 'direct': km(a, b)}

# Intermediate stations the usual trains run through, so the route follows
# that line rather than another, slightly shorter one in the data.
VIA = {
    ('Basel SBB', 'Bern'): [(7.7313, 47.4846), (7.9077, 47.3519)],  # Liestal, Olten
}
trips = json.load(open('/home/user/flight-map/data/trips.json'))
for t in trips:
    if t['mode'] != 'train':
        continue
    coords = []
    for w1, w2 in zip(t['waypoints'], t['waypoints'][1:]):
        pts = [(w1['lon'], w1['lat']), *VIA.get((w1['name'], w2['name']), []), (w2['lon'], w2['lat'])]
        for a, b in zip(pts, pts[1:]):
            r = route(a, b)
            if not r:
                print('NO ROUTE', t['name'], a, b, file=sys.stderr)
                sys.exit(1)
            print(f"{t['name']:28} {str(a):>22} -> {str(b):<22} {r['km']:6.1f} km (direct {r['direct']:5.1f}) snap {r['snap']}", file=sys.stderr)
            # Via points are only routing hints: drop them from the drawn line.
            seg = r['coords'][1:-1] if (a, b) != (pts[0], pts[-1]) else r['coords']
            if a == pts[0]:
                seg = [list(a)] + r['coords'][1:-1]
            if b == pts[-1]:
                seg = seg + [list(b)]
            coords += seg if not coords else seg[1:]
    t['coords'] = coords
    t['routedBy'] = 'rail'
json.dump(trips, open('data/trips.json', 'w'))
