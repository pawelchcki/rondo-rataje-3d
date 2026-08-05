import { describe, expect, it } from 'vitest';
import { TRAFFIC_NETWORK, polylineLength, roadVehicleContained, sampleSmoothPolyline } from '../../src/traffic-network.ts';
import type { ApproachId, TrafficMode } from '../../src/traffic-network.ts';
import { TRAFFIC_DENSITY_TARGETS, TrafficSimulation } from '../../src/traffic-simulation.ts';
import type { TrafficDensity } from '../../src/traffic-simulation.ts';

const approaches: ApproachId[] = ['north-east', 'south-east', 'south-west', 'north-west'];

describe('authored traffic topology', () => {
  it('is finite, local, connected, and mode-safe', () => {
    expect(TRAFFIC_NETWORK.schema).toBe('rondo-rataje-authored-traffic');
    expect(TRAFFIC_NETWORK.disclaimer).toMatch(/nie przedstawia ruchu na żywo/i);
    expect(TRAFFIC_NETWORK.portals).toHaveLength(4);
    expect(TRAFFIC_NETWORK.signals).toHaveLength(4);
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
    for (const signal of TRAFFIC_NETWORK.signals) {
      const crossing = TRAFFIC_NETWORK.crossings.find((item) => item.approach === signal.approach && item.carriageway === 'inbound');
      expect(crossing).toBeDefined();
      const center: [number, number] = [
        ((crossing?.points[0][0] ?? 0) + (crossing?.points[1][0] ?? 0)) / 2,
        ((crossing?.points[0][1] ?? 0) + (crossing?.points[1][1] ?? 0)) / 2,
      ];
      expect(Math.hypot(signal.position[0] - center[0], signal.position[1] - center[1])).toBeLessThan(5);
    }
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
    const previousClearance = new Map(simulation.agents.map((agent) => [agent.id, agent.signalCleared]));
    const previousAcceleration = new Map(simulation.agents.map((agent) => [agent.id, agent.acceleration]));
    const crossings = { car: 0, bus: 0, tram: 0 };
    for (let tick = 0; tick < 7_200; tick += 1) {
      simulation.advance(1 / 30);
      for (const agent of simulation.agents) {
        const wasCleared = previousClearance.get(agent.id) ?? agent.signalCleared;
        if (!wasCleared && agent.signalCleared) {
          expect(simulation.vehicleSignal(agent.route.signalGroup)).not.toBe('red');
          crossings[agent.mode] += 1;
        }
        if (!agent.signalCleared && agent.route.stopAt !== undefined) expect(agent.distance).toBeLessThan(agent.route.stopAt);
        const priorAcceleration = previousAcceleration.get(agent.id) ?? agent.acceleration;
        if (agent.speed > 0.5 && agent.dwellRemaining === 0) {
          const jerkLimit = agent.mode === 'car' ? 4 : agent.mode === 'bus' ? 1.8 : 1.25;
          expect(Math.abs(agent.acceleration - priorAcceleration)).toBeLessThanOrEqual(jerkLimit / 30 + 0.000_001);
        }
        previousClearance.set(agent.id, agent.signalCleared);
        previousAcceleration.set(agent.id, agent.acceleration);
      }
    }
    expect(crossings.car).toBeGreaterThan(0);
    expect(crossings.bus).toBeGreaterThan(0);
    expect(crossings.tram).toBeGreaterThan(0);
    expect(simulation.redLightViolations).toBe(0);
  }, 15_000);

  it('contains no pedestrian agents or pedestrian demand', () => {
    const simulation = new TrafficSimulation();
    expect(simulation.agents.every((agent) => agent.mode !== ('pedestrian' as never))).toBe(true);
    expect(Object.keys(simulation.counts)).toEqual(['cars', 'buses', 'trams']);
  });
});
