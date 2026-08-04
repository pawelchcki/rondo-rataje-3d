import * as THREE from 'three';
import type { SceneManifest } from './types.ts';

export class TerrainSampler {
  readonly base: number;

  constructor(
    private readonly metadata: SceneManifest['terrain'],
    private readonly values: Float32Array,
  ) {
    this.base = metadata.min;
  }

  absolute(east: number, north: number): number {
    const { origin, cellSize, width, height } = this.metadata;
    const gx = Math.max(0, Math.min(width - 1, (east - origin[0]) / cellSize));
    const gy = Math.max(0, Math.min(height - 1, (north - origin[1]) / cellSize));
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const tx = gx - x0;
    const ty = gy - y0;
    const a = this.values[y0 * width + x0];
    const b = this.values[y0 * width + x1];
    const c = this.values[y1 * width + x0];
    const d = this.values[y1 * width + x1];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
  }

  relative(east: number, north: number, exaggeration = 1): number {
    return (this.absolute(east, north) - this.base) * exaggeration;
  }
}

export function createTerrain(
  manifest: SceneManifest,
  sampler: TerrainSampler,
): { surface: THREE.Mesh; skirt: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const radius = manifest.center.radius;
  const radialSteps = radius;
  const angularSteps = 256;
  const positions: number[] = [];
  const indices: number[] = [];

  positions.push(0, sampler.relative(0, 0), 0);
  for (let ring = 1; ring <= radialSteps; ring += 1) {
    for (let segment = 0; segment < angularSteps; segment += 1) {
      const angle = (segment / angularSteps) * Math.PI * 2;
      const east = Math.sin(angle) * ring;
      const north = Math.cos(angle) * ring;
      positions.push(east, sampler.relative(east, north), -north);
    }
  }

  for (let segment = 0; segment < angularSteps; segment += 1) {
    indices.push(0, 1 + segment, 1 + ((segment + 1) % angularSteps));
  }
  for (let ring = 1; ring < radialSteps; ring += 1) {
    const inner = 1 + (ring - 1) * angularSteps;
    const outer = inner + angularSteps;
    for (let segment = 0; segment < angularSteps; segment += 1) {
      const next = (segment + 1) % angularSteps;
      indices.push(inner + segment, outer + segment, outer + next);
      indices.push(inner + segment, outer + next, inner + next);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xd9dacb,
    roughness: 0.98,
    metalness: 0,
    side: THREE.FrontSide,
  });
  const surface = new THREE.Mesh(geometry, material);
  surface.receiveShadow = true;
  surface.name = '1 m terrain';

  const skirtPositions: number[] = [];
  const skirtIndices: number[] = [];
  for (let segment = 0; segment < angularSteps; segment += 1) {
    const angle = (segment / angularSteps) * Math.PI * 2;
    const east = Math.sin(angle) * radius;
    const north = Math.cos(angle) * radius;
    const top = sampler.relative(east, north);
    skirtPositions.push(east, top, -north, east, -5, -north);
    const next = (segment + 1) % angularSteps;
    skirtIndices.push(segment * 2, segment * 2 + 1, next * 2 + 1);
    skirtIndices.push(segment * 2, next * 2 + 1, next * 2);
  }
  const skirtGeometry = new THREE.BufferGeometry();
  skirtGeometry.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3));
  skirtGeometry.setIndex(skirtIndices);
  skirtGeometry.computeVertexNormals();
  const skirt = new THREE.Mesh(
    skirtGeometry,
    new THREE.MeshStandardMaterial({ color: 0x8d8b7d, roughness: 1, side: THREE.DoubleSide }),
  );
  skirt.receiveShadow = true;
  return { surface, skirt, material };
}
