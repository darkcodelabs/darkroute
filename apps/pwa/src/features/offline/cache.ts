/**
 * The one read this screen performs: how much is actually USABLE, and how old.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A2 · OFFLINE - DEGRADED` -- the
 * `CACHED CAMS` / `MAP TILES` pair and the `DB last updated` warning.
 *
 * =============================================================================
 * WHERE EACH NUMBER COMES FROM
 * =============================================================================
 * Every one of them now comes out of `cameraTiles.cacheSnapshot()`, which is
 * one readonly transaction over `cameraCacheState`, `cameraTiles` and
 * `tileMeta` and which applies the expiry and coherence gates before counting
 * anything. The rules below are unchanged; what changed is that they are
 * applied to the rows that are actually usable, all read at one instant.
 *
 *   CACHED CAMS   distinct cameras across the usable tiles, de-duplicated.
 *                 NOT `cameraTiles.cameraCount()`, which sums `cameras.length`
 *                 across tiles with no de-duplication: tiles overlap at their
 *                 edges, and the repository's own `camerasIn` comment states
 *                 the rule -- "a camera that appears in two tiles is one
 *                 camera, not two alerts". A headline figure that counted the
 *                 edge cameras twice would overstate the cache on the one
 *                 screen whose job is to be exact about it.
 *                 GAP: see docs/gaps-inbox/offline.md#cached-cams-counts-distinct-cameras
 *   MAP TILES     the number of usable cached tiles.
 *                 GAP: see docs/gaps-inbox/offline.md#map-tiles-counts-camera-tiles
 *   DB age        the oldest `tileMeta.lastCheckedAt` over those same tiles.
 *                 The OLDEST check is the honest bound:
 *                 the warning is about cameras that could have been added
 *                 since, and any tile last checked two days ago could be
 *                 missing them regardless of how fresh its neighbours are.
 *                 GAP: see docs/gaps-inbox/offline.md#db-age-is-the-oldest-check
 *   CACHE age     the oldest tile's `fetchedAt`. A SEPARATE number from the one
 *                 above and never rendered as "last updated": `cameraTiles.put`
 *                 and `putMany` write the tile body ONLY, so a cache filled
 *                 through the repository's own write API has cameras in it and
 *                 no `tileMeta` row anywhere. Without this, "no check time" was
 *                 indistinguishable from "no cache", and the screen printed
 *                 "Nothing is cached" above a four-figure counter.
 *                 GAP: see docs/gaps-inbox/offline.md#cached-but-never-checked-is-undrawn
 *
 * =============================================================================
 * ONE BOUNDED SNAPSHOT, AND IT IS THE SAME GATE THE ALERT PATH APPLIES
 * =============================================================================
 * Three things about this read were wrong, and all three made the screen
 * OVERSTATE what the device holds -- on the one screen that exists to be exact
 * about it:
 *
 *   IT COULD HANG. `openFwmDb()` was called bare. A version-blocked open never
 *   settles, so `cachePort()` never resolved, `storage` stayed `unknown` and
 *   the rows that depend on it stayed em-dashes forever -- while the drive path
 *   under the identical blocked open gave up after 1.5 s and carried on. Now
 *   `openFwmDbWithin` bounds it with the same deadline, and a timeout is
 *   `unavailable` with a sentence.
 *
 *   IT WAS FIVE TRANSACTIONS. `count()`, `oldestFirstKeys()`, `camerasIn()`,
 *   `get()` and `oldestCheckedAt()` each opened their own, so a generation
 *   replacement landing between two of them produced MAP TILES 4 beside CACHED
 *   CAMS 0. `cacheSnapshot()` takes all of it in one.
 *
 *   IT COUNTED ROWS NOTHING WOULD LOAD. Rows a month past the hard expiry, and
 *   rows left mixed across two generations, were both reported as `ready` with
 *   a camera count -- while `hydrateTiles` refused every one of them. Two
 *   readers of the same bytes, opposite answers, and the reassuring one on
 *   screen. The snapshot now counts what a cold offline start would actually
 *   get, and says separately how many rows it refused and why.
 *
 * =============================================================================
 * THIS MODULE OPENS ITS OWN CONNECTION AND CLOSES IT
 * =============================================================================
 * Nothing in the app publishes a shared `FwmDatabase` handle yet, and a screen
 * may not add one -- `services/db` is not this feature's file. So the read
 * opens `fwm`, takes its one snapshot and closes again.
 *
 * It NEVER writes. No eviction sweep, no `markChecked`, no cap enforcement: a
 * driver looking at the offline screen must not have their cache mutated by
 * the act of looking at it. That is why expired rows are REPORTED here rather
 * than evicted, even though the drive path would delete them.
 */

