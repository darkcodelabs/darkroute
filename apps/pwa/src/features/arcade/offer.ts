/**
 * WHEN THE GAME MAY BE OFFERED. One function, eight conditions, all of them.
 *
 * The owner asked for a game to play "if you were near a camera". The product
 * rules turn "near" into something narrower, and every clause below is one of
 * them made testable:
 *
 *   1. PARKED, BY THE ENGINE'S OWN VERDICT. `useIsStationary()` is the alert
 *      engine's `stationary` -- at or under 5 mph for the whole of
 *      `DEFAULT_STATIONARY_DWELL_MS`, which is two minutes
 *      (`packages/core/src/alert.ts`). While it is true `shouldAlertUser` is
 *      false by arithmetic, so a round can never be offered on a tick that
 *      could also have buzzed. THE KEY THEREFORE APPEARS ABOUT TWO MINUTES
 *      AFTER STOPPING AND NEVER AT A RED LIGHT. That number is the engine's,
 *      not this file's -- see `docs/gaps-inbox/core-engine.md#stationary-dwell`
 *      -- and a faster three-mph-only gate was considered and not chosen.
 *   2. AND SLOW BY THE FIX. `speedMph` under `MIN_MOVING_MPH` (3, `eta.ts`),
 *      and a null speed is NOT parked: the engine says the same thing about
 *      an unknown speed, and so does this.
 *   3. A READER IS ACTUALLY NEAR. The nearest assessment's `inRange`, which is
 *      the engine's own threshold verdict after hysteresis. Not a distance
 *      compared here against a number of this file's choosing.
 *   4. THE FIX IS GOOD ENOUGH TO ALERT ON. An accuracy suppression means the
 *      engine would not trust this position for a warning; it should not be
 *      trusted for a toy either.
 *   5. NOTHING IS BEING SAID. No live takeover, and the gate shut.
 *   6. ON THE MAP TAB. The arena sits in the alert band over the map.
 *   7. THE DOCK IS `dense`, COLLAPSED. Parked in range lands on `dense` unless
 *      the ladder has something more important to say -- offline, GPS weak,
 *      muted, syncing, an abuse zone -- and every one of those is a state the
 *      toy should stay off. Nothing is lost by asking for `dense` only.
 *   8. MOTION IS NOT REDUCED. A game with no motion is not a game, and
 *      `global.css` forbids decoration from claiming `essential`. Not offered.
 *
 * PORTRAIT ONLY, by construction rather than by a clause: `ShellDock`'s
 * landscape branch renders `LandscapeChrome` and injects nothing.
 *
 * `isOfferable` is pure so the table test can flip each clause alone;
 * `useArcadeOffer` is the same function fed from the stores.
 */

import { useSyncExternalStore } from 'react';

import type { DockAnyStateId, DockPane } from '../dock/dockState.ts';
import type { DockDerived } from '../dock/useDockState.ts';
import { MIN_MOVING_MPH } from '../drive/eta.ts';
import {
  useIsAlertTakeoverActive,
  useIsStationary,
  useShouldAlertUser,
  useSuppressionReasons,
} from '../../stores/alert.ts';
import { useNearestCamera } from '../../stores/cameras.ts';
import { useScreen } from '../../stores/navigation.ts';
import type { ScreenId } from '../../stores/navigation.ts';
import { useSpeedMph } from '../../stores/position.ts';

export { MIN_MOVING_MPH };

/** The one screen the game is offered on. `DOCK_TABS` maps the Map tab here. */
export const ARCADE_SCREEN: ScreenId = 'radar';

/** The one dock state that draws the key. */
export const ARCADE_DOCK_STATE: DockAnyStateId = 'dense';

export interface OfferInput {
  readonly stationary: boolean;
  readonly speedMph: number | null;
  readonly inRange: boolean;
  readonly accuracyGated: boolean;
  readonly takeoverActive: boolean;
  readonly shouldAlertUser: boolean;
  readonly screen: ScreenId;
  readonly pane: DockPane;
  readonly state: DockAnyStateId;
  readonly motionReduced: boolean;
}

/** Slow enough by the fix. Null is unknown, and unknown is not parked. */
export function slowByFix(speedMph: number | null): boolean {
  return speedMph !== null && Number.isFinite(speedMph) && speedMph < MIN_MOVING_MPH;
}

export function isOfferable(input: OfferInput): boolean {
  return (
    input.stationary &&
    slowByFix(input.speedMph) &&
    input.inRange &&
    !input.accuracyGated &&
    !input.takeoverActive &&
    !input.shouldAlertUser &&
    input.screen === ARCADE_SCREEN &&
    input.pane === 'collapsed' &&
    input.state === ARCADE_DOCK_STATE &&
    !input.motionReduced
  );
}

/* ------------------------------------------------------------------------ *
 * REDUCED MOTION
 * ------------------------------------------------------------------------ */

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** Whether the device has asked for less motion. `PixelSweep.tsx` reads it the same way. */
export function motionReduced(): boolean {
  return globalThis.matchMedia?.(REDUCE_QUERY).matches === true;
}

function subscribeMotion(onChange: () => void): () => void {
  const list = globalThis.matchMedia?.(REDUCE_QUERY);
  if (list === undefined || typeof list.addEventListener !== 'function') return () => {};
  list.addEventListener('change', onChange);
  return () => {
    list.removeEventListener('change', onChange);
  };
}

/** The same question, live: flips when the setting does. */
export function useMotionReduced(): boolean {
  return useSyncExternalStore(subscribeMotion, motionReduced, motionReduced);
}

/* ------------------------------------------------------------------------ *
 * THE HOOK
 * ------------------------------------------------------------------------ */

/** `isOfferable`, fed from the stores, for the dock's derived pane. */
export function useArcadeOffer(derived: DockDerived): boolean {
  const stationary = useIsStationary();
  const speedMph = useSpeedMph();
  const nearest = useNearestCamera();
  const reasons = useSuppressionReasons();
  const takeoverActive = useIsAlertTakeoverActive();
  const shouldAlertUser = useShouldAlertUser();
  const screen = useScreen();
  const reduced = useMotionReduced();

  return isOfferable({
    stationary,
    speedMph,
    inRange: nearest?.inRange === true,
    accuracyGated: reasons.includes('accuracy'),
    takeoverActive,
    shouldAlertUser,
    screen,
    pane: derived.pane,
    state: derived.state,
    motionReduced: reduced,
  });
}
