/**
 * SCREEN ORIENTATION LOCK - portrait where it is allowed, honest where it is not.
 *
 *   "Screen Orientation lock to portrait"
 * - Flockys Design System.dc.html, section 06, PLATFORM BEHAVIOUR
 *
 * NOT THE COMPASS. `services/adapters/orientation.ts` is device orientation -
 * which way the phone is *pointing*. This is screen orientation - which way the
 * phone is *rendering*. They share a word and nothing else.
 *
 * THIS API FAILS MORE OFTEN THAN IT WORKS, AND THAT IS FINE
 *   `ScreenOrientation.lock()` is Android/Chromium only, and even there it
 *   rejects unless the document is fullscreen or the app is installed
 *   (display-mode: standalone). Safari has no `lock()` at all. So every call
 *   site here is wrapped, every rejection is recorded as a sentence, and
 *   nothing throws out of this module. A browser tab that stays rotatable is a
 *   degraded experience, not a crash.
 *
 * WHY IT IS NOT LOCKED FROM `main.tsx` UNCONDITIONALLY
 *   The dash surface is landscape by definition ("(min-width: 700px) and
 *   (orientation: landscape)" is literally how section 06 detects it). Locking
 *   portrait there would fight the head unit. `lockPortrait()` therefore takes
 *   the surface and refuses on `dash`, saying so.
 */

import { errorMessage, globalValue, no, ok, type Capability } from '../adapters/types.ts';
import type { FwmSurface } from '../../app/surface.ts';

/** The value section 06 asks for, and the value the manifest declares. */
export const PORTRAIT_LOCK = 'portrait-primary';

interface ScreenOrientationLike {
  readonly type?: string;
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
}

function screenOrientation(): ScreenOrientationLike | undefined {
  const screen = globalValue<{ orientation?: ScreenOrientationLike }>('screen');
  return screen?.orientation;
}

export function orientationLockCapability(): Capability {
  const orientation = screenOrientation();
  if (orientation === undefined) {
    return no('this browser has no Screen Orientation API, so the screen cannot be locked');
  }
  if (typeof orientation.lock !== 'function') {
    return no('this browser exposes screen orientation but not orientation.lock()');
  }
  return ok();
}

export type LockOutcome =
  /** The platform accepted the lock. */
  | 'locked'
  /** There is no API to lock with. */
  | 'unavailable'
  /**
   * The API exists and refused - almost always because the document is
   * neither fullscreen nor installed. Retrying after install is worthwhile.
   */
  | 'refused'
  /** This surface is not supposed to be portrait. */
  | 'not-applicable';

export interface LockResult {
  readonly outcome: LockOutcome;
  /** A sentence for the settings screen. Null when `outcome` is 'locked'. */
  readonly reason: string | null;
}

/**
 * Lock to portrait-primary. Never throws.
 *
 * `surface` is optional; pass it so the dash surface is skipped rather than
 * refused by the platform for the wrong reason.
 */
export async function lockPortrait(surface?: FwmSurface): Promise<LockResult> {
  if (surface === 'dash') {
    return {
      outcome: 'not-applicable',
      reason: 'the dash surface is landscape by definition; portrait lock does not apply to it',
    };
  }

  const capability = orientationLockCapability();
  if (!capability.supported) {
    return {
      outcome: 'unavailable',
      reason: capability.reason ?? 'orientation lock is unavailable',
    };
  }

  const orientation = screenOrientation();
  const lock = orientation?.lock;
  if (lock === undefined || orientation === undefined) {
    return { outcome: 'unavailable', reason: 'orientation lock disappeared between checks' };
  }

  try {
    await lock.call(orientation, PORTRAIT_LOCK);
    return { outcome: 'locked', reason: null };
  } catch (cause) {
    // NotSupportedError on desktop, SecurityError when not fullscreen or
    // installed, AbortError when a second lock lands first. All the same to
    // the caller: it did not lock, and here is what the platform said.
    return {
      outcome: 'refused',
      reason: errorMessage(cause, 'the platform refused to lock the screen orientation'),
    };
  }
}

/** Release the lock. Never throws; a platform without `unlock()` is a no-op. */
export function unlockOrientation(): boolean {
  const orientation = screenOrientation();
  if (orientation === undefined || typeof orientation.unlock !== 'function') return false;
  try {
    orientation.unlock();
    return true;
  } catch {
    // Unlocking something that was never locked is not worth reporting.
    return false;
  }
}

/** The platform's current orientation string, or null when unknown. */
export function currentOrientation(): string | null {
  return screenOrientation()?.type ?? null;
}
