/**
 * CAMERAS IN A BOUNDING BOX.
 *
 * =============================================================================
 * IT READS THE ARCHIVE THROUGH THE APP'S OWN ROUTE
 * =============================================================================
 * The obvious implementation reads R2 directly. This one issues a same-origin
 * subrequest to `/cameras/11/{x}/{y}.json` instead - the identical URL the app
 * asks for - and there are three reasons, in ascending order of importance.
 *
 *   IT INHERITS THE EDGE CACHE. Those tiles are already cached for an hour by
 *   the camera route, so a popular square costs this API nothing on the second
 *   call. A direct R2 read would bypass that and pay for every request.
 *
 *   IT CANNOT DRIFT. `functions/cameras/[[path]].ts` owns the camera generation
 *   protocol: the pointer, the slot, the flat-root fallback, the synthesised
 *   generation. Copying ~150 lines of that here would create a second
 *   implementation of a consistency protocol whose entire purpose is to stop a
 *   new watermark being paired with an old snapshot. Two implementations of
 *   that is how it eventually happens.
 *
 *   IT CANNOT SERVE WHAT THE APP WOULD NOT. If the archive is unavailable to a
 *   driver, it is unavailable here, by construction and in the same breath.
 *   An API that answers from a source the product itself refused would be
 *   publishing something nobody has verified.
 *
 * =============================================================================
 * THE CAPS ARE THE ACTUAL DEFENCE
 * =============================================================================
 * The rate limiter in `_middleware.ts` is a speed bump; see its notes. What
 * stops the archive being pulled in one afternoon is that no single request can
 * ask for much: a bounded box, a bounded row count, and a bounded number of
 * tiles touched per call. Together those turn "give me the country" into
 * "make thousands of requests", which is the shape a rate limiter can see.
 *
 * The whole archive is published as a downloadable dataset anyway. Bulk users
 * are pointed at it rather than fought - the caps exist so that bulk access
 * happens the cheap way, not so that it cannot happen.
 */

import { json } from './_middleware.ts';

interface Env {
  readonly CAMERA_TILES?: R2Bucket;
}

/** The archive's own tiling. Cameras are published at zoom 11 and only there. */
const ZOOM = 11;
const TILES_AT_ZOOM = 2 ** ZOOM;

/**
 * How much ground one request may cover.
 *
 * 1.5 degrees square is a large metro area and its surroundings - comfortably
 * more than any map view, and far less than a state. Someone mapping a city
 * makes one request; someone sweeping the country cannot.
 */
export const MAX_SPAN_DEG = 1.5;

/**
 * How many tiles one request may open.
 *
 * The real cost of a request is subrequests, not rows. A 1.5-degree box at
 * zoom 11 is bounded by the span check above, but a thin box straddling a tile
 * boundary can still touch more tiles than its area suggests, so the fan-out is
 * capped on its own terms rather than inferred from the geometry.
 */
export const MAX_TILES = 24;

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

/** Exported so `openapi.json.ts` quotes the list this file enforces, not a copy. */
export const OWNER_TYPES = new Set([
  'police',
  'inter_agency',
  'hoa',
  'private',
  'unverified',
]);

function lonToTileX(lon: number): number {
  return Math.floor(((lon + 180) / 360) * TILES_AT_ZOOM);
}

function latToTileY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * TILES_AT_ZOOM,
  );
  return Math.min(TILES_AT_ZOOM - 1, Math.max(0, y));
}

interface Box {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

type Parsed = { ok: true; box: Box } | { ok: false; detail: string };

/**
 * `bbox=west,south,east,north`, the order GeoJSON and OGC both use.
 *
 * Every failure names the actual problem. "invalid bbox" tells a caller
 * nothing, and the first thing they will do is retry it unchanged.
 */
function parseBox(raw: string | null): Parsed {
  if (raw === null || raw === '') {
    return { ok: false, detail: 'bbox is required, as bbox=west,south,east,north in degrees' };
  }
  const parts = raw.split(',');
  if (parts.length !== 4) {
    return { ok: false, detail: `bbox needs 4 comma-separated numbers, got ${String(parts.length)}` };
  }

  /*
   * Read positionally and NARROWED, not destructured.
   *
   * `functions/tsconfig.json` sets `noUncheckedIndexedAccess`, so an index into
   * a split string is `number | undefined` however many elements were just
   * counted - and rightly: the length check and the reads are two separate
   * facts as far as the compiler is concerned. Validating each one here makes
   * the four names genuinely `number` for everything below, instead of asking
   * the reader to trust an earlier line.
   */
  const NAMES = ['west', 'south', 'east', 'north'] as const;
  const values: number[] = [];
  for (const [index, name] of NAMES.entries()) {
    const raw_ = parts[index];
    const value = raw_ === undefined ? Number.NaN : Number(raw_.trim());
    if (!Number.isFinite(value)) return { ok: false, detail: `bbox ${name} is not a number` };
    values.push(value);
  }
  const [west, south, east, north] = values as [number, number, number, number];
  if (west < -180 || east > 180) return { ok: false, detail: 'longitude must be within -180..180' };
  // Web Mercator is undefined at the poles, and the archive is US-only anyway.
  if (south < -85 || north > 85) return { ok: false, detail: 'latitude must be within -85..85' };
  if (east <= west) return { ok: false, detail: 'bbox east must be greater than west' };
  if (north <= south) return { ok: false, detail: 'bbox north must be greater than south' };

  const spanLon = east - west;
  const spanLat = north - south;
  if (spanLon > MAX_SPAN_DEG || spanLat > MAX_SPAN_DEG) {
    return {
      ok: false,
      detail:
        `bbox may span at most ${String(MAX_SPAN_DEG)} degrees on a side, asked for ` +
        `${spanLon.toFixed(2)} x ${spanLat.toFixed(2)}. the full archive is published as a ` +
        'dataset - use that for bulk access rather than widening this.',
    };
  }
  return { ok: true, box: { west, south, east, north } };
}

interface TileCamera {
  readonly id?: unknown;
  readonly lat?: unknown;
  readonly lon?: unknown;
  readonly ownerType?: unknown;
  readonly street?: unknown;
  readonly cross?: unknown;
  readonly directionDeg?: unknown;
  readonly tags?: unknown;
  readonly locality?: unknown;
  readonly streetM?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  const parsed = parseBox(url.searchParams.get('bbox'));
  if (!parsed.ok) return json(400, { error: 'bad_bbox', detail: parsed.detail });
  const { box } = parsed;

