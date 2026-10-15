# Flight Map

A static website that maps your flights (from a myFlightradar24 export) and the
[Travelers' Century Club](https://travelerscenturyclub.org/) countries and
territories you have visited.

- **Routes** are drawn as great circles between airports. Thickness and colour
  saturation grow with how often a route was flown.
- **Arrows** on each line show direction. Their size is proportional to the
  number of flights in that direction, so 5 flights one way and 3 the other
  gives arrows in a 5:3 ratio.
- **Click an airport** to see every route to and from it (with per-direction
  counts) and its flights. Click a line to see the flights on that route.
- **Countries / territories** are filled automatically from the airports you
  flew to (e.g. LYR counts as Svalbard, HER as Crete, SAW as Turkey in Asia).
  Destinations you visited without flying can be ticked in the *Countries* tab
  or by clicking them on the map.
- A **year filter** restricts the map and stats to one year.

## Running

It is a plain static site; no build step is needed to view it.

```sh
npm run serve        # or: python3 -m http.server 8080
```

Then open http://localhost:8080. It can be hosted as-is on GitHub Pages
(Settings → Pages → deploy from branch, root folder).

## Your data

| File | What |
| --- | --- |
| `data/flights.csv` | Flights shown by default. Same format as the myFlightradar24 export (Settings → Export flights). Notes, seats and flight reason were stripped from the bundled copy. |
| `data/visited.json` | Destination ids you visited without flying, e.g. `["iceland", "vatican-city"]`. Use *Data → Export visited.json* on the site to produce it. |

Importing a CSV or ticking destinations on the site saves to the browser's
local storage. To publish changes, replace `data/flights.csv` and
`data/visited.json` in the repo.

## Destination list and map data

`src/tcc-list.js` holds the TCC destinations and the rules that map airports
and map polygons onto them (by ISO country, ISO 3166-2 region, lon/lat box, or
an explicit IATA override). The list was reconstructed by hand, so check it
against the current official TCC list and edit as needed, then regenerate the
data files:

```sh
npm install
npm run build:data
```

This writes `data/airports.json` (OurAirports, ~9,000 airports with IATA
codes), `data/tcc.json`, `data/tcc-shapes.json` (Natural Earth admin-0/admin-1
polygons dissolved per destination) and copies d3 / topojson-client into
`vendor/`.
