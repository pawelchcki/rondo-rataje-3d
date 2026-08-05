import type { Point2 } from './types.ts';

export type TrafficMode = 'car' | 'bus' | 'tram';
export type LaneKind = 'general' | 'bus' | 'tram';
export type TurnKind = 'right' | 'straight' | 'left' | 'u-turn' | 'transit' | 'crossing';
export type ApproachId = 'north-east' | 'south-east' | 'south-west' | 'north-west';

export interface TrafficLane {
  id: string;
  kind: LaneKind;
  points: Point2[];
  speedLimit: number;
  successors: string[];
  permittedModes: TrafficMode[];
}

export interface TrafficPortal {
  id: ApproachId;
  inbound: Point2;
  outbound: Point2;
  inboundLanes: string[];
  outboundLanes: string[];
}

export interface TrafficRoute {
  id: string;
  mode: TrafficMode;
  points: Point2[];
  laneIds: string[];
  turn: TurnKind;
  signalGroup: string;
  approach?: ApproachId;
  stopAt?: number;
  dwellAt?: number;
  signalStops?: TrafficSignalStop[];
  orderedStopLines?: TrafficSignalStop[];
  conflictZoneIds?: string[];
  downstreamSectorIds?: string[];
  trackSections?: TrafficTrackSection[];
  tramConflictEntry?: number;
  tramConflictExit?: number;
}

export type TrafficSignalStopKind = 'entry' | 'ring' | 'transit';

export interface TrafficSignalStop {
  distance: number;
  signalGroup: string;
  type: TrafficSignalStopKind;
  conflictZoneId: string;
}

export interface TrafficTrackSection {
  trackId: string;
  startDistance: number;
  endDistance: number;
  trackStartDistance: number;
  conflictZoneId?: string;
}

export interface TramTrack {
  id: string;
  corridorId: string;
  direction: 'forward' | 'reverse';
  points: Point2[];
  gauge: 1.435;
  centerOffset: 1.55;
  source: 'BDOT10k OT_SKTR_L';
}

export interface TrafficCrossing {
  id: string;
  points: [Point2, Point2];
  signalGroup: string;
  conflictsWith: string[];
  approach: ApproachId;
  carriageway: 'inbound' | 'outbound';
}

export interface PedestrianSignalGroup {
  id: string;
  points: [Point2, Point2];
  conflictsWith: string[];
  demandClass: 'main' | 'local';
  source: 'estimated';
}

export interface TrafficStop {
  id: string;
  position: Point2;
  modes: Array<'bus' | 'tram'>;
  dwellSeconds: [number, number];
}

export interface TrafficSignal {
  id: string;
  approach: ApproachId;
  position: Point2;
  heading: number;
  kind: 'entry' | 'ring';
  vehicleGroup: string;
  vehicleGroups: [string, string];
  pedestrianGroup?: string;
  sourcePosition: 'mapped-from-msr-plan' | 'locally-fitted-to-scene';
}

export interface TrafficDetector {
  id: string;
  group: string;
  distance: number;
  position: Point2;
}

export interface TrafficConflictZone {
  id: string;
  center: Point2;
  radius: number;
  groups: string[];
}

export interface TrafficDownstreamSector {
  id: string;
  capacityMetres: number;
  routeIds: string[];
}

export interface TrafficNetwork {
  schema: 'rondo-rataje-authored-traffic';
  version: 1;
  crs: 'EPSG:2180-local-metres';
  disclaimer: string;
  lanes: TrafficLane[];
  portals: TrafficPortal[];
  routes: TrafficRoute[];
  crossings: TrafficCrossing[];
  pedestrianGroups: PedestrianSignalGroup[];
  stops: TrafficStop[];
  signals: TrafficSignal[];
  detectors: TrafficDetector[];
  conflictZones: TrafficConflictZone[];
  downstreamSectors: TrafficDownstreamSector[];
  trajectoryConflicts: Record<string, string[]>;
  movementConflicts: Record<string, string[]>;
  signalIntergreens: Record<string, Record<string, number>>;
  roundaboutLaneChanges: false;
  roadSurfaces: TrafficRoadSurface[];
  tramTracks: TramTrack[];
  provenance: {
    trafficSignalPlan: { title: string; url: string; figure: string };
    mappedPositions: string[];
    locallyFittedPositions: string[];
  };
}

export interface TrafficRoadSurface {
  id: string;
  centerline: Point2[];
  width: number;
}

