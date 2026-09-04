/**
 * DELIVERY - the wire from the gate to the driver's hands.
 *
 * =============================================================================
 * WHAT WAS MISSING
 * =============================================================================
 * `packages/core` decides three delivery facts on every tick - `shouldAlertUser`
 * (the gate), `hapticPulses` (0/1/2) and `notifyCameraIds`. `stores/alert.ts`
 * re-evaluates them against the mute and publishes them. Two adapters exist to
 * act on them: `adapters/vibration.ts`, with its camera-only guard and its
 * pattern table read off the design, and `adapters/notifications.ts`, with its
 * channel table and its composer.
 *
 * Nothing joined the two halves. `vibration.buzz()` and `notifications.show()`
 * had ZERO production callers - complete, tested, imported by nothing - so the
 * only thing an alert did was change some pixels. That is a driving alerter
 * that requires the driver to be looking at the screen, which is the one thing
 * a driving alerter must not be. The Vibration toggle in SETTINGS controlled
 * nothing at all.
 *
 * This file is that join, and it is deliberately only that.
 *
 * =============================================================================
 * IT DECIDES NOTHING
 * =============================================================================
 * No threshold, no cooldown, no mute logic, no state machine. It reads the
 * three published fields and calls two adapters. If a rule ever appears here
 * there will be two answers to "is this an alert" and they will drift - the
 * same reasoning `engineLoop.ts` states for itself.
 *
 * In particular the per-camera COOLDOWN is already applied upstream:
 * `shouldAlertUser` is `cooled.length > 0`, so it is an EDGE, not a level, and
 * firing on every tick that publishes it is correct rather than repetitive.
 *
 * =============================================================================
 * WHY A STORE SUBSCRIPTION
 * =============================================================================
 * Same reason as the alert loop and the camera sync: a camera coming into
 * range does not arrive through a component tree, and delivery must outlive
 * whatever screen is mounted. A hook would stop buzzing the moment RADAR
 * unmounted, which is exactly when a driver is least able to look.
 *
 * =============================================================================
 * WHAT IS STILL NOT WIRED, AND WHY IT IS NOT HERE
 * =============================================================================
 * SOUND. There is no audio adapter in this codebase and no `speechSynthesis`
 * reference anywhere in `src`. The SETTINGS "Audio" toggle therefore still
 * controls nothing, and this file does not pretend otherwise by, say, routing
 * it to the notification channel - an OS notification makes its own sound on
 * its own rules, which is not the same promise. Building a real audio cue is
 * its own piece of work with its own iOS gesture problem.
 */

import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { coarseDirection } from '../../features/radar/format.ts';
import { CAMERA_ALERT_TAG } from '../adapters/notifications.ts';
import { capabilityEnabled } from '../../stores/settings.ts';
import type { AdapterSet } from '../adapters/set.ts';
import { createPlatformAdapters } from '../adapters/set.ts';

export interface AlertDeliveryOptions {
  /** Injected in tests. The app builds its own. */
  readonly adapters?: AdapterSet;
}

export interface AlertDelivery {
  stop(): void;
}

export function createAlertDelivery(options: AlertDeliveryOptions = {}): AlertDelivery {
  const adapters = options.adapters ?? createPlatformAdapters();
  const { vibration, notifications } = adapters;

  /**
   * NO PERMISSION CHECK LIVES HERE, and that is the correct layering rather
   * than an omission.
   *
   * `notifications.show()` already refuses with `outcome: 'blocked'` when the
   * permission is anything but `granted`, and it does so WITHOUT PROMPTING -
   * only `request()` prompts, and this file never calls it. A dialog raised by
   * a camera coming into range is a dialog raised while driving, at the moment
   * the driver can least deal with it; ONBOARDING and SETTINGS ask, in the
   * calm, and this only ever spends what they granted.
   *
   * Re-deriving "may I" here would be a second copy of a rule the adapter
   * already enforces, and the copy is the one that goes stale.
   */
  notifications.start();

  /**
   * THE TOGGLE IS THE ADAPTER'S RUNNING FLAG, not a branch at the call site.
   *
   * `buzz()` already refuses with "haptics are switched off in settings" when
   * the adapter is not running, so honouring the preference means starting and
   * stopping the adapter and letting its own guard do the rest. A second check
   * here would be a second place for the answer to live.
   */
  const applyVibrationSetting = (on: boolean): void => {
    if (on) vibration.start();
    else vibration.stop();
  };
  applyVibrationSetting(useSettingsStore.getState().vibration);

  const unsubSettings = useSettingsStore.subscribe((state, previous) => {
    if (state.vibration !== previous.vibration) applyVibrationSetting(state.vibration);
  });

  /**
   * The last tick we delivered for.
   *
   * The store publishes on every ingest, including ones that change nothing
   * about delivery. `delivered` is bumped by the slice for exactly this
   * purpose, so a re-render or an unrelated field change cannot re-buzz.
   */
  let lastDelivered = useAlertStore.getState().delivered;

  const unsubAlert = useAlertStore.subscribe((state) => {
    if (state.delivered === lastDelivered) return;
    lastDelivered = state.delivered;

    // THE GATE, and nothing else. Mute, accuracy, stationarity and cooldown
    // have all already been spent by the time this is true.
    if (!state.shouldAlertUser) return;

    if (state.hapticPulses > 0) {
      // `source` is a constant, not a parameter. `assertCameraAlertOnly`
      // throws for every other value, and this is the only caller that is
      // entitled to pass it.
      vibration.buzz({ source: 'camera-alert', state: state.state });
    }

    if (state.notifyCameraIds.length === 0) return;

    /*
     * THE DRIVER'S OWN SWITCH. Checked here, not at `start()`, because the
     * switch can be thrown mid-drive and the delivery loop is already running
     * by then - gating the subscription would honour it only until the next
     * launch.
     *
     * The HAPTIC above is deliberately outside this guard. Turning off
     * notifications means "stop putting things on my lock screen", not "stop
     * warning me"; the buzz is the warning and it has its own switch in
     * settings. Folding the two together would silently disarm the product for
     * anyone who only wanted a quieter notification shade.
     */
    if (!capabilityEnabled('notifications')) return;

    void notifications.show({
      kind: 'camera-alert',
      state: state.state,
      // The engine's own cached distance. Never recomputed here -- a second
      // measurement would let the notification disagree with the screen.
      distanceFt: state.nearestDistanceFt ?? 0,
      // A BEARING PHRASE, never a street and never a coordinate. This string
      // goes to the operating system, which puts it on a lock screen.
      //
      // Read from the CAMERAS store rather than the alert slice, which keeps
      // only the nearest camera's id and distance. Same tick either way: both
      // slices are written from one `ingest`.
      bearingLabel:
        coarseDirection(useCamerasStore.getState().nearest?.relativeDirection ?? null) ?? '',
      inRangeCount: state.notifyCameraIds.length,
    });
  });

  return {
    stop(): void {
      unsubAlert();
      unsubSettings();
      vibration.stop();
      notifications.stop();
      // Take down anything still on the lock screen. A camera alert left
      // standing after the app stopped watching claims a road it is no longer
      // reading.
      void notifications.clear(CAMERA_ALERT_TAG);
    },
  };
}
