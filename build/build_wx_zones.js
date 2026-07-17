'use strict';
/*
 * Precompute Voronoi "weather zones" for Singapore's 47 NEA forecast areas.
 * One-time build — the area label_locations are stable; only the fill colour
 * updates live in the app. Output: ../data/wx.zones.geojson
 *
 * Dev-only deps (NOT shipped in the PWA): d3-delaunay, @turf/turf
 *   npm install d3-delaunay @turf/turf
 *   node build_wx_zones.js        (or: NODE_PATH=/path/to/node_modules node build_wx_zones.js)
 *
 * Sources:
 *   - Area points: data.gov.sg 2-hour forecast `area_metadata` (label_location).
 *   - Singapore boundary: Nominatim (OSM admin polygon; covers all forecast
 *     areas incl. islands + maritime extent), © OpenStreetMap contributors.
 */
const fs = require('fs');
const path = require('path');
const { Delaunay } = require('d3-delaunay');
const turf = require('@turf/turf');

const OUT = path.resolve(__dirname, '../data/wx.zones.geojson');
const WX_URL = 'https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search?q=Singapore&format=json&polygon_geojson=1&limit=1';
const UA = 'cycling-buddy-sg/1.0 (weather-zone build)';

function round(c){ if(typeof c[0] === 'number'){ c[0] = +c[0].toFixed(5); c[1] = +c[1].toFixed(5); } else c.forEach(round); }

async function main(){
  // 1. Stable area points
  const wx = await (await fetch(WX_URL, { headers: { Accept: 'application/json' } })).json();
  const areas = wx.data.area_metadata.map(a => ({ name: a.name, lng: a.label_location.longitude, lat: a.label_location.latitude }));
  console.log('areas:', areas.length);

  // 2. Singapore boundary polygon
  const nj = await (await fetch(NOMINATIM, { headers: { 'User-Agent': UA } })).json();
  const land = turf.feature(nj[0].geojson);
  const lb = turf.bbox(land);

  // 3. Voronoi over a padded territory bbox, each cell clipped to the boundary
  const pad = 0.06;
  const bbox = [lb[0] - pad, lb[1] - pad, lb[2] + pad, lb[3] + pad];
  const del = Delaunay.from(areas.map(a => [a.lng, a.lat]));
  const vor = del.voronoi(bbox);

  const feats = [];
  for(let i = 0; i < areas.length; i++){
    const cell = vor.cellPolygon(i);
    if(!cell) continue;
    let clip;
    try { clip = turf.intersect(turf.featureCollection([turf.polygon([cell]), land])); } catch(e){ clip = null; }
    if(!clip) continue;
    clip = turf.simplify(clip, { tolerance: 0.0006, highQuality: true, mutate: true });
    round(clip.geometry.coordinates);
    const inside = turf.pointOnFeature(clip);              // robust anchor for concave/coastal cells
    const cx = +inside.geometry.coordinates[0].toFixed(5), cy = +inside.geometry.coordinates[1].toFixed(5);
    clip.properties = { area: areas[i].name, cx, cy };
    feats.push(clip);
  }

  fs.writeFileSync(OUT, JSON.stringify(turf.featureCollection(feats)));
  console.log('zones:', feats.length, ' bytes:', fs.statSync(OUT).size);
}
main().catch(e => { console.error(e); process.exit(1); });
