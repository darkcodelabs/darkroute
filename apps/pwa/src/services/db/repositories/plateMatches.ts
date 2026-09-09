/**
 * The local plate-match index - WATCHLIST's "73 reads", and nothing else.
 *
 * A row says: an opaque vault id matched a camera read, at a time. It does not
 * say which plate, because `plateId` is a random UUID that is meaningless
 * without the vault key. A dump of this store tells an attacker that
 * *something* matched at a camera, and nothing about what.
 *
 * Matching happens on device, against your own trip log and the community
 * camera map. No Flock system is ever queried, and no row here is ever sent
 * anywhere: `clearLocalData()` drops the whole store, which is the only exit
 * a match has.
 */

import type { PlateMatchRecord } from '../schema.ts';
import { MAX_PLATE_MATCHES } from '../policy.ts';
import type { EvictionReport, FwmDatabase, RepositoryDeps } from './support.ts';
import { resolveDeps } from './support.ts';

export interface NewPlateMatch {
  readonly matchId: string;
  readonly plateId: string;
  readonly cameraId: string;
  readonly at?: number;
}

export interface PlateMatchesRepository {
  record(match: NewPlateMatch): Promise<PlateMatchRecord>;
  forPlate(plateId: string): Promise<PlateMatchRecord[]>;
  since(from: number): Promise<PlateMatchRecord[]>;
  countForPlate(plateId: string): Promise<number>;
  count(): Promise<number>;
  trim(max?: number): Promise<EvictionReport>;
  clear(): Promise<number>;
}

export function createPlateMatchesRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps>,
): PlateMatchesRepository {
  const deps = resolveDeps(overrides);

  return {
    async record(match) {
      const record: PlateMatchRecord = {
        matchId: match.matchId,
        plateId: match.plateId,
        cameraId: match.cameraId,
        at: match.at ?? deps.now(),
        source: 'local',
      };
      await db.put('plateMatches', record);
      await this.trim();
      return record;
    },

    forPlate(plateId) {
      return db.getAllFromIndex('plateMatches', 'by-plateId', plateId);
    },

    since(from) {
      return db.getAllFromIndex('plateMatches', 'by-at', IDBKeyRange.lowerBound(from));
    },

    countForPlate(plateId) {
      return db.countFromIndex('plateMatches', 'by-plateId', plateId);
    },

    count() {
      return db.count('plateMatches');
    },

    async trim(max = MAX_PLATE_MATCHES) {
      const total = await db.count('plateMatches');
      const excess = total - max;
      if (excess <= 0) return { store: 'plateMatches', reason: 'cap', evicted: 0 };
      const keys = await db.getAllKeysFromIndex('plateMatches', 'by-at');
      const tx = db.transaction('plateMatches', 'readwrite');
      for (const key of keys.slice(0, excess)) void tx.store.delete(key);
      await tx.done;
      return { store: 'plateMatches', reason: 'cap', evicted: excess };
    },

    async clear() {
      const total = await db.count('plateMatches');
      await db.clear('plateMatches');
      return total;
    },
  };
}
