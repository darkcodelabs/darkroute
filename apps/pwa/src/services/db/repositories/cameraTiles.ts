/**
 * Cached camera tiles: the store that makes "NO NETWORK · RUNNING ON CACHE"
 * an honest claim rather than an empty screen.
 *
 * Every read path here works offline, because every read path here is the
 * offline path - the network layer's only job is to put newer tiles in. When
 * the app is online it reads exactly the same rows it would read in a tunnel.
 *
 * EVICTION. `cameraTiles` is the one store with real growth: a driver crossing
 * a state fetches thousands of tiles they will never see again. Two bounds
 * apply, in this order:
 *
 *   1. hard expiry - anything older than `TILE_HARD_EXPIRY_MS` is gone,
 *      regardless of how few tiles are cached, because a month-old tile that
 *      claims "clear" is worse than no tile at all;
 *   2. the cap - oldest `fetchedAt` first until the store is back under
 *      `MAX_CAMERA_TILES`.
 *
 * Ordering is by `fetchedAt` through the `by-fetchedAt` index, which never
 * loads a tile body to decide what to drop. That is oldest-first, not strict
 * LRU: true LRU needs a `lastAccessedAt` write on every read, which turns the
 * hot read path into a write path on a device that is also running GPS.
 *
 * GAP: see DESIGN-GAPS.md#tile-eviction-order
 */

import {
  CAMERA_CACHE_STATE_KEY,
  type CameraRecord,
  type CameraTileRecord,
  type TileKey,
  type TileSource,
} from '../schema.ts';
import { MAX_CAMERA_TILES, TILE_HARD_EXPIRY_MS } from '../policy.ts';
import type { EvictionReport, FwmDatabase, RepositoryDeps } from './support.ts';
import { resolveDeps } from './support.ts';

/** What a caller hands in to cache a tile. */
export interface CameraTileInput {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly cameras: readonly CameraRecord[];
  readonly generation?: string;
  readonly source: TileSource;
  readonly etag?: string;
  /** Epoch ms. Defaults to the injected clock. */
  readonly fetchedAt?: number;
}

/**
 * Why a cache that exists cannot be used as it stands.
 *
 * `mixed`    the rows do not all belong to one generation, or they do not
 *            belong to the one the DB-wide sentinel names. `hydrateTiles`
 *            refuses the whole cache in that state, so nothing in it is
 *            usable and none of it may be counted as though it were.
 * `expired`  some rows are past `TILE_HARD_EXPIRY_MS`. They are excluded from
 *            every count here; the production read path deletes them.
 */
export type CacheIncoherence = 'none' | 'mixed' | 'expired';

/**
 * What is actually usable on disk, read in ONE transaction.
 *
 * THE BUG THIS EXISTS FOR. The OFFLINE screen assembled its four numbers from
 * five separate transactions -- `count()`, `oldestFirstKeys()`, `camerasIn()`,
 * `get()`, `oldestCheckedAt()` -- so a generation replacement landing between
 * any two of them produced a screen that contradicted itself (MAP TILES 4 next
 * to CACHED CAMS 0), and none of the five applied the expiry or the coherence
 * gate that `hydrateTiles` applies. A month-expired cache and a half-replaced
 * one both read as "ready", which is the OFFLINE screen -- the one screen whose
 * entire job is to be exact about what the device holds -- overstating it.
 */
export interface CameraCacheSnapshot {
  /** The DB-wide sentinel, or null for a legacy generationless cache. */
  readonly generation: string | null;
  /** Tiles that `hydrateTiles` would load right now. */
  readonly usableTiles: number;
  /** DISTINCT cameras in those tiles, de-duplicated by id. */
  readonly usableCameras: number;
  /** Rows on disk that this snapshot refuses to advertise. */
  readonly unusableTiles: number;
  readonly incoherence: CacheIncoherence;
  /** Oldest `fetchedAt` among the USABLE rows, or null when there are none. */
  readonly oldestFetchedAtMs: number | null;
  /** Oldest `checkedAt` among the USABLE rows, or null when none was checked. */
  readonly oldestCheckedAtMs: number | null;
}

