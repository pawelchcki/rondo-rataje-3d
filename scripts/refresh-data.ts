import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as shapefile from 'shapefile';
import type { Feature, Geometry } from 'geojson';
import type { BuildingRecord, LandCoverFeature, Point2, SceneManifest, TransitStopRecord, TransportFeature, TransportKind, TreeKind, TreeRecord } from '../src/types.ts';
import { mergeAndCropGrids, parseAsciiGrid } from './lib/ascii-grid.ts';
import { clipPolylinePartsToCircle, clipRingToCircle, lineIntersectsCircle, polygonIntersectsCircle } from './lib/geometry.ts';
import { ecefToWgs84, projectWgs84 } from './lib/projection.ts';
import { decodeTile } from './lib/tiles.ts';

const CENTER_WGS84 = [16.950278, 52.395556] as const;
const CENTER_2180 = [360578.516, 505268.464] as const;
const RADIUS = 200;
const OUTPUT = new URL('../public/data/', import.meta.url);
const TREE_BASE = 'https://sip.poznan.pl/model3d/dane/f049b31c-41e7-4f82-bc46-4385a480863c/';
const TREE_TILESET = `${TREE_BASE}tileset.json`;
const NMT_WFS = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NumerycznyModelTerenuEVRF2007/WFS/Skorowidze';
const BDOT_WMS = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/BDOT/WMS/PobieranieBDOT10k';

interface Downloaded {
  url: string;
  buffer: Buffer;
  checksum: string;
}

