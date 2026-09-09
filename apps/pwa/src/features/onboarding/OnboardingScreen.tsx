/**
 * A1 · ONBOARDING - PERMISSIONS. The first screen, and the only one that runs
 * once.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A1 · ONBOARDING - PERMISSIONS`. Every
 * string below is transcribed from that frame; the only authored copy in this
 * feature is the location-denied explanation, which the design does not draw
 * (see `components/LocationDeniedNotice.tsx`).
 *
 * =============================================================================
 * NOTHING PROMPTS ON MOUNT
 * =============================================================================
 * The mount effect does exactly two things, both of which the adapter contract
 * documents as passive and safe to call at any time:
 *
 *   probe()            synchronous feature detection. Reads globals, calls
 *                      nothing, shows nothing.
 *   readPermissions()  `navigator.permissions.query()` per adapter, which is a
 *                      READ. It cannot raise an OS dialog.
 *
 * `request()` - the one method that can put a dialog in front of the driver -
 * is reachable from exactly three places in this file, and all three are
 * `onClick` handlers: a permission card, the RETRY LOCATION button, and START
 * WATCHING. There is no timer, no effect and no store subscription that can
 * reach it. `OnboardingScreen.test.tsx` proves the mount case by counting the
 * mock adapters' `request()` calls after a render and asserting zero.
 *
 * =============================================================================
 * A DENIAL IS NOT A WALL
 * =============================================================================
 * Location is the one permission this product cannot work without: distance is
 * computed from a fix, and without a distance there is no alert. That does NOT
 * make it a gate. An OS-level denial is frequently not reversible from inside
 * the page - most browsers answer a second `getCurrentPosition()` immediately
 * with the same denial and never show the dialog again - so a screen that
 * refuses to advance until location is granted is a screen some drivers can
 * never leave.
 *
 * So START WATCHING behaves like this:
 *
 *   permission undecided  ask, from this tap. Granted (or no API at all) →
 *                         onboarding is done. Denied → stay, and render the
 *                         explanation with its retry, so the consequence is
 *                         read once before it is accepted.
 *   permission decided    finish. Granted, denied or unavailable, the driver
 *                         has already been told what each one costs and the
 *                         app opens on RADAR, which renders its own honest
 *                         no-fix state.
 *
 * The two optional permissions never block anything at all.
 *
 * =============================================================================
 * WHAT THIS SCREEN WRITES
 * =============================================================================
 *   settings.showHandle              the toggle, opt-in, default off
 *   settings.onboardingCompletedAtMs written once, which is what makes this
 *                                    screen show once
 *
 * No handle string is entered, stored or sent from here - the toggle records a
 * preference and nothing else. No coordinate is read: this screen asks for
 * permission to read one later and never starts the watch itself.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ComponentType, ReactElement } from 'react';

import { openScreen } from '../../app/screenState.ts';
import { markOnboardedLocally } from '../../app/firstRun.ts';
import { createPlatformAdapters } from '../../services/adapters';
import type { AdapterSet } from '../../services/adapters';
import {
  capabilitiesActions,
  useCapabilityStatus,
  usePermission,
  useSettingsStore,
  useShowHandle,
} from '../../stores/index.ts';
import type { AdapterName, RequestOutcome } from '../../stores/index.ts';

import { statusWordFor } from './components/PermissionCard.tsx';
import { OnboardingView } from './components/OnboardingView.tsx';
import type { OnboardingViewModel, OnboardingViewProps } from './components/OnboardingView.tsx';
import './onboarding.css';

export interface OnboardingScreenProps {
  /**
   * The platform adapters. Defaults to the real set, which is inert until
   * something calls it - constructing an adapter touches no browser API.
   */
  readonly adapters?: AdapterSet;
  /**
   * Called after the completion flag is written. Defaults to replacing this
   * entry with RADAR, so Android back does not walk into onboarding again.
   */
  readonly onComplete?: () => void;
  /** Injectable clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * WHICH VIEW DRAWS THE MODEL.
   *
   * v1 redraws this screen. The refusal trap in `start()` below is the single
   * most consequential piece of logic in the first-run flow, so there is one
   * copy of it and the redesign is a second VIEW. Defaults to v0's.
   */
  readonly view?: ComponentType<OnboardingViewProps> | undefined;
}

