import { expect, test } from '@playwright/test';

test('renders measured terrain and trees and responds to controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.locator('html[data-scene-ready="true"]').waitFor();
  await expect(page.locator('#status')).toContainText('571 trees · 15 buildings · 11 stops');
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

  await page.getByRole('button', { name: 'Top view' }).click();
  await page.getByLabel(/Movement/).uncheck();
  await page.getByLabel(/Buildings/).uncheck();
  await page.getByLabel(/Stops/).uncheck();
  await page.getByLabel(/Trees/).uncheck();
  await page.getByLabel(/Buildings/).check();
  await page.getByLabel(/Stops/).check();
  await page.getByLabel(/Trees/).check();
  await page.getByLabel(/Terrain ×3/).check();
  await page.getByRole('button', { name: 'Oblique' }).click();
  await page.waitForTimeout(250);
  expect(errors).toEqual([]);
});
