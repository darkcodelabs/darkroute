/**
 * THE SEAM BETWEEN THE TWO THINGS THAT CAN RAISE THE SEARCH PANEL, and the one
 * signal the landscape chrome yields to.
 *
 * =============================================================================
 * WHY THIS IS A MODULE AND NOT A PROP
 * =============================================================================
 * The panel has ONE host -- `features/chrome/TopBar.tsx` -- which owns the
 * query, the place book, the on-device hits and the lookup results. That is
 * deliberate and it is the brief's own rule: "If a second search component
 * exists in the codebase when you are done, the task failed."
 *
 * But it has TWO OPENERS, and they are in different subtrees of `App.tsx`:
 *
 *   PORTRAIT   the frozen bar's own field, inside `<main class="fwm-shell-screen">`
 *              -> DRIVE -> `.fwm-drive-top` -> `TopBar`.
 *   LANDSCAPE  the TOP RIGHT-RAIL BUTTON, inside `.fwm-shell-dock` ->
 *              `ShellDock` -> `LandscapeChrome` -> the right rail.
 *              Section D: "Search becomes the first right-rail button and opens
 *              the destination panel in section A4."
 *
 * Neither is an ancestor of the other. Threading an `onSearch` from the rail up
 * to `App` and back down into DRIVE would put the panel's open flag in a
 * component that mounts and unmounts on every screen change, which is the one
 * place it must not live -- the rail is on EXPOSURE and MESH and LOOKUP too.
 *
 * So the flag is a module-level subscription, refcounted, exactly the shape
 * `app/useSurface.ts` already uses for the same class of problem: one answer
 * that two unrelated subtrees have to agree about within a single frame. That
 * file is the precedent and this one adds no mechanism it did not.
 *
 * =============================================================================
 * FOCUS IS THE KEYBOARD, AND IT IS WHY `focused` IS PUBLIC
 * =============================================================================
 * "So WHILE THE FIELD HAS FOCUS: hide the tab rail AND the right rail" -- and
 * the field is in `TopBar`'s tree while both rails are in `ShellDock`'s. The
 * chrome cannot see a focus event fired three components away in a sibling, so
 * the fact is published here and the layout reads it.
 *
 * FOCUS RATHER THAN A MEASURED VIEWPORT, on purpose. `keyboard.ts` explains it
 * at length: a viewport shrinks for a soft keyboard and it also shrinks for a
 * collapsing address bar, and the pixel count that tells those apart is a
 * constant nobody has measured and the spec does not contain. Focus is a fact
 * the platform reports without a threshold.
 *
 * =============================================================================
 * RAISED IS NOT FOCUSED, AND THE DIFFERENCE IS THE WHOLE POINT
 * =============================================================================
 * "THE PANEL OPENS WITH THE KEYBOARD DOWN in both orientations. The field is
 * focusable, not focused. Most trips are somewhere the user has already been,
 * so the panel's job on open is to show those."
 *
 * Two booleans rather than one, because the panel spends its first moments
 * RAISED AND UNFOCUSED: the list of places you have driven to, at full height,
 * with no keyboard over it. One flag could not express that state, and an
 * implementation with one would have had to open the keyboard to open the
 * panel -- which is the behaviour being replaced.
 */

import { useSyncExternalStore } from 'react';

export interface SearchRaise {
  /** The panel is up. Raised by the bar's field, or by the right-rail button. */
  readonly raised: boolean;
  /**
   * The panel's field has focus, so the soft keyboard is over the layout.
   * FALSE THE MOMENT THE PANEL OPENS -- see the header.
   */
  readonly focused: boolean;
}

const DOWN: SearchRaise = Object.freeze({ raised: false, focused: false });

/*
 * THE SNAPSHOT MUST BE REFERENTIALLY STABLE BETWEEN CHANGES or
 * `useSyncExternalStore` re-renders forever. `SearchRaise` is an object, so
 * identity is not value here the way it was for `useSurface`'s string: this
 * module holds one frozen object and only ever replaces it when a field
 * actually differs. `publish` is the only writer and it is the only place that
 * comparison lives.
 */
let current: SearchRaise = DOWN;
let listeners = new Set<() => void>();

function publish(next: SearchRaise): void {
  if (next.raised === current.raised && next.focused === current.focused) return;
  current = Object.freeze(next);
  for (const listener of listeners) listener();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

function snapshot(): SearchRaise {
  return current;
}

/**
 * THE SERVER SNAPSHOT IS DOWN, and it is the only honest one: there is no
 * viewport, no field and nothing that could have been tapped. `useSurface.ts`
 * makes the same ruling in the same words for the same reason.
 */
function serverSnapshot(): SearchRaise {
  return DOWN;
}

export function useSearchRaise(): SearchRaise {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * RAISE THE PANEL, KEYBOARD DOWN. Both openers call this and neither of them
 * focuses anything: the panel opens onto history, which is what the driver
 * most often wants, and the field is one tap away for the times it is not.
 */
export function raiseSearch(): void {
  publish({ raised: true, focused: false });
}

/**
 * DISMISS, AND EVERYTHING COMES BACK. "Everything returns the instant the field
 * is dismissed." The focus flag goes with it in the same publish rather than in
 * a following one, so the rails never get a frame in which the panel is down
 * and the chrome is still yielding to a keyboard that has gone.
 */
export function dismissSearch(): void {
  publish(DOWN);
}

/**
 * THE FIELD TOOK OR LOST FOCUS.
 *
 * Taking focus also RAISES, because on a keyboard-driven surface a Tab into the
 * field is a request to search and a focused field inside a panel that is not
 * up is a state with no drawing. Losing it leaves the panel exactly where it
 * was: blurring is not dismissing, and a driver who taps a row is briefly
 * unfocused on the way to choosing it.
 */
export function setSearchFocused(focused: boolean): void {
  publish(focused ? { raised: true, focused: true } : { raised: current.raised, focused: false });
}

/**
 * Test-only. Drops the flag and its listeners so one test's open panel cannot
 * leak into the next test's first render.
 */
export function resetSearchRaiseForTests(): void {
  current = DOWN;
  listeners = new Set();
}
