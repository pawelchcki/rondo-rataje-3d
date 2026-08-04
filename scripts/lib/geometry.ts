import type { Point2 } from '../../src/types.ts';

export function squaredDistanceToSegment(point: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return (point[0] - a[0]) ** 2 + (point[1] - a[1]) ** 2;
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return (point[0] - (a[0] + t * dx)) ** 2 + (point[1] - (a[1] + t * dy)) ** 2;
}

export function lineIntersectsCircle(points: Point2[], radius: number, halfWidth = 0): boolean {
  const threshold = (radius + halfWidth) ** 2;
  return points.some((point, index) => index > 0 && squaredDistanceToSegment([0, 0], points[index - 1], point) <= threshold);
}

export function polygonIntersectsCircle(rings: Point2[][], radius: number): boolean {
  const outer = rings[0] ?? [];
  if (outer.some(([x, y]) => x * x + y * y <= radius * radius)) return true;
  if (lineIntersectsCircle([...outer, outer[0]].filter(Boolean) as Point2[], radius)) return true;
  let inside = false;
  for (let index = 0, previous = outer.length - 1; index < outer.length; previous = index++) {
    const [xi, yi] = outer[index];
    const [xj, yj] = outer[previous];
    if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * -yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function clipPolylineToCircle(points: Point2[], radius: number): Point2[] {
  return clipPolylinePartsToCircle(points, radius)[0] ?? [];
}

export function clipPolylinePartsToCircle(points: Point2[], radius: number): Point2[][] {
  if (points.length < 2) return [];
  const parts: Point2[][] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const qa = dx * dx + dy * dy;
    const qb = 2 * (a[0] * dx + a[1] * dy);
    const qc = a[0] ** 2 + a[1] ** 2 - radius ** 2;
    const discriminant = qb * qb - 4 * qa * qc;
    const parameters = [0, 1];
    if (discriminant >= 0 && qa > 0) {
      for (const t of [(-qb - Math.sqrt(discriminant)) / (2 * qa), (-qb + Math.sqrt(discriminant)) / (2 * qa)]) {
        if (t > 0 && t < 1) parameters.push(t);
      }
    }
    parameters.sort((left, right) => left - right);
    for (let interval = 1; interval < parameters.length; interval += 1) {
      const startT = parameters[interval - 1];
      const endT = parameters[interval];
      const middleT = (startT + endT) / 2;
      const middle: Point2 = [a[0] + middleT * dx, a[1] + middleT * dy];
      if (Math.hypot(...middle) > radius + 1e-8) continue;
      const start: Point2 = [a[0] + startT * dx, a[1] + startT * dy];
      const end: Point2 = [a[0] + endT * dx, a[1] + endT * dy];
      const current = parts.at(-1);
      if (current && Math.hypot(current.at(-1)![0] - start[0], current.at(-1)![1] - start[1]) < 1e-5) {
        if (Math.hypot(current.at(-1)![0] - end[0], current.at(-1)![1] - end[1]) > 1e-6) current.push(end);
      } else {
        parts.push([start, end]);
      }
    }
  }
  return parts;
}

export function clipRingToCircle(ring: Point2[], radius: number, segments = 128): Point2[] {
  let output = [...ring];
  const clip = Array.from({ length: segments }, (_, index): Point2 => {
    const angle = Math.PI * 2 * index / segments;
    return [Math.sin(angle) * radius, Math.cos(angle) * radius];
  });
  for (let edge = 0; edge < clip.length; edge += 1) {
    const a = clip[edge];
    const b = clip[(edge + 1) % clip.length];
    const input = output;
    output = [];
    if (input.length === 0) break;
    const inside = (point: Point2): boolean => (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) <= 1e-8;
    const intersection = (start: Point2, end: Point2): Point2 => {
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-12) return end;
      const t = ((a[0] - start[0]) * ey - (a[1] - start[1]) * ex) / denominator;
      return [start[0] + t * dx, start[1] + t * dy];
    };
    let previous = input.at(-1) as Point2;
    for (const current of input) {
      const currentInside = inside(current);
      const previousInside = inside(previous);
      if (currentInside) {
        if (!previousInside) output.push(intersection(previous, current));
        output.push(current);
      } else if (previousInside) {
        output.push(intersection(previous, current));
      }
      previous = current;
    }
  }
  return output;
}