const APPROACHES: Array<{
  id: ApproachId;
  inbound: Point2[];
  outbound: Point2[];
  node: Point2;
}> = [
  {
    id: 'north-east',
    inbound: [[59.315, 185.76], [52.334, 172.016], [44.114, 154.476], [35.104, 131.666], [24.584, 103.686], [15.294, 86.326], [11.104, 82.156], [3.614, 74.186], [-10.026, 62.876]],
    outbound: [[58.594, 30.426], [52.784, 52.956], [51.024, 67.326], [51.584, 71.586], [52.384, 77.626], [58.754, 100.126], [66.394, 124.746], [73.824, 146.816], [84.468, 173.534]],
    node: [-10.026, 62.876],
  },
  {
    id: 'north-west',
    inbound: [[-175.189, 85.638], [-172.646, 84.476], [-87.806, 43.376], [-72.406, 34.946], [-63.516, 27.316], [-58.056, 20.916], [-51.996, 10.556], [-46.196, -2.144]],
    outbound: [[-10.026, 62.876], [-32.266, 60.306], [-46.906, 61.406], [-50.876, 61.936], [-59.846, 64.886], [-84.606, 75.766], [-105.626, 84.636], [-160.636, 107.376], [-162.314, 108.071]],
    node: [-46.196, -2.144],
  },
  {
    id: 'south-west',
    inbound: [[-60.557, -185.359], [-54.676, -170.084], [-44.506, -145.714], [-31.626, -118.534], [-21.496, -97.004], [-13.446, -81.064], [-5.716, -67.424], [-2.016, -61.684], [3.444, -55.724], [10.674, -50.094], [21.444, -44.594], [30.734, -40.724]],
    outbound: [[-46.196, -2.144], [-44.576, -17.564], [-43.866, -30.234], [-42.506, -38.204], [-41.866, -43.694], [-41.396, -56.944], [-43.146, -65.874], [-45.696, -76.554], [-57.016, -109.004], [-73.766, -151.584], [-83.528, -175.651]],
    node: [30.734, -40.724],
  },
  {
    id: 'south-east',
    inbound: [[179.333, -71.336], [150.224, -55.644], [100.094, -28.314], [88.194, -21.444], [80.964, -15.044], [77.544, -10.554], [74.404, -4.984], [72.094, -0.824], [58.594, 30.426]],
    outbound: [[30.734, -40.724], [36.334, -38.674], [42.924, -37.444], [49.224, -36.414], [56.564, -35.854], [60.944, -36.334], [67.644, -37.054], [75.294, -38.324], [101.054, -50.504], [153.734, -78.974], [173.659, -89.793]],
    node: [58.594, 30.426],
  },
];

const ROUNDABOUT: Point2[][] = [
  [[-10.026, 62.876], [-19.736, 59.196], [-28.436, 53.176], [-34.456, 47.156], [-39.816, 39.126], [-41.616, 35.946], [-44.166, 31.426], [-46.846, 21.396], [-47.516, 12.356], [-46.196, -2.144]],
  [[-46.196, -2.144], [-40.506, -16.964], [-37.366, -22.164], [-30.256, -31.204], [-21.956, -37.274], [-13.806, -41.574], [-5.306, -44.004], [2.644, -44.904], [12.944, -44.624], [20.694, -43.074], [30.734, -40.724]],
  [[30.734, -40.724], [41.894, -32.994], [48.504, -27.104], [52.444, -22.334], [55.174, -17.684], [58.714, -9.114], [59.924, -3.324], [61.474, 4.946], [61.594, 11.766], [60.794, 19.716], [58.594, 30.426]],
  [[58.594, 30.426], [52.904, 40.796], [44.194, 49.826], [35.164, 56.856], [26.644, 61.296], [17.084, 64.216], [8.214, 65.246], [0.054, 64.746], [-10.026, 62.876]],
];

const TURN_STEPS: Record<Extract<TurnKind, 'right' | 'straight' | 'left' | 'u-turn'>, number> = {
  right: 0,
  straight: 1,
  left: 2,
  'u-turn': 3,
};

const SIGNAL_APPROACH_ORDER: ApproachId[] = ['north-east', 'south-east', 'south-west', 'north-west'];

function signalGroups(approach: ApproachId): { entry: [string, string]; ring: [string, string] } {
  const first = SIGNAL_APPROACH_ORDER.indexOf(approach) * 4 + 1;
  const id = (offset: number): string => `K${String(first + offset).padStart(2, '0')}`;
  return { entry: [id(0), id(1)], ring: [id(2), id(3)] };
}

const TRAM_CORRIDOR_CENTERLINES: Array<{ id: string; points: Point2[]; conflictZone?: string }> = [
  {
    id: 'west-arm',
    points: [[-169.994, 100.343], [-141.866, 87.856], [-105.046, 69.886], [-82.706, 58.216], [-55.336, 43.376], [-41.616, 35.946], [-31.216, 30.306]],
  },
  {
    id: 'north-arm',
    points: [[20.684, 46.076], [26.644, 61.296], [33.544, 78.936], [51.694, 125.296], [74.104, 182.963]],
  },
  {
    id: 'south-arm',
    points: [[-4.196, -16.364], [-13.806, -41.574], [-41.626, -112.624], [-70.666, -184.318]],
  },
  {
    id: 'west-south-curve',
    points: [[-31.216, 30.306], [-30.296, 29.746], [-20.776, 23.896], [-15.726, 18.856], [-10.466, 12.276], [-7.026, 5.696], [-4.976, -0.664], [-4.096, -8.354], [-4.196, -16.364]],
    conflictZone: 'tram-intersection',
  },
  {
    id: 'north-south-curve',
    points: [[20.684, 46.076], [7.904, 13.416], [-4.196, -16.364]],
    conflictZone: 'tram-intersection',
  },
  {
    id: 'west-north-curve',
    points: [[-31.216, 30.306], [-21.446, 27.496], [-14.676, 26.236], [-8.406, 26.206], [-0.626, 27.466], [5.714, 29.586], [11.244, 32.756], [15.264, 38.426], [20.684, 46.076]],
    conflictZone: 'tram-intersection',
  },
];

