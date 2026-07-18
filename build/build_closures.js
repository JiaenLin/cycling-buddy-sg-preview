/* Build the cycling-closures/diversions overlay for Cycling Buddy SG.
 *
 *   node build/build_closures.js
 *
 * Curated, time-limited closures — not a bulk dataset — defined by hand here with a source.
 *
 * Current closure — Gardens by the Bay, Bay South Garden:
 *   Per the official notice, cyclists have NO ACCESS along the waterfront promenade facing Marina
 *   Reservoir (Bay South <-> Bay East bridge works). The new cycling route goes around the
 *   perimeter; pedestrians keep promenade access; on-site signage directs everyone.
 *   Source: https://www.gardensbythebay.com.sg — official diversion map:
 *   https://www.gardensbythebay.com.sg/content/dam/gbb-2021/image/about-us/media-room/2026/wetlands-by-the-bay/Diversion-map.pdf
 *
 * We DON'T reroute or trace the schematic detour (that produced a wrong line twice). Instead we
 * flag the affected stretch of the EXISTING loop: the Southern Ridges Loop (loop 3) where it runs
 * through Gardens by the Bay along the closed waterfront. The app draws a red "diversion risk" glow
 * over that stretch + a marker; tap -> notice + official map. Geometry is the exact real PCN
 * feature tagged for Gardens by the Bay, so nothing is invented.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'data');
const round = n => Number(n.toFixed(5));

const MAP_URL = 'https://www.gardensbythebay.com.sg/content/dam/gbb-2021/image/about-us/media-room/2026/wetlands-by-the-bay/Diversion-map.pdf';
// The affected stretch = the shoreline promenade facing Marina Reservoir. In the PCN data that's
// the Southern Ridges Loop (loop 3) segment tagged park "Gardens by the Bay" — the line that runs
// NW along the reservoir edge (NOT the east descent / MCE bottom loop, which is a different part of
// the loop). We glow exactly that one real segment; marker sits at its length-midpoint.
const RISK_LOOP = 3;
const RISK_PARK = 'Gardens by the Bay';

const mLat=110540, mLng=111320*Math.cos(1.284*Math.PI/180);
function lengthMidpoint(coords){
  if(!Array.isArray(coords) || coords.length<2) throw new Error('Closure line must contain at least two coordinates');
  let total=0; const segs=[];
  for(let i=1;i<coords.length;i++){ const d=Math.hypot((coords[i][0]-coords[i-1][0])*mLng,(coords[i][1]-coords[i-1][1])*mLat); segs.push(d); total+=d; }
  if(total<=0) throw new Error('Closure line has zero length');
  let acc=0; const half=total/2;
  for(let i=0;i<segs.length;i++){
    if(acc+segs[i]>=half){ const t=(half-acc)/segs[i]; return [round(coords[i][0]+t*(coords[i+1][0]-coords[i][0])), round(coords[i][1]+t*(coords[i+1][1]-coords[i][1]))]; }
    acc+=segs[i];
  }
  return coords[Math.floor(coords.length/2)];
}

const active = {
  name:'Gardens by the Bay — Bay South',
  title:'Cycling diversion — Bay South',
  note:'No cycling on the waterfront promenade facing Marina Reservoir, for the Bay South–Bay East bridge works. The cycling detour goes around the Bay South perimeter — follow on-site signage.',
  from:'2026-05-04', until:'~2028', src:'gardensbythebay.com.sg', url:MAP_URL
};

const pcn = JSON.parse(fs.readFileSync(path.join(OUT,'pcn.lines.geojson'),'utf8'));
const matches = pcn.features.filter(f =>
  f.properties.loop === RISK_LOOP &&
  f.properties.park === RISK_PARK &&
  f.geometry && f.geometry.type === 'LineString'
);
if(matches.length !== 1){
  throw new Error(`Expected exactly one ${RISK_PARK} feature on loop ${RISK_LOOP}; found ${matches.length}`);
}
const riskCoords = matches[0].geometry.coordinates.map(([lng,lat]) => [round(lng),round(lat)]);
let riskKm = 0;
for(let i=1;i<riskCoords.length;i++){
  const dx=(riskCoords[i][0]-riskCoords[i-1][0])*mLng;
  const dy=(riskCoords[i][1]-riskCoords[i-1][1])*mLat;
  riskKm += Math.hypot(dx,dy)/1000;
}
const MARKER = lengthMidpoint(riskCoords);
const riskFeatures = [
  { type:'Feature', properties:{ kind:'risk' }, geometry:{ type:'LineString', coordinates:riskCoords } }
];

const fc = { type:'FeatureCollection', features:[
  ...riskFeatures,
  { type:'Feature', properties:{ kind:'marker', title:active.title, note:active.note, src:active.src, url:active.url },
    geometry:{ type:'Point', coordinates:MARKER } }
]};
fs.writeFileSync(path.join(OUT,'closures.geojson'), JSON.stringify(fc));

const meta = { count:1, marker:MARKER, risk_km:Number(riskKm.toFixed(2)), active:[active],
  source:'Gardens by the Bay notice; affected stretch = Southern Ridges Loop (loop 3) through Gardens by the Bay, from pcn.lines.geojson' };
fs.writeFileSync(path.join(OUT,'closures.meta.json'), JSON.stringify(meta, null, 2));
console.log(`closures: ${riskFeatures.length} risk segments (~${riskKm.toFixed(2)} km) + 1 marker, ${(fs.statSync(path.join(OUT,'closures.geojson')).size/1024).toFixed(1)} KB`);
