/**
 * ===========================================================================
 * FIXTURE DATA - NOT REAL SURVEILLANCE DATA
 * ===========================================================================
 *
 * The cameras from `./cameras.ts`, packed into slippy tiles so the tile
 * repository can be filled without a backend, a network or a running API.
 *
 * Everything here inherits the warning on `./cameras.ts`: none of these cameras
 * exists. Every tile produced by this module carries `source: 'fixture'`, the
 * `TileSource` value `db/schema.ts` added for exactly this purpose - "`fixture`
 * exists because the PWA ships a drive simulator and the simulator's cameras
 * must never be mistaken for cameras somebody actually reported."
 *
 * ---------------------------------------------------------------------------
 * THE PACKING IS COMPUTED, NOT TRANSCRIBED
 *
 * Tile addresses are derived at module load with `latLonToTile` from
 * `@fwm/core` - the same function the app uses to decide which tiles to fetch.
 * A hand-written table of x/y literals would drift the moment the zoom or the
 * projection changed, and it would drift silently, because a tile that is one
 * column off still looks like a plausible tile. Deriving costs nine calls.
 */

import {
  latLonToTile,
  surroundingTiles,
  tileKey,
  type TileRef,
} from '../../services/simulator/fwmCore.ts';
import type {
  CameraRecord,
  CameraTileRecord,
  TileKey,
  TileMetaRecord,
} from '../../services/db/schema.ts';
import type { CameraTileInput } from '../../services/db/repositories/cameraTiles.ts';
import type { TileCheckInput } from '../../services/db/repositories/tileMeta.ts';
import {
  FIXTURE_CAMERAS,
  fixtureCameras,
  toCameraRecord,
  type FixtureCameraRecord,
} from './cameras.ts';

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/**
 * The zoom the fixture packs at.
 *
 * GAP: see DESIGN-GAPS.md#fixture-tile-working-zoom
 *
 * The design files never name a zoom. z16 is chosen because of what it makes
 * true at the latitude the copy is set in: a z16 tile at 39.14° N is about
 * 474 m across - roughly 1,556 ft - so the 3×3 fetch ring `surroundingTiles`
 * produces covers the 1,000 ft outer edge of the APPROACHING band from
 * anywhere inside the centre tile, with the whole band still inside the ring
 * even standing on a tile corner. One zoom deeper and a driver at 60 mph
 * crosses a tile every 9 seconds; one shallower and a single tile is a
 * kilometre of city, which makes the OFFLINE screen's per-tile freshness
 * ("MAP TILES 318") too coarse to mean anything.
 */
export const FIXTURE_TILE_ZOOM = 16;

/**
 * Radius of the fetch ring a simulated drive prefetches, in tiles.
 *
 * GAP: see DESIGN-GAPS.md#fixture-tile-fetch-ring-radius
 *
 * 1 is a 3×3 block. `surroundingTiles` caps at 8 and calls anything larger a
 * caller bug; a phone loading 289 tiles to drive down one street is that bug.
 * At {@link FIXTURE_TILE_ZOOM} a 3×3 block is about 1.4 km square, which holds
 * the 1,000 ft alert band from anywhere in the middle tile - but the design
 * never states how far ahead the app should read.
 */
export const FIXTURE_TILE_RING_RADIUS = 1;

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/** One packed tile: its address, its cache key and the cameras inside it. */
export interface FixtureTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** `z/x/y`, the same string `tileKey` produces for the cache. */
  readonly key: string;
  /** IndexedDB primary key for `cameraTiles`, `[z, x, y]`. */
  readonly primaryKey: TileKey;
  readonly cameras: readonly FixtureCameraRecord[];
}

function refOf(camera: FixtureCameraRecord, zoom: number): TileRef {
  return latLonToTile(camera.lat, camera.lon, zoom);
}

/**
 * Pack an arbitrary camera set into tiles at a zoom.
 *
 * Tiles come back in `z/x/y` string order and cameras keep the order they
 * arrived in, so the output is stable across runs and a snapshot of it is worth
 * taking. A camera lands in exactly one tile - tiles partition the plane, they
 * do not overlap - which is what makes the "every camera appears once" check in
 * `fixtures.test.ts` meaningful.
 */
export function packIntoTiles(
  cameras: readonly FixtureCameraRecord[],
  zoom: number = FIXTURE_TILE_ZOOM,
): FixtureTile[] {
  const buckets = new Map<string, { ref: TileRef; cameras: FixtureCameraRecord[] }>();
  for (const camera of cameras) {
    const ref = refOf(camera, zoom);
    const key = tileKey(ref);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, { ref, cameras: [camera] });
    else bucket.cameras.push(camera);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { ref, cameras: inTile }]) => ({
      z: ref.z,
      x: ref.x,
      y: ref.y,
      key,
      primaryKey: [ref.z, ref.x, ref.y] as TileKey,
      cameras: inTile,
    }));
}

/** Every fixture camera, packed at {@link FIXTURE_TILE_ZOOM}. */
export const FIXTURE_TILES: readonly FixtureTile[] = packIntoTiles(FIXTURE_CAMERAS);