const CROSSING_PLAN: Array<{
  approach: ApproachId;
  carriageway: 'inbound' | 'outbound';
  center: Point2;
  along: Point2;
  length: number;
}> = [
  { approach: 'north-east', carriageway: 'inbound', center: [15.294, 86.326], along: [-15.66, 6.27], length: 11 },
  { approach: 'north-east', carriageway: 'outbound', center: [51.584, 71.586], along: [-31.57, 12.45], length: 15 },
  { approach: 'south-east', carriageway: 'inbound', center: [74.404, -4.984], along: [14.25, 22.34], length: 15 },
  { approach: 'south-east', carriageway: 'outbound', center: [60.944, -36.334], along: [8.95, 26.18], length: 10 },
  { approach: 'south-west', carriageway: 'inbound', center: [-2.016, -61.684], along: [-56.17, 24.61], length: 11 },
  { approach: 'south-west', carriageway: 'outbound', center: [-41.866, -43.694], along: [-54.17, 23.88], length: 12 },
  { approach: 'north-west', carriageway: 'inbound', center: [-63.516, 27.316], along: [-19.11, -27.68], length: 11 },
  { approach: 'north-west', carriageway: 'outbound', center: [-46.906, 61.406], along: [-12.71, -32.08], length: 11 },
];

function centeredSegment(center: Point2, direction: Point2, length: number): [Point2, Point2] {
  const magnitude = Math.hypot(...direction) || 1;
  const dx = direction[0] / magnitude * length / 2;
  const dy = direction[1] / magnitude * length / 2;
  return [[center[0] - dx, center[1] - dy], [center[0] + dx, center[1] + dy]];
}

function offsetPolyline(points: Point2[], offset: number): Point2[] {
  return points.map((point, index) => {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy) || 1;
    return [point[0] - (dy / length) * offset, point[1] + (dx / length) * offset];
  });
}

function interpolatePoint(a: Point2, b: Point2, ta: number, tb: number, t: number): Point2 {
  const span = Math.max(1e-6, tb - ta);
  const weight = (t - ta) / span;
  return [a[0] + (b[0] - a[0]) * weight, a[1] + (b[1] - a[1]) * weight];
}

function centripetalSpan(p0: Point2, p1: Point2, p2: Point2, p3: Point2, progress: number): Point2 {
  const nextT = (previous: number, a: Point2, b: Point2): number => previous + Math.sqrt(Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = nextT(t0, p0, p1);
  const t2 = nextT(t1, p1, p2);
  const t3 = nextT(t2, p2, p3);
  const t = t1 + (t2 - t1) * progress;
  const a1 = interpolatePoint(p0, p1, t0, t1, t);
  const a2 = interpolatePoint(p1, p2, t1, t2, t);
  const a3 = interpolatePoint(p2, p3, t2, t3, t);
  const b1 = interpolatePoint(a1, a2, t0, t2, t);
  const b2 = interpolatePoint(a2, a3, t1, t3, t);
  return interpolatePoint(b1, b2, t1, t2, t);
}

/** Centripetal Catmull–Rom sampling shared by rails, routes and vehicle poses. */
export function sampleCentripetalPolyline(controlPoints: Point2[], maximumStep = 0.5): Point2[] {
  if (controlPoints.length < 2) return [...controlPoints];
  const points: Point2[] = [controlPoints[0]];
  for (let index = 0; index < controlPoints.length - 1; index += 1) {
    const p1 = controlPoints[index];
    const p2 = controlPoints[index + 1];
    const p0: Point2 = index === 0
      ? [p1[0] * 2 - p2[0], p1[1] * 2 - p2[1]]
      : controlPoints[index - 1];
    const p3: Point2 = index + 2 >= controlPoints.length
      ? [p2[0] * 2 - p1[0], p2[1] * 2 - p1[1]]
      : controlPoints[index + 2];
    const localEstimate = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
      + 0.12 * (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]));
    const steps = Math.max(1, Math.ceil(localEstimate / Math.max(0.1, maximumStep * 0.72)));
    for (let step = 1; step <= steps; step += 1) points.push(centripetalSpan(p0, p1, p2, p3, step / steps));
  }
  return points.filter((point, index) => index === 0 || Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > 1e-5);
}

function densifyLinear(points: Point2[], maximumStep = 0.45): Point2[] {
  const result: Point2[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    const length = Math.hypot(after[0] - before[0], after[1] - before[1]);
    const steps = Math.max(1, Math.ceil(length / maximumStep));
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      result.push([before[0] + (after[0] - before[0]) * progress, before[1] + (after[1] - before[1]) * progress]);
    }
  }
  return result;
}

