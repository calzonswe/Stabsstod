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

export interface GeometryBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Bounding box (degrees) of a storable geometry: the min/max of every
 * coordinate pair across all points/lines/rings. Returns null when the
 * geometry has no coordinates.
 */
export function geometryBounds(
  geometry: StorableGeometry | null | undefined,
): GeometryBounds | null {
  if (!geometry) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let found = false;
  const descend = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (
      coords.length >= 2 &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      const lon = coords[0];
      const lat = coords[1];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      found = true;
      return;
    }
    for (const item of coords) descend(item);
  };
  descend(geometry.coordinates);
  return found ? { minLon, minLat, maxLon, maxLat } : null;
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
