/**
 * THE SURFACE, AS A SUBSCRIPTION.
 *
 * `surface.ts` is the one place that decides which of the four layouts we are
 * on, and it is deliberately framework-free: it writes one attribute, it reads
 * `matchMedia`, and it imports nothing. `App.tsx` has held the answer in its own
 * `useState` since it was written, which was enough while `App` was the only
 * component that needed it.
 *
 * It is not enough any more. The landscape layout is chrome, and chrome is
 * mounted by `ShellDock` rather than by `App` -- the dock is on every screen
 * including during a live camera alert, which is exactly why it is not a
 * screen's child. Threading the surface down as a prop would mean `App` and
 * `ShellDock` disagreeing for one render on every rotation, and one render on a
 * rotation is the frame where a driver sees the old layout.
 *
 * SO THE SUBSCRIPTION IS SHARED AND THE DECISION IS STILL `detectSurface`'s.
 * This hook adds no rule of its own. It does not read a width, it does not
 * sniff a UA, and it does not cache a verdict across a resize: it starts the
 * same watcher `App` starts, off the same module, and re-renders when that
 * watcher says the answer changed.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, because the
 * attribute can already be different by the time an effect runs -- the snippet
 * writes it synchronously on `resize` -- and a hook that read it in an effect
 * would render one frame of the previous layout on every rotation.
 */

import { useSyncExternalStore } from 'react';

import { FALLBACK_SURFACE, detectSurface, watchSurface } from './surface.ts';
import type { FwmSurface } from './surface.ts';

/**
 * ONE WATCHER FOR THE WHOLE APPLICATION, refcounted.
 *
 * `watchSurface` adds two window listeners per call. A component tree with four
 * subscribers would add eight, re-run detection eight times per resize, and
 * write the same attribute eight times -- which is harmless and wasteful on a
 * phone and neither on a head unit resizing continuously through a rotation
 * animation. So the module holds one watch and hands out subscriptions to it.
 */
let watch: ReturnType<typeof watchSurface> | null = null;
let listeners = new Set<() => void>();
let current: FwmSurface = FALLBACK_SURFACE;

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  if (watch === null) {
    current = detectSurface();
    watch = watchSurface((next) => {
      current = next;
      for (const listener of listeners) listener();
    });
  }
  return () => {
    listeners.delete(notify);
    if (listeners.size > 0) return;
    watch?.stop();
    watch = null;
  };
}

/**
 * The snapshot MUST be referentially stable between changes or React re-renders
 * forever. `FwmSurface` is a string, so identity is value here and the module
 * variable is only ever reassigned inside the watcher's callback.
 */
function snapshot(): FwmSurface {
  return watch === null ? current : watch.current();
}

/**
 * THE SERVER SNAPSHOT IS `phone`, AND IT IS THE ONLY HONEST ONE. There is no
 * viewport to measure, and claiming `dash` without one would hand a driver a
 * layout their device may not be able to show. `surface.ts` makes the same
 * ruling in the same words for the same reason.
 */
function serverSnapshot(): FwmSurface {
  return FALLBACK_SURFACE;
}

export function useSurface(): FwmSurface {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * Test-only. Drops the shared watcher and its listeners so one test's rotation
 * cannot leak into the next one's first render.
 */
export function resetSurfaceWatchForTests(): void {
  watch?.stop();
  watch = null;
  listeners = new Set();
  current = FALLBACK_SURFACE;
}
