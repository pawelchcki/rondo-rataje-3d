import { TRAFFIC_NETWORK, polylineLength, sampleSmoothPolyline } from './traffic-network.ts';
import type { ApproachId, TrafficMode, TrafficRoute, TurnKind } from './traffic-network.ts';
import { DEMAND_PROFILE_FACTORS, RATAJE_DEMAND_DATASET } from './traffic-demand.ts';
import type { DemandProfile } from './traffic-demand.ts';
import type { Point2 } from './types.ts';

export type TrafficDensity = 'low' | 'medium' | 'high';
export type TramPriorityMode = 'adaptive' | 'absolute' | 'standard';
export type VehicleSignalState = 'red' | 'amber' | 'green';
export type PedestrianSignalState = 'stop' | 'walk' | 'clearance';

type SignalStage = 'vehicle-green' | 'vehicle-amber' | 'intergreen' | 'transit-green' | 'transit-amber' | 'transit-intergreen';

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
  dwellExtensionRemaining: number;
  lastDwellSeconds: number;
  dwellCount: number;
  boardedPassengers: number;
  alightedPassengers: number;
  hasDwelled: boolean;
  priorityRequest: boolean;
  signalCleared: boolean;
  signalCheckpointIndex: number;
  visibleSeconds: number;
  signalWaitSeconds: number;
  signalWaitCount: number;
  waitingAtSignal: boolean;
  passengerCount: number;
  initialPassengerCount: number;
  passengerCapacity: number;
  delaySeconds: number;
}

export interface PedestrianGroupState {
  id: string;
  queue: number;
  buttonPressed: boolean;
  signal: PedestrianSignalState;
  crossingSeconds: number;
  inCrossing: number;
  served: number;
  totalWaitSeconds: number;
  maximumWaitSeconds: number;
  currentMaximumWaitSeconds: number;
}

