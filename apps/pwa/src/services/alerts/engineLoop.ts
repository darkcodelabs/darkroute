/**
 * THE ALERT LOOP - the last missing wire.
 *
 * `packages/core` holds a complete alert engine: hysteresis, dedupe,
 * stationarity, mute gating, notification cooldown, the six-state machine. It
 * was built, tested to 114 passing assertions, and never driven.
 * `alertActions.ingest()` - the one call that puts an engine tick into the
 * store the screens read - appears in this codebase only inside tests.
 *
 * So the chain ran: sensors → position store → (nothing) → alert store →
 * screens. Cameras arrived from the tile sync and sat in their own store, and
 * every screen went on reporting zero because the thing that turns a fix plus a
 * camera list into "425 FT, AHEAD · SLIGHT LEFT" was never called.
 *
 * This is that call.
 *
 * WHY A STORE SUBSCRIPTION, NOT A HOOK
 *   The same reason as the camera sync and the navigation adapter: a camera
 *   coming into range does not arrive through a component tree, and the loop
 *   must outlive whatever screen is mounted. It also must not re-run because a
 *   component re-rendered.
 *
 * WHAT DRIVES A TICK
 *   A new GPS fix, and nothing else. Not a timer - a timer would re-assert the
 *   same distance between fixes and make a stationary car look like it was
 *   being re-measured. The engine's own clock handles dwell and cooldown.
 *
 * WHAT THIS FILE MUST NOT DO
 *   Decide anything. Threshold, mutes and owner filters live in the settings
 *   store and are pushed into the engine; the state machine stays in
 *   packages/core. If a rule appears here, it is in the wrong place - there
 *   would then be two answers to "is this an alert" and they would drift.
 */

import {
  createAlertEngine,
  snapThresholdFt,
  type AlertEngine,
  type CameraLike,
  type PositionFix,
} from '../../stores/fwmCore.ts';
import { alertActions } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';

export interface AlertLoopOptions {
  /** Injected in tests. The app builds its own. */
  readonly engine?: AlertEngine;
}

export interface AlertLoop {
  /** Drive one fix by hand. Exposed for tests and for a manual re-assess. */
  tick(fix: PositionFix): void;
  stop(): void;
}

export function createAlertLoop(options: AlertLoopOptions = {}): AlertLoop {
  const settings = useSettingsStore.getState();
  const engine =
    options.engine ??
    createAlertEngine({
      thresholdFt: snapThresholdFt(settings.thresholdFt),
      reAlertWhenCloserThanFt: settings.reAlertWhenCloserThanFt,
    });

  let stopped = false;

  const tick = (fix: PositionFix): void => {
    if (stopped) return;
    // Read the cameras at tick time rather than holding a reference: the tile
    // sync writes a NEW array on every tile, and a stale closure would alert
    // against the camera set as it was when the loop started.
    const cameras = useCamerasStore.getState().cameras as readonly CameraLike[];
    try {
      /**
       * THE CONTEXT IS NOT OPTIONAL IN PRACTICE, only in the type.
       *
       * This was `ingest(engine.update(...))` with no second argument, so
       * `labelFor` and `speedMph` were never supplied and EVERY row in the
       * exposure log rendered a dash for the camera and a dash for the speed.
       * Five passes recorded, five rows, nothing on any of them - the log said
       * something happened and could not say what or where.
       *
       * `labelFor` reads the street and cross the archive already carries on
       * every record, which is the same pair the intel card prints. Nothing
       * new is fetched and no name is invented: a camera with neither field
       * still returns null and still renders a dash, honestly.
       */
      alertActions.ingest(engine.update(fix, cameras), {
        labelFor: (cameraId) => {
          const record = useCamerasStore
            .getState()
            .cameras.find((candidate) => candidate.id === cameraId);
          if (record === undefined) return null;
          const street = record.street ?? null;
          const cross = record.cross ?? null;
          if (street !== null && cross !== null) return `${street} & ${cross}`;
          return street ?? cross;
        },
        // Metres per second to mph. The fix's own speed, not a derived one:
        // the log row is a statement about the moment of the pass.
        speedMph:
          fix.speedMps === null || !Number.isFinite(fix.speedMps)
            ? null
            : Math.round(fix.speedMps * 2.236_936),
      });
    } catch {
      // The engine throws RangeError on an impossible coordinate. One bad fix
      // or one malformed camera must not take the loop down for the rest of
      // the drive - the next fix is a fresh chance, and the screens keep
      // showing the last good state rather than freezing on an error.
    }
  };

  // Threshold and re-alert distance are the driver's, and they change while the
  // loop is running - the SETTINGS slider and the watch bezel both write them.
  const unsubscribeSettings = useSettingsStore.subscribe((state) => {
    if (stopped) return;
    engine.setThresholdFt(snapThresholdFt(state.thresholdFt));
  });

  /**
   * A TICK PER FIX, not per WRITE.
   *
   * `subscribe` with no selector fires on every write to the position store -
   * a heading from the compass, a satellite count, a motion magnitude, an error
   * note - and this ran the whole engine for each of them. Compared by IDENTITY
   * for the same reason the camera subscription below is: a new object means
   * new information, and anything else is the same fix arriving again.
   *
   * Guarded here as well as at the source. `ingestMotion` no longer rebuilds
   * the fix, which was the 60 Hz case, but this subscription should not be one
   * store field away from doing it again.
   */
  let lastFix = usePositionStore.getState().fix;
  const unsubscribePosition = usePositionStore.subscribe((state) => {
    if (stopped) return;
    if (state.fix === null || state.fix === lastFix) return;
    lastFix = state.fix;
    tick(state.fix);
  });

  // A TICK IS ALSO OWED WHEN THE CAMERAS CHANGE, not only when the fix does.
  //
  // Tiles arrive asynchronously and usually AFTER the first fix. Ticking only
  // on a fix meant the first tick ran against an empty camera set, and a
  // stationary car gets no second fix - so the app sat on "no cameras loaded"
  // with 27 cameras sitting in the store beside it. That is not a test
  // artefact: a driver who gets their lock in a car park and pulls out two
  // minutes later would have hit exactly the same hole.
  //
  // Same last fix, new information about it.
  // Compared by IDENTITY, not by length. `putTiles` rebuilds the flattened
  // array on every write, so a new reference means new information - and a
  // tile REPLACED by one with the same number of different cameras is exactly
  // the case a length check misses. (It missed it; a test caught it.)
  let lastCameras = useCamerasStore.getState().cameras;
  const unsubscribeCameras = useCamerasStore.subscribe((state) => {
    if (stopped) return;
    if (state.cameras === lastCameras) return;
    lastCameras = state.cameras;
    const fix = usePositionStore.getState().fix;
    if (fix !== null) tick(fix);
  });

  // A fix may already be in the store - a warm reload, or a loop started after
  // the watch. Without this the first alert waits for the next GPS sample.
  const existing = usePositionStore.getState().fix;
  if (existing !== null) tick(existing);

  return {
    tick,
    stop(): void {
      stopped = true;
      unsubscribePosition();
      unsubscribeCameras();
      unsubscribeSettings();
    },
  };
}
