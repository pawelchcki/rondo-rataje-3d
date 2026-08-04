export type Point2 = [east: number, north: number];

export type TransportKind = 'road' | 'path' | 'cycleway' | 'tram';
export type LandCoverKind = 'grass' | 'pavement' | 'asphalt';
export type TreeKind = 'broadleaf' | 'conifer' | 'unknown';

export interface TransportFeature {
  id: string;
  kind: TransportKind;
  name: string | null;
  width: number;
  coordinates: Point2[];
  sourceLayer: string;
}

export interface LandCoverFeature {
  id: string;
  kind: LandCoverKind;
  rings: Point2[][];
  sourceLayer: string;
}

export interface TreeRecord {
  id: string;
  objectId: number | null;
  position: Point2;
  elevation: number;
  height: number;
  species: string | null;
  speciesLatin: string | null;
  status: string | null;
  survey: string | null;
  kind: TreeKind;
}

export interface BuildingRecord {
  id: string;
  rings: Point2[][];
  height: number;
  levels: number | null;
  name: string | null;
  function: string | null;
  status: string | null;
  sourceLayer: string;
}

export interface TransitStopRecord {
  id: string;
  position: Point2;
  name: string;
  kind: string;
  status: string | null;
  note: string | null;
  sourceLayer: string;
}

export interface SourceRecord {
  id: 'gugik-nmt' | 'gugik-bdot10k' | 'geopoz-trees';
  title: string;
  url: string;
  retrievedAt: string;
  vintage: string;
  crs: string;
  checksum: string;
  notes?: string;
}

export interface SceneManifest {
  schema: 'rondo-rataje-scene';
  version: 1;
  generatedAt: string;
  center: {
    name: 'Rondo Rataje';
    wgs84: [longitude: number, latitude: number];
    epsg2180: [easting: number, northing: number];
    radius: 200;
  };
  terrain: {
    binary: string;
    width: number;
    height: number;
    cellSize: number;
    origin: Point2;
    min: number;
    max: number;
    noData: number;
    verticalDatum: 'PL-EVRF2007-NH';
    sourceSheets: string[];
  };
  transport: TransportFeature[];
  landCover: LandCoverFeature[];
  trees: TreeRecord[];
  buildings: BuildingRecord[];
  stations: TransitStopRecord[];
  sources: SourceRecord[];
}
