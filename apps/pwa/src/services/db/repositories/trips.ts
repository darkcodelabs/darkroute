/**
 * Trips - the unit EXPOSURE compares against all time ("trip vs all-time").
 *
 * A trip is open while `endedAt` is null. Nothing here closes a trip on a
 * timer: the driving-state machine decides when a drive is over, and this
 * store records the decision. An app that was force-quit mid-drive leaves an
 * open trip behind, and `current()` will return it - which is correct, and is
 * why `finish()` takes the end time rather than reading the clock.
 */

import type { NewTrip, TripRecord } from '../schema.ts';
import { MAX_TRIPS } from '../policy.ts';
import type { EvictionReport, FwmDatabase, RepositoryDeps } from './support.ts';
import { RepositoryError, resolveDeps } from './support.ts';

export interface TripFinishInput {
  readonly endedAt: number;
  readonly distanceMi: number;
  readonly cameraIdsPassed: readonly string[];
  readonly exposureCount: number;
}

export interface TripsRepository {
  start(startedAt?: number): Promise<number>;
  get(id: number): Promise<TripRecord | undefined>;
  /** The open trip, if there is one. */
  current(): Promise<TripRecord | undefined>;
  finish(id: number, input: TripFinishInput): Promise<TripRecord>;
  /** Newest first. */
  recent(limit: number): Promise<TripRecord[]>;
  since(from: number): Promise<TripRecord[]>;
  count(): Promise<number>;
  /** All-time exposure, for the EXPOSURE comparison. */
  totalExposure(): Promise<number>;
  trim(max?: number): Promise<EvictionReport>;
  clear(): Promise<number>;
}

export function createTripsRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps>,
): TripsRepository {
  const deps = resolveDeps(overrides);

  return {
    async start(startedAt) {
      const trip: NewTrip = {
        startedAt: startedAt ?? deps.now(),
        endedAt: null,
        distanceMi: 0,
        cameraIdsPassed: [],
        exposureCount: 0,
      };
      const id = await db.add('trips', trip as TripRecord);
      await this.trim();
      return id;
    },

    get(id) {
      return db.get('trips', id);
    },

    async current() {
      const rows = await db.getAllFromIndex('trips', 'by-startedAt');
      for (let i = rows.length - 1; i >= 0; i--) {
        const trip = rows[i];
        if (trip !== undefined && trip.endedAt === null) return trip;
      }
      return undefined;
    },

    async finish(id, input) {
      const tx = db.transaction('trips', 'readwrite');
      const existing = await tx.store.get(id);
      if (existing === undefined) {
        await tx.done;
        throw new RepositoryError(`no trip ${String(id)} to finish`, 'trips');
      }
      const finished: TripRecord = {
        ...existing,
        endedAt: input.endedAt,
        distanceMi: input.distanceMi,
        cameraIdsPassed: input.cameraIdsPassed,
        exposureCount: input.exposureCount,
      };
      void tx.store.put(finished);
      await tx.done;
      return finished;
    },

    async recent(limit) {
      const rows = await db.getAllFromIndex('trips', 'by-startedAt');
      return rows.slice(-Math.max(0, limit)).reverse();
    },

    since(from) {
      return db.getAllFromIndex('trips', 'by-startedAt', IDBKeyRange.lowerBound(from));
    },

    count() {
      return db.count('trips');
    },

    async totalExposure() {
      const rows = await db.getAll('trips');
      return rows.reduce((total, trip) => total + trip.exposureCount, 0);
    },

    async trim(max = MAX_TRIPS) {
      const total = await db.count('trips');
      const excess = total - max;
      if (excess <= 0) return { store: 'trips', reason: 'cap', evicted: 0 };
      const keys = await db.getAllKeysFromIndex('trips', 'by-startedAt');
      const tx = db.transaction('trips', 'readwrite');
      for (const key of keys.slice(0, excess)) void tx.store.delete(key);
      await tx.done;
      return { store: 'trips', reason: 'cap', evicted: excess };
    },

    async clear() {
      const total = await db.count('trips');
      await db.clear('trips');
      return total;
    },
  };
}
