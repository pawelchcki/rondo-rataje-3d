import * as THREE from 'three';
import { TRAFFIC_NETWORK, polylineLength, samplePolyline } from './traffic-network.ts';
import type { TrafficSignal } from './traffic-network.ts';
import type { TrafficAgent, TrafficSimulation } from './traffic-simulation.ts';
import type { TerrainSampler } from './terrain.ts';
import type { Point2 } from './types.ts';

interface SignalMaterials {
  red: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
  pedestrianRed: THREE.MeshStandardMaterial;
  pedestrianGreen: THREE.MeshStandardMaterial;
  definition: TrafficSignal;
}

const CAR_COLORS = [0x60717b, 0x8a3f36, 0xc2c0b6, 0x33443e, 0x8a806c, 0x394756, 0x786d72, 0x9b9b91];

function disposeGroup(group: THREE.Group): void {
  for (const object of [...group.children]) {
    group.remove(object);
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
      } else if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      } else if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
  }
}

function formatSeconds(value: number): string {
  return String(Math.floor(value));
}

function roundedRectangle(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

function stripGeometry(points: Point2[], width: number, sampler: TerrainSampler, exaggeration: number, offset: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy) || 1;
    for (const sign of [-1, 1]) {
      const east = point[0] - (dy / length) * width * 0.5 * sign;
      const north = point[1] + (dx / length) * width * 0.5 * sign;
      positions.push(east, sampler.relative(east, north, exaggeration) + offset, -north);
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
  return geometry;
}

function primitiveBox(size: [number, number, number], color: number, position: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.08 }));
  mesh.position.set(...position);
  mesh.castShadow = true;
  return mesh;
}

export class TrafficRenderer {
  readonly group = new THREE.Group();
  private readonly infrastructure = new THREE.Group();
  private readonly agentLayer = new THREE.Group();
  private readonly agentObjects = new Map<string, THREE.Group>();
  private readonly signalMaterials: SignalMaterials[] = [];
  private readonly transitMaterials: Array<{ group: string; red: THREE.MeshStandardMaterial; green: THREE.MeshStandardMaterial }> = [];
  private exaggeration = 1;

  constructor(private readonly sampler: TerrainSampler, private readonly simulation: TrafficSimulation) {
    this.group.name = 'Authored traffic simulation';
    this.infrastructure.name = 'Lane markings and signals';
    this.agentLayer.name = 'Simulated agents';
    this.group.add(this.infrastructure, this.agentLayer);
    this.rebuild(1);
  }

  rebuild(exaggeration: number): void {
    this.exaggeration = exaggeration;
    disposeGroup(this.infrastructure);
    disposeGroup(this.agentLayer);
    this.agentObjects.clear();
    this.signalMaterials.length = 0;
    this.transitMaterials.length = 0;
    this.createMarkings();
    this.createSignals();
    this.createAgentObjects();
  }

  private createMarkings(): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e7d8, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd9b83f, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const addStrip = (points: Point2[], width = 0.16, material = white): void => {
      const strip = new THREE.Mesh(stripGeometry(points, width, this.sampler, this.exaggeration, 0.38), material.clone());
      strip.renderOrder = 46;
      this.infrastructure.add(strip);
    };

    for (const portal of TRAFFIC_NETWORK.portals) {
      const outer = TRAFFIC_NETWORK.lanes.find((lane) => lane.id === portal.inboundLanes[0]);
      const inner = TRAFFIC_NETWORK.lanes.find((lane) => lane.id === portal.inboundLanes[1]);
      const outboundOuter = TRAFFIC_NETWORK.lanes.find((lane) => lane.id === portal.outboundLanes[0]);
      const outboundInner = TRAFFIC_NETWORK.lanes.find((lane) => lane.id === portal.outboundLanes[1]);
      if (outer && inner) this.addDashedSeparator(outer.points, inner.points, white);
      if (outboundOuter && outboundInner) this.addDashedSeparator(outboundOuter.points, outboundInner.points, white);
    }
    for (const laneId of ['roundabout-outer', 'roundabout-inner']) {
      const lane = TRAFFIC_NETWORK.lanes.find((item) => item.id === laneId);
      if (lane) addStrip(lane.points, 0.13);
    }
    const busLane = TRAFFIC_NETWORK.lanes.find((item) => item.id === 'bus-inner-ring');
    if (busLane) addStrip(busLane.points, 0.2, yellow);

