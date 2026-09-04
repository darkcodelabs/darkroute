/**
 * CAMERA SYNC - the thing that fills the map.
 *
 * Every zero on every screen (`IN RANGE 0`, `KNOWN 0`, `FLOCKED TODAY 0`,
 * `ZONE NOT LOCATED`) was an honest report of an app with no camera data. The
 * tile cache, the tile repository, the alert engine and five screens that read
 * them were all built; nothing ever put a camera in. This is that.
 *
 * WHERE THE TILES COME FROM
 *   A reviewed first-party capture queries OpenStreetMap through Overpass for
 *   `man_made=surveillance` plus case-insensitive `surveillance:type=ALPR` or
 *   `ANPR`. `scripts/fetch-cameras.mjs` turns the approved local handoff into
 *   z11 tiles. Atomic generations are published to R2 and the same-origin
 *   `/cameras/` Function serves the pointer-selected one; the PWA build
 *   deliberately removes the local tile tree from `dist/`.
 *
 * WHY A STATIC TILE AND NOT AN API CALL
 *   A request to our own server carrying the driver's position is exactly the
 *   tracking this product exists to warn people about. A static tile is
 *   identical for every driver in that square, is cacheable, and tells the
 *   origin nothing beyond "somebody wanted tile 11/484/783". No coordinate is
 *   ever sent - the tile ADDRESS is computed on the device and is 15 km across.
 *
 * ODbL: every new tile carries `attribution`, `licence`, and `licenceUrl` in
 * its own body, and the UI must show "Map data © OpenStreetMap contributors"
 * wherever the points are rendered.
 *
 * WHY THIS IS A STORE SUBSCRIPTION AND NOT A REACT HOOK
 *   A camera coming into range does not arrive through a component tree, and
 *   neither does the fix that triggers the fetch. `App.tsx` already makes this
 *   argument for navigation; the same holds here, and it keeps the sync alive
 *   across screen changes instead of remounting with whatever screen happens to
 *   be on top.
 */

// Via the stores' bridge, not the package name: `@fwm/core` is still absent
// from apps/pwa/package.json, and adding it means touching a manifest and a
// lockfile - which is not this module's call. See stores/fwmCore.ts.
import {
  MAX_SURROUNDING_RADIUS,
  latLonToTile,
  surroundingTiles,
  tileKey,
} from '../../stores/fwmCore.ts';
import type { TileRef } from '../../stores/fwmCore.ts';

import { guardedFetch, isAccessBounce } from '../access/session.ts';
import { camerasActions, useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore } from '../../stores/position.ts';
import { hydrateTiles, persistTiles, replacePersistedTiles } from './tileStore.ts';
import type { PersistedReplacement, PersistableTile } from './tileStore.ts';
import {
  CAMERA_GENERATION_HEADER,
  generationBoundUrl,
  readCameraGeneration,
} from './generation.ts';
import type { CameraRecord } from '../db/schema.ts';

/** Matches `TILE_ZOOM` in scripts/fetch-cameras.mjs. One tile is ~15 km. */
export const CAMERA_TILE_ZOOM = 11;

/** Where the generated tiles are served from. Same-origin, always. */
export const TILE_BASE = '/cameras';

/**
 * How far the vehicle must move before the tile set is recomputed.
 *
 * A z11 tile is about 15 km across, so recomputing on every GPS tick would be
 * thousands of identical set-comparisons per drive for a result that changes
 * every few minutes. 250 m is far below the tile size and far above GPS noise.
 */
export const RESYNC_DISTANCE_M = 250;

/** At most one pointer read a minute while a vehicle is moving. */
export const GENERATION_CHECK_INTERVAL_MS = 60_000;

/** Cache hydration is optional help, never a gate in front of healthy tiles. */
export const CACHE_HYDRATE_BUDGET_MS = 1_500;

/**
 * How long a generation-replacement transaction may run before the new
 * generation is shown anyway.
 *
 * Generous on purpose, and far longer than `DB_OPEN_TIMEOUT_MS` (1.5 s): this
 * bounds a WRITE of a whole tile ring, not an open, and a slow phone finishing
 * in four seconds should be allowed to finish and have its disk agree with its
 * memory. The deadline is not a performance target, it is a floor under the one
 * outcome that is never acceptable - a driver shown no cameras because a
 * database transaction is wedged. See the block at the call site.
 */
