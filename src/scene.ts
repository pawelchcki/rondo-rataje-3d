import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FEATURE_OFFSET_STEP, SURFACE_OFFSETS, createBuilding, createLandCover, createRail, createRibbon } from './geometry.ts';
import { TerrainSampler, createTerrain } from './terrain.ts';
import { TrafficRenderer } from './traffic-renderer.ts';
import { TRAFFIC_NETWORK } from './traffic-network.ts';
import { TrafficSimulation } from './traffic-simulation.ts';
import { RATAJE_DEMAND_DATASET } from './traffic-simulation.ts';
import type { AgentCounts, DemandProfile, PedestrianGroupState, TrafficDensity, TramPriorityMode } from './traffic-simulation.ts';
import type { BuildingRecord, SceneManifest, TransitStopRecord, TransportFeature, TreeKind, TreeRecord } from './types.ts';

type LayerName = 'terrain' | 'transport' | 'buildings' | 'stations' | 'trees' | 'traffic';

export interface SceneApi {
  ready: boolean;
  terrainVertices: number;
  treeInstances: number;
  stationShelters: number;
  trafficReady: boolean;
  readonly trafficPaused: boolean;
  readonly trafficVisible: boolean;
  readonly trafficDensity: TrafficDensity;
  readonly demandProfile: DemandProfile;
  readonly demandDataset: typeof RATAJE_DEMAND_DATASET;
  readonly activeAgentCounts: AgentCounts;
  readonly simulationTime: number;
  readonly activeSignalGroups: string[];
  readonly trafficSignals: Record<string, 'red' | 'amber' | 'green' | 'stop' | 'walk' | 'clearance'>;
  readonly trafficSignalCrossings: number;
  readonly trafficRedLightViolations: number;
  readonly tramPriorityMode: TramPriorityMode;
  readonly tramSignalWaitingSeconds: number;
  readonly pedestrianDemandEnabled: boolean;
  readonly pedestrianQueues: PedestrianGroupState[];
  readonly activePedestrianGroups: string[];
  readonly servedPedestrians: number;
  readonly totalTransitPassengers: number;
  readonly passengerBoardings: number;
  readonly passengerAlightings: number;
  readonly vehicleDelaySeconds: number;
  readonly pedestrianConflictDelaySeconds: number;
  readonly trafficTelemetry: Array<{
    id: string;
    mode: 'car' | 'bus' | 'tram';
    visibleSeconds: number;
    signalWaitSeconds: number;
    signalWaitCount: number;
    passengers: number;
    passengerCapacity: number;
    dwellSeconds: number;
    dwellCount: number;
    boarded: number;
    alighted: number;
    initialPassengers: number;
    delaySeconds: number;
  }>;
  setLayer(name: LayerName, visible: boolean): void;
  setView(name: 'oblique' | 'top'): void;
  setExaggeration(value: 1 | 3): void;
  setTrafficPaused(paused: boolean): void;
  setTrafficVisible(visible: boolean): void;
  setTrafficDensity(density: TrafficDensity): void;
  setDemandProfile(profile: DemandProfile): void;
  setPedestrianDemand(enabled: boolean): void;
  setTramPriorityMode(mode: TramPriorityMode): void;
  resetTraffic(seed?: number): void;
  stepTraffic(seconds: number): void;
}

declare global {
  interface Window {
    __RONDO_RATAJE__?: SceneApi;
  }
}

const TREE_COLORS: Record<TreeKind, number> = {
  broadleaf: 0x476d46,
  conifer: 0x365c4a,
  unknown: 0x63765a,
};

const TREE_KIND_LABELS: Record<TreeKind, string> = {
  broadleaf: 'drzewo liściaste',
  conifer: 'drzewo iglaste',
  unknown: 'nierozpoznany gatunek',
};

const TRANSPORT_LABELS: Record<TransportFeature['kind'], string> = {
  road: 'droga',
  path: 'ciąg pieszy',
  cycleway: 'droga rowerowa',
  tram: 'torowisko tramwajowe',
};

