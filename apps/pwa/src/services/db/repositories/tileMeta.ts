/**
 * Tile freshness, kept apart from tile bodies.
 *
 * The OFFLINE screen does not say "clear". It says "DB last updated 2 days
 * ago. Cameras added since then are invisible - treat clear as probably
 * clear." That sentence only exists because something knows how old the data
 * is, and this store is that something.
 *
 * `unknown` is a first-class answer here. A tile nobody has ever checked is
 * not fresh and it is not stale; it is unverified, and the difference matters
 * when the screen is about to tell a driver the road ahead is clear.
 */

import type { TileFreshness, TileKey, TileMetaRecord } from '../schema.ts';
import { DEFAULT_TILE_STALE_AFTER_MS } from '../policy.ts';
import type { FwmDatabase, RepositoryDeps } from './support.ts';
import { resolveDeps } from './support.ts';

export interface TileCheckInput {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly cameraCount: number;
  readonly freshness?: TileFreshness;
  readonly staleAfterMs?: number;
  readonly checkedAt?: number;
}

export interface TileMetaRepository {
  get(key: TileKey): Promise<TileMetaRecord | undefined>;
  /** Record that a tile was checked against the source and is current. */
  markChecked(input: TileCheckInput): Promise<void>;
  /**
   * Freshness as of now, derived rather than stored.
   *
   * Stored freshness goes stale by definition - the row says `fresh` and the
   * clock keeps moving. The row holds the inputs; the answer is computed.
   */
  freshnessOf(key: TileKey): Promise<TileFreshness>;
  /** The oldest `lastCheckedAt` across the given tiles, for "last updated". */
  oldestCheckedAt(keys: readonly TileKey[]): Promise<number | null>;
  count(): Promise<number>;
  remove(key: TileKey): Promise<void>;
  clear(): Promise<number>;
}

export function createTileMetaRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps>,
): TileMetaRepository {
  const deps = resolveDeps(overrides);

  function derive(record: TileMetaRecord, now: number): TileFreshness {
    if (record.freshness === 'unknown') return 'unknown';
    return now - record.lastCheckedAt > record.staleAfterMs ? 'stale' : 'fresh';
  }

  return {
    get(key) {
      return db.get('tileMeta', key);
    },

    async markChecked(input) {
      const record: TileMetaRecord = {
        z: input.z,
        x: input.x,
        y: input.y,
        freshness: input.freshness ?? 'fresh',
        lastCheckedAt: input.checkedAt ?? deps.now(),
        staleAfterMs: input.staleAfterMs ?? DEFAULT_TILE_STALE_AFTER_MS,
        cameraCount: input.cameraCount,
      };
      await db.put('tileMeta', record);
    },

    async freshnessOf(key) {
      const record = await db.get('tileMeta', key);
      if (record === undefined) return 'unknown';
      return derive(record, deps.now());
    },

    async oldestCheckedAt(keys) {
      const tx = db.transaction('tileMeta', 'readonly');
      const rows = await Promise.all(keys.map((key) => tx.store.get(key)));
      await tx.done;
      const stamps = rows
        .filter((row): row is TileMetaRecord => row !== undefined)
        .map((row) => row.lastCheckedAt);
      return stamps.length === 0 ? null : Math.min(...stamps);
    },

    count() {
      return db.count('tileMeta');
    },

    async remove(key) {
      await db.delete('tileMeta', key);
    },

    async clear() {
      const total = await db.count('tileMeta');
      await db.clear('tileMeta');
      return total;
    },
  };
}
