import { describe, expect, it } from 'vitest';

import {
  MAX_SURROUNDING_RADIUS,
  MAX_TILE_ZOOM,
  MIN_TILE_ZOOM,
  WEB_MERCATOR_MAX_LATITUDE,
  clampMercatorLatitude,
  latLonToTile,
  surroundingTiles,
  tileKey,
  tilesPerAxis,
} from './tiles.ts';
import type { TileRef } from './types.ts';

/**
 * The slippy formula as the OSM wiki writes it, with `log(tan + sec)` rather
 * than `asinh(tan)`. Implemented here independently so the two forms check
 * each other rather than the implementation checking itself.
 */
function referenceTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const clamped = Math.min(WEB_MERCATOR_MAX_LATITUDE, Math.max(-WEB_MERCATOR_MAX_LATITUDE, lat));
  const wrappedLon = ((lon + 180) % 360 + 360) % 360 - 180;
  const n = 2 ** z;
  const rad = (clamped * Math.PI) / 180;
  const x = Math.floor(((wrappedLon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

describe('latLonToTile', () => {
  it('agrees with the standard slippy formula across the map', () => {
    for (let lat = -85; lat <= 85; lat += 5) {
      for (let lon = -180; lon <= 175; lon += 15) {
        for (const z of [0, 1, 4, 10, 14, 18, 22]) {
          const mine = latLonToTile(lat, lon, z);
          const reference = referenceTile(lat, lon, z);
          expect({ x: mine.x, y: mine.y }).toEqual(reference);
          expect(mine.z).toBe(z);
        }
      }
    }
  });

  it('matches published worked examples', () => {
    // The OSM wiki example: Berlin, z16.
    expect(latLonToTile(52.5162, 13.3777, 16)).toEqual({ x: 35203, y: 21494, z: 16 });
    expect(latLonToTile(51.5074, -0.1278, 12)).toEqual({ x: 2046, y: 1362, z: 12 });
    expect(latLonToTile(-33.8688, 151.2093, 15)).toEqual({ x: 30147, y: 19663, z: 15 });
    // The RADAR fix from the design screens.
    expect(latLonToTile(39.0997, -84.5786, 14)).toEqual({ x: 4342, y: 6255, z: 14 });
    expect(latLonToTile(39.0997, -84.5786, 16)).toEqual({ x: 17370, y: 25023, z: 16 });
  });

  it('has exactly one tile at z0', () => {
    expect(tilesPerAxis(0)).toBe(1);
    for (const [lat, lon] of [
      [0, 0],
      [85, 179.9],
      [-85, -179.9],
      [39.0997, -84.5786],
    ] as ReadonlyArray<readonly [number, number]>) {
      expect(latLonToTile(lat, lon, 0)).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('splits the world into quadrants at z1', () => {
    expect(latLonToTile(45, -90, 1)).toEqual({ x: 0, y: 0, z: 1 }); // NW
    expect(latLonToTile(45, 90, 1)).toEqual({ x: 1, y: 0, z: 1 }); // NE
    expect(latLonToTile(-45, -90, 1)).toEqual({ x: 0, y: 1, z: 1 }); // SW
    expect(latLonToTile(-45, 90, 1)).toEqual({ x: 1, y: 1, z: 1 }); // SE
  });

  it('clamps the poles into the first and last row', () => {
    expect(clampMercatorLatitude(90)).toBe(WEB_MERCATOR_MAX_LATITUDE);
    expect(clampMercatorLatitude(-90)).toBe(-WEB_MERCATOR_MAX_LATITUDE);
    expect(clampMercatorLatitude(12.5)).toBe(12.5);

    for (const z of [1, 3, 10, 22]) {
      const n = 2 ** z;
      expect(latLonToTile(90, 0, z).y).toBe(0);
      expect(latLonToTile(-90, 0, z).y).toBe(n - 1);
      expect(latLonToTile(WEB_MERCATOR_MAX_LATITUDE, 0, z).y).toBe(0);
      expect(latLonToTile(-WEB_MERCATOR_MAX_LATITUDE, 0, z).y).toBe(n - 1);
    }
    expect(latLonToTile(90, 0, 3)).toEqual({ x: 4, y: 0, z: 3 });
    expect(latLonToTile(-90, 0, 3)).toEqual({ x: 4, y: 7, z: 3 });
  });

  it('wraps the antimeridian instead of falling off it', () => {
    expect(latLonToTile(0, 179.99, 10).x).toBe(1023);
    expect(latLonToTile(0, -179.99, 10).x).toBe(0);
    // +180 and -180 are the same meridian and must land in the same column.
    expect(latLonToTile(0, 180, 10).x).toBe(latLonToTile(0, -180, 10).x);
    expect(latLonToTile(0, 180, 10).x).toBe(0);
  });

  it('rejects invalid coordinates and zooms', () => {
    expect(() => latLonToTile(Number.NaN, 0, 10)).toThrow(RangeError);
    expect(() => latLonToTile(0, Number.NaN, 10)).toThrow(RangeError);
    expect(() => latLonToTile(91, 0, 10)).toThrow(RangeError);
    expect(() => latLonToTile(0, 181, 10)).toThrow(RangeError);
    expect(() => latLonToTile(0, 0, MIN_TILE_ZOOM - 1)).toThrow(RangeError);
    expect(() => latLonToTile(0, 0, MAX_TILE_ZOOM + 1)).toThrow(RangeError);
    expect(() => latLonToTile(0, 0, 1.5)).toThrow(RangeError);
    expect(() => latLonToTile(0, 0, Number.NaN)).toThrow(RangeError);
    expect(() => tilesPerAxis(-1)).toThrow(RangeError);
  });

  it('accepts both zoom limits', () => {
    expect(() => latLonToTile(0, 0, MIN_TILE_ZOOM)).not.toThrow();
    expect(() => latLonToTile(0, 0, MAX_TILE_ZOOM)).not.toThrow();
  });
});

describe('surroundingTiles', () => {
  const key = (t: TileRef): string => tileKey(t);

  it('returns (2r+1)^2 tiles away from the poles and the ring seam', () => {
    for (const radius of [0, 1, 2, 3]) {
      const tiles = surroundingTiles(39.0997, -84.5786, 14, radius);
      expect(tiles).toHaveLength((2 * radius + 1) ** 2);
      expect(new Set(tiles.map(key)).size).toBe(tiles.length);
    }
  });

  it('defaults to a radius of one', () => {
    expect(surroundingTiles(39.0997, -84.5786, 14)).toHaveLength(9);
  });

  it('centres on the tile the coordinate is in, in row-major order', () => {
    const centre = latLonToTile(39.0997, -84.5786, 14);
    const tiles = surroundingTiles(39.0997, -84.5786, 14, 1);
    expect(tiles.map(key)).toEqual([
      tileKey({ x: centre.x - 1, y: centre.y - 1, z: 14 }),
      tileKey({ x: centre.x, y: centre.y - 1, z: 14 }),
      tileKey({ x: centre.x + 1, y: centre.y - 1, z: 14 }),
      tileKey({ x: centre.x - 1, y: centre.y, z: 14 }),
      tileKey({ x: centre.x, y: centre.y, z: 14 }),
      tileKey({ x: centre.x + 1, y: centre.y, z: 14 }),
      tileKey({ x: centre.x - 1, y: centre.y + 1, z: 14 }),
      tileKey({ x: centre.x, y: centre.y + 1, z: 14 }),
      tileKey({ x: centre.x + 1, y: centre.y + 1, z: 14 }),
    ]);
  });

  it('wraps x across the antimeridian', () => {
    const z = 10;
    const n = 2 ** z;
    const east = surroundingTiles(0, 179.99, z, 1);
    expect(east).toHaveLength(9);
    expect(new Set(east.map((t) => t.x))).toEqual(new Set([n - 2, n - 1, 0]));

    const west = surroundingTiles(0, -179.99, z, 1);
    expect(new Set(west.map((t) => t.x))).toEqual(new Set([n - 1, 0, 1]));

    // Both fetch sets include the tiles on the far side of the date line, so a
    // camera does not appear out of nowhere when the longitude sign flips.
    const shared = east.filter((t) => west.some((w) => tileKey(w) === tileKey(t)));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('omits rows that do not exist rather than folding them over the pole', () => {
    const tiles = surroundingTiles(WEB_MERCATOR_MAX_LATITUDE, 0, 3, 1);
    // Centre row is y=0, so the row above it is not a place.
    expect(tiles.every((t) => t.y >= 0 && t.y < 8)).toBe(true);
    expect(new Set(tiles.map((t) => t.y))).toEqual(new Set([0, 1]));
    expect(tiles).toHaveLength(6);

    const south = surroundingTiles(-WEB_MERCATOR_MAX_LATITUDE, 0, 3, 1);
    expect(new Set(south.map((t) => t.y))).toEqual(new Set([6, 7]));
    expect(south).toHaveLength(6);
  });

  it('deduplicates when the ring laps the world', () => {
    expect(surroundingTiles(0, 0, 0, 1)).toEqual([{ x: 0, y: 0, z: 0 }]);
    expect(surroundingTiles(0, 0, 0, 8)).toHaveLength(1);
    // z1 is 2x2: a radius-1 ring wraps onto itself in x and clips in y.
    const z1 = surroundingTiles(45, -90, 1, 1);
    expect(new Set(z1.map(key)).size).toBe(z1.length);
    expect(z1.every((t) => t.x >= 0 && t.x < 2 && t.y >= 0 && t.y < 2)).toBe(true);
  });

  it('rejects a nonsensical radius', () => {
    expect(() => surroundingTiles(0, 0, 10, -1)).toThrow(RangeError);
    expect(() => surroundingTiles(0, 0, 10, 1.5)).toThrow(RangeError);
    expect(() => surroundingTiles(0, 0, 10, MAX_SURROUNDING_RADIUS + 1)).toThrow(RangeError);
    expect(() => surroundingTiles(0, 0, 10, Number.NaN)).toThrow(RangeError);
    expect(() => surroundingTiles(Number.NaN, 0, 10, 1)).toThrow(RangeError);
    expect(() => surroundingTiles(0, 0, 23, 1)).toThrow(RangeError);
  });

  it('always reports every tile as in-bounds for its zoom', () => {
    for (const [lat, lon, z] of [
      [39.0997, -84.5786, 14],
      [85, 179.99, 6],
      [-85, -179.99, 6],
      [0, 0, 1],
      [0, 0, 22],
    ] as ReadonlyArray<readonly [number, number, number]>) {
      const n = 2 ** z;
      for (const tile of surroundingTiles(lat, lon, z, 2)) {
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.x).toBeLessThan(n);
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeLessThan(n);
        expect(tile.z).toBe(z);
      }
    }
  });
});

describe('tileKey', () => {
  it('is z/x/y', () => {
    expect(tileKey({ x: 4342, y: 6255, z: 14 })).toBe('14/4342/6255');
  });
});
