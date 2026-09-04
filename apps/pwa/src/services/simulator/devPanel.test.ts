/**
 * The headless dev-panel controller: state, verbs, and the privacy rule that
 * it never renders a full-precision coordinate.
 */

import { describe, expect, it } from 'vitest';

import { REDACTION_DECIMALS, redactCoordinate } from '../adapters/geolocation.ts';
import { DEFAULT_ALERT_THRESHOLD_FT, DEFAULT_GPS_ACCURACY_LIMIT_M } from './fwmCore.ts';
import { DEV_PANEL_ENABLED, createDevPanel } from './devPanel.ts';
import { SCENARIO_IDS, scenario } from './scenarios.ts';
import { FIXTURE_CAMERA_IDS } from '../../test/fixtures/cameras.ts';

describe('an unloaded panel', () => {
  it('lists the scenarios and claims nothing else', () => {
    const panel = createDevPanel();
    const state = panel.state();
    expect(state.scenarioIds).toStrictEqual(SCENARIO_IDS);
    expect(state.loaded).toBe(false);
    expect(state.scenarioId).toBeNull();
    expect(state.alertState).toBe('clear');
    expect(state.approxLat).toBeNull();
    expect(state.exposure).toBeNull();
    expect(panel.run()).toBeNull();
    expect(state.enabled).toBe(DEV_PANEL_ENABLED);
    panel.dispose();
  });

  it('ignores every control instead of throwing', () => {
    const panel = createDevPanel();
    expect(panel.step()).toStrictEqual([]);
    expect(panel.runToEnd()).toStrictEqual([]);
    panel.pause();
    panel.resume();
    panel.setFixLost(true);
    panel.muteAll();
    panel.unmuteAll();
    expect(panel.state().loaded).toBe(false);
    panel.dispose();
  });

  it('refuses an id that is not a scenario, and says so', () => {
    const panel = createDevPanel();
    expect(panel.loadById('nope')).toBe(false);
    expect(panel.state().loaded).toBe(false);
    expect(panel.loadById('threshold-flap')).toBe(true);
    expect(panel.state().scenarioId).toBe('threshold-flap');
    panel.dispose();
  });
});

describe('driving a loaded scenario', () => {
  it('publishes on load and on every control', () => {
    const panel = createDevPanel();
    const seen: number[] = [];
    const unsubscribe = panel.subscribe((state) => seen.push(state.tickCount));
    expect(seen).toStrictEqual([0]); // subscribe replays the current state

    panel.load('approaching-to-in-range');
    panel.step();
    panel.step(2);
    expect(seen).toStrictEqual([0, 0, 1, 3]);

    unsubscribe();
    panel.step();
    expect(seen).toStrictEqual([0, 0, 1, 3]);
    panel.dispose();
  });

  it('tracks the drive and the engine together', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.step();
    const first = panel.state();
    expect(first.loaded).toBe(true);
    expect(first.title).toBe(scenario('approaching-to-in-range').title);
    expect(first.alertState).toBe('approaching');
    expect(first.nearestCameraId).toBe(FIXTURE_CAMERA_IDS.readingTennessee);
    expect(first.nearestDistanceFt).toBeCloseTo(900, 3);
    expect(first.thresholdFt).toBe(DEFAULT_ALERT_THRESHOLD_FT);
    expect(first.cameras).toHaveLength(1);
    expect(first.speedMph).toBeCloseTo(47, 6);
    expect(first.routeTotalFt).toBeCloseTo(600, 3);

    panel.runToEnd();
    const done = panel.state();
    expect(done.ended).toBe(true);
    expect(done.alertState).toBe('in_range');
    expect(done.transitions).toStrictEqual(['approaching', 'in_range']);
    expect(done.matchesExpectation).toBe(true);
    expect(done.exposure?.camerasInRangeCount).toBe(1);
    expect(done.delivery?.alertsDelivered).toBeGreaterThan(0);
    panel.dispose();
  });

  it('reads a part-run as matching, not as a mismatch', () => {
    const panel = createDevPanel({ initialScenarioId: 'multiple-cameras' });
    // Stop one tick short of the `multiple` crossing at tick 13.
    panel.step(13);
    const partial = panel.state();
    expect(partial.transitions.length).toBeLessThan(partial.expectedTransitions.length);
    expect(partial.matchesExpectation).toBe(true);
    panel.dispose();
  });

  it('reloads from the start line', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.runToEnd();
    expect(panel.state().tickCount).toBeGreaterThan(0);
    panel.reload();
    const state = panel.state();
    expect(state.tickCount).toBe(0);
    expect(state.alertState).toBe('clear');
    expect(state.transitions).toStrictEqual([]);
    panel.dispose();
  });

  it('unloads back to nothing', () => {
    const panel = createDevPanel({ initialScenarioId: 'gps-lost' });
    panel.step(3);
    panel.unload();
    expect(panel.state().loaded).toBe(false);
    expect(panel.run()).toBeNull();
    panel.dispose();
  });

  it('rejects a step count that is not a positive integer', () => {
    const panel = createDevPanel({ initialScenarioId: 'gps-lost' });
    expect(() => panel.step(0)).toThrow(RangeError);
    expect(() => panel.step(1.5)).toThrow(RangeError);
    panel.dispose();
  });
});

