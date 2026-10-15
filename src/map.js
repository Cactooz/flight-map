// MapLibre map: OpenStreetMap basemap plus flight, trip, heatmap and country layers.

import * as maplibregl from '../vendor/maplibre-gl.mjs';

const EMPTY = { type: 'FeatureCollection', features: [] };

export const BASEMAPS = {
  dark: { label: 'Dark (OSM / CARTO)' },
  osm: { label: 'OpenStreetMap' },
  none: { label: 'None' },
};

const COLORS = {
  ocean: '#0d1626',
  land: '#1b2536',
  border: '#2b3850',
  auto: '#22b07d',
  manual: '#4f7cc4',
};

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = g.strokeStyle = '#fff';
  return g;
}

function arrowImage() {
  // White triangle pointing up, used as an SDF so each arrow can be coloured.
  // Its centroid is the image centre, so the arrow sits centred on the line.
  const g = canvas(64);
  g.beginPath();
  g.moveTo(32, 5);
  g.lineTo(52, 45.5);
  g.lineTo(12, 45.5);
  g.closePath();
  g.fill();
  return g.getImageData(0, 0, 64, 64);
}

function loopImage() {
  // Teardrop loop leaving the bottom-left corner (the airport) up and to the
  // right, with an arrowhead: used for flights that start and end at the same
  // airport (sightseeing tours). Leaning right keeps the airport label free.
  const g = canvas(64);
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(5, 59);
  g.bezierCurveTo(10, 20, 28, 4, 46, 6);
  g.bezierCurveTo(64, 10, 62, 34, 5, 59);
  g.stroke();
  g.beginPath();
  g.moveTo(40, 0);
  g.lineTo(50, 6);
  g.lineTo(40, 12);
  g.closePath();
  g.fill();
  return g.getImageData(0, 0, 64, 64);
}

/** Arrow size expression: shrinks both arrows of a short route equally (down to 60%) until zoomed in. */
function arrowSizeExpr() {
  const stops = [];
  for (let z = 0; z <= 16; z++) {
    stops.push(z, ['*', ['get', 's'], ['max', 0.6, ['min', 1, ['/', ['*', ['get', 'len'], 0.35 * 2 ** z], ['get', 'base']]]]]);
  }
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}

