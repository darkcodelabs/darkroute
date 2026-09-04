/**
 * READ ONE SPEED TILE, DIRECTLY - not through the map.
 *
 * =============================================================================
 * WHY NOT LET MAPLIBRE DO IT
 * =============================================================================
 * The obvious approach is to declare the speeds archive as a vector source and
 * call `querySourceFeatures`. It does not work, for a reason that is structural
 * rather than a bug:
 *
 *   THE ARCHIVE IS Z14-ONLY. It holds one zoom level, because a speed limit is
 *   a property of a road you are ON and there is no reason to generalise it.
 *   MapLibre can OVERZOOM past a source's maximum -- it will happily draw z14
 *   data at z18 -- but it cannot UNDERZOOM, because that would mean merging
 *   four child tiles into a parent it does not have. RADAR sits around z11 by
 *   default, so the map never requested a single tile and every query returned
 *   nothing. The plate showed a dash on every road in the country, which reads
 *   exactly like missing data rather than an unasked question.
 *
 * The driver is at ONE point. That point is in exactly one z14 tile. So fetch
 * that tile, decode it, and keep it until they drive out of it -- which is
 * roughly every two kilometres, and needs no map at all.
 *
 * =============================================================================
 * WHAT IT COSTS
 * =============================================================================
 * One HTTP range read of a few kilobytes per tile crossed, memoised. The
 * archive is 126 MB for the country and the client touches almost none of it.
 */

import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
// pbf 5 exports PbfReader/PbfWriter, not a default `Pbf`. The old default-import
// form both fails to type-check and, under looser interop, silently resolves to
// `any` -- which would have decoded garbage rather than erroring.
import { PbfReader } from 'pbf';

import { DEFAULT_SPEEDS_URL } from './basemap.ts';

/** The archive holds this zoom and only this zoom. */
export const SPEED_ZOOM = 14;

/** The layer inside each tile, and the attribute on it. */
const LAYER = 'speed';
const ATTRIBUTE = 'mph';

export interface SpeedWay {
  /** The OSM `maxspeed` string, verbatim. Parsing belongs to `speedLimit.ts`. */
  readonly maxspeed: string;
  /** Line geometry in lon/lat. */
  readonly line: readonly (readonly [number, number])[];
}

export function tileFor(lon: number, lat: number, z: number = SPEED_ZOOM): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

let archive: PMTiles | null = null;

/**
 * The decoded ways for one tile, memoised.
 *
 * Bounded deliberately: a driver crossing tiles all day would otherwise
 * accumulate every road they have driven past for the life of the session, and
 * the only tile that matters is the one they are in.
 */
const cache = new Map<string, readonly SpeedWay[]>();
const MAX_CACHED_TILES = 8;

/** Decode one MVT into lon/lat lines, dropping anything without a limit. */
function decode(buffer: ArrayBuffer, x: number, y: number, z: number): readonly SpeedWay[] {
  const tile = new VectorTile(new PbfReader(new Uint8Array(buffer)));
  const layer = tile.layers[LAYER];
  if (layer === undefined) return [];

  const ways: SpeedWay[] = [];
  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    const maxspeed = feature.properties[ATTRIBUTE];
    if (typeof maxspeed !== 'string' || maxspeed.trim() === '') continue;
    // `toGeoJSON` does the tile-extent-to-lon/lat conversion, which is the one
    // piece of this that is genuinely fiddly and genuinely already written.
    const geo = feature.toGeoJSON(x, y, z) as {
      geometry: { type: string; coordinates: unknown };
    };
    const coords = geo.geometry.coordinates;
    if (geo.geometry.type === 'LineString' && Array.isArray(coords)) {
      ways.push({ maxspeed, line: coords as [number, number][] });
    } else if (geo.geometry.type === 'MultiLineString' && Array.isArray(coords)) {
      for (const part of coords as [number, number][][]) ways.push({ maxspeed, line: part });
    }
  }
  return ways;
}

/**
 * Every speed-carrying way in the tile containing this point.
 *
 * Returns an empty array for a tile the archive does not hold, which is the
 * normal case: it only contains ways that actually carry `maxspeed`, and most
 * of the country's residential streets do not.
 */
export async function waysNear(
  lon: number,
  lat: number,
  url: string = DEFAULT_SPEEDS_URL,
): Promise<readonly SpeedWay[]> {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
  const { x, y } = tileFor(lon, lat);
  const key = `${String(x)}/${String(y)}`;
  const held = cache.get(key);
  if (held !== undefined) return held;

  try {
    archive ??= new PMTiles(url);
    const result = await archive.getZxy(SPEED_ZOOM, x, y);
    const ways = result?.data === undefined ? [] : decode(result.data, x, y, SPEED_ZOOM);
    if (cache.size >= MAX_CACHED_TILES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, ways);
    return ways;
  } catch {
    // Offline, a 404, a truncated read. A dash is the correct answer and the
    // plate already shows one; nothing here is worth an error to the driver.
    return [];
  }
}

/** Test seam. */
export function resetSpeedSource(): void {
  archive = null;
  cache.clear();
}