function buildTramTracks(): TramTrack[] {
  const tracks: TramTrack[] = TRAM_CORRIDOR_CENTERLINES.flatMap((corridor): TramTrack[] => {
    const smoothCenterline = sampleCentripetalPolyline(corridor.points);
    const forward = offsetPolyline(smoothCenterline, -1.55);
    const reverse = [...offsetPolyline(smoothCenterline, 1.55)].reverse();
    return [
      { id: `track-${corridor.id}-forward`, corridorId: corridor.id, direction: 'forward', points: forward, gauge: 1.435, centerOffset: 1.55, source: 'BDOT10k OT_SKTR_L' },
      { id: `track-${corridor.id}-reverse`, corridorId: corridor.id, direction: 'reverse', points: reverse, gauge: 1.435, centerOffset: 1.55, source: 'BDOT10k OT_SKTR_L' },
    ];
  });
  const track = (id: string): TramTrack => {
    const result = tracks.find((candidate) => candidate.id === id);
    if (!result) throw new Error(`Missing authored tram track ${id}`);
    return result;
  };
  const fitCurve = (curveId: string, incomingId: string, outgoingId: string): void => {
    const curve = track(curveId);
    const incoming = track(incomingId);
    const outgoing = track(outgoingId);
    curve.points[0] = [...(incoming.points.at(-1) ?? curve.points[0])] as Point2;
    curve.points[curve.points.length - 1] = [...outgoing.points[0]] as Point2;
  };
  fitCurve('track-west-south-curve-forward', 'track-west-arm-forward', 'track-south-arm-forward');
  fitCurve('track-west-south-curve-reverse', 'track-south-arm-reverse', 'track-west-arm-reverse');
  fitCurve('track-north-south-curve-forward', 'track-north-arm-reverse', 'track-south-arm-forward');
  fitCurve('track-north-south-curve-reverse', 'track-south-arm-reverse', 'track-north-arm-forward');
  fitCurve('track-west-north-curve-forward', 'track-west-arm-forward', 'track-north-arm-forward');
  fitCurve('track-west-north-curve-reverse', 'track-north-arm-reverse', 'track-west-arm-reverse');
  for (const item of tracks) item.points = densifyLinear(item.points);
  return tracks;
}

function withoutDuplicateJoints(parts: Point2[][]): Point2[] {
  const result: Point2[] = [];
  for (const part of parts) {
    for (const point of part) {
      const last = result.at(-1);
      if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.2) result.push(point);
    }
  }
  return result;
}

function nearestDistanceOnPolyline(points: Point2[], target: Point2): number {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((target[0] - a[0]) * dx + (target[1] - a[1]) * dy) / (length * length)));
    const distance = Math.hypot(target[0] - (a[0] + dx * t), target[1] - (a[1] + dy * t));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = travelled + length * t;
    }
    travelled += length;
  }
  return bestAlong;
}