/** Just the primary keys, for `getMany` / `camerasIn`. */
export function fixtureTileKeys(tiles: readonly FixtureTile[] = FIXTURE_TILES): TileKey[] {
  return tiles.map((tile) => tile.primaryKey);
}

/** The tiles holding a named subset of cameras. */
export function fixtureTilesFor(cameraIds: readonly string[]): FixtureTile[] {
  return packIntoTiles(fixtureCameras(cameraIds));
}

/** The tile a coordinate falls in, at the fixture zoom. */
export function fixtureTileAt(lat: number, lon: number): TileRef {
  return latLonToTile(lat, lon, FIXTURE_TILE_ZOOM);
}

/**
 * The fetch ring around a coordinate at the fixture zoom - what a drive would
 * ask the backend for, and what the cache is expected to already hold.
 */
export function fixtureRingAt(
  lat: number,
  lon: number,
  radius: number = FIXTURE_TILE_RING_RADIUS,
): TileRef[] {
  return surroundingTiles(lat, lon, FIXTURE_TILE_ZOOM, radius);
}

// ---------------------------------------------------------------------------
// Repository inputs
// ---------------------------------------------------------------------------

/**
 * When a fixture tile claims it was fetched, epoch ms.
 *
 * Zero, matching `createTestClock`'s default start, so a test driving the
 * injected clock reads elapsed time rather than wall time. Pass `fetchedAt`
 * explicitly to age a tile into staleness.
 */
export const FIXTURE_FETCHED_AT_MS = 0;

export interface FixtureTileInputOptions {
  /** Epoch ms to stamp on every tile. Defaults to {@link FIXTURE_FETCHED_AT_MS}. */
  readonly fetchedAt?: number;
  /** Pack only these cameras. Defaults to the whole set. */
  readonly cameraIds?: readonly string[];
}

/**
 * Tiles in the shape `cameraTilesRepository.putMany()` takes.
 *
 * `source` is hard-coded `'fixture'` and is not an option. A caller who wants
 * these rows to claim they came off the network is a caller who wants a
 * fixture to be indistinguishable from real data in storage, and that is the
 * one thing this module exists to prevent.
 */
export function fixtureTileInputs(options: FixtureTileInputOptions = {}): CameraTileInput[] {
  const tiles =
    options.cameraIds === undefined ? FIXTURE_TILES : fixtureTilesFor(options.cameraIds);
  const fetchedAt = options.fetchedAt ?? FIXTURE_FETCHED_AT_MS;
  return tiles.map((tile) => ({
    z: tile.z,
    x: tile.x,
    y: tile.y,
    cameras: tile.cameras.map(toCameraRecord),
    source: 'fixture' as const,
    fetchedAt,
  }));
}

/**
 * Freshness rows in the shape `tileMetaRepository.markChecked()` takes.
 *
 * `freshness` is left to the repository's own default rather than asserted
 * here: a fixture claiming a tile is `fresh` is a fixture asserting something
 * about a source it never contacted. The OFFLINE screen's whole point is that
 * `unknown` and `stale` are different from `fresh`, and a test that wants one
 * of them should say so.
 */
export function fixtureTileChecks(options: FixtureTileInputOptions = {}): TileCheckInput[] {
  const tiles =
    options.cameraIds === undefined ? FIXTURE_TILES : fixtureTilesFor(options.cameraIds);
  const checkedAt = options.fetchedAt ?? FIXTURE_FETCHED_AT_MS;
  return tiles.map((tile) => ({
    z: tile.z,
    x: tile.x,
    y: tile.y,
    cameraCount: tile.cameras.length,
    checkedAt,
  }));
}

/**
 * Fully-formed `cameraTiles` rows, for a test that wants to seed a fake store
 * directly instead of going through the repository.
 */
export function fixtureTileRecords(options: FixtureTileInputOptions = {}): CameraTileRecord[] {
  return fixtureTileInputs(options).map((input) => ({
    z: input.z,
    x: input.x,
    y: input.y,
    cameras: input.cameras,
    fetchedAt: input.fetchedAt ?? FIXTURE_FETCHED_AT_MS,
    source: input.source,
  }));
}

/** Fully-formed `tileMeta` rows to match {@link fixtureTileRecords}. */
export function fixtureTileMetaRecords(
  options: FixtureTileInputOptions & { readonly staleAfterMs: number },
): TileMetaRecord[] {
  return fixtureTileChecks(options).map((check) => ({
    z: check.z,
    x: check.x,
    y: check.y,
    freshness: 'unknown' as const,
    lastCheckedAt: check.checkedAt ?? FIXTURE_FETCHED_AT_MS,
    staleAfterMs: options.staleAfterMs,
    cameraCount: check.cameraCount,
  }));
}

/** Every fixture camera in cached-record form, ordered by id. */
export function fixtureCameraRecords(): CameraRecord[] {
  return FIXTURE_CAMERAS.map(toCameraRecord);
}
