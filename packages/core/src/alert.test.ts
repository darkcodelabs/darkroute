import { describe, expect, it, vi } from 'vitest';

import {
  ALERT_THRESHOLD_MAX_FT,
  ALERT_THRESHOLD_MIN_FT,
  ALERT_THRESHOLD_STEP_FT,
  APPROACHING_OUTER_FT,
  AlertEngine,
  DEFAULT_ALERT_THRESHOLD_FT,
  DEFAULT_DEDUPE_EPSILON_FT,
  DEFAULT_MUTE_DURATION_MS,
  DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT,
  DRIVE_MODE_MIN_SPEED_MPH,
  HAPTIC_PULSES_BY_STATE,
  MULTIPLE_MIN_CAMERAS,
  SWEEP_RING_FT,
  createAlertEngine,
  dedupeCameras,
  deriveAlertState,
  hapticPulsesForState,
  ringForDistanceFt,
  snapThresholdFt,
} from './alert.ts';
import type { AlertTick } from './alert.ts';
import { createTestClock } from './clock.ts';
import type { AlertState, CameraLike, PositionFix } from './types.ts';

// ---------------------------------------------------------------------------
// Test geometry
//
// The drive runs due north up the meridian the design screens print, so every
// distance below is a straight line and the numbers in the assertions are the
// numbers on the RADAR readout. DEG_PER_FT is the meridional degree-per-foot
// at this latitude; over the 1500 ft the drive covers it is accurate to
// 0.002 ft, which is four orders of magnitude finer than anything asserted.
// ---------------------------------------------------------------------------

const CAM_LAT = 39.11;
const CAM_LON = -84.5786;
const DEG_PER_FT = 2.7455156e-6;

/** 47 mph, the speed on the LOG rows in the design. */
const CRUISE_MPS = 21;

const C1: CameraLike = { id: 'FWM-1001', lat: CAM_LAT, lon: CAM_LON, directionDeg: 180 };
/** 120 ft south of C1 - outside the dedupe epsilon, so they stay two cameras. */
const C2: CameraLike = { id: 'FWM-1002', lat: CAM_LAT - 120 * DEG_PER_FT, lon: CAM_LON, directionDeg: null };

interface FixOptions {
  headingDeg?: number | null;
  speedMps?: number | null;
  accuracyM?: number | null;
  motionMagnitudeMps2?: number | null;
}

/** A fix `ft` feet due south of C1, i.e. driving north toward it. */
function fixAt(ft: number, options: FixOptions = {}): PositionFix {
  const base = {
    lat: CAM_LAT - ft * DEG_PER_FT,
    lon: CAM_LON,
    headingDeg: options.headingDeg === undefined ? 0 : options.headingDeg,
    speedMps: options.speedMps === undefined ? CRUISE_MPS : options.speedMps,
    accuracyM: options.accuracyM === undefined ? 4 : options.accuracyM,
  };
  return options.motionMagnitudeMps2 === undefined
    ? base
    : { ...base, motionMagnitudeMps2: options.motionMagnitudeMps2 };
}

function latOffsetFt(lat: number, ft: number): number {
  return lat + ft * DEG_PER_FT;
}

// ---------------------------------------------------------------------------
// Design-sourced constants
// ---------------------------------------------------------------------------

