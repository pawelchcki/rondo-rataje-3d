import type { ApproachId } from './traffic-network.ts';

export type DemandEvidence = 'measured' | 'estimated';
export type DemandProfile = 'quiet' | 'typical' | 'peak-2023';

export interface DemandDatum {
  valuePerHour: number;
  evidence: DemandEvidence;
  source: string;
  date: string;
  method: string;
}

export const DEMAND_PROFILE_FACTORS: Record<DemandProfile, number> = {
  quiet: 0.35,
  typical: 0.65,
  'peak-2023': 1,
};

const KRZYWOUSTEGO_PER_HOUR = 3256 / 2.5;

export const RATAJE_DEMAND_DATASET = {
  schema: 'rondo-rataje-demand' as const,
  version: 1 as const,
  vehicleApproaches: {
    'south-east': {
      valuePerHour: KRZYWOUSTEGO_PER_HOUR,
      evidence: 'measured',
      source: 'Pomiar ruchu: 3256 pojazdów w 2,5 h, ul. Krzywoustego',
      date: '2023',
      method: 'strumień pomiarowy znormalizowany do jednej godziny',
    },
    'north-east': {
      valuePerHour: KRZYWOUSTEGO_PER_HOUR * 1.15,
      evidence: 'estimated',
      source: 'Estymacja względem pomiaru ul. Krzywoustego',
      date: '2023',
      method: 'mnożnik 1,15 dla al. Jana Pawła II',
    },
    'north-west': {
      valuePerHour: KRZYWOUSTEGO_PER_HOUR * 0.95,
      evidence: 'estimated',
      source: 'Estymacja względem pomiaru ul. Krzywoustego',
      date: '2023',
      method: 'mnożnik 0,95 dla ul. Królowej Jadwigi',
    },
    'south-west': {
      valuePerHour: KRZYWOUSTEGO_PER_HOUR * 0.85,
      evidence: 'estimated',
      source: 'Estymacja względem pomiaru ul. Krzywoustego',
      date: '2023',
      method: 'mnożnik 0,85 dla ul. Zamenhofa',
    },
  } satisfies Record<ApproachId, DemandDatum>,
  pedestrians: {
    main: {
      valuePerHour: 180,
      evidence: 'estimated',
      source: 'Założenie modelu dla przejść przy terminalu i przystankach',
      date: '2026-08-05',
      method: 'agregatowy strumień Poissona z deterministycznym ziarnem',
    },
    local: {
      valuePerHour: 90,
      evidence: 'estimated',
      source: 'Założenie modelu dla pozostałych przejść',
      date: '2026-08-05',
      method: 'agregatowy strumień Poissona z deterministycznym ziarnem',
    },
  } satisfies Record<'main' | 'local', DemandDatum>,
  transit: {
    tramsPerPortal: {
      valuePerHour: 18,
      evidence: 'estimated',
      source: 'Założenie scenariusza czterech portali tramwajowych',
      date: '2026-08-05',
      method: '18 wjazdów/h/portal, 72 wjazdy/h łącznie',
    },
    buses: {
      valuePerHour: 48,
      evidence: 'estimated',
      source: 'Założenie scenariusza autobusowego',
      date: '2026-08-05',
      method: '48 wjazdów/h, w tym 40% przez buspas',
    },
  } satisfies Record<string, DemandDatum>,
};
