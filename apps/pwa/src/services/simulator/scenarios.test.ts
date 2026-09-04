/**
 * Every named scenario, driven through the real `AlertEngine` on a `TestClock`,
 * asserting the exact transition sequence it declares.
 *
 * The declared sequence lives on the scenario, not in this file, so a scenario
 * cannot be "fixed" by editing the expectation next to the assertion. If a
 * change to the engine moves a boundary, this fails and somebody has to decide
 * whether the boundary or the scenario was wrong.
 */

import { describe, expect, it } from 'vitest';

import {
  APPROACHING_OUTER_FT,
  DEFAULT_ALERT_THRESHOLD_FT,
  DEFAULT_DEDUPE_EPSILON_FT,
  DEFAULT_HYSTERESIS_FT,
  DEFAULT_MOVING_DWELL_MS,
  DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT,
  DEFAULT_STATIONARY_DWELL_MS,
} from './fwmCore.ts';
import {
  GPS_LOST_FIRST_TICK,
  GPS_LOST_LAST_TICK,
  SCENARIOS,
  SCENARIO_IDS,
  createScenarioDriver,
  runScenario,
  scenario,
  type ScenarioId,
  type ScenarioRun,
  type ScenarioTickRecord,
} from './scenarios.ts';
import { FIXTURE_CAMERA_IDS } from '../../test/fixtures/cameras.ts';

function positionTicksOf(run: ScenarioRun): ScenarioTickRecord[] {
  return run.ticks.filter((tick) => tick.kind === 'position');
}

// ---------------------------------------------------------------------------
// The contract every scenario keeps
// ---------------------------------------------------------------------------

describe.each(SCENARIO_IDS)('scenario %s', (id: ScenarioId) => {
  const definition = scenario(id);
  const run = runScenario(id);

  it('produces exactly the transition sequence it declares', () => {
    expect(run.transitions).toStrictEqual([...definition.expectedTransitions]);
  });

  it('agrees with the engine history it wrote', () => {
    expect(run.history.map((entry) => entry.state)).toStrictEqual([...definition.expectedTransitions]);
  });

  it('emits exactly the number of ticks it declares', () => {
    expect(run.ticks.length).toBe(definition.expectedTickCount);
  });

  it('calls the engine once per position tick and never on an outage tick', () => {
    expect(run.engineUpdateCount).toBe(run.positionTickCount);
    expect(run.positionTickCount + run.fixLostTickCount).toBe(run.ticks.length);
  });

  it('is deterministic - the same run twice is byte-identical', () => {
    const again = runScenario(id);
    expect(again.transitions).toStrictEqual([...run.transitions]);
    expect(again.history).toStrictEqual([...run.history]);
    expect(again.exposure).toStrictEqual(run.exposure);
    expect(again.delivery).toStrictEqual(run.delivery);
    expect(again.ticks.map((t) => t.nearestDistanceFt)).toStrictEqual(
      run.ticks.map((t) => t.nearestDistanceFt),
    );
  });

  it('records no coordinate in the alert history', () => {
    // The engine promises history holds distance, speed, camera id and state -
    // never a latitude. A coordinate history is a movement history.
    const serialised = JSON.stringify(run.history);
    expect(serialised).not.toMatch(/"lat"|"lon"|latitude|longitude/i);
  });

  it('stops the way it declares it stops', () => {
    if (definition.endsAtRouteEnd) {
      // The road ran out. The cap is only a runaway guard and must not bind.
      expect(run.ticks.length).toBeLessThan(definition.maxTicks);
    } else {
      // The drive is open-ended: the cap IS the length.
      expect(run.ticks.length).toBe(definition.maxTicks);
    }
  });
});

// ---------------------------------------------------------------------------
// clear-to-approaching
// ---------------------------------------------------------------------------

