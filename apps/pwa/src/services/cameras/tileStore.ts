/**
 * THE TILE CACHE THAT SURVIVES A RELOAD.
 *
 * =============================================================================
 * WHAT WAS MISSING
 * =============================================================================
 * `services/db/repositories/cameraTiles.ts` is a complete cache: `put`,
 * `putMany`, `camerasIn`, a `by-fetchedAt` index, an eviction policy, a hard
 * expiry, a migration and its own tests. It had ZERO production callers.
 *
 * So the only place a camera lived was `stores/cameras.ts`, a Zustand store -
 * which is memory. Every reload refetched every tile, and with the radio off
 * there was nothing at all: the first fix produced an empty map over a city
 * full of cameras. The OFFLINE screen was correct to resolve `cached-alerts`
 * to NO; the product was telling the truth about not working.
 *
 * This module is the join, and it is the only thing that writes that store.
 *
 * =============================================================================
 * FAILING TO CACHE IS NOT AN ERROR WORTH BREAKING A DRIVE FOR
 * =============================================================================
 * Every function here swallows its own failures and reports a count. IndexedDB
 * can be absent (private mode on some engines), full, or blocked by a version
 * change in another tab, and none of those is a reason to stop warning
 * somebody about a camera. The in-memory store remains the thing the alert
 * engine reads; this is durability underneath it, never in front of it.
 *
 * =============================================================================
 * THE READ IS A SEED, NOT A SOURCE OF TRUTH
 * =============================================================================
 * `hydrateTiles` puts cached tiles into the memory store at boot so a cold
 * offline start has cameras. The network sync then runs normally and
 * overwrites what it re-fetches. It deliberately marks what it loads as
 * `stale`, never `fresh`: RADAR renders that distinction, and a two-day-old
 * tile presented as current is the one lie this cache could tell.
 */

import {
  DB_OPEN_TIMEOUT_MS,
  createRepositories,
  hasIndexedDb,
  openFwmDbWithin,
} from '../db/index.ts';
import type { FwmDatabase } from '../db/index.ts';
import type { CameraRecord, TileKey } from '../db/schema.ts';
import { camerasActions, useCamerasStore } from '../../stores/cameras.ts';
import type { TileRef } from '../../stores/fwmCore.ts';

export interface PersistableTile {
  readonly ref: TileRef;
  readonly cameras: readonly CameraRecord[];
  readonly fetchedAtMs: number;
  readonly generation: string;
}

/**
 * One connection, opened on first use and kept.
 *
 * Not opened at module load: importing this file must not touch the platform,
 * which is the rule every adapter in this codebase follows.
 */
let opening: Promise<FwmDatabase | null> | null = null;

/**
 * Storage may aid a live drive, but may never hold its network path hostage.
 *
 * The bound itself lives in `services/db` as `DB_OPEN_TIMEOUT_MS`, because the
 * OFFLINE screen needs exactly the same one: it used to open the database with
 * no deadline at all, and a blocked upgrade left that screen reporting
 * `unknown` storage forever while the drive path had already given up in 1.5 s.
 * Two callers, two behaviours, one database - so there is now one bound.
 */
export const CAMERA_DATABASE_OPEN_TIMEOUT_MS = DB_OPEN_TIMEOUT_MS;

function database(): Promise<FwmDatabase | null> {
  if (opening !== null) return opening;
  opening = (async (): Promise<FwmDatabase | null> => {
    if (!hasIndexedDb()) return null;
    try {
      return await openFwmDbWithin(CAMERA_DATABASE_OPEN_TIMEOUT_MS);
    } catch {
      // A blocked upgrade or a private-browsing refusal. The app keeps working
      // from memory; it simply forgets between sessions.
      return null;
    }
  })();
  return opening;
}

/** Forget the handle. Tests only - the app opens once and holds it. */
export function resetTileStore(): void {
  opening = null;
}

/**
 * Write tiles through to IndexedDB. Returns how many landed.
 *
 * `source: 'network'` because that is what these are: only `syncAt` calls
 * this, and only for a tile it actually fetched. A tile read back out is
 * relabelled `stale` on the way in to the memory store, not here - the record
 * should say where the bytes came from, not how old they are now.
 */
