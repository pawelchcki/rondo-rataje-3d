import { TRAFFIC_NETWORK, polylineLength, sampleSmoothPolyline } from './traffic-network.ts';
import type { ApproachId, TrafficMode, TrafficRoute, TurnKind } from './traffic-network.ts';
import type { Point2 } from './types.ts';

export type TrafficDensity = 'low' | 'medium' | 'high';
export type TramPriorityMode = 'absolute' | 'standard';
export type VehicleSignalState = 'red' | 'amber' | 'green';
export type PedestrianSignalState = 'stop' | 'walk' | 'clearance';

type SignalStage = 'green' | 'amber' | 'clearance' | 'transit-green' | 'transit-amber' | 'transit-clearance';

export interface TrafficAgent {
  id: string;
  mode: TrafficMode;
  routeId: string;
  route: TrafficRoute;
  distance: number;
  previousDistance: number;
  speed: number;
  acceleration: number;
  desiredSpeed: number;
  scale: number;
  spawnAge: number;
  length: number;
  colorIndex: number;
  turn: TurnKind;
  dwellRemaining: number;
  hasDwelled: boolean;
  priorityRequest: boolean;
  signalCleared: boolean;
  signalCheckpointIndex: number;
  visibleSeconds: number;
  signalWaitSeconds: number;
  signalWaitCount: number;
  waitingAtSignal: boolean;
  passengerCount: number;
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function signalCheckpoints(route: TrafficRoute): Array<{ distance: number; signalGroup: string }> {
  if (route.signalStops) return route.signalStops;
  return route.stopAt === undefined ? [] : [{ distance: route.stopAt, signalGroup: route.signalGroup }];
}

function passengerEstimate(mode: TrafficMode, random: SeededRandom): number {
  if (mode === 'tram') return 35 + Math.floor(random.next() * 146);
  if (mode === 'bus') return 12 + Math.floor(random.next() * 69);
  return 1 + Math.floor(random.next() * 4);
}

export class TrafficSimulation {
  readonly agents: TrafficAgent[] = [];
  density: TrafficDensity = 'medium';
  tramPriority: TramPriorityMode = 'absolute';
  paused = false;
  elapsed = 0;
  signalCrossings = 0;
  redLightViolations = 0;
  tramSignalWaitingSeconds = 0;
  private accumulator = 0;
  private activeApproachIndex = 0;
  private activeTransitGroup: string | undefined;
  private pendingTransitGroup: string | undefined;
  private signalStage: SignalStage = 'green';
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

  nextSignalStop(agent: TrafficAgent): { distance: number; signalGroup: string } | undefined {
    return signalCheckpoints(agent.route)[agent.signalCheckpointIndex];
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setDensity(density: TrafficDensity): void {
    if (this.density === density) return;
    this.density = density;
    this.reset(this.seed);
  }

  setTramPriority(mode: TramPriorityMode): void {
    if (this.tramPriority === mode) return;
    this.tramPriority = mode;
    this.reset(this.seed);
  }

  reset(seed = 2180): void {
    this.seed = seed >>> 0;
    this.agents.length = 0;
    this.elapsed = 0;
    this.accumulator = 0;
    this.activeApproachIndex = 0;
    this.activeTransitGroup = undefined;
    this.pendingTransitGroup = undefined;
    this.signalStage = 'green';
    this.stageElapsed = 0;
    this.greenDuration = 12;
    this.signalCrossings = 0;
    this.redLightViolations = 0;
    this.tramSignalWaitingSeconds = 0;
    const random = new SeededRandom(this.seed);
    const targets = TARGETS[this.density];
    this.spawnMode('car', targets.cars, TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'car'), random);
    this.spawnMode('bus', targets.buses, TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'bus'), random);
    this.spawnMode('tram', targets.trams, TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'tram'), random);
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
      const checkpoints = signalCheckpoints(route);
      const signalCheckpointIndex = checkpoints.filter((checkpoint) => checkpoint.distance <= distance).length;
      this.agents.push({
        id: `${mode}-${index + 1}`,
        mode,
        routeId: route.id,
        route,
        distance,
        previousDistance: distance,
        speed: desiredSpeed * 0.72,
        acceleration: 0,
        desiredSpeed,
        scale: 1,
        spawnAge: 0.6,
        length: modeLength(mode),
        colorIndex: Math.floor(random.next() * 8),
        turn: route.turn,
        dwellRemaining: 0,
        hasDwelled: false,
        priorityRequest: false,
        signalCleared: signalCheckpointIndex >= checkpoints.length,
        signalCheckpointIndex,
        visibleSeconds: 0,
        signalWaitSeconds: 0,
        signalWaitCount: 0,
        waitingAtSignal: false,
        passengerCount: passengerEstimate(mode, random),
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
    const poses = new Map(this.agents.map((agent) => [agent.id, sampleSmoothPolyline(agent.route.points, agent.distance)]));
    const leaderGaps = new Map(this.agents.map((agent) => [agent.id, this.nearestLeaderGap(agent, poses)]));
    for (const agent of this.agents) this.stepAgent(agent, leaderGaps.get(agent.id), dt);
  }

  private nearestLeaderGap(agent: TrafficAgent, poses: Map<string, { point: Point2; heading: number }>): number | undefined {
    const pose = poses.get(agent.id);
    if (!pose) return undefined;
    const forward: Point2 = [Math.cos(pose.heading), Math.sin(pose.heading)];
    const side: Point2 = [-forward[1], forward[0]];
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidate of this.agents) {
      if (candidate === agent || (candidate.mode === 'tram') !== (agent.mode === 'tram')) continue;
      const candidatePose = poses.get(candidate.id);
      if (!candidatePose) continue;
      const headingAlignment = Math.cos(candidatePose.heading - pose.heading);
      if (headingAlignment < 0.78) continue;
      const dx = candidatePose.point[0] - pose.point[0];
      const dy = candidatePose.point[1] - pose.point[1];
      const ahead = dx * forward[0] + dy * forward[1];
      const lateral = Math.abs(dx * side[0] + dy * side[1]);
      const lateralLimit = agent.mode === 'tram' ? 1.35 : 1.5;
      if (ahead <= 0 || ahead > 45 || lateral > lateralLimit) continue;
      nearest = Math.min(nearest, ahead - (agent.length + candidate.length) / 2);
    }
    return Number.isFinite(nearest) ? nearest : undefined;
  }