describe('the controls', () => {
  it('pauses and resumes the drive', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.step(2);
    const routeFt = panel.state().routeFt;
    panel.pause();
    expect(panel.step(3)).toStrictEqual([]);
    expect(panel.state().routeFt).toBe(routeFt);
    expect(panel.state().paused).toBe(true);
    panel.resume();
    expect(panel.step()).toHaveLength(1);
    expect(panel.state().routeFt).toBeGreaterThan(routeFt);
    panel.dispose();
  });

  it('jumps to a waypoint, and the next tick advances from there', () => {
    // The flap route alternates: even waypoints sit at the near swing, odd ones
    // at the far swing, one leg apart.
    const panel = createDevPanel({ initialScenarioId: 'threshold-flap' });
    panel.step();

    panel.jumpToWaypoint(4);
    // The jump repositions immediately; it does not emit a tick, so the alert
    // readout still describes the last fix until one more tick is taken.
    expect(panel.state().routeFt).toBeCloseTo(200, 2);

    panel.step();
    // One leg on from waypoint 4 is waypoint 5 - the far swing, outside the
    // entry threshold but still inside the exit threshold.
    expect(panel.state().routeFt).toBeCloseTo(250, 2);
    expect(panel.state().nearestDistanceFt).toBeGreaterThan(DEFAULT_ALERT_THRESHOLD_FT);

    // And from an odd waypoint the next tick lands on an even one - the near
    // swing, inside the threshold.
    panel.jumpToWaypoint(7);
    panel.step();
    expect(panel.state().nearestDistanceFt).toBeLessThan(DEFAULT_ALERT_THRESHOLD_FT);
    panel.dispose();
  });

  it('overrides speed in mph, the unit it displays', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.setSpeedOverrideMph(15);
    panel.step(2);
    expect(panel.state().speedOverrideMph).toBeCloseTo(15, 9);
    expect(panel.state().speedMph).toBeCloseTo(15, 9);
    panel.setSpeedOverrideMph(null);
    expect(panel.state().speedOverrideMph).toBeNull();
    panel.dispose();
  });

  it('degrades accuracy until the engine refuses to alert', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.setAccuracyOverrideM(DEFAULT_GPS_ACCURACY_LIMIT_M + 25);
    panel.runToEnd();
    const state = panel.state();
    expect(state.alertState).toBe('in_range');
    expect(state.shouldAlertUser).toBe(false);
    expect(state.suppressedBy).toContain('accuracy');
    expect(state.delivery?.alertsDelivered).toBe(0);
    panel.dispose();
  });

  it('drops the fix and reports how stale the last one is', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.step(2);
    const stateBefore = panel.state().alertState;
    panel.setFixLost(true);
    panel.step(3);
    const state = panel.state();
    expect(state.fixLost).toBe(true);
    expect(state.alertState).toBe(stateBefore);
    expect(state.fixAgeMs).toBe(3000);
    // Nothing is buzzing during an outage, and the panel must not claim it is.
    expect(state.shouldAlertUser).toBe(false);
    expect(state.hapticPulses).toBe(0);
    panel.dispose();
  });

  it('mutes globally and per camera without touching the record', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.muteAll();
    panel.runToEnd();
    const muted = panel.state();
    expect(muted.globallyMuted).toBe(true);
    expect(muted.globalMuteRemainingMs).toBeGreaterThan(0);
    expect(muted.suppressedBy).toContain('muted');
    // The record is untouched: same states, same exposure, no delivery.
    expect(muted.transitions).toStrictEqual(['approaching', 'in_range']);
    expect(muted.exposure?.camerasInRangeCount).toBe(1);
    expect(muted.delivery?.alertsDelivered).toBe(0);
    expect(muted.cameras).toHaveLength(1);

    panel.unmuteAll();
    expect(panel.state().globallyMuted).toBe(false);

    panel.reload();
    panel.muteCamera(FIXTURE_CAMERA_IDS.readingTennessee);
    panel.runToEnd();
    expect(panel.state().cameras[0]?.muted).toBe(true);
    expect(panel.state().globallyMuted).toBe(false);
    panel.unmuteCamera(FIXTURE_CAMERA_IDS.readingTennessee);
    panel.dispose();
  });

  it('moves the threshold, and refuses one off the slider', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.setThresholdFt(1000);
    expect(panel.state().thresholdFt).toBe(1000);
    panel.step();
    // At 900 ft with a 1000 ft threshold, the very first tick is in range.
    expect(panel.state().alertState).toBe('in_range');
    expect(() => panel.setThresholdFt(25)).toThrow(RangeError);
    expect(() => panel.setThresholdFt(5000)).toThrow(RangeError);
    panel.dispose();
  });
});

describe('privacy', () => {
  it('never publishes a full-precision coordinate', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.step(3);
    const state = panel.state();
    expect(state.approxLat).not.toBeNull();
    expect(state.approxLon).not.toBeNull();
    expect(state.coordinatePrecision).toBe('approx-3dp');
    expect(state.coordinateDecimals).toBe(REDACTION_DECIMALS);

    // Exactly the adapter's own rounding, and no more precision than that.
    const run = panel.run();
    const tick = run?.ticks[run.ticks.length - 1];
    const lat = tick?.alert?.nearest?.lat;
    expect(lat).toBeDefined();
    expect(state.approxLat).toBe(redactCoordinate(state.approxLat ?? 0));
    expect(state.approxLon).toBe(redactCoordinate(state.approxLon ?? 0));

    const decimalsOf = (value: number): number => (value.toString().split('.')[1] ?? '').length;
    expect(decimalsOf(state.approxLat ?? 0)).toBeLessThanOrEqual(REDACTION_DECIMALS);
    expect(decimalsOf(state.approxLon ?? 0)).toBeLessThanOrEqual(REDACTION_DECIMALS);
    panel.dispose();
  });

  it('carries no plate anywhere in its state', () => {
    const panel = createDevPanel({ initialScenarioId: 'approaching-to-in-range' });
    panel.runToEnd();
    const serialised = JSON.stringify(panel.state());
    expect(serialised).not.toMatch(/plate/i);
    expect(serialised).not.toContain('HVK');
    panel.dispose();
  });
});
