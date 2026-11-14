// Geometry tests — plan.md §5 / M30
//
// circle → polygon conversion and geometry (de)serialisation.

import { describe, expect, it } from 'vitest';
import {
  circleToPolygon,
  deserializeGeometry,
  distanceMeters,
  serializeGeometry,
  METRES_PER_DEGREE_LAT,
} from './geometry.js';

function isClosedRing(coords: number[][]): boolean {
  const first = coords[0];
  const last = coords[coords.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

describe('geometry (M30)', () => {
  describe('METRES_PER_DEGREE_LAT', () => {
    it('is a positive constant', () => {
      expect(METRES_PER_DEGREE_LAT).toBeGreaterThan(0);
    });
  });

  describe('circleToPolygon', () => {
    it('returns a valid GeoJSON Polygon', () => {
      const poly = circleToPolygon(
        { type: 'Circle', center: [16.0, 63.0], radiusMeters: 1000 },
        32,
      );
      expect(poly.type).toBe('Polygon');
      expect(Array.isArray(poly.coordinates)).toBe(true);
      expect(poly.coordinates.length).toBe(1); // one exterior ring
    });

    it('produces a closed ring (first point === last point)', () => {
      const poly = circleToPolygon(
        { type: 'Circle', center: [16.0, 63.0], radiusMeters: 1000 },
        32,
      );
      expect(isClosedRing(poly.coordinates[0])).toBe(true);
    });

    it('uses `points` vertices plus the closing point', () => {
      for (const points of [8, 16, 32, 64]) {
        const poly = circleToPolygon(
          { type: 'Circle', center: [16.0, 63.0], radiusMeters: 1000 },
          points,
        );
        expect(poly.coordinates[0].length).toBe(points + 1);
      }
    });

    it('places vertices approximately `radiusMeters` from the centre', () => {
      const center: [number, number] = [16.0, 63.0];
      const radiusMeters = 5000;
      const poly = circleToPolygon(
        { type: 'Circle', center, radiusMeters },
        36,
      );
      const ring = poly.coordinates[0];
      // Drop the duplicate closing point.
      const vertices = ring.slice(0, -1);
      expect(vertices.length).toBe(36);
      for (const vertex of vertices) {
        const d = distanceMeters(center, vertex);
        expect(d).toBeGreaterThan(radiusMeters * 0.95);
        expect(d).toBeLessThan(radiusMeters * 1.05);
      }
    });

    it('default points is 32', () => {
      const poly = circleToPolygon({
        type: 'Circle',
        center: [16.0, 63.0],
        radiusMeters: 1000,
      });
      expect(poly.coordinates[0].length).toBe(33);
    });
  });

  describe('deserializeGeometry', () => {
    it('accepts Point, LineString, Polygon', () => {
      const cases: unknown[] = [
        { type: 'Point', coordinates: [16.0, 63.0] },
        { type: 'LineString', coordinates: [[16.0, 63.0], [17.0, 64.0]] },
        { type: 'Polygon', coordinates: [[[16.0, 63.0], [17.0, 63.0], [17.0, 64.0], [16.0, 63.0]]] },
      ];
      for (const c of cases) {
        expect(deserializeGeometry(c)).not.toBeNull();
      }
    });

    it('accepts MultiPoint, MultiLineString, MultiPolygon', () => {
      expect(
        deserializeGeometry({ type: 'MultiPoint', coordinates: [[16.0, 63.0]] }),
      ).not.toBeNull();
      expect(
        deserializeGeometry({
          type: 'MultiLineString',
          coordinates: [[[16.0, 63.0], [17.0, 63.0]]],
        }),
      ).not.toBeNull();
      expect(
        deserializeGeometry({
          type: 'MultiPolygon',
          coordinates: [[[[16.0, 63.0], [17.0, 63.0], [17.0, 64.0], [16.0, 63.0]]]],
        }),
      ).not.toBeNull();
    });

    it('rejects invalid types', () => {
      expect(deserializeGeometry({ type: 'Circle', coordinates: [] })).toBeNull();
      expect(deserializeGeometry({ type: 'Foo', coordinates: [] })).toBeNull();
    });

    it('rejects non-objects and missing coordinates', () => {
      expect(deserializeGeometry(null)).toBeNull();
      expect(deserializeGeometry(undefined)).toBeNull();
      expect(deserializeGeometry('not an object')).toBeNull();
      expect(deserializeGeometry({ type: 'Point' })).toBeNull();
      expect(deserializeGeometry({ coordinates: [1, 2] })).toBeNull();
    });
  });

  describe('serializeGeometry', () => {
    it('is the identity transform', () => {
      const poly: unknown = {
        type: 'Polygon',
        coordinates: [[[16.0, 63.0], [17.0, 63.0], [17.0, 64.0], [16.0, 63.0]]],
      };
      expect(serializeGeometry(poly as never)).toBe(poly);
      expect(serializeGeometry(null)).toBeNull();
    });
  });

  describe('distanceMeters', () => {
    it('is symmetric', () => {
      const a: [number, number] = [16.0, 63.0];
      const b: [number, number] = [17.0, 64.0];
      expect(distanceMeters(a, b)).toBe(distanceMeters(b, a));
    });

    it('is zero for identical points', () => {
      expect(distanceMeters([16.0, 63.0], [16.0, 63.0])).toBe(0);
    });

    it('is positive for distinct points', () => {
      expect(distanceMeters([16.0, 63.0], [17.0, 63.0])).toBeGreaterThan(0);
    });

    it('one degree of latitude ≈ METRES_PER_DEGREE_LAT metres', () => {
      const d = distanceMeters([16.0, 63.0], [16.0, 64.0]);
      expect(d).toBeGreaterThan(METRES_PER_DEGREE_LAT * 0.99);
      expect(d).toBeLessThan(METRES_PER_DEGREE_LAT * 1.01);
    });
  });
});
