export interface AsciiGrid {
  ncols: number;
  nrows: number;
  xll: number;
  yll: number;
  cellSize: number;
  noData: number;
  values: Float32Array;
  axisOrder: 'xy' | 'yx';
}

const HEADER_KEYS = new Set(['ncols', 'nrows', 'xllcorner', 'xllcenter', 'yllcorner', 'yllcenter', 'cellsize', 'nodata_value']);

export function parseAsciiGrid(text: string, axisOrder: 'xy' | 'yx' = 'xy'): AsciiGrid {
  const lines = text.trim().split(/\r?\n/);
  const header = new Map<string, number>();
  let dataStart = 0;
  for (; dataStart < lines.length; dataStart += 1) {
    const [rawKey, rawValue] = lines[dataStart].trim().split(/\s+/, 2);
    const key = rawKey.toLowerCase();
    if (!HEADER_KEYS.has(key)) break;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) throw new Error(`Invalid ASCII grid header: ${lines[dataStart]}`);
    header.set(key, value);
  }
  const required = (key: string): number => {
    const value = header.get(key);
    if (value === undefined) throw new Error(`ASCII grid is missing ${key}`);
    return value;
  };
  const ncols = required('ncols');
  const nrows = required('nrows');
  const cellSize = required('cellsize');
  const xll = header.get('xllcorner') ?? (required('xllcenter') - cellSize / 2);
  const yll = header.get('yllcorner') ?? (required('yllcenter') - cellSize / 2);
  const noData = header.get('nodata_value') ?? -9999;
  const tokens = lines.slice(dataStart).join(' ').trim().split(/\s+/);
  if (tokens.length !== ncols * nrows) {
    throw new Error(`ASCII grid has ${tokens.length} samples; expected ${ncols * nrows}`);
  }
  const values = Float32Array.from(tokens, Number);
  if (!values.every(Number.isFinite)) throw new Error('ASCII grid contains non-finite samples');
  return { ncols, nrows, xll, yll, cellSize, noData, values, axisOrder };
}

export function sampleGrid(grid: AsciiGrid, easting: number, northing: number): number {
  // GUGiK Arc/Info exports follow the official EPSG:2180 axis order: the
  // first grid axis is northing and the second is easting.
  const horizontal = grid.axisOrder === 'xy' ? easting : northing;
  const vertical = grid.axisOrder === 'xy' ? northing : easting;
  const column = Math.round((horizontal - grid.xll) / grid.cellSize - 0.5);
  const rowFromBottom = Math.round((vertical - grid.yll) / grid.cellSize - 0.5);
  const row = grid.nrows - 1 - rowFromBottom;
  if (column < 0 || row < 0 || column >= grid.ncols || row >= grid.nrows) return grid.noData;
  return grid.values[row * grid.ncols + column];
}

export function mergeAndCropGrids(
  grids: AsciiGrid[],
  center: [number, number],
  radius: number,
  cellSize = 1,
): { values: Float32Array; width: number; height: number; origin: [number, number] } {
  const width = Math.round((radius * 2) / cellSize) + 1;
  const height = width;
  const origin: [number, number] = [-radius, -radius];
  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const easting = center[0] + origin[0] + column * cellSize;
      const northing = center[1] + origin[1] + row * cellSize;
      let value: number | undefined;
      for (const grid of grids) {
        const candidate = sampleGrid(grid, easting, northing);
        if (candidate !== grid.noData) {
          value = candidate;
          break;
        }
      }
      if (value === undefined) throw new Error(`No terrain sample at ${easting}, ${northing}`);
      values[row * width + column] = value;
    }
  }
  return { values, width, height, origin };
}
