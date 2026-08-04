import type { SceneManifest } from './types.ts';

export interface LoadedSceneData {
  manifest: SceneManifest;
  heights: Float32Array;
}

function assertManifest(value: unknown): asserts value is SceneManifest {
  const manifest = value as Partial<SceneManifest>;
  if (
    manifest.schema !== 'rondo-rataje-scene' ||
    manifest.version !== 1 ||
    manifest.center?.radius !== 200 ||
    !manifest.terrain ||
    !Array.isArray(manifest.trees) ||
    !Array.isArray(manifest.transport) ||
    !Array.isArray(manifest.buildings) ||
    !Array.isArray(manifest.stations)
  ) {
    throw new Error('Unsupported or incomplete scene manifest');
  }
}

export async function loadSceneData(): Promise<LoadedSceneData> {
  const manifestResponse = await fetch('./data/scene.json');
  if (!manifestResponse.ok) throw new Error(`Scene manifest: HTTP ${manifestResponse.status}`);
  const value: unknown = await manifestResponse.json();
  assertManifest(value);

  const terrainResponse = await fetch(`./data/${value.terrain.binary}`);
  if (!terrainResponse.ok) throw new Error(`Terrain binary: HTTP ${terrainResponse.status}`);
  const heights = new Float32Array(await terrainResponse.arrayBuffer());
  const expected = value.terrain.width * value.terrain.height;
  if (heights.length !== expected) {
    throw new Error(`Terrain contains ${heights.length} samples; expected ${expected}`);
  }
  if (!heights.every(Number.isFinite)) throw new Error('Terrain contains non-finite samples');
  return { manifest: value, heights };
}
