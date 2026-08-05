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
  signalStops?: Array<{ distance: number; signalGroup: string }>;
}

export interface TrafficCrossing {
  id: string;
  points: [Point2, Point2];
  signalGroup: string;
  conflictsWith: string[];
  approach: ApproachId;
  carriageway: 'inbound' | 'outbound';
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
  vehicleGroup: string;
  pedestrianGroup: string;
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
  stops: TrafficStop[];
  signals: TrafficSignal[];
  movementConflicts: Record<string, string[]>;
  roadSurfaces: TrafficRoadSurface[];
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

  for (const crossing of CROSSING_PLAN) {
    crossings.push({
      id: `crossing-${crossing.approach}-${crossing.carriageway}`,
      points: centeredSegment(crossing.center, crossing.along, crossing.length),
      signalGroup: `ped-${crossing.approach}`,
      conflictsWith: [`vehicle-${crossing.approach}`],
      approach: crossing.approach,
      carriageway: crossing.carriageway,
    });
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
    const vehicleGroup = `vehicle-${approach.id}`;
    const pedestrianGroup = `ped-${approach.id}`;
    signals.push({ id: `signal-${approach.id}`, approach: approach.id, position: stopLine, heading, vehicleGroup, pedestrianGroup });
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
        signalGroup: `vehicle-${source.id}`,
        approach: source.id,
        stopAt: Math.max(0, inboundCrossing ? nearestDistanceOnPolyline(inboundPoints, inboundCrossing.center) - 3.5 : polylineLength(inboundPoints) - 9),
      });
    }
  }

  const tramLines: Point2[][] = [
    [[-169.9, 100.3], [-150, 91], [-118, 76], [-70, 50], [-31.2, 30.3], [-4.2, -16.4], [-36, -97], [-70.7, -184.3]],
    [[74.1, 183], [54, 126], [20.7, 46.1], [-4.2, -16.4], [-36, -97], [-70.7, -184.3]],
  ];
  tramLines.forEach((points, index) => {
    for (const [suffix, routePoints] of [['a', points], ['b', [...points].reverse()]] as const) {
      const id = `tram-${index + 1}${suffix}`;
      lanes.push({ id, kind: 'tram', points: routePoints, speedLimit: 11.1, successors: [], permittedModes: ['tram'] });
      const stopPosition: Point2 = index === 0 ? [-31, -89] : [43, 106];
      const junctionDistance = nearestDistanceOnPolyline(routePoints, [-4.2, -16.4]);
      const firstSignal = Math.max(2, junctionDistance - 12);
      const secondSignal = Math.min(polylineLength(routePoints) - 2, junctionDistance + 10);
      routes.push({
        id, mode: 'tram', points: routePoints, laneIds: [id], turn: 'transit', signalGroup: `transit-${index + 1}-entry`,
        stopAt: firstSignal,
        signalStops: [
          { distance: firstSignal, signalGroup: `transit-${index + 1}-entry` },
          { distance: secondSignal, signalGroup: `transit-${index + 1}-ring` },
        ],
        dwellAt: nearestDistanceOnPolyline(routePoints, stopPosition),
      });
    }
  });

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

  const vehicleGroups = APPROACHES.map((item) => `vehicle-${item.id}`);
  const transitGroups = ['transit-1-entry', 'transit-1-ring', 'transit-2-entry', 'transit-2-ring'];
  const movementConflicts: Record<string, string[]> = {};
  for (const approach of APPROACHES) {
    const vehicle = `vehicle-${approach.id}`;
    movementConflicts[vehicle] = [...vehicleGroups.filter((group) => group !== vehicle), `ped-${approach.id}`, ...transitGroups];
    movementConflicts[`ped-${approach.id}`] = [vehicle];
  }
  for (const transit of transitGroups) movementConflicts[transit] = [...vehicleGroups, ...transitGroups.filter((group) => group !== transit)];

  return {
    schema: 'rondo-rataje-authored-traffic',
    version: 1,
    crs: 'EPSG:2180-local-metres',
    disclaimer: 'Autorska, deterministyczna symulacja oparta na odwzorowanej geometrii; nie przedstawia ruchu na żywo ani miejskiego programu sygnalizacji.',
    lanes,
    portals,
    routes,
    crossings,
    stops: [
      { id: 'tram-north', position: [43, 106], modes: ['tram'], dwellSeconds: [8, 14] },
      { id: 'tram-south', position: [-31, -89], modes: ['tram'], dwellSeconds: [8, 14] },
      { id: 'bus-north', position: [54.584, 115.976], modes: ['bus'], dwellSeconds: [8, 14] },
      { id: 'bus-south', position: [-42.986, -94.174], modes: ['bus'], dwellSeconds: [8, 14] },
      { id: 'bus-west', position: [-90.936, 54.996], modes: ['bus'], dwellSeconds: [8, 14] },
    ],
    signals,
    movementConflicts,
    roadSurfaces,
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

export function polylineLength(points: Point2[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  return length;
}

export function samplePolyline(points: Point2[], distance: number): { point: Point2; heading: number } {
  let remaining = Math.max(0, distance);
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy);
    if (remaining <= length || index === points.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, remaining / length);
      return { point: [before[0] + dx * t, before[1] + dy * t], heading: Math.atan2(dy, dx) };
    }
    remaining -= length;
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
