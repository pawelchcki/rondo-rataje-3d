import { TRAFFIC_NETWORK, polylineLength, samplePolyline } from './traffic-network.ts';
import type { ApproachId, TrafficMode, TrafficRoute, TurnKind } from './traffic-network.ts';
import type { Point2 } from './types.ts';

export type TrafficDensity = 'low' | 'medium' | 'high';
export type VehicleSignalState = 'red' | 'amber' | 'green';
export type PedestrianSignalState = 'stop' | 'walk' | 'clearance';

export interface TrafficAgent {
  id: string;
  mode: TrafficMode;
  routeId: string;
  route: TrafficRoute;
  distance: number;
  speed: number;
  desiredSpeed: number;
  scale: number;
  spawnAge: number;
  length: number;
  colorIndex: number;
  turn: TurnKind;
  dwellRemaining: number;
  hasDwelled: boolean;
  priorityRequest: boolean;
}

export interface AgentPose {
  point: Point2;
  heading: number;
  scale: number;
}

export interface AgentCounts {
  cars: number;
  buses: number;
  trams: number;
}

const TARGETS: Record<TrafficDensity, AgentCounts> = {
  low: { cars: 18, buses: 2, trams: 1 },
  medium: { cars: 40, buses: 4, trams: 2 },
  high: { cars: 70, buses: 7, trams: 3 },
};

const APPROACH_ORDER: ApproachId[] = ['north-east', 'south-east', 'south-west', 'north-west'];
const FIXED_STEP = 1 / 30;

class SeededRandom {
  constructor(private state: number) {}

  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
}

function modeLength(mode: TrafficMode): number {
  if (mode === 'tram') return 19;
  if (mode === 'bus') return 11.5;
  return 4.2;
}

function signalApproach(group: string): ApproachId | undefined {
  return APPROACH_ORDER.find((approach) => group === `vehicle-${approach}` || group === `ped-${approach}`);
}

export class TrafficSimulation {
  readonly agents: TrafficAgent[] = [];
  density: TrafficDensity = 'medium';
  paused = false;
  elapsed = 0;
  private accumulator = 0;
  private activeApproachIndex = 0;
  private signalStage: 'green' | 'amber' | 'all-red' = 'green';
  private stageElapsed = 0;
  private greenDuration = 12;
  private seed = 2180;

  constructor() {
    this.reset(this.seed);
  }

  get counts(): AgentCounts {
    return {
      cars: this.agents.filter((agent) => agent.mode === 'car').length,
      buses: this.agents.filter((agent) => agent.mode === 'bus').length,
      trams: this.agents.filter((agent) => agent.mode === 'tram').length,
    };
  }