function buildNetwork(): TrafficNetwork {
  const lanes: TrafficLane[] = [];
  const portals: TrafficPortal[] = [];
  const routes: TrafficRoute[] = [];
  const crossings: TrafficCrossing[] = [];
  const signals: TrafficSignal[] = [];
  const tramTracks = buildTramTracks();
  const roadSurfaces: TrafficRoadSurface[] = [
    { id: 'north-east-in', centerline: APPROACHES[0].inbound, width: 10 },
    { id: 'north-east-out', centerline: APPROACHES[0].outbound, width: 14 },
    { id: 'north-west-in', centerline: APPROACHES[1].inbound, width: 10 },
    { id: 'north-west-out', centerline: APPROACHES[1].outbound, width: 10 },
    { id: 'south-west-in', centerline: APPROACHES[2].inbound, width: 10 },
    { id: 'south-west-out', centerline: APPROACHES[2].outbound, width: 11 },
    { id: 'south-east-in', centerline: APPROACHES[3].inbound, width: 14 },
    { id: 'south-east-out', centerline: APPROACHES[3].outbound, width: 9 },
    ...ROUNDABOUT.map((centerline, index) => ({ id: `roundabout-${index + 1}`, centerline, width: 12 })),
  ];

  const pedestrianGroups: PedestrianSignalGroup[] = [];

  for (const [index, crossing] of CROSSING_PLAN.entries()) {
    const id = `ped-${String(index + 1).padStart(2, '0')}`;
    const points = centeredSegment(crossing.center, crossing.along, crossing.length);
    crossings.push({
      id: `crossing-${crossing.approach}-${crossing.carriageway}`,
      points,
      signalGroup: id,
      conflictsWith: [],
      approach: crossing.approach,
      carriageway: crossing.carriageway,
    });
    pedestrianGroups.push({
      id,
      points,
      conflictsWith: [],
      demandClass: index === 0 || index === 1 || index === 4 || index === 5 ? 'main' : 'local',
      source: 'estimated',
    });
  }

  // Trzy dodatkowe grupy P/R z planu sygnalizacji obsługują dojścia do
  // terminalu i peronów. Są agregatami sterownika; postacie nie są renderowane.
  for (const [id, center, direction, length, demandClass] of [
    ['ped-09', [46, 99], [-22, 9], 9, 'main'],
    ['ped-10', [-35, 37], [-12, -20], 8, 'main'],
    ['ped-11', [-27, -78], [-19, 8], 9, 'main'],
  ] as Array<[string, Point2, Point2, number, 'main' | 'local']>) {
    pedestrianGroups.push({ id, points: centeredSegment(center, direction, length), conflictsWith: [], demandClass, source: 'estimated' });
  }

  for (const approach of APPROACHES) {
    const inboundLanes = [`${approach.id}-in-outer`, `${approach.id}-in-inner`];
    const outboundLanes = [`${approach.id}-out-outer`, `${approach.id}-out-inner`];
    lanes.push(
      {
        id: inboundLanes[0], kind: 'general', points: offsetPolyline(approach.inbound, -1.55), speedLimit: 13.9,
        successors: ['roundabout-outer'], permittedModes: ['car', 'bus'],
      },
      {
        id: inboundLanes[1], kind: 'general', points: offsetPolyline(approach.inbound, 1.55), speedLimit: 13.9,
        successors: ['roundabout-inner', 'bus-inner-ring'], permittedModes: ['car', 'bus'],
      },
      {
        id: outboundLanes[0], kind: 'general', points: offsetPolyline(approach.outbound, -1.55), speedLimit: 13.9,
        successors: [], permittedModes: ['car', 'bus'],
      },
      {
        id: outboundLanes[1], kind: 'general', points: offsetPolyline(approach.outbound, 1.55), speedLimit: 13.9,
        successors: [], permittedModes: ['car', 'bus'],
      },
    );
    portals.push({
      id: approach.id,
      inbound: approach.inbound[0],
      outbound: approach.outbound.at(-1) ?? approach.outbound[0],
      inboundLanes,
      outboundLanes,
    });

    const inboundCrossing = CROSSING_PLAN.find((crossing) => crossing.approach === approach.id && crossing.carriageway === 'inbound');
    const crossingDistance = inboundCrossing ? nearestDistanceOnPolyline(approach.inbound, inboundCrossing.center) : polylineLength(approach.inbound) - 14;
    const stopDistance = Math.max(0, crossingDistance - 3.5);
    const stopPose = samplePolyline(approach.inbound, stopDistance);
    const stopLine = stopPose.point;
    const heading = stopPose.heading;
    const vehicleGroups = signalGroups(approach.id).entry;
    const pedestrianGroup = crossings.find((crossing) => crossing.approach === approach.id && crossing.carriageway === 'inbound')?.signalGroup ?? 'ped-01';
    signals.push({
      id: `signal-entry-${approach.id}`,
      approach: approach.id,
      position: stopLine,
      heading,
      kind: 'entry',
      vehicleGroup: vehicleGroups[0],
      vehicleGroups,
      pedestrianGroup,
      sourcePosition: 'locally-fitted-to-scene',
    });
  }

  // Stanowiska na tarczy leżą 7 m przed wlotem, który przecina ruch krążący.
  for (let approachIndex = 0; approachIndex < APPROACHES.length; approachIndex += 1) {
    const approach = APPROACHES[approachIndex];
    const precedingSegment = ROUNDABOUT[(approachIndex + ROUNDABOUT.length - 1) % ROUNDABOUT.length];
    const distance = Math.max(0, polylineLength(precedingSegment) - 7);
    const pose = samplePolyline(precedingSegment, distance);
    const vehicleGroups = signalGroups(approach.id).ring;
    signals.push({
      id: `signal-ring-${approach.id}`,
      approach: approach.id,
      position: pose.point,
      heading: pose.heading,
      kind: 'ring',
      vehicleGroup: vehicleGroups[0],
      vehicleGroups,
      sourcePosition: 'locally-fitted-to-scene',
    });
  }

  const ringOuter = withoutDuplicateJoints(ROUNDABOUT);
  lanes.push(
    { id: 'roundabout-outer', kind: 'general', points: offsetPolyline(ringOuter, -2), speedLimit: 8.3, successors: APPROACHES.flatMap((item) => [`${item.id}-out-outer`]), permittedModes: ['car', 'bus'] },
    { id: 'roundabout-inner', kind: 'general', points: offsetPolyline(ringOuter, 1.8), speedLimit: 8.3, successors: APPROACHES.flatMap((item) => [`${item.id}-out-inner`]), permittedModes: ['car', 'bus'] },
    { id: 'bus-inner-ring', kind: 'bus', points: offsetPolyline(ringOuter, 2.8), speedLimit: 7.5, successors: APPROACHES.map((item) => `${item.id}-out-inner`), permittedModes: ['bus'] },
  );

  for (let sourceIndex = 0; sourceIndex < APPROACHES.length; sourceIndex += 1) {
    const source = APPROACHES[sourceIndex];
    for (const [turn, steps] of Object.entries(TURN_STEPS) as Array<[keyof typeof TURN_STEPS, number]>) {
      const destinationIndex = (sourceIndex + steps + 1) % APPROACHES.length;
      const destination = APPROACHES[destinationIndex];
      const ringParts: Point2[][] = [];
      for (let segment = 0; segment < steps; segment += 1) ringParts.push(ROUNDABOUT[(sourceIndex + segment) % ROUNDABOUT.length]);
      const inner = turn === 'left' || turn === 'u-turn';
      const inboundPoints = offsetPolyline(source.inbound, inner ? 1.55 : -1.55);
      const inboundCrossing = CROSSING_PLAN.find((crossing) => crossing.approach === source.id && crossing.carriageway === 'inbound');
      const entryStop = Math.max(0, inboundCrossing ? nearestDistanceOnPolyline(inboundPoints, inboundCrossing.center) - 3.5 : polylineLength(inboundPoints) - 9);
      const laneIndex = inner ? 1 : 0;
      const signalStops: TrafficSignalStop[] = [{
        distance: entryStop,
        signalGroup: signalGroups(source.id).entry[laneIndex],
        type: 'entry',
        conflictZoneId: `ring-zone-${sourceIndex + 1}`,
      }];
      let travelled = polylineLength(inboundPoints);
      for (let segment = 0; segment < ringParts.length; segment += 1) {
        const ringPart = offsetPolyline(ringParts[segment], inner ? 1.7 : -1.7);
        const targetIndex = (sourceIndex + segment + 1) % APPROACHES.length;
        signalStops.push({
          distance: travelled + Math.max(0, polylineLength(ringPart) - 7),
          signalGroup: signalGroups(APPROACHES[targetIndex].id).ring[laneIndex],
          type: 'ring',
          conflictZoneId: `ring-zone-${targetIndex + 1}`,
        });
        travelled += polylineLength(ringPart);
      }
      const points = withoutDuplicateJoints([
        inboundPoints,
        ...ringParts.map((part) => offsetPolyline(part, inner ? 1.7 : -1.7)),
        offsetPolyline(destination.outbound, inner ? 1.55 : -1.55),
      ]);
      routes.push({
        id: `${source.id}-${turn}`,
        mode: 'car',
        points,
        laneIds: [`${source.id}-in-${inner ? 'inner' : 'outer'}`, `roundabout-${inner ? 'inner' : 'outer'}`, `${destination.id}-out-${inner ? 'inner' : 'outer'}`],
        turn,
        signalGroup: `vehicle-${source.id}-${turn}`,
        approach: source.id,
        stopAt: entryStop,
        signalStops,
      });
    }
  }

  const trackById = (): Map<string, TramTrack> => new Map(tramTracks.map((track) => [track.id, track]));
  const addTramRoute = (id: string, relationIndex: number, trackIds: string[], stopPosition: Point2): void => {
    const points: Point2[] = [];
    const trackSections: TrafficTrackSection[] = [];
    let travelled = 0;
    let centralStart = Number.POSITIVE_INFINITY;
    let centralEnd = 0;
    for (const trackId of trackIds) {
      const track = trackById().get(trackId);
      if (!track) throw new Error(`Missing tram track ${trackId}`);
      const previous = points.at(-1);
      const first = track.points[0];
      if (previous && Math.hypot(previous[0] - first[0], previous[1] - first[1]) > 0.05) {
        const connectorId = `track-connector-${id}-${trackSections.length + 1}`;
        const connectorPoints = sampleCentripetalPolyline([previous, first]);
        const connector: TramTrack = {
          id: connectorId,
          corridorId: `connector-${id}`,
          direction: 'forward',
          points: connectorPoints,
          gauge: 1.435,
          centerOffset: 1.55,
          source: 'BDOT10k OT_SKTR_L',
        };
        tramTracks.push(connector);
        const connectorLength = polylineLength(connectorPoints);
        points.push(...connectorPoints.slice(1));
        trackSections.push({ trackId: connectorId, startDistance: travelled, endDistance: travelled + connectorLength, trackStartDistance: 0, conflictZoneId: 'tram-intersection' });
        centralStart = Math.min(centralStart, travelled);
        travelled += connectorLength;
        centralEnd = travelled;
      }
      const sectionLength = polylineLength(track.points);
      if (points.length === 0) points.push(...track.points);
      else points.push(...track.points.slice(1));
      const conflictZoneId = track.corridorId.endsWith('-curve') ? 'tram-intersection' : undefined;
      trackSections.push({ trackId, startDistance: travelled, endDistance: travelled + sectionLength, trackStartDistance: 0, conflictZoneId });
      if (conflictZoneId) {
        centralStart = Math.min(centralStart, travelled);
        centralEnd = travelled + sectionLength;
      }
      travelled += sectionLength;
    }
    const firstSignal = Math.max(2, centralStart - 12);
    const secondSignal = Math.min(travelled - 2, centralEnd + 10);
    routes.push({
      id,
      mode: 'tram',
      points,
      laneIds: trackSections.map((section) => section.trackId),
      trackSections,
      turn: 'transit',
      signalGroup: `transit-${relationIndex}-entry`,
      stopAt: firstSignal,
      signalStops: [
        { distance: firstSignal, signalGroup: `transit-${relationIndex}-entry`, type: 'transit', conflictZoneId: 'tram-intersection' },
        { distance: secondSignal, signalGroup: `transit-${relationIndex}-ring`, type: 'transit', conflictZoneId: 'tram-intersection' },
      ],
      dwellAt: nearestDistanceOnPolyline(points, stopPosition),
      tramConflictEntry: Math.max(0, centralStart - 11),
      tramConflictExit: Math.min(travelled, centralEnd + 11),
    });
  };

  addTramRoute('tram-west-south', 1, ['track-west-arm-forward', 'track-west-south-curve-forward', 'track-south-arm-forward'], [-31, -89]);
  addTramRoute('tram-south-west', 1, ['track-south-arm-reverse', 'track-west-south-curve-reverse', 'track-west-arm-reverse'], [-31, -89]);
  addTramRoute('tram-north-south', 2, ['track-north-arm-reverse', 'track-north-south-curve-forward', 'track-south-arm-forward'], [43, 106]);
  addTramRoute('tram-south-north', 2, ['track-south-arm-reverse', 'track-north-south-curve-reverse', 'track-north-arm-forward'], [-31, -89]);
  addTramRoute('tram-west-north', 3, ['track-west-arm-forward', 'track-west-north-curve-forward', 'track-north-arm-forward'], [43, 106]);
  addTramRoute('tram-north-west', 3, ['track-north-arm-reverse', 'track-west-north-curve-reverse', 'track-west-arm-reverse'], [43, 106]);

  for (const track of tramTracks) lanes.push({ id: track.id, kind: 'tram', points: track.points, speedLimit: 11.1, successors: [], permittedModes: ['tram'] });

  const mappedBusBase = routes.find((route) => route.id === 'south-west-straight');
  if (mappedBusBase) routes.push({
    ...mappedBusBase,
    id: 'bus-south-west-north-east',
    mode: 'bus',
    turn: 'transit',
    dwellAt: nearestDistanceOnPolyline(mappedBusBase.points, [54.584, 115.976]),
  });
  for (const [routeId, stopPosition] of [
    ['north-east-straight', [-42.986, -94.174]],
    ['south-east-straight', [-90.936, 54.996]],
  ] as Array<[string, Point2]>) {
    const base = routes.find((route) => route.id === routeId);
    if (!base) continue;
    routes.push({
      ...base,
      id: `bus-${routeId}`,
      mode: 'bus',
      turn: 'transit',
      dwellAt: nearestDistanceOnPolyline(base.points, stopPosition),
    });
  }

  const vehicleGroups = Array.from({ length: 16 }, (_, index) => `K${String(index + 1).padStart(2, '0')}`);
  const transitGroups = Array.from({ length: 3 }, (_, index) => [`transit-${index + 1}-entry`, `transit-${index + 1}-ring`]).flat();
  const movementConflicts: Record<string, string[]> = {};
  for (const vehicle of vehicleGroups) {
    const approachId = SIGNAL_APPROACH_ORDER.find((id) => [...signalGroups(id).entry, ...signalGroups(id).ring].includes(vehicle));
    const pedestrianConflicts = crossings
      .filter((crossing) => crossing.approach === approachId)
      .map((crossing) => crossing.signalGroup);
    if (approachId === 'north-east') pedestrianConflicts.push('ped-09');
    if (approachId === 'north-west') pedestrianConflicts.push('ped-10');
    if (approachId === 'south-west') pedestrianConflicts.push('ped-11');
    movementConflicts[vehicle] = [...vehicleGroups.filter((group) => group !== vehicle), ...pedestrianConflicts, ...transitGroups];
  }
  for (const pedestrian of pedestrianGroups) {
    pedestrian.conflictsWith = vehicleGroups.filter((vehicle) => movementConflicts[vehicle]?.includes(pedestrian.id));
    movementConflicts[pedestrian.id] = [...pedestrian.conflictsWith, ...transitGroups];
  }
  for (const crossing of crossings) crossing.conflictsWith = [...(movementConflicts[crossing.signalGroup] ?? [])];
  for (const transit of transitGroups) movementConflicts[transit] = [...vehicleGroups, ...pedestrianGroups.map((group) => group.id), ...transitGroups.filter((group) => group !== transit)];

  const relationGroups = routes.filter((route) => route.mode === 'car').map((route) => route.signalGroup);
  const trajectoryConflicts: Record<string, string[]> = Object.fromEntries(relationGroups.map((group) => [group, []]));
  const carRoutes = routes.filter((route) => route.mode === 'car');
  for (let left = 0; left < carRoutes.length; left += 1) {
    for (let right = left + 1; right < carRoutes.length; right += 1) {
      const a = carRoutes[left];
      const b = carRoutes[right];
      const crosses = a.points.some((point) => distanceToPolyline(point, b.points) < 3.2)
        || b.points.some((point) => distanceToPolyline(point, a.points) < 3.2);
      if (!crosses) continue;
      trajectoryConflicts[a.signalGroup].push(b.signalGroup);
      trajectoryConflicts[b.signalGroup].push(a.signalGroup);
    }
  }

  const conflictZones: TrafficConflictZone[] = APPROACHES.map((approach, index) => ({
    id: `ring-zone-${index + 1}`,
    center: signals.find((signal) => signal.kind === 'ring' && signal.approach === approach.id)?.position ?? approach.node,
    radius: 10,
    groups: [...vehicleGroups, ...transitGroups],
  }));
  conflictZones.push({ id: 'tram-intersection', center: [-5, 18], radius: 34, groups: [...transitGroups] });
  const downstreamSectors: TrafficDownstreamSector[] = APPROACHES.map((approach) => ({
    id: `downstream-${approach.id}`,
    capacityMetres: polylineLength(approach.outbound) - 6,
    routeIds: routes.filter((route) => {
      const endpoint = route.points.at(-1);
      const portal = approach.outbound.at(-1);
      return endpoint !== undefined && portal !== undefined && Math.hypot(endpoint[0] - portal[0], endpoint[1] - portal[1]) < 5;
    }).map((route) => route.id),
  }));
  for (const route of routes) {
    route.orderedStopLines = route.signalStops ?? (route.stopAt === undefined ? [] : [{ distance: route.stopAt, signalGroup: route.signalGroup, type: 'entry', conflictZoneId: 'ring-zone-1' }]);
    route.conflictZoneIds = [...new Set(route.signalStops?.map((stop) => stop.conflictZoneId) ?? [])];
    route.downstreamSectorIds = downstreamSectors.filter((sector) => sector.routeIds.includes(route.id)).map((sector) => sector.id);
  }
  const detectors: TrafficDetector[] = [];
  for (let index = 0; index < 99; index += 1) {
    const group = vehicleGroups[index % vehicleGroups.length];
    const station = signals.find((candidate) => candidate.vehicleGroups.includes(group));
    if (!station) continue;
    const setback = 5 + Math.floor(index / vehicleGroups.length) * 3.5;
    const position: Point2 = [station.position[0] - Math.cos(station.heading) * setback, station.position[1] - Math.sin(station.heading) * setback];
    detectors.push({ id: `detector-${String(index + 1).padStart(3, '0')}`, group, distance: setback, position });
  }
  const allGroups = [...vehicleGroups, ...pedestrianGroups.map((group) => group.id), ...transitGroups];
  const signalIntergreens: Record<string, Record<string, number>> = {};
  for (const from of allGroups) {
    signalIntergreens[from] = {};
    for (const to of movementConflicts[from] ?? []) {
      const isTransit = from.startsWith('transit-') || to.startsWith('transit-');
      const isPedestrian = from.startsWith('ped-') || to.startsWith('ped-');
      signalIntergreens[from][to] = isTransit ? 4.5 : isPedestrian ? 3.5 : 1.5;
    }
  }

  return {
    schema: 'rondo-rataje-authored-traffic',
    version: 1,
    crs: 'EPSG:2180-local-metres',
    disclaimer: 'Autorska, deterministyczna symulacja oparta na odwzorowanej geometrii; nie przedstawia ruchu na żywo ani miejskiego programu sygnalizacji.',
    lanes,
    portals,
    routes,
    crossings,
    pedestrianGroups,
    stops: [
      { id: 'tram-north', position: [43, 106], modes: ['tram'], dwellSeconds: [14.3, 28.4] },
      { id: 'tram-south', position: [-31, -89], modes: ['tram'], dwellSeconds: [14.3, 28.4] },
      { id: 'bus-north', position: [54.584, 115.976], modes: ['bus'], dwellSeconds: [14.3, 28.4] },
      { id: 'bus-south', position: [-42.986, -94.174], modes: ['bus'], dwellSeconds: [14.3, 28.4] },
      { id: 'bus-west', position: [-90.936, 54.996], modes: ['bus'], dwellSeconds: [14.3, 28.4] },
    ],
    signals,
    detectors,
    conflictZones,
    downstreamSectors,
    trajectoryConflicts,
    movementConflicts,
    signalIntergreens,
    roundaboutLaneChanges: false,
    roadSurfaces,
    tramTracks,
    provenance: {
      trafficSignalPlan: {
        title: 'Wybrane wdrożenia firmy MSR TRAFFIC — Miasto Poznań / ALDESA / SAFEGE',
        url: 'https://www.klir.pl/biuletyny/100-10_Wybrane_wdrozenia_firmy_MSR_TRAFFIC.pdf',
        figure: 'rysunek 2.2',
      },
      mappedPositions: signals.map((signal) => signal.id),
      locallyFittedPositions: signals.map((signal) => `${signal.id}:${signal.position[0].toFixed(3)},${signal.position[1].toFixed(3)}`),
    },
  };
}

