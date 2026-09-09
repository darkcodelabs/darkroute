/**
 * The alert slice's tests are mostly about things that must NOT happen while
 * muted, and about the takeover putting the screen back exactly as it found it.
 *
 * Every tick in here comes from the REAL `@fwm/core` engine driven by a test
 * clock, not from a hand-written literal. A store that only ever sees invented
 * ticks proves nothing about the shipped driving loop.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { disposeScreenState, initScreenState } from '../app/screenState.ts';
import { alertActions, useAlertStore } from './alert.ts';
import { useCamerasStore } from './cameras.ts';
import { createAlertEngine, createTestClock } from './fwmCore.ts';
import type { AlertTick, CameraLike } from './fwmCore.ts';
import { useHistoryStore } from './history.ts';
import { navigationActions, useNavigationStore } from './navigation.ts';
import { useSettingsStore } from './settings.ts';
import { resetAllStores } from './index.ts';

// Two cameras 60 ft apart on the same pole run, so the drive ends in the
// `multiple` state ("2+ in range · 2-pulse haptic", Design System § alert states).
const CAMERA_A: CameraLike = { id: 'FWM-0442', lat: 39.11, lon: -84.5786, directionDeg: 180 };
const CAMERA_B: CameraLike = { id: 'FWM-0443', lat: 39.1101, lon: -84.5788, directionDeg: 180 };
const CAMERAS: readonly CameraLike[] = [CAMERA_A, CAMERA_B];

/**
 * Northbound on one longitude. The first five samples close from ~3600 ft to
 * ~255 ft - near enough for `multiple`, still OUTSIDE the 150 ft re-alert
 * distance, so a mute is a real silence.
 */
const APPROACH_LATS = [39.1, 39.105, 39.1077, 39.1085, 39.1093];
/** The same drive continued to ~109 ft and ~36 ft, inside the pierce. */
const PIERCE_LATS = [...APPROACH_LATS, 39.1097, 39.1099];
const START_MS = 1_000_000;
const STEP_MS = 2_000;
/** ~47 mph, the SPEED tile's own number. Well above the drive-mode floor. */
const SPEED_MPS = 21;

interface DriveOptions {
  /** Mute the ENGINE too, the way the real wiring does. */
  readonly muteEngine?: boolean;
  readonly lats?: readonly number[];
}

function driveTicks(options: DriveOptions = {}): AlertTick[] {
  const clock = createTestClock(START_MS);
  const engine = createAlertEngine({ clock });
  if (options.muteEngine === true) engine.muteAll();
  return (options.lats ?? APPROACH_LATS).map((lat) => {
    const tick = engine.update(
      {
        lat,
        lon: -84.5786,
        headingDeg: 0,
        speedMps: SPEED_MPS,
        accuracyM: 4,
        timestampMs: clock.now(),
      },
      CAMERAS,
    );
    clock.advance(STEP_MS);
    return tick;
  });
}

interface RunResult {
  readonly states: readonly string[];
  readonly changed: readonly boolean[];
  readonly countsInRange: readonly number[];
  readonly historyStates: readonly string[];
  readonly historyLength: number;
  readonly exposurePasses: number;
  readonly delivered: number;
  readonly haptics: readonly number[];
  readonly takeoverEverActive: boolean;
}

function run(ticks: readonly AlertTick[]): RunResult {
  const states: string[] = [];
  const changed: boolean[] = [];
  const countsInRange: number[] = [];
  const haptics: number[] = [];
  let takeoverEverActive = false;

  for (const tick of ticks) {
    alertActions.ingest(tick, { labelFor: () => 'Reading Rd', speedMph: 47 });
    const alert = useAlertStore.getState();
    states.push(alert.state);
    changed.push(tick.changed);
    countsInRange.push(useCamerasStore.getState().countInRange);
    haptics.push(alert.hapticPulses);
    if (alert.takeover.active) takeoverEverActive = true;
  }

  const history = useHistoryStore.getState();
  return {
    states,
    changed,
    countsInRange,
    historyStates: history.entries.map((entry) => entry.state),
    historyLength: history.entries.length,
    exposurePasses: history.today.passes,
    delivered: useAlertStore.getState().delivered,
    haptics,
    takeoverEverActive,
  };
}

