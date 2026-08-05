import { describe, expect, it } from 'vitest';
import { TRAFFIC_NETWORK } from '../../src/traffic-network.ts';
import { RATAJE_DEMAND_DATASET, TrafficSimulation } from '../../src/traffic-simulation.ts';

function run(simulation: TrafficSimulation, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.25) simulation.advance(0.25);
}

describe('engineering traffic model', () => {
  it('declares distinct physical and signal safety layers', () => {
    const vehicleGroups = new Set(TRAFFIC_NETWORK.routes.filter((route) => route.mode === 'car').map((route) => route.signalGroup));
    expect(vehicleGroups.size).toBe(16);
    expect(TRAFFIC_NETWORK.pedestrianGroups).toHaveLength(11);
    expect(TRAFFIC_NETWORK.detectors).toHaveLength(99);
    expect(TRAFFIC_NETWORK.conflictZones.length).toBeGreaterThanOrEqual(4);
    expect(TRAFFIC_NETWORK.downstreamSectors).toHaveLength(4);
    expect(TRAFFIC_NETWORK.roundaboutLaneChanges).toBe(false);
    expect(TRAFFIC_NETWORK.trajectoryConflicts).not.toBe(TRAFFIC_NETWORK.movementConflicts);
    for (const route of TRAFFIC_NETWORK.routes) {
      expect(route.orderedStopLines).toBeDefined();
      expect(route.conflictZoneIds).toBeDefined();
      expect(route.downstreamSectorIds).toBeDefined();
    }
    for (const [group, conflicts] of Object.entries(TRAFFIC_NETWORK.movementConflicts)) {
      for (const conflict of conflicts) expect(TRAFFIC_NETWORK.movementConflicts[conflict]).toContain(group);
    }
  });

  it('documents measured and estimated demand with reproducible profiles', () => {
    expect(RATAJE_DEMAND_DATASET.vehicleApproaches['south-east'].valuePerHour).toBeCloseTo(3256 / 2.5);
    expect(RATAJE_DEMAND_DATASET.vehicleApproaches['south-east'].evidence).toBe('measured');
    expect(RATAJE_DEMAND_DATASET.vehicleApproaches['north-east'].evidence).toBe('estimated');
    expect(RATAJE_DEMAND_DATASET.pedestrians.main.valuePerHour).toBe(180);
    expect(RATAJE_DEMAND_DATASET.pedestrians.local.valuePerHour).toBe(90);
    expect(RATAJE_DEMAND_DATASET.transit.tramsPerPortal.valuePerHour).toBe(18);
    expect(RATAJE_DEMAND_DATASET.transit.buses.valuePerHour).toBe(48);
  });

  it('serves every deterministic pedestrian queue and keeps conflicting greens apart', () => {
    const simulation = new TrafficSimulation();
    for (let elapsed = 0; elapsed < 900; elapsed += 0.25) {
      simulation.advance(0.25);
      const greens = simulation.greenGroups();
      for (const group of greens) {
        const conflicts = TRAFFIC_NETWORK.movementConflicts[group] ?? [];
        expect(greens.some((candidate) => conflicts.includes(candidate))).toBe(false);
      }
    }
    expect(simulation.pedestrianGroups.every((group) => group.served > 0)).toBe(true);
    expect(simulation.pedestrianGroups.every((group) => group.maximumWaitSeconds < 180)).toBe(true);
    expect(simulation.redLightViolations).toBe(0);
  }, 15_000);

  it('adds pedestrian phase occupancy and delay relative to identical zero demand', () => {
    const withoutPedestrians = new TrafficSimulation();
    withoutPedestrians.setPedestrianDemand(false);
    const withPedestrians = new TrafficSimulation();
    run(withoutPedestrians, 900);
    run(withPedestrians, 900);
    expect(withoutPedestrians.pedestrianGroups.reduce((sum, group) => sum + group.served, 0)).toBe(0);
    expect(withPedestrians.pedestrianGroups.reduce((sum, group) => sum + group.served, 0)).toBeGreaterThan(0);
    expect(withPedestrians.vehicleDelaySeconds).toBeGreaterThan(withoutPedestrians.vehicleDelaySeconds);
  }, 15_000);

  it('balances passenger exchange and keeps observed dwell duration in bounds', () => {
    const simulation = new TrafficSimulation();
    run(simulation, 900);
    const transit = simulation.agents.filter((agent) => agent.mode !== 'car');
    expect(transit.some((agent) => agent.dwellCount > 0)).toBe(true);
    for (const agent of transit) {
      expect(agent.passengerCount).toBe(agent.initialPassengerCount - agent.alightedPassengers + agent.boardedPassengers);
      expect(agent.passengerCount).toBeGreaterThanOrEqual(0);
      expect(agent.passengerCount).toBeLessThanOrEqual(agent.passengerCapacity);
      if (agent.dwellCount > 0) {
        expect(agent.lastDwellSeconds).toBeGreaterThanOrEqual(14.3);
        expect(agent.lastDwellSeconds).toBeLessThanOrEqual(28.4);
      }
    }
    for (const car of simulation.agents.filter((agent) => agent.mode === 'car')) expect(car.passengerCount).toBe(car.initialPassengerCount);
  }, 15_000);
});