import {
  DB_OPEN_TIMEOUT_MS,
  closeFwmDb,
  createCameraTilesRepository,
  hasIndexedDb,
  openFwmDbWithin,
} from '../../services/db';
import type { CacheIncoherence, FwmDatabase } from '../../services/db';

export interface OfflineCacheSnapshot {
  /** DISTINCT cameras across every USABLE cached tile, de-duplicated by id. */
  readonly cachedCameras: number;
  /** Cached camera tiles a cold offline start would actually load. */
  readonly cachedTiles: number;
  /**
   * Rows on disk this read refuses to advertise, and why.
   *
   * They are still there -- this read never writes -- and they are deliberately
   * NOT folded into the counters above. "There are 300 tiles on disk that
   * nothing will load" and "there are 300 tiles you can drive on" are opposite
   * claims, and only the second one is what a counter reads as.
   */
  readonly unusableTiles: number;
  readonly incoherence: CacheIncoherence;
  /**
   * The generation the durable rows belong to, or null for a legacy cache.
   *
   * The screen compares it with the generation the app is WORKING in. They can
   * legitimately differ: a complete verified network generation is admitted to
   * memory even when the durable replacement conflicts (`sync.ts`), which
   * leaves an older coherent snapshot on disk for the next restart. That is a
   * fact worth stating, not one to hide behind a healthy-looking counter.
   */
  readonly generation: string | null;
  /** Epoch ms of the oldest tile check, or null when nothing was checked. */
  readonly oldestCheckedAtMs: number | null;
  /**
   * Epoch ms of the oldest tile FETCH, or null when nothing is cached.
   *
   * When a tile was written but never checked, this is the only thing the
   * database can say about how old the copy is. It is never presented as a
   * check against the source, because it is not one.
   */
  readonly oldestFetchedAtMs: number | null;
}

/**
 * The result of one read. `unavailable` carries a sentence for the screen and
 * never carries user data -- the only strings that can reach it are this
 * module's own and an `Error.message` raised by the database layer.
 */
export type OfflineCacheRead =
  | { readonly status: 'ready'; readonly snapshot: OfflineCacheSnapshot }
  | { readonly status: 'unavailable'; readonly reason: string };

/** Injected by the screen so a test never touches a real database. */
export type OfflineCachePort = () => Promise<OfflineCacheRead>;

export interface OfflineCacheOptions {
  /** How long to wait for a blocked database before giving up. */
  readonly timeoutMs?: number;
  /**
   * The clock the hard expiry is measured against.
   *
   * Injected for the same reason the screen injects one: "is this row past the
   * 30-day expiry" is a question about a moment, and a test that seeds a fixed
   * epoch has to be able to say which moment it is asking about.
   */
  readonly now?: () => number;
}

const NO_INDEXEDDB = 'this browser exposes no IndexedDB, so nothing is cached on this device';

/**
 * A blocked upgrade, in a sentence.
 *
 * Another tab holding an older schema open blocks this one indefinitely, and
 * the honest thing to render is that the database could not be reached in time
 * -- not `unknown` forever, and certainly not a count from a database that was
 * never opened.
 */
const OPEN_TIMED_OUT =
  'the local database did not open in time - another tab may be holding an ' +
  'older version of it open';

function reasonOf(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message;
  return 'the local database could not be opened';
}

/** The real read. Read-only, bounded, and it always closes what it opened. */
export async function readOfflineCache(
  options: OfflineCacheOptions = {},
): Promise<OfflineCacheRead> {
  if (!hasIndexedDb()) return { status: 'unavailable', reason: NO_INDEXEDDB };

  let db: FwmDatabase | null = null;
  try {
    db = await openFwmDbWithin(options.timeoutMs ?? DB_OPEN_TIMEOUT_MS);
    if (db === null) return { status: 'unavailable', reason: OPEN_TIMED_OUT };
    const repository = createCameraTilesRepository(
      db,
      options.now === undefined ? undefined : { now: options.now },
    );
    const snapshot = await repository.cacheSnapshot();

    return {
      status: 'ready',
      snapshot: {
        cachedCameras: snapshot.usableCameras,
        cachedTiles: snapshot.usableTiles,
        unusableTiles: snapshot.unusableTiles,
        incoherence: snapshot.incoherence,
        generation: snapshot.generation,
        oldestCheckedAtMs: snapshot.oldestCheckedAtMs,
        oldestFetchedAtMs: snapshot.oldestFetchedAtMs,
      },
    };
  } catch (cause) {
    return { status: 'unavailable', reason: reasonOf(cause) };
  } finally {
    if (db !== null) closeFwmDb(db);
  }
}
