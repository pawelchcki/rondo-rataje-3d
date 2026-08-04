import proj4 from 'proj4';

export const EPSG_2180 = '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs +type=crs';

const wgs84To2180 = proj4('EPSG:4326', EPSG_2180);

export function projectWgs84(longitude: number, latitude: number): [number, number] {
  const result = wgs84To2180.forward([longitude, latitude]);
  return [result[0], result[1]];
}

export interface GeodeticCoordinate {
  longitude: number;
  latitude: number;
  height: number;
}

export function ecefToWgs84(x: number, y: number, z: number): GeodeticCoordinate {
  const semiMajor = 6378137;
  const flattening = 1 / 298.257223563;
  const eccentricitySquared = flattening * (2 - flattening);
  const longitude = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let latitude = Math.atan2(z, p * (1 - eccentricitySquared));
  let height = 0;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const sinLatitude = Math.sin(latitude);
    const normalRadius = semiMajor / Math.sqrt(1 - eccentricitySquared * sinLatitude * sinLatitude);
    height = p / Math.cos(latitude) - normalRadius;
    const next = Math.atan2(z, p * (1 - (eccentricitySquared * normalRadius) / (normalRadius + height)));
    if (Math.abs(next - latitude) < 1e-13) {
      latitude = next;
      break;
    }
    latitude = next;
  }
  return {
    longitude: longitude * 180 / Math.PI,
    latitude: latitude * 180 / Math.PI,
    height,
  };
}
