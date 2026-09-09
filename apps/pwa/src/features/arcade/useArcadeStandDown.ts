/**
 * STANDING DOWN. The game gets out of the way the instant anything matters.
 *
 * Three layers close the game and each of them is sufficient on its own; this
 * file is the second. The first is STRUCTURAL and costs nothing here:
 * `beginTakeover` in `stores/alert.ts` calls `navigationActions.saveForAlert()`
 * -> `interruptForAlert()`, which empties the overlay stack, so `topOverlay()`
 * is null while an alert is live and `App.tsx` renders no overlay at all. The
 * arcade unmounts on the alert's FIRST tick, before the alert layer paints --
 * and that layer is `z-index: 3` over the overlay layer's 2 regardless.
 *
 * This layer exists so the rAF loop stops and the overlay is popped even when
 * the alert engine has not spoken but the world has changed under the round:
 *
 *   alert      a takeover is active, or the gate is open
 *   moving     the engine no longer calls the car stationary
 *   speed      the fix says 3 mph or more, or has stopped saying anything
 *   screen     the driver left the map tab
 *   motion     reduced motion was switched on mid-round
 *
 * NOT on `inRange` jitter and NOT on a `dense` -> `mesh-sync` change. The
 * round was offered honestly when it opened, and a GPS wobble or a mesh event
 * should not forfeit it; only an alert and motion may. Hidden tabs PAUSE the
 * loop (`useArcadeLoop.ts`) rather than closing, because a driver who picks
 * up a call and comes back has forfeited nothing.
 *
 * THE THIRD LAYER IS THAT IT NEVER RESURRECTS. `restoreAfterAlert` re-pushes
 * whatever an alert moved aside, so the arcade can be remounted with the alert
 * over; the mount check below runs the same test and closes it at once. The
 * round is forfeited, not resumed -- the pixel sweep's skipped-pass rule.
 */

import { useEffect, useState } from 'react';

import { useAlertStore } from '../../stores/alert.ts';
import { useNavigationStore } from '../../stores/navigation.ts';
import { usePositionStore } from '../../stores/position.ts';
import { ARCADE_SCREEN, motionReduced, slowByFix } from './offer.ts';

export type StandDownReason = 'alert' | 'moving' | 'speed' | 'screen' | 'motion';

/** Why the game must close right now, or null while it may run. */
export function standDownReason(): StandDownReason | null {
  const alert = useAlertStore.getState();
  if (alert.takeover.active || alert.shouldAlertUser) return 'alert';
  if (!alert.stationary) return 'moving';
  if (!slowByFix(usePositionStore.getState().speedMph)) return 'speed';
  if (useNavigationStore.getState().screen !== ARCADE_SCREEN) return 'screen';
  if (motionReduced()) return 'motion';
  return null;
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Watch every source a reason can come from; call `close` the moment one does.
 *
 * Returns true while standing down -- from the first render, if the mount
 * check fails -- so the loop never starts a frame it would have to cancel.
 */
export function useArcadeStandDown(close: () => void): boolean {
  const [down, setDown] = useState<boolean>(() => standDownReason() !== null);

  useEffect(() => {
    let closed = false;
    const check = (): void => {
      if (closed || standDownReason() === null) return;
      closed = true;
      setDown(true);
      close();
    };

    check();
    if (closed) return;

    const unsubscribers: (() => void)[] = [
      useAlertStore.subscribe(check),
      usePositionStore.subscribe(check),
      useNavigationStore.subscribe(check),
    ];
    const list = globalThis.matchMedia?.(REDUCE_QUERY);
    if (list !== undefined && typeof list.addEventListener === 'function') {
      list.addEventListener('change', check);
      unsubscribers.push(() => {
        list.removeEventListener('change', check);
      });
    }
    return (): void => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [close]);

  return down;
}
