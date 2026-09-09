/**
 * THE FIRST-RUN GATE.
 *
 * `OnboardingScreen` is the only place in the app that may ask for location,
 * because a permission prompt is only legal from a user gesture and that
 * screen owns the gesture. It was built, tested, and registered - and nothing
 * ever navigated to it. A first-time driver therefore landed on RADAR, was
 * never asked for anything, and watched `NO FIX` forever.
 *
 * WHY IT WAITS FOR HYDRATION
 *   `onboardingCompletedAtMs` is persisted. Reading it before the store has
 *   rehydrated always returns `null`, which reads as "never onboarded" - so an
 *   ungated version of this hook would re-run onboarding on every cold start,
 *   which is worse than not having it.
 *
 * WHY A DEEP LINK WINS
 *   `?screen=…` is how the manifest shortcuts, the notification tap and the
 *   watch handoff all arrive. Somebody tapping "Report camera" from a launcher
 *   shortcut is not a first run even if they never finished onboarding, and
 *   redirecting them would lose the camera they stopped to report.
 *
 * WHY THE ENTRY URL IS SNAPSHOTTED
 *   `initScreenState()` REWRITES the URL as it adopts the parameter, and it
 *   drops `screen=radar` because radar is the default and the parameter would
 *   be redundant. So by the time a React effect runs, `window.location.search`
 *   no longer says whether the load carried a screen request - an ungated read
 *   there reports "no deep link" for every arrival on the default screen, and
 *   the gate hijacks it. The snapshot is taken in `main.tsx` BEFORE
 *   `initScreenState()`, which is the only moment the answer is still true.
 */

import { useEffect } from 'react';

import { useOnboardingComplete, useSettingsHydrated } from '../stores/index.ts';

import { SCREEN_PARAM, getScreenState, openScreen } from './screenState.ts';

/** True when the given query string carried an explicit screen request. */
export function hasExplicitScreenRequest(search: string): boolean {
  return new URLSearchParams(search).has(SCREEN_PARAM);
}

/**
 * The query string this document was opened with. Captured before
 * `initScreenState()` rewrites it; see the header for why that matters.
 */
let entrySearch = '';

/** Call once, from the entry point, before `initScreenState()`. */
export function captureEntrySearch(search?: string): void {
  entrySearch = search ?? globalThis.location?.search ?? '';
}

/** What was captured. Exported so a test can assert the snapshot itself. */
export function getEntrySearch(): string {
  return entrySearch;
}

/**
 * A SECOND, SYNCHRONOUS RECORD THAT ONBOARDING HAPPENED.
 *
 * The real record is `onboardingCompletedAtMs` in the settings store, persisted
 * to IndexedDB. That is the right home for it and it stays the source of truth
 * for everything except this one decision.
 *
 * It is the wrong thing to gate a REDIRECT on, for two reasons that only show
 * up on a real phone:
 *
 *   IndexedDB is asynchronous and `bootStores()` gives it a 1500 ms deadline.
 *   Past that the app carries on with defaults so it is never wedged behind
 *   storage -- and defaults say "never onboarded". A slow read therefore does
 *   not delay the gate, it FAILS it, and the driver is sent back through
 *   onboarding on a device that has completed it a dozen times.
 *
 *   Several tabs share one database. A tab that booted before onboarding
 *   finished holds `null` in memory and writes that back on its next
 *   persist, clobbering the record the other tab just wrote.
 *
 * `localStorage` has neither problem: it is synchronous, so it is readable on
 * the very first render before anything has hydrated, and a write from one tab
 * is immediately visible to the others. It holds one boolean and nothing else.
 *
 * This does not replace the store's record -- it is a fast path for one
 * decision. If the two ever disagree, EITHER saying yes means yes: sending
 * somebody through onboarding again is the harmful direction, and letting them
 * past it costs nothing because RADAR handles missing permissions on its own.
 */
const ONBOARDED_KEY = 'fwm.onboarded';

export function markOnboardedLocally(): void {
  try {
    globalThis.localStorage?.setItem(ONBOARDED_KEY, '1');
  } catch {
    // Private mode, disabled storage, a full quota: none of these are worth a
    // failure. The store's own record is still the source of truth.
  }
}

/** Forget the mirror. For tests, and for a driver who wipes their data. */
export function clearOnboardedLocally(): void {
  try {
    globalThis.localStorage?.removeItem(ONBOARDED_KEY);
  } catch {
    // Same reasoning as the write: storage being unavailable is not a failure
    // worth propagating.
  }
}

export function hasOnboardedLocally(): boolean {
  try {
    return globalThis.localStorage?.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function useFirstRunGate(): void {
  const hydrated = useSettingsHydrated();
  const onboarded = useOnboardingComplete();

  useEffect(() => {
    // THE WAY OUT, which was missing and is the actual refresh loop.
    //
    // The gate sends a first-time driver to onboarding by REWRITING THE URL to
    // `?screen=onboarding`. That URL then outlives the reason for it: on every
    // later load `initScreenState()` reads it and opens onboarding again,
    // before this hook runs and regardless of what it decides. A tab that once
    // saw onboarding could never leave it -- refresh, refresh, refresh, same
    // screen -- because the screen was no longer being chosen by the gate, it
    // was being chosen by the address bar.
    //
    // So the gate has to close in both directions: it puts you INTO onboarding
    // when you have not done it, and it takes you OUT when you have.
    if (onboarded || hasOnboardedLocally()) {
      markOnboardedLocally();
      if (getScreenState().screen === 'onboarding') {
        // `replace`, so the dead URL does not stay in the back stack either.
        openScreen('radar', { replace: true });
      }
      return;
    }
    if (!hydrated) return;
    if (hasExplicitScreenRequest(entrySearch)) return;
    // `replace`, not push: the back gesture from onboarding should leave the
    // app, not walk back to a RADAR that has no permission to show anything.
    openScreen('onboarding', { replace: true });
  }, [hydrated, onboarded]);
}