beforeEach(async () => {
  await useSettingsStore.persist.rehydrate();
  disposeScreenState();
  initScreenState({ initialScreen: 'radar' });
  resetAllStores();
});

afterEach(() => {
  disposeScreenState();
});

describe('muting removes the alert, never the record', () => {
  it('produces an identical record muted and unmuted', () => {
    const loud = run(driveTicks());

    resetAllStores();
    useSettingsStore.getState().muteAll(START_MS - 1, 600_000);
    const silent = run(driveTicks({ muteEngine: true }));

    // THE RECORD - byte-for-byte the same.
    expect(silent.states).toEqual(loud.states);
    expect(silent.changed).toEqual(loud.changed);
    expect(silent.countsInRange).toEqual(loud.countsInRange);
    expect(silent.historyStates).toEqual(loud.historyStates);
    expect(silent.historyLength).toBe(loud.historyLength);
    expect(silent.exposurePasses).toBe(loud.exposurePasses);
    expect(silent.historyLength).toBeGreaterThan(0);
    expect(silent.exposurePasses).toBeGreaterThan(0);

    // THE DELIVERY - nothing at all.
    expect(loud.delivered).toBeGreaterThan(0);
    expect(loud.takeoverEverActive).toBe(true);
    expect(silent.delivered).toBe(0);
    expect(silent.takeoverEverActive).toBe(false);
    expect(silent.haptics.every((pulses) => pulses === 0)).toBe(true);
  });

  it('marks the muted rows as muted without dropping them', () => {
    useSettingsStore.getState().muteAll(START_MS - 1, 600_000);
    run(driveTicks({ muteEngine: true }));
    const entries = useHistoryStore.getState().entries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.muted)).toBe(true);
  });

  it('keeps muted cameras in the in-range count', () => {
    useSettingsStore.getState().muteCamera('FWM-0442', START_MS - 1, 600_000);
    run(driveTicks());
    expect(useCamerasStore.getState().countInRange).toBe(2);
    expect(useCamerasStore.getState().assessments.length).toBe(2);
  });

  it('never lets the engine and the mute config disagree in the driver’s favour', () => {
    // The engine is NOT muted; the settings slice is. The gate must still shut,
    // and the disagreement must be counted rather than resolved silently.
    useSettingsStore.getState().muteAll(START_MS - 1, 600_000);
    const result = run(driveTicks());
    expect(result.delivered).toBe(0);
    expect(useAlertStore.getState().muteOverrides).toBeGreaterThan(0);
  });

  it('records no override when the engine and the settings agree', () => {
    useSettingsStore.getState().muteAll(START_MS - 1, 600_000);
    run(driveTicks({ muteEngine: true }));
    expect(useAlertStore.getState().muteOverrides).toBe(0);
  });

  it('RE-ALERTS THROUGH a mute inside 150 ft, because the design says to', () => {
    // "RE-ALERT ON MUTED IF closer than 150 ft" - Screens II, B4.
    useSettingsStore.getState().muteAll(START_MS - 1, 600_000);
    const result = run(driveTicks({ muteEngine: true, lats: PIERCE_LATS }));

    expect(result.delivered).toBeGreaterThan(0);
    expect(result.takeoverEverActive).toBe(true);
    expect(useAlertStore.getState().mutePierced).toBe(true);
    // Still a mute, still recorded as one - the pierce is an exception to the
    // silence, not to the record.
    expect(useAlertStore.getState().muted).toBe(true);
    expect(useHistoryStore.getState().entries.every((entry) => entry.muted)).toBe(true);
    // And it is not counted as an engine/settings disagreement.
    expect(useAlertStore.getState().muteOverrides).toBe(0);
  });

  it('stays silent while muted as long as the camera is outside the re-alert distance', () => {
    useSettingsStore.getState().muteAll(START_MS - 1, 600_000);
    run(driveTicks({ muteEngine: true }));
    expect(useAlertStore.getState().mutePierced).toBe(false);
    expect(useAlertStore.getState().shouldAlertUser).toBe(false);
    expect(useAlertStore.getState().delivered).toBe(0);
  });
});