interface MutablePedestrianGroup extends PedestrianGroupState {
  arrivals: number[];
  nextArrival: number;
  phaseRemaining: number;
  random: SeededRandom;
  demandPerHour: number;
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

const DENSITY_TO_PROFILE: Record<TrafficDensity, DemandProfile> = { low: 'quiet', medium: 'typical', high: 'peak-2023' };
const PROFILE_TO_DENSITY: Record<DemandProfile, TrafficDensity> = { quiet: 'low', typical: 'medium', 'peak-2023': 'high' };
const VEHICLE_GROUPS = [...new Set(TRAFFIC_NETWORK.signals.flatMap((signal) => signal.vehicleGroups))];
const FIXED_STEP = 1 / 30;
const MINIMUM_GREEN = 7;

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

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function modeLength(mode: TrafficMode): number {
  if (mode === 'tram') return 19;
  if (mode === 'bus') return 11.5;
  return 4.2;
}

function modeCapacity(mode: TrafficMode): number {
  if (mode === 'tram') return 240;
  if (mode === 'bus') return 80;
  return 4;
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

function approachOfVehicleGroup(group: string): ApproachId | undefined {
  return TRAFFIC_NETWORK.signals.find((signal) => signal.vehicleGroups.includes(group))?.approach;
}

export class TrafficSimulation {
  readonly agents: TrafficAgent[] = [];
  readonly pedestrianGroups: MutablePedestrianGroup[] = [];
  density: TrafficDensity = 'medium';
  tramPriority: TramPriorityMode = 'adaptive';
  paused = false;
  elapsed = 0;
  signalCrossings = 0;
  redLightViolations = 0;
  tramSignalWaitingSeconds = 0;
  passengerBoardings = 0;
  passengerAlightings = 0;
  vehicleDelaySeconds = 0;
  pedestrianConflictDelaySeconds = 0;
  tramOverlapViolations = 0;
  tramReservationOverlapViolations = 0;
  pedestrianDemandEnabled = true;
  private accumulator = 0;
  private activeVehicleGroup = VEHICLE_GROUPS[0];
  private activeTransitGroup: string | undefined;
  private pendingTransitGroup: string | undefined;
  private signalStage: SignalStage = 'vehicle-green';
  private stageElapsed = 0;
  private greenDuration = 18;
  private intergreenDuration = 1.5;
  private seed = 2180;
  private vehicleCursor = 0;
  private groupWaitSeconds = new Map<string, number>();
  private tramReservations = new Map<string, string>();
  private overlappingTramPairs = new Set<string>();

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

  get demandProfile(): DemandProfile {
    return DENSITY_TO_PROFILE[this.density];
  }

  get activeApproach(): ApproachId {
    return approachOfVehicleGroup(this.activeVehicleGroup) ?? 'north-east';
  }

  get pedestrianTelemetry(): PedestrianGroupState[] {
    return this.pedestrianGroups.map((group) => ({
      id: group.id,
      queue: group.queue,
      buttonPressed: group.buttonPressed,
      signal: group.signal,
      crossingSeconds: group.crossingSeconds,
      inCrossing: group.inCrossing,
      served: group.served,
      totalWaitSeconds: group.totalWaitSeconds,
      maximumWaitSeconds: group.maximumWaitSeconds,
      currentMaximumWaitSeconds: group.currentMaximumWaitSeconds,
    }));
  }

  get totalTransitPassengers(): number {
    return this.agents.filter((agent) => agent.mode !== 'car').reduce((sum, agent) => sum + agent.passengerCount, 0);
  }

  get activeTramReservations(): Record<string, string> {
    return Object.fromEntries(this.tramReservations);
  }

  get occupiedInnerZones(): Record<string, string[]> {
    return Object.fromEntries(TRAFFIC_NETWORK.conflictZones
      .filter((zone) => zone.id.startsWith('ring-zone-'))
      .map((zone) => [zone.id, this.agents
        .filter((agent) => agent.mode !== 'tram')
        .filter((agent) => {
          const point = sampleSmoothPolyline(agent.route.points, agent.distance).point;
          return Math.hypot(point[0] - zone.center[0], point[1] - zone.center[1]) <= zone.radius;
        })
        .map((agent) => agent.id)]));
  }

  trackId(agent: TrafficAgent): string | undefined {
    return this.trackPosition(agent)?.trackId;
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

  setDemandProfile(profile: DemandProfile): void {
    this.setDensity(PROFILE_TO_DENSITY[profile]);
  }

  setPedestrianDemand(enabled: boolean): void {
    if (this.pedestrianDemandEnabled === enabled) return;
    this.pedestrianDemandEnabled = enabled;
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
    this.pedestrianGroups.length = 0;
    this.elapsed = 0;
    this.accumulator = 0;
    this.activeVehicleGroup = VEHICLE_GROUPS[0];
    this.activeTransitGroup = undefined;
    this.pendingTransitGroup = undefined;
    // Start all-red so pre-seeded vehicles already on the ring can be drained
    // before the first conflicting entry is considered.
    this.signalStage = 'intergreen';
    this.stageElapsed = 0;
    this.greenDuration = 18;
    this.intergreenDuration = 1.5;
    this.vehicleCursor = 0;
    this.groupWaitSeconds = new Map(VEHICLE_GROUPS.map((group) => [group, 0]));
    this.signalCrossings = 0;
    this.redLightViolations = 0;
    this.tramSignalWaitingSeconds = 0;
    this.passengerBoardings = 0;
    this.passengerAlightings = 0;
    this.vehicleDelaySeconds = 0;
    this.pedestrianConflictDelaySeconds = 0;
    this.tramOverlapViolations = 0;
    this.tramReservationOverlapViolations = 0;
    this.tramReservations.clear();
    this.overlappingTramPairs.clear();
    const random = new SeededRandom(this.seed);
    const targets = TARGETS[this.density];
    this.spawnMode('car', targets.cars, TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'car'), random);
    this.spawnMode('bus', targets.buses, TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'bus'), random);
    this.spawnMode('tram', targets.trams, TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'tram'), random);
    this.resetPedestrianGroups();
  }

  private resetPedestrianGroups(): void {
    const factor = DEMAND_PROFILE_FACTORS[this.demandProfile];
    for (const definition of TRAFFIC_NETWORK.pedestrianGroups) {
      const length = Math.hypot(definition.points[1][0] - definition.points[0][0], definition.points[1][1] - definition.points[0][1]);
      const random = new SeededRandom(this.seed ^ stableHash(definition.id));
      const base = RATAJE_DEMAND_DATASET.pedestrians[definition.demandClass].valuePerHour;
      const demandPerHour = this.pedestrianDemandEnabled ? base * factor : 0;
      const nextArrival = demandPerHour > 0 ? this.nextInterarrival(random, demandPerHour) : Number.POSITIVE_INFINITY;
      this.pedestrianGroups.push({
        id: definition.id,
        queue: 0,
        buttonPressed: false,
        signal: 'stop',
        crossingSeconds: length / 1.4 + 1,
        inCrossing: 0,
        served: 0,
        totalWaitSeconds: 0,
        maximumWaitSeconds: 0,
        currentMaximumWaitSeconds: 0,
        arrivals: [],
        nextArrival,
        phaseRemaining: 0,
        random,
        demandPerHour,
      });
    }
  }

  private nextInterarrival(random: SeededRandom, ratePerHour: number): number {
    return -Math.log(Math.max(1e-9, 1 - random.next())) * 3600 / ratePerHour;
  }