export interface CameraTilesRepository {
  get(key: TileKey): Promise<CameraTileRecord | undefined>;
  getMany(keys: readonly TileKey[]): Promise<CameraTileRecord[]>;
  /** Every camera in the given tiles, de-duplicated by id. The offline read. */
  camerasIn(keys: readonly TileKey[]): Promise<CameraRecord[]>;
  put(input: CameraTileInput): Promise<TileKey>;
  putMany(inputs: readonly CameraTileInput[]): Promise<number>;
  /** Write only if the DB-wide sentinel still names this generation. */
  putManyIfGeneration(generation: string, inputs: readonly CameraTileInput[]): Promise<number>;
  /** Clear the old generation and install one coherent working set atomically. */
  replaceAll(
    expectedGeneration: string | null,
    generation: string,
    inputs: readonly CameraTileInput[],
  ): Promise<'replaced' | 'merged' | 'conflict'>;
  /** Read keys and the DB-wide identity in one snapshot transaction. */
  generationSnapshot(
    keys: readonly TileKey[],
    expectedGeneration?: string,
  ): Promise<{
    readonly generation: string | null;
    readonly tiles: readonly CameraTileRecord[];
  } | null>;
  /** Everything the OFFLINE screen reports, in one readonly transaction. */
  cacheSnapshot(): Promise<CameraCacheSnapshot>;
  count(): Promise<number>;
  cameraCount(): Promise<number>;
  /** Primary keys ordered oldest `fetchedAt` first - the eviction order. */
  oldestFirstKeys(limit?: number): Promise<TileKey[]>;
  evictExpired(): Promise<EvictionReport>;
  enforceCap(max?: number): Promise<EvictionReport>;
  remove(key: TileKey): Promise<void>;
  clear(): Promise<number>;
}

