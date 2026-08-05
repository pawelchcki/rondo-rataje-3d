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
  const updateSimulationMetrics = (): void => {
    const groups = map.api.pedestrianQueues;
    const waiting = groups.reduce((sum, group) => sum + group.queue, 0);
    const served = groups.reduce((sum, group) => sum + group.served, 0);
    const totalWait = groups.reduce((sum, group) => sum + group.totalWaitSeconds, 0);
    const maximumWait = Math.max(0, ...groups.map((group) => Math.max(group.maximumWaitSeconds, group.currentMaximumWaitSeconds)));
    const active = groups.filter((group) => group.signal !== 'stop').map((group) => `${group.id} ${group.signal === 'walk' ? 'idź' : 'zejście'}`);
    const transit = map.api.trafficTelemetry.filter((agent) => agent.mode !== 'car');
    const lastDwell = Math.max(0, ...transit.map((agent) => agent.dwellSeconds));
    const setText = (id: string, text: string): void => {
      const element = document.querySelector<HTMLElement>(`#${id}`);
      if (element) element.textContent = text;
    };
    setText('pedestrian-waiting', String(waiting));
    setText('pedestrian-served', String(served));
    setText('pedestrian-wait-time', `${(served > 0 ? totalWait / served : 0).toFixed(1).replace('.', ',')} / ${maximumWait.toFixed(1).replace('.', ',')} s`);
    setText('pedestrian-phase', active.join(', ') || '—');
    setText('transit-passengers', String(map.api.totalTransitPassengers));
    setText('passenger-exchange', `${map.api.passengerBoardings} / ${map.api.passengerAlightings}`);
    setText('transit-dwell', lastDwell > 0 ? `${lastDwell.toFixed(1).replace('.', ',')} s` : '—');
  };
  updateTrafficCount();
  updateSimulationMetrics();
  window.setInterval(updateSimulationMetrics, 250);
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
      updateSimulationMetrics();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-tram-priority]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.tramPriority;
      if (mode !== 'adaptive' && mode !== 'absolute' && mode !== 'standard') return;
      map.api.setTramPriorityMode(mode);
      document.querySelectorAll<HTMLButtonElement>('[data-tram-priority]').forEach((candidate) => {
        candidate.setAttribute('aria-pressed', String(candidate === button));
      });
    });
  });
} catch (error) {
  console.error(error);
  status.textContent = error instanceof Error ? error.message : 'Nie udało się wczytać sceny.';
  status.classList.add('is-error');
}