async function download(url: string): Promise<Downloaded> {
  process.stdout.write(`downloading ${url}\n`);
  const response = await fetch(url, { headers: { 'user-agent': 'rondo-rataje-data-refresh/1.0' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { url, buffer, checksum: createHash('sha256').update(buffer).digest('hex') };
}

function xmlValues(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<gugik:${name}>([^<]+)`, 'g'))].map((match) => match[1].replaceAll('&amp;', '&'));
}

async function resolveTerrain(): Promise<{
  crop: ReturnType<typeof mergeAndCropGrids>;
  sheets: string[];
  year: number;
  downloads: Downloaded[];
}> {
  const capabilities = (await download(`${NMT_WFS}?SERVICE=WFS&REQUEST=GetCapabilities`)).buffer.toString('utf8');
  const years = [...capabilities.matchAll(/SkorowidzNMT(\d{4})/g)].map((match) => Number(match[1])).filter((year, index, all) => all.indexOf(year) === index).sort((a, b) => b - a);
  for (const year of years) {
    const parameters = new URLSearchParams({
      SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
      TYPENAMES: `gugik:SkorowidzNMT${year}`, SRSNAME: 'EPSG:2180',
      BBOX: `${CENTER_2180[0] - RADIUS},${CENTER_2180[1] - RADIUS},${CENTER_2180[0] + RADIUS},${CENTER_2180[1] + RADIUS},EPSG:2180`,
    });
    const indexXml = (await download(`${NMT_WFS}?${parameters}`)).buffer.toString('utf8');
    const urls = xmlValues(indexXml, 'url_do_pobrania');
    const sheets = xmlValues(indexXml, 'godlo');
    if (urls.length === 0) continue;
    const downloads = await Promise.all(urls.map(download));
    try {
      const grids = downloads.map((item) => parseAsciiGrid(item.buffer.toString('utf8'), 'yx')).filter((grid) => grid.cellSize <= 1);
      if (grids.length !== downloads.length) continue;
      return { crop: mergeAndCropGrids(grids, [...CENTER_2180], RADIUS), sheets, year, downloads };
    } catch (error) {
      process.stdout.write(`NMT ${year} is incomplete at the circle: ${String(error)}\n`);
    }
  }
  throw new Error('No single NMT year provides complete 1 m EVRF2007 coverage');
}

interface TilesetNode {
  boundingVolume?: { region?: number[] };
  content?: { uri?: string; url?: string; boundingVolume?: { region?: number[] } };
  children?: TilesetNode[];
}

function regionIntersectsScene(region: number[]): boolean {
  const longitude = CENTER_WGS84[0] * Math.PI / 180;
  const latitude = CENTER_WGS84[1] * Math.PI / 180;
  const latitudeMargin = RADIUS / 6378137;
  const longitudeMargin = latitudeMargin / Math.cos(latitude);
  return region[2] >= longitude - longitudeMargin && region[0] <= longitude + longitudeMargin
    && region[3] >= latitude - latitudeMargin && region[1] <= latitude + latitudeMargin;
}

function collectTileUris(node: TilesetNode, output: string[]): void {
  const region = node.content?.boundingVolume?.region ?? node.boundingVolume?.region;
  const uri = node.content?.uri ?? node.content?.url;
  if (uri && (!region || regionIntersectsScene(region))) output.push(uri);
  for (const child of node.children ?? []) collectTileUris(child, output);
}

function classifyTree(speciesLatin: string | null, species: string | null): TreeKind {
  if (!speciesLatin && !species) return 'unknown';
  if (/^(Abies|Chamaecyparis|Juniperus|Larix|Picea|Pinus|Pseudotsuga|Taxus|Thuja|Tsuga)\b/i.test(speciesLatin ?? '')) return 'conifer';
  return 'broadleaf';
}

async function resolveTrees(terrain: ReturnType<typeof mergeAndCropGrids>): Promise<{ trees: TreeRecord[]; downloads: Downloaded[]; version: string }> {
  const tilesetDownload = await download(TREE_TILESET);
  const tileset = JSON.parse(tilesetDownload.buffer.toString('utf8')) as { asset: { tilesetVersion?: string }; root: TilesetNode };
  const uris: string[] = [];
  collectTileUris(tileset.root, uris);
  const tileDownloads = await Promise.all([...new Set(uris)].sort().map((uri) => download(new URL(uri, TREE_BASE).href)));
  const sampleTerrain = (east: number, north: number): number => {
    const column = Math.max(0, Math.min(terrain.width - 1, Math.round(east - terrain.origin[0])));
    const row = Math.max(0, Math.min(terrain.height - 1, Math.round(north - terrain.origin[1])));
    return terrain.values[row * terrain.width + column];
  };
  const trees: TreeRecord[] = [];
  for (const tile of tileDownloads) {
    for (const instance of decodeTile(tile.buffer)) {
      const geodetic = ecefToWgs84(...instance.ecef);
      const projected = projectWgs84(geodetic.longitude, geodetic.latitude);
      const east = projected[0] - CENTER_2180[0];
      const north = projected[1] - CENTER_2180[1];
      if (Math.hypot(east, north) > RADIUS + 1e-6) continue;
      const attributes = instance.attributes;
      const species = typeof attributes.gatunek === 'string' && attributes.gatunek ? attributes.gatunek : null;
      const speciesLatin = typeof attributes.gatunek_l === 'string' && attributes.gatunek_l ? attributes.gatunek_l : null;
      const sourceHeight = Number(attributes.wysokosc);
      const modelHeight = Math.max(...instance.scale);
      const height = Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : modelHeight;
      if (!Number.isFinite(height) || height <= 0) continue;
      trees.push({
        id: String(attributes['gml:id'] ?? attributes.id ?? `tree-${trees.length}`),
        objectId: Number.isFinite(Number(attributes.objectid)) ? Number(attributes.objectid) : null,
        position: [Number(east.toFixed(3)), Number(north.toFixed(3))],
        elevation: Number(sampleTerrain(east, north).toFixed(3)),
        height: Number(height.toFixed(2)),
        species,
        speciesLatin,
        status: typeof attributes.status === 'string' ? attributes.status : null,
        survey: typeof attributes.pomiar === 'string' ? attributes.pomiar : null,
        kind: classifyTree(speciesLatin, species),
      });
    }
  }
  trees.sort((a, b) => a.id.localeCompare(b.id));
  return { trees, downloads: [tilesetDownload, ...tileDownloads], version: tileset.asset.tilesetVersion ?? 'unknown' };
}

function toLocal(points: number[][]): Point2[] {
  return points.map(([easting, northing]) => [Number((easting - CENTER_2180[0]).toFixed(3)), Number((northing - CENTER_2180[1]).toFixed(3))]);
}

function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function polygonParts(geometry: Geometry): number[][][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

async function readShape(base: string): Promise<Feature[]> {
  const source = await shapefile.open(`${base}.shp`, `${base}.dbf`, { encoding: 'utf-8' });
  const features: Feature[] = [];
  while (true) {
    const item = await source.read();
    if (item.done) break;
    features.push(item.value as Feature);
  }
  return features;
}

async function visitShape(base: string, visitor: (feature: Feature) => void): Promise<void> {
  const source = await shapefile.open(`${base}.shp`, `${base}.dbf`, { encoding: 'utf-8' });
  while (true) {
    const item = await source.read();
    if (item.done) break;
    visitor(item.value as Feature);
  }
}

async function resolveBdot(work: string): Promise<{
  transport: TransportFeature[];
  landCover: LandCoverFeature[];
  buildings: BuildingRecord[];
  stations: TransitStopRecord[];
  download: Downloaded;
  vintage: string;
}> {
  const query = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: 'Powiaty', QUERY_LAYERS: 'Powiaty',
    INFO_FORMAT: 'text/html', CRS: 'EPSG:2180',
    BBOX: `${CENTER_2180[1] - RADIUS},${CENTER_2180[0] - RADIUS},${CENTER_2180[1] + RADIUS},${CENTER_2180[0] + RADIUS}`,
    WIDTH: '201', HEIGHT: '201', I: '100', J: '100',
  });
  const html = (await download(`${BDOT_WMS}?${query}`)).buffer.toString('utf8');
  const packageUrl = html.match(/https:[^"<\s]+_SHP\.zip/)?.[0];
  if (!packageUrl) throw new Error('BDOT10k WMS did not return a county SHP package');
  const archive = await download(packageUrl);
  const archivePath = join(work, 'bdot.zip');
  const shapeDirectory = join(work, 'bdot');
  await writeFile(archivePath, archive.buffer);
  await mkdir(shapeDirectory);
  const patterns = ['*__OT_SKJZ_L.*', '*__OT_SKRP_L.*', '*__OT_SKTR_L.*', '*__OT_PTPL_A.*', '*__OT_PTTR_A.*', '*__OT_BUBD_A.*', '*__OT_OIKM_P.*'];
  execFileSync('unzip', ['-qq', '-o', archivePath, ...patterns, '-d', shapeDirectory]);
  const files = await readdir(shapeDirectory);
  const findBase = (layer: string): string => join(shapeDirectory, (files.find((file) => file.includes(`__OT_${layer}.shp`)) ?? '').replace(/\.shp$/, ''));

  const transport: TransportFeature[] = [];
  const layerConfig: Array<[string, TransportKind]> = [['SKJZ_L', 'road'], ['SKRP_L', 'path'], ['SKTR_L', 'tram']];
  let vintage = '';
  for (const [layer, defaultKind] of layerConfig) {
    for (const feature of await readShape(findBase(layer))) {
      const properties = feature.properties ?? {};
      const version = String(properties.WERSJA ?? '');
      if (version > vintage) vintage = version;
      for (const part of lineParts(feature.geometry)) {
        const local = toLocal(part);
        const widthValue = Number(properties.SZER_NAWIE ?? properties.SZEROKOSC);
        const kind: TransportKind = defaultKind === 'path' && /rower/i.test(String(properties.RODZAJ)) ? 'cycleway' : defaultKind;
        const width = Number.isFinite(widthValue) && widthValue > 0 ? widthValue : kind === 'road' ? 8 : kind === 'tram' ? 5.2 : kind === 'cycleway' ? 2.5 : 2;
        if (!lineIntersectsCircle(local, RADIUS, width / 2)) continue;
        const street = [properties.ULI_CECHA, properties.ULI_NAZW_1, properties.ULI_NAZW_2].filter(Boolean).join(' ');
        // Keep the full rendered ribbon inside the circular terrain disk.
        for (const clipped of clipPolylinePartsToCircle(local, Math.max(1, RADIUS - width / 2))) {
          transport.push({
            id: `${layer}:${String(properties.LOKALNYID)}:${transport.length}`,
            kind,
            name: street || String(properties.NAZWA ?? properties.RODZAJ ?? properties.NUMER_DROG ?? '') || null,
            width,
            coordinates: clipped.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]),
            sourceLayer: `BDOT10k OT_${layer}`,
          });
        }
      }
    }
  }

  const landCover: LandCoverFeature[] = [];
  const coverConfig = [['PTTR_A', 'grass'], ['PTPL_A', 'pavement']] as const;
  for (const [layer, kind] of coverConfig) {
    for (const feature of await readShape(findBase(layer))) {
      const properties = feature.properties ?? {};
      for (const polygon of polygonParts(feature.geometry)) {
        const rings = polygon.map(toLocal);
        if (!polygonIntersectsCircle(rings, RADIUS)) continue;
        const clippedOuter = clipRingToCircle(rings[0], RADIUS - 0.15);
        if (clippedOuter.length < 3) continue;
        landCover.push({
          id: `${layer}:${String(properties.LOKALNYID)}:${landCover.length}`,
          kind,
          rings: [clippedOuter.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))])],
          sourceLayer: `BDOT10k OT_${layer}`,
        });
      }
    }
  }
  const buildings: BuildingRecord[] = [];
  await visitShape(findBase('BUBD_A'), (feature) => {
    const properties = feature.properties ?? {};
    const version = String(properties.WERSJA ?? '');
    if (version > vintage) vintage = version;
    for (const polygon of polygonParts(feature.geometry)) {
      const rings = polygon.map(toLocal);
      if (!polygonIntersectsCircle(rings, RADIUS)) continue;
      const clippedOuter = clipRingToCircle(rings[0], RADIUS - 0.2);
      if (clippedOuter.length < 3) continue;
      const rawLevels = Number(properties.LICZ_KONDY);
      const levels = Number.isFinite(rawLevels) && rawLevels > 0 ? rawLevels : null;
      buildings.push({
        id: `BUBD_A:${String(properties.LOKALNYID)}:${buildings.length}`,
        rings: [clippedOuter.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))])],
        height: Number(((levels ?? 1) * 3.2).toFixed(1)),
        levels,
        name: String(properties.NAZWA ?? properties.INFO_DODAT ?? '') || null,
        function: String(properties.FSBUD ?? properties.PFBUD ?? properties.FOBUD ?? '') || null,
        status: String(properties.KAT_ISTNIE ?? '') || null,
        sourceLayer: 'BDOT10k OT_BUBD_A',
      });
    }
  });

  const stations: TransitStopRecord[] = [];
  await visitShape(findBase('OIKM_P'), (feature) => {
    if (feature.geometry.type !== 'Point') return;
    const properties = feature.properties ?? {};
    if (!/przystanek/i.test(String(properties.RODZAJ ?? ''))) return;
    const local = toLocal([feature.geometry.coordinates])[0];
    if (Math.hypot(...local) > RADIUS) return;
    const version = String(properties.WERSJA ?? '');
    if (version > vintage) vintage = version;
    stations.push({
      id: `OIKM_P:${String(properties.LOKALNYID)}`,
      position: [Number(local[0].toFixed(3)), Number(local[1].toFixed(3))],
      name: String(properties.NAZWA ?? 'Transit stop'),
      kind: String(properties.RODZAJ ?? 'przystanek autobusowy lub tramwajowy'),
      status: String(properties.KAT_ISTNIE ?? '') || null,
      note: String(properties.INFO_DODAT ?? '') || null,
      sourceLayer: 'BDOT10k OT_OIKM_P',
    });
  });
  transport.sort((a, b) => a.id.localeCompare(b.id));
  landCover.sort((a, b) => a.id.localeCompare(b.id));
  buildings.sort((a, b) => a.id.localeCompare(b.id));
  stations.sort((a, b) => a.id.localeCompare(b.id));
  return { transport, landCover, buildings, stations, download: archive, vintage: vintage || 'unknown' };
}

function combinedChecksum(downloads: Downloaded[]): string {
  const hash = createHash('sha256');
  for (const item of [...downloads].sort((a, b) => a.url.localeCompare(b.url))) hash.update(item.checksum);
  return hash.digest('hex');
}

function minMax(values: Float32Array): [min: number, max: number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [min, max];
}

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), 'rondo-rataje-'));
  try {
    const terrain = await resolveTerrain();
    const [trees, bdot] = await Promise.all([resolveTrees(terrain.crop), resolveBdot(work)]);
    const date = new Date().toISOString().slice(0, 10);
    const [min, max] = minMax(terrain.crop.values);
    const manifest: SceneManifest = {
      schema: 'rondo-rataje-scene', version: 1, generatedAt: `${date}T00:00:00.000Z`,
      center: { name: 'Rondo Rataje', wgs84: [...CENTER_WGS84], epsg2180: [...CENTER_2180], radius: RADIUS },
      terrain: {
        binary: 'terrain.f32', width: terrain.crop.width, height: terrain.crop.height, cellSize: 1,
        origin: terrain.crop.origin, min, max, noData: -9999, verticalDatum: 'PL-EVRF2007-NH', sourceSheets: terrain.sheets,
      },
      transport: bdot.transport, landCover: bdot.landCover, trees: trees.trees,
      buildings: bdot.buildings, stations: bdot.stations,
      sources: [
        { id: 'gugik-nmt', title: 'GUGiK 1 m NMT', url: NMT_WFS, retrievedAt: date, vintage: String(terrain.year), crs: 'EPSG:2180 + PL-EVRF2007-NH', checksum: combinedChecksum(terrain.downloads) },
        { id: 'gugik-bdot10k', title: 'GUGiK BDOT10k — Poznań', url: bdot.download.url, retrievedAt: date, vintage: bdot.vintage, crs: 'EPSG:2180', checksum: bdot.download.checksum },
        { id: 'geopoz-trees', title: 'GEOPOZ 3D vegetation model', url: TREE_TILESET, retrievedAt: date, vintage: trees.version, crs: 'ECEF / WGS84, exported EPSG:2180 local metres', checksum: combinedChecksum(trees.downloads) },
      ],
    };
    if (manifest.trees.some((tree) => Math.hypot(...tree.position) > RADIUS + 0.01)) throw new Error('Tree outside scene radius');
    if (!terrain.crop.values.every(Number.isFinite) || terrain.crop.values.some((value) => value === -9999)) throw new Error('Invalid terrain output');
    await mkdir(OUTPUT, { recursive: true });
    await writeFile(new URL('terrain.f32', OUTPUT), Buffer.from(terrain.crop.values.buffer));
    await writeFile(new URL('scene.json', OUTPUT), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`wrote ${manifest.trees.length} trees, ${manifest.transport.length} transport features, ${manifest.landCover.length} land-cover polygons, ${manifest.buildings.length} buildings, ${manifest.stations.length} stops\n`);
    process.stdout.write(`terrain ${min.toFixed(2)}–${max.toFixed(2)} m (${terrain.year}: ${terrain.sheets.join(', ')})\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();