function distanceToPolyline(point: Point2, points: Point2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t)));
  }
  return best;
}

export function roadClearance(point: Point2): number {
  return Math.max(...TRAFFIC_NETWORK.roadSurfaces.map((surface) => surface.width / 2 - distanceToPolyline(point, surface.centerline)));
}

export function roadVehicleContained(point: Point2, heading: number, length: number, width: number, margin = 0.12): boolean {
  const forward: Point2 = [Math.cos(heading), Math.sin(heading)];
  const side: Point2 = [-Math.sin(heading), Math.cos(heading)];
  for (const longitudinal of [-0.5, 0, 0.5]) {
    for (const lateral of [-0.5, 0, 0.5]) {
      const sample: Point2 = [
        point[0] + forward[0] * length * longitudinal + side[0] * width * lateral,
        point[1] + forward[1] * length * longitudinal + side[1] * width * lateral,
      ];
      if (roadClearance(sample) < margin) return false;
    }
  }
  return true;
}

interface PolylineMetrics { total: number; cumulative: number[] }
const POLYLINE_METRICS = new WeakMap<Point2[], PolylineMetrics>();

function polylineMetrics(points: Point2[]): PolylineMetrics {
  const cached = POLYLINE_METRICS.get(points);
  if (cached) return cached;
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
  }
  const metrics = { total: cumulative.at(-1) ?? 0, cumulative };
  POLYLINE_METRICS.set(points, metrics);
  return metrics;
}

