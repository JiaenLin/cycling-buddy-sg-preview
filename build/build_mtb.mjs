// Build the mountain-bike layer: data/mtb.lines.geojson + data/mtb.meta.json.
// Pulls from OSM/Overpass the two things OpenFreeMap's basemap tiles do NOT carry:
//   routes = route=mtb relations (named MTB routes/loops), combined member geometry
//   trails = ways tagged mtb:scale (individual off-road segments with a difficulty rating)
// Only the reserve-cluster trails (Bukit Timah / Dairy Farm / Chestnut, lng 103.75–103.80,
// lat 1.34–1.42) are kept; scattered mis-tagged mtb:scale ways elsewhere (e.g. a fishing
// jetty, a residential road) are dropped. OSM data © OpenStreetMap contributors, ODbL 1.0.
//
// Usage: node build/build_mtb.mjs   (needs network)

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BBOX = [1.20, 103.60, 1.48, 104.05];   // Singapore (+ Ubin), matches the crossings builder
// Keep only trails inside the north-west nature-reserve cluster; everything east of this is noise.
const CLUSTER = { minLng: 103.75, maxLng: 103.80, minLat: 1.34, maxLat: 1.42 };
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

async function main() {
  console.log('fetching route=mtb relations + mtb:scale ways in Singapore…');
  const data = await overpass(`[out:json][timeout:90];(relation["route"="mtb"](${BBOX.join(',')});way["mtb:scale"](${BBOX.join(',')}););out geom;`);

  const routes = [], trails = [];
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
      if (lng < CLUSTER.minLng || lng > CLUSTER.maxLng || lat < CLUSTER.minLat || lat > CLUSTER.maxLat) continue;   // reserve cluster only
      const geometry = simplify(raw);
      trails.push({ type: 'Feature', properties: { kind: 'trail', name: el.tags?.name || null, mtb_scale: Number(el.tags?.['mtb:scale']), km: r2(geomKm(geometry)), osm: 'w' + el.id }, geometry });
    }
  }
  routes.sort((a, b) => b.properties.km - a.properties.km);
  trails.sort((a, b) => b.properties.km - a.properties.km);
  const features = [...routes, ...trails];
  if (!routes.length) throw new Error('no route=mtb relations returned — refusing to write an empty layer');

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
    routes: routes.map(f => ({ name: f.properties.name, km: f.properties.km }))
  };

  fs.writeFileSync(path.join(ROOT, 'data', 'mtb.lines.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
  fs.writeFileSync(path.join(ROOT, 'data', 'mtb.meta.json'), JSON.stringify(meta, null, 2) + '\n');

  console.log('\n=== Singapore MTB layer ===');
  routes.forEach(r => console.log('  •', (r.properties.name || '(unnamed)') + (r.properties.network ? ` [${r.properties.network}]` : ''), '—', r.properties.km, 'km'));
  console.log('trails (reserve cluster):', trails.length, '| route km:', meta.route_km, '| trail km:', meta.trail_km, '| total:', meta.total_km);
  console.log('output: data/mtb.lines.geojson +', 'data/mtb.meta.json');
}
main().catch(e => { console.error(e); process.exit(1); });
