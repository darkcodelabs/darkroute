/**
 * KEEP THE SCREEN ON WHILE RADAR IS FOREGROUND - and only then.
 *
 *   "wake lock while RADAR is foreground"
 * - Flockys Design System.dc.html, section 06, PLATFORM BEHAVIOUR
 *
 * A driver does not touch the phone for twenty minutes. A phone that sleeps is
 * a phone that stops warning. But a screen held on is also the single largest
 * battery cost in the product, so this holds the lock under exactly two
 * conditions at once - RADAR is the current screen, AND the document is
 * visible - and drops it the moment either stops being true.
 *
 * WHAT IS ACTUALLY IMPLEMENTED, AND WHAT IS NOT
 *   This is the Screen Wake Lock API and nothing else. It keeps the *display*
 *   awake while the page is in front. It cannot and does not keep the app
 *   running with the screen off, in the background, or after the tab is
 *   discarded - the web platform has no such capability, and the native TWA
 *   bridge (`services/adapters/twaLocationBridge.ts`) is the only thing that
 *   does. `capability()` reports the truth on platforms without the API rather
 *   than pretending the lock was taken.
 *
 * RELEASE ON HIDE, RE-ACQUIRE ON VISIBLE
 *   The platform releases the lock whenever the document is hidden; that is
 *   not an error and cannot be prevented. This controller makes the round trip
 *   explicit instead of relying on it: `hidden` stops the adapter, `visible`
 *   starts it again if RADAR is still foreground. Explicit because it is the
 *   behaviour a test can prove.
 */

import { createVisibilityAdapter } from '../adapters/visibility.ts';
import { createWakeLockAdapter } from '../adapters/screenWakeLock.ts';
import type { VisibilityAdapter } from '../adapters/visibility.ts';
import type { WakeLockAdapter } from '../adapters/screenWakeLock.ts';
import type { AdapterError, Capability, Unsubscribe } from '../adapters/types.ts';

import { getScreenState, subscribe as subscribeScreen } from '../../app/screenState.ts';
import type { ScreenId } from '../../app/screenState.ts';

/** The one screen that earns a wake lock. */
export const WAKE_LOCK_SCREEN: ScreenId = 'radar';

export interface RadarWakeLockStatus {
  /** True when the controller wants the lock: RADAR foreground and visible. */
  readonly wanted: boolean;
  /** True when the platform reported the lock is actually held. */
  readonly held: boolean;
  /** The current foreground screen as this controller last saw it. */
  readonly screen: ScreenId;
  readonly visible: boolean;
  /** Platform error, verbatim from the adapter. Never contains user data. */
  readonly error: AdapterError | null;
}

export interface RadarWakeLock {
  /** Can this platform hold a screen wake lock at all? */
  capability(): Capability;
  status(): RadarWakeLockStatus;
  subscribe(fn: (status: RadarWakeLockStatus) => void): Unsubscribe;
  /**
   * Begin following the screen store and the page lifecycle.
   * Idempotent. Returns the same disposer as {@link RadarWakeLock.stop}.
   */
  start(): Unsubscribe;
  /** Release the lock and stop following. Idempotent. */
  stop(): void;
  /**
   * Report the foreground screen directly, for a caller that does not use the
   * screen store (the watch build renders one screen and has no dock).
   */
  setScreen(screen: ScreenId): void;
}

export interface RadarWakeLockDeps {
  readonly wakeLock?: WakeLockAdapter;
  readonly visibility?: VisibilityAdapter;
  /** Follow the global screen store. Off for a caller driving `setScreen()`. */
  readonly followScreenStore?: boolean;
}

export function createRadarWakeLock(deps: RadarWakeLockDeps = {}): RadarWakeLock {
  const wakeLock = deps.wakeLock ?? createWakeLockAdapter();
  const visibility = deps.visibility ?? createVisibilityAdapter();
  const followScreenStore = deps.followScreenStore !== false;

  const subscribers = new Set<(status: RadarWakeLockStatus) => void>();
  const unsubscribes: Unsubscribe[] = [];

  let running = false;
  let screen: ScreenId = getScreenState().screen;
  let visible = true;
  let held = false;

  const snapshot = (): RadarWakeLockStatus => ({
    wanted: running && screen === WAKE_LOCK_SCREEN && visible,
    held,
    screen,
    visible,
    error: wakeLock.error(),
  });

  const publish = (): void => {
    const status = snapshot();
    for (const fn of [...subscribers]) fn(status);
  };

  const reconcile = (): void => {
    const want = running && screen === WAKE_LOCK_SCREEN && visible;
    if (want) void wakeLock.start();
    else wakeLock.stop();
    publish();
  };

  return {
    capability: () => wakeLock.capability(),

    status: snapshot,

    subscribe(fn) {
      subscribers.add(fn);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        subscribers.delete(fn);
      };
    },

    start() {
      if (running) return this.stop.bind(this);
      running = true;

      unsubscribes.push(
        wakeLock.subscribe((status) => {
          held = status.held;
          publish();
        }),
      );

      visibility.start();
      visible = visibility.isVisible();
      unsubscribes.push(
        visibility.subscribe((state) => {
          const next = state.visibility === 'visible';
          if (next === visible) return;
          visible = next;
          reconcile();
        }),
      );

      if (followScreenStore) {
        screen = getScreenState().screen;
        unsubscribes.push(
          subscribeScreen(() => {
            const next = getScreenState().screen;
            if (next === screen) return;
            screen = next;
            reconcile();
          }),
        );
      }

      reconcile();
      return this.stop.bind(this);
    },

    stop() {
      if (!running) return;
      running = false;
      for (const off of unsubscribes.splice(0)) off();
      visibility.stop();
      wakeLock.stop();
      held = false;
      publish();
    },

    setScreen(next) {
      if (next === screen) return;
      screen = next;
      reconcile();
    },
  };
}