describe('clear-to-approaching', () => {
  const run = runScenario('clear-to-approaching');

  it('starts outside the approaching band and ends inside it', () => {
    const ticks = positionTicksOf(run);
    expect(ticks[0]?.state).toBe('clear');
    expect(ticks[0]?.nearestDistanceFt).toBeGreaterThan(APPROACHING_OUTER_FT);
    expect(run.finalState).toBe('approaching');
  });

  it('changes state on the first tick inside 1000 ft and not before', () => {
    for (const tick of positionTicksOf(run)) {
      const inside = (tick.nearestDistanceFt ?? Number.POSITIVE_INFINITY) <= APPROACHING_OUTER_FT;
      expect(tick.state).toBe(inside ? 'approaching' : 'clear');
    }
  });

  it('never reaches the threshold', () => {
    for (const tick of positionTicksOf(run)) {
      expect(tick.nearestDistanceFt).toBeGreaterThan(DEFAULT_ALERT_THRESHOLD_FT);
    }
  });
});

// ---------------------------------------------------------------------------
// approaching-to-in-range
// ---------------------------------------------------------------------------

describe('approaching-to-in-range', () => {
  const run = runScenario('approaching-to-in-range');

  it('crosses the threshold exactly once, inward', () => {
    const crossings = positionTicksOf(run).filter((tick) => tick.changed && tick.state === 'in_range');
    expect(crossings).toHaveLength(1);
    expect(crossings[0]?.nearestDistanceFt).toBeLessThanOrEqual(DEFAULT_ALERT_THRESHOLD_FT);
  });

  it('was still approaching on the tick before the crossing', () => {
    const index = run.ticks.findIndex((tick) => tick.changed && tick.state === 'in_range');
    expect(index).toBeGreaterThan(0);
    const previous = run.ticks[index - 1];
    expect(previous?.state).toBe('approaching');
    expect(previous?.nearestDistanceFt).toBeGreaterThan(DEFAULT_ALERT_THRESHOLD_FT);
  });

  it('delivers an alert and buzzes the right number of times', () => {
    expect(run.delivery.alertsDelivered).toBeGreaterThan(0);
    const inRange = positionTicksOf(run).filter((tick) => tick.state === 'in_range');
    expect(inRange.length).toBeGreaterThan(0);
    for (const tick of inRange) expect(tick.alert?.hapticPulses === 2 || !tick.shouldAlertUser).toBe(true);
  });

  it('counts the camera in exposure', () => {
    expect(run.exposure.camerasInRangeIds).toStrictEqual([FIXTURE_CAMERA_IDS.readingTennessee]);
    expect(run.exposure.inRangeEvents).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// multiple-cameras
// ---------------------------------------------------------------------------

describe('multiple-cameras', () => {
  const run = runScenario('multiple-cameras');

  it('reaches multiple by way of in_range, not straight from approaching', () => {
    expect(run.transitions).toStrictEqual(['approaching', 'in_range', 'multiple']);
  });

  it('has exactly one camera in range on the in_range tick and two on the multiple tick', () => {
    const inRangeTick = run.ticks.find((tick) => tick.changed && tick.state === 'in_range');
    const multipleTick = run.ticks.find((tick) => tick.changed && tick.state === 'multiple');
    expect(inRangeTick?.countInRange).toBe(1);
    expect(multipleTick?.countInRange).toBe(2);
  });

  it('never merges the two cameras, because they are further apart than the dedupe epsilon', () => {
    for (const tick of positionTicksOf(run)) {
      expect(tick.alert?.cameras).toHaveLength(2);
      for (const camera of tick.alert?.cameras ?? []) expect(camera.mergedIds).toHaveLength(1);
    }
    const [first] = positionTicksOf(run);
    const cameras = first?.alert?.cameras ?? [];
    const a = cameras[0];
    const b = cameras[1];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    expect(Math.abs(a.distanceFt - b.distanceFt)).toBeGreaterThan(DEFAULT_DEDUPE_EPSILON_FT);
  });

  it('counts both cameras in exposure', () => {
    expect(run.exposure.camerasInRangeCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// threshold-flap - the hysteresis proof
// ---------------------------------------------------------------------------

describe('threshold-flap', () => {
  const run = runScenario('threshold-flap');

  it('produces EXACTLY ONE transition across twelve swings', () => {
    expect(run.transitions).toHaveLength(1);
    expect(run.transitions).toStrictEqual(['in_range']);
    expect(run.history).toHaveLength(1);
  });

  it('really does swing across the entry threshold', () => {
    const distances = positionTicksOf(run).map((tick) => tick.nearestDistanceFt ?? 0);
    expect(distances.some((d) => d < DEFAULT_ALERT_THRESHOLD_FT)).toBe(true);
    expect(distances.some((d) => d > DEFAULT_ALERT_THRESHOLD_FT)).toBe(true);
  });

  it('never leaves the exit threshold, which is why the state holds', () => {
    const exitFt = DEFAULT_ALERT_THRESHOLD_FT + DEFAULT_HYSTERESIS_FT;
    for (const tick of positionTicksOf(run)) {
      expect(tick.nearestDistanceFt).toBeLessThanOrEqual(exitFt);
      expect(tick.state).toBe('in_range');
    }
  });

  it('is a real test: the same drive without hysteresis flaps on every swing', () => {
    // The control. If this ever stops flapping, the scenario has stopped
    // straddling the boundary and the test above proves nothing. One
    // transition with the band; one per tick without it.
    const control = runScenario('threshold-flap', { engineOptions: { hysteresisFt: 0 } });
    expect(control.ticks.length).toBe(run.ticks.length);
    expect(control.transitions.length).toBe(control.ticks.length);
    expect(control.transitions.length).toBeGreaterThan(10);
    expect(run.transitions.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// stationary-at-light
// ---------------------------------------------------------------------------

describe('stationary-at-light', () => {
  const run = runScenario('stationary-at-light');
  const ticks = positionTicksOf(run);
  const firstInRange = ticks.find((tick) => tick.changed && tick.state === 'in_range');

  it('goes quiet only after the stationary dwell, and not before', () => {
    expect(firstInRange).toBeDefined();
    const stoppedAtMs = firstInRange?.atMs ?? 0;

    const beforeDwell = ticks.filter(
      (tick) => tick.atMs >= stoppedAtMs && tick.atMs < stoppedAtMs + DEFAULT_STATIONARY_DWELL_MS,
    );
    // Ticks still at the light AND past the dwell. Bounded above by the moment
    // the car pulls away, so a later stop could never be mistaken for this one.
    const departedAtMs = Math.min(
      ...ticks.filter((tick) => tick.atMs > stoppedAtMs && (tick.speedMps ?? 0) > 0).map((t) => t.atMs),
    );
    const afterDwell = ticks.filter(
      (tick) =>
        tick.atMs >= stoppedAtMs + DEFAULT_STATIONARY_DWELL_MS && tick.atMs < departedAtMs,
    );
    expect(beforeDwell.length).toBeGreaterThan(0);
    expect(afterDwell.length).toBeGreaterThan(0);

    for (const tick of beforeDwell) expect(tick.stationary).toBe(false);
    for (const tick of afterDwell) {
      expect(tick.stationary).toBe(true);
      expect(tick.shouldAlertUser).toBe(false);
      expect(tick.suppressedBy).toContain('stationary');
    }
  });

  it('delivers at least once while stopped but still inside the dwell', () => {
    expect(ticks.some((tick) => tick.shouldAlertUser && tick.stationary === false)).toBe(true);
  });

  it('never changes the record while stopped - the state holds for the whole stop', () => {
    const fromStop = ticks.filter((tick) => tick.atMs >= (firstInRange?.atMs ?? 0));
    for (const tick of fromStop) expect(tick.state).toBe('in_range');
    // Two transitions for the whole drive, both before the light.
    expect(run.history).toHaveLength(2);
  });

  it('reports no heading while stopped, as real GPS does', () => {
    const stopped = ticks.filter((tick) => (tick.speedMps ?? 1) === 0);
    expect(stopped.length).toBeGreaterThan(0);
    for (const tick of stopped) {
      for (const camera of tick.alert?.cameras ?? []) expect(camera.relativeDirection).toBeNull();
    }
  });

  it('alerts again once the vehicle has been moving for the restore dwell', () => {
    const movingAgain = ticks.filter(
      (tick, index) => index > 0 && (tick.speedMps ?? 0) > 0 && (ticks[index - 1]?.speedMps ?? 0) === 0,
    );
    const restartedAtMs = movingAgain[0]?.atMs;
    expect(restartedAtMs).toBeDefined();
    if (restartedAtMs === undefined) return;
    const restored = ticks.filter((tick) => tick.atMs >= restartedAtMs + DEFAULT_MOVING_DWELL_MS);
    expect(restored.length).toBeGreaterThan(0);
    for (const tick of restored) expect(tick.stationary).toBe(false);
    expect(restored.some((tick) => tick.shouldAlertUser)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// gps-lost
// ---------------------------------------------------------------------------

describe('gps-lost', () => {
  const run = runScenario('gps-lost');

  it('loses the fix for exactly the declared window', () => {
    const lost = run.ticks.filter((tick) => tick.kind === 'fix-lost');
    expect(lost).toHaveLength(GPS_LOST_LAST_TICK - GPS_LOST_FIRST_TICK + 1);
    expect(lost.map((tick) => tick.tickIndex)).toStrictEqual(
      Array.from(
        { length: GPS_LOST_LAST_TICK - GPS_LOST_FIRST_TICK + 1 },
        (_unused, i) => GPS_LOST_FIRST_TICK + i,
      ),
    );
  });

  it('does not call the engine, invent a position, or move the state during the outage', () => {
    const before = run.ticks[GPS_LOST_FIRST_TICK - 1];
    expect(before?.kind).toBe('position');
    const stateBefore = before?.state;
    for (const tick of run.ticks.filter((t) => t.kind === 'fix-lost')) {
      expect(tick.alert).toBeNull();
      expect(tick.nearestDistanceFt).toBeNull();
      expect(tick.shouldAlertUser).toBe(false);
      expect(tick.state).toBe(stateBefore);
    }
    expect(run.engineUpdateCount).toBe(run.positionTickCount);
    expect(run.positionTickCount).toBe(run.ticks.length - (GPS_LOST_LAST_TICK - GPS_LOST_FIRST_TICK + 1));
  });

  it('was already approaching before the fix went, and is in range when it returns', () => {
    expect(run.ticks[GPS_LOST_FIRST_TICK - 1]?.state).toBe('approaching');
    const reacquired = run.ticks[GPS_LOST_LAST_TICK + 1];
    expect(reacquired?.kind).toBe('position');
    expect(reacquired?.state).toBe('in_range');
    expect(reacquired?.changed).toBe(true);
  });

  it('records no transition during the outage', () => {
    const outageMs = run.ticks
      .filter((tick) => tick.kind === 'fix-lost')
      .map((tick) => tick.atMs);
    const first = Math.min(...outageMs);
    const last = Math.max(...outageMs);
    for (const entry of run.history) {
      expect(entry.timestampMs < first || entry.timestampMs > last).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// muted-drive - muting removes the alert, never the record
// ---------------------------------------------------------------------------

describe('muted-drive', () => {
  const muted = runScenario('muted-drive');
  const unmuted = runScenario('muted-drive', { skipMute: true });

  it('produces an alert history of identical LENGTH to the unmuted run', () => {
    expect(muted.history).toHaveLength(unmuted.history.length);
  });

  it('produces a byte-identical alert history, not merely the same length', () => {
    expect(muted.history).toStrictEqual([...unmuted.history]);
    expect(muted.transitions).toStrictEqual([...unmuted.transitions]);
    expect(muted.finalState).toBe(unmuted.finalState);
  });

  it('produces identical exposure', () => {
    expect(muted.exposure).toStrictEqual(unmuted.exposure);
    expect(muted.exposure.camerasInRangeCount).toBeGreaterThan(0);
  });

  it('measures every camera identically - same distances, same counts, same in-range flags', () => {
    expect(muted.ticks).toHaveLength(unmuted.ticks.length);
    for (const [index, tick] of muted.ticks.entries()) {
      const other = unmuted.ticks[index];
      expect(tick.nearestDistanceFt).toBe(other?.nearestDistanceFt);
      expect(tick.countInRange).toBe(other?.countInRange);
      expect(tick.state).toBe(other?.state);
      expect(tick.alert?.cameras.length).toBe(other?.alert?.cameras.length);
    }
  });

  it('still draws every camera while muted', () => {
    for (const tick of positionTicksOf(muted)) {
      expect(tick.alert?.cameras.length).toBeGreaterThan(0);
      expect(tick.alert?.globallyMuted).toBe(true);
      // A GLOBAL mute is not a per-camera mute: `CameraAssessment.muted` means
      // "MUTE THIS ONE" was used on this record, and nothing here did that.
      for (const camera of tick.alert?.cameras ?? []) expect(camera.muted).toBe(false);
    }
    for (const tick of positionTicksOf(unmuted)) expect(tick.alert?.globallyMuted).toBe(false);
  });

  it('behaves the same way when one camera is muted individually', () => {
    // The design's "MUTE THIS ONE" (INTEL CARD, Screens II A4). Same invariant,
    // different switch: the record must be untouched either way.
    const driver = createScenarioDriver('muted-drive', { skipMute: true });
    driver.engine.muteCamera(FIXTURE_CAMERA_IDS.readingTennessee);
    driver.drain();
    const perCamera = driver.finish();

    expect(perCamera.history).toStrictEqual([...unmuted.history]);
    expect(perCamera.exposure).toStrictEqual(unmuted.exposure);
    expect(perCamera.delivery.alertsDelivered).toBe(0);
    for (const tick of perCamera.ticks.filter((t) => t.kind === 'position')) {
      expect(tick.alert?.globallyMuted).toBe(false);
      for (const camera of tick.alert?.cameras ?? []) expect(camera.muted).toBe(true);
      if (tick.state !== 'clear') expect(tick.suppressedBy).toContain('muted');
    }
  });

  it('delivers nothing, and says muting is why', () => {
    expect(muted.delivery.alertsDelivered).toBe(0);
    expect(muted.delivery.notificationsSuppressed).toBeGreaterThan(0);
    expect(unmuted.delivery.alertsDelivered).toBeGreaterThan(0);
    const suppressed = positionTicksOf(muted).filter((tick) => tick.state !== 'clear');
    expect(suppressed.length).toBeGreaterThan(0);
    for (const tick of suppressed) {
      expect(tick.shouldAlertUser).toBe(false);
      expect(tick.suppressedBy).toContain('muted');
    }
  });

  it('stays outside the mute-pierce radius, so the mute is what is being tested', () => {
    for (const tick of positionTicksOf(muted)) {
      expect(tick.nearestDistanceFt).toBeGreaterThan(DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT);
    }
  });
});

// ---------------------------------------------------------------------------
// registry hygiene
// ---------------------------------------------------------------------------

describe('the scenario registry', () => {
  it('has every id the task names', () => {
    expect([...SCENARIO_IDS].sort((a, b) => a.localeCompare(b))).toStrictEqual([
      'approaching-to-in-range',
      'clear-to-approaching',
      'gps-lost',
      'multiple-cameras',
      'muted-drive',
      'stationary-at-light',
      'threshold-flap',
    ]);
  });

  it('keys every entry by its own id', () => {
    for (const id of SCENARIO_IDS) expect(SCENARIOS[id].id).toBe(id);
  });

  it('has each scenario cross at least one boundary', () => {
    for (const id of SCENARIO_IDS) {
      expect(scenario(id).expectedTransitions.length).toBeGreaterThan(0);
    }
  });

  it('throws on an unknown id', () => {
    expect(() => scenario('not-a-scenario' as ScenarioId)).toThrow(RangeError);
  });
});
