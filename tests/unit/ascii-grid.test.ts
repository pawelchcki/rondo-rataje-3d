import { describe, expect, it } from 'vitest';
import { mergeAndCropGrids, parseAsciiGrid, sampleGrid } from '../../scripts/lib/ascii-grid.ts';

describe('Arc/Info ASCII Grid', () => {
  it('parses corner coordinates and north-to-south rows', () => {
    const grid = parseAsciiGrid(`ncols 3\nnrows 2\nxllcorner 10\nyllcorner 20\ncellsize 1\nNODATA_value -9999\n4 5 6\n1 2 3`);
    expect(grid.values).toEqual(Float32Array.from([4, 5, 6, 1, 2, 3]));
    expect(sampleGrid(grid, 10.5, 20.5)).toBe(1);
    expect(sampleGrid(grid, 12.5, 21.5)).toBe(6);
  });

  it('recognizes GUGiK EPSG:2180 northing/easting axis order', () => {
    const grid = parseAsciiGrid(`ncols 2\nnrows 2\nxllcenter 505000\nyllcenter 360000\ncellsize 1\nnodata_value -9999\n30 40\n10 20`, 'yx');
    expect(sampleGrid(grid, 360000, 505000)).toBe(10);
    expect(sampleGrid(grid, 360001, 505001)).toBe(40);
  });

  it('merges adjacent coverage and fails on a NoData hole', () => {
    const west = parseAsciiGrid(`ncols 1\nnrows 3\nxllcenter -1\nyllcenter -1\ncellsize 1\nnodata_value -9999\n3\n2\n1`);
    const center = parseAsciiGrid(`ncols 2\nnrows 3\nxllcenter 0\nyllcenter -1\ncellsize 1\nnodata_value -9999\n6 9\n5 8\n4 7`);
    const crop = mergeAndCropGrids([west, center], [0, 0], 1);
    expect([...crop.values]).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
    expect(() => mergeAndCropGrids([west], [0, 0], 1)).toThrow(/No terrain sample/);
  });
});
