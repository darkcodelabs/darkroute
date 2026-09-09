/**
 * WEB SHARE.
 *
 * Backs the ZONE AUDIT "SHARE CARD" (which "RENDERS AS AN IMAGE") and the
 * intel-card SHARE action. Sharing is always something the user just tapped;
 * nothing here fires on its own.
 *
 * NO DOMAIN LIVES IN THIS FILE
 *   A share can carry a link, and the production host is configuration, not
 *   source. `url` is supplied by the caller from the app's environment config
 *   and this adapter never constructs, defaults or guesses one. A share with no
 *   configured origin goes out without a link rather than with the wrong one.
 *
 * PRIVACY
 *   `SharePayloadKind` is the whole list of things that may be shared, and none
 *   of them is a plate, a watchlist entry or a coordinate. The zone-audit card
 *   is a rendered image of area statistics; the intel card describes a camera,
 *   which is public infrastructure. If a new kind is ever added, it gets
 *   reviewed here, which is the point of the union.
 */

import { createCore } from './core';
import { errorMessage, nav, no, ok, type Adapter, type Capability } from './types';

export type SharePayloadKind = 'zone-audit-card' | 'camera-intel' | 'report-receipt' | 'app-link';

export interface SharePayload {
  readonly kind: SharePayloadKind;
  readonly title: string;
  readonly text: string;
  /** Absolute URL from app config. Never built here. Omit to share no link. */
  readonly url?: string;
  readonly files?: readonly File[];
}

export type ShareStatus = 'shared' | 'cancelled' | 'unsupported' | 'failed';

export interface ShareOutcome {
  readonly kind: SharePayloadKind;
  readonly status: ShareStatus;
  readonly withFiles: boolean;
  readonly timestamp: number;
  readonly reason?: string;
}

export interface ShareAdapter extends Adapter<ShareOutcome> {
  /** USER GESTURE ONLY - the platform sheet will not open without one. */
  share(payload: SharePayload): Promise<ShareOutcome>;
  /** Whether this exact payload can be shared, files included. */
  canShare(payload: SharePayload): boolean;
}

export function shareCapability(): Capability {
  const navigator = nav();
  if (navigator === undefined) return no('no navigator in this runtime');
  if (typeof navigator.share !== 'function') {
    return no('the Web Share API is not available in this browser');
  }
  return ok();
}

export function fileShareCapability(): Capability {
  if (!shareCapability().supported) return shareCapability();
  if (typeof nav()?.canShare !== 'function') {
    return no('this browser cannot share files (navigator.canShare is missing)');
  }
  return ok();
}

function toShareData(payload: SharePayload): ShareData {
  const data: ShareData = { title: payload.title, text: payload.text };
  if (payload.url !== undefined) data.url = payload.url;
  if (payload.files !== undefined && payload.files.length > 0) data.files = [...payload.files];
  return data;
}

export function createShareAdapter(): ShareAdapter {
  const core = createCore<ShareOutcome>();

  const canShare = (payload: SharePayload): boolean => {
    const navigator = nav();
    if (!shareCapability().supported || navigator === undefined) return false;
    const hasFiles = payload.files !== undefined && payload.files.length > 0;
    if (!hasFiles) return true;
    if (typeof navigator.canShare !== 'function') return false;
    try {
      return navigator.canShare(toShareData(payload));
    } catch {
      return false;
    }
  };

  return {
    name: 'share',

    capability: shareCapability,

    /**
     * Nothing to arm; the pair exists for the adapter contract and lets a
     * caller disable sharing wholesale. Idempotent.
     */
    start(): void {
      const capability = shareCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'sharing is not available');
        return;
      }
      core.clearError();
      core.setRunning(true);
    },

    /** Idempotent. */
    stop(): void {
      core.setRunning(false);
    },

    canShare,

    async share(payload: SharePayload): Promise<ShareOutcome> {
      const withFiles = payload.files !== undefined && payload.files.length > 0;
      const finish = (status: ShareStatus, reason?: string): ShareOutcome => {
        const outcome: ShareOutcome =
          reason === undefined
            ? { kind: payload.kind, status, withFiles, timestamp: Date.now() }
            : { kind: payload.kind, status, withFiles, timestamp: Date.now(), reason };
        core.emit(outcome);
        return outcome;
      };

      const navigator = nav();
      const capability = shareCapability();
      if (!capability.supported || navigator === undefined) {
        return finish('unsupported', capability.reason ?? 'sharing is not available');
      }
      if (withFiles && !canShare(payload)) {
        return finish('unsupported', 'this browser will not share these files');
      }
      try {
        await navigator.share(toShareData(payload));
        core.clearError();
        return finish('shared');
      } catch (cause) {
        // A dismissed sheet rejects with AbortError. That is the user saying
        // no, not a failure, and it must never surface as an error state.
        if (cause instanceof Error && cause.name === 'AbortError') return finish('cancelled');
        const reason = errorMessage(cause, 'the share sheet failed');
        core.fail('share-failed', reason);
        return finish('failed', reason);
      }
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
  };
}
