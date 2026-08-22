// Build the mountain-bike layer: data/mtb.lines.geojson + data/mtb.meta.json.
// Pulls from OSM/Overpass the two things OpenFreeMap's basemap tiles do NOT carry:
//   routes = route=mtb relations (named MTB routes/loops), combined member geometry
//   trails = ways graded for mountain biking (mtb:scale OR mtb:scale:imba — the IMBA
//            blue-square/black-diamond system carries most Singapore singletrack)
// Trails are kept only inside the real MTB areas (Chestnut/Dairy Farm/Bukit Timah,
// Pulau Ubin's Ketam Bike Park, Kent Ridge); that geography alone excludes the
// mis-tagged noise elsewhere (a fishing jetty, a WWII gun battery, a residential road).
// OSM data © OpenStreetMap contributors, ODbL 1.0.
//
// Usage: node build/build_mtb.mjs   (needs network)

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BBOX = [1.20, 103.60, 1.48, 104.05];   // Singapore (+ Ubin), matches the crossings builder
// The real MTB areas. A trail is kept only if its centroid falls inside one of these.
const MTB_AREAS = [
  { name: 'Chestnut / Dairy Farm / Bukit Timah', minLng: 103.750, maxLng: 103.810, minLat: 1.335, maxLat: 1.420 },
  { name: 'Pulau Ubin (Ketam Bike Park)',        minLng: 103.930, maxLng: 104.030, minLat: 1.390, maxLat: 1.430 },
  { name: 'Kent Ridge',                          minLng: 103.780, maxLng: 103.805, minLat: 1.272, maxLat: 1.295 }
];
const NAME_BLOCK = /jetty|battery|ewe boon/i;   // belt-and-suspenders against mis-tagged names
const EPS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
             'https://overpass.private.coffee/api/interpreter'];

function overpass(query) {
  const body = 'data=' + encodeURIComponent(query);
  const attempt = ep => new Promise((res, rej) => {
    const u = new URL(ep);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'cbsg-mtb/1.0' } },
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { if (d[0] !== '{') return rej(new Error('non-json: ' + d.slice(0, 60))); try { res(JSON.parse(d)); } catch (e) { rej(e); } }); });
    req.on('error', rej); req.write(body); req.end();
  });
  return (async () => {
    for (let round = 0; round < 4; round++) {
      for (const ep of EPS) {
        try { process.stdout.write(`  overpass ${ep.split('/')[2]} … `); const d = await attempt(ep); console.log('ok'); return d; }
        catch (e) { console.log('fail:', e.message.slice(0, 40)); }
      }
      const wait = 15000 * (round + 1); console.log(`  all busy — waiting ${wait / 1000}s`); await new Promise(r => setTimeout(r, wait));
    }
    throw new Error('all overpass endpoints failed');
  })();
}

const r5 = n => +n.toFixed(5);
const r2 = n => +n.toFixed(2);
// Douglas–Peucker simplification at the project's display tolerance (data-sources.json transform:
// simplifyToleranceDegrees 0.00002 ≈ 2.2 m) — a lean offline overlay, no visible change at map zooms.
const SIMPLIFY_EPS = 0.00002;
function perp(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); }
function dp(pts, eps) { if (pts.length < 3) return pts;
  let idx = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = perp(pts[i], pts[0], pts[pts.length - 1]); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax > eps) return dp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(dp(pts.slice(idx), eps));
  return [pts[0], pts[pts.length - 1]]; }
function simplify(geom) { const ls = (geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates).map(l => dp(l, SIMPLIFY_EPS));
  return geom.type === 'LineString' ? { type: 'LineString', coordinates: ls[0] } : { type: 'MultiLineString', coordinates: ls }; }
