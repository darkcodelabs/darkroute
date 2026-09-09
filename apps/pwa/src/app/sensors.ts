/**
 * THE SENSOR RUNTIME - the loop that was missing.
 *
 * Every adapter in `services/adapters` was built, tested and then never
 * started. `stores/position.ts` was built to receive fixes and nothing ever
 * handed it one. The result was an app that asked for location permission in
 * onboarding, got it, and then sat on `NO FIX / waiting for the first fix`
 * forever, on every screen, because no code anywhere called
 * `geolocation.start()`. This file is that call, and the subscription that
 * carries the fix into the store the screens already read.
 *
 * WHAT THIS FILE MAY NOT DO
 *   It must never call `request()`. A permission prompt is only legal from a
 *   user gesture, and onboarding owns that gesture - `OnboardingScreen`
 *   already counts `request()` calls in its own test and asserts zero on
 *   mount. The runtime STARTS sensors that are already permitted and reports
 *   honestly about the ones that are not. If it ever prompts, it will do so
 *   while somebody is driving.
 *
 * WHY IT IS A FACTORY AND NOT A useEffect
 *   A camera coming into range does not arrive through a component tree, and
 *   neither does a GPS fix. The runtime is plain TypeScript over the adapter
 *   interface so it can be driven by a test with `createMockAdapters()` and
 *   asserted without rendering anything. `useSensors` below is the thin React
 *   binding, and it is the only part that knows about mounting.
 *
 * WHAT IT DELIBERATELY DOES NOT DO YET
 *   Staleness. `positionActions.markStale()` exists and is documented as
 *   "driven by the loop, not a timer", and the loop that should drive it is
 *   the engine tick, not this file. Adding a timer here would put a second,
 *   invisible clock next to the engine's. Filed:
 *   docs/gaps-inbox/sensor-runtime.md#stale-fix-is-never-marked
 *
 * CLOSED: ERRORS RAISED AFTER THE WATCH IS OPEN
 *   This used to say that `error()` was a getter with no subscription, so a
 *   failure was "picked up on the next fix rather than the moment it happens".
 *   That reasoning had a hole in it, and the hole was the whole bug: a watch
 *   whose failure is that it produces NO fixes never reaches the next fix. A
 *   refusal at the OS prompt, or a timeout on a phone with location services
 *   off, was recorded on the adapter and read by nobody, and RADAR held
 *   "waiting for the first fix." forever with "location is off." unreachable
 *   one branch away.
 *
 *   `Adapter.subscribeToError` now pushes it. See `startGeolocation`.
 */

import { useEffect } from 'react';

import { createPlatformAdapters } from '../services/adapters';
import type { AdapterSet, GeoFix, Heading, MotionSample } from '../services/adapters';
import { positionActions } from '../stores/index.ts';
import { capabilityEnabled } from '../stores/settings.ts';

/** Started sensors, and how to stop them. */
export interface SensorRuntime {
  /**
   * Idempotent. Calling it twice does not open a second watch - React 18
   * StrictMode mounts every effect twice in development, and two GPS watches
   * is two radios.
   */
  start(): Promise<void>;
  stop(): void;
  /** Which sensors are actually running. For tests and for the OFFLINE screen. */
  running(): readonly string[];
}

/**
 * Map an adapter error onto the position store's vocabulary.
 *
 * The distinction that matters to the driver is between "you said no"
 * (recoverable in settings), "this phone cannot" (not recoverable at all) and
 * "no fix right now" (a tunnel). Collapsing them into one error state is how
 * an app ends up telling somebody to check their settings inside a car park.
 */
function reportGeoError(code: string, message: string): void {
  if (code === 'permission-denied') {
    positionActions.markDenied();
    return;
  }
  if (code === 'unsupported') {
    positionActions.markUnavailable(message);
    return;
  }
  // 'position-unavailable' | 'timeout' | 'watch-failed' - the watch is still
  // open and the next fix may well arrive, so the state stays 'searching' and
  // the error is recorded beside it rather than replacing it.
  positionActions.noteError({ code, message });
}

