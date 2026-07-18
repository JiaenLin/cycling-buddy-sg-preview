/* Build the cycling-closures/diversions overlay for Cycling Buddy SG.
 *
 *   node build/build_closures.js
 *
 * Curated, time-limited closures — not a bulk dataset — defined by hand here with a source.
 *
 * Current closure — Gardens by the Bay, Bay South Garden:
 *   Per the official notice, cyclists have NO ACCESS along the waterfront promenade facing Marina
 *   Reservoir (Bay South <-> Bay East bridge works). The new cycling route goes AROUND THE
 *   PERIMETER of Bay South Garden (shown red on the official map); pedestrians keep promenade
 *   access (shown purple). On-site signage directs everyone.
 *   Source: https://www.gardensbythebay.com.sg (media room, 2026) — official diversion map:
 *   https://www.gardensbythebay.com.sg/content/dam/gbb-2021/image/about-us/media-room/2026/wetlands-by-the-bay/Diversion-map.pdf
 *
 * IMPORTANT: we show a single ADVISORY MARKER on the closed east waterfront, NOT a traced route.
 * The official map is a schematic; tracing its perimeter route onto OSM risks drawing it wrong
 * (an earlier attempt put a red line on the east waterfront — exactly where the official map shows
 * "No Access", and red officially means the OPEN detour). An honest marker + the official map link
 * beats a confident-but-wrong line. The marker point is the centroid of the reservoir-facing
 * ("Gardens by the Bay" cycleway) promenade ways in OSM: 245015483, 245015484, 416026985.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'data');

const MARKER = [103.87314, 1.28262];   // on the closed waterfront promenade facing Marina Reservoir
const MAP_URL = 'https://www.gardensbythebay.com.sg/content/dam/gbb-2021/image/about-us/media-room/2026/wetlands-by-the-bay/Diversion-map.pdf';

const active = {
  name:'Gardens by the Bay — Bay South',
  title:'Cycling diversion — Bay South',
  note:'No cycling on the waterfront promenade facing Marina Reservoir, for the Bay South–Bay East bridge works. The cycling detour goes around the Bay South perimeter — follow on-site signage.',
  from:'2026-05-04', until:'~2028',
  src:'gardensbythebay.com.sg', url:MAP_URL
};

const fc = { type:'FeatureCollection', features:[
  { type:'Feature', properties:{ kind:'marker', title:active.title, note:active.note, src:active.src, url:active.url },
    geometry:{ type:'Point', coordinates:MARKER } }
]};
fs.writeFileSync(path.join(OUT,'closures.geojson'), JSON.stringify(fc));

const meta = { count:1, marker:MARKER, active:[active], source:'Gardens by the Bay notice; marker point from OpenStreetMap' };
fs.writeFileSync(path.join(OUT,'closures.meta.json'), JSON.stringify(meta, null, 2));
console.log(`closures: 1 advisory marker at ${MARKER}, ${(fs.statSync(path.join(OUT,'closures.geojson')).size)} bytes`);