describe('the gate', () => {
  it('stays open across the engine’s notification cooldown', () => {
    const ticks = driveTicks({ lats: PIERCE_LATS });
    // The last three ticks are all `multiple`; only the first of them fires.
    const tail = ticks.slice(-3);
    expect(tail.map((tick) => tick.state)).toEqual(['multiple', 'multiple', 'multiple']);
    expect(tail.map((tick) => tick.shouldAlertUser)).toEqual([true, false, false]);

    for (const tick of ticks) alertActions.ingest(tick);

    // A live camera in range is a live alert, cooldown or not: the takeover
    // must not flicker off between buzzes.
    expect(useAlertStore.getState().shouldAlertUser).toBe(true);
    expect(useAlertStore.getState().takeover.active).toBe(true);
    // ...but the transient channel is quiet on the cooled-down ticks.
    expect(useAlertStore.getState().hapticPulses).toBe(0);
  });

  it('shuts when the driver dismisses, and opens again for the next camera', () => {
    const ticks = driveTicks();
    for (const tick of ticks) alertActions.ingest(tick);
    expect(useAlertStore.getState().shouldAlertUser).toBe(true);

    alertActions.dismiss();
    expect(useAlertStore.getState().shouldAlertUser).toBe(false);
    expect(useAlertStore.getState().takeover.active).toBe(false);

    // Same episode: dismissed stays dismissed.
    alertActions.ingest(ticks[ticks.length - 1]!);
    expect(useAlertStore.getState().shouldAlertUser).toBe(false);

    // A new episode: back to clear, then in range again.
    const nextDrive = driveTicks();
    for (const tick of nextDrive) alertActions.ingest(tick);
    expect(useAlertStore.getState().shouldAlertUser).toBe(true);
  });

  it('shuts the moment a mute lands mid-alert and opens again on unmute', () => {
    const ticks = driveTicks();
    for (const tick of ticks) alertActions.ingest(tick);
    const liveMs = ticks[ticks.length - 1]!.timestampMs;
    expect(useAlertStore.getState().shouldAlertUser).toBe(true);

    alertActions.muteAll(liveMs, 600_000);
    expect(useAlertStore.getState().shouldAlertUser).toBe(false);
    expect(useAlertStore.getState().hapticPulses).toBe(0);
    expect(useAlertStore.getState().takeover.active).toBe(false);
    // The record is untouched.
    expect(useAlertStore.getState().state).toBe('multiple');
    expect(useCamerasStore.getState().countInRange).toBe(2);

    alertActions.unmuteAll(liveMs + 1);
    expect(useAlertStore.getState().shouldAlertUser).toBe(true);
    expect(useAlertStore.getState().takeover.active).toBe(true);
  });

  it('is the only thing that authorises a haptic', () => {
    const ticks = driveTicks();
    // Feed the whole approach; the last tick is the one that fires.
    for (const tick of ticks) alertActions.ingest(tick);
    expect(useAlertStore.getState().shouldAlertUser).toBe(true);
    expect(useAlertStore.getState().hapticPulses).toBe(2);

    alertActions.dismiss();
    expect(useAlertStore.getState().hapticPulses).toBe(0);
  });
});