export function OnboardingScreen({
  adapters: adaptersProp,
  onComplete,
  now,
  view: View = OnboardingView,
}: OnboardingScreenProps = {}): ReactElement {
  // Built once. A new set per render would re-probe on every state change and
  // throw away the capability answers between them.
  const adapters = useMemo(() => adaptersProp ?? createPlatformAdapters(), [adaptersProp]);

  // Callback props behind refs, so the mount effect can depend on `adapters`
  // alone. An inline `now={() => …}` from a caller changes identity every
  // render; if the effect depended on it, probing would re-run on every state
  // update it caused, forever.
  const clockRef = useRef<() => number>(now ?? Date.now);
  const onCompleteRef = useRef<(() => void) | undefined>(onComplete);
  useEffect(() => {
    clockRef.current = now ?? Date.now;
    onCompleteRef.current = onComplete;
  });

  // Onboarding completes once per install. The flag in settings is what makes
  // that true across launches; this ref makes it true across a double-tap,
  // where two clicks can land before the screen is replaced.
  const completedRef = useRef(false);

  // --- passive platform read ------------------------------------------------
  // PROMPTS NOTHING. See the header. Both calls are documented as safe on load
  // in `services/adapters/types.ts` and `stores/capabilities.ts`.
  useEffect(() => {
    capabilitiesActions.probe(adapters, clockRef.current());
    void capabilitiesActions.readPermissions(adapters);
  }, [adapters]);

  const locationPermission = usePermission('geolocation');
  const notificationsPermission = usePermission('notifications');
  const motionPermission = usePermission('motion');
  const locationCapability = useCapabilityStatus('geolocation');
  const notificationsCapability = useCapabilityStatus('notifications');
  const motionCapability = useCapabilityStatus('motion');
  const showHandle = useShowHandle();

  /** THE ONLY DOOR TO AN OS PROMPT. Every caller is an onClick handler. */
  const request = useCallback(
    (name: AdapterName): Promise<RequestOutcome> => capabilitiesActions.request(adapters, name),
    [adapters],
  );

  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    useSettingsStore.getState().completeOnboarding(clockRef.current());
    // Written synchronously as well. The store's record goes to IndexedDB
    // asynchronously and can lose a race with a reload or with another tab; a
    // driver who has pressed START WATCHING must never be sent back here. See
    // `markOnboardedLocally`.
    markOnboardedLocally();
    const done = onCompleteRef.current;
    if (done === undefined) {
      openScreen('radar', { replace: true });
      return;
    }
    done();
  }, []);

  const requestLocation = useCallback(() => {
    void request('geolocation');
  }, [request]);

  const requestNotifications = useCallback(() => {
    void request('notifications');
  }, [request]);

  const requestMotion = useCallback(() => {
    void request('motion');
  }, [request]);

  /**
   * Whether a refusal has already stopped this screen once.
   *
   * A ref, not state: it must not re-render anything, and it must survive the
   * re-render that the permission change causes.
   */
  const refusedOnce = useRef(false);

  /**
   * START WATCHING.
   *
   * =========================================================================
   * THE TRAP THIS FIXES
   * =========================================================================
   * The rule was "only an actual refusal is worth stopping for, AND ONLY
   * ONCE" -- and nothing implemented the second half. `if (outcome !==
   * 'denied') complete()` stops on every refusal, forever, and it stops
   * SILENTLY: the press does nothing at all.
   *
   * That is the refresh loop. A driver who dismisses the OS prompt, or whose
   * browser answers `denied` for a permission that is really still unset,
   * presses the only button on the screen and watches nothing happen.
   * Refreshing lands on `?screen=onboarding` again, because they never
   * completed and the gate is right to hold them there. The gate was never the
   * bug; this button was.
   *
   * It is also the one case where a denial is most likely to be wrong: a
   * dismissed prompt and a real "no" are indistinguishable from here on some
   * engines.
   *
   * So: the FIRST refusal stops, once, and the card plus
   * `LocationDeniedNotice` say why. Any press after that goes through.
   * Location is required for RADAR to do anything, and RADAR already handles
   * having no fix -- being stuck on a screen you cannot leave is worse than
   * arriving somewhere that says it needs a permission you have not given.
   */
  const start = useCallback(() => {
    if (locationPermission === 'prompt' || locationPermission === 'unknown') {
      void (async () => {
        const outcome = await request('geolocation');
        // `unavailable` finishes too: a phone with no geolocation API has
        // nothing to grant, and the card already says UNAVAILABLE.
        if (outcome !== 'denied' || refusedOnce.current) {
          complete();
          return;
        }
        refusedOnce.current = true;
      })();
      return;
    }
    complete();
  }, [locationPermission, request, complete]);

  const locationDenied =
    statusWordFor('required', locationPermission, locationCapability) === 'DENIED';

  const model: OnboardingViewModel = {
    location: { permission: locationPermission, capability: locationCapability },
    notifications: { permission: notificationsPermission, capability: notificationsCapability },
    motion: { permission: motionPermission, capability: motionCapability },
    locationDenied,
    showHandle,
  };

  return (
    <View
      model={model}
      onRequestLocation={requestLocation}
      onRequestNotifications={requestNotifications}
      onRequestMotion={requestMotion}
      onShowHandleChange={(next) => {
        useSettingsStore.getState().setShowHandle(next);
      }}
      onStart={start}
    />
  );
}