describe('design constants', () => {
  it('matches the values in the design files', () => {
    // "rings 100/300/500/1000ft" - Design System, SWEEP PRIMITIVES
    expect(SWEEP_RING_FT).toEqual([100, 300, 500, 1000]);
    // "ALERT AT / 500 / FT" with slider ends "100" and "1000" - App Screens 01
    expect(DEFAULT_ALERT_THRESHOLD_FT).toBe(500);
    expect(ALERT_THRESHOLD_MIN_FT).toBe(100);
    expect(ALERT_THRESHOLD_MAX_FT).toBe(1000);
    // "TURN BEZEL · 50 FT STEPS" - Watch W10
    expect(ALERT_THRESHOLD_STEP_FT).toBe(50);
    // "approaching · 500 - 1000 ft, closing" / "1 pulse @ 1000ft"
    expect(APPROACHING_OUTER_FT).toBe(1000);
    // "2+ in range · 2-pulse haptic"
    expect(MULTIPLE_MIN_CAMERAS).toBe(2);
    // "RE-ALERT ON MUTED IF / closer than 150 ft" - Screens II B4
    expect(DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT).toBe(150);
    // "long-press = mute 10 min"
    expect(DEFAULT_MUTE_DURATION_MS).toBe(600_000);
    // "while speed > 5 mph" - Design System, dash mode
    expect(DRIVE_MODE_MIN_SPEED_MPH).toBe(5);
  });

  it('assigns haptics per the design, and none at all when clear', () => {
    expect(HAPTIC_PULSES_BY_STATE).toEqual({ clear: 0, approaching: 1, in_range: 2, multiple: 2 });
    expect(hapticPulsesForState('clear')).toBe(0);
    expect(hapticPulsesForState('approaching')).toBe(1);
    expect(hapticPulsesForState('multiple')).toBe(2);
  });

  it('maps a distance onto the SWEEP rings', () => {
    expect(ringForDistanceFt(80)).toBe(100);
    expect(ringForDistanceFt(100)).toBe(100);
    expect(ringForDistanceFt(101)).toBe(300);
    expect(ringForDistanceFt(500)).toBe(500);
    expect(ringForDistanceFt(1000)).toBe(1000);
    expect(ringForDistanceFt(1001)).toBeNull();
  });

  it('snaps a threshold to the bezel steps and the slider bounds', () => {
    expect(snapThresholdFt(500)).toBe(500);
    expect(snapThresholdFt(524)).toBe(500);
    expect(snapThresholdFt(526)).toBe(550);
    expect(snapThresholdFt(0)).toBe(ALERT_THRESHOLD_MIN_FT);
    expect(snapThresholdFt(99_999)).toBe(ALERT_THRESHOLD_MAX_FT);
    expect(() => snapThresholdFt(Number.NaN)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// deriveAlertState
// ---------------------------------------------------------------------------

describe('deriveAlertState', () => {
  const base = { thresholdFt: 500, hysteresisFt: 50, previousState: 'clear' as AlertState };

  it('is clear when nothing is known', () => {
    expect(deriveAlertState({ ...base, nearestDistanceFt: null, cameraCountInRange: 0 })).toBe('clear');
  });

  it('walks the bands on the way in', () => {
    expect(deriveAlertState({ ...base, nearestDistanceFt: 1200, cameraCountInRange: 0 })).toBe('clear');
    expect(deriveAlertState({ ...base, nearestDistanceFt: 1000, cameraCountInRange: 0 })).toBe('approaching');
    expect(deriveAlertState({ ...base, nearestDistanceFt: 1000.001, cameraCountInRange: 0 })).toBe('clear');
    expect(deriveAlertState({ ...base, nearestDistanceFt: 501, cameraCountInRange: 0 })).toBe('approaching');
    expect(deriveAlertState({ ...base, nearestDistanceFt: 500, cameraCountInRange: 1 })).toBe('in_range');
    expect(deriveAlertState({ ...base, nearestDistanceFt: 1, cameraCountInRange: 1 })).toBe('in_range');
  });

  it('is multiple only with two or more inside', () => {
    expect(deriveAlertState({ ...base, nearestDistanceFt: 400, cameraCountInRange: 1 })).toBe('in_range');
    expect(deriveAlertState({ ...base, nearestDistanceFt: 400, cameraCountInRange: 2 })).toBe('multiple');
    expect(deriveAlertState({ ...base, nearestDistanceFt: 400, cameraCountInRange: 9 })).toBe('multiple');
    // Two cameras nearby but none inside the threshold is not `multiple`.
    expect(deriveAlertState({ ...base, nearestDistanceFt: 900, cameraCountInRange: 0 })).toBe('approaching');
  });

  it('widens the threshold only on the way out', () => {
    // Entering costs 500...
    expect(deriveAlertState({ ...base, previousState: 'clear', nearestDistanceFt: 540, cameraCountInRange: 0 })).toBe(
      'approaching',
    );
    // ...leaving costs 550.
    expect(
      deriveAlertState({ ...base, previousState: 'in_range', nearestDistanceFt: 540, cameraCountInRange: 0 }),
    ).toBe('in_range');
    expect(
      deriveAlertState({ ...base, previousState: 'in_range', nearestDistanceFt: 550, cameraCountInRange: 0 }),
    ).toBe('in_range');
    expect(
      deriveAlertState({ ...base, previousState: 'in_range', nearestDistanceFt: 550.001, cameraCountInRange: 0 }),
    ).toBe('approaching');
    expect(
      deriveAlertState({ ...base, previousState: 'multiple', nearestDistanceFt: 540, cameraCountInRange: 2 }),
    ).toBe('multiple');
  });

  it('has no exit band when hysteresis is zero', () => {
    expect(
      deriveAlertState({ ...base, hysteresisFt: 0, previousState: 'in_range', nearestDistanceFt: 500.001, cameraCountInRange: 0 }),
    ).toBe('approaching');
  });

  it('rejects impossible inputs instead of guessing', () => {
    expect(() => deriveAlertState({ ...base, thresholdFt: 0, nearestDistanceFt: 10, cameraCountInRange: 0 })).toThrow(RangeError);
    expect(() => deriveAlertState({ ...base, thresholdFt: Number.NaN, nearestDistanceFt: 10, cameraCountInRange: 0 })).toThrow(RangeError);
    expect(() => deriveAlertState({ ...base, hysteresisFt: -1, nearestDistanceFt: 10, cameraCountInRange: 0 })).toThrow(RangeError);
    expect(() => deriveAlertState({ ...base, nearestDistanceFt: 10, cameraCountInRange: -1 })).toThrow(RangeError);
    expect(() => deriveAlertState({ ...base, nearestDistanceFt: 10, cameraCountInRange: 1.5 })).toThrow(RangeError);
    expect(() => deriveAlertState({ ...base, nearestDistanceFt: Number.NaN, cameraCountInRange: 0 })).toThrow(RangeError);
    expect(() => deriveAlertState({ ...base, nearestDistanceFt: -1, cameraCountInRange: 0 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe('dedupeCameras', () => {
  it('collapses the same id reported from overlapping tiles', () => {
    const result = dedupeCameras([C1, C1, C1]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('FWM-1001');
    expect(result[0]!.mergedIds).toEqual(['FWM-1001']);
  });

  it('collapses different ids at effectively the same place', () => {
    const a: CameraLike = { id: 'FWM-2002', lat: CAM_LAT, lon: CAM_LON, directionDeg: null };
    const b: CameraLike = { id: 'FWM-2001', lat: latOffsetFt(CAM_LAT, 10), lon: CAM_LON, directionDeg: 223 };
    const result = dedupeCameras([a, b]);
    expect(result).toHaveLength(1);
    // Lexicographically smallest id survives, so tile arrival order cannot
    // change the answer.
    expect(result[0]!.id).toBe('FWM-2001');
    expect(result[0]!.mergedIds).toEqual(['FWM-2001', 'FWM-2002']);
    expect(dedupeCameras([b, a])).toEqual(dedupeCameras([a, b]));
  });

  it('adopts a known facing over an unknown one', () => {
    const known: CameraLike = { id: 'FWM-3002', lat: latOffsetFt(CAM_LAT, 8), lon: CAM_LON, directionDeg: 223 };
    const unknown: CameraLike = { id: 'FWM-3001', lat: CAM_LAT, lon: CAM_LON, directionDeg: null };
    const result = dedupeCameras([unknown, known]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('FWM-3001');
    expect(result[0]!.directionDeg).toBe(223);
  });

  it('keeps genuinely separate cameras separate', () => {
    expect(dedupeCameras([C1, C2])).toHaveLength(2);
    // 60 ft apart is outside the 50 ft epsilon.
    const far: CameraLike = { id: 'FWM-4002', lat: latOffsetFt(CAM_LAT, 60), lon: CAM_LON, directionDeg: null };
    expect(dedupeCameras([C1, far])).toHaveLength(2);
    expect(DEFAULT_DEDUPE_EPSILON_FT).toBe(50);
  });

  it('chains a cluster of three', () => {
    const cameras: CameraLike[] = [
      { id: 'c', lat: CAM_LAT, lon: CAM_LON, directionDeg: null },
      { id: 'a', lat: latOffsetFt(CAM_LAT, 30), lon: CAM_LON, directionDeg: null },
      { id: 'b', lat: latOffsetFt(CAM_LAT, 60), lon: CAM_LON, directionDeg: null },
    ];
    const result = dedupeCameras(cameras);
    expect(result).toHaveLength(1);
    expect(result[0]!.mergedIds).toEqual(['a', 'b', 'c']);
  });

  it('rejects bad input', () => {
    expect(() => dedupeCameras([{ id: 'x', lat: Number.NaN, lon: 0, directionDeg: null }])).toThrow(RangeError);
    expect(() => dedupeCameras([C1], -1)).toThrow(RangeError);
    expect(dedupeCameras([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The drive
// ---------------------------------------------------------------------------

function driveEngine(): { engine: AlertEngine; tick: (ft: number, cameras: readonly CameraLike[]) => AlertTick } {
  const clock = createTestClock();
  const engine = createAlertEngine({ clock, notificationCooldownMs: 0, stationaryDwellMs: 3_600_000 });
  let first = true;
  return {
    engine,
    tick(ft, cameras) {
      if (first) first = false;
      else clock.advance(1000);
      return engine.update(fixAt(ft), cameras);
    },
  };
}

describe('AlertEngine - a simulated drive', () => {
  it('walks clear -> approaching -> in_range -> multiple -> clear', () => {
    const { engine, tick } = driveEngine();
    const one = [C1];
    const two = [C1, C2];

    const states: AlertState[] = [
      tick(1500, one).state,
      tick(900, one).state,
      tick(700, one).state,
      tick(480, one).state,
      tick(460, one).state,
      tick(460, two).state,
      tick(900, two).state,
    ];

    expect(states).toEqual([
      'clear',
      'approaching',
      'approaching',
      'in_range',
      'in_range',
      'multiple',
      'clear',
    ]);

    // History records transitions, not ticks.
    expect(engine.getHistory().map((h) => h.state)).toEqual([
      'approaching',
      'in_range',
      'multiple',
      'clear',
    ]);

    const exposure = engine.getExposure();
    expect(exposure.camerasInRangeIds).toEqual(['FWM-1001', 'FWM-1002']);
    expect(exposure.camerasInRangeCount).toBe(2);
    expect(exposure.inRangeEvents).toBe(1);
  });

  it('reports distance, bearing and relative direction on every tick', () => {
    const { tick } = driveEngine();
    const result = tick(425, [C1]);
    expect(result.nearest).not.toBeNull();
    expect(result.nearest!.distanceFt).toBeCloseTo(425, 2);
    expect(result.nearest!.bearingDeg).toBeCloseTo(0, 6); // due north
    expect(result.nearest!.relativeDirection).toBe('ahead');
    // C1 looks south (180) and the driver is south of it: it is looking at them.
    expect(result.nearest!.facingVehicle).toBe(true);
  });

  it('has no relative direction without a heading', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    const result = engine.update(fixAt(425, { headingDeg: null }), [C1]);
    expect(result.nearest!.relativeDirection).toBeNull();
    expect(result.nearest!.bearingDeg).toBeCloseTo(0, 6);
  });

  it('reads relative direction against the heading, not the compass', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    // Camera is due north. Driving east, it is on the left.
    expect(engine.update(fixAt(425, { headingDeg: 90 }), [C1]).nearest!.relativeDirection).toBe('left');
    expect(engine.update(fixAt(425, { headingDeg: 270 }), [C1]).nearest!.relativeDirection).toBe('right');
    expect(engine.update(fixAt(425, { headingDeg: 180 }), [C1]).nearest!.relativeDirection).toBe('behind');
  });

  it('never drops a camera whose facing is unknown', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    const unknown: CameraLike = { id: 'FWM-9000', lat: CAM_LAT, lon: CAM_LON, directionDeg: null };
    const result = engine.update(fixAt(300), [unknown]);
    expect(result.cameras).toHaveLength(1);
    expect(result.nearest!.facingVehicle).toBeNull();
    expect(result.nearest!.facingVehicle).not.toBe(false);
    expect(result.countInRange).toBe(1);
    expect(result.state).toBe('in_range');
    expect(result.shouldAlertUser).toBe(true);
  });

  it('downgrades a receding camera out of approaching', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    engine.update(fixAt(600), [C1]);
    clock.advance(1000);
    expect(engine.update(fixAt(700), [C1]).state).toBe('clear'); // receding
    clock.advance(1000);
    expect(engine.update(fixAt(650), [C1]).state).toBe('approaching'); // closing again
  });

  it('keeps a receding camera in approaching when the rule is switched off', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({
      clock,
      notificationCooldownMs: 0,
      requireClosingForApproaching: false,
    });
    engine.update(fixAt(600), [C1]);
    clock.advance(1000);
    expect(engine.update(fixAt(700), [C1]).state).toBe('approaching');
  });
});

// ---------------------------------------------------------------------------
// Hysteresis
// ---------------------------------------------------------------------------

describe('AlertEngine - hysteresis', () => {
  const oscillation = [600, 495, 505, 495, 505, 495, 520, 545, 560];

  function run(hysteresisFt: number): AlertState[] {
    const clock = createTestClock();
    const engine = createAlertEngine({
      clock,
      hysteresisFt,
      notificationCooldownMs: 0,
      stationaryDwellMs: 3_600_000,
      requireClosingForApproaching: false,
    });
    const states: AlertState[] = [];
    for (const ft of oscillation) {
      states.push(engine.update(fixAt(ft), [C1]).state);
      clock.advance(1000);
    }
    return states;
  }

  it('does not flap while the distance jitters across the threshold', () => {
    const states = run(50);
    expect(states).toEqual([
      'approaching', // 600
      'in_range', // 495 - enters at 500
      'in_range', // 505 - inside the 550 exit band
      'in_range', // 495
      'in_range', // 505
      'in_range', // 495
      'in_range', // 520
      'in_range', // 545 - still inside 550
      'approaching', // 560 - finally out
    ]);
    // Two transitions in, one out. The jitter contributes nothing.
    const transitions = states.filter((s, i) => i > 0 && s !== states[i - 1]);
    expect(transitions).toEqual(['in_range', 'approaching']);
  });

  it('flaps without it, which is the whole point', () => {
    const states = run(0);
    const transitions = states.filter((s, i) => i > 0 && s !== states[i - 1]);
    expect(transitions.length).toBeGreaterThan(2);
    expect(states).toEqual([
      'approaching',
      'in_range',
      'approaching',
      'in_range',
      'approaching',
      'in_range',
      'approaching',
      'approaching',
      'approaching',
    ]);
  });

  it('records one history entry per real transition, not per tick', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({
      clock,
      notificationCooldownMs: 0,
      requireClosingForApproaching: false,
      stationaryDwellMs: 3_600_000,
    });
    for (const ft of oscillation) {
      engine.update(fixAt(ft), [C1]);
      clock.advance(1000);
    }
    expect(engine.getHistory().map((h) => h.state)).toEqual(['approaching', 'in_range', 'approaching']);
  });
});

// ---------------------------------------------------------------------------
// Duplicates through the engine
// ---------------------------------------------------------------------------

describe('AlertEngine - duplicate cameras', () => {
  it('alerts once for a camera returned by two overlapping tiles', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    const result = engine.update(fixAt(300), [C1, C1]);
    expect(result.cameras).toHaveLength(1);
    expect(result.countInRange).toBe(1);
    expect(result.state).toBe('in_range'); // NOT multiple
    expect(result.notifyCameraIds).toEqual(['FWM-1001']);
  });

  it('alerts once for two reports of the same pole under different ids', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    const duplicate: CameraLike = { id: 'FWM-1001-dup', lat: latOffsetFt(CAM_LAT, 12), lon: CAM_LON, directionDeg: null };
    const result = engine.update(fixAt(300), [C1, duplicate]);
    expect(result.cameras).toHaveLength(1);
    expect(result.state).toBe('in_range');
    expect(result.cameras[0]!.mergedIds).toEqual(['FWM-1001', 'FWM-1001-dup']);
  });

  it('still reaches multiple for two genuinely different cameras', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    const result = engine.update(fixAt(300), [C1, C2]);
    expect(result.cameras).toHaveLength(2);
    expect(result.countInRange).toBe(2);
    expect(result.state).toBe('multiple');
    expect(result.hapticPulses).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

describe('AlertEngine - per-camera notification cooldown', () => {
  it('alerts once, then holds off until the window elapses', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 60_000, stationaryDwellMs: 3_600_000 });

    const first = engine.update(fixAt(400), [C1]);
    expect(first.shouldAlertUser).toBe(true);
    expect(first.notifyCameraIds).toEqual(['FWM-1001']);

    clock.advance(1000);
    const second = engine.update(fixAt(380), [C1]);
    expect(second.state).toBe('in_range'); // state is unchanged...
    expect(second.shouldAlertUser).toBe(false); // ...only the buzz is held
    expect(second.suppressedBy).toContain('cooldown');
    expect(second.notifyCameraIds).toEqual([]);
    expect(second.hapticPulses).toBe(0);

    clock.advance(60_000);
    const third = engine.update(fixAt(360), [C1]);
    expect(third.shouldAlertUser).toBe(true);
  });

  it('tracks the cooldown per camera, not globally', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 60_000, stationaryDwellMs: 3_600_000 });
    expect(engine.update(fixAt(400), [C1]).notifyCameraIds).toEqual(['FWM-1001']);
    clock.advance(1000);
    // C2 has never fired, so it alerts even though C1 is still cooling down.
    const next = engine.update(fixAt(400), [C1, C2]);
    expect(next.shouldAlertUser).toBe(true);
    expect(next.notifyCameraIds).toEqual(['FWM-1002']);
  });
});

// ---------------------------------------------------------------------------
// GPS accuracy gating
// ---------------------------------------------------------------------------

describe('AlertEngine - GPS accuracy gating', () => {
  it('computes and logs the state but does not alert on a loose fix', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0, gpsAccuracyLimitM: 50 });
    const result = engine.update(fixAt(400, { accuracyM: 120 }), [C1]);

    expect(result.state).toBe('in_range');
    expect(result.countInRange).toBe(1);
    expect(result.cameras).toHaveLength(1);
    expect(result.shouldAlertUser).toBe(false);
    expect(result.suppressedBy).toContain('accuracy');
    expect(result.hapticPulses).toBe(0);

    // The record is intact.
    expect(engine.getHistory().map((h) => h.state)).toEqual(['in_range']);
    expect(engine.getExposure().camerasInRangeIds).toEqual(['FWM-1001']);
    expect(engine.getExposure().inRangeEvents).toBe(1);
  });

  it('alerts again once the fix tightens', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0, gpsAccuracyLimitM: 50 });
    expect(engine.update(fixAt(400, { accuracyM: 120 }), [C1]).shouldAlertUser).toBe(false);
    clock.advance(1000);
    expect(engine.update(fixAt(380, { accuracyM: 4 }), [C1]).shouldAlertUser).toBe(true);
  });

  it('treats the exact bound as good enough', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0, gpsAccuracyLimitM: 50 });
    expect(engine.update(fixAt(400, { accuracyM: 50 }), [C1]).shouldAlertUser).toBe(true);
  });

  it('alerts on an unknown accuracy unless told otherwise', () => {
    const clock = createTestClock();
    const lenient = createAlertEngine({ clock, notificationCooldownMs: 0 });
    expect(lenient.update(fixAt(400, { accuracyM: null }), [C1]).shouldAlertUser).toBe(true);

    const strict = createAlertEngine({
      clock: createTestClock(),
      notificationCooldownMs: 0,
      gateOnUnknownAccuracy: true,
    });
    const gated = strict.update(fixAt(400, { accuracyM: null }), [C1]);
    expect(gated.shouldAlertUser).toBe(false);
    expect(gated.suppressedBy).toContain('accuracy');
    expect(gated.state).toBe('in_range');
  });
});

// ---------------------------------------------------------------------------
// Stationary dwell
// ---------------------------------------------------------------------------

describe('AlertEngine - stationary suppression', () => {
  it('does not suppress at a traffic light', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({
      clock,
      notificationCooldownMs: 0,
      stationaryDwellMs: 120_000,
      movingDwellMs: 5_000,
    });

    engine.update(fixAt(300, { speedMps: CRUISE_MPS }), [C1]);
    // 90 seconds of red. Shorter than the dwell, so nothing changes.
    for (let elapsed = 0; elapsed < 90_000; elapsed += 10_000) {
      clock.advance(10_000);
      const result = engine.update(fixAt(300, { speedMps: 0 }), [C1]);
      expect(result.stationary).toBe(false);
    }
    clock.advance(10_000);
    expect(engine.update(fixAt(300, { speedMps: CRUISE_MPS }), [C1]).stationary).toBe(false);
  });

  it('suppresses once parked, and restores after the moving dwell', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({
      clock,
      notificationCooldownMs: 0,
      stationaryDwellMs: 120_000,
      movingDwellMs: 5_000,
    });

    engine.update(fixAt(300, { speedMps: 0 }), [C1]); // t=0, dwell starts
    clock.advance(119_000);
    expect(engine.update(fixAt(300, { speedMps: 0 }), [C1]).stationary).toBe(false);

    clock.advance(1_000); // t=120_000
    const parked = engine.update(fixAt(300, { speedMps: 0 }), [C1]);
    expect(parked.stationary).toBe(true);
    expect(parked.shouldAlertUser).toBe(false);
    expect(parked.suppressedBy).toContain('stationary');
    // Detection is untouched.
    expect(parked.state).toBe('in_range');
    expect(parked.countInRange).toBe(1);

    clock.advance(1_000); // moving, but not for long enough yet
    expect(engine.update(fixAt(300, { speedMps: CRUISE_MPS }), [C1]).stationary).toBe(true);

    clock.advance(5_000);
    const rolling = engine.update(fixAt(300, { speedMps: CRUISE_MPS }), [C1]);
    expect(rolling.stationary).toBe(false);
    expect(rolling.shouldAlertUser).toBe(true);
  });

  it('lets device motion veto a stationary conclusion', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({
      clock,
      notificationCooldownMs: 0,
      stationaryDwellMs: 120_000,
    });
    for (let i = 0; i < 30; i++) {
      const result = engine.update(fixAt(300, { speedMps: 0, motionMagnitudeMps2: 2 }), [C1]);
      expect(result.stationary).toBe(false);
      clock.advance(10_000);
    }
  });

  it('never declares stationary on an unknown speed', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0, stationaryDwellMs: 1 });
    // No platform speed and no previous position: nothing to derive from.
    const result = engine.update(fixAt(300, { speedMps: null }), [C1]);
    expect(result.speedSource).toBe('unknown');
    expect(result.speedMps).toBeNull();
    expect(result.stationary).toBe(false);
  });

  it('derives a speed from position deltas when the platform gives none', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    engine.update(fixAt(1000, { speedMps: null }), [C1]);
    clock.advance(1000);
    const result = engine.update(fixAt(1000 - 68.9, { speedMps: null }), [C1]);
    expect(result.speedSource).toBe('derived');
    // 68.9 ft in one second is 21 m/s, which is the 47 MPH on the LOG rows.
    expect(result.speedMps).toBeCloseTo(21, 1);
  });

  it('prefers the platform speed when it has one', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    const result = engine.update(fixAt(400, { speedMps: 17.5 }), [C1]);
    expect(result.speedSource).toBe('gps');
    expect(result.speedMps).toBe(17.5);
  });
});