export const DURABLE_REPLACE_TIMEOUT_MS = 5_000;

/** Earth radius in metres, for the movement check. Not a screen length. */
const EARTH_RADIUS_M = 6_371_000;

export function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface CameraTileFile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly generatedAt?: string;
  readonly attribution?: string;
  readonly licence?: string;
  readonly licenceUrl?: string;
  readonly cameras: readonly CameraRecord[];
}

/** A tile that is not on disk is not an error: most of the world has no ALPR. */
const EMPTY: readonly CameraRecord[] = [];

export interface CameraSyncOptions {
  readonly fetchImpl?: typeof fetch;
  readonly base?: string;
  readonly now?: () => number;
  readonly zoom?: number;
  /** How many rings of neighbours to hold. 1 = the 3x3 around the vehicle. */
  readonly radius?: number;
  readonly generationCheckIntervalMs?: number;
  readonly hydrateBudgetMs?: number;
  /**
   * How long a generation replacement may run before its generation is shown
   * anyway. Injectable for the same reason `hydrateBudgetMs` is: a test that
   * had to wait out the real deadline would be a five-second test.
   */
  readonly durableReplaceTimeoutMs?: number;
  /** Injectable only for deterministic blocked-storage tests. */
  readonly hydrateTilesImpl?: typeof hydrateTiles;
  /** Injectable only for deterministic storage-failure tests. */
  readonly replacePersistedImpl?: (
    expectedGeneration: string | null,
    generation: string,
    tiles: readonly PersistableTile[],
  ) => Promise<PersistedReplacement>;
}

export interface CameraSync {
  /** Fetch the tiles for one position. Exposed for tests and for a manual retry. */
  syncAt(lat: number, lon: number): Promise<number>;
  /**
   * Widen the ring of tiles fetched, to cover a range the scope is drawing.
   *
   * THE BUG THIS EXISTS FOR. The sync fetched a fixed 3x3 of z11 tiles -- about
   * 45 km -- whatever range the driver had the scope set to. At the wide end of
   * the zoom that produced a screen that made no sense: 100 miles of dial with
   * every camera crushed into a 20-mile square in the middle, and the roads
   * ending in a literal straight-edged box where the loaded tiles stopped. The
   * scope was drawing the shape of the CACHE, not the shape of the country.
   *
   * Widening is a real cost -- a 9x9 ring is 81 tiles, not 9 -- so it is driven
   * by what the driver is actually looking at rather than fetched speculatively.
   * Narrowing again does not evict: tiles already held stay held.
   */
  coverRangeFt(outerFt: number): void;
  stop(): void;
}

/**
 * How many rings of z11 tiles cover a range, in tiles.
 *
 * A z11 tile is roughly 15 km across at these latitudes, so a ring of N covers
 * about (2N+1) x 15 km. The ring is sized to the DIAMETER the scope shows,
 * because a driver at the centre sees the range in every direction.
 *
 * Capped at `MAX_SURROUNDING_RADIUS` (8), which is 17x17 = 289 tiles and about
 * 255 km -- past that the fetch is heavier than the picture is worth, and the
 * scope at that zoom is a regional overview where a missing edge tile is not
 * the difference between seeing a camera and driving past it.
 */
export function ringsForRangeFt(outerFt: number): number {
  const metres = outerFt * 0.3048;
  const tileMetres = 15_000;
  const rings = Math.ceil(metres / tileMetres);
  return Math.min(MAX_SURROUNDING_RADIUS, Math.max(1, rings));
}