describe('alert takeover', () => {
  it('saves the interrupted sheet and restores it when the alert clears', () => {
    navigationActions.openScreen('sweep');
    navigationActions.openOverlay({ id: 'report', kind: 'sheet' });
    expect(useNavigationStore.getState().presentation).toBe('overlay');
    expect(useNavigationStore.getState().topOverlay?.id).toBe('report');

    const ticks = driveTicks();
    for (const tick of ticks) alertActions.ingest(tick);

    // 1 · LIVE CAMERA ALERT - it wins the screen, and the sheet is held aside.
    const takeover = useAlertStore.getState().takeover;
    expect(takeover.active).toBe(true);
    expect(takeover.interruptedScreen).toBe('sweep');
    expect(takeover.interruptedOverlays).toBe(1);
    expect(useNavigationStore.getState().presentation).toBe('camera-alert');
    expect(useNavigationStore.getState().topOverlay).toBeNull();
    expect(useNavigationStore.getState().savedOverlays.map((o) => o.id)).toEqual(['report']);

    alertActions.dismiss();

    // 2 · the sheet comes back, on the screen the driver was already on.
    expect(useNavigationStore.getState().presentation).toBe('overlay');
    expect(useNavigationStore.getState().topOverlay?.id).toBe('report');
    expect(useNavigationStore.getState().screen).toBe('sweep');
    expect(useAlertStore.getState().takeover).toEqual({
      active: false,
      cameraId: null,
      state: 'clear',
      sinceMs: null,
      interruptedScreen: null,
      interruptedOverlays: 0,
    });
  });

  it('does not lose a sheet opened DURING the alert', () => {
    navigationActions.openOverlay({ id: 'report', kind: 'sheet' });
    for (const tick of driveTicks()) alertActions.ingest(tick);
    expect(useAlertStore.getState().takeover.active).toBe(true);

    navigationActions.openOverlay({ id: 'intel', kind: 'modal' });
    alertActions.dismiss();

    // What was interrupted comes back UNDER what the driver opened since.
    expect(useNavigationStore.getState().overlays.map((o) => o.id)).toEqual(['report', 'intel']);
  });

  it('does not overwrite the saved stack when a second camera escalates it', () => {
    navigationActions.openOverlay({ id: 'report', kind: 'sheet' });
    const ticks = driveTicks();
    for (const tick of ticks) alertActions.ingest(tick);
    // The state escalated in_range -> multiple inside one live takeover.
    expect(useAlertStore.getState().takeover.state).toBe('multiple');
    expect(useNavigationStore.getState().savedOverlays.map((o) => o.id)).toEqual(['report']);
    alertActions.dismiss();
    expect(useNavigationStore.getState().topOverlay?.id).toBe('report');
  });

  it('restores the interrupted stack when the slice is reset', () => {
    navigationActions.openOverlay({ id: 'report', kind: 'sheet' });
    for (const tick of driveTicks()) alertActions.ingest(tick);
    expect(useNavigationStore.getState().topOverlay).toBeNull();
    alertActions.reset();
    expect(useNavigationStore.getState().topOverlay?.id).toBe('report');
  });
});

describe('what the slice caches', () => {
  it('mirrors the engine’s own numbers rather than recomputing them', () => {
    const ticks = driveTicks();
    const last = ticks[ticks.length - 1]!;
    for (const tick of ticks) alertActions.ingest(tick);
    const alert = useAlertStore.getState();
    expect(alert.state).toBe(last.state);
    expect(alert.effectiveThresholdFt).toBe(last.effectiveThresholdFt);
    expect(alert.isClosing).toBe(last.isClosing);
    expect(alert.stationary).toBe(last.stationary);
    expect(alert.ticks).toBe(ticks.length);
    expect(useCamerasStore.getState().nearest).toBe(last.nearest);
  });
});

/**
 * EVERY CAMERA THAT COMES INTO RANGE, not just the nearest one.
 *
 * The log recorded ONE camera per tick -- `nearestId` -- so driving through a
 * cluster wrote a single entry. `tick.cameras` carried them all and
 * `tick.countInRange` counted them all; only the log threw them away.
 *
 * The fixture is two cameras 60ft apart on the same pole run, which is exactly
 * the case that was being lost: both come into range, one is nearest.
 */
describe('a pass is per camera', () => {
  function passIdsAfterDrive(): string[] {
    for (const tick of driveTicks({ lats: PIERCE_LATS })) {
      alertActions.ingest(tick, { labelFor: () => 'Reading Rd', speedMph: 47 });
    }
    return useHistoryStore
      .getState()
      .entries.filter(
        (entry) =>
          entry.cameraId !== null &&
          entry.state === 'in_range' &&
          entry.previousState === 'clear',
      )
      .map((entry) => entry.cameraId as string);
  }

  it('LOGS BOTH CAMERAS, which is the whole bug', () => {
    // Before this fix the second camera never appeared: it was never the
    // nearest on a tick where the SCREEN state also changed.
    expect(new Set(passIdsAfterDrive())).toEqual(new Set(['FWM-0442', 'FWM-0443']));
  });

  it('records each camera EXACTLY ONCE, not once per tick it stays in range', () => {
    // The membership diff is the guard. Without it a camera in range for six
    // ticks would be six passes and EXPOSURE would read six times too high.
    const ids = passIdsAfterDrive();
    for (const id of new Set(ids)) {
      expect(ids.filter((seen) => seen === id)).toHaveLength(1);
    }
  });

  it('does not double-record the nearest across the two write paths', () => {
    // The per-camera loop and the screen-state record can both be about the
    // same camera on the same tick. Only one of them may write it.
    const ids = passIdsAfterDrive();
    expect(ids).toHaveLength(new Set(ids).size);
  });
});
