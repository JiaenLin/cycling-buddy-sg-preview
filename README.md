# Cycling Buddy SG — Singapore Park Connector cycling companion

**Free for everyone:** https://jiaenlin.github.io/cycling-buddy-sg/

An installable, **offline-capable** cycling map for Singapore's Park Connector Network (PCN).
See all 7 loops, find the nearest connector, plan routes that prefer park connectors, check
live rain, record rides — on a real street basemap, no app store, no sign-up, no ads.

![Cycling Buddy SG](icons/og.png)

## Features
- **Map** — the 7 PCN loops (colour-coded), the Rail Corridor, LTA cycling paths, and every
  park & nature reserve on a light/dark street basemap.
- **Parks & reserves** — 305 green spaces (64.7 km²) washed in under the network; tap for name and size.
- **Bike parking** — LTA's 396 racks (19,329 spaces) from z13.5; solid **P** = sheltered, hollow = open-air.
  When you're located, the nearest rack shows in the panel — tap to jump to it.
- **Locate** — live GPS position and the nearest park connector.
- **Route** — offline turn-by-turn A* routing with a cycling cost profile that prefers
  cycleways/park connectors over roads over footpaths, and **excludes expressways**. Two options
  per trip (*Most cycling* / *Shorter*), colour-coded by segment, with a **helmet notice** when a route uses roads.
- **Weather** — live NEA 2-hour forecast: a rain-zone map of the island, plus a heads-up along your planned route.
- **Record** — trace a ride with live distance/time/speed, export **GPX**.
- **Installable PWA** — Add to Home Screen; works offline once loaded.
- **Private by design** — your location never leaves your device. No accounts, no tracking cookies.

## Why
Singapore has ~300 km of park connectors, but no free map that treats the PCN as a
first-class cycling network — routable, offline, and rain-aware. This app fills that gap.

## Run locally
Any static server over HTTP works (the service worker + geolocation need `localhost` or HTTPS):
```bash
python -m http.server 8000      # then open http://localhost:8000
```

## Data & attribution
- **Park connectors:** NParks *Park Connector Loop* (data.gov.sg, Singapore Open Data Licence).
- **Cycling paths:** LTA *Cycling Path Network* (data.gov.sg).
- **Parks & nature reserves:** NParks *Parks and Nature Reserves* (data.gov.sg). That dataset is a
  land inventory rather than a list of destinations, so the build drops its 136 neighbourhood
  playgrounds, 17 grass verges and 3 fitness corners, and gives the Botanic Gardens' four internal
  management zones their real name. See [`build/build_parks_racks.js`](build/build_parks_racks.js).
- **Bike parking:** LTA *Bicycle Rack* (data.gov.sg).
- **Weather:** NEA 2-hour forecast (data.gov.sg).
- **Routing graph, Rail Corridor & basemap:** © OpenStreetMap contributors (ODbL); basemap hosting by [OpenFreeMap](https://openfreemap.org).

The routing graph (`data/graph.json`) is generated from OpenStreetMap — see [`build/`](build/).

## Tech
Vanilla JS, [MapLibre GL JS](https://maplibre.org/) (vendored, no CDN), a hand-rolled A* router
(`router.js`) over a contracted OSM graph. No build step, no framework, no backend — plain static files.

## Author & licence
Built by **[Lin Jiaen](https://github.com/JiaenLin)** · © 2026 Lin Jiaen · All rights reserved.

The **app is free to use and share**. The **source is published for transparency** but is not
open-licensed — see [LICENSE](LICENSE). Third-party data and libraries remain under their own
licences (ODbL, Singapore Open Data Licence, BSD-3).

Found a bug or have an idea? [Open an issue](https://github.com/JiaenLin/cycling-buddy-sg/issues) —
and if the app is useful to you, **star the repo** and share the link with your riding kakis. 🚴
