import { describe, expect, it } from 'vitest';
import { FEATURE_OFFSET_STEP, SURFACE_OFFSETS } from '../../src/geometry.ts';

describe('rendering surface separation', () => {
  it('assigns every draped layer a distinct base elevation', () => {
    const offsets = [
      ...Object.values(SURFACE_OFFSETS.landCover),
      ...Object.values(SURFACE_OFFSETS.transport),
      SURFACE_OFFSETS.building,
      SURFACE_OFFSETS.rail,
      SURFACE_OFFSETS.station,
    ];
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(offsets.every((offset) => offset > 0)).toBe(true);
  });

  it('keeps per-feature lifts below the narrowest layer gap', () => {
    const offsets = [
      ...Object.values(SURFACE_OFFSETS.landCover),
      ...Object.values(SURFACE_OFFSETS.transport),
      SURFACE_OFFSETS.building,
      SURFACE_OFFSETS.rail,
      SURFACE_OFFSETS.station,
    ].sort((a, b) => a - b);
    const minimumLayerGap = Math.min(...offsets.slice(1).map((offset, index) => offset - offsets[index]));
    expect(FEATURE_OFFSET_STEP).toBeGreaterThan(0);
    expect(FEATURE_OFFSET_STEP * 1_000).toBeLessThan(minimumLayerGap);
  });
});