// ---------------------------------------------------------------------------
// Mute
// ---------------------------------------------------------------------------

/** Everything about a tick that mute is forbidden to change. */
function record(tick: AlertTick): unknown {
  return {
    state: tick.state,
    previousState: tick.previousState,
    changed: tick.changed,
    nearest: tick.nearest,
    cameras: tick.cameras,
    countInRange: tick.countInRange,
    thresholdFt: tick.thresholdFt,
    effectiveThresholdFt: tick.effectiveThresholdFt,
    isClosing: tick.isClosing,
    speedMps: tick.speedMps,
    speedSource: tick.speedSource,
    accuracyM: tick.accuracyM,
    stationary: tick.stationary,
  };
}

describe('AlertEngine - mute removes the alert, never the record', () => {
  const drive: ReadonlyArray<readonly [number, readonly CameraLike[]]> = [
    [1500, [C1]],
    [900, [C1]],
    [700, [C1]],
    [480, [C1]],
    [460, [C1]],
    [460, [C1, C2]],
    [900, [C1, C2]],
  ];

  function runDrive(muted: boolean): { ticks: AlertTick[]; engine: AlertEngine } {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0, stationaryDwellMs: 3_600_000 });
    if (muted) engine.muteAll();
    const ticks: AlertTick[] = [];
    for (const [ft, cameras] of drive) {
      ticks.push(engine.update(fixAt(ft), cameras));
      clock.advance(1000);
    }
    return { ticks, engine };
  }

  it('produces a byte-identical record whether muted or not', () => {
    const loud = runDrive(false);
    const quiet = runDrive(true);

    expect(quiet.ticks.map(record)).toEqual(loud.ticks.map(record));
    expect(quiet.engine.getHistory()).toEqual(loud.engine.getHistory());
    expect(quiet.engine.getExposure()).toEqual(loud.engine.getExposure());
  });

  it('silences delivery and only delivery', () => {
    const loud = runDrive(false);
    const quiet = runDrive(true);

    expect(loud.ticks.some((t) => t.shouldAlertUser)).toBe(true);
    expect(quiet.ticks.every((t) => !t.shouldAlertUser)).toBe(true);
    expect(quiet.ticks.every((t) => t.hapticPulses === 0)).toBe(true);
    expect(quiet.ticks.every((t) => t.notifyCameraIds.length === 0)).toBe(true);
    expect(quiet.ticks.filter((t) => t.state !== 'clear').every((t) => t.suppressedBy.includes('muted'))).toBe(true);
  });

  it('keeps a muted camera visible, counted and in range', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    engine.muteCamera('FWM-1001');
    const result = engine.update(fixAt(300), [C1]);

    expect(result.cameras).toHaveLength(1);
    expect(result.cameras[0]!.muted).toBe(true);
    expect(result.cameras[0]!.inRange).toBe(true);
    expect(result.countInRange).toBe(1);
    expect(result.state).toBe('in_range');
    expect(result.shouldAlertUser).toBe(false);
    expect(engine.getExposure().camerasInRangeIds).toEqual(['FWM-1001']);
  });

  it('pierces the mute inside 150 ft', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    engine.muteAll();

    const outside = engine.update(fixAt(200), [C1]);
    expect(outside.shouldAlertUser).toBe(false);
    expect(outside.suppressedBy).toContain('muted');

    clock.advance(1000);
    const inside = engine.update(fixAt(120), [C1]);
    expect(inside.shouldAlertUser).toBe(true);
    expect(inside.hapticPulses).toBe(2);
    expect(inside.notifyCameraIds).toEqual(['FWM-1001']);
  });

  it('honours a configured re-alert distance', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0, reAlertWhenCloserThanFt: 0 });
    engine.muteAll();
    expect(engine.update(fixAt(5), [C1]).shouldAlertUser).toBe(false);
  });

  it('expires a mute on the injected clock', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    engine.muteAll(600_000);
    expect(engine.isGloballyMuted()).toBe(true);
    expect(engine.globalMuteRemainingMs()).toBe(600_000);

    clock.advance(300_000);
    expect(engine.globalMuteRemainingMs()).toBe(300_000);
    expect(engine.update(fixAt(300), [C1]).shouldAlertUser).toBe(false);

    clock.advance(300_000);
    expect(engine.isGloballyMuted()).toBe(false);
    expect(engine.update(fixAt(300), [C1]).shouldAlertUser).toBe(true);
  });

  it('unmutes on demand', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    engine.muteCamera('FWM-1001');
    expect(engine.isCameraMuted('FWM-1001')).toBe(true);
    engine.unmuteCamera('FWM-1001');
    expect(engine.isCameraMuted('FWM-1001')).toBe(false);
    engine.muteAll();
    engine.unmuteAll();
    expect(engine.isGloballyMuted()).toBe(false);
    expect(engine.update(fixAt(300), [C1]).shouldAlertUser).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism, privacy and configuration
// ---------------------------------------------------------------------------

describe('AlertEngine - clock injection', () => {
  it('never reads the wall clock', () => {
    const clock = createTestClock(1_700_000_000_000);
    const engine = createAlertEngine({ clock });
    const spy = vi.spyOn(Date, 'now');
    const before = spy.mock.calls.length;

    engine.muteAll();
    engine.muteCamera('FWM-1001');
    engine.update(fixAt(400), [C1, C2]);
    clock.advance(5_000);
    engine.update(fixAt(120), [C1, C2]);
    engine.getExposure();
    engine.getDeliveryStats();

    expect(spy.mock.calls.length).toBe(before);
    spy.mockRestore();
  });

  it('replays a drive identically', () => {
    const run = (): unknown =>
      (() => {
        const clock = createTestClock();
        const engine = createAlertEngine({ clock, notificationCooldownMs: 30_000 });
        const out: unknown[] = [];
        for (const ft of [1500, 900, 700, 480, 460, 300, 700]) {
          out.push(engine.update(fixAt(ft), [C1, C2]));
          clock.advance(1000);
        }
        return out;
      })();
    expect(run()).toEqual(run());
  });
});

describe('AlertEngine - privacy', () => {
  it('never puts the vehicle position in the history it keeps', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    for (const ft of [1500, 900, 400, 900]) {
      engine.update(fixAt(ft), [C1]);
      clock.advance(1000);
    }

    const history = engine.getHistory();
    expect(history.length).toBeGreaterThan(0);
    for (const entry of history) {
      expect(Object.keys(entry).sort()).toEqual([
        'countInRange',
        'nearestCameraId',
        'nearestDistanceFt',
        'previousState',
        'speedMps',
        'state',
        'timestampMs',
      ]);
    }
    // And no coordinate leaks through as a value either.
    const serialised = JSON.stringify(history);
    expect(serialised).not.toContain(String(CAM_LON));
    expect(serialised).not.toContain('39.1');
  });

  it('bounds the history it keeps', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({
      clock,
      notificationCooldownMs: 0,
      maxHistoryEntries: 4,
      requireClosingForApproaching: false,
    });
    for (let i = 0; i < 40; i++) {
      engine.update(fixAt(i % 2 === 0 ? 400 : 900), [C1]);
      clock.advance(1000);
    }
    expect(engine.getHistory()).toHaveLength(4);
  });
});