export function createCameraTilesRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps>,
): CameraTilesRepository {
  const deps = resolveDeps(overrides);

  /**
   * Drop tiles and their freshness rows together, in one transaction.
   *
   * Splitting them would let a crash leave `tileMeta` claiming a tile is fresh
   * when the body is gone, which reads to the app as "cached and clear" - the
   * exact false negative this product cannot afford.
   */
  async function dropKeys(keys: readonly TileKey[]): Promise<number> {
    if (keys.length === 0) return 0;
    const tx = db.transaction(['cameraTiles', 'tileMeta'], 'readwrite');
    const tiles = tx.objectStore('cameraTiles');
    const meta = tx.objectStore('tileMeta');
    for (const key of keys) {
      void tiles.delete(key);
      void meta.delete(key);
    }
    await tx.done;
    return keys.length;
  }

  /** Cap enforcement that cannot let a stale tab delete the new generation. */
  async function enforceCapIfGeneration(
    generation: string,
    max = MAX_CAMERA_TILES,
  ): Promise<number> {
    const tx = db.transaction(['cameraCacheState', 'cameraTiles', 'tileMeta'], 'readwrite');
    const state = await tx.objectStore('cameraCacheState').get(CAMERA_CACHE_STATE_KEY);
    if (state?.generation !== generation) {
      await tx.done;
      return 0;
    }
    const tiles = tx.objectStore('cameraTiles');
    const excess = (await tiles.count()) - max;
    if (excess <= 0) {
      await tx.done;
      return 0;
    }
    const doomed = await tiles.index('by-fetchedAt').getAllKeys(undefined, excess);
    const meta = tx.objectStore('tileMeta');
    for (const key of doomed) {
      void tiles.delete(key);
      void meta.delete(key);
    }
    await tx.done;
    return doomed.length;
  }

  return {
    get(key) {
      return db.get('cameraTiles', key);
    },

    async getMany(keys) {
      const tx = db.transaction('cameraTiles', 'readonly');
      const found = await Promise.all(keys.map((key) => tx.store.get(key)));
      await tx.done;
      return found.filter((tile): tile is CameraTileRecord => tile !== undefined);
    },

    async camerasIn(keys) {
      const tiles = await this.getMany(keys);
      // De-duplicated by id: tiles overlap at their edges, and a camera that
      // appears in two tiles is one camera, not two alerts.
      const byId = new Map<string, CameraRecord>();
      for (const tile of tiles) {
        for (const camera of tile.cameras) byId.set(camera.id, camera);
      }
      return [...byId.values()];
    },

    async put(input) {
      // The cap is enforced on the write rather than on a timer, so the store
      // is never over its ceiling between a fetch and a sweep. The cost is one
      // `count()` per tile written, which is an index read, not a scan.
      const record: CameraTileRecord = {
        z: input.z,
        x: input.x,
        y: input.y,
        cameras: input.cameras,
        ...(input.generation === undefined ? {} : { generation: input.generation }),
        fetchedAt: input.fetchedAt ?? deps.now(),
        source: input.source,
        ...(input.etag === undefined ? {} : { etag: input.etag }),
      };
      const key = await db.put('cameraTiles', record);
      await this.enforceCap();
      return key;
    },

    async putMany(inputs) {
      if (inputs.length === 0) return 0;
      const tx = db.transaction('cameraTiles', 'readwrite');
      for (const input of inputs) {
        const record: CameraTileRecord = {
          z: input.z,
          x: input.x,
          y: input.y,
          cameras: input.cameras,
          ...(input.generation === undefined ? {} : { generation: input.generation }),
          fetchedAt: input.fetchedAt ?? deps.now(),
          source: input.source,
          ...(input.etag === undefined ? {} : { etag: input.etag }),
        };
        void tx.store.put(record);
      }
      await tx.done;
      await this.enforceCap();
      return inputs.length;
    },

    async putManyIfGeneration(generation, inputs) {
      if (inputs.length === 0) return 0;
      const tx = db.transaction(['cameraCacheState', 'cameraTiles'], 'readwrite');
      const state = await tx.objectStore('cameraCacheState').get(CAMERA_CACHE_STATE_KEY);
      if (state?.generation !== generation) {
        await tx.done;
        return 0;
      }
      const tiles = tx.objectStore('cameraTiles');
      for (const input of inputs) {
        const record: CameraTileRecord = {
          z: input.z,
          x: input.x,
          y: input.y,
          cameras: input.cameras,
          generation,
          fetchedAt: input.fetchedAt ?? deps.now(),
          source: input.source,
          ...(input.etag === undefined ? {} : { etag: input.etag }),
        };
        void tiles.put(record);
      }
      await tx.done;
      await enforceCapIfGeneration(generation);
      return inputs.length;
    },

    async replaceAll(expectedGeneration, generation, inputs) {
      const tx = db.transaction(['cameraCacheState', 'cameraTiles', 'tileMeta'], 'readwrite');
      const tiles = tx.objectStore('cameraTiles');
      const stateStore = tx.objectStore('cameraCacheState');
      const state = await stateStore.get(CAMERA_CACHE_STATE_KEY);
      const heldGeneration = state?.generation ?? null;
      if (heldGeneration !== expectedGeneration && heldGeneration !== generation) {
        await tx.done;
        return 'conflict';
      }

      if (heldGeneration === generation) {
        // Another tab got here first with the same immutable candidate. Merge
        // this ring; clearing would throw away its equally current offline set.
        for (const input of inputs) {
          const record: CameraTileRecord = {
            z: input.z,
            x: input.x,
            y: input.y,
            cameras: input.cameras,
            generation,
            fetchedAt: input.fetchedAt ?? deps.now(),
            source: input.source,
            ...(input.etag === undefined ? {} : { etag: input.etag }),
          };
          void tiles.put(record);
        }
        await tx.done;
        await enforceCapIfGeneration(generation);
        return 'merged';
      }

      void tiles.clear();
      void tx.objectStore('tileMeta').clear();
      void stateStore.put({
        key: CAMERA_CACHE_STATE_KEY,
        generation,
      });
      for (const input of inputs) {
        const record: CameraTileRecord = {
          z: input.z,
          x: input.x,
          y: input.y,
          cameras: input.cameras,
          generation,
          fetchedAt: input.fetchedAt ?? deps.now(),
          source: input.source,
          ...(input.etag === undefined ? {} : { etag: input.etag }),
        };
        void tiles.put(record);
      }
      await tx.done;
      return 'replaced';
    },

    async generationSnapshot(keys, expectedGeneration) {
      const tx = db.transaction(['cameraCacheState', 'cameraTiles'], 'readonly');
      const tilesStore = tx.objectStore('cameraTiles');
      const generationIndex = tilesStore.index('by-generation');
      const [state, total, identified, found] = await Promise.all([
        tx.objectStore('cameraCacheState').get(CAMERA_CACHE_STATE_KEY),
        tilesStore.count(),
        generationIndex.count(),
        Promise.all(keys.map((key) => tilesStore.get(key))),
      ]);

      if (state !== undefined) {
        if (expectedGeneration !== undefined && state.generation !== expectedGeneration) {
          await tx.done;
          return null;
        }
        const matching = await generationIndex.count(state.generation);
        await tx.done;
        // Both equalities matter: `identified === total` rejects generationless
        // strays, and `matching === total` rejects a stale tab's other G.
        if (identified !== total || matching !== total) return null;
        const tiles = found.filter((tile): tile is CameraTileRecord => tile !== undefined);
        return { generation: state.generation, tiles };
      }

      // Legacy cache: the generation index proves globally (without loading
      // every body) that every row is generationless. Never adopt it under G.
      if (expectedGeneration !== undefined) {
        await tx.done;
        return null;
      }
      if (identified !== 0) {
        await tx.done;
        return null;
      }
      await tx.done;
      return {
        generation: null,
        tiles: found.filter((tile): tile is CameraTileRecord => tile !== undefined),
      };
    },

    async cacheSnapshot() {
      // ONE transaction over all three stores. Not three reads that happen to
      // run together: a `replaceAll` from another tab commits between separate
      // transactions, and the numbers it returns then describe two different
      // databases. Inside one readonly transaction they describe one.
      const tx = db.transaction(['cameraCacheState', 'cameraTiles', 'tileMeta'], 'readonly');
      const tilesStore = tx.objectStore('cameraTiles');
      const metaStore = tx.objectStore('tileMeta');
      const [state, rows] = await Promise.all([
        tx.objectStore('cameraCacheState').get(CAMERA_CACHE_STATE_KEY),
        tilesStore.getAll(),
      ]);
      const meta = await Promise.all(
        rows.map((tile) => metaStore.get([tile.z, tile.x, tile.y] as TileKey)),
      );
      await tx.done;

      const generation = state?.generation ?? null;
      const cutoff = deps.now() - TILE_HARD_EXPIRY_MS;
      /*
       * COHERENCE IS JUDGED ON THE ROWS THAT SURVIVE EXPIRY, not on every row
       * in the store, because that is the order the real read path uses.
       *
       * `hydrateTiles` calls `evictExpired()` FIRST and only then
       * `generationSnapshot`. Checking every row here instead meant a single
       * month-old stray from another generation condemned an otherwise perfect
       * cache: the OFFLINE screen reported `cachedTiles: 0`, `incoherence:
       * "mixed"` and drew "The cache holds rows from more than one published
       * snapshot, so none of it is being used", while a real cold start would
       * have deleted the stray and loaded the good tiles without complaint.
       *
       * The comment that used to sit here claimed this applied THE SAME gate as
       * hydration. It did not, and that is the whole defect: this screen exists
       * to say what a cold offline start would get, so a divergence between the
       * two is not a cosmetic inaccuracy, it is the screen lying about the one
       * thing it is for.
       *
       * Both equalities still matter among the survivors -- a generationless
       * stray and a stale tab's other G each make the cache unusable rather
       * than merely smaller.
       */
      const live = rows.filter((tile) => tile.fetchedAt >= cutoff);
      const coherent = live.every((tile) => (tile.generation ?? null) === generation);

      let usableTiles = 0;
      let oldestFetchedAtMs: number | null = null;
      let oldestCheckedAtMs: number | null = null;
      let expired = 0;
      const byId = new Set<string>();
      for (const [index, tile] of rows.entries()) {
        // `<`, exactly as `evictExpired` bounds it: a row this read calls
        // expired must be one the production read path would delete.
        if (tile.fetchedAt < cutoff) {
          expired += 1;
          continue;
        }
        if (!coherent) continue;
        usableTiles += 1;
        // De-duplicated by id, for the same reason `camerasIn` is: tiles
        // overlap at their edges and one camera in two tiles is one alert.
        for (const camera of tile.cameras) byId.add(camera.id);
        oldestFetchedAtMs =
          oldestFetchedAtMs === null ? tile.fetchedAt : Math.min(oldestFetchedAtMs, tile.fetchedAt);
        const checkedAt = meta[index]?.lastCheckedAt;
        if (checkedAt !== undefined) {
          oldestCheckedAtMs =
            oldestCheckedAtMs === null ? checkedAt : Math.min(oldestCheckedAtMs, checkedAt);
        }
      }

      // Mixture outranks age: an incoherent cache is refused whole, so naming
      // its expired minority would describe the smaller of the two problems.
      let incoherence: CacheIncoherence = 'none';
      if (!coherent) incoherence = 'mixed';
      else if (expired > 0) incoherence = 'expired';

      return {
        generation,
        usableTiles,
        usableCameras: byId.size,
        unusableTiles: rows.length - usableTiles,
        incoherence,
        oldestFetchedAtMs,
        oldestCheckedAtMs,
      };
    },

    count() {
      return db.count('cameraTiles');
    },

    async cameraCount() {
      // The OFFLINE screen's "CACHED CAMS 4,182". Counted rather than stored,
      // so it cannot drift from what is actually on disk.
      const tiles = await db.getAll('cameraTiles');
      return tiles.reduce((total, tile) => total + tile.cameras.length, 0);
    },

    async oldestFirstKeys(limit) {
      const keys = await db.getAllKeysFromIndex('cameraTiles', 'by-fetchedAt');
      return limit === undefined ? keys : keys.slice(0, Math.max(0, limit));
    },

    async evictExpired() {
      const cutoff = deps.now() - TILE_HARD_EXPIRY_MS;
      // Discover and delete in one transaction. Otherwise another tab could
      // replace G1 with G2 between the index read and `dropKeys`, and an old
      // list of primary keys could delete fresh G2 rows at the same coords.
      const tx = db.transaction(['cameraTiles', 'tileMeta'], 'readwrite');
      const tiles = tx.objectStore('cameraTiles');
      const doomed = await tiles
        .index('by-fetchedAt')
        .getAllKeys(IDBKeyRange.upperBound(cutoff, true));
      const meta = tx.objectStore('tileMeta');
      for (const key of doomed) {
        void tiles.delete(key);
        void meta.delete(key);
      }
      await tx.done;
      return { store: 'cameraTiles', reason: 'expiry', evicted: doomed.length };
    },

    async enforceCap(max = MAX_CAMERA_TILES) {
      const total = await db.count('cameraTiles');
      const excess = total - max;
      if (excess <= 0) return { store: 'cameraTiles', reason: 'cap', evicted: 0 };
      const doomed = await this.oldestFirstKeys(excess);
      const evicted = await dropKeys(doomed);
      return { store: 'cameraTiles', reason: 'cap', evicted };
    },

    async remove(key) {
      await dropKeys([key]);
    },

    async clear() {
      const total = await db.count('cameraTiles');
      const tx = db.transaction(['cameraTiles', 'tileMeta'], 'readwrite');
      void tx.objectStore('cameraTiles').clear();
      void tx.objectStore('tileMeta').clear();
      await tx.done;
      return total;
    },
  };
}
