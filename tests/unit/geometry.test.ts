import { describe, expect, it } from 'vitest';
import { clipPolylinePartsToCircle, clipPolylineToCircle, clipRingToCircle, lineIntersectsCircle, polygonIntersectsCircle } from '../../scripts/lib/geometry.ts';

describe('BDOT10k circle filtering', () => {
  it('detects and clips a crossing line', () => {
    expect(lineIntersectsCircle([[-20, 0], [20, 0]], 10)).toBe(true);
    expect(lineIntersectsCircle([[20, 20], [30, 30]], 10)).toBe(false);
    const clipped = clipPolylineToCircle([[-20, 0], [20, 0]], 10);
    expect(clipped[0][0]).toBeCloseTo(-10);
    expect(clipped.at(-1)?.[0]).toBeCloseTo(10);
  });

  it('does not connect disjoint visits to the circle', () => {
    const parts = clipPolylinePartsToCircle([[-20, 0], [20, 0], [20, 20], [0, 0]], 10);
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.every(([x, y]) => Math.hypot(x, y) <= 10.01))).toBe(true);
  });

  it('retains a polygon containing the center and clips its ring', () => {
    const square: [number, number][] = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
    expect(polygonIntersectsCircle([square], 10)).toBe(true);
    const clipped = clipRingToCircle(square, 10);
    expect(clipped.length).toBeGreaterThan(20);
    expect(clipped.every(([x, y]) => Math.hypot(x, y) <= 10.01)).toBe(true);
  });
});
