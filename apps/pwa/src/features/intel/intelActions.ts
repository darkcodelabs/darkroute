/**
 * CONFIRM STILL THERE / DISPUTE -- queued on this device, sent by nothing here.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A4 · INTEL CARD` (the two primary
 * buttons) and `B2 · DEAD DROP`, which is where a queued statement is shown
 * and where it eventually leaves from.
 *
 * =============================================================================
 * THERE IS NO NETWORK CALL IN THIS FILE
 * =============================================================================
 * A confirmation is a small, idempotent, replayable statement about a camera,
 * and `services/db/repositories/pendingActions.ts` is already built to hold
 * exactly those ("CONFIRM STILL THERE and DISPUTE pressed with no network").
 * Pressing a button writes one row to IndexedDB. Sending is the sync layer's
 * job, on the sync layer's schedule, and nothing on this screen may reach for
 * it -- a driver at 47 mph must never be waiting on a request.
 *
 * =============================================================================
 * WHAT GOES IN THE ROW
 * =============================================================================
 * `subjectId` is the camera id and the body is empty. The design does not ask
 * the driver anything when they confirm or dispute, so there is nothing else
 * to record, and every field this file does not write is a field that cannot
 * later leak. No coordinate, no heading, no timestamp of the driver's
 * position -- `createdAt` is when the button was pressed, which the queue needs
 * to order and expire rows.
 *
 * =============================================================================
 * NOTHING HERE LOGS
 * =============================================================================
 * No `console` call, and {@link IntelQueuePort.confirm} resolves to a boolean
 * rather than to a record, so a caller cannot accidentally render or transmit
 * the row it wrote.
 */

import {
  closeFwmDb,
  createPendingActionsRepository,
  openFwmDb,
} from '../../services/db/index.ts';
import type { FwmDatabase } from '../../services/db/repositories/support.ts';
import type { NewPendingAction, PendingActionKind } from '../../services/db/schema.ts';

/** The two statements this card can make. `claim_handle` is not this screen's. */
export type IntelStatement = Extract<
  PendingActionKind,
  'confirm_camera' | 'dispute_camera'
>;

export interface IntelQueuePort {
  /** Resolves true when the row is on disk. Never throws for the caller. */
  queue(kind: IntelStatement, cameraId: string, atMs: number): Promise<boolean>;
  /** Release the database handle. Safe to call when nothing was opened. */
  close(): void;
}

export interface IntelQueueOptions {
  /** Database name. Tests open their own so they never share a queue. */
  readonly dbName?: string;
}

export function createIntelQueue(options: IntelQueueOptions = {}): IntelQueuePort {
  let handle: FwmDatabase | null = null;

  async function database(): Promise<FwmDatabase> {
    if (handle !== null) return handle;
    // Not cached as a promise: a failed open must stay retryable, because the
    // usual reason is another tab holding an upgrade, and that clears.
    const opened = await openFwmDb(options.dbName === undefined ? {} : { name: options.dbName });
    handle = opened;
    return opened;
  }

  return {
    async queue(kind, cameraId, atMs) {
      try {
        const db = await database();
        const action: NewPendingAction = {
          kind,
          subjectId: cameraId,
          body: {},
          createdAt: atMs,
        };
        await createPendingActionsRepository(db).enqueue(action);
        return true;
      } catch {
        // The reason is written for a developer and could name a store. The
        // card says "NOT QUEUED" and that is all the driver needs.
        return false;
      }
    },

    close() {
      if (handle === null) return;
      closeFwmDb(handle);
      handle = null;
    },
  };
}
