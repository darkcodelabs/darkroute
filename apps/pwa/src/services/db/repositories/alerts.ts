/**
 * Alert history - the store LOG and EXPOSURE read from.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT: muting removes the alert, never
 * the record. `record()` writes whether or not the camera was muted, whether
 * or not the user dismissed it, and whether or not anything was rendered. The
 * `muted` field says what the driver experienced; it never says what happened.
 *
 * A muted camera still counts in EXPOSURE, still appears in LOG, still draws
 * on SWEEP and still transitions the engine's internal state. There is no
 * write path in this file that a mute can suppress, and there must not be one.
 */

import type { AlertRecord, NewAlert } from '../schema.ts';
import { MAX_ALERTS } from '../policy.ts';
import type { EvictionReport, FwmDatabase, RepositoryDeps } from './support.ts';
import { resolveDeps } from './support.ts';

/** `at` defaults to the injected clock; every other field is the caller's. */
export type AlertInput = Omit<NewAlert, 'at'> & { readonly at?: number };

export interface AlertsRepository {
  /** Writes unconditionally. Muted alerts are alerts that happened. */
  record(alert: AlertInput): Promise<number>;
  get(id: number): Promise<AlertRecord | undefined>;
  /** Newest first, for the LOG timeline. */
  recent(limit: number): Promise<AlertRecord[]>;
  /** Everything at or after `from`, oldest first. The trip window. */
  since(from: number): Promise<AlertRecord[]>;
  between(from: number, to: number): Promise<AlertRecord[]>;
  forCamera(cameraId: string): Promise<AlertRecord[]>;
  /** EXPOSURE's "flocked today". Counts muted passes, by design. */
  countSince(from: number): Promise<number>;
  count(): Promise<number>;
  markDismissed(id: number): Promise<void>;
  trim(max?: number): Promise<EvictionReport>;
  clear(): Promise<number>;
}

export function createAlertsRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps>,
): AlertsRepository {
  const deps = resolveDeps(overrides);

  return {
    async record(alert) {
      const row: NewAlert = { ...alert, at: alert.at ?? deps.now() };
      // `id` is assigned by the store's key generator. The cast is the
      // narrowing IndexedDB performs for us a microsecond later.
      const id = await db.add('alerts', row as AlertRecord);
      await this.trim();
      return id;
    },

    get(id) {
      return db.get('alerts', id);
    },

    async recent(limit) {
      const rows = await db.getAllFromIndex('alerts', 'by-at');
      return rows.slice(-Math.max(0, limit)).reverse();
    },

    since(from) {
      return db.getAllFromIndex('alerts', 'by-at', IDBKeyRange.lowerBound(from));
    },

    between(from, to) {
      return db.getAllFromIndex('alerts', 'by-at', IDBKeyRange.bound(from, to));
    },

    forCamera(cameraId) {
      return db.getAllFromIndex('alerts', 'by-cameraId', cameraId);
    },

    countSince(from) {
      return db.countFromIndex('alerts', 'by-at', IDBKeyRange.lowerBound(from));
    },

    count() {
      return db.count('alerts');
    },

    async markDismissed(id) {
      const tx = db.transaction('alerts', 'readwrite');
      const existing = await tx.store.get(id);
      if (existing !== undefined) {
        void tx.store.put({ ...existing, dismissed: true });
      }
      await tx.done;
    },

    async trim(max = MAX_ALERTS) {
      const total = await db.count('alerts');
      const excess = total - max;
      if (excess <= 0) return { store: 'alerts', reason: 'cap', evicted: 0 };
      const doomed = await db.getAllKeysFromIndex('alerts', 'by-at');
      const tx = db.transaction('alerts', 'readwrite');
      for (const key of doomed.slice(0, excess)) void tx.store.delete(key);
      await tx.done;
      return { store: 'alerts', reason: 'cap', evicted: excess };
    },

    async clear() {
      const total = await db.count('alerts');
      await db.clear('alerts');
      return total;
    },
  };
}