    for (const crossing of TRAFFIC_NETWORK.crossings) {
      const start = crossing.points[0];
      const end = crossing.points[1];
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const heading = Math.atan2(end[1] - start[1], end[0] - start[0]);
      for (let distance = 1; distance < length; distance += 1.45) {
        const center = samplePolyline([start, end], distance).point;
        this.addRoadRectangle(center, heading, 0.72, 2.8, 0xe9e7d8, 0.41);
      }
    }
    for (const signal of TRAFFIC_NETWORK.signals) {
      const roadWidth = TRAFFIC_NETWORK.roadSurfaces.find((surface) => surface.id === `${signal.approach}-in`)?.width ?? 10;
      this.addRoadRectangle(signal.position, signal.heading, 0.42, roadWidth, 0xe9e7d8, 0.4);
      const route = TRAFFIC_NETWORK.routes.find((item) => item.mode === 'car' && item.approach === signal.approach && item.turn === 'right');
      const arrowPoint = samplePolyline(route?.points ?? [signal.position], Math.max(0, (route?.stopAt ?? 12) - 12));
      this.addArrow(arrowPoint.point, arrowPoint.heading);
    }
  }

  private addDashedSeparator(a: Point2[], b: Point2[], material: THREE.Material): void {
    const aLength = polylineLength(a);
    const bLength = polylineLength(b);
    const length = Math.min(aLength, bLength);
    for (let start = 4; start < length - 5; start += 8) {
      const end = Math.min(start + 4, length);
      const a0 = samplePolyline(a, start).point;
      const b0 = samplePolyline(b, start).point;
      const a1 = samplePolyline(a, end).point;
      const b1 = samplePolyline(b, end).point;
      const points: Point2[] = [
        [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2],
        [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2],
      ];
      const dash = new THREE.Mesh(stripGeometry(points, 0.15, this.sampler, this.exaggeration, 0.39), material.clone());
      dash.renderOrder = 47;
      this.infrastructure.add(dash);
    }
  }

  private addRoadRectangle(point: Point2, heading: number, length: number, width: number, color: number, offset: number): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.025, width),
      new THREE.MeshStandardMaterial({ color, roughness: 0.86, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 }),
    );
    mesh.position.set(point[0], this.sampler.relative(...point, this.exaggeration) + offset, -point[1]);
    mesh.rotation.y = heading;
    mesh.renderOrder = 48;
    this.infrastructure.add(mesh);
  }

  private addArrow(point: Point2, heading: number): void {
    const group = new THREE.Group();
    group.position.set(point[0], this.sampler.relative(...point, this.exaggeration) + 0.42, -point[1]);
    group.rotation.y = heading;
    const material = new THREE.MeshStandardMaterial({ color: 0xe9e7d8, roughness: 0.85 });
    const stem = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.025, 0.25), material);
    stem.position.x = -0.35;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.7, 3), material.clone());
    head.rotation.z = -Math.PI / 2;
    head.position.x = 1.65;
    group.add(stem, head);
    this.infrastructure.add(group);
  }

  private createSignals(): void {
    for (const definition of TRAFFIC_NETWORK.signals) {
      const heading = definition.heading;
      const side: Point2 = [-Math.sin(heading), Math.cos(heading)];
      const position: Point2 = [definition.position[0] + side[0] * 5.2, definition.position[1] + side[1] * 5.2];
      const ground = this.sampler.relative(...position, this.exaggeration) + 0.4;
      const group = new THREE.Group();
      group.position.set(position[0], ground, -position[1]);
      group.rotation.y = heading;
      const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x45514c, roughness: 0.5, metalness: 0.5 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.3, 7), poleMaterial);
      pole.position.y = 2.15;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.13, 0.13), poleMaterial.clone());
      arm.position.set(2.25, 4.08, 0);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.25, 0.42), new THREE.MeshStandardMaterial({ color: 0x202724, roughness: 0.6 }));
      head.position.set(4.35, 3.62, 0);
      const pedestrianHead = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.82, 0.38), new THREE.MeshStandardMaterial({ color: 0x202724, roughness: 0.6 }));
      pedestrianHead.position.set(0, 2.65, 0);
      const button = primitiveBox([0.18, 0.24, 0.16], 0xd6c14d, [0, 1.2, -0.13]);
      group.add(pole, arm, head, pedestrianHead, button);

      const makeLamp = (color: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: 0x302f2a, emissive: color, emissiveIntensity: 0.03, roughness: 0.35 });
      const red = makeLamp(0xff2d22);
      const amber = makeLamp(0xffad22);
      const green = makeLamp(0x36d66b);
      const pedestrianRed = makeLamp(0xff2d22);
      const pedestrianGreen = makeLamp(0x36d66b);
      for (const [index, material] of [red, amber, green].entries()) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.135, 10, 7), material);
        lamp.position.set(4.35, 3.98 - index * 0.35, -0.22);
        group.add(lamp);
      }
      for (const [index, material] of [pedestrianRed, pedestrianGreen].entries()) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 9, 6), material);
        lamp.position.set(0, 2.84 - index * 0.37, -0.2);
        group.add(lamp);
      }
      group.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = true; });
      this.infrastructure.add(group);
      this.signalMaterials.push({ red, amber, green, pedestrianRed, pedestrianGreen, definition });
    }
    for (const [index, position] of ([[-11, -22], [17, 41]] as Point2[]).entries()) {
      const ground = this.sampler.relative(...position, this.exaggeration) + 0.42;
      const group = new THREE.Group();
      group.position.set(position[0], ground, -position[1]);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 3.2, 7),
        new THREE.MeshStandardMaterial({ color: 0x45514c, roughness: 0.5, metalness: 0.5 }),
      );
      pole.position.y = 1.6;
      const head = primitiveBox([0.4, 0.78, 0.36], 0x202724, [0, 2.75, 0]);
      group.add(pole, head);
      const red = new THREE.MeshStandardMaterial({ color: 0x302f2a, emissive: 0xff2d22, emissiveIntensity: 0.03 });
      const green = new THREE.MeshStandardMaterial({ color: 0x302f2a, emissive: 0xf3f0da, emissiveIntensity: 0.03 });
      for (const [lampIndex, material] of [red, green].entries()) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 9, 6), material);
        lamp.position.set(0, 2.92 - lampIndex * 0.34, -0.2);
        group.add(lamp);
      }
      this.infrastructure.add(group);
      this.transitMaterials.push({ group: `transit-${index + 1}`, red, green });
    }
  }

  private createAgentObjects(): void {
    for (const agent of this.simulation.agents) {
      const object = agent.mode === 'car'
        ? this.createCar(agent)
        : agent.mode === 'bus'
          ? this.createBus()
          : this.createTram();
      this.addAgentLabel(object, agent);
      object.name = `Simulated ${agent.id}`;
      this.agentObjects.set(agent.id, object);
      this.agentLayer.add(object);
    }
  }

  private addAgentLabel(group: THREE.Group, agent: TrafficAgent): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 112;
    const context = canvas.getContext('2d');
    if (!context) return;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: true, sizeAttenuation: false });
    const sprite = new THREE.Sprite(material);
    const height = agent.mode === 'car' ? 2.55 : agent.mode === 'bus' ? 4.25 : 4.75;
    const width = agent.mode === 'tram' ? 0.105 : agent.mode === 'bus' ? 0.065 : 0.055;
    sprite.position.set(0, height, 0);
    sprite.scale.set(width, width * (canvas.height / canvas.width), 1);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 200;
    sprite.userData.agentLabel = { canvas, context, texture, text: '' };
    group.add(sprite);
    this.updateAgentLabel(sprite, agent);
  }

  private updateAgentLabel(sprite: THREE.Sprite, agent: TrafficAgent): void {
    const label = sprite.userData.agentLabel as {
      canvas: HTMLCanvasElement;
      context: CanvasRenderingContext2D;
      texture: THREE.CanvasTexture;
      text: string;
    } | undefined;
    if (!label) return;
    const visible = formatSeconds(agent.visibleSeconds);
    const text = agent.mode === 'tram'
      ? `${visible} s · światła ${agent.signalWaitCount}× / ${formatSeconds(agent.signalWaitSeconds)} s · ~${agent.passengerCount} os.`
      : `${visible} s · ~${agent.passengerCount} os.`;
    if (label.text === text) return;
    label.text = text;
    const { canvas, context } = label;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(27, 35, 31, 0.88)';
    roundedRectangle(context, 6, 6, canvas.width - 12, canvas.height - 12, 22);
    context.fillStyle = agent.mode === 'tram' ? '#f0d74b' : agent.mode === 'bus' ? '#9dd89a' : '#f3f2e8';
    context.font = '600 44px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 1, canvas.width - 34);
    label.texture.needsUpdate = true;
  }

  private createCar(agent: TrafficAgent): THREE.Group {
    const group = new THREE.Group();
    const color = CAR_COLORS[agent.colorIndex % CAR_COLORS.length];
    group.add(primitiveBox([4.15, 0.72, 1.78], color, [0, 0.58, 0]));
    const cabin = primitiveBox([2.2, 0.67, 1.5], 0x7f9698, [-0.2, 1.23, 0]);
    group.add(cabin);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x202422, roughness: 0.9 });
    for (const x of [-1.25, 1.25]) for (const z of [-0.9, 0.9]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 10), wheelMaterial);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.36, z);
      group.add(wheel);
    }
    const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e2bd, emissive: 0xffe9a8, emissiveIntensity: 1.4 });
    for (const z of [-0.58, 0.58]) group.add(primitiveBox([0.08, 0.18, 0.25], lightMaterial.color.getHex(), [2.1, 0.65, z]));
    this.addIndicators(group, 2.12, 0.82);
    return group;
  }

  private createBus(): THREE.Group {
    const group = new THREE.Group();
    group.add(primitiveBox([11.5, 2.65, 2.45], 0x4e9b59, [0, 1.55, 0]));
    group.add(primitiveBox([10.4, 0.54, 2.49], 0xe0c534, [-0.25, 1.1, 0]));
    const windows = primitiveBox([9.8, 0.72, 2.52], 0x344e55, [-0.38, 2.15, 0]);
    group.add(windows);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x202422, roughness: 0.9 });
    for (const x of [-3.7, 3.7]) for (const z of [-1.23, 1.23]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 12), wheelMaterial);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.5, z);
      group.add(wheel);
    }
    this.addIndicators(group, 5.78, 1.14);
    return group;
  }

  private addIndicators(group: THREE.Group, x: number, z: number): void {
    for (const side of [-1, 1] as const) {
      const material = new THREE.MeshStandardMaterial({ color: 0x7a5520, emissive: 0xff9d22, emissiveIntensity: 2.6, roughness: 0.35 });
      for (const end of [-1, 1]) {
        const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.19), material);
        indicator.position.set(x * end, 0.68, z * side);
        indicator.userData.indicatorSide = side < 0 ? 'left' : 'right';
        group.add(indicator);
      }
    }
  }

  private createTram(): THREE.Group {
    const group = new THREE.Group();
    group.add(primitiveBox([18.5, 2.8, 2.35], 0x4b9557, [0, 1.72, 0]));
    group.add(primitiveBox([17.8, 0.5, 2.39], 0xe0c534, [0, 1.15, 0]));
    group.add(primitiveBox([16.5, 0.78, 2.42], 0x344e55, [-0.2, 2.32, 0]));
    const roof = primitiveBox([13, 0.18, 1.65], 0xc2c1b7, [-0.5, 3.2, 0]);
    group.add(roof);
    const pantograph = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2.2, 0.8, 0.05)),
      new THREE.LineBasicMaterial({ color: 0x353d39 }),
    );
    pantograph.position.set(0, 3.72, 0);
    pantograph.rotation.z = 0.35;
    group.add(pantograph);
    return group;
  }

  sync(): void {
    if (this.agentObjects.size !== this.simulation.agents.length || this.simulation.agents.some((agent) => !this.agentObjects.has(agent.id))) {
      disposeGroup(this.agentLayer);
      this.agentObjects.clear();
      this.createAgentObjects();
    }
    for (const agent of this.simulation.agents) {
      const object = this.agentObjects.get(agent.id);
      if (!object) continue;
      const pose = this.simulation.pose(agent);
      const ground = this.sampler.relative(...pose.point, this.exaggeration);
      object.position.set(pose.point[0], ground + 0.42, -pose.point[1]);
      object.rotation.y = pose.heading;
      object.scale.setScalar(pose.scale);
      const indicatorSide = agent.turn === 'right' ? 'right' : agent.turn === 'left' || agent.turn === 'u-turn' ? 'left' : undefined;
      const indicatorOn = Math.floor(this.simulation.elapsed * 2) % 2 === 0;
      object.traverse((child) => {
        if (child.userData.indicatorSide) child.visible = child.userData.indicatorSide === indicatorSide && indicatorOn;
        if (child instanceof THREE.Sprite && child.userData.agentLabel) this.updateAgentLabel(child, agent);
      });
    }
    for (const materials of this.signalMaterials) {
      const vehicle = this.simulation.vehicleSignal(materials.definition.vehicleGroup);
      materials.red.emissiveIntensity = vehicle === 'red' ? 3.2 : 0.03;
      materials.amber.emissiveIntensity = vehicle === 'amber' ? 3.2 : 0.03;
      materials.green.emissiveIntensity = vehicle === 'green' ? 3.2 : 0.03;
      const pedestrian = this.simulation.pedestrianSignal(materials.definition.pedestrianGroup);
      materials.pedestrianRed.emissiveIntensity = pedestrian === 'stop' ? 3.2 : 0.03;
      materials.pedestrianGreen.emissiveIntensity = pedestrian !== 'stop' ? 3.2 : 0.03;
    }
    for (const materials of this.transitMaterials) {
      const signal = this.simulation.vehicleSignal(materials.group);
      materials.red.emissiveIntensity = signal === 'red' ? 3.2 : 0.03;
      materials.green.emissiveIntensity = signal === 'green' ? 3.2 : 0.03;
    }
  }
}
