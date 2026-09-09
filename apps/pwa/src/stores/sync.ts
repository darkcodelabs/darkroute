/**
 * SYNC - the queue, and why it is holding.
 *
 * "Reports are signed the moment you file them and held until you're on WiFi.
 *  Nothing is edited after the fact."
 * - Flockys Screens II.dc.html, B2 · DEAD DROP
 *
 * The durable queue is IndexedDB's (`services/db/repositories/reportChain.ts`
 * and `pendingActions.ts`). This slice is the readout: the "2 QUEUED" badge on
 * the REPORT bar, the "3 HELD" header on DEAD DROP, and the reason the queue is
 * not moving - which is the part a driver actually needs, because a queue that
 * is holding on purpose looks exactly like a queue that is broken.
 *
 * DEAD LETTERS ARE NOT QUEUED
 *   They are stuck, and folding them into the badge would mean a number that
 *   never goes down. `db/index.ts` already draws that line; this slice keeps it.
 *
 * NOTHING HERE TOUCHES THE SIGNED BYTES
 *   A queue row carries an id, a label, a state and a timestamp. The evidence,
 *   its hash chain and its signature stay in the repository. A store that could
 *   hold a signed payload is a store that could be edited into one.
 */

import { create } from 'zustand';

import type { PendingSyncCount } from '../services/db/index.ts';
import type { QueueSyncState } from '../services/db/schema.ts';

export type { PendingSyncCount, QueueSyncState };

/** What DEAD DROP renders per row. No payload, no hash, no signature. */
export interface QueuedDrop {
  readonly reportId: string;
  /** "Vine St", "I-71 ramp" - a place, from the report's own camera record. */
  readonly label: string | null;
  /** ISO-8601 UTC, exactly as the signed record carries it. */
  readonly capturedAt: string;
  readonly syncState: QueueSyncState;
  readonly attempts: number;
  readonly hasPhoto: boolean;
  /** Epoch ms the next attempt is due, or null when nothing is scheduled. */
  readonly nextAttemptAtMs: number | null;
}

/** Why the queue is not moving right now. */
export type SyncHold =
  /** No network at all. */
  | 'offline'
  /** Online, but the user asked for evidence to wait for an unmetered link. */
  | 'wifi-only'
  /** The backend refused or failed; a retry is scheduled. */
  | 'backing-off';

export type SyncStatus = 'idle' | 'syncing' | 'holding' | 'failed';

export interface SyncState {
  readonly reports: number;
  readonly actions: number;
  /** Reports + actions. Dead letters are deliberately not in here. */
  readonly total: number;
  readonly deadLettered: number;
  readonly drops: readonly QueuedDrop[];
  readonly status: SyncStatus;
  /** Named `holdReason` and not `hold` so it cannot collide with the action. */
  readonly holdReason: SyncHold | null;
  readonly lastSyncAtMs: number | null;
  /** Last failure, for the UI. Never a plate, never a coordinate. */
  readonly lastError: string | null;
}

export interface SyncActions {
  /** Counts read back from the durable queue. */
  setCounts(counts: PendingSyncCount): void;
  /** The DEAD DROP list, newest first. */
  setDrops(drops: readonly QueuedDrop[]): void;
  beginSync(): void;
  finishSync(atMs: number, counts?: PendingSyncCount): void;
  failSync(message: string, atMs: number): void;
  /** Not moving, and here is why. */
  hold(reason: SyncHold): void;
  release(): void;
  reset(): void;
}

export type SyncStore = SyncState & SyncActions;

const NO_DROPS: readonly QueuedDrop[] = Object.freeze([]);

const INITIAL_STATE: SyncState = Object.freeze({
  reports: 0,
  actions: 0,
  total: 0,
  deadLettered: 0,
  drops: NO_DROPS,
  status: 'idle',
  holdReason: null,
  lastSyncAtMs: null,
  lastError: null,
});

export function createSyncStore() {
  return create<SyncStore>()((set, get) => ({
    ...INITIAL_STATE,

    setCounts(counts) {
      set({
        reports: counts.reports,
        actions: counts.actions,
        total: counts.total,
        deadLettered: counts.deadLettered,
      });
    },

    setDrops(drops) {
      set({ drops: drops.length === 0 ? NO_DROPS : drops });
    },

    beginSync() {
      set({ status: 'syncing', holdReason: null, lastError: null });
    },

    finishSync(atMs, counts) {
      set({
        status: 'idle',
        holdReason: null,
        lastError: null,
        lastSyncAtMs: atMs,
        ...(counts === undefined
          ? {}
          : {
              reports: counts.reports,
              actions: counts.actions,
              total: counts.total,
              deadLettered: counts.deadLettered,
            }),
      });
    },

    failSync(message, atMs) {
      set({ status: 'failed', lastError: message, lastSyncAtMs: atMs });
    },

    hold(reason) {
      set({ status: 'holding', holdReason: reason });
    },

    release() {
      if (get().status !== 'holding') return;
      set({ status: 'idle', holdReason: null });
    },

    reset() {
      set({ ...INITIAL_STATE });
    },
  }));
}

export const useSyncStore = createSyncStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The "2 QUEUED" badge on the REPORT bar. A primitive, so the dock is cheap. */
export const usePendingSyncCount = (): number => useSyncStore((s) => s.total);

/** "3 HELD" on DEAD DROP. */
export const useHeldReportCount = (): number => useSyncStore((s) => s.reports);

export const useDeadLetteredCount = (): number => useSyncStore((s) => s.deadLettered);

export const useQueuedDrops = (): readonly QueuedDrop[] => useSyncStore((s) => s.drops);

export const useSyncStatus = (): SyncStatus => useSyncStore((s) => s.status);

export const useSyncHold = (): SyncHold | null => useSyncStore((s) => s.holdReason);

export const useLastSyncAtMs = (): number | null => useSyncStore((s) => s.lastSyncAtMs);

export const useSyncError = (): string | null => useSyncStore((s) => s.lastError);

export const syncActions = {
  setCounts: (counts: PendingSyncCount): void => {
    useSyncStore.getState().setCounts(counts);
  },
  setDrops: (drops: readonly QueuedDrop[]): void => {
    useSyncStore.getState().setDrops(drops);
  },
  beginSync: (): void => {
    useSyncStore.getState().beginSync();
  },
  finishSync: (atMs: number, counts?: PendingSyncCount): void => {
    useSyncStore.getState().finishSync(atMs, counts);
  },
  failSync: (message: string, atMs: number): void => {
    useSyncStore.getState().failSync(message, atMs);
  },
  hold: (reason: SyncHold): void => {
    useSyncStore.getState().hold(reason);
  },
  release: (): void => {
    useSyncStore.getState().release();
  },
  reset: (): void => {
    useSyncStore.getState().reset();
  },
};
