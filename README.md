# Flight Map

A static website that maps your flights (from a myFlightradar24 export), your
road trips, train journeys and cruises, and the
[Travelers' Century Club](https://travelerscenturyclub.org/) destinations you
have visited, on an OpenStreetMap basemap.

## Features

- **Flights:** each route is a curved great-circle line. It gets thicker and
  more saturated the more often you've flown it. Each direction has an arrow
  sized by its number of flights, so 5 flights one way and 3 the other gives
  arrows in a 5:3 ratio.
- **Airports:** click one to see every route to and from it (with counts per
  direction) and its flights. Click a line to see the flights on that route.
  The *All airports* layer shows every airport with an IATA code (~9,000).
- **Trips:** add road trips, train journeys, boat trips and cruises in the
  *Trips* tab. Add stops by searching (place names via OpenStreetMap, or
  airport codes) or by clicking the map. Each mode is routed differently:
  - **Road:** along roads, using OSRM.
  - **Train:** along railway lines, using BRouter's rail profile (OpenStreetMap).
    If BRouter can't be reached, the bundled world railway map
    (`data/rail.json`, from Natural Earth) is used instead.
  - **Boat:** along shipping lanes, computed offline with `searoute-ts`.

  You can also import recorded tracks from GPX, KML or GeoJSON files.
- **Cities:** add cities you've visited in the *Cities* tab, by searching or by
  clicking the map, with an optional date and how you got there. They show as
  pink rings; every trip stop shows as a white ring, so trip lines connect
  city to city. Cities add to the heatmap and mark their country as visited.
- **Heatmap:** shows where you have been most, built from points along your
  trips and the airports you used.
- **Countries:** the 330-entry TCC list.
  - Destinations are ticked automatically from airports and from the places
    your trips pass through.
  - Destinations you reached another way can be ticked by hand.
  - Russia, Turkey and Egypt are one destination each here, listed under both
    of their regions; TCC counts each of them twice. The panel shows both
    counts.
- **Countries view:** the 200 countries from the TCC tracking sheet (UN
  members plus Vatican City, Palestine, Cook Islands, Niue, Kosovo, Northern
  Cyprus and Taiwan), with a percentage per continent and a list of the
  countries you've visited, showing how you got there. Visiting a territory
  (Crete, Tasmania, the Canary Islands…) counts its country; visiting the
  country does not count its territories.
- **TCC destinations by continent:** the TCC list can be grouped by TCC region
  or by continent (with Antarctica). Islands follow geography: the Canary
  Islands and Madeira count as Africa, Greenland and Bermuda as North America,
  Hawaii as Oceania. The mapping is in `src/countries.js`.
- **Local flights:** a flight that starts and ends at the same airport (e.g. a
  helicopter tour) is drawn as a loop at that airport.
- **Map options:** a flat offline map (gray land, blue water) or OpenStreetMap tiles, a railway overlay
  (OpenRailwayMap), a globe view, and a year filter.

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
| `data/visited.json` | Destinations visited without a recorded flight or trip, and how: `{ "andorra": "car", "iceland": "boat" }` (`plane`, `car`, `train`, `boat` or `other`). Seeded from your TCC tracking spreadsheet (as `other`). |
| `data/trips.json` | Road / rail / boat trips. Use *Trips → Export trips.json* on the site to produce it. |
| `data/cities.json` | Cities you visited. Use *Trips → Export cities.json* to produce it. |

Anything you import, add or tick on the site is saved in that browser's local
storage. To publish it, export the JSON files and replace the ones in `data/`.

## External services

The site works offline (without basemap tiles) because the country shapes are
bundled. When online, it uses free OpenStreetMap-based services meant for
light personal use:

| Service | What it's used for |
| --- | --- |
| OpenStreetMap standard tiles | Optional detailed basemap (the default flat map needs no tiles) |
| OpenRailwayMap | Railway overlay |
| [OSRM demo server](https://router.project-osrm.org/) | Road routing |
| [BRouter](https://brouter.de/) | Rail routing |
| [Nominatim](https://nominatim.openstreetmap.org/) | Place search |

If road or rail routing fails, the trip is saved as straight lines between
its stops.

## Destination list and map data

`src/tcc-list.js` holds the TCC destinations, with their official numbers. It
also holds the rules that map airports, trip points and polygons onto each
destination: ISO country, ISO 3166-2 region, a lon/lat box, or an explicit
IATA override. After editing it, regenerate the data files:

```sh
npm install
npm run build:data
```

This writes the following files:

- `data/airports.json`: OurAirports data.
- `data/tcc.json`: the destination list.
- `data/tcc-shapes.json`: Natural Earth polygons, merged into one shape per
  destination.
- `data/rail.json`, the offline railway network, is built separately with
  `node scripts/build-rail.mjs ne_10m_railroads.geojson`.
- The browser libraries in `vendor/`: MapLibre GL, d3, topojson-client, and
  the bundled sea-routing network.
