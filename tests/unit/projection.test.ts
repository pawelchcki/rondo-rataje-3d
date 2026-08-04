import { describe, expect, it } from 'vitest';
import { ecefToWgs84, projectWgs84 } from '../../scripts/lib/projection.ts';

function wgs84ToEcef(longitude: number, latitude: number, height: number): [number, number, number] {
  const a = 6378137;
  const e2 = 6.69437999014e-3;
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [(n + height) * Math.cos(lat) * Math.cos(lon), (n + height) * Math.cos(lat) * Math.sin(lon), (n * (1 - e2) + height) * Math.sin(lat)];
}

describe('coordinate conversion', () => {
  it('projects the declared center to EPSG:2180', () => {
    const [easting, northing] = projectWgs84(16.950278, 52.395556);
    expect(easting).toBeCloseTo(360578.516, 2);
    expect(northing).toBeCloseTo(505268.464, 2);
  });

  it('round-trips ECEF to geodetic coordinates', () => {
    const ecef = wgs84ToEcef(16.950278, 52.395556, 95.2);
    const result = ecefToWgs84(...ecef);
    expect(result.longitude).toBeCloseTo(16.950278, 7);
    expect(result.latitude).toBeCloseTo(52.395556, 7);
    expect(result.height).toBeCloseTo(95.2, 3);
  });
});
