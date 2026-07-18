# Path diversion / closure updates — guideline

How to add or change a cycling closure/diversion on the map **without** repeating past
mistakes. Read this before touching `build_closures.js` or the closure layers.

## The golden rule
**We flag the affected stretch of an EXISTING loop. We do NOT reroute, and we do NOT trace
the official detour.** The rider gets: (1) a highlight on the part of their loop that's
affected, (2) a soft warning marker, (3) a link to the authoritative official map, and (4)
"follow on-site signage." That's it.

## Step 1 — Read the official notice like a lawyer
Extract three separate things; do not conflate them:
1. **What is CLOSED** (e.g. "the waterfront promenade facing Marina Reservoir").
2. **What the NEW route is** (e.g. "around the Bay South perimeter").
3. **The colour key on the official map.** ⚠️ On official maps **red is usually the NEW
   (OPEN) cycling route**, not the closure — the closure is marked "No Access". Do not assume
   red = danger.

> Past mistake (v14): drew a red line on the east waterfront and called it the closure. That's
> exactly where the official map shows **No Access**, and red there officially means the OPEN
> detour. Wrong location *and* inverted meaning.

## Step 2 — Identify the affected loop segment from real data
- Find which loop the closure sits on: run a bbox query over `data/pcn.lines.geojson`
  (see `build_closures.js`), print the loop name + parks.
- **Use the real geometry.** Never hand-draw a line onto the map — clip the actual loop
  segments. Hand-tracing a schematic official map onto OSM/PCN geometry gets it wrong.

## Step 3 — Keep the marked area SMALL and precise
- Mark **only the stretch that is actually affected** — the minimum that's true.
- **Smaller is safer.** Over-marking (flagging a broad area "just in case") misleads riders
  into thinking open paths are closed. When in doubt, mark less.
- Tighten the clip bbox until the glow sits *inside* the affected stretch, then stop.

## Step 4 — Style
- **Glow:** a translucent red line over the affected loop stretch (`kind:'risk'`). Normal line
  params only — **no `line-blur`, no extreme `line-width`** (they're fragile; keep it like every
  other line layer). Drawn on top of `pcn-line` so the loop glows red.
- **Marker:** a **soft warning** (amber caution), not an aggressive red "no cycling"
  prohibition. One marker, small.
- **Popup:** the notice text + a tappable link to the **official diversion map** (the
  authority for the exact route). Always end with "follow on-site signage."

## Step 5 — Verify (do NOT trust headless screenshots)
- Playwright's bundled headless Chromium (SwiftShader) renders **blank for line layers** while
  symbols/basemap look fine — intermittently. **Never bisect code off a blank map frame.**
- Trust `map.queryRenderedFeatures({layers:[...]})` and `map.getLayer()` — the engine truth.
- To actually *see* it, launch real GPU: `chromium.launch({ channel:'chrome' })`. That captures
  line layers when bundled headless can't. (`preserveDrawingBuffer:true` does NOT fix it.)
- Check: island still renders all loops (regression guard), the glow sits on the right stretch
  in light + dark, tap → popup + link, legend toggle, theme switch.

## Step 6 — Ship
- `node build/build_closures.js` regenerates `data/closures.geojson` + `.meta.json`.
- **Bump `VERSION` in `sw.js`** — that's what precaches the new data and triggers the in-app
  "Map updated — tap to refresh" pill for installed users.
- Deploy, confirm live by curl (don't load the live site in a headful browser — it fires a real
  analytics beacon and pads the visitor count).

## To END a closure (when the works finish)
Empty the `features` array in `build_closures.js`'s output (or delete the closure entry) and
bump `sw.js` VERSION. The layers render nothing; no code removal needed.

## Checklist
- [ ] Read notice: closed vs new-route vs official colour key
- [ ] Affected loop identified from `pcn.lines.geojson` (real geometry)
- [ ] Marked area is the minimum true stretch (smaller is safer)
- [ ] Glow = translucent red, no blur, normal width
- [ ] Marker = soft warning, one, small
- [ ] Popup links the official map + "follow signage"
- [ ] Verified via `queryRenderedFeatures` + real-GPU Chrome, light + dark
- [ ] Island loops still render (no regression)
- [ ] `sw.js` VERSION bumped; deployed; curl-confirmed
