/**
 * Slippy-map tile addressing (Web Mercator / XYZ), the scheme the backend
 * serves camera tiles in and IndexedDB caches them under.
 *
 * The formula is the standard one, written with `asinh(tan φ)` rather than
 * `log(tan φ + sec φ)`. They are the same identity; `asinh` is the numerically
 * better-behaved half of it near the projection limit.
 */

import { assertLatLon, normaliseLongitudeDeg } from './geo.ts';
import type { TileRef } from './types.ts';

/** Zoom 0 is the single world tile. */
export const MIN_TILE_ZOOM = 0;

/**
 * Upper zoom bound. 22 is the deepest level the XYZ scheme is defined for in
 * practice (a z22 tile is roughly 9 m across at the equator). Bounding zoom is
 * also a server-side requirement - an unbounded z is an unbounded spatial
 * query - so the client refuses to ask for one.
 */
export const MAX_TILE_ZOOM = 22;

/**
 * Web Mercator cannot represent the poles: the projection runs to infinity.
 * The conventional cut is the latitude that makes the world square.
 */
export const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;

/**
 * Largest `radius` {@link surroundingTiles} will accept. r=8 is 289 tiles,
 * already far past anything a phone should fetch in one go; beyond that the
 * caller has a bug, not a requirement.
 */
export const MAX_SURROUNDING_RADIUS = 8;

function assertZoom(z: number): void {
  if (!Number.isInteger(z) || z < MIN_TILE_ZOOM || z > MAX_TILE_ZOOM) {
    throw new RangeError(
      `tile zoom must be an integer in [${String(MIN_TILE_ZOOM)}, ${String(MAX_TILE_ZOOM)}], received ${String(z)}`,
    );
  }
}

/** Tiles per axis at a zoom: 2^z. */
export function tilesPerAxis(z: number): number {
  assertZoom(z);
  return 2 ** z;
}

/**
 * Latitude clamped into the projectable band. A fix at the pole is a real fix;
 * it just lands in the top or bottom tile row rather than off the map.
 */
export function clampMercatorLatitude(lat: number): number {
  return Math.min(WEB_MERCATOR_MAX_LATITUDE, Math.max(-WEB_MERCATOR_MAX_LATITUDE, lat));
}

/**
 * The tile containing a coordinate.
 *
 * Longitude wraps (180 and -180 are the same meridian, and both land in the
 * x=0 column). Latitude clamps at the Mercator limit, so the poles resolve to
 * the first and last tile row instead of throwing or overflowing.
 *
 * @throws RangeError on invalid coordinates or an out-of-bounds zoom.
 */
export function latLonToTile(lat: number, lon: number, z: number): TileRef {
  assertLatLon(lat, lon, 'latLonToTile');
  assertZoom(z);

  const n = 2 ** z;
  const wrappedLon = normaliseLongitudeDeg(lon);
  const clampedLat = clampMercatorLatitude(lat);
  const latRad = (clampedLat * Math.PI) / 180;

  const rawX = Math.floor(((wrappedLon + 180) / 360) * n);
  const rawY = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);

  // Floating point at the exact edges can push a value one past the last
  // index; clamping is cheaper than trusting it not to.
  return {
    x: Math.min(n - 1, Math.max(0, rawX)),
    y: Math.min(n - 1, Math.max(0, rawY)),
    z,
  };
}

/**
 * The tile a coordinate is in, plus the ring(s) of tiles around it - the fetch
 * set that keeps a camera from appearing out of nowhere at the tile seam.
 *
 * Contract:
 *  - Row-major order from the north-west corner, deterministic across runs.
 *  - x wraps around the antimeridian, so a fix at 179.99°E gets the tiles on
 *    the far side of the date line too.
 *  - y does NOT wrap. There is no tile row above the north pole; those rows are
 *    omitted rather than folded onto a row that means somewhere else.
 *  - The result is deduplicated, so at low zooms where the ring laps the world
 *    (z0 has exactly one tile) you get each real tile once. Away from the poles
 *    and where 2r+1 <= 2^z, that is exactly (2r+1)^2 tiles.
 *
 * @throws RangeError on invalid coordinates, out-of-bounds zoom, or a radius
 *         that is not an integer in [0, {@link MAX_SURROUNDING_RADIUS}].
 */
export function surroundingTiles(lat: number, lon: number, z: number, radius = 1): TileRef[] {
  if (!Number.isInteger(radius) || radius < 0 || radius > MAX_SURROUNDING_RADIUS) {
    throw new RangeError(
      `surroundingTiles: radius must be an integer in [0, ${String(MAX_SURROUNDING_RADIUS)}], received ${String(radius)}`,
    );
  }
  const centre = latLonToTile(lat, lon, z);
  const n = 2 ** z;

  const out: TileRef[] = [];
  const seen = new Set<number>();

  for (let dy = -radius; dy <= radius; dy++) {
    const y = centre.y + dy;
    if (y < 0 || y >= n) continue; // no such row exists
    for (let dx = -radius; dx <= radius; dx++) {
      const x = ((centre.x + dx) % n + n) % n; // wraps the antimeridian
      const key = y * n + x;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, z });
    }
  }
  return out;
}

/** Stable cache key for a tile. */
export function tileKey(tile: TileRef): string {
  return `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`;
}
