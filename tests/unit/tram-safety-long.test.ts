import { describe, expect, it } from 'vitest';
import { TrafficSimulation } from '../../src/traffic-simulation.ts';
import type { TrafficDensity, TramPriorityMode } from '../../src/traffic-simulation.ts';

const runLongMatrix = process.env.LONG_TRAFFIC_TESTS === '1' ? describe : describe.skip;

runLongMatrix('hourly tram safety matrix', () => {
  const densities: TrafficDensity[] = ['low', 'medium', 'high'];
  const priorities: TramPriorityMode[] = ['adaptive', 'absolute', 'standard'];
  const seeds = [2180, 2026, 99];

  for (const density of densities) {
    for (const priority of priorities) {
      for (const seed of seeds) {
        it(`${density}/${priority}/${seed} has no overlap, reservation collision or red crossing`, async () => {
          const simulation = new TrafficSimulation();
          simulation.setDensity(density);
          simulation.setTramPriority(priority);
          simulation.reset(seed);
          for (let elapsed = 0; elapsed < 3_600; elapsed += 0.25) {
            simulation.advance(0.25);
            if (elapsed > 0 && elapsed % 60 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          expect(simulation.tramOverlapViolations).toBe(0);
          expect(simulation.tramReservationOverlapViolations).toBe(0);
          expect(simulation.redLightViolations).toBe(0);
          expect(simulation.agents.filter((agent) => agent.mode === 'tram').every((agent) => simulation.trackId(agent) !== undefined)).toBe(true);
        }, 300_000);
      }
    }
  }
});