export function createMap(container, { onHover, onClick, onMove }) {
  const map = new maplibregl.Map({
    container,
    attributionControl: { compact: true },
    renderWorldCopies: true,
    center: [20, 30],
    zoom: 1.3,
    minZoom: 0.5,
    maxZoom: 17,
    dragRotate: false,
    pitchWithRotate: false,
    style: {
      version: 8,
      sources: {
        dark: {
          type: 'raster',
          tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`),
          tileSize: 256,
          maxzoom: 19,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
        },
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
        rail: {
          type: 'raster',
          tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png`),
          tileSize: 256,
          maxzoom: 19,
          attribution: '<a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> (CC-BY-SA)',
        },
        land: { type: 'geojson', data: EMPTY },
        markers: { type: 'geojson', data: EMPTY },
        heat: { type: 'geojson', data: EMPTY },
        trips: { type: 'geojson', data: EMPTY },
        routes: { type: 'geojson', data: EMPTY },
        arrows: { type: 'geojson', data: EMPTY },
        loops: { type: 'geojson', data: EMPTY },
        airports: { type: 'geojson', data: EMPTY },
        allAirports: { type: 'geojson', data: EMPTY },
        draft: { type: 'geojson', data: EMPTY },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': COLORS.ocean } },
        // Own country shapes are drawn under the tiles so the map still works offline.
        { id: 'land-base', type: 'fill', source: 'land', paint: { 'fill-color': COLORS.land, 'fill-outline-color': COLORS.border } },
        { id: 'basemap-dark', type: 'raster', source: 'dark', paint: { 'raster-opacity': 0.95 } },
        { id: 'basemap-osm', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.2 } },
        {
          id: 'land-visited',
          type: 'fill',
          source: 'land',
          filter: ['!=', ['get', 'status'], ''],
          paint: {
            'fill-color': ['match', ['get', 'status'], 'auto', COLORS.auto, COLORS.manual],
            'fill-opacity': 0.32,
          },
        },
        {
          id: 'land-visited-line',
          type: 'line',
          source: 'land',
          filter: ['!=', ['get', 'status'], ''],
          paint: { 'line-color': ['match', ['get', 'status'], 'auto', COLORS.auto, COLORS.manual], 'line-width': 0.8, 'line-opacity': 0.8 },
        },
        { id: 'land-hit', type: 'fill', source: 'land', filter: ['>=', ['get', 'idx'], 0], paint: { 'fill-color': '#000', 'fill-opacity': 0.001 } },
        { id: 'land-selected', type: 'line', source: 'land', filter: ['==', ['get', 'idx'], -2], paint: { 'line-color': '#fff', 'line-width': 2 } },
        { id: 'rail', type: 'raster', source: 'rail', layout: { visibility: 'none' } },
        {
          id: 'dest-markers',
          type: 'circle',
          source: 'markers',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.5, 6, 5],
            'circle-color': ['match', ['get', 'status'], 'auto', COLORS.auto, 'manual', COLORS.manual, COLORS.land],
            'circle-stroke-color': ['match', ['get', 'status'], '', '#3a4a66', '#fff'],
            'circle-stroke-width': 1,
          },
        },
        {
          id: 'heat',
          type: 'heatmap',
          source: 'heat',
          layout: { visibility: 'none' },
          paint: {
            'heatmap-weight': ['get', 'w'],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.35, 9, 1.4],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 4, 5, 14, 10, 28],
            'heatmap-opacity': 0.8,
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,0,0)', 0.15, '#3b0f70', 0.35, '#8c2981', 0.55, '#de4968', 0.8, '#fe9f6d', 1, '#fcfdbf',
            ],
          },
        },
        {
          id: 'trips',
          type: 'line',
          source: 'trips',
          filter: ['!=', ['get', 'mode'], 'boat'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 8, 3.5], 'line-opacity': 0.9 },
        },
        {
          id: 'trips-boat',
          type: 'line',
          source: 'trips',
          filter: ['==', ['get', 'mode'], 'boat'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.4, 8, 3], 'line-dasharray': [2, 2], 'line-opacity': 0.85 },
        },
        { id: 'trips-hit', type: 'line', source: 'trips', paint: { 'line-color': '#000', 'line-opacity': 0.001, 'line-width': 12 } },
        {
          id: 'routes',
          type: 'line',
          source: 'routes',
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'] },
        },
        { id: 'routes-hit', type: 'line', source: 'routes', paint: { 'line-color': '#000', 'line-opacity': 0.001, 'line-width': 12 } },
        {
          id: 'arrows',
          type: 'symbol',
          source: 'arrows',
          layout: {
            'icon-image': 'arrow',
            'icon-size': arrowSizeExpr(),
            'icon-rotate': ['get', 'rot'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': 'rgba(11,18,32,0.85)', 'icon-halo-width': 1.2 },
        },
        {
          id: 'loops',
          type: 'symbol',
          source: 'loops',
          layout: {
            'icon-image': 'loop',
            'icon-size': ['get', 's'],
            'icon-anchor': 'bottom-left',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
          paint: { 'icon-color': ['get', 'color'], 'icon-halo-color': 'rgba(11,18,32,0.6)', 'icon-halo-width': 0.5 },
        },
        {
          id: 'all-airports',
          type: 'circle',
          source: 'allAirports',
          minzoom: 2.5,
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.5, 9, 4],
            'circle-color': '#64748b',
            'circle-stroke-color': '#0b1220',
            'circle-stroke-width': 0.5,
          },
        },
        { id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#ffad33', 'line-width': 2.5, 'line-dasharray': [1, 1.5] } },
        {
          id: 'draft-points',
          type: 'circle',
          source: 'draft',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': 6, 'circle-color': '#ffad33', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
        },
        {
          id: 'airports',
          type: 'circle',
          source: 'airports',
          paint: {
            'circle-radius': ['get', 'r'],
            'circle-color': '#ffffff',
            'circle-stroke-color': '#0b1220',
            'circle-stroke-width': 1.2,
          },
        },
      ],
    },
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

  // Tile errors (offline, blocked hosts) should not spam the console; the
  // local country shapes underneath keep the map usable.
  map.on('error', (ev) => {
    if (ev?.sourceId && ['dark', 'osm', 'rail'].includes(ev.sourceId)) return;
    console.warn(ev.error || ev);
  });

  const ready = new Promise((resolve) => map.on('load', resolve)).then(() => {
    map.addImage('arrow', arrowImage(), { sdf: true, pixelRatio: 2 });
    map.addImage('loop', loopImage(), { sdf: true, pixelRatio: 2 });
  });

  const hitLayers = ['draft-points', 'airports', 'all-airports', 'loops', 'arrows', 'routes-hit', 'trips-hit', 'dest-markers', 'land-hit'];
  const kindOf = { airports: 'airport', 'all-airports': 'any-airport', 'routes-hit': 'route', arrows: 'route', loops: 'route', 'trips-hit': 'trip', 'dest-markers': 'dest', 'land-hit': 'dest', 'draft-points': 'draft' };

  function pick(point) {
    const layers = hitLayers.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
    const feats = map.queryRenderedFeatures(point, { layers });
    feats.sort((a, b) => hitLayers.indexOf(a.layer.id) - hitLayers.indexOf(b.layer.id));
    const f = feats[0];
    return f ? { kind: kindOf[f.layer.id], props: f.properties, feature: f } : null;
  }

  map.on('mousemove', (ev) => {
    const hit = pick(ev.point);
    map.getCanvas().style.cursor = hit ? 'pointer' : '';
    onHover(hit, ev);
  });
  map.on('mouseout', () => onHover(null, null));
  map.on('click', (ev) => onClick(pick(ev.point), ev));
  map.on('move', () => onMove?.());

  // HTML labels for airports with flights (no glyph server needed).
  let labels = [];
  function setAirportLabels(list) {
    for (const m of labels) m.remove();
    labels = list.map((a) => {
      const el = document.createElement('div');
      el.className = 'ap-label';
      el.textContent = a.code;
      el.dataset.count = a.count;
      return new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat(a.lngLat).addTo(map);
    });
    updateLabels();
  }
  let labelFilter = () => true;
  function updateLabels() {
    const z = map.getZoom();
    for (const m of labels) {
      const el = m.getElement();
      el.style.display = labelFilter(el.textContent, +el.dataset.count, z) ? '' : 'none';
    }
  }
  map.on('zoomend', updateLabels);

  return {
    map,
    ready,
    setData(source, data) {
      map.getSource(source)?.setData(data);
    },
    setVisible(layerIds, on) {
      for (const id of [].concat(layerIds)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    },
    setBasemap(name) {
      this.setVisible('basemap-dark', name === 'dark');
      this.setVisible('basemap-osm', name === 'osm');
    },
    setProjection(type) {
      map.setProjection({ type });
    },
    setAirportLabels,
    setLabelFilter(fn) {
      labelFilter = fn;
      updateLabels();
    },
    /** Dims everything except the selected airport / route / trip / destination. */
    setHighlight({ airport, route, trip, dest, connected = [] }) {
      const any = airport || route || trip;
      const routeActive = route
        ? ['==', ['get', 'key'], route]
        : airport
          ? ['any', ['==', ['get', 'a'], airport], ['==', ['get', 'b'], airport]]
          : trip
            ? false
            : true;
      map.setPaintProperty('routes', 'line-opacity', ['case', routeActive, 1, 0.07]);
      map.setPaintProperty('arrows', 'icon-opacity', ['case', routeActive, 1, 0.07]);
      map.setPaintProperty('loops', 'icon-opacity', ['case', routeActive, 1, 0.07]);
      const tripActive = trip ? ['==', ['get', 'id'], trip] : any ? false : true;
      for (const id of ['trips', 'trips-boat']) map.setPaintProperty(id, 'line-opacity', ['case', tripActive, 0.9, 0.1]);
      map.setPaintProperty('airports', 'circle-color', ['case', ['==', ['get', 'code'], airport || ''], '#ffad33', '#ffffff']);
      map.setPaintProperty(
        'airports',
        'circle-opacity',
        airport || route ? ['case', ['in', ['get', 'code'], ['literal', connected]], 1, 0.15] : trip ? 0.3 : 1,
      );
      map.setPaintProperty('airports', 'circle-stroke-opacity', airport || route ? ['case', ['in', ['get', 'code'], ['literal', connected]], 1, 0.15] : 1);
      map.setFilter('land-selected', ['==', ['get', 'idx'], dest ?? -2]);
    },
    fitCoords(coords, maxZoom = 9) {
      if (!coords.length) return;
      const b = new maplibregl.LngLatBounds(coords[0], coords[0]);
      for (const c of coords) b.extend(c);
      map.fitBounds(b, { padding: 60, maxZoom, duration: 700 });
    },
    flyTo(lngLat, zoom) {
      map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), zoom), duration: 700 });
    },
  };
}