  get activeApproach(): ApproachId {
    return APPROACH_ORDER[this.activeApproachIndex];
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setDensity(density: TrafficDensity): void {
    if (this.density === density) return;
    this.density = density;
    this.reset(this.seed);
  }

  reset(seed = 2180): void {
    this.seed = seed >>> 0;
    this.agents.length = 0;
    this.elapsed = 0;
    this.accumulator = 0;
    this.activeApproachIndex = 0;
    this.signalStage = 'green';
    this.stageElapsed = 0;
    this.greenDuration = 12;
    const random = new SeededRandom(this.seed);
    const targets = TARGETS[this.density];
    const carRoutes = TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'car');
    const busRoutes = TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'bus');
    const tramRoutes = TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'tram');
    this.spawnMode('car', targets.cars, carRoutes, random);
    this.spawnMode('bus', targets.buses, busRoutes, random);
    this.spawnMode('tram', targets.trams, tramRoutes, random);
  }

  private spawnMode(mode: TrafficMode, count: number, routes: TrafficRoute[], random: SeededRandom): void {
    for (let index = 0; index < count; index += 1) {
      const route = routes[index % routes.length];
      const length = polylineLength(route.points);
      const laneSlot = Math.floor(index / routes.length);
      const spacing = Math.max(modeLength(mode) + 2, length / Math.max(1, Math.ceil(count / routes.length)));
      const distance = (laneSlot * spacing + random.next() * Math.min(3, spacing * 0.2)) % Math.max(1, length - 1);
      const desiredSpeed = mode === 'tram'
          ? 8.5 + random.next() * 1.5
          : mode === 'bus'
            ? 7.2 + random.next() * 1.4
            : 7.8 + random.next() * 2.5;
      this.agents.push({
        id: `${mode}-${index + 1}`,
        mode,
        routeId: route.id,
        route,
        distance,
        speed: desiredSpeed * 0.72,
        desiredSpeed,
        scale: 1,
        spawnAge: 0.6,
        length: modeLength(mode),
        colorIndex: Math.floor(random.next() * 8),
        turn: route.turn,
        dwellRemaining: 0,
        hasDwelled: false,
        priorityRequest: false,
      });
    }
  }

  advance(realSeconds: number): void {
    if (this.paused) return;
    this.accumulator = Math.min(0.25, this.accumulator + Math.max(0, realSeconds));
    while (this.accumulator >= FIXED_STEP) {
      this.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }
  }

  private step(dt: number): void {
    this.elapsed += dt;
    this.updateSignals(dt);
    const routeOccupants = new Map<string, TrafficAgent[]>();
    for (const agent of this.agents) {
      const occupants = routeOccupants.get(agent.routeId) ?? [];
      occupants.push(agent);
      routeOccupants.set(agent.routeId, occupants);
    }
    for (const occupants of routeOccupants.values()) occupants.sort((a, b) => b.distance - a.distance);

    for (const occupants of routeOccupants.values()) {
      for (let index = 0; index < occupants.length; index += 1) {
        const agent = occupants[index];
        const leader = occupants[index - 1];
        this.stepAgent(agent, leader, dt);
      }
    }
  }

  private stepAgent(agent: TrafficAgent, leader: TrafficAgent | undefined, dt: number): void {
    const routeLength = polylineLength(agent.route.points);
    agent.spawnAge += dt;
    const easeProgress = Math.min(1, agent.spawnAge / 0.6);
    agent.scale = 1 - (1 - easeProgress) ** 3;

    if (agent.dwellRemaining > 0) {
      agent.dwellRemaining = Math.max(0, agent.dwellRemaining - dt);
      agent.speed = 0;
      agent.priorityRequest = true;
      return;
    }

    const dwellPoint = agent.route.dwellAt ?? routeLength * 0.46;
    if ((agent.mode === 'bus' || agent.mode === 'tram') && !agent.hasDwelled && agent.distance < dwellPoint && agent.distance + agent.speed * dt >= dwellPoint) {
      const dwellVariation = ((agent.id.charCodeAt(agent.id.length - 1) + this.seed) % 7);
      agent.distance = dwellPoint;
      agent.dwellRemaining = 8 + dwellVariation;
      agent.hasDwelled = true;
      agent.speed = 0;
      agent.priorityRequest = true;
      return;
    }
    agent.priorityRequest = false;

    let targetSpeed = agent.desiredSpeed;
    const approach = signalApproach(agent.route.signalGroup);
    const stopAt = agent.route.stopAt;
    const hasGreen = this.vehicleSignal(agent.route.signalGroup) === 'green';
    const isControlled = approach !== undefined || agent.route.signalGroup.startsWith('transit-');
    if (isControlled && stopAt !== undefined && !hasGreen && agent.distance < stopAt) {
      const distanceToLine = stopAt - agent.distance;
      targetSpeed = Math.min(targetSpeed, Math.max(0, (distanceToLine - 0.8) * 0.55));
      if ((agent.mode === 'bus' || agent.mode === 'tram') && distanceToLine < 45) agent.priorityRequest = true;
    }

    if (leader) {
      const safeGap = agent.length * 0.6 + Math.max(1.2, agent.speed * 0.85);
      const gap = leader.distance - agent.distance - leader.length;
      if (gap < safeGap) targetSpeed = Math.min(targetSpeed, Math.max(0, (gap - 0.3) * 0.75));
    }

    const acceleration = targetSpeed > agent.speed ? 1.6 : 3.8;
    agent.speed += Math.sign(targetSpeed - agent.speed) * Math.min(Math.abs(targetSpeed - agent.speed), acceleration * dt);
    agent.distance += Math.max(0, agent.speed) * dt;
    if (agent.distance >= routeLength) {
      agent.distance %= routeLength;
      agent.spawnAge = 0;
      agent.scale = 0;
      agent.hasDwelled = false;
      agent.dwellRemaining = 0;
    }
  }

  private updateSignals(dt: number): void {
    this.stageElapsed += dt;
    const stageDuration = this.signalStage === 'green' ? this.greenDuration : this.signalStage === 'amber' ? 3 : 1.5;
    if (this.stageElapsed < stageDuration) return;
    this.stageElapsed -= stageDuration;
    if (this.signalStage === 'green') {
      this.signalStage = 'amber';
    } else if (this.signalStage === 'amber') {
      this.signalStage = 'all-red';
    } else {
      this.activeApproachIndex = (this.activeApproachIndex + 1) % APPROACH_ORDER.length;
      this.signalStage = 'green';
      const group = `vehicle-${this.activeApproach}`;
      const queue = this.agents.filter((agent) => agent.route.signalGroup === group && agent.speed < 0.5).length;
      const priority = this.agents.some((agent) => agent.route.signalGroup === group && agent.priorityRequest);
      this.greenDuration = 11 + Math.min(5, Math.ceil(queue / 3)) + (priority ? 2 : 0);
    }
  }

  vehicleSignal(group: string): VehicleSignalState {
    if (group.startsWith('transit-')) {
      const activeTransit = `transit-${(this.activeApproachIndex % 2) + 1}`;
      return this.signalStage === 'all-red' && group === activeTransit ? 'green' : 'red';
    }
    if (group !== `vehicle-${this.activeApproach}`) return 'red';
    return this.signalStage === 'green' ? 'green' : this.signalStage === 'amber' ? 'amber' : 'red';
  }

  pedestrianSignal(group: string): PedestrianSignalState {
    const approach = signalApproach(group);
    if (!approach || approach === this.activeApproach) return 'stop';
    if (this.signalStage === 'amber') return 'clearance';
    return 'walk';
  }

  greenGroups(): string[] {
    const groups: string[] = [];
    if (this.signalStage === 'green') groups.push(`vehicle-${this.activeApproach}`);
    if (this.signalStage === 'all-red') groups.push(`transit-${(this.activeApproachIndex % 2) + 1}`);
    for (const approach of APPROACH_ORDER) if (this.pedestrianSignal(`ped-${approach}`) === 'walk') groups.push(`ped-${approach}`);
    return groups;
  }

  pose(agent: TrafficAgent): AgentPose {
    const routeLength = polylineLength(agent.route.points);
    const exitProgress = Math.min(1, Math.max(0, (routeLength - agent.distance) / Math.max(0.1, agent.desiredSpeed * 0.6)));
    const exitEase = 1 - (1 - exitProgress) ** 3;
    return { ...samplePolyline(agent.route.points, agent.distance), scale: Math.min(agent.scale, exitEase) };
  }

  snapshot(): string {
    return JSON.stringify({
      density: this.density,
      elapsed: Number(this.elapsed.toFixed(3)),
      signal: [this.activeApproach, this.signalStage, Number(this.stageElapsed.toFixed(3))],
      agents: this.agents.map((agent) => [agent.id, agent.routeId, Number(agent.distance.toFixed(3)), Number(agent.speed.toFixed(3)), Number(agent.dwellRemaining.toFixed(3))]),
    });
  }
}

export { TARGETS as TRAFFIC_DENSITY_TARGETS };