export async function persistTiles(tiles: readonly PersistableTile[]): Promise<number> {
  if (tiles.length === 0) return 0;
  const db = await database();
  if (db === null) return 0;
  try {
    const repos = createRepositories(db);
    const generation = tiles[0]?.generation;
    if (generation === undefined || tiles.some((tile) => tile.generation !== generation)) {
      return 0;
    }
    return await repos.cameraTiles.putManyIfGeneration(
      generation,
      tiles.map((tile) => ({
        z: tile.ref.z,
        x: tile.ref.x,
        y: tile.ref.y,
        cameras: tile.cameras,
        generation: tile.generation,
        source: 'network' as const,
        fetchedAt: tile.fetchedAtMs,
      })),
    );
  } catch {
    // Quota, or a store that vanished under a version change. Not fatal.
    return 0;
  }
}

/**
 * Seed the memory store from the cache, for a cold start.
 *
 * Returns the number of TILES loaded, not cameras - the caller logs it and the
 * OFFLINE screen counts cameras itself from the store.
 */
export async function hydrateTiles(
  keys: readonly TileKey[],
  expectedGeneration?: string,
): Promise<number> {
  if (keys.length === 0) return 0;
  const db = await database();
  if (db === null) return 0;
  try {
    const repos = createRepositories(db);
    // Expiry is enforced on the production read path, not merely by an
    // optional maintenance call. A cold offline boot must never resurrect a
    // tile past the cache's hard safety window.
    await repos.cameraTiles.evictExpired();
    const snapshot = await repos.cameraTiles.generationSnapshot(keys, expectedGeneration);
    if (snapshot === null) return 0;
    const tiles = snapshot.tiles;
    if (tiles.length === 0) return 0;

    // Hydration may have exceeded sync's time budget while a newer network
    // generation committed. Its late continuation must never roll memory back.
    const workingGeneration = useCamerasStore.getState().generation;
    if (
      (snapshot.generation === null && workingGeneration !== null) ||
      (snapshot.generation !== null &&
        workingGeneration !== null &&
        snapshot.generation !== workingGeneration)
    ) {
      return 0;
    }

    const entries = tiles.map((tile) => ({
      ref: { z: tile.z, x: tile.x, y: tile.y },
      cameras: tile.cameras,
      fetchedAtMs: tile.fetchedAt,
      // STALE, NEVER FRESH. RADAR draws the difference and the OFFLINE
      // screen says "DB last updated N days ago" from it. Marking a tile
      // read off disk as fresh would let an old "CLEAR" look current, which
      // is the one lie this cache is in a position to tell.
      //
      // `source` stays `network`: it records where the BYTES came from, and
      // they came off the wire once. The freshness field is the one that
      // says how long ago.
      freshness: 'stale' as const,
      source: 'network' as const,
    }));
    if (snapshot.generation === null) camerasActions.putTiles(entries);
    else camerasActions.putGenerationTiles(snapshot.generation, entries);
    return tiles.length;
  } catch {
    return 0;
  }
}

/**
 * Replace every durable camera tile in the same IndexedDB transaction.
 *
 * A generation change embodies its tombstone ledger: records absent from the
 * new tiles are deleted by the clear, so the client must not merge tombstones
 * separately or retain an old location for a moved id.
 */
export type PersistedReplacement = 'committed' | 'unavailable' | 'failed';

export async function replacePersistedTiles(
  expectedGeneration: string | null,
  generation: string,
  tiles: readonly PersistableTile[],
): Promise<PersistedReplacement> {
  const db = await database();
  // No connection means durability is unavailable, even if the browser has an
  // IndexedDB-shaped global that refused/blocked open. Fresh network cameras
  // must still reach memory; only an actual replacement transaction failure
  // means a prior durable generation may need protection from later writes.
  if (db === null) return 'unavailable';
  try {
    const repos = createRepositories(db);
    const result = await repos.cameraTiles.replaceAll(
      expectedGeneration,
      generation,
      tiles.map((tile) => ({
        z: tile.ref.z,
        x: tile.ref.x,
        y: tile.ref.y,
        cameras: tile.cameras,
        generation,
        source: 'network' as const,
        fetchedAt: tile.fetchedAtMs,
      })),
    );
    return result === 'conflict' ? 'failed' : 'committed';
  } catch {
    return 'failed';
  }
}

/** Drop tiles past their hard expiry. Cheap, and keeps the cap honest. */
export async function sweepTiles(): Promise<number> {
  const db = await database();
  if (db === null) return 0;
  try {
    const repos = createRepositories(db);
    const report = await repos.cameraTiles.evictExpired();
    return report.evicted;
  } catch {
    return 0;
  }
}
