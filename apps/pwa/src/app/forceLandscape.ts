/**
 * FORCE LANDSCAPE - the driver overrules the viewport.
 *
 * WHY THIS IS NOT A DETECTION BUG TO BE FIXED IN `surface.ts`
 *   Detection is right about what it can see. The failure it cannot see is a
 *   phone with Portrait Lock on: the handset is physically sideways in a mount,
 *   the screen is wide, and the OS still hands the browser a tall viewport, so
 *   `(orientation: landscape)` is false and section 06 correctly rules `phone`
 *   on the evidence available. No amount of measuring gets past an OS that is
 *   lying by omission. The only thing that knows the truth is the person
 *   looking at the screen, so they get a switch.
 *
 *   The same switch covers the other two cases that reach the same dead end: a
 *   head unit that reports a phone-sized viewport, and a tablet held upright
 *   whose owner wants the wide layout anyway.
 *
 * WHAT IT DOES, IN TWO PARTS AND IN THIS ORDER
 *   1. ASK THE OS TO ACTUALLY ROTATE. `screen.orientation.lock('landscape')` is
 *      the real fix when it is available: the app turns, the viewport genuinely
 *      becomes wide, and detection needs no help. It is best-effort by design -
 *      every browser gates it (most require fullscreen or an installed PWA,
 *      desktop Safari has no implementation at all), and a refusal is a
 *      REJECTED PROMISE, which is why the call is wrapped rather than awaited.
 *   2. DECLARE THE SURFACE REGARDLESS. Part 1 fails on the exact devices this
 *      setting exists for - a phone whose OS refuses to rotate is not going to
 *      honour a rotation request from a web page. So the declaration is not
 *      conditional on the lock succeeding; it is the part that always works.
 *
 * THE HONEST CAVEAT, WRITTEN DOWN RATHER THAN HIDDEN
 *   When the lock is refused, the landscape chrome is drawn into a viewport
 *   that is still tall. That layout is designed wide, so it will be cramped.
 *   That is the correct trade: the driver asked for it, they can see the result,
 *   and one press puts it back. What is NOT acceptable is silently ignoring the
 *   switch because we decided we knew better than the person holding the phone.
 */

import { setSurfaceOverride } from './surface.ts';

/**
 * The subset of `ScreenOrientation` this module uses. Declared locally because
 * `lock` is absent from some lib.dom builds and present-but-throwing in others,
 * and because `unlock` is optional in exactly the browsers where `lock` is.
 */
interface OrientationLock {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
}

function orientationApi(): OrientationLock | null {
  const api = (globalThis as { screen?: { orientation?: OrientationLock } }).screen
    ?.orientation;
  return api ?? null;
}

/**
 * Best-effort. Returns nothing and throws nothing: a browser that refuses is
 * the expected case, not an error condition, and part 2 covers it.
 */
function askTheOsToRotate(on: boolean): void {
  const api = orientationApi();
  if (api === null) return;
  try {
    if (on) {
      // `lock` rejects when the document is not fullscreen, when the device is
      // a desktop, and when the OS orientation lock is engaged. All three are
      // silent no-ops here by design.
      void api.lock?.('landscape')?.catch(() => undefined);
      return;
    }
    api.unlock?.();
  } catch {
    /* A synchronous throw from `lock`/`unlock` is the same non-event as a
       rejection. The declaration below is what the setting actually promises. */
  }
}

/**
 * Apply the preference. Call on boot with the persisted value and on every
 * change; it is idempotent, and `setSurfaceOverride` short-circuits when the
 * declaration has not moved.
 */
export function applyForceLandscape(on: boolean): void {
  askTheOsToRotate(on);
  setSurfaceOverride(on ? 'dash' : null);
}
