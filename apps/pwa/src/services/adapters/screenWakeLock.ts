/**
 * SCREEN WAKE LOCK - "wake lock while RADAR is foreground" (design section 06).
 *
 * A driver does not tap the screen for twenty minutes, and a phone that sleeps
 * mid-drive is a phone that stops warning. This holds the screen on while RADAR
 * is the foreground screen, and only then: it is the single largest battery
 * cost in the product, so `stop()` on leaving RADAR is not optional.
 *
 * RE-ACQUISITION
 *   The platform releases the lock whenever the document is hidden - screen
 *   locked, app backgrounded, tab switched. That is not an error and there is
 *   no way to prevent it. This adapter remembers that it *wants* the lock and
 *   takes it again when the document becomes visible, which is the only
 *   supported way to survive a lock-screen round trip.
 *
 * NOT A PERMISSION
 *   There is no prompt and no permission to query, so `permission()` and
 *   `request()` are absent from this adapter rather than faked.
 */

import { createCore, createListenerBag } from './core';
import { doc, errorMessage, nav, no, ok, type Adapter, type Capability } from './types';

export type WakeLockRelease = 'not-held' | 'by-app' | 'by-platform';

export interface WakeLockStatus {
  readonly held: boolean;
  /** Epoch ms the current lock was taken, or null when not held. */
  readonly since: number | null;
  /** Why the last lock ended. `by-platform` means the document went hidden. */
  readonly lastRelease: WakeLockRelease;
  readonly timestamp: number;
}

export interface WakeLockAdapter extends Adapter<WakeLockStatus> {
  /** True while the adapter intends to hold a lock, held or waiting to re-take. */
  wanted(): boolean;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener?: (type: string, handler: () => void) => void;
}

interface WakeLockApi {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockApi | undefined {
  const api = (nav() as unknown as { wakeLock?: WakeLockApi } | undefined)?.wakeLock;
  if (!api || typeof api.request !== 'function') return undefined;
  return api;
}

export function wakeLockCapability(): Capability {
  if (nav() === undefined) return no('no navigator in this runtime');
  if (wakeLockApi() === undefined) {
    return no('the Screen Wake Lock API is not available in this browser');
  }
  return ok();
}

export function createWakeLockAdapter(): WakeLockAdapter {
  const core = createCore<WakeLockStatus>();
  const listeners = createListenerBag();
  let sentinel: WakeLockSentinelLike | null = null;
  let want = false;
  let acquiring = false;

  const publish = (held: boolean, since: number | null, lastRelease: WakeLockRelease): void => {
    core.emit({ held, since, lastRelease, timestamp: Date.now() });
  };

  const acquire = async (): Promise<void> => {
    const api = wakeLockApi();
    if (!api || sentinel !== null || acquiring) return;
    // The platform rejects a request from a hidden document. Asking anyway
    // produces a misleading error, so wait for the visibility handler instead.
    if (doc()?.visibilityState === 'hidden') return;
    acquiring = true;
    try {
      const next = await api.request('screen');
      if (!want) {
        // stop() landed while the request was in flight. Give it straight back.
        await next.release();
        acquiring = false;
        return;
      }
      sentinel = next;
      next.addEventListener('release', () => {
        sentinel = null;
        publish(false, null, want ? 'by-platform' : 'by-app');
      });
      core.clearError();
      publish(true, Date.now(), 'not-held');
    } catch (cause) {
      core.fail('wake-lock-refused', errorMessage(cause, 'the screen wake lock was refused'));
      publish(false, null, 'not-held');
    } finally {
      acquiring = false;
    }
  };

  return {
    name: 'screenWakeLock',

    capability: wakeLockCapability,

    /**
     * Idempotent: calling it while the lock is held (or being taken) is a no-op.
     * Returns a promise so a caller can await the first acquisition attempt.
     */
    async start(): Promise<void> {
      const capability = wakeLockCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'the wake lock API is not available');
        return;
      }
      if (want) return;
      want = true;
      core.setRunning(true);
      listeners.on(doc(), 'visibilitychange', () => {
        if (want && doc()?.visibilityState === 'visible') void acquire();
      });
      await acquire();
    },

    /** Idempotent: safe when never started and safe twice. */
    stop(): void {
      const wasActive = want || sentinel !== null;
      want = false;
      core.setRunning(false);
      listeners.removeAll();
      const held = sentinel;
      sentinel = null;
      if (held) {
        void held.release().catch(() => {
          // Already released by the platform; the state we publish is correct.
        });
      }
      // Only report a release that could have happened. Publishing "not held"
      // after a stop() on a platform with no wake lock API would be this
      // adapter inventing a value it never had.
      if (wasActive) publish(false, null, 'by-app');
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,

    wanted(): boolean {
      return want;
    },
  };
}