export function polylineLength(points: Point2[]): number {
  return polylineMetrics(points).total;
}

export function samplePolyline(points: Point2[], distance: number): { point: Point2; heading: number } {
  const metrics = polylineMetrics(points);
  const target = Math.max(0, Math.min(metrics.total, distance));
  let low = 1;
  let high = Math.max(1, points.length - 1);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((metrics.cumulative[middle] ?? metrics.total) < target) low = middle + 1;
    else high = middle;
  }
  const index = Math.min(points.length - 1, low);
  if (index >= 1) {
    const before = points[index - 1];
    const after = points[index];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy);
    const segmentStart = metrics.cumulative[index - 1] ?? 0;
    const t = length === 0 ? 0 : Math.min(1, Math.max(0, (target - segmentStart) / length));
    return { point: [before[0] + dx * t, before[1] + dy * t], heading: Math.atan2(dy, dx) };
  }
  return { point: points.at(-1) ?? [0, 0], heading: 0 };
}

export function sampleSmoothPolyline(points: Point2[], distance: number, lookAhead = 2.4): { point: Point2; heading: number } {
  const sample = samplePolyline(points, distance);
  const before = samplePolyline(points, Math.max(0, distance - lookAhead)).point;
  const after = samplePolyline(points, Math.min(polylineLength(points), distance + lookAhead)).point;
  const dx = after[0] - before[0];
  const dy = after[1] - before[1];
  return { point: sample.point, heading: Math.hypot(dx, dy) > 0.001 ? Math.atan2(dy, dx) : sample.heading };
}

export const TRAFFIC_NETWORK = buildNetwork();
