import { expect, test } from '@playwright/test';
import type { SceneApi } from '../../src/scene.ts';

type RatajeWindow = Window & { __RONDO_RATAJE__?: SceneApi };

test('renders measured terrain and trees and responds to controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.locator('html[data-scene-ready="true"]').waitFor();
  await expect(page.locator('#status')).toContainText('571 drzew · 15 budynków · 11 przystanków');
  await expect(page.locator('#tree-count')).toHaveText('571');
  await expect(page.locator('#building-count')).toHaveText('15');
  await expect(page.locator('#station-count')).toHaveText('11');

  const state = await page.evaluate(() => ({
    ready: (window as Window & { __RONDO_RATAJE__?: { ready: boolean } }).__RONDO_RATAJE__?.ready,
    terrainVertices: (window as Window & { __RONDO_RATAJE__?: { terrainVertices: number } }).__RONDO_RATAJE__?.terrainVertices,
    treeInstances: (window as Window & { __RONDO_RATAJE__?: { treeInstances: number } }).__RONDO_RATAJE__?.treeInstances,
    stationShelters: (window as Window & { __RONDO_RATAJE__?: { stationShelters: number } }).__RONDO_RATAJE__?.stationShelters,
    canvas: document.querySelector<HTMLCanvasElement>('#scene')?.toDataURL().length,
  }));
  expect(state.ready).toBe(true);
  expect(state.terrainVertices).toBeGreaterThan(50_000);
  expect(state.treeInstances).toBe(571);
  expect(state.stationShelters).toBe(11);
  expect(state.canvas).toBeGreaterThan(1_000);

  const traffic = await page.evaluate(() => {
    const api = (window as RatajeWindow).__RONDO_RATAJE__;
    return {
      ready: api?.trafficReady,
      counts: api?.activeAgentCounts,
      density: api?.trafficDensity,
      visible: api?.trafficVisible,
      before: api?.simulationTime ?? 0,
    };
  });
  expect(traffic).toMatchObject({
    ready: true,
    counts: { cars: 40, buses: 4, trams: 2 },
    density: 'medium',
    visible: true,
  });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as RatajeWindow).__RONDO_RATAJE__?.simulationTime ?? 0)).toBeGreaterThan(traffic.before);

  await page.getByRole('button', { name: 'Wstrzymaj ruch' }).click();
  const pausedAt = await page.evaluate(() => (window as RatajeWindow).__RONDO_RATAJE__?.simulationTime ?? 0);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => (window as RatajeWindow).__RONDO_RATAJE__?.simulationTime ?? 0)).toBeCloseTo(pausedAt, 4);
  await page.getByRole('button', { name: 'Wznów ruch' }).click();

  const signalBefore = await page.evaluate(() => (window as RatajeWindow).__RONDO_RATAJE__?.activeSignalGroups.join(','));
  const signalAfter = await page.evaluate(() => {
    const api = (window as RatajeWindow).__RONDO_RATAJE__;
    api?.stepTraffic(16);
    return api?.activeSignalGroups.join(',');
  });
  expect(signalAfter).not.toBe(signalBefore);
  expect(await page.evaluate(() => (window as RatajeWindow).__RONDO_RATAJE__?.trafficRedLightViolations)).toBe(0);

  const hiddenPedestrians = await page.evaluate(() => {
    const api = (window as RatajeWindow).__RONDO_RATAJE__;
    api?.stepTraffic(90);
    return {
      profile: api?.demandProfile,
      groups: api?.pedestrianQueues.length,
      served: api?.servedPedestrians,
      activeSignals: Object.keys(api?.trafficSignals ?? {}).length,
      transitPassengers: api?.totalTransitPassengers,
    };
  });
  expect(hiddenPedestrians).toMatchObject({ profile: 'typical', groups: 11 });
  expect(hiddenPedestrians.served).toBeGreaterThan(0);
  expect(hiddenPedestrians.activeSignals).toBe(31);
  expect(hiddenPedestrians.transitPassengers).toBeGreaterThan(0);
  await expect(page.locator('#pedestrian-served')).not.toHaveText('0');
  await expect(page.locator('#transit-passengers')).not.toHaveText('0');

  await page.getByRole('button', { name: 'Zwykły 2×' }).click();
  const comparison = await page.evaluate(() => {
    const api = (window as RatajeWindow).__RONDO_RATAJE__;
    api?.stepTraffic(1);
    return { mode: api?.tramPriorityMode, telemetry: api?.trafficTelemetry };
  });
  expect(comparison.mode).toBe('standard');
  expect(comparison.telemetry).toHaveLength(46);
  expect(comparison.telemetry?.every((agent) => agent.visibleSeconds > 0 && agent.passengers >= 1)).toBe(true);
  expect(comparison.telemetry?.filter((agent) => agent.mode === 'tram').every((agent) => agent.passengers >= 35)).toBe(true);

  await page.getByRole('button', { name: 'Duże' }).click();
  expect(await page.evaluate(() => (window as RatajeWindow).__RONDO_RATAJE__?.activeAgentCounts)).toEqual({ cars: 70, buses: 7, trams: 3 });
  await page.getByRole('checkbox', { name: 'Ruch' }).uncheck();
  expect(await page.evaluate(() => (window as RatajeWindow).__RONDO_RATAJE__?.trafficVisible)).toBe(false);
  await page.getByRole('checkbox', { name: 'Ruch' }).check();
  expect(await page.evaluate(() => (window as RatajeWindow).__RONDO_RATAJE__?.trafficVisible)).toBe(true);

  await page.getByRole('button', { name: 'Widok z góry' }).click();
  await page.getByLabel(/Drogi i trasy/).uncheck();
  await page.getByLabel(/Budynki/).uncheck();
  await page.getByLabel(/Przystanki/).uncheck();
  await page.getByLabel(/Drzewa/).uncheck();
  await page.getByLabel(/Budynki/).check();
  await page.getByLabel(/Przystanki/).check();
  await page.getByLabel(/Drzewa/).check();
  await page.getByLabel(/Teren ×3/).check();
  await page.getByRole('button', { name: 'Widok ukośny' }).click();
  await page.waitForTimeout(250);
  expect(errors).toEqual([]);
});
