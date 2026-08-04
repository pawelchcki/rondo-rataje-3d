# Rondo Rataje · 200 m

A self-contained static Three.js map of the 200 m radius around Rondo Rataje in Poznań. The scene is centered at WGS84 `16.950278, 52.395556` / EPSG:2180 `360578.516, 505268.464` and uses real metres at the accurate default 1× vertical scale.

The checked-in compact dataset contains:

- a 401 × 401, 1 m terrain crop in PL-EVRF2007-NH from GUGiK NMT;
- clipped roads, pedestrian/cycle routes, tram tracks and land cover from GUGiK BDOT10k;
- 571 trees decoded from the GEOPOZ public 3D vegetation tileset, with source positions, IDs, species, status, survey method and measured height;
- 15 BDOT10k building footprints extruded from published storey counts and 11 official BDOT10k public-transport stop points.

## Run it

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Drag to orbit, scroll to zoom, and hover over trees or movement features for source details. The controls switch between north-up top and oblique views, toggle layers, and optionally exaggerate terrain relief to 3×. The default is accurate 1× geometry.

Production and verification commands:

```sh
npm run typecheck
npm test
npm run build
npm run test:smoke
```

The smoke test requires Playwright Chromium (`npx playwright install chromium` once on a new machine).

## Refresh measured data

```sh
npm run data:refresh
```

The refresh needs internet access and the `unzip` command. It:

1. queries the GUGiK EVRF2007 WFS years newest-first and accepts the newest single year whose 1 m grids fill every output sample;
2. discovers the current Poznań BDOT10k Shapefile package via its official WMS, extracts only the relevant transport, land-cover, building and stop layer families in temporary storage, then clips and converts them to local metres;
3. traverses the live GEOPOZ vegetation tileset, fetches only tiles whose geographic bounds intersect the circle, recursively decodes CMPT/I3DM instances, transforms quantized ECEF positions, and filters the result to 200 m;
4. writes only `public/data/scene.json` and `public/data/terrain.f32`.

Source archives remain in the operating system’s temporary directory and are deleted at the end. The manifest records URLs, retrieval day, source vintages, coordinate and height reference systems, SHA-256 checksums, center, radius, and attribution. Service indexes can change; consequently a later refresh may resolve a newer vintage than the checked-in data.

## Accuracy and appearance

Positions, elevations, widths where populated by BDOT10k, building footprints and storey counts, stop locations, and tree heights come from the cited public datasets. Rendering is deliberately stylized: low-poly crowns, trunk proportions, colors, lighting, tram-bed appearance, and default widths used when an optional BDOT10k width is absent are cartographic choices. Building massing uses the official footprint and storey count with a documented 3.2 m per-storey display assumption; it is not a surveyed roof model. Stop positions are official, while their photo-referenced glass shelters, benches, signs, and passenger-information displays are representative low-poly models oriented to the nearest mapped road or tram alignment. The two bus-station records define one terminal-scale model with six parallel translucent barrel-vault platform roofs, dark-blue portal frames, bus lanes, concrete platforms, and a covered cross-aisle matching the documented Rataje station layout. Draped surfaces use small, documented layer and per-feature height offsets plus GPU polygon offset to prevent coplanar depth flicker; source coordinates and the underlying measured terrain are unchanged. There is no orthophoto or invented lane marking. BDOT10k is authoritative at its published topographic level but remains generalized rather than survey-grade street engineering geometry.

Data attribution: Główny Urząd Geodezji i Kartografii (GUGiK); Zarząd Geodezji i Katastru Miejskiego GEOPOZ / Miasto Poznań.