  const ownerParam = url.searchParams.get('owner');
  if (ownerParam !== null && !OWNER_TYPES.has(ownerParam)) {
    return json(400, {
      error: 'bad_owner',
      detail: `owner must be one of: ${[...OWNER_TYPES].join(', ')}`,
    });
  }

  const limitParam = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const value = Number(limitParam);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
      return json(400, {
        error: 'bad_limit',
        detail: `limit must be an integer from 1 to ${String(MAX_LIMIT)}`,
      });
    }
    limit = value;
  }

  const minX = lonToTileX(box.west);
  const maxX = lonToTileX(box.east);
  // Tile Y grows southward, so the north edge gives the smaller index.
  const minY = latToTileY(box.north);
  const maxY = latToTileY(box.south);

  const tiles: string[] = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      tiles.push(`${String(ZOOM)}/${String(x)}/${String(y)}.json`);
    }
  }

  if (tiles.length > MAX_TILES) {
    return json(400, {
      error: 'too_many_tiles',
      detail:
        `that box covers ${String(tiles.length)} archive tiles and the limit is ` +
        `${String(MAX_TILES)}. ask for a smaller area, or take the published dataset.`,
    });
  }

  /*
   * Sequential, not Promise.all.
   *
   * A Worker has a subrequest budget and a concurrency limit, and firing 24 at
   * once is how one caller's request becomes everybody's 5xx. These are edge
   * cache hits in the common case, so the serial cost is small - and a request
   * that is slightly slower under load is strictly better than one that fails.
   */
  const cameras: Record<string, unknown>[] = [];
  let missingTiles = 0;
  let truncated = false;

  for (const tile of tiles) {
    if (cameras.length >= limit) {
      truncated = true;
      break;
    }
    const tileUrl = new URL(`/cameras/${tile}`, url.origin);
    const response = await fetch(tileUrl.toString(), {
      headers: { accept: 'application/json' },
    });

    // 404 is the archive's normal answer for a square with no ALPR in it. It is
    // a fact about the country, not a failure, and it is counted rather than
    // raised.
    if (response.status === 404) {
      missingTiles += 1;
      continue;
    }
    if (!response.ok) {
      return json(503, {
        error: 'archive_unavailable',
        detail: 'the camera archive did not answer; nothing is being served from a stale copy',
      });
    }

    const body: unknown = await response.json();
    const list: unknown = isRecord(body) ? body['cameras'] : null;
    if (!Array.isArray(list)) continue;

    for (const entry of list as TileCamera[]) {
      if (cameras.length >= limit) {
        truncated = true;
        break;
      }
      const lat = entry.lat;
      const lon = entry.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      // The tile is a 15 km square; the caller asked for a box inside it.
      if (lat < box.south || lat > box.north || lon < box.west || lon > box.east) continue;
      if (ownerParam !== null && entry.ownerType !== ownerParam) continue;

      cameras.push({
        id: entry.id,
        lat,
        lon,
        ownerType: typeof entry.ownerType === 'string' ? entry.ownerType : null,
        street: typeof entry.street === 'string' ? entry.street : null,
        cross: typeof entry.cross === 'string' ? entry.cross : null,
        directionDeg: typeof entry.directionDeg === 'number' ? entry.directionDeg : null,
        operator:
          isRecord(entry.tags) && typeof entry.tags['operator'] === 'string'
            ? entry.tags['operator']
            : null,
        /* THE REST OF WHAT A RECORD KNOWS, for a console that shows it: the
           maker and mount from the retained OSM tags, and the town and the
           distance to the street from the pinned release context. Null where
           the record did not say, never a guess. */
        manufacturer:
          isRecord(entry.tags) && typeof entry.tags['manufacturer'] === 'string'
            ? entry.tags['manufacturer']
            : null,
        mount:
          isRecord(entry.tags) && typeof entry.tags['camera:mount'] === 'string'
            ? entry.tags['camera:mount']
            : null,
        locality: typeof entry.locality === 'string' ? entry.locality : null,
        streetM: typeof entry.streetM === 'number' ? entry.streetM : null,
      });
    }
  }

  return json(200, {
    /*
     * ATTRIBUTION TRAVELS WITH THE DATA, in every response rather than only in
     * the documentation. ODbL obliges anyone redistributing this to credit
     * OpenStreetMap, and a caller who never reads the docs still ends up
     * holding the notice.
     */
    attribution: 'Map data © OpenStreetMap contributors',
    licence: 'ODbL-1.0',
    query: { bbox: [box.west, box.south, box.east, box.north], owner: ownerParam, limit },
    count: cameras.length,
    /*
     * Both numbers are reported because they mean opposite things, and a caller
     * who cannot tell them apart will read the wrong one as safety.
     *
     * `truncated` means there is more here than you were given.
     * `emptyTiles` means those squares genuinely hold no mapped camera - which
     * is NOT the same as "there is no camera there". Coverage is uneven and an
     * empty answer is never evidence of absence.
     */
    truncated,
    emptyTiles: missingTiles,
    cameras,
  });
};
