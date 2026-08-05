import './style.css';
import { loadSceneData } from './data.ts';
import { RatajeScene } from './scene.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const details = document.querySelector<HTMLElement>('#details');
const status = document.querySelector<HTMLElement>('#status');
const treeCount = document.querySelector<HTMLOutputElement>('#tree-count');
const buildingCount = document.querySelector<HTMLOutputElement>('#building-count');
const stationCount = document.querySelector<HTMLOutputElement>('#station-count');
const trafficCount = document.querySelector<HTMLOutputElement>('#traffic-count');

if (!canvas || !details || !status || !treeCount || !buildingCount || !stationCount || !trafficCount) throw new Error('Interfejs aplikacji jest niekompletny');

try {
  const { manifest, heights } = await loadSceneData();
  const map = new RatajeScene(canvas, details, manifest, heights);
  treeCount.value = String(manifest.trees.length);
  buildingCount.value = String(manifest.buildings.length);
  stationCount.value = String(manifest.stations.length);
  const updateTrafficCount = (): void => {
    const counts = map.api.activeAgentCounts;
    trafficCount.value = String(counts.cars + counts.buses + counts.trams);
  };
  updateTrafficCount();
  status.textContent = `${manifest.trees.length} drzew · ${manifest.buildings.length} budynków · ${manifest.stations.length} przystanków · symulacja gotowa`;
  status.classList.add('is-ready');

  document.querySelectorAll<HTMLInputElement>('[data-layer]').forEach((input) => {
    input.addEventListener('change', () => {
      map.setLayer(input.dataset.layer as 'terrain' | 'transport' | 'buildings' | 'stations' | 'trees' | 'traffic', input.checked);
    });
  });
  document.querySelector<HTMLButtonElement>('[data-action="reset"]')?.addEventListener('click', () => map.setView('oblique'));
  document.querySelector<HTMLButtonElement>('[data-action="top"]')?.addEventListener('click', () => map.setView('top'));
  document.querySelector<HTMLInputElement>('[data-action="exaggerate"]')?.addEventListener('change', (event) => {
    map.setExaggeration((event.currentTarget as HTMLInputElement).checked ? 3 : 1);
  });
  const trafficToggle = document.querySelector<HTMLButtonElement>('[data-action="traffic-toggle"]');
  trafficToggle?.addEventListener('click', () => {
    const paused = !map.api.trafficPaused;
    map.api.setTrafficPaused(paused);
    trafficToggle.textContent = paused ? 'Wznów ruch' : 'Wstrzymaj ruch';
    trafficToggle.setAttribute('aria-pressed', String(paused));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-density]').forEach((button) => {
    button.addEventListener('click', () => {
      const density = button.dataset.density;
      if (density !== 'low' && density !== 'medium' && density !== 'high') return;
      map.api.setTrafficDensity(density);
      document.querySelectorAll<HTMLButtonElement>('[data-density]').forEach((candidate) => {
        candidate.setAttribute('aria-pressed', String(candidate === button));
      });
      updateTrafficCount();
    });
  });
} catch (error) {
  console.error(error);
  status.textContent = error instanceof Error ? error.message : 'Nie udało się wczytać sceny.';
  status.classList.add('is-error');
}
