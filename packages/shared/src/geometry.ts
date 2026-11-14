// Geometry helpers for map features — plan.md §5 / M30.
//
// GeoJSON has no circle type, so circles are stored as polygons approximated
// with N points around the centre at the given radius (metres, equirectangular
// projection — adequate for Swedish latitudes). All coordinates are
// [longitude, latitude] in degrees per GeoJSON (RFC 7946).

export const METRES_PER_DEGREE_LAT = 111_320;
// Earth radius chosen so 1° of latitude ≈ METRES_PER_DEGREE_LAT metres.
export const EARTH_RADIUS_METERS = (METRES_PER_DEGREE_LAT * 180) / Math.PI;

export interface CircleLike {
  type: 'Circle';
  center: [number, number]; // [lon, lat]
  radiusMeters: number;
}

export type StorableGeometry =
  | GeoJSONPoint
  | GeoJSONMultiPoint
  | GeoJSONLineString
  | GeoJSONMultiLineString
  | GeoJSONPolygon
  | GeoJSONMultiPolygon;

interface GeoJSONBase {
  type: string;
  coordinates: unknown;
}

interface GeoJSONPoint extends GeoJSONBase {
  type: 'Point';
  coordinates: [number, number];
}

interface GeoJSONMultiPoint extends GeoJSONBase {
  type: 'MultiPoint';
  coordinates: [number, number][];
}

interface GeoJSONLineString extends GeoJSONBase {
  type: 'LineString';
  coordinates: [number, number][];
}

interface GeoJSONMultiLineString extends GeoJSONBase {
  type: 'MultiLineString';
  coordinates: [number, number][][];
}

interface GeoJSONPolygon extends GeoJSONBase {
  type: 'Polygon';
  coordinates: [number, number][][];
}

interface GeoJSONMultiPolygon extends GeoJSONBase {
  type: 'MultiPolygon';
  coordinates: [number, number][][][];
}

const VALID_GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
]);

/** Approximate a circle as a GeoJSON Polygon with `points` vertices. */
export function circleToPolygon(
  circle: CircleLike,
  points = 32,
): GeoJSONPolygon {
  const { center, radiusMeters } = circle;
  const [lon, lat] = center;
  const radiusLat = radiusMeters / METRES_PER_DEGREE_LAT;
  const radiusLon =
    radiusMeters /
    (METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (2 * Math.PI * i) / points;
    coordinates.push([lon + radiusLon * Math.cos(angle), lat + radiusLat * Math.sin(angle)]);
  }
  return { type: 'Polygon', coordinates: [coordinates] };
}

/** Validate and coerce an unknown value into a storable GeoJSON geometry. */
export function deserializeGeometry(value: unknown): StorableGeometry | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as GeoJSONBase;
  if (!VALID_GEOMETRY_TYPES.has(g.type)) return null;
  if (!Array.isArray(g.coordinates)) return null;
  return g as StorableGeometry;
}

/** A storable geometry is already JSON-serialisable — identity transform. */
export function serializeGeometry(
  geometry: StorableGeometry | null,
): StorableGeometry | null {
  return geometry;
}

/** Great-circle-ish distance in metres between two [lon, lat] points. */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const lat1Rad = toRad(lat1);
  const lat2Rad = toRad(lat2);
  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(hav));
}
