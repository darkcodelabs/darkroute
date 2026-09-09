/**
 * WHAT STILL WORKS -- resolved, never asserted.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A2 · OFFLINE - DEGRADED`, lines
 * 99-107. Five rows, in this order, with these exact labels:
 *
 *   OK  alerts from cached cameras
 *   OK  sweep, lookup, exposure log
 *   OK  reporting - queues locally
 *   NO  mesh feed, other darkroute
 *   NO  ask - needs the model
 *
 * =============================================================================
 * THE VERDICTS ARE READ, NOT DRAWN
 * =============================================================================
 * The design draws the five verdicts of one particular moment: a phone with a
 * full tile cache, working storage, and no network. This module resolves the
 * same five rows from what is actually true right now, because a screen whose
 * entire purpose is to tell a driver which half of the product is still real
 * cannot itself be a picture of a working product.
 *
 * Concretely, every row the design draws `OK` can resolve to `NO` here:
 *
 *   cached-alerts   an empty tile cache means there is nothing to alert about.
 *                   "Running on cache" with no cache is the worst false
 *                   negative this product can produce, so it is stated.
 *   local-tools     SWEEP, LOOKUP and the exposure log are all IndexedDB
 *                   reads. No IndexedDB, no local tools.
 *   queued-reports  a report "queues locally" into `pendingReports` and the
 *                   evidence chain. Without storage the queue would be a
 *                   promise to keep evidence that is dropped on reload.
 *
 * And the two the design draws `NO` can resolve to `OK`, when the screen is
 * open and the network comes back.
 *
 * =============================================================================
 * `unknown` IS A THIRD VERDICT, AND IT IS DELIBERATE
 * =============================================================================
 * Reading the cache is asynchronous. Between mount and the first answer the
 * rows that depend on it are neither OK nor NO, and they say so with the same
 * em dash the rest of this codebase uses for an honest absence. Defaulting
 * them to `OK` for one frame would flash a reassurance the app has not earned;
 * defaulting them to `NO` would flash an alarm it cannot justify.
 */

import type { PresenceAvailability } from '../../stores';

/** Stable ids, so a test names a row rather than indexing into the list. */
export type OfflineCapabilityId =
  | 'cached-alerts'
  | 'local-tools'
  | 'queued-reports'
  | 'mesh'
  | 'ask';

/** `OK` / `NO` as the design draws them, plus "not known yet". */
export type CapabilityVerdict = 'ok' | 'no' | 'unknown';

/** Has the local database been reached, and did it answer? */
export type StorageStatus = 'unknown' | 'available' | 'unavailable';

export interface OfflineCapability {
  readonly id: OfflineCapabilityId;
  /** Verbatim from A2. Never recomposed, never re-cased. */
  readonly label: string;
  readonly verdict: CapabilityVerdict;
}

export interface OfflineCapabilityInput {
  /** `navigator.onLine`, through the network slice. A claim, not proof. */
  readonly online: boolean;
  /** Whether a real request has succeeded since the last change. */
  readonly reachable: boolean | null;
  /** The presence slice's own verdict on the mesh feed. */
  readonly presence: PresenceAvailability;
  readonly storage: StorageStatus;
  /** Cameras actually on disk, or null while the read is in flight. */
  readonly cachedCameras: number | null;
}

/** The row labels, exactly as `A2` renders them. */
export const CAPABILITY_LABELS: Readonly<Record<OfflineCapabilityId, string>> = Object.freeze({
  'cached-alerts': 'alerts from cached cameras',
  'local-tools': 'sweep, lookup, exposure log',
  'queued-reports': 'reporting - queues locally',
  mesh: 'mesh feed, other darkroute',
  ask: 'ask - needs the model',
});

/** Row order, exactly as `A2` renders it. */
export const CAPABILITY_ORDER: readonly OfflineCapabilityId[] = Object.freeze([
  'cached-alerts',
  'local-tools',
  'queued-reports',
  'mesh',
  'ask',
]);

function verdictOf(id: OfflineCapabilityId, input: OfflineCapabilityInput): CapabilityVerdict {
  switch (id) {
    case 'cached-alerts': {
      // Storage gone is a definite no; a pending read is a definite maybe.
      if (input.storage === 'unavailable') return 'no';
      if (input.cachedCameras === null) return 'unknown';
      return input.cachedCameras > 0 ? 'ok' : 'no';
    }
    case 'local-tools':
    case 'queued-reports': {
      if (input.storage === 'available') return 'ok';
      return input.storage === 'unavailable' ? 'no' : 'unknown';
    }
    case 'mesh':
      // The presence slice already folds the feature flag, the network and the
      // backend into one verdict. Only `live` is a working mesh feed.
      return input.presence === 'live' ? 'ok' : 'no';
    case 'ask':
      // "ask - needs the model", and the model is not on the device. A failed
      // request outranks the OS's optimistic `online` claim: a captive portal
      // reads as online and answers nothing.
      //
      // What this row reports is the RESOURCE the row names, not whether a
      // screen is registered against it -- the same rule every other row here
      // follows, including `local-tools`, which resolves storage while
      // `FEATURES.plateLookup` keeps the word `lookup` pointing at a screen
      // this build does not ship.
      // GAP: see docs/gaps-inbox/offline.md#rows-name-the-resource-not-the-screen
      return input.online && input.reachable !== false ? 'ok' : 'no';
  }
}

/** The five rows, in design order, resolved against the live inputs. */
export function resolveCapabilities(
  input: OfflineCapabilityInput,
): readonly OfflineCapability[] {
  return CAPABILITY_ORDER.map((id) => ({
    id,
    label: CAPABILITY_LABELS[id],
    verdict: verdictOf(id, input),
  }));
}