function lineKm(coords) { let m = 0; const rad = Math.PI / 180;
  for (let i = 1; i < coords.length; i++) { const [x1, y1] = coords[i - 1], [x2, y2] = coords[i];
    const dLa = (y2 - y1) * rad, dLo = (x2 - x1) * rad, q = Math.sin(dLa / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin(dLo / 2) ** 2;
    m += 12_742_000 * Math.asin(Math.sqrt(q)); }
  return m / 1000; }
function geomKm(g) { const ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates; return ls.reduce((s, l) => s + lineKm(l), 0); }
function centroid(g) { const ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates; let x = 0, y = 0, n = 0; for (const l of ls) for (const c of l) { x += c[0]; y += c[1]; n++; } return [x / n, y / n]; }
function areaOf(lng, lat) { return MTB_AREAS.find(a => lng >= a.minLng && lng <= a.maxLng && lat >= a.minLat && lat <= a.maxLat) || null; }
// Normalise difficulty to a 0–4 scale (0 easiest → 4 double-black). Prefer the IMBA grade; fall
// back to the S-scale (mtb:scale) nudged up one step so an S0 flow trail isn't called "very easy".
function gradeOf(t) {
  const imba = t['mtb:scale:imba'];
  if (imba != null && imba !== '') { const n = parseInt(imba, 10); if (Number.isFinite(n)) return Math.max(0, Math.min(4, n)); }
  const sc = t['mtb:scale'];
  if (sc != null && sc !== '') { const n = parseInt(sc, 10); if (Number.isFinite(n)) return Math.max(0, Math.min(4, n + 1)); }
  return 0;
}

async function main() {
  console.log('fetching route=mtb relations + mtb:scale / mtb:scale:imba ways in Singapore…');
  const data = await overpass(`[out:json][timeout:120];(relation["route"="mtb"](${BBOX.join(',')});way["mtb:scale"](${BBOX.join(',')});way["mtb:scale:imba"](${BBOX.join(',')}););out geom;`);

  const routes = [], trails = [];
  const areaKm = {};
  for (const el of data.elements) {
    if (el.type === 'relation') {
      const coords = [];
      for (const m of el.members || []) if (m.type === 'way' && Array.isArray(m.geometry)) {
        const c = m.geometry.map(g => [r5(g.lon), r5(g.lat)]); if (c.length >= 2) coords.push(c);
      }
      if (!coords.length) continue;
      const geometry = simplify({ type: 'MultiLineString', coordinates: coords });
      routes.push({ type: 'Feature', properties: { kind: 'route', name: el.tags?.name || null, network: el.tags?.network || null, km: r2(geomKm(geometry)), osm: 'r' + el.id }, geometry });
    } else if (el.type === 'way' && Array.isArray(el.geometry)) {
      const c = el.geometry.map(g => [r5(g.lon), r5(g.lat)]); if (c.length < 2) continue;
      const raw = { type: 'LineString', coordinates: c };
      const [lng, lat] = centroid(raw);
      const area = areaOf(lng, lat);
      if (!area) continue;                                      // outside the real MTB areas → noise
      if (NAME_BLOCK.test(el.tags?.name || '')) continue;       // mis-tagged (jetty / battery / road)
      const geometry = simplify(raw);
      const km = geomKm(geometry);
      areaKm[area.name] = (areaKm[area.name] || 0) + km;
      trails.push({ type: 'Feature', properties: { kind: 'trail', name: el.tags?.name || null, grade: gradeOf(el.tags || {}), km: r2(km), osm: 'w' + el.id }, geometry });
    }
  }
  routes.sort((a, b) => b.properties.km - a.properties.km);
  trails.sort((a, b) => b.properties.km - a.properties.km);
  const features = [...routes, ...trails];
  if (!routes.length || !trails.length) throw new Error('empty routes or trails — refusing to write a broken layer');

  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) { const ls = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const l of ls) for (const [lng, lat] of l) { bounds[0] = Math.min(bounds[0], lng); bounds[1] = Math.min(bounds[1], lat); bounds[2] = Math.max(bounds[2], lng); bounds[3] = Math.max(bounds[3], lat); } }
  const routeKm = routes.reduce((s, f) => s + geomKm(f.geometry), 0);
  const trailKm = trails.reduce((s, f) => s + geomKm(f.geometry), 0);
  const meta = {
    source: 'OpenStreetMap contributors (ODbL)',
    total_km: +(routeKm + trailKm).toFixed(1), route_km: +routeKm.toFixed(1), trail_km: +trailKm.toFixed(1),
    count: features.length, route_count: routes.length, trail_count: trails.length,
    bounds: bounds.map(n => r5(n)),
    routes: routes.map(f => ({ name: f.properties.name, km: f.properties.km })),
    areas: Object.fromEntries(Object.entries(areaKm).map(([k, v]) => [k, +v.toFixed(1)]))
  };

  fs.writeFileSync(path.join(ROOT, 'data', 'mtb.lines.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
  fs.writeFileSync(path.join(ROOT, 'data', 'mtb.meta.json'), JSON.stringify(meta, null, 2) + '\n');

  console.log('\n=== Singapore MTB layer ===');
  routes.forEach(r => console.log('  route:', (r.properties.name || '(unnamed)') + (r.properties.network ? ` [${r.properties.network}]` : ''), '—', r.properties.km, 'km'));
  console.log('trails by area (km):', JSON.stringify(meta.areas));
  console.log('grades spread:', JSON.stringify(trails.reduce((a, f) => { a[f.properties.grade] = (a[f.properties.grade] || 0) + 1; return a; }, {})));
  console.log(`totals: ${meta.route_count} routes ${meta.route_km} km + ${meta.trail_count} trails ${meta.trail_km} km = ${meta.total_km} km`);
  console.log('output: data/mtb.lines.geojson (' + (fs.statSync(path.join(ROOT, 'data', 'mtb.lines.geojson')).size / 1024).toFixed(1) + ' KB) + data/mtb.meta.json');
}
main().catch(e => { console.error(e); process.exit(1); });