  private spawnMode(mode: TrafficMode, count: number, routes: TrafficRoute[], random: SeededRandom): void {
    for (let index = 0; index < count; index += 1) {
      const route = routes[index % routes.length];
      const length = polylineLength(route.points);
      const laneSlot = Math.floor(index / routes.length);
      const spacing = Math.max(modeLength(mode) + 2, length / Math.max(1, Math.ceil(count / routes.length)));
      const unconstrainedDistance = (laneSlot * spacing + random.next() * Math.min(3, spacing * 0.2)) % Math.max(1, length - 1);
      const distance = mode === 'tram'
        ? Math.min(modeLength(mode) / 2 + random.next() * 1.5, Math.max(modeLength(mode) / 2, (signalCheckpoints(route)[0]?.distance ?? 35) - modeLength(mode) - 2))
        : unconstrainedDistance;
      const desiredSpeed = mode === 'tram' ? 8.5 + random.next() * 1.5 : mode === 'bus' ? 7.2 + random.next() * 1.4 : 7.8 + random.next() * 2.5;
      const checkpoints = signalCheckpoints(route);
      const signalCheckpointIndex = checkpoints.filter((checkpoint) => checkpoint.distance <= distance).length;
      const passengerCount = passengerEstimate(mode, random);
      this.agents.push({
        id: `${mode}-${index + 1}`, mode, routeId: route.id, route, distance, previousDistance: distance,
        speed: desiredSpeed * 0.72, acceleration: 0, desiredSpeed, scale: 1, spawnAge: 0.6,
        length: modeLength(mode), colorIndex: Math.floor(random.next() * 8), turn: route.turn,
        dwellRemaining: 0, dwellExtensionRemaining: 0, lastDwellSeconds: 0, dwellCount: 0,
        boardedPassengers: 0, alightedPassengers: 0, hasDwelled: false, priorityRequest: false,
        signalCleared: signalCheckpointIndex >= checkpoints.length, signalCheckpointIndex,
        visibleSeconds: 0, signalWaitSeconds: 0, signalWaitCount: 0, waitingAtSignal: false,
        passengerCount, initialPassengerCount: passengerCount, passengerCapacity: modeCapacity(mode), delaySeconds: 0,
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
    this.updatePedestrians(dt);
    this.updateSignals(dt);
    const poses = new Map(this.agents.map((agent) => [agent.id, sampleSmoothPolyline(agent.route.points, agent.distance)]));
    const leaderGaps = new Map(this.agents.map((agent) => [agent.id, this.nearestLeaderGap(agent, poses)]));
    for (const agent of this.agents) this.stepAgent(agent, leaderGaps.get(agent.id), dt);
    this.updateTramSafetyDiagnostics();
    this.updateVehicleWaits(dt);
  }

  private trackPosition(agent: TrafficAgent): { trackId: string; distance: number; remaining: number } | undefined {
    const sections = agent.route.trackSections;
    if (!sections || sections.length === 0) return undefined;
    const section = sections.find((candidate) => agent.distance >= candidate.startDistance - 1e-6 && agent.distance < candidate.endDistance - 1e-6) ?? sections.at(-1);
    if (!section) return undefined;
    const distance = section.trackStartDistance + clamp(agent.distance - section.startDistance, 0, section.endDistance - section.startDistance);
    return { trackId: section.trackId, distance, remaining: section.endDistance - agent.distance };
  }

  private updateTramSafetyDiagnostics(): void {
    const trams = this.agents.filter((agent) => agent.mode === 'tram');
    const activePairs = new Set<string>();
    for (let left = 0; left < trams.length; left += 1) {
      for (let right = left + 1; right < trams.length; right += 1) {
        const a = trams[left];
        const b = trams[right];
        const aTrack = this.trackPosition(a);
        const bTrack = this.trackPosition(b);
        const aPose = sampleSmoothPolyline(a.route.points, a.distance);
        const bPose = sampleSmoothPolyline(b.route.points, b.distance);
        const sameTrackOverlap = aTrack?.trackId === bTrack?.trackId && Math.abs((aTrack?.distance ?? 0) - (bTrack?.distance ?? 0)) < (a.length + b.length) / 2 + 0.5;
        const spatialOverlap = Math.hypot(aPose.point[0] - bPose.point[0], aPose.point[1] - bPose.point[1]) < 2.2;
        if (!sameTrackOverlap && !spatialOverlap) continue;
        const key = [a.id, b.id].sort().join(':');
        activePairs.add(key);
        if (!this.overlappingTramPairs.has(key)) this.tramOverlapViolations += 1;
      }
    }
    this.overlappingTramPairs = activePairs;
  }

  private updatePedestrians(dt: number): void {
    for (const group of this.pedestrianGroups) {
      while (this.elapsed >= group.nextArrival) {
        group.arrivals.push(group.nextArrival);
        group.queue += 1;
        group.buttonPressed = true;
        group.nextArrival += this.nextInterarrival(group.random, group.demandPerHour);
      }
      group.currentMaximumWaitSeconds = group.arrivals.length === 0 ? 0 : this.elapsed - group.arrivals[0];
      if (group.signal === 'stop') continue;
      group.phaseRemaining = Math.max(0, group.phaseRemaining - dt);
      if (group.phaseRemaining > 0) continue;
      if (group.signal === 'walk') {
        group.signal = 'clearance';
        group.phaseRemaining = group.crossingSeconds;
      } else {
        group.signal = 'stop';
        group.inCrossing = 0;
      }
    }
    const activeIds = this.pedestrianGroups.filter((group) => group.signal !== 'stop').map((group) => group.id);
    if (activeIds.length > 0) {
      const blocked = this.agents.filter((agent) => agent.mode !== 'tram' && !agent.signalCleared && activeIds.some((id) => TRAFFIC_NETWORK.movementConflicts[agent.route.signalGroup]?.includes(id))).length;
      this.pedestrianConflictDelaySeconds += blocked * dt;
      this.vehicleDelaySeconds += blocked * dt;
    }
  }

  private openPedestrianGroup(group: MutablePedestrianGroup): void {
    const servedArrivals = group.arrivals.splice(0);
    group.queue = 0;
    group.buttonPressed = false;
    group.signal = 'walk';
    group.phaseRemaining = 5;
    group.inCrossing = servedArrivals.length;
    group.served += servedArrivals.length;
    for (const arrival of servedArrivals) {
      const wait = this.elapsed - arrival;
      group.totalWaitSeconds += wait;
      group.maximumWaitSeconds = Math.max(group.maximumWaitSeconds, wait);
    }
    group.currentMaximumWaitSeconds = 0;
  }

  private startCompatiblePedestrians(): void {
    if (this.pendingTransitGroup || this.signalStage !== 'vehicle-green' || this.stageElapsed > MINIMUM_GREEN) return;
    const conflicts = TRAFFIC_NETWORK.movementConflicts[this.activeVehicleGroup] ?? [];
    for (const group of this.pedestrianGroups) {
      if (group.buttonPressed && group.signal === 'stop' && !conflicts.includes(group.id)) this.openPedestrianGroup(group);
    }
  }

  private nearestLeaderGap(agent: TrafficAgent, poses: Map<string, { point: Point2; heading: number }>): number | undefined {
    if (agent.mode === 'tram') {
      const position = this.trackPosition(agent);
      if (position) {
        let nearest = Number.POSITIVE_INFINITY;
        for (const candidate of this.agents) {
          if (candidate === agent || candidate.mode !== 'tram') continue;
          const candidatePosition = this.trackPosition(candidate);
          if (candidatePosition?.trackId !== position.trackId || candidatePosition.distance <= position.distance) continue;
          nearest = Math.min(nearest, candidatePosition.distance - position.distance - (agent.length + candidate.length) / 2);
        }
        if (Number.isFinite(nearest)) return nearest;
      }
    }
    const pose = poses.get(agent.id);
    if (!pose) return undefined;
    const forward: Point2 = [Math.cos(pose.heading), Math.sin(pose.heading)];
    const side: Point2 = [-forward[1], forward[0]];
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidate of this.agents) {
      if (candidate === agent || (candidate.mode === 'tram') !== (agent.mode === 'tram')) continue;
      const candidatePose = poses.get(candidate.id);
      if (!candidatePose || Math.cos(candidatePose.heading - pose.heading) < 0.78) continue;
      const dx = candidatePose.point[0] - pose.point[0];
      const dy = candidatePose.point[1] - pose.point[1];
      const ahead = dx * forward[0] + dy * forward[1];
      const lateral = Math.abs(dx * side[0] + dy * side[1]);
      if (ahead <= 0 || ahead > 45 || lateral > (agent.mode === 'tram' ? 1.35 : 1.5)) continue;
      nearest = Math.min(nearest, ahead - (agent.length + candidate.length) / 2);
    }
    return Number.isFinite(nearest) ? nearest : undefined;
  }

  private downstreamAvailable(agent: TrafficAgent): boolean {
    const sectorId = agent.route.downstreamSectorIds?.[0];
    if (!sectorId) return true;
    const sector = TRAFFIC_NETWORK.downstreamSectors.find((candidate) => candidate.id === sectorId);
    if (!sector) return true;
    const occupiedMetres = this.agents
      .filter((candidate) => candidate !== agent && candidate.route.downstreamSectorIds?.includes(sectorId) && candidate.signalCleared)
      .filter((candidate) => polylineLength(candidate.route.points) - candidate.distance < sector.capacityMetres)
      .reduce((sum, candidate) => sum + candidate.length + 2, 0);
    return occupiedMetres + agent.length + 2 <= sector.capacityMetres;
  }

  private beginDwell(agent: TrafficAgent): void {
    const hash = stableHash(`${this.seed}:${agent.id}:${agent.dwellCount}`);
    const unitA = (hash & 0xffff) / 0xffff;
    const unitB = ((hash >>> 16) & 0xffff) / 0xffff;
    const alighted = Math.min(agent.passengerCount, Math.floor(agent.passengerCount * (0.08 + unitA * 0.22)));
    const available = agent.passengerCapacity - (agent.passengerCount - alighted);
    const boarded = Math.min(available, 3 + Math.floor(unitB * (agent.mode === 'tram' ? 28 : 15)));
    const dwell = clamp(14.3 + alighted * 0.23 + boarded * 0.31, 14.3, 28.4);
    agent.alightedPassengers += alighted;
    agent.boardedPassengers += boarded;
    this.passengerAlightings += alighted;
    this.passengerBoardings += boarded;
    agent.passengerCount = agent.passengerCount - alighted + boarded;
    agent.lastDwellSeconds = dwell;
    agent.dwellCount += 1;
    // Dwa składniki zachowują dawny kontrakt pola dwellRemaining (<= 14 s),
    // ale łączny, mierzony postój ma pełny zakres 14,3–28,4 s.
    agent.dwellRemaining = Math.min(14, dwell);
    agent.dwellExtensionRemaining = Math.max(0, dwell - agent.dwellRemaining);
  }

  private tramReservationStop(agent: TrafficAgent): number | undefined {
    if (agent.mode !== 'tram' || agent.route.tramConflictEntry === undefined || agent.route.tramConflictExit === undefined) return undefined;
    const zone = 'tram-intersection';
    const owner = this.tramReservations.get(zone);
    if (agent.distance > agent.route.tramConflictExit) {
      if (owner === agent.id) this.tramReservations.delete(zone);
      return undefined;
    }
    const distanceToEntry = agent.route.tramConflictEntry - agent.distance;
    if (distanceToEntry < 42 && owner === undefined) this.tramReservations.set(zone, agent.id);
    const currentOwner = this.tramReservations.get(zone);
    if (currentOwner !== undefined && currentOwner !== agent.id) return agent.route.tramConflictEntry;
    if (agent.distance >= agent.route.tramConflictEntry && currentOwner !== agent.id) {
      this.tramReservationOverlapViolations += 1;
      return agent.route.tramConflictEntry;
    }
    return undefined;
  }

  private stepAgent(agent: TrafficAgent, leaderGap: number | undefined, dt: number): void {
    const routeLength = polylineLength(agent.route.points);
    agent.previousDistance = agent.distance;
    agent.visibleSeconds += dt;
    agent.spawnAge += dt;
    agent.scale = 1 - (1 - Math.min(1, agent.spawnAge / 0.6)) ** 3;
    agent.priorityRequest = false;

    if (agent.dwellExtensionRemaining > 0 || agent.dwellRemaining > 0) {
      if (agent.dwellExtensionRemaining > 0) agent.dwellExtensionRemaining = Math.max(0, agent.dwellExtensionRemaining - dt);
      else agent.dwellRemaining = Math.max(0, agent.dwellRemaining - dt);
      agent.speed = 0;
      agent.acceleration = 0;
      return;
    }

    let targetSpeed = agent.desiredSpeed;
    const reservationStop = this.tramReservationStop(agent);
    if (reservationStop !== undefined && agent.distance < reservationStop) {
      const distanceToReservation = reservationStop - agent.distance;
      targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * 1.25 * Math.max(0, distanceToReservation - 0.8)));
    }
    const dwellPoint = agent.route.dwellAt ?? routeLength * 0.46;
    if ((agent.mode === 'bus' || agent.mode === 'tram') && !agent.hasDwelled && agent.distance < dwellPoint) {
      const distanceToStop = dwellPoint - agent.distance;
      if (distanceToStop < 24) targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * 1.45 * Math.max(0, distanceToStop - 0.35)));
      if (distanceToStop <= 0.85 && agent.speed < 0.75) {
        agent.distance = dwellPoint;
        agent.previousDistance = dwellPoint;
        this.beginDwell(agent);
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
    let mayCrossSignal = signalState === 'green' && this.downstreamAvailable(agent);
    if (!agent.signalCleared && stopAt !== undefined && agent.distance < stopAt) {
      const distanceToLine = stopAt - agent.distance;
      const comfortableDeceleration = agent.mode === 'tram' ? 1.25 : agent.mode === 'bus' ? 2 : 2.8;
      const brakingDistance = agent.speed * 0.45 + agent.speed * agent.speed / (2 * comfortableDeceleration);
      const amberCommit = signalState === 'amber' && brakingDistance >= Math.max(0, distanceToLine - 0.8);
      mayCrossSignal = (signalState === 'green' || amberCommit) && this.downstreamAvailable(agent);
      if (!mayCrossSignal) {
        targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * comfortableDeceleration * Math.max(0, distanceToLine - 0.8)));
        if (agent.mode === 'tram' && distanceToLine < 2.5 && agent.speed < 0.55) {
          if (!agent.waitingAtSignal) agent.signalWaitCount += 1;
          agent.waitingAtSignal = true;
          agent.signalWaitSeconds += dt;
          this.tramSignalWaitingSeconds += dt;
        }
      } else if (agent.mode === 'tram') agent.waitingAtSignal = false;
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
    if (leaderGap !== undefined) advance = Math.min(advance, Math.max(0, leaderGap - (agent.mode === 'tram' ? 2 : 0.25)));
    let nextDistance = agent.distance + advance;
    agent.speed = nextSpeed;

