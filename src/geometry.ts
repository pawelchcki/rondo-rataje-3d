import * as THREE from 'three';
import type { BuildingRecord, LandCoverFeature, Point2, TransportFeature } from './types.ts';
import type { TerrainSampler } from './terrain.ts';

const COLORS = {
  road: 0x4f5352,
  path: 0xb7ad97,
  cycleway: 0x9d6655,
  tram: 0x676b64,
  grass: 0x879a72,
  pavement: 0xbcb7aa,
  asphalt: 0x565a59,
} as const;

export const SURFACE_OFFSETS = {
  landCover: { grass: 0.02, pavement: 0.035, asphalt: 0.05 },
  transport: { road: 0.075, path: 0.1, cycleway: 0.125, tram: 0.15 },
  building: 0.18,
  rail: 0.28,
  station: 0.34,
} as const;

export const FEATURE_OFFSET_STEP = 0.00001;

function directionNormal(a: Point2, b: Point2): Point2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

export function createRibbon(
  feature: TransportFeature,
  sampler: TerrainSampler,
  elevationScale: number,
  featureOrdinal = 0,
  width = feature.width,
  color = COLORS[feature.kind],
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const half = width / 2;
  const points = feature.coordinates;
  const yOffset = SURFACE_OFFSETS.transport[feature.kind] + featureOrdinal * FEATURE_OFFSET_STEP;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const normal = directionNormal(before, after);
    for (const sign of [-1, 1]) {
      const east = point[0] + normal[0] * half * sign;
      const north = point[1] + normal[1] * half * sign;
      positions.push(east, sampler.relative(east, north, elevationScale) + yOffset, -north);
    }
    if (index < points.length - 1) {
      const start = index * 2;
      indices.push(start, start + 1, start + 3, start, start + 3, start + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  mesh.renderOrder = 20;
  mesh.receiveShadow = true;
  mesh.userData.feature = feature;
  return mesh;
}

export function createLandCover(
  feature: LandCoverFeature,
  sampler: TerrainSampler,
  elevationScale: number,
  featureOrdinal = 0,
): THREE.Mesh {
  const outer = feature.rings[0] ?? [];
  const shape = new THREE.Shape(outer.map(([east, north]) => new THREE.Vector2(east, north)));
  for (const ring of feature.rings.slice(1)) {
    shape.holes.push(new THREE.Path(ring.map(([east, north]) => new THREE.Vector2(east, north))));
  }
  const geometry = new THREE.ShapeGeometry(shape);
  const attribute = geometry.getAttribute('position');
  for (let index = 0; index < attribute.count; index += 1) {
    const east = attribute.getX(index);
    const north = attribute.getY(index);
    const yOffset = SURFACE_OFFSETS.landCover[feature.kind] + featureOrdinal * FEATURE_OFFSET_STEP;
    attribute.setXYZ(index, east, sampler.relative(east, north, elevationScale) + yOffset, -north);
  }
  attribute.needsUpdate = true;
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: COLORS[feature.kind],
      roughness: 1,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  mesh.renderOrder = 10;
  mesh.receiveShadow = true;
  mesh.userData.feature = feature;
  return mesh;
}

export function createRail(
  points: Point2[],
  lateralOffset: number,
  sampler: TerrainSampler,
  elevationScale: number,
  featureOrdinal = 0,
): THREE.Mesh {
  const curvePoints = points.map((point, index) => {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const normal = directionNormal(before, after);
    const east = point[0] + normal[0] * lateralOffset;
    const north = point[1] + normal[1] * lateralOffset;
    return new THREE.Vector3(east, sampler.relative(east, north, elevationScale) + SURFACE_OFFSETS.rail + featureOrdinal * FEATURE_OFFSET_STEP, -north);
  });
  const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curvePoints), Math.max(8, points.length * 5), 0.075, 5, false);
  const rail = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xa8aaa6, roughness: 0.32, metalness: 0.75 }),
  );
  rail.renderOrder = 30;
  rail.castShadow = true;
  return rail;
}

export function createBuilding(
  building: BuildingRecord,
  sampler: TerrainSampler,
  elevationScale: number,
  featureOrdinal = 0,
): THREE.Mesh {
  const outer = building.rings[0] ?? [];
  const shape = new THREE.Shape(outer.map(([east, north]) => new THREE.Vector2(east, north)));
  for (const ring of building.rings.slice(1)) {
    shape.holes.push(new THREE.Path(ring.map(([east, north]) => new THREE.Vector2(east, north))));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: building.height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const east = position.getX(index);
    const north = position.getY(index);
    const raised = position.getZ(index);
    position.setXYZ(index, east, sampler.relative(east, north, elevationScale) + SURFACE_OFFSETS.building + featureOrdinal * FEATURE_OFFSET_STEP + raised, -north);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  const color = building.status?.toLowerCase().includes('budow') ? 0xb28b68 : 0xaaa89e;
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0.02 }),
  );
  mesh.renderOrder = 25;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.building = building;
  return mesh;
}
