/* Build parks + bike-rack layers for Cycling Buddy SG.
 *
 *   node build/build_parks_racks.js
 *
 * Sources (data.gov.sg, downloaded to the repo parent):
 *   NParksParksandNatureReserves.geojson  — NParks land inventory (polygons)
 *   LTABicycleRackGEOJSON.geojson         — LTA bicycle racks (points, attrs in an HTML table)
 *
 * The NParks file is an internal land inventory, not a "places to visit" list: 136 of its 461
 * polygons are neighbourhood playgrounds (median 0.28 ha), plus grass verges ("OS") and fitness
 * corners ("FC"). Those are sub-hectare specks at cycling zoom and calling them Parks would be
 * wrong, so they're dropped. Botanic Gardens ships as four internal management zones
 * ("SBG LC ZONE 1 (TNC)") and Fort Canning as four "(FCP)" sub-zones — both get real names.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', 'data');
const COORD_DP = 5;               // ~1.1 m — plenty for an area wash
const SIMPLIFY_TOL = 2e-5;        // ~2 m Douglas-Peucker tolerance

// ---------- helpers ----------
const round = n => Number(n.toFixed(COORD_DP));

// Attributes on data.gov.sg KML-derived layers arrive as an HTML table in Description.
function htmlAttrs(html){
  const o = {}; const re = /<th>(.*?)<\/th>\s*<td>(.*?)<\/td>/g; let m;
  while((m = re.exec(html || ''))) o[m[1]] = m[2];
  return o;
}

// Perpendicular distance point→segment, in degrees (fine at this scale for shape-preserving DP).
function perpDist(p, a, b){
  let x = a[0], y = a[1], dx = b[0]-x, dy = b[1]-y;
  if(dx || dy){
    const t = ((p[0]-x)*dx + (p[1]-y)*dy) / (dx*dx + dy*dy);
    if(t > 1){ x = b[0]; y = b[1]; } else if(t > 0){ x += dx*t; y += dy*t; }
  }
  return Math.hypot(p[0]-x, p[1]-y);
}
function douglasPeucker(pts, tol){
  if(pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  for(let i = 1; i < pts.length-1; i++){
    const d = perpDist(pts[i], pts[0], pts[pts.length-1]);
    if(d > maxD){ maxD = d; idx = i; }
  }
  if(maxD > tol){
    const l = douglasPeucker(pts.slice(0, idx+1), tol);
    const r = douglasPeucker(pts.slice(idx), tol);
    return l.slice(0, -1).concat(r);
  }
  return [pts[0], pts[pts.length-1]];
}
// A ring must stay closed and keep >=4 points to remain a valid polygon.
function simplifyRing(ring, tol){
  let out = douglasPeucker(ring, tol).map(p => [round(p[0]), round(p[1])]);
  const first = out[0], last = out[out.length-1];
  if(first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out.length >= 4 ? out : ring.map(p => [round(p[0]), round(p[1])]);
}
function simplifyGeom(geom, tol){
  const ringsOf = poly => poly.map(r => simplifyRing(r, tol));
  if(geom.type === 'Polygon') return {type:'Polygon', coordinates: ringsOf(geom.coordinates)};
  return {type:'MultiPolygon', coordinates: geom.coordinates.map(ringsOf)};
}

// ---------- park names ----------
// NParks names are uppercase cadastral strings: "PASIR RIS PK", "JLN PELATOK OS".
// Expand the abbreviations that actually occur, then title-case to match the house style
// already used by pcn.lines.geojson ("Tiong Bahru Park").
const ABBR = {
  PK:'Park', PKS:'Parks', GDN:'Garden', GDNS:'Gardens', NP:'Nature Park', NR:'Nature Reserve',
  JLN:'Jalan', LOR:'Lorong', RD:'Road', AVE:'Avenue', AV:'Avenue', DR:'Drive', CRES:'Crescent',
  TER:'Terrace', UPP:'Upper', LWR:'Lower', TG:'Tanjong', BT:'Bukit', MT:'Mount', CTR:'Centre',
  EXT:'Extension', RES:'Reservoir', GRDN:'Garden',
  JLG:'Jurong Lake Gardens',   // "JLG: LAKESIDE GARDEN"
  EC:'East Coast'              // only ever appears as "UPP EC RD"
};
const KEEP_UPPER = new Set(['II','III','IV']);
const MINOR = new Set(['and','of','the']);
function titleWord(w, isFirst){
  if(KEEP_UPPER.has(w)) return w;
  if(/^\d+$/.test(w)) return w;
  const s = w.toLowerCase();
  if(!isFirst && MINOR.has(s.replace(/[^a-z]/g, ''))) return s;
  // Capitalise at a word start — after a space, hyphen, slash or "(" — but never after an
  // apostrophe, or KING'S becomes King'S.
  return s.replace(/(^|[\s\-\/(])([a-z])/g, (m, sep, c) => sep + c.toUpperCase());
}
function cleanName(raw){
  let s = String(raw).trim();
  // Botanic Gardens ships as four internal management zones — one real name for all of them.
  if(/\bSBG\b/.test(s)) return 'Singapore Botanic Gardens';
  s = s.replace(/\(FCP\)/g, '(Fort Canning)');
  const out = s.split(/\s+/).map((w, i) => {
    // split leading/trailing punctuation so "(JLN" and "JLG:" still hit the table
    const m = w.match(/^([^A-Za-z']*)([A-Za-z']+)([^A-Za-z']*)$/);
    if(m){
      const hit = ABBR[m[2].toUpperCase()];
      if(hit) return m[1] + hit + m[3];
    }
    return titleWord(w, i === 0);
  }).join(' ');
  return out.replace(/\s+/g, ' ').trim();
}

// ---------- parks ----------
function buildParks(){
  const src = JSON.parse(fs.readFileSync(path.join(SRC, 'NParksParksandNatureReserves.geojson'), 'utf8'));
  const skipped = {playground:0, 'open space':0, 'fitness corner':0};
  const feats = [];
  let totalHa = 0, reserves = 0;
  let minX=180, minY=90, maxX=-180, maxY=-90;

  for(const f of src.features){
    const p = f.properties || {};
    const name = String(p.NAME || '');
    const isReserve = Number(p.N_RESERVE) === 1;

    // Drop the non-destinations. Guarded by \b so "PARK GREEN" etc. survive.
    if(!isReserve){
      if(/\bPG\b/.test(name)){ skipped.playground++; continue; }
      if(/\bOS\b/.test(name)){ skipped['open space']++; continue; }
      if(/\bFC\b/.test(name)){ skipped['fitness corner']++; continue; }
    }

    const ha = Number(p['SHAPE_1.AREA'] || 0) / 1e4;
    const geom = simplifyGeom(f.geometry, SIMPLIFY_TOL);

    // strip the elevation ordinate the source carries and track bounds
    const walk = rings => rings.forEach(r => r.forEach(pt => {
      if(pt.length > 2) pt.length = 2;
      if(pt[0]<minX) minX=pt[0]; if(pt[0]>maxX) maxX=pt[0];
      if(pt[1]<minY) minY=pt[1]; if(pt[1]>maxY) maxY=pt[1];
    }));
    if(geom.type === 'Polygon') walk(geom.coordinates); else geom.coordinates.forEach(walk);

    totalHa += ha;
    if(isReserve) reserves++;
    feats.push({
      type:'Feature',
      properties:{ name: cleanName(name), kind: isReserve ? 'reserve' : 'park', ha: Number(ha.toFixed(2)) },
      geometry: geom
    });
  }

  // Largest first so big reserves paint under smaller parks that sit inside them
  // (e.g. Chestnut Nature Park within the Central Catchment).
  feats.sort((a,b) => b.properties.ha - a.properties.ha);

  const fc = {type:'FeatureCollection', features:feats};
  fs.writeFileSync(path.join(OUT,'parks.polys.geojson'), JSON.stringify(fc));
  const meta = {
    count: feats.length,
    reserves,
    total_ha: Number(totalHa.toFixed(1)),
    total_km2: Number((totalHa/100).toFixed(1)),
    bounds: [round(minX), round(minY), round(maxX), round(maxY)],
    source: 'NParks Parks and Nature Reserves (data.gov.sg)'
  };
  fs.writeFileSync(path.join(OUT,'parks.meta.json'), JSON.stringify(meta, null, 2));
  const kb = (fs.statSync(path.join(OUT,'parks.polys.geojson')).size/1024).toFixed(0);
  console.log(`parks:  ${feats.length} kept (${reserves} reserves), ${meta.total_ha} ha, ${kb} KB`);
  console.log(`        dropped ${Object.entries(skipped).map(([k,v])=>v+' '+k).join(', ')}`);
  return meta;
}

// ---------- racks ----------
function buildRacks(){
  const src = JSON.parse(fs.readFileSync(path.join(SRC, 'LTABicycleRackGEOJSON.geojson'), 'utf8'));
  const feats = [];
  let spaces = 0, sheltered = 0;
  let minX=180, minY=90, maxX=-180, maxY=-90;

  for(const f of src.features){
    const a = htmlAttrs((f.properties||{}).Description);
    const n = parseInt(a.RACK_CNT, 10);
    const cnt = Number.isFinite(n) ? n : 0;
    const shl = a.SHLTR_IND === 'Yes';
    const [x, y] = f.geometry.coordinates;
    const lng = round(x), lat = round(y);
    if(lng<minX) minX=lng; if(lng>maxX) maxX=lng;
    if(lat<minY) minY=lat; if(lat>maxY) maxY=lat;
    spaces += cnt; if(shl) sheltered++;
    feats.push({
      type:'Feature',
      properties:{ n: cnt, sh: shl ? 1 : 0, t: a.TYP_CD || '' },
      geometry:{ type:'Point', coordinates:[lng, lat] }
    });
  }

  const fc = {type:'FeatureCollection', features:feats};
  fs.writeFileSync(path.join(OUT,'racks.points.geojson'), JSON.stringify(fc));
  const meta = {
    count: feats.length,
    spaces,
    sheltered,
    bounds: [minX, minY, maxX, maxY],
    source: 'LTA Bicycle Rack (data.gov.sg)'
  };
  fs.writeFileSync(path.join(OUT,'racks.meta.json'), JSON.stringify(meta, null, 2));
  const kb = (fs.statSync(path.join(OUT,'racks.points.geojson')).size/1024).toFixed(0);
  console.log(`racks:  ${feats.length} sites, ${spaces} spaces, ${sheltered} sheltered, ${kb} KB`);
  return meta;
}

buildParks();
buildRacks();
