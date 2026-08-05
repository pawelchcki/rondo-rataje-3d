import { describe, expect, it } from 'vitest';
import { TRAFFIC_NETWORK, polylineLength, roadVehicleContained, sampleSmoothPolyline } from '../../src/traffic-network.ts';
import type { ApproachId, TrafficMode } from '../../src/traffic-network.ts';
import { TRAFFIC_DENSITY_TARGETS, TrafficSimulation } from '../../src/traffic-simulation.ts';
import type { TrafficDensity } from '../../src/traffic-simulation.ts';

const approaches: ApproachId[] = ['north-east', 'south-east', 'south-west', 'north-west'];

function pointToPolylineDistance(point: [number, number], points: Array<[number, number]>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const squared = dx * dx + dy * dy;
    const progress = squared === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared));
    best = Math.min(best, Math.hypot(point[0] - (a[0] + dx * progress), point[1] - (a[1] + dy * progress)));
  }
  return best;
}

describe('authored traffic topology', () => {
  it('is finite, local, connected, and mode-safe', () => {
    expect(TRAFFIC_NETWORK.schema).toBe('rondo-rataje-authored-traffic');
    expect(TRAFFIC_NETWORK.disclaimer).toMatch(/nie przedstawia ruchu na żywo/i);
    expect(TRAFFIC_NETWORK.portals).toHaveLength(4);
    expect(TRAFFIC_NETWORK.signals).toHaveLength(8);
    expect(TRAFFIC_NETWORK.signals.filter((signal) => signal.kind === 'entry')).toHaveLength(4);
    expect(TRAFFIC_NETWORK.signals.filter((signal) => signal.kind === 'ring')).toHaveLength(4);
    expect(TRAFFIC_NETWORK.crossings).toHaveLength(8);

    const lanes = new Map(TRAFFIC_NETWORK.lanes.map((lane) => [lane.id, lane]));
    for (const lane of TRAFFIC_NETWORK.lanes) {
      expect(lane.points.length).toBeGreaterThanOrEqual(2);
      expect(polylineLength(lane.points)).toBeGreaterThan(1);
      for (const point of lane.points) {
        expect(point.every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...point)).toBeLessThanOrEqual(200.01);
      }
      for (const successor of lane.successors) expect(lanes.has(successor)).toBe(true);
    }
    for (const route of TRAFFIC_NETWORK.routes) {
      expect(route.points.length).toBeGreaterThanOrEqual(2);
      expect(route.points.flat().every(Number.isFinite)).toBe(true);
      for (const laneId of route.laneIds) {
        const lane = lanes.get(laneId);
        expect(lane, `${route.id} references ${laneId}`).toBeDefined();
        const effectiveMode: TrafficMode = route.mode === 'car' ? 'car' : route.mode;
        expect(lane?.permittedModes).toContain(effectiveMode);
      }
      if (route.mode === 'tram') {
        expect(route.signalStops).toHaveLength(2);
        expect(route.signalStops?.[0].signalGroup).toMatch(/-entry$/);
        expect(route.signalStops?.[1].signalGroup).toMatch(/-ring$/);
        expect(route.signalStops?.[1].distance).toBeGreaterThan(route.signalStops?.[0].distance ?? 0);
        expect(route.signalStops?.every((stop) => stop.type === 'transit' && stop.conflictZoneId === 'tram-intersection')).toBe(true);
      }
    }
  });

  it('places paired crossings on the mapped cycleway intersections', () => {
    const expectedCenters = new Map<string, [number, number]>([
      ['crossing-north-east-inbound', [15.294, 86.326]],
      ['crossing-north-east-outbound', [51.584, 71.586]],
      ['crossing-south-east-inbound', [74.404, -4.984]],
      ['crossing-south-east-outbound', [60.944, -36.334]],
      ['crossing-south-west-inbound', [-2.016, -61.684]],
      ['crossing-south-west-outbound', [-41.866, -43.694]],
      ['crossing-north-west-inbound', [-63.516, 27.316]],
      ['crossing-north-west-outbound', [-46.906, 61.406]],
    ]);
    for (const crossing of TRAFFIC_NETWORK.crossings) {
      const center: [number, number] = [
        (crossing.points[0][0] + crossing.points[1][0]) / 2,
        (crossing.points[0][1] + crossing.points[1][1]) / 2,
      ];
      expect(center).toEqual(expectedCenters.get(crossing.id));
    }
    for (const signal of TRAFFIC_NETWORK.signals.filter((candidate) => candidate.kind === 'entry')) {
      const crossing = TRAFFIC_NETWORK.crossings.find((item) => item.approach === signal.approach && item.carriageway === 'inbound');
      expect(crossing).toBeDefined();
      const center: [number, number] = [
        ((crossing?.points[0][0] ?? 0) + (crossing?.points[1][0] ?? 0)) / 2,
        ((crossing?.points[0][1] ?? 0) + (crossing?.points[1][1] ?? 0)) / 2,
      ];
      expect(Math.hypot(signal.position[0] - center[0], signal.position[1] - center[1])).toBeLessThan(5);
    }
  });

  it('normalizes 16 physical K groups and checkpoints every encountered ring station', () => {
    const groups = [...new Set(TRAFFIC_NETWORK.signals.flatMap((signal) => signal.vehicleGroups))].sort();
    expect(groups).toEqual(Array.from({ length: 16 }, (_, index) => `K${String(index + 1).padStart(2, '0')}`));
    expect(TRAFFIC_NETWORK.provenance.trafficSignalPlan).toMatchObject({ figure: 'rysunek 2.2' });
    expect(TRAFFIC_NETWORK.provenance.trafficSignalPlan.url).toMatch(/MSR_TRAFFIC\.pdf$/);
    expect(TRAFFIC_NETWORK.provenance.mappedPositions).toHaveLength(8);
    expect(TRAFFIC_NETWORK.provenance.locallyFittedPositions).toHaveLength(8);
    for (const route of TRAFFIC_NETWORK.routes.filter((candidate) => candidate.mode === 'car')) {
      const expectedStops = route.turn === 'right' ? 1 : route.turn === 'straight' ? 2 : route.turn === 'left' ? 3 : 4;
      expect(route.signalStops, route.id).toHaveLength(expectedStops);
      expect(route.signalStops?.[0].type).toBe('entry');
      expect(route.signalStops?.slice(1).every((stop) => stop.type === 'ring')).toBe(true);
      expect(route.signalStops?.every((stop, index, stops) => index === 0 || stop.distance > stops[index - 1].distance)).toBe(true);
    }
  });

  it('builds two directional tracks for all three BDOT relations from one dense geometry', () => {
    const tramRoutes = TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'tram');
    expect(tramRoutes.map((route) => route.id).sort()).toEqual([
      'tram-north-south', 'tram-north-west', 'tram-south-north', 'tram-south-west', 'tram-west-north', 'tram-west-south',
    ]);
    for (const track of TRAFFIC_NETWORK.tramTracks) {
      for (let index = 1; index < track.points.length; index += 1) {
        expect(Math.hypot(track.points[index][0] - track.points[index - 1][0], track.points[index][1] - track.points[index - 1][1])).toBeLessThanOrEqual(0.5);
      }
    }
    for (const corridor of ['west-arm', 'north-arm', 'south-arm', 'west-south-curve', 'north-south-curve', 'west-north-curve']) {
      const forward = TRAFFIC_NETWORK.tramTracks.find((track) => track.id === `track-${corridor}-forward`);
      const reverse = TRAFFIC_NETWORK.tramTracks.find((track) => track.id === `track-${corridor}-reverse`);
      expect(forward).toBeDefined();
      expect(reverse).toBeDefined();
      expect(Math.min(...(forward?.points ?? []).map((point) => pointToPolylineDistance(point, reverse?.points ?? [])))).toBeGreaterThanOrEqual(2.9);
      expect(Math.min(...(reverse?.points ?? []).map((point) => pointToPolylineDistance(point, forward?.points ?? [])))).toBeGreaterThanOrEqual(2.9);
    }
    const westSouth = tramRoutes.find((route) => route.id === 'tram-west-south');
    const westNorth = tramRoutes.find((route) => route.id === 'tram-west-north');
    expect(westSouth?.trackSections?.[0].trackId).toBe(westNorth?.trackSections?.[0].trackId);
  });

  it('provides every turn from each approach without illegal private-car lanes', () => {
    for (const approach of approaches) {
      const routes = TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'car' && route.approach === approach);
      expect(routes.map((route) => route.turn).sort()).toEqual(['left', 'right', 'straight', 'u-turn']);
      for (const route of routes) expect(route.laneIds.every((id) => !id.includes('bus') && !id.includes('tram'))).toBe(true);
    }
  });

  it('keeps every complete road-vehicle footprint inside a measured grey carriageway', () => {
    const routes = TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'car' || route.mode === 'bus');
    for (const route of routes) {
      const dimensions: [number, number] = route.mode === 'bus' ? [11.5, 2.45] : [4.2, 1.78];
      const length = polylineLength(route.points);
      for (let distance = dimensions[0] / 2 + 0.25; distance < length - dimensions[0] / 2 - 0.25; distance += 0.5) {
        const pose = sampleSmoothPolyline(route.points, distance);
        expect(
          roadVehicleContained(pose.point, pose.heading, dimensions[0], dimensions[1], 0.01),
          `${route.id} leaves the road at ${distance.toFixed(1)} m`,
        ).toBe(true);
      }
    }
  });

  it('declares signal conflicts symmetrically and never returns conflicting greens', () => {
    for (const [group, conflicts] of Object.entries(TRAFFIC_NETWORK.movementConflicts)) {
      for (const conflict of conflicts) expect(TRAFFIC_NETWORK.movementConflicts[conflict]).toContain(group);
    }
    const simulation = new TrafficSimulation();
    for (let tick = 0; tick < 4_000; tick += 1) {
      simulation.advance(1 / 30);
      const greens = simulation.greenGroups();
      for (const group of greens) {
        const conflicts = TRAFFIC_NETWORK.movementConflicts[group] ?? [];
        expect(greens.some((candidate) => conflicts.includes(candidate))).toBe(false);
      }
    }
  });
});