const METRES = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function clearGroup(group: THREE.Group): void {
  for (const object of [...group.children]) {
    group.remove(object);
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      }
    });
  }
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export class RatajeScene {
  readonly api: SceneApi;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.2, 1600);
  private readonly controls: OrbitControls;
  private readonly terrainLayer = new THREE.Group();
  private readonly transportLayer = new THREE.Group();
  private readonly buildingLayer = new THREE.Group();
  private readonly stationLayer = new THREE.Group();
  private readonly treeLayer = new THREE.Group();
  private readonly trafficSimulation = new TrafficSimulation();
  private readonly trafficRenderer: TrafficRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly hoverTargets: THREE.Object3D[] = [];
  private readonly sampler: TerrainSampler;
  private elevationScale: 1 | 3 = 1;
  private animationFrame = 0;
  private previousFrameTime = performance.now();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly details: HTMLElement,
    private readonly manifest: SceneManifest,
    heights: Float32Array,
  ) {
    this.sampler = new TerrainSampler(manifest.terrain, heights);
    this.trafficRenderer = new TrafficRenderer(this.sampler, this.trafficSimulation);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0xe7e5dc);
    this.scene.fog = new THREE.Fog(0xe7e5dc, 450, 920);
    this.scene.add(this.terrainLayer, this.transportLayer, this.buildingLayer, this.stationLayer, this.treeLayer, this.trafficRenderer.group);
    this.addLighting();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 45;
    this.controls.maxDistance = 820;
    this.controls.maxPolarAngle = Math.PI / 2.02;
    this.controls.target.set(0, 3, 0);
    this.setView('oblique');

    this.rebuildLayers();
    this.resize();
    window.addEventListener('resize', this.resize);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.hideDetails);

    const map = this;
    this.api = {
      ready: true,
      terrainVertices: (this.terrainLayer.children[0] as THREE.Mesh).geometry.getAttribute('position').count,
      treeInstances: manifest.trees.length,
      stationShelters: manifest.stations.length,
      trafficReady: true,
      get trafficPaused() { return map.trafficSimulation.paused; },
      get trafficVisible() { return map.trafficRenderer.group.visible; },
      get trafficDensity() { return map.trafficSimulation.density; },
      get demandProfile() { return map.trafficSimulation.demandProfile; },
      demandDataset: RATAJE_DEMAND_DATASET,
      get activeAgentCounts() { return map.trafficSimulation.counts; },
      get simulationTime() { return map.trafficSimulation.elapsed; },
      get activeSignalGroups() { return map.trafficSimulation.greenGroups(); },
      get trafficSignals() {
        return Object.fromEntries([
          ...Object.keys(TRAFFIC_NETWORK.movementConflicts)
            .filter((group) => group.startsWith('vehicle-') || group.startsWith('transit-'))
            .map((group) => [group, map.trafficSimulation.vehicleSignal(group)] as const),
          ...map.trafficSimulation.pedestrianTelemetry.map((group) => [group.id, group.signal] as const),
        ]);
      },
      get trafficSignalCrossings() { return map.trafficSimulation.signalCrossings; },
      get trafficRedLightViolations() { return map.trafficSimulation.redLightViolations; },
      get tramPriorityMode() { return map.trafficSimulation.tramPriority; },
      get tramSignalWaitingSeconds() { return map.trafficSimulation.tramSignalWaitingSeconds; },
      get pedestrianDemandEnabled() { return map.trafficSimulation.pedestrianDemandEnabled; },
      get pedestrianQueues() { return map.trafficSimulation.pedestrianTelemetry; },
      get activePedestrianGroups() { return map.trafficSimulation.pedestrianTelemetry.filter((group) => group.signal !== 'stop').map((group) => group.id); },
      get servedPedestrians() { return map.trafficSimulation.pedestrianTelemetry.reduce((sum, group) => sum + group.served, 0); },
      get totalTransitPassengers() { return map.trafficSimulation.totalTransitPassengers; },
      get passengerBoardings() { return map.trafficSimulation.passengerBoardings; },
      get passengerAlightings() { return map.trafficSimulation.passengerAlightings; },
      get vehicleDelaySeconds() { return map.trafficSimulation.vehicleDelaySeconds; },
      get pedestrianConflictDelaySeconds() { return map.trafficSimulation.pedestrianConflictDelaySeconds; },
      get trafficTelemetry() {
        return map.trafficSimulation.agents.map((agent) => ({
          id: agent.id,
          mode: agent.mode,
          visibleSeconds: agent.visibleSeconds,
          signalWaitSeconds: agent.signalWaitSeconds,
          signalWaitCount: agent.signalWaitCount,
          passengers: agent.passengerCount,
          passengerCapacity: agent.passengerCapacity,
          dwellSeconds: agent.lastDwellSeconds,
          dwellCount: agent.dwellCount,
          boarded: agent.boardedPassengers,
          alighted: agent.alightedPassengers,
          initialPassengers: agent.initialPassengerCount,
          delaySeconds: agent.delaySeconds,
        }));
      },
      setLayer: (name, visible) => this.setLayer(name, visible),
      setView: (name) => this.setView(name),
      setExaggeration: (value) => this.setExaggeration(value),
      setTrafficPaused: (paused) => this.trafficSimulation.setPaused(paused),
      setTrafficVisible: (visible) => this.setLayer('traffic', visible),
      setTrafficDensity: (density) => this.trafficSimulation.setDensity(density),
      setDemandProfile: (profile) => this.trafficSimulation.setDemandProfile(profile),
      setPedestrianDemand: (enabled) => this.trafficSimulation.setPedestrianDemand(enabled),
      setTramPriorityMode: (mode) => this.trafficSimulation.setTramPriority(mode),
      resetTraffic: (seed) => this.trafficSimulation.reset(seed),
      stepTraffic: (seconds) => {
        for (let remaining = Math.max(0, seconds); remaining > 0; remaining -= 1 / 60) this.trafficSimulation.advance(Math.min(1 / 60, remaining));
        this.trafficRenderer.sync();
      },
    };
    window.__RONDO_RATAJE__ = this.api;
    document.documentElement.dataset.sceneReady = 'true';
    this.render();
  }

  private readonly resize = (): void => {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private addLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xf4f3e9, 0x6f7567, 2.1);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff3d8, 3.2);
    sun.position.set(-95, 180, 105);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -250;
    sun.shadow.camera.right = 250;
    sun.shadow.camera.top = 250;
    sun.shadow.camera.bottom = -250;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
  }

  private rebuildLayers(): void {
    this.hoverTargets.length = 0;
    clearGroup(this.terrainLayer);
    clearGroup(this.transportLayer);
    clearGroup(this.buildingLayer);
    clearGroup(this.stationLayer);
    clearGroup(this.treeLayer);

    const terrain = createTerrain(this.manifest, this.sampler);
    if (this.elevationScale === 3) {
      const attribute = terrain.surface.geometry.getAttribute('position');
      for (let index = 0; index < attribute.count; index += 1) attribute.setY(index, attribute.getY(index) * 3);
      attribute.needsUpdate = true;
      terrain.surface.geometry.computeVertexNormals();
      const skirtAttribute = terrain.skirt.geometry.getAttribute('position');
      for (let index = 0; index < skirtAttribute.count; index += 1) {
        if (skirtAttribute.getY(index) > -4.9) skirtAttribute.setY(index, skirtAttribute.getY(index) * 3);
      }
      skirtAttribute.needsUpdate = true;
      terrain.skirt.geometry.computeVertexNormals();
    }
    this.terrainLayer.add(terrain.surface, terrain.skirt);

    for (const [featureOrdinal, feature] of this.manifest.landCover.entries()) {
      const mesh = createLandCover(feature, this.sampler, this.elevationScale, featureOrdinal);
      this.transportLayer.add(mesh);
      this.hoverTargets.push(mesh);
    }
    for (const [featureOrdinal, feature] of this.manifest.transport.entries()) {
      const ribbon = createRibbon(feature, this.sampler, this.elevationScale, featureOrdinal);
      this.transportLayer.add(ribbon);
      this.hoverTargets.push(ribbon);
      if (feature.kind === 'tram') {
        const gauge = Math.min(1.435, Math.max(0.8, feature.width * 0.26));
        this.transportLayer.add(
          createRail(feature.coordinates, -gauge / 2, this.sampler, this.elevationScale, featureOrdinal),
          createRail(feature.coordinates, gauge / 2, this.sampler, this.elevationScale, featureOrdinal),
        );
      }
    }
    for (const [featureOrdinal, building] of this.manifest.buildings.entries()) {
      const mesh = createBuilding(building, this.sampler, this.elevationScale, featureOrdinal);
      this.buildingLayer.add(mesh);
      this.hoverTargets.push(mesh);
    }
    this.createStations();
    this.createTrees();
    this.trafficRenderer.rebuild(this.elevationScale);
  }

  private createStations(): void {
    const steelMaterial = new THREE.MeshStandardMaterial({ color: 0x4d6964, roughness: 0.5, metalness: 0.5 });
    const blueSteelMaterial = new THREE.MeshStandardMaterial({ color: 0x263f5b, roughness: 0.46, metalness: 0.58 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0xb5c6bd, roughness: 0.58, metalness: 0.22, side: THREE.DoubleSide });
    const stationRoofMaterial = new THREE.MeshStandardMaterial({ color: 0xd9e0dc, roughness: 0.45, metalness: 0.08, transparent: true, opacity: 0.78, side: THREE.DoubleSide });
    const glassMaterial = new THREE.MeshStandardMaterial({ color: 0xb9d4ce, roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0xc8c3b5, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x4b504f, roughness: 0.96, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const benchMaterial = new THREE.MeshStandardMaterial({ color: 0x6f6559, roughness: 0.86 });
    const signMaterial = new THREE.MeshStandardMaterial({ color: 0x397b9b, roughness: 0.7 });
    const displayMaterial = new THREE.MeshStandardMaterial({ color: 0x283532, roughness: 0.48, metalness: 0.25 });
    const busStations: Array<[number, TransitStopRecord]> = [];
    for (const [featureOrdinal, station] of this.manifest.stations.entries()) {
      if (/dworzec/i.test(`${station.name} ${station.note ?? ''}`)) {
        busStations.push([featureOrdinal, station]);
        continue;
      }
      const [east, north] = station.position;
      const ground = this.sampler.relative(east, north, this.elevationScale);
      const length = 5.2;
      const depth = 2.15;
      const group = new THREE.Group();
      group.name = 'wiata przystankowa';
      group.position.set(east, ground + SURFACE_OFFSETS.station + featureOrdinal * FEATURE_OFFSET_STEP, -north);
      group.rotation.y = this.nearestTransportAngle(east, north);
      group.userData.station = station;

      const platform = new THREE.Mesh(new THREE.BoxGeometry(length + 0.6, 0.1, depth + 0.5), platformMaterial);
      platform.position.y = 0.05;
      platform.receiveShadow = true;
      platform.renderOrder = 40;
      group.add(platform);

      for (const x of [-length * 0.42, length * 0.42]) {
        for (const z of [-depth * 0.36, depth * 0.36]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.75, 0.12), steelMaterial);
          post.position.set(x, 1.43, z);
          post.castShadow = true;
          group.add(post);
        }
      }

      const roof = new THREE.Mesh(new THREE.BoxGeometry(length, 0.16, depth), roofMaterial);
      roof.position.y = 2.9;
      roof.rotation.z = -0.025;
      const accent = new THREE.Mesh(new THREE.BoxGeometry(length + 0.08, 0.12, 0.12), steelMaterial);
      accent.position.set(0, 2.82, -depth * 0.48);
      group.add(accent);
      roof.castShadow = true;
      group.add(roof);

      const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(length * 0.72, 1.75, 0.045), glassMaterial);
      rearGlass.position.set(0, 1.45, depth * 0.37);
      group.add(rearGlass);
      for (const x of [-length * 0.36, length * 0.36]) {
        const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.75, depth * 0.62), glassMaterial);
        sideGlass.position.set(x, 1.45, 0.04);
        group.add(sideGlass);
      }

      const bench = new THREE.Mesh(new THREE.BoxGeometry(length * 0.46, 0.14, 0.48), benchMaterial);
      bench.position.set(0, 0.65, depth * 0.2);
      bench.castShadow = true;
      group.add(bench);
      for (const x of [-length * 0.18, length * 0.18]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.58, 0.1), steelMaterial);
        leg.position.set(x, 0.36, depth * 0.2);
        group.add(leg);
      }

      const signX = length * 0.5 + 0.48;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.75, 7), steelMaterial);
      pole.position.set(signX, 1.42, 0);
      pole.castShadow = true;
      group.add(pole);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.12), signMaterial);
      sign.position.set(signX, 2.58, 0);
      sign.castShadow = true;
      group.add(sign);

      const display = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.25, 0.14), displayMaterial);
      display.position.set(-length * 0.29, 1.55, -depth * 0.34);
      group.add(display);

      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.userData.station = station;
        this.hoverTargets.push(child);
      });
      this.stationLayer.add(group);
    }

    if (busStations.length > 0) {
      const terminalRecord = busStations.find(([, station]) => /dworzec/i.test(station.note ?? ''))?.[1] ?? busStations[0][1];
      const east = busStations.reduce((sum, [, station]) => sum + station.position[0], 0) / busStations.length;
      const north = busStations.reduce((sum, [, station]) => sum + station.position[1], 0) / busStations.length;
      const first = busStations[0][1].position;
      const last = busStations.at(-1)?.[1].position ?? first;
      const terminalAngle = Math.atan2(last[1] - first[1], last[0] - first[0]);
      const ground = this.sampler.relative(east, north, this.elevationScale);
      const group = new THREE.Group();
      group.name = 'zadaszenia dworca autobusowego Rataje';
      group.position.set(east, ground + SURFACE_OFFSETS.station + busStations[0][0] * FEATURE_OFFSET_STEP, -north);
      group.rotation.y = terminalAngle;
      group.userData.station = terminalRecord;

      const createBarrelRoof = (width: number, length: number, rise: number, along: 'x' | 'z'): THREE.BufferGeometry => {
        const segments = 12;
        const positions: number[] = [];
        const indices: number[] = [];
        for (const end of [-0.5, 0.5]) {
          for (let segment = 0; segment <= segments; segment += 1) {
            const progress = segment / segments;
            const cross = (progress - 0.5) * width;
            const height = Math.sin(progress * Math.PI) * rise;
            positions.push(along === 'z' ? cross : end * length, height, along === 'z' ? end * length : cross);
          }
        }
        for (let segment = 0; segment < segments; segment += 1) {
          const nextRow = segments + 1;
          indices.push(segment, nextRow + segment, nextRow + segment + 1, segment, nextRow + segment + 1, segment + 1);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
      };

      const apron = new THREE.Mesh(new THREE.BoxGeometry(56, 0.1, 40), asphaltMaterial);
      apron.position.y = 0.05;
      apron.receiveShadow = true;
      apron.renderOrder = 40;
      group.add(apron);

      const bayCount = 6;
      const baySpacing = 8.6;
      const bayWidth = 4.9;
      const bayLength = 34;
      const roofBase = 3.05;
      for (let bay = 0; bay < bayCount; bay += 1) {
        const x = (bay - (bayCount - 1) / 2) * baySpacing;
        const platform = new THREE.Mesh(new THREE.BoxGeometry(bayWidth, 0.16, bayLength), platformMaterial);
        platform.position.set(x, 0.13, 0);
        platform.receiveShadow = true;
        group.add(platform);

        const roof = new THREE.Mesh(createBarrelRoof(bayWidth + 0.7, bayLength, 0.9, 'z'), stationRoofMaterial);
        roof.position.set(x, roofBase, 0);
        roof.castShadow = true;
        group.add(roof);

        for (const z of [-15, -10, -5, 0, 5, 10, 15]) {
          for (const side of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, roofBase, 0.15), blueSteelMaterial);
            post.position.set(x + side * (bayWidth + 0.45) / 2, roofBase / 2, z);
            post.castShadow = true;
            group.add(post);
          }
          const arcPoints = Array.from({ length: 9 }, (_, index) => {
            const progress = index / 8;
            return new THREE.Vector3(x + (progress - 0.5) * (bayWidth + 0.7), roofBase + Math.sin(progress * Math.PI) * 0.9, z);
          });
          const rib = new THREE.Mesh(
            new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPoints), 16, 0.075, 5, false),
            blueSteelMaterial,
          );
          group.add(rib);
        }

        const numberBoard = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.1), signMaterial);
        numberBoard.position.set(x, 2.55, -14.7);
        group.add(numberBoard);
      }

      const crossAisleRoof = new THREE.Mesh(
        createBarrelRoof(4.4, (bayCount - 1) * baySpacing + bayWidth + 1, 0.72, 'x'),
        stationRoofMaterial,
      );
      crossAisleRoof.position.set(0, roofBase + 0.12, 0);
      crossAisleRoof.castShadow = true;
      group.add(crossAisleRoof);
      for (const x of [-23.5, -17, -10, -3, 4, 11, 18, 23.5]) {
        for (const z of [-2.1, 2.1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, roofBase, 0.14), blueSteelMaterial);
          post.position.set(x, roofBase / 2, z);
          group.add(post);
        }
      }

      const centralDisplay = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.25, 0.2), displayMaterial);
      centralDisplay.position.set(0, 2.1, 1.8);
      group.add(centralDisplay);
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.userData.station = terminalRecord;
        this.hoverTargets.push(child);
      });
      this.stationLayer.add(group);
    }
  }

  private nearestTransportAngle(east: number, north: number): number {
    let nearestDistance = Number.POSITIVE_INFINITY;
    let angle = 0;
    for (const feature of this.manifest.transport) {
      if (feature.kind !== 'road' && feature.kind !== 'tram') continue;
      for (let index = 1; index < feature.coordinates.length; index += 1) {
        const [ax, ay] = feature.coordinates[index - 1];
        const [bx, by] = feature.coordinates[index];
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared === 0) continue;
        const t = THREE.MathUtils.clamp(((east - ax) * dx + (north - ay) * dy) / lengthSquared, 0, 1);
        const distance = Math.hypot(east - (ax + dx * t), north - (ay + dy * t));
        if (distance < nearestDistance) {
          nearestDistance = distance;
          angle = Math.atan2(dy, dx);
        }
      }
    }
    return angle;
  }

  private createTrees(): void {
    const byKind = new Map<TreeKind, TreeRecord[]>();
    for (const kind of ['broadleaf', 'conifer', 'unknown'] as const) byKind.set(kind, []);
    for (const tree of this.manifest.trees) byKind.get(tree.kind)?.push(tree);

    const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.72, 1, 6);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x665444, roughness: 1 });
    const transform = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    for (const [kind, trees] of byKind) {
      if (trees.length === 0) continue;
      const crownGeometry = kind === 'conifer'
        ? new THREE.ConeGeometry(0.5, 1, 7, 3)
        : new THREE.IcosahedronGeometry(0.5, 1);
      const crownMaterial = new THREE.MeshStandardMaterial({ color: TREE_COLORS[kind], roughness: 0.92, flatShading: true });
      const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
      const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length);
      trunks.castShadow = true;
      trunks.receiveShadow = true;
      crowns.castShadow = true;
      crowns.receiveShadow = true;
      crowns.userData.trees = trees;
      trunks.userData.trees = trees;

      trees.forEach((tree, index) => {
        const [east, north] = tree.position;
        const ground = this.sampler.relative(east, north, this.elevationScale);
        const variance = 0.88 + stableUnit(tree.id) * 0.24;
        const trunkHeight = Math.max(1.2, tree.height * (kind === 'conifer' ? 0.26 : 0.34));
        const trunkRadius = Math.max(0.14, Math.min(0.48, tree.height * 0.025));
        position.set(east, ground + trunkHeight / 2, -north);
        scale.set(trunkRadius, trunkHeight, trunkRadius);
        transform.compose(position, quaternion, scale);
        trunks.setMatrixAt(index, transform);

        const crownHeight = Math.max(1.6, tree.height - trunkHeight * 0.55);
        const crownWidth = Math.max(1.3, Math.min(tree.height * 0.56, 7.8)) * variance;
        position.set(east, ground + trunkHeight + crownHeight * 0.42, -north);
        scale.set(crownWidth, crownHeight, crownWidth);
        transform.compose(position, quaternion, scale);
        crowns.setMatrixAt(index, transform);
      });
      this.treeLayer.add(trunks, crowns);
      this.hoverTargets.push(crowns, trunks);
    }
  }

  setLayer(name: LayerName, visible: boolean): void {
    ({
      terrain: this.terrainLayer,
      transport: this.transportLayer,
      buildings: this.buildingLayer,
      stations: this.stationLayer,
      trees: this.treeLayer,
      traffic: this.trafficRenderer.group,
    })[name].visible = visible;
  }

  setExaggeration(value: 1 | 3): void {
    if (this.elevationScale === value) return;
    this.elevationScale = value;
    const visibility = [this.terrainLayer.visible, this.transportLayer.visible, this.buildingLayer.visible, this.stationLayer.visible, this.treeLayer.visible, this.trafficRenderer.group.visible];
    this.rebuildLayers();
    [this.terrainLayer.visible, this.transportLayer.visible, this.buildingLayer.visible, this.stationLayer.visible, this.treeLayer.visible, this.trafficRenderer.group.visible] = visibility;
  }

  setView(name: 'oblique' | 'top'): void {
    if (name === 'top') {
      this.camera.position.set(0, 560, 0.01);
      this.camera.up.set(0, 0, -1);
    } else {
      this.camera.position.set(300, 275, 340);
      this.camera.up.set(0, 1, 0);
    }
    this.controls?.target.set(0, 3, 0);
    this.camera.lookAt(0, 3, 0);
    this.controls?.update();
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.hoverTargets, false)[0];
    if (!hit) {
      this.hideDetails();
      return;
    }
    const trees = hit.object.userData.trees as TreeRecord[] | undefined;
    if (trees && hit.instanceId !== undefined) {
      const tree = trees[hit.instanceId];
      const species = tree.species ?? 'Nierozpoznane drzewo';
      this.details.innerHTML = `<strong>${species}</strong><em>${tree.speciesLatin ?? TREE_KIND_LABELS[tree.kind]}</em><dl><div><dt>Wysokość</dt><dd>${METRES.format(tree.height)} m</dd></div><div><dt>Status</dt><dd>${tree.status ?? '—'}</dd></div><div><dt>Pomiar</dt><dd>${tree.survey ?? '—'}</dd></div></dl>`;
    } else if (hit.object.userData.building) {
      const building = hit.object.userData.building as BuildingRecord;
      this.details.innerHTML = `<strong>${building.name ?? building.function ?? 'Budynek'}</strong><em>${building.sourceLayer}</em><dl><div><dt>Funkcja</dt><dd>${building.function ?? '—'}</dd></div><div><dt>Kondygnacje</dt><dd>${building.levels ?? '—'}</dd></div><div><dt>Wysokość modelu</dt><dd>${METRES.format(building.height)} m</dd></div></dl>`;
    } else if (hit.object.userData.station) {
      const station = hit.object.userData.station as TransitStopRecord;
      this.details.innerHTML = `<strong>${station.name}</strong><em>${station.sourceLayer}</em><dl><div><dt>Klasa</dt><dd>Przystanek transportu zbiorowego</dd></div><div><dt>Status</dt><dd>${station.status ?? '—'}</dd></div><div><dt>Uwagi</dt><dd>${station.note ?? '—'}</dd></div></dl>`;
    } else {
      const feature = hit.object.userData.feature as TransportFeature | undefined;
      if (!feature) return;
      this.details.innerHTML = `<strong>${feature.name ?? TRANSPORT_LABELS[feature.kind]}</strong><em>${feature.sourceLayer}</em><dl><div><dt>Klasa</dt><dd>${TRANSPORT_LABELS[feature.kind]}</dd></div><div><dt>Szerokość</dt><dd>${METRES.format(feature.width)} m</dd></div></dl>`;
    }
    this.details.hidden = false;
    this.details.style.left = `${Math.min(event.clientX + 18, window.innerWidth - 260)}px`;
    this.details.style.top = `${Math.min(event.clientY + 18, window.innerHeight - 170)}px`;
    this.canvas.style.cursor = 'crosshair';
  }

  private readonly hideDetails = (): void => {
    this.details.hidden = true;
    this.canvas.style.cursor = 'grab';
  }

  private readonly render = (): void => {
    const frameTime = performance.now();
    this.trafficSimulation.advance(Math.min(0.1, (frameTime - this.previousFrameTime) / 1000));
    this.previousFrameTime = frameTime;
    this.trafficRenderer.sync();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.render);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.hideDetails);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
