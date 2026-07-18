/* Build the cycling-closures/diversions overlay for Cycling Buddy SG.
 *
 *   node build/build_closures.js
 *
 * Curated, time-limited closures — not a bulk dataset — so each is defined by hand here with a
 * source, and the geometry is pulled LIVE from OpenStreetMap (real paths, not hand-drawn guesses).
 *
 * Current closure:
 *   Gardens by the Bay — Waterfront Promenade at Bay South Garden closed to cyclists for the
 *   Bay South <-> Bay East bridge works. Live since 2026-05-04, completion ~2028. Cyclists detour
 *   around the Bay South perimeter and follow on-site signage.
 *   Source: https://www.gardensbythebay.com.sg (media room, 2026) / littlebigreddot 2026-05-04.
 *
 * The closed line is the reservoir-facing eastern chain of the OSM "Gardens by the Bay" cycleway
 * (highway=cycleway, name="Gardens by the Bay"). We show the CLOSED stretch + a "no bikes" marker;
 * we deliberately do NOT draw a detour line (the on-site signage + official map are authoritative,
 * and a wrong detour would be worse than none).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'data');
const round = n => Number(n.toFixed(5));

// OSM way ids of the reservoir-facing (closed) stretch, identified from the "Gardens by the Bay"
// cycleway geometry. Re-verify against OSM if the closure or the mapping changes.
const CLOSED_WAY_IDS = [533252139,620341170,620341169,474210626,663331244,166553478,245015483,245015484,416026985];

const QUERY = `[out:json][timeout:25];
way(around:600,1.2805,103.8700)[highway=cycleway]["name"="Gardens by the Bay"];
out geom;`;

// Overpass mirrors — the main endpoint rate-limits; fall through to mirrors on HTML/error.
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];
function post(url, body){
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode, body:d})); });
    req.on('error', reject); req.write(body); req.end();
  });
}
async function overpass(q){
  const body = 'data=' + encodeURIComponent(q);
  let lastErr;
  for(const url of MIRRORS){
    try{
      const r = await post(url, body);
      if(r.status===200 && r.body.trim().startsWith('{')) return JSON.parse(r.body);
      lastErr = new Error(`${url}: HTTP ${r.status} (likely rate-limited)`);
    }catch(e){ lastErr = e; }
  }
  throw lastErr;
}

(async () => {
  const g = await overpass(QUERY);
  const ways = g.elements.filter(e => e.type==='way' && e.geometry && CLOSED_WAY_IDS.includes(e.id));
  if(ways.length !== CLOSED_WAY_IDS.length){
    console.warn(`WARN: expected ${CLOSED_WAY_IDS.length} ways, got ${ways.length} — OSM ids may have changed; re-verify.`);
  }
  const lines = ways.map(w => w.geometry.map(p => [round(p.lon), round(p.lat)]));

  // marker = centroid of the closed chain
  let sx=0, sy=0, n=0;
  lines.forEach(l => l.forEach(([x,y]) => { sx+=x; sy+=y; n++; }));
  const marker = [round(sx/n), round(sy/n)];

  // rough length
  let m=0;
  lines.forEach(l => { for(let i=1;i<l.length;i++){
    const dx=(l[i][0]-l[i-1][0])*111320*Math.cos(marker[1]*Math.PI/180), dy=(l[i][1]-l[i-1][1])*110540;
    m += Math.hypot(dx,dy);
  }});

  const fc = { type:'FeatureCollection', features:[
    ...lines.map(coords => ({ type:'Feature', properties:{ kind:'closed' }, geometry:{ type:'LineString', coordinates:coords } })),
    { type:'Feature', properties:{
        kind:'marker',
        title:'Cycling diversion — Bay South',
        note:'Waterfront Promenade closed to cyclists for the Bay South–Bay East bridge works. Detour around the Bay South perimeter and follow on-site signage.',
        from:'2026-05-04', until:'~2028', src:'gardensbythebay.com.sg'
      }, geometry:{ type:'Point', coordinates:marker } }
  ]};
  fs.writeFileSync(path.join(OUT,'closures.geojson'), JSON.stringify(fc));

  const meta = {
    count: 1,                 // one active closure
    closed_m: Math.round(m),
    marker,
    active: [{
      name:'Gardens by the Bay — Bay South',
      title:'Cycling diversion — Bay South',
      note:'Waterfront Promenade closed to cyclists for the Bay South–Bay East bridge works. Detour around the Bay South perimeter and follow on-site signage.',
      from:'2026-05-04', until:'~2028', src:'gardensbythebay.com.sg'
    }],
    source:'OpenStreetMap (geometry) + Gardens by the Bay notice'
  };
  fs.writeFileSync(path.join(OUT,'closures.meta.json'), JSON.stringify(meta, null, 2));
  console.log(`closures: ${lines.length} segments, ~${Math.round(m)} m, marker ${marker}, ${(fs.statSync(path.join(OUT,'closures.geojson')).size/1024).toFixed(1)} KB`);
})().catch(e => { console.error('build_closures failed:', e.message); process.exit(1); });