export function createCameraSync(options: CameraSyncOptions = {}): CameraSync {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.base ?? TILE_BASE;
  const now = options.now ?? Date.now;
  const zoom = options.zoom ?? CAMERA_TILE_ZOOM;
  const generationCheckIntervalMs =
    options.generationCheckIntervalMs ?? GENERATION_CHECK_INTERVAL_MS;
  const hydrateBudgetMs = options.hydrateBudgetMs ?? CACHE_HYDRATE_BUDGET_MS;
  const durableReplaceTimeoutMs = options.durableReplaceTimeoutMs ?? DURABLE_REPLACE_TIMEOUT_MS;
  const hydratePersisted = options.hydrateTilesImpl ?? hydrateTiles;
  const replacePersisted = options.replacePersistedImpl ?? replacePersistedTiles;
  // Mutable: the scope's range decides it, and the range is a live control.
  let radius = options.radius ?? 1;

  let stopped = false;
  const inFlight = new Set<string>();
  let observedGeneration: string | null = useCamerasStore.getState().generation;
  let generationCheckedAtMs = Number.NEGATIVE_INFINITY;
  let identityRequest = 0;

  const hydrateWithinBudget = async (
    keys: readonly [number, number, number][],
    expectedGeneration?: string,
  ): Promise<void> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, hydrateBudgetMs);
    });
    await Promise.race([
      hydratePersisted(keys, expectedGeneration).then(() => undefined),
      deadline,
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };

  const readGeneration = async (force = false): Promise<string | null> => {
    const at = now();
    if (
      !force &&
      observedGeneration !== null &&
      at - generationCheckedAtMs < generationCheckIntervalMs
    ) {
      return observedGeneration;
    }
    try {
      const identity = await readCameraGeneration({
        fetchImpl: doFetch,
        base,
        // Distinct even under a frozen test clock, so a transition's final
        // pointer check cannot be answered by the first check's worker entry.
        cacheKey: `${String(Math.floor(at / Math.max(1, generationCheckIntervalMs)))}-${String(identityRequest++)}`,
      });
      observedGeneration = identity.generation;
      generationCheckedAtMs = at;
      return identity.generation;
    } catch {
      // Offline is not a new generation. The coherent durable snapshot below
      // remains usable, but no unidentifiable network bytes may join it.
      return null;
    }
  };

  const loadTile = async (ref: TileRef, generation: string): Promise<readonly CameraRecord[]> => {
    const path = `${String(ref.z)}/${String(ref.x)}/${String(ref.y)}.json`;
    const url = generationBoundUrl(base, path, generation);
    const res = await guardedFetch(url, doFetch);
    // AN EXPIRED SIGN-IN IS NOT AN EMPTY SQUARE. Cloudflare Access answers a
    // stale session with a redirect, and without this the throw below is the
    // only thing that happens: every tile fails, none is written, and the map
    // says "no cameras on the map here" over a city full of them. Throwing is
    // still right -- a failed tile must never be cached as empty -- but the
    // banner has to know, so `guardedFetch` has already raised the flag and
    // this only has to avoid pretending the square was rural.
    if (isAccessBounce(res)) throw new Error(`tile ${tileKey(ref)}: signed out`);
    // 404 is the normal answer for a square with no ALPR in it. Treating it as
    // an error would put every rural tile into a retry loop and light up an
    // offline banner on a working connection.
    if (res.headers.get(CAMERA_GENERATION_HEADER) !== generation) {
      throw new Error(`tile ${tileKey(ref)}: generation changed`);
    }
    if (res.status === 404) return EMPTY;
    if (!res.ok) throw new Error(`tile ${tileKey(ref)}: HTTP ${String(res.status)}`);
    const body = (await res.json()) as Partial<CameraTileFile>;
    if (body.z !== ref.z || body.x !== ref.x || body.y !== ref.y || !Array.isArray(body.cameras)) {
      throw new Error(`tile ${tileKey(ref)}: invalid body`);
    }
    return body.cameras;
  };

  const performSyncAt = async (lat: number, lon: number): Promise<number> => {
    const refs = surroundingTiles(lat, lon, zoom, radius);
    const keys = refs.map((ref): [number, number, number] => [ref.z, ref.x, ref.y]);
    const generation = await readGeneration();
    if (stopped) return 0;

    if (generation === null) {
      // Offline movement still reads every requested ring from disk. The
      // DB-wide sentinel prevents a second generation from joining the one
      // already in memory; a legacy cache is accepted only when every DB row
      // is globally generationless.
      const heldGeneration = useCamerasStore.getState().generation;
      await hydrateWithinBudget(keys, heldGeneration === null ? undefined : heldGeneration);
      return 0;
    }

    let state = useCamerasStore.getState();
    if (state.tiles.size === 0) {
      await hydrateWithinBudget(keys, generation);
      if (stopped) return 0;
      state = useCamerasStore.getState();
    }

    const transitioning = state.generation !== generation;
    const cached = state.tiles;
    const wanted = refs.filter((ref) => {
      const key = tileKey(ref);
      return (transitioning || !cached.has(key)) && !inFlight.has(key);
    });
    if (wanted.length === 0) return 0;

    for (const ref of wanted) inFlight.add(tileKey(ref));
    camerasActions.setLoading(wanted.map((ref) => tileKey(ref)));

    const settled = await Promise.allSettled(
      wanted.map(async (ref) => ({ ref, cameras: await loadTile(ref, generation) })),
    );

    for (const ref of wanted) inFlight.delete(tileKey(ref));
    if (stopped) return 0;

    const entries = settled
      .filter(
        (r): r is PromiseFulfilledResult<{ ref: TileRef; cameras: readonly CameraRecord[] }> =>
          r.status === 'fulfilled',
      )
      .map((r) => ({
        ref: r.value.ref,
        cameras: r.value.cameras,
        fetchedAtMs: now(),
        freshness: 'fresh' as const,
        source: 'network' as const,
      }));

    if (transitioning && entries.length !== wanted.length) {
      // A partial new ring would retain deleted/moved records from the old
      // generation. Keep the prior complete snapshot instead.
      generationCheckedAtMs = Number.NEGATIVE_INFINITY;
      camerasActions.setLoading([]);
      return 0;
    }

    if (transitioning) {
      // Close the index→tiles race. Every tile was G and the pointer must still
      // be G immediately before committing G as the working snapshot.
      const confirmed = await readGeneration(true);
      if (confirmed !== generation || stopped) {
        generationCheckedAtMs = Number.NEGATIVE_INFINITY;
        camerasActions.setLoading([]);
        return 0;
      }
    }

    // A tile that failed is simply not written: the store keeps whatever it had
    // and the next fix retries. Writing an empty tile on a network error would
    // cache "no cameras here" over a road that has them, which is the one
    // failure this product must not have.
    camerasActions.setLoading([]);
    if (entries.length > 0) {
      const durable = entries.map((entry) => ({ ...entry, generation }));
      if (transitioning) {
        // IndexedDB replacement clears old tiles and tileMeta in one
        // transaction. Memory changes only after the complete new ring exists.
        /**
         * BOUNDED, BECAUSE "NEVER SETTLES" SILENCES THE WARNINGS TOO.
         *
         * The `failed` branch below is the whole point of this block: storage
         * may not be a reason to show a driver no cameras. But it only fires
         * when the replacement RESOLVES with a verdict. A replacement that
         * never settles - a transaction wedged behind a blocked upgrade, or
         * another tab holding the store - never reaches `replaceGeneration`
         * at all, and `syncAt` serialises every sync on one promise queue, so
         * the next fix does not get a second chance either. That is the
         * ORIGINAL defect wearing a different hat: every tile fetched, every
         * header checked, the pointer re-confirmed, and nothing shown.
         *
         * `openFwmDbWithin` already bounds the OPEN. Nothing bounded the
         * transaction. A deadline here makes the timeout indistinguishable
         * from a conflict at this level, which is exactly right: both mean
         * "the disk did not take it", and both must still warn.
         *
         * The write is NOT cancelled - IndexedDB has no such thing - it is
         * merely stopped being waited on. If it lands later it lands as a
         * complete, atomic replacement, which is coherent whenever it happens.
         */
        const replacement = await Promise.race([
          replacePersisted(state.generation, generation, durable),
          new Promise<'failed'>((resolve) => {
            setTimeout(() => {
              resolve('failed');
            }, durableReplaceTimeoutMs);
          }),
        ]);
        if (stopped) return 0;
        if (replacement === 'failed') {
          /**
           * STORAGE MAY NOT SILENCE THE WARNINGS. THIS RETURNED 0.
           *
           * The old code took `failed` as a reason to leave memory alone, on
           * the reasoning that committing G to memory would let a later
           * same-generation write mix G into a database still holding G-1.
           * The premise is true and the conclusion was a driving-safety bug:
           * on a cold start, memory is EMPTY. The durable snapshot is a
           * coherent older generation, so hydration correctly refuses to load
           * it under the new one; every tile of the new generation is then
           * fetched, header-checked, and re-confirmed against the pointer --
           * and thrown away because a REPLACEMENT TRANSACTION conflicted.
           * The app showed no cameras at all, and said nothing, drive after
           * drive. A cache is not allowed to do that.
           *
           * The mixing it was guarding against cannot happen anyway:
           * `persistTiles` writes through `putManyIfGeneration`, which reads
           * the DB-wide sentinel inside its own transaction and writes nothing
           * unless the sentinel already names G. A database still holding G-1
           * refuses every one of those writes on its own.
           *
           * So the complete, twice-verified network generation is admitted to
           * memory and the older coherent durable snapshot is left exactly as
           * it is -- still coherent, still what a restart will hydrate from.
           * The two disagreeing is a fact about this device, and the OFFLINE
           * screen reports it rather than advertising the disk rows as the
           * live set (`features/offline/cache.ts`).
           *
           * The pointer check is reset so the next sync re-reads it: a
           * replacement conflict usually means another tab is mid-transition,
           * and the next observation is the cheapest way to find out.
           */
          generationCheckedAtMs = Number.NEGATIVE_INFINITY;
        }
        camerasActions.replaceGeneration(generation, entries);
      } else {
        camerasActions.putGenerationTiles(generation, entries);
      }
      /**
       * AND THROUGH TO DISK, so the next cold start has cameras.
       *
       * The memory store is already live, so IndexedDB latency does not delay
       * an alert. The promise is still awaited before the serialized sync may
       * begin another generation: otherwise a late old-generation write could
       * land after the new generation's atomic replacement. `persistTiles`
       * swallows quota/availability failures, so storage cannot take down a
       * drive.
       */
      if (!transitioning) await persistTiles(durable);
    }
    return entries.reduce((total, entry) => total + entry.cameras.length, 0);
  };

  // Pointer checks and generation commits are serialized. Two overlapping GPS
  // callbacks must never each commit a different view of the catalogue.
  let queue: Promise<void> = Promise.resolve();
  const syncAt = (lat: number, lon: number): Promise<number> => {
    const run = queue.then(() => performSyncAt(lat, lon));
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  let lastSyncedAt: { lat: number; lon: number } | null = null;

  const unsubscribe = usePositionStore.subscribe((state) => {
    if (stopped) return;
    const fix = state.fix;
    if (fix === null) return;
    if (
      lastSyncedAt !== null &&
      metresBetween(lastSyncedAt, fix) < RESYNC_DISTANCE_M &&
      // Crossing a tile boundary always resyncs, however small the step.
      tileKey(latLonToTile(fix.lat, fix.lon, zoom)) ===
        tileKey(latLonToTile(lastSyncedAt.lat, lastSyncedAt.lon, zoom))
    ) {
      return;
    }
    lastSyncedAt = { lat: fix.lat, lon: fix.lon };
    void syncAt(fix.lat, fix.lon);
  });

  // The first fix may already be in the store when this starts - a warm reload,
  // or a sync started after the watch. Without this the map stays empty until
  // the vehicle moves 250 m.
  const existing = usePositionStore.getState().fix;
  if (existing !== null) {
    lastSyncedAt = { lat: existing.lat, lon: existing.lon };
    void syncAt(existing.lat, existing.lon);
  }

  return {
    syncAt,
    coverRangeFt(outerFt: number): void {
      const wanted = ringsForRangeFt(outerFt);
      // Only ever widens within a session. A driver who zooms out to look at a
      // region and back in has already paid for those tiles; dropping the ring
      // would make zooming back out re-fetch every one of them.
      if (wanted <= radius) return;
      radius = wanted;
      const fix = usePositionStore.getState().fix;
      if (fix !== null) void syncAt(fix.lat, fix.lon);
    },
    stop(): void {
      stopped = true;
      camerasActions.setLoading([]);
      unsubscribe();
    },
  };
}