describe('AlertEngine - configuration', () => {
  it('refuses a threshold outside the slider range', () => {
    expect(() => new AlertEngine({ thresholdFt: 99 })).toThrow(RangeError);
    expect(() => new AlertEngine({ thresholdFt: 1001 })).toThrow(RangeError);
    expect(() => new AlertEngine({ thresholdFt: Number.NaN })).toThrow(RangeError);
    expect(() => new AlertEngine({ thresholdFt: 100 })).not.toThrow();
    expect(() => new AlertEngine({ thresholdFt: 1000 })).not.toThrow();
  });

  it('refuses nonsensical timings', () => {
    expect(() => new AlertEngine({ hysteresisFt: -1 })).toThrow(RangeError);
    expect(() => new AlertEngine({ notificationCooldownMs: -1 })).toThrow(RangeError);
    expect(() => new AlertEngine({ gpsAccuracyLimitM: 0 })).toThrow(RangeError);
    expect(() => new AlertEngine({ stationaryDwellMs: -1 })).toThrow(RangeError);
    expect(() => new AlertEngine({ maxHistoryEntries: 0 })).toThrow(RangeError);
    expect(() => new AlertEngine({ dedupeEpsilonFt: Number.NaN })).toThrow(RangeError);
  });

  it('applies a new threshold on the next tick', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    expect(engine.update(fixAt(700), [C1]).state).toBe('approaching');
    engine.setThresholdFt(1000);
    clock.advance(1000);
    expect(engine.update(fixAt(690), [C1]).state).toBe('in_range');
    expect(() => engine.setThresholdFt(1200)).toThrow(RangeError);
  });

  it('defaults to the design threshold', () => {
    expect(new AlertEngine().getConfig().thresholdFt).toBe(DEFAULT_ALERT_THRESHOLD_FT);
  });

  it('rejects an impossible fix', () => {
    const engine = createAlertEngine({ clock: createTestClock() });
    expect(() => engine.update({ lat: Number.NaN, lon: 0, headingDeg: 0, speedMps: 0, accuracyM: 4 }, [])).toThrow(RangeError);
    expect(() => engine.update({ lat: 91, lon: 0, headingDeg: 0, speedMps: 0, accuracyM: 4 }, [])).toThrow(RangeError);
  });

  it('is clear with no cameras at all', () => {
    const engine = createAlertEngine({ clock: createTestClock() });
    const result = engine.update(fixAt(300), []);
    expect(result.state).toBe('clear');
    expect(result.nearest).toBeNull();
    expect(result.cameras).toEqual([]);
    expect(result.isClosing).toBeNull();
    expect(result.shouldAlertUser).toBe(false);
    expect(result.suppressedBy).toEqual([]);
  });

  it('resets everything, including the mute timers', () => {
    const clock = createTestClock();
    const engine = createAlertEngine({ clock, notificationCooldownMs: 0 });
    engine.muteAll();
    engine.update(fixAt(300), [C1]);
    expect(engine.getHistory().length).toBeGreaterThan(0);

    engine.reset();
    expect(engine.getState()).toBe('clear');
    expect(engine.getHistory()).toEqual([]);
    expect(engine.getExposure()).toEqual({ camerasInRangeIds: [], camerasInRangeCount: 0, inRangeEvents: 0 });
    expect(engine.getDeliveryStats()).toEqual({ alertsDelivered: 0, notificationsSuppressed: 0 });
    expect(engine.isGloballyMuted()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Package surface
// ---------------------------------------------------------------------------

describe('@fwm/core public surface', () => {
  it('exports the whole required API through the barrel', async () => {
    const core = await import('./index.ts');
    const required = [
      'distanceFt',
      'bearing',
      'relativeDirection',
      'isFacingVehicle',
      'latLonToTile',
      'surroundingTiles',
      'deriveAlertState',
      'AlertEngine',
      'createAlertEngine',
      'dedupeCameras',
      'systemClock',
      'createTestClock',
    ] as const;
    for (const name of required) {
      expect(typeof core[name]).not.toBe('undefined');
    }
    // The barrel answers the same as the modules it re-exports.
    expect(core.distanceFt(0, 179.99, 0, -179.99)).toBeCloseTo(7304.4285288, 6);
    expect(core.latLonToTile(52.5162, 13.3777, 16)).toEqual({ x: 35203, y: 21494, z: 16 });
    expect(core.deriveAlertState({
      nearestDistanceFt: 400,
      cameraCountInRange: 2,
      thresholdFt: 500,
      previousState: 'clear',
      hysteresisFt: 50,
    })).toBe('multiple');
  });
});
