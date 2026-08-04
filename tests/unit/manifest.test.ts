import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { SceneManifest } from '../../src/types.ts';
import { lineIntersectsCircle, polygonIntersectsCircle } from '../../scripts/lib/geometry.ts';

const manifestUrl = new URL('../../public/data/scene.json', import.meta.url);
const terrainUrl = new URL('../../public/data/terrain.f32', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as SceneManifest;
const terrainBuffer = await readFile(terrainUrl);
const heights = new Float32Array(terrainBuffer.buffer, terrainBuffer.byteOffset, terrainBuffer.byteLength / 4);
const terrainMin = heights.reduce((min, height) => Math.min(min, height), Number.POSITIVE_INFINITY);
const terrainMax = heights.reduce((max, height) => Math.max(max, height), Number.NEGATIVE_INFINITY);

describe('generated scene assets', () => {
  it('match the versioned schema and declared binary dimensions', () => {
    expect(manifest.schema).toBe('rondo-rataje-scene');
    expect(manifest.version).toBe(1);
    expect(manifest.center).toMatchObject({ wgs84: [16.950278, 52.395556], epsg2180: [360578.516, 505268.464], radius: 200 });
    expect(heights).toHaveLength(manifest.terrain.width * manifest.terrain.height);
    expect(manifest.terrain).toMatchObject({ width: 401, height: 401, cellSize: 1, verticalDatum: 'PL-EVRF2007-NH' });
  });

  it('contains a complete, finite, sensible terrain surface', () => {
    expect([...heights].every(Number.isFinite)).toBe(true);
    expect([...heights].every((height) => height !== manifest.terrain.noData)).toBe(true);
    expect(terrainMin).toBeCloseTo(manifest.terrain.min, 5);
    expect(terrainMax).toBeCloseTo(manifest.terrain.max, 5);
    expect(manifest.terrain.min).toBeGreaterThan(150);
    expect(manifest.terrain.max).toBeLessThan(300);
  });

  it('retains all 571 finite trees inside the radius with plausible heights', () => {
    expect(manifest.trees).toHaveLength(571);
    expect(new Set(manifest.trees.map((tree) => tree.id)).size).toBe(571);
    for (const tree of manifest.trees) {
      expect(tree.position.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...tree.position)).toBeLessThanOrEqual(200.01);
      expect(tree.height).toBeGreaterThan(1);
      expect(tree.height).toBeLessThan(45);
    }
  });

  it('keeps every BDOT10k feature intersecting the scene and in stable ID order', () => {
    expect(manifest.transport.map((feature) => feature.id)).toEqual([...manifest.transport.map((feature) => feature.id)].sort((a, b) => a.localeCompare(b)));
    expect(manifest.landCover.map((feature) => feature.id)).toEqual([...manifest.landCover.map((feature) => feature.id)].sort((a, b) => a.localeCompare(b)));
    for (const feature of manifest.transport) expect(lineIntersectsCircle(feature.coordinates, 200, feature.width / 2)).toBe(true);
    for (const feature of manifest.landCover) expect(polygonIntersectsCircle(feature.rings, 200)).toBe(true);
  });

  it('keeps official building footprints and stop points within the scene', () => {
    expect(manifest.buildings).toHaveLength(15);
    expect(manifest.stations).toHaveLength(11);
    for (const building of manifest.buildings) {
      expect(polygonIntersectsCircle(building.rings, 200)).toBe(true);
      expect(building.height).toBeGreaterThan(3);
      expect(building.height).toBeLessThan(100);
      expect(building.sourceLayer).toBe('BDOT10k OT_BUBD_A');
    }
    for (const station of manifest.stations) {
      expect(station.position.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...station.position)).toBeLessThanOrEqual(200.01);
      expect(station.sourceLayer).toBe('BDOT10k OT_OIKM_P');
    }
  });

  it('records source provenance and checksums deterministically', () => {
    expect(manifest.sources).toHaveLength(3);
    for (const source of manifest.sources) expect(source.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(createHash('sha256').update(terrainBuffer).digest('hex')).toMatch(/^[a-f0-9]{64}$/);
  });
});
