/**
 * THE PHONE'S COMPASS, subscribed to once.
 *
 * The reasoning for why this exists at all, and why the two platforms need
 * different arithmetic, is in `compassHeading.ts`. This is only the plumbing:
 * attach the right listener, keep the latest bearing, and do not re-render the
 * scope for a twitch.
 *
 * PERMISSION. iOS 13+ requires an explicit grant from a user gesture before it
 * will deliver orientation events at all. There is no way to ask without one,
 * so this does NOT prompt: it attaches the listener and gets nothing until
 * something else has asked. `requestCompassPermission` is exported for a
 * gesture handler to call. Android needs no permission and starts working
 * immediately.
 */

import { useEffect, useState } from 'react';

import { headingFromOrientation, worthPublishing } from './compassHeading.ts';

interface OrientationLike {
  readonly webkitCompassHeading?: unknown;
  readonly alpha?: unknown;
  readonly absolute?: unknown;
}

/**
 * Ask iOS for the magnetometer. MUST be called from a user gesture.
 *
 * Resolves false anywhere the prompt does not exist, which includes Android and
 * every desktop browser -- those need no permission and are already working.
 */
export async function requestCompassPermission(): Promise<boolean> {
  const ctor = (globalThis as { DeviceOrientationEvent?: { requestPermission?: unknown } })
    .DeviceOrientationEvent;
  const request = ctor?.requestPermission;
  if (typeof request !== 'function') return false;
  try {
    return (await (request as () => Promise<string>)()) === 'granted';
  } catch {
    // A prompt refused, or called outside a gesture. Neither is an error worth
    // surfacing: the heading simply stays with whatever the GPS can give.
    return false;
  }
}

/** The latest compass bearing, or null. Never prompts. */
export function useCompassHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    if (typeof globalThis.addEventListener !== 'function') return;

    let latest: number | null = null;
    const onOrientation = (event: Event): void => {
      const next = headingFromOrientation(event as unknown as OrientationLike);
      if (next === null) return;
      if (!worthPublishing(latest, next)) return;
      latest = next;
      setHeading(next);
    };

    // BOTH, deliberately. Android delivers a true bearing only on
    // `deviceorientationabsolute`; iOS never fires that event and puts its
    // (already absolute) heading on plain `deviceorientation`. Listening to one
    // works on one platform. `headingFromOrientation` rejects the relative
    // readings that the plain event delivers on Android, so having both
    // attached cannot cross the wires.
    globalThis.addEventListener('deviceorientationabsolute', onOrientation);
    globalThis.addEventListener('deviceorientation', onOrientation);
    return () => {
      globalThis.removeEventListener('deviceorientationabsolute', onOrientation);
      globalThis.removeEventListener('deviceorientation', onOrientation);
    };
  }, []);

  return heading;
}