export function createSensorRuntime(adapters: AdapterSet): SensorRuntime {
  const stops: (() => void)[] = [];
  let started = false;

  const startGeolocation = async (): Promise<boolean> => {
    /*
     * THE DRIVER'S OWN SWITCH, CHECKED BEFORE THE OS GRANT.
     *
     * No web API revokes a permission, so the permission rows could only ever
     * be turned ON - and a driver who wanted the app to stop reading their
     * location had nowhere to say so except their browser's site settings.
     * `capabilitiesEnabled` is where they say it to US, and this is the half
     * that makes saying it mean something: the grant stays where it is and the
     * watch never starts.
     *
     * `markUnavailable` rather than a silent return, so the screens that ask
     * "why is there no fix" get an answer they can show. It is deliberately
     * the same channel a real absence uses: from the alert engine's point of
     * view there IS no position, and a second code path for "off on purpose"
     * would be two ways to be blind.
     */
    if (!capabilityEnabled('geolocation')) {
      positionActions.markUnavailable('location is switched off in settings');
      return false;
    }

    const capability = adapters.geolocation.capability();
    if (!capability.supported) {
      positionActions.markUnavailable(capability.reason ?? 'geolocation is not available here');
      return false;
    }

    // Passive read. `permission()` never prompts; `request()` would, and is
    // onboarding's alone.
    const permission = await adapters.geolocation.permission();
    if (permission === 'denied') {
      positionActions.markDenied();
      return false;
    }

    // 'prompt' is deliberately NOT treated as a failure: on a platform with no
    // Permissions API the passive read cannot distinguish "will prompt" from
    // "already granted", and starting the watch is the only way to find out.
    // If it does prompt, it prompts because the driver already tapped ALLOW in
    // onboarding and this is the same grant being exercised.
    positionActions.markSearching();

    const unsubscribe = adapters.geolocation.subscribe((fix: GeoFix) => {
      positionActions.ingestFix(fix);
      // Sync whatever the adapter is currently reporting alongside the fix.
      // A fix arriving is how a tunnel ends, and leaving the last timeout on
      // screen next to a live distance would be the app contradicting itself.
      positionActions.noteError(adapters.geolocation.error());
    });
    stops.push(unsubscribe);

    /*
     * A FAILURE AFTER `start()` HAS RETURNED, WHICH IS MOST OF THEM.
     *
     * `watchPosition` reports permission refusal and timeouts through its error
     * callback, asynchronously, long after `start()` resolved. The only reader
     * of `error()` used to be the fix subscription directly above -- and a
     * watch that is failing produces no fixes, so that subscription never runs
     * and the error was recorded where nothing looked.
     *
     * The visible result was RADAR holding "waiting for the first fix." for as
     * long as the app was open, with no way to reach "location is off." even
     * when the driver had refused the OS prompt outright. Reported from a
     * device, and it is the sort of thing that reads as the GPS being slow
     * rather than as an answer nobody was told about.
     *
     * `null` means the error cleared, which the fix path already handles.
     */
    const stopErrors = adapters.geolocation.subscribeToError?.((error) => {
      if (error === null) return;
      reportGeoError(error.code, error.message);
    });
    if (stopErrors !== undefined) stops.push(stopErrors);
    stops.push(() => {
      adapters.geolocation.stop();
    });

    try {
      await adapters.geolocation.start();
    } catch (cause) {
      const error = adapters.geolocation.error();
      reportGeoError(
        error?.code ?? 'watch-failed',
        error?.message ?? (cause instanceof Error ? cause.message : 'the position watch failed'),
      );
      return false;
    }

    // An adapter may fail without throwing - it reports through `error()`.
    const settled = adapters.geolocation.error();
    if (settled !== null) {
      reportGeoError(settled.code, settled.message);
      return false;
    }
    return true;
  };

  const startHeading = async (): Promise<boolean> => {
    // Compass heading is a supplement, not a requirement: `ingestFix` already
    // takes `headingDeg` from the GPS when the driver is moving, and prefers
    // it. This fills the gap at low speed, where GPS heading is null.
    if (!adapters.orientation.capability().supported) return false;
    const permission = await adapters.orientation.permission?.();
    if (permission === 'denied') return false;

    const unsubscribe = adapters.orientation.subscribe((heading: Heading) => {
      positionActions.ingestHeading(heading);
    });
    stops.push(unsubscribe);
    stops.push(() => {
      adapters.orientation.stop();
    });
    try {
      await adapters.orientation.start();
    } catch {
      return false;
    }
    return adapters.orientation.error() === null;
  };

  const startMotion = async (): Promise<boolean> => {
    // Motion is what tells the difference between parked and moving. It is
    // optional everywhere and gated behind a gesture on iOS, so a refusal here
    // is not worth surfacing - the product simply loses the parked/moving
    // distinction, which every screen already treats as unknown by default.
    // Same switch, quieter: motion's absence is already the default state
    // every screen assumes, so there is nothing to announce.
    if (!capabilityEnabled('motion')) return false;
    if (!adapters.motion.capability().supported) return false;
    const permission = await adapters.motion.permission?.();
    if (permission === 'denied') return false;

    const unsubscribe = adapters.motion.subscribe((sample: MotionSample) => {
      positionActions.ingestMotion(sample);
    });
    stops.push(unsubscribe);
    stops.push(() => {
      adapters.motion.stop();
    });
    try {
      await adapters.motion.start();
    } catch {
      return false;
    }
    return adapters.motion.error() === null;
  };

  const live: string[] = [];

  return {
    async start(): Promise<void> {
      if (started) return;
      started = true;

      // Sequential, not Promise.all: the geolocation prompt on a platform that
      // still shows one must not race two other permission reads to the front
      // of the queue. Location is the one the driver was asked for.
      if (await startGeolocation()) live.push('geolocation');
      if (await startHeading()) live.push('orientation');
      if (await startMotion()) live.push('motion');
    },

    stop(): void {
      started = false;
      live.length = 0;
      // Reverse order: unsubscribe before the adapter is stopped, so a final
      // synchronous callback cannot land in a store the app has finished with.
      for (const stop of stops.reverse()) stop();
      stops.length = 0;
    },

    running(): readonly string[] {
      return [...live];
    },
  };
}

/**
 * Start the sensors for as long as the app is mounted.
 *
 * `permissionKey` exists so that granting location in onboarding restarts the
 * runtime without a reload: the caller passes the location permission state,
 * and a change of it tears the runtime down and builds a new one. Without that
 * key, a driver who granted location on the onboarding screen would sit on
 * NO FIX until they killed the app - which is exactly the bug this file fixes,
 * one step further along.
 */
export function useSensors(permissionKey: string, adapters?: AdapterSet | null): void {
  useEffect(() => {
    // `null` is "explicitly disabled", matching how App.tsx treats the service
    // worker and the install prompt. Tests pass null because a real watch in
    // jsdom is either a crash or a lie, and neither is a test.
    if (adapters === null) return undefined;
    const runtime = createSensorRuntime(adapters ?? createPlatformAdapters());
    void runtime.start();
    return () => {
      runtime.stop();
    };
  }, [permissionKey, adapters]);
}