  private stepAgent(agent: TrafficAgent, leaderGap: number | undefined, dt: number): void {
    const routeLength = polylineLength(agent.route.points);
    agent.previousDistance = agent.distance;
    agent.visibleSeconds += dt;
    agent.spawnAge += dt;
    const easeProgress = Math.min(1, agent.spawnAge / 0.6);
    agent.scale = 1 - (1 - easeProgress) ** 3;
    agent.priorityRequest = false;

    if (agent.dwellRemaining > 0) {
      agent.dwellRemaining = Math.max(0, agent.dwellRemaining - dt);
      agent.speed = 0;
      agent.acceleration = 0;
      return;
    }

    let targetSpeed = agent.desiredSpeed;
    const dwellPoint = agent.route.dwellAt ?? routeLength * 0.46;
    if ((agent.mode === 'bus' || agent.mode === 'tram') && !agent.hasDwelled && agent.distance < dwellPoint) {
      const distanceToStop = dwellPoint - agent.distance;
      if (distanceToStop < 24) targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * 1.45 * Math.max(0, distanceToStop - 0.35)));
      if (distanceToStop <= 0.45 && agent.speed < 0.75) {
        const dwellVariation = (agent.id.charCodeAt(agent.id.length - 1) + this.seed) % 7;
        agent.distance = dwellPoint;
        agent.previousDistance = dwellPoint;
        agent.dwellRemaining = 8 + dwellVariation;
        agent.hasDwelled = true;
        agent.speed = 0;
        agent.acceleration = 0;
        return;
      }
    }

    const checkpoints = signalCheckpoints(agent.route);
    const checkpoint = checkpoints[agent.signalCheckpointIndex];
    const stopAt = checkpoint?.distance;
    const signalGroup = checkpoint?.signalGroup ?? agent.route.signalGroup;
    const signalState = this.vehicleSignal(signalGroup);
    let mayCrossSignal = signalState === 'green';
    if (!agent.signalCleared && stopAt !== undefined && agent.distance < stopAt) {
      const distanceToLine = stopAt - agent.distance;
      const comfortableDeceleration = agent.mode === 'tram' ? 1.25 : agent.mode === 'bus' ? 2 : 2.8;
      const brakingDistance = agent.speed * 0.45 + (agent.speed * agent.speed) / (2 * comfortableDeceleration);
      const amberCommit = signalState === 'amber' && brakingDistance >= Math.max(0, distanceToLine - 0.8);
      mayCrossSignal = signalState === 'green' || amberCommit;
      if (!mayCrossSignal) {
        targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * comfortableDeceleration * Math.max(0, distanceToLine - 0.8)));
        if (agent.mode === 'tram' && distanceToLine < 2.5 && agent.speed < 0.55) {
          if (!agent.waitingAtSignal) agent.signalWaitCount += 1;
          agent.waitingAtSignal = true;
          agent.signalWaitSeconds += dt;
          this.tramSignalWaitingSeconds += dt;
        }
      } else if (agent.mode === 'tram') {
        agent.waitingAtSignal = false;
      }
      if ((agent.mode === 'bus' || agent.mode === 'tram') && distanceToLine < 55) agent.priorityRequest = true;
    }

    if (leaderGap !== undefined) {
      const safeGap = 1.4 + agent.speed * (agent.mode === 'tram' ? 1.1 : 0.9);
      if (leaderGap < safeGap) targetSpeed = Math.min(targetSpeed, Math.max(0, (leaderGap - 0.35) / 1.05));
    }

    const maximumAcceleration = agent.mode === 'car' ? 1.7 : agent.mode === 'bus' ? 1.15 : 0.95;
    const maximumDeceleration = agent.mode === 'tram' ? 1.5 : agent.mode === 'bus' ? 2.4 : 3.5;
    const maximumJerk = agent.mode === 'car' ? 4 : agent.mode === 'bus' ? 1.8 : 1.25;
    const desiredAcceleration = clamp((targetSpeed - agent.speed) / 0.7, -maximumDeceleration, maximumAcceleration);
    agent.acceleration += clamp(desiredAcceleration - agent.acceleration, -maximumJerk * dt, maximumJerk * dt);
    const nextSpeed = clamp(agent.speed + agent.acceleration * dt, 0, agent.desiredSpeed);
    let advance = Math.max(0, (agent.speed + nextSpeed) * 0.5 * dt);
    if (leaderGap !== undefined) advance = Math.min(advance, Math.max(0, leaderGap - 0.25));
    let nextDistance = agent.distance + advance;
    agent.speed = nextSpeed;

    if (!agent.signalCleared && stopAt !== undefined && nextDistance >= stopAt) {
      if (mayCrossSignal) {
        agent.signalCheckpointIndex += 1;
        agent.signalCleared = agent.signalCheckpointIndex >= checkpoints.length;
        agent.waitingAtSignal = false;
        this.signalCrossings += 1;
      } else {
        nextDistance = Math.max(agent.distance, stopAt - 0.8);
        agent.acceleration = 0;
        agent.speed = 0;
      }
    }
    agent.distance = nextDistance;

    if (agent.distance >= routeLength) {
      agent.distance %= routeLength;
      agent.previousDistance = agent.distance;
      agent.spawnAge = 0;
      agent.scale = 0;
      agent.hasDwelled = false;
      agent.dwellRemaining = 0;
      agent.signalCheckpointIndex = 0;
      agent.signalCleared = checkpoints.length === 0;
      agent.visibleSeconds = 0;
      agent.signalWaitSeconds = 0;
      agent.signalWaitCount = 0;
      agent.waitingAtSignal = false;
    }
    const nextCheckpoint = checkpoints[agent.signalCheckpointIndex];
    if (!agent.signalCleared && nextCheckpoint && agent.distance > nextCheckpoint.distance + 0.001) this.redLightViolations += 1;
  }

  private updateSignals(dt: number): void {
    this.stageElapsed += dt;
    if (this.tramPriority === 'absolute' && this.signalStage === 'green' && this.stageElapsed >= 4) {
      const requestedGroup = this.requestedTransitGroup();
      if (requestedGroup) {
        this.pendingTransitGroup = requestedGroup;
        this.signalStage = 'amber';
        this.stageElapsed = 0;
        return;
      }
    }
    const durations: Record<SignalStage, number> = {
      green: this.greenDuration,
      amber: 3,
      clearance: 1.5,
      'transit-green': this.tramPriority === 'absolute' ? 12 : 6,
      'transit-amber': 3,
      'transit-clearance': 1.5,
    };
    if (this.stageElapsed < durations[this.signalStage]) return;
    this.stageElapsed -= durations[this.signalStage];
    if (this.signalStage === 'green') {
      this.signalStage = 'amber';
    } else if (this.signalStage === 'amber') {
      this.signalStage = 'clearance';
    } else if (this.signalStage === 'clearance') {
      this.activeTransitGroup = this.pendingTransitGroup ?? this.requestedTransitGroup();
      this.pendingTransitGroup = undefined;
      if (this.activeTransitGroup) this.signalStage = 'transit-green';
      else this.beginNextVehiclePhase();
    } else if (this.signalStage === 'transit-green') {
      this.signalStage = 'transit-amber';
    } else if (this.signalStage === 'transit-amber') {
      this.signalStage = 'transit-clearance';
    } else {
      this.activeTransitGroup = undefined;
      this.beginNextVehiclePhase();
    }
  }

  private requestedTransitGroup(): string | undefined {
    const requests = this.agents
      .filter((agent) => agent.mode === 'tram' && !agent.signalCleared)
      .map((agent) => {
        const checkpoint = signalCheckpoints(agent.route)[agent.signalCheckpointIndex];
        return checkpoint ? { group: checkpoint.signalGroup, distance: checkpoint.distance - agent.distance } : undefined;
      })
      .filter((request): request is { group: string; distance: number } => request !== undefined && request.distance > 0)
      .filter((request) => request.distance < 60)
      .sort((a, b) => a.distance - b.distance || a.group.localeCompare(b.group));
    return requests[0]?.group;
  }

  private beginNextVehiclePhase(): void {
    this.activeApproachIndex = (this.activeApproachIndex + 1) % APPROACH_ORDER.length;
    this.signalStage = 'green';
    const group = `vehicle-${this.activeApproach}`;
    const queue = this.agents.filter((agent) => agent.route.signalGroup === group && !agent.signalCleared && agent.speed < 0.5).length;
    const priority = this.agents.some((agent) => agent.route.signalGroup === group && agent.priorityRequest);
    this.greenDuration = 11 + Math.min(5, Math.ceil(queue / 3)) + (priority ? 2 : 0);
  }

  vehicleSignal(group: string): VehicleSignalState {
    if (group.startsWith('transit-')) {
      const corridor = (value: string | undefined): string | undefined => value?.match(/^transit-\d+/)?.[0];
      const exactMatch = group === this.activeTransitGroup;
      const absoluteCorridorMatch = this.tramPriority === 'absolute' && corridor(group) === corridor(this.activeTransitGroup);
      const headMatchesCorridor = this.activeTransitGroup !== undefined && group === corridor(this.activeTransitGroup);
      if (!exactMatch && !absoluteCorridorMatch && !headMatchesCorridor) return 'red';
      if (this.signalStage === 'transit-green') return 'green';
      if (this.signalStage === 'transit-amber') return 'amber';
      return 'red';
    }
    if (group !== `vehicle-${this.activeApproach}`) return 'red';
    if (this.signalStage === 'green') return 'green';
    if (this.signalStage === 'amber') return 'amber';
    return 'red';
  }

  pedestrianSignal(group: string): PedestrianSignalState {
    const approach = signalApproach(group);
    if (!approach || this.signalStage !== 'green') return this.signalStage === 'amber' ? 'clearance' : 'stop';
    return approach === this.activeApproach ? 'stop' : 'walk';
  }

  greenGroups(): string[] {
    const groups: string[] = [];
    if (this.signalStage === 'green') groups.push(`vehicle-${this.activeApproach}`);
    if (this.signalStage === 'transit-green' && this.activeTransitGroup) groups.push(this.activeTransitGroup);
    for (const approach of APPROACH_ORDER) if (this.pedestrianSignal(`ped-${approach}`) === 'walk') groups.push(`ped-${approach}`);
    return groups;
  }

  pose(agent: TrafficAgent): AgentPose {
    const routeLength = polylineLength(agent.route.points);
    const interpolation = clamp(this.accumulator / FIXED_STEP, 0, 1);
    const displayDistance = agent.previousDistance <= agent.distance
      ? agent.previousDistance + (agent.distance - agent.previousDistance) * interpolation
      : agent.distance;
    const exitProgress = Math.min(1, Math.max(0, (routeLength - displayDistance) / Math.max(0.1, agent.desiredSpeed * 0.6)));
    const exitEase = 1 - (1 - exitProgress) ** 3;
    return { ...sampleSmoothPolyline(agent.route.points, displayDistance), scale: Math.min(agent.scale, exitEase) };
  }

  snapshot(): string {
    return JSON.stringify({
      density: this.density,
      tramPriority: this.tramPriority,
      elapsed: Number(this.elapsed.toFixed(3)),
      signal: [this.activeApproach, this.signalStage, this.activeTransitGroup, Number(this.stageElapsed.toFixed(3))],
      crossings: [this.signalCrossings, this.redLightViolations, Number(this.tramSignalWaitingSeconds.toFixed(3))],
      agents: this.agents.map((agent) => [
        agent.id,
        agent.routeId,
        Number(agent.distance.toFixed(3)),
        Number(agent.speed.toFixed(3)),
        Number(agent.acceleration.toFixed(3)),
        Number(agent.dwellRemaining.toFixed(3)),
        agent.signalCleared,
        agent.signalCheckpointIndex,
        Number(agent.visibleSeconds.toFixed(3)),
        Number(agent.signalWaitSeconds.toFixed(3)),
        agent.signalWaitCount,
        agent.passengerCount,
      ]),
    });
  }
}

export { TARGETS as TRAFFIC_DENSITY_TARGETS };