describe('seeded fixed-step microsimulation', () => {
  it.each(['low', 'medium', 'high'] as TrafficDensity[])('maintains %s targets through a ten-minute run', (density) => {
    const simulation = new TrafficSimulation();
    simulation.setDensity(density);
    expect(simulation.counts).toEqual(TRAFFIC_DENSITY_TARGETS[density]);
    for (let elapsed = 0; elapsed < 600; elapsed += 0.25) simulation.advance(0.25);
    expect(simulation.counts).toEqual(TRAFFIC_DENSITY_TARGETS[density]);
    expect(simulation.agents.every((agent) => Number.isFinite(agent.distance) && agent.speed >= 0)).toBe(true);
    expect(simulation.agents.every((agent) => agent.dwellRemaining >= 0 && agent.dwellRemaining <= 14)).toBe(true);
  }, 15_000);

  it('is deterministic across reset and stable while paused', () => {
    const a = new TrafficSimulation();
    const b = new TrafficSimulation();
    a.reset(42);
    b.reset(42);
    for (let tick = 0; tick < 2_000; tick += 1) {
      a.advance(1 / 60);
      b.advance(1 / 60);
    }
    expect(a.snapshot()).toBe(b.snapshot());
    a.setPaused(true);
    const paused = a.snapshot();
    a.advance(30);
    expect(a.snapshot()).toBe(paused);
    a.setPaused(false);
    a.advance(1);
    expect(a.snapshot()).not.toBe(paused);
  });

  it('lets cars, buses, and trams cross only with signal permission and limits acceleration jerk', () => {
    const simulation = new TrafficSimulation();
    const previousCheckpoint = new Map(simulation.agents.map((agent) => [agent.id, agent.signalCheckpointIndex]));
    const previousAcceleration = new Map(simulation.agents.map((agent) => [agent.id, agent.acceleration]));
    const crossings = { car: 0, bus: 0, tram: 0 };
    for (let tick = 0; tick < 7_200; tick += 1) {
      const checkpointGroups = new Map(simulation.agents.map((agent) => [agent.id, simulation.nextSignalStop(agent)?.signalGroup]));
      simulation.advance(1 / 30);
      for (const agent of simulation.agents) {
        const priorCheckpoint = previousCheckpoint.get(agent.id) ?? agent.signalCheckpointIndex;
        if (agent.signalCheckpointIndex > priorCheckpoint) {
          expect(simulation.vehicleSignal(checkpointGroups.get(agent.id) ?? agent.route.signalGroup)).not.toBe('red');
          crossings[agent.mode] += 1;
        }
        const nextStop = simulation.nextSignalStop(agent);
        if (!agent.signalCleared && nextStop) expect(agent.distance).toBeLessThan(nextStop.distance);
        const priorAcceleration = previousAcceleration.get(agent.id) ?? agent.acceleration;
        if (agent.speed > 0.5 && agent.dwellRemaining === 0) {
          const jerkLimit = agent.mode === 'car' ? 4 : agent.mode === 'bus' ? 1.8 : 1.25;
          expect(Math.abs(agent.acceleration - priorAcceleration)).toBeLessThanOrEqual(jerkLimit / 30 + 0.000_001);
        }
        previousCheckpoint.set(agent.id, agent.signalCheckpointIndex);
        previousAcceleration.set(agent.id, agent.acceleration);
      }
    }
    expect(crossings.car).toBeGreaterThan(0);
    expect(crossings.bus).toBeGreaterThan(0);
    expect(crossings.tram).toBeGreaterThan(0);
    expect(simulation.redLightViolations).toBe(0);
  }, 15_000);

  it('assigns deterministic, mode-appropriate passenger estimates and visible-time counters', () => {
    const a = new TrafficSimulation();
    const b = new TrafficSimulation();
    a.reset(2026);
    b.reset(2026);
    expect(a.agents.map((agent) => agent.passengerCount)).toEqual(b.agents.map((agent) => agent.passengerCount));
    for (const agent of a.agents) {
      const range = agent.mode === 'car' ? [1, 4] : agent.mode === 'bus' ? [12, 80] : [35, 180];
      expect(agent.passengerCount).toBeGreaterThanOrEqual(range[0]);
      expect(agent.passengerCount).toBeLessThanOrEqual(range[1]);
    }
    a.advance(0.2);
    expect(a.agents.some((agent) => agent.visibleSeconds >= 0.19)).toBe(true);
  });

  it('makes the ordinary tram mode wait at two signals while absolute priority remains conflict-safe', () => {
    const absolute = new TrafficSimulation();
    const standard = new TrafficSimulation();
    standard.setTramPriority('standard');
    const maximumStops = { absolute: 0, standard: 0 };
    for (let tick = 0; tick < 9_000; tick += 1) {
      absolute.advance(1 / 30);
      standard.advance(1 / 30);
      maximumStops.absolute = Math.max(maximumStops.absolute, ...absolute.agents.filter((agent) => agent.mode === 'tram').map((agent) => agent.signalWaitCount));
      maximumStops.standard = Math.max(maximumStops.standard, ...standard.agents.filter((agent) => agent.mode === 'tram').map((agent) => agent.signalWaitCount));
    }
    expect(maximumStops.absolute).toBeLessThanOrEqual(1);
    expect(maximumStops.standard).toBe(2);
    expect(absolute.tramSignalWaitingSeconds).toBeLessThan(standard.tramSignalWaitingSeconds * 0.25);
    expect(absolute.redLightViolations).toBe(0);
    expect(standard.redLightViolations).toBe(0);
  }, 15_000);

  it('contains no pedestrian agents or pedestrian demand', () => {
    const simulation = new TrafficSimulation();
    expect(simulation.agents.every((agent) => agent.mode !== ('pedestrian' as never))).toBe(true);
    expect(Object.keys(simulation.counts)).toEqual(['cars', 'buses', 'trams']);
  });

  it('keeps tram track spacing and the intersection reservation overlap-free', () => {
    const simulation = new TrafficSimulation();
    simulation.setDensity('high');
    simulation.setTramPriority('standard');
    simulation.reset(2026);
    for (let elapsed = 0; elapsed < 900; elapsed += 0.25) simulation.advance(0.25);
    expect(simulation.tramOverlapViolations).toBe(0);
    expect(simulation.tramReservationOverlapViolations).toBe(0);
    expect(Object.keys(simulation.activeTramReservations).length).toBeLessThanOrEqual(1);
    expect(simulation.agents.filter((agent) => agent.mode === 'tram').every((agent) => simulation.trackId(agent) !== undefined)).toBe(true);
  }, 15_000);
});
