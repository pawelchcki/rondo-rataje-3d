import './style.css';
import { loadSceneData } from './data.ts';
import { RatajeScene } from './scene.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const details = document.querySelector<HTMLElement>('#details');
const status = document.querySelector<HTMLElement>('#status');
const treeCount = document.querySelector<HTMLOutputElement>('#tree-count');
const buildingCount = document.querySelector<HTMLOutputElement>('#building-count');
const stationCount = document.querySelector<HTMLOutputElement>('#station-count');

if (!canvas || !details || !status || !treeCount || !buildingCount || !stationCount) throw new Error('Application shell is incomplete');

try {
  const { manifest, heights } = await loadSceneData();
  const map = new RatajeScene(canvas, details, manifest, heights);
  treeCount.value = String(manifest.trees.length);
  buildingCount.value = String(manifest.buildings.length);
  stationCount.value = String(manifest.stations.length);
  status.textContent = `${manifest.trees.length} trees · ${manifest.buildings.length} buildings · ${manifest.stations.length} stops`;
  status.classList.add('is-ready');

  document.querySelectorAll<HTMLInputElement>('[data-layer]').forEach((input) => {
    input.addEventListener('change', () => {
      map.setLayer(input.dataset.layer as 'terrain' | 'transport' | 'buildings' | 'stations' | 'trees', input.checked);
    });
  });
  document.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener('click', () => map.setView('oblique'));
  document.querySelector<HTMLButtonElement>('[data-action="top"]')?.addEventListener('click', () => map.setView('top'));
  document.querySelector<HTMLInputElement>('[data-action="exaggerate"]')?.addEventListener('change', (event) => {
    map.setExaggeration((event.currentTarget as HTMLInputElement).checked ? 3 : 1);
  });
} catch (error) {
  console.error(error);
  status.textContent = error instanceof Error ? error.message : 'The measured scene could not be loaded.';
  status.classList.add('is-error');
}