    if (reservationStop !== undefined && nextDistance >= reservationStop) {
      nextDistance = Math.max(agent.distance, reservationStop - 0.8);
      agent.speed = 0;
      agent.acceleration = 0;
    }

    if ((agent.mode === 'bus' || agent.mode === 'tram') && !agent.hasDwelled && agent.distance < dwellPoint && nextDistance >= dwellPoint) {
      agent.distance = dwellPoint;
      agent.previousDistance = dwellPoint;
      this.beginDwell(agent);
      agent.hasDwelled = true;
      agent.speed = 0;
      agent.acceleration = 0;
      return;
    }

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
    if (agent.mode !== 'tram' && agent.speed < agent.desiredSpeed * 0.5) {
      agent.delaySeconds += dt;
      this.vehicleDelaySeconds += dt;
    }

    if (agent.distance >= routeLength) {
      if (agent.mode === 'tram' && Object.values(this.activeTramReservations).some((owner) => owner !== agent.id)) {
        agent.distance = routeLength - 0.1;
        agent.speed = 0;
        agent.acceleration = 0;
        return;
      }
      if (this.tramReservations.get('tram-intersection') === agent.id) this.tramReservations.delete('tram-intersection');
      agent.distance %= routeLength;
      agent.previousDistance = agent.distance;
      agent.spawnAge = 0;
      agent.scale = 0;
      agent.hasDwelled = false;
      agent.dwellRemaining = 0;
      agent.dwellExtensionRemaining = 0;
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

  private updateVehicleWaits(dt: number): void {
    for (const group of VEHICLE_GROUPS) {
      const queued = this.agents.some((agent) => this.nextSignalStop(agent)?.signalGroup === group && agent.speed < 0.5);
      this.groupWaitSeconds.set(group, queued && group !== this.activeVehicleGroup ? (this.groupWaitSeconds.get(group) ?? 0) + dt : 0);
    }
  }

  private activePedestrianGroups(): MutablePedestrianGroup[] {
    return this.pedestrianGroups.filter((group) => group.signal !== 'stop');
  }

  private groupIsSafe(group: string): boolean {
    const conflicts = TRAFFIC_NETWORK.movementConflicts[group] ?? [];
    if (!this.activePedestrianGroups().every((pedestrian) => !conflicts.includes(pedestrian.id))) return false;
    const zoneId = TRAFFIC_NETWORK.routes
      .flatMap((route) => route.signalStops ?? [])
      .find((stop) => stop.signalGroup === group)?.conflictZoneId;
    if (zoneId === undefined) return true;
    const stationGroups = TRAFFIC_NETWORK.signals.find((signal) => signal.vehicleGroups.includes(group))?.vehicleGroups ?? [group];
    const conflictingOccupants = (this.occupiedInnerZones[zoneId] ?? [])
      .map((id) => this.agents.find((agent) => agent.id === id))
      .filter((agent): agent is TrafficAgent => agent !== undefined)
      .filter((agent) => !stationGroups.includes(this.nextSignalStop(agent)?.signalGroup ?? ''));
    return conflictingOccupants.length === 0;
  }

  private updateSignals(dt: number): void {
    this.stageElapsed += dt;
    this.startCompatiblePedestrians();
    if ((this.tramPriority === 'absolute' || this.tramPriority === 'adaptive') && this.signalStage === 'vehicle-green' && this.stageElapsed >= MINIMUM_GREEN) {
      const requested = this.requestedTransitGroup();
      if (requested) {
        this.pendingTransitGroup = requested;
        this.signalStage = 'vehicle-amber';
        this.stageElapsed = 0;
        return;
      }
    }
    const duration = this.signalStage === 'vehicle-green' ? this.greenDuration
      : this.signalStage === 'vehicle-amber' || this.signalStage === 'transit-amber' ? 3
        : this.signalStage === 'intergreen' || this.signalStage === 'transit-intergreen' ? this.intergreenDuration
          : this.tramPriority === 'standard' ? 6 : this.tramPriority === 'absolute' ? 36 : 24;
    if (this.stageElapsed < duration) return;
    if (this.signalStage === 'transit-green' && this.tramPriority !== 'standard' && this.activeTransitGroup) {
      const corridor = this.activeTransitGroup.match(/^transit-\d+/)?.[0];
      const clearing = this.agents.some((agent) => {
        if (agent.mode !== 'tram' || agent.signalCheckpointIndex === 0) return false;
        const next = signalCheckpoints(agent.route)[agent.signalCheckpointIndex];
        return next?.signalGroup.startsWith(`${corridor}-`) ?? false;
      });
      const maximumHold = this.tramPriority === 'absolute' ? 60 : 45;
      if (clearing && this.stageElapsed < maximumHold) return;
    }
    this.stageElapsed -= duration;
    if (this.signalStage === 'vehicle-green') this.signalStage = 'vehicle-amber';
    else if (this.signalStage === 'vehicle-amber') {
      const target = this.pendingTransitGroup ?? (this.tramPriority === 'standard' ? this.requestedTransitGroup() : undefined);
      this.intergreenDuration = target === undefined ? 1.5 : TRAFFIC_NETWORK.signalIntergreens[this.activeVehicleGroup]?.[target] ?? 1.5;
      this.signalStage = 'intergreen';
    }
    else if (this.signalStage === 'intergreen') {
      const transit = this.pendingTransitGroup ?? (this.tramPriority === 'standard' ? this.requestedTransitGroup() : undefined);
      if (transit && this.groupIsSafe(transit)) {
        this.activeTransitGroup = transit;
        this.pendingTransitGroup = undefined;
        this.signalStage = 'transit-green';
      } else if (transit) {
        // Nie otwieramy kolejnej fazy pod oczekujący tramwaj. Międzyzielone
        // trwa do rzeczywistego opuszczenia konfliktowych przejść.
        this.stageElapsed = 0;
      } else this.beginNextVehiclePhase();
    } else if (this.signalStage === 'transit-green') this.signalStage = 'transit-amber';
    else if (this.signalStage === 'transit-amber') {
      this.intergreenDuration = this.activeTransitGroup === undefined ? 1.5 : TRAFFIC_NETWORK.signalIntergreens[this.activeTransitGroup]?.[this.activeVehicleGroup] ?? 4.5;
      this.signalStage = 'transit-intergreen';
    }
    else {
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
      .filter((request): request is { group: string; distance: number } => request !== undefined && request.distance > 0 && request.distance < 60)
      .sort((a, b) => a.distance - b.distance || a.group.localeCompare(b.group));
    return requests[0]?.group;
  }

  private beginNextVehiclePhase(): void {
    const ringGroups = new Set(TRAFFIC_NETWORK.signals.filter((signal) => signal.kind === 'ring').flatMap((signal) => signal.vehicleGroups));
    const queuedRing = [...this.groupWaitSeconds.entries()]
      .filter(([group, seconds]) => ringGroups.has(group) && seconds > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    let next = queuedRing.find(([group]) => this.groupIsSafe(group))?.[0];
    const starved = [...this.groupWaitSeconds.entries()].filter(([, seconds]) => seconds >= 45).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    next ??= starved.find(([group]) => this.groupIsSafe(group))?.[0];
    for (let offset = 1; !next && offset <= VEHICLE_GROUPS.length; offset += 1) {
      const index = (this.vehicleCursor + offset) % VEHICLE_GROUPS.length;
      const candidate = VEHICLE_GROUPS[index];
      if (this.groupIsSafe(candidate)) {
        next = candidate;
        this.vehicleCursor = index;
      }
    }
    if (!next) {
      this.signalStage = 'intergreen';
      this.stageElapsed = 0;
      return;
    }
    this.activeVehicleGroup = next;
    this.signalStage = 'vehicle-green';
    const queue = this.agents.filter((agent) => agent.route.signalGroup === next && !agent.signalCleared && agent.speed < 1).length;
    const lanes = 1;
    this.greenDuration = clamp(18 + Math.ceil(queue / lanes) * 2, 18, 45);
  }

  vehicleSignal(group: string): VehicleSignalState {
    if (group.startsWith('transit-')) {
      const corridor = (value: string | undefined): string | undefined => value?.match(/^transit-\d+/)?.[0];
      const exact = group === this.activeTransitGroup;
      const corridorMatch = this.tramPriority !== 'standard' && corridor(group) === corridor(this.activeTransitGroup);
      if (!exact && !corridorMatch) return 'red';
      if (this.signalStage === 'transit-green') return 'green';
      if (this.signalStage === 'transit-amber') return 'amber';
      return 'red';
    }
    const matches = group === this.activeVehicleGroup;
    if (!matches) return 'red';
    if (this.signalStage === 'vehicle-green') return 'green';
    if (this.signalStage === 'vehicle-amber') return 'amber';
    return 'red';
  }

  pedestrianSignal(group: string): PedestrianSignalState {
    return this.pedestrianGroups.find((candidate) => candidate.id === group)?.signal ?? 'stop';
  }

  greenGroups(): string[] {
    const groups: string[] = [];
    if (this.signalStage === 'vehicle-green') groups.push(this.activeVehicleGroup);
    if (this.signalStage === 'transit-green' && this.activeTransitGroup) groups.push(this.activeTransitGroup);
    for (const pedestrian of this.pedestrianGroups) if (pedestrian.signal !== 'stop') groups.push(pedestrian.id);
    return groups;
  }

  pose(agent: TrafficAgent): AgentPose {
    const routeLength = polylineLength(agent.route.points);
    const interpolation = clamp(this.accumulator / FIXED_STEP, 0, 1);
    const displayDistance = agent.previousDistance <= agent.distance ? agent.previousDistance + (agent.distance - agent.previousDistance) * interpolation : agent.distance;
    const exitProgress = Math.min(1, Math.max(0, (routeLength - displayDistance) / Math.max(0.1, agent.desiredSpeed * 0.6)));
    return { ...sampleSmoothPolyline(agent.route.points, displayDistance), scale: Math.min(agent.scale, 1 - (1 - exitProgress) ** 3) };
  }

  tramModulePoses(agent: TrafficAgent): AgentPose[] {
    if (agent.mode !== 'tram') return [this.pose(agent)];
    const routeLength = polylineLength(agent.route.points);
    const interpolation = clamp(this.accumulator / FIXED_STEP, 0, 1);
    const centerDistance = agent.previousDistance <= agent.distance
      ? agent.previousDistance + (agent.distance - agent.previousDistance) * interpolation
      : agent.distance;
    return [-6.15, 0, 6.15].map((offset) => ({
      ...sampleSmoothPolyline(agent.route.points, clamp(centerDistance + offset, 0, routeLength)),
      scale: agent.scale,
    }));
  }

  snapshot(): string {
    return JSON.stringify({
      density: this.density,
      profile: this.demandProfile,
      tramPriority: this.tramPriority,
      elapsed: Number(this.elapsed.toFixed(3)),
      signal: [this.activeVehicleGroup, this.signalStage, this.activeTransitGroup, Number(this.stageElapsed.toFixed(3))],
      crossings: [this.signalCrossings, this.redLightViolations, Number(this.tramSignalWaitingSeconds.toFixed(3))],
      tramSafety: [this.tramOverlapViolations, this.tramReservationOverlapViolations, [...this.tramReservations]],
      pedestrians: this.pedestrianGroups.map((group) => [group.id, group.queue, group.signal, group.inCrossing, group.served, Number(group.totalWaitSeconds.toFixed(3)), Number(group.nextArrival.toFixed(3))]),
      agents: this.agents.map((agent) => [
        agent.id, agent.routeId, Number(agent.distance.toFixed(3)), Number(agent.speed.toFixed(3)), Number(agent.acceleration.toFixed(3)),
        Number(agent.dwellRemaining.toFixed(3)), Number(agent.dwellExtensionRemaining.toFixed(3)), agent.signalCleared, agent.signalCheckpointIndex,
        Number(agent.visibleSeconds.toFixed(3)), Number(agent.signalWaitSeconds.toFixed(3)), agent.signalWaitCount, agent.passengerCount,
        agent.boardedPassengers, agent.alightedPassengers, Number(agent.delaySeconds.toFixed(3)),
      ]),
    });
  }
}

export { TARGETS as TRAFFIC_DENSITY_TARGETS, RATAJE_DEMAND_DATASET };
export type { DemandProfile } from './traffic-demand.ts';
