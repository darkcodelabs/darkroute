/**
 * The simulator's controls, and the claims its header makes about them.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GPS_ACCURACY_LIMIT_M,
  MOTION_STATIONARY_VETO_MPS2,
  createAlertEngine,
  createTestClock,
  distanceFt,
  feetToMetres,
  metresToFeet,
  mphToMetresPerSecond,
  type TestClock,
} from './fwmCore.ts';
import {
  DEFAULT_SIMULATED_ACCURACY_M,
  constantSpeed,
  createDriveSimulator,
  distanceTravelledM,
  fixLostTicks,
  phasedSpeed,
  positionTicks,
  profileDurationMs,
  speedAtMs,
  toGeoFix,
  toPositionFix,
  type DriveSimulator,
} from './driveSimulator.ts';
import { pointAtDistanceFt, straightSegment, type LatLon } from './geometry.ts';
import {
  DESIGN_REPORT_POSITION,
  FIXTURE_CAMERA_IDS,
  fixtureCamera,
  toCameraLikes,
} from '../../test/fixtures/cameras.ts';
import { runScenario } from './scenarios.ts';

const ORIGIN: LatLon = { lat: DESIGN_REPORT_POSITION.lat, lon: DESIGN_REPORT_POSITION.lon };
const CITY_MPS = mphToMetresPerSecond(47);

function makeSimulator(
  overrides: {
    readonly speedMps?: number;
    readonly lengthFt?: number;
    readonly stepFt?: number;
    readonly headless?: boolean;
  } = {},
): { simulator: DriveSimulator; clock: TestClock } {
  const clock = createTestClock(0);
  const simulator = createDriveSimulator({
    route: straightSegment(ORIGIN, 0, overrides.lengthFt ?? 2000, overrides.stepFt ?? 500),
    speedProfile: constantSpeed(overrides.speedMps ?? CITY_MPS),
    clock,
    tickIntervalMs: 1000,
    ...(overrides.headless === false ? {} : { advanceClock: (ms: number): void => { clock.advance(ms); } }),
  });
  return { simulator, clock };
}

// ---------------------------------------------------------------------------
// Speed profiles
// ---------------------------------------------------------------------------

describe('speed profiles', () => {
  const profile = phasedSpeed([
    { durationMs: 2000, mps: 10, label: 'roll' },
    { durationMs: 3000, mps: 0, label: 'light' },
    { durationMs: 1000, mps: 20, label: 'go' },
  ]);

  it('treats phase boundaries as half-open, so the instant of the stop reports zero', () => {
    expect(speedAtMs(profile, 0)).toBe(10);
    expect(speedAtMs(profile, 1999)).toBe(10);
    expect(speedAtMs(profile, 2000)).toBe(0);
    expect(speedAtMs(profile, 4999)).toBe(0);
    expect(speedAtMs(profile, 5000)).toBe(20);
    expect(speedAtMs(profile, 6000)).toBe(0);
  });

  it('integrates exactly across a boundary rather than sampling one end of it', () => {
    // A tick straddling the stop: 0.5 s at 10 m/s, 0.5 s at 0.
    expect(distanceTravelledM(profile, 1500, 2500)).toBeCloseTo(5, 12);
    expect(distanceTravelledM(profile, 0, 2000)).toBeCloseTo(20, 12);
    expect(distanceTravelledM(profile, 0, 5000)).toBeCloseTo(20, 12);
    expect(distanceTravelledM(profile, 0, 6000)).toBeCloseTo(40, 12);
    // Past the phases, the tail speed applies.
    expect(distanceTravelledM(profile, 6000, 7000)).toBe(0);
    expect(distanceTravelledM(phasedSpeed([{ durationMs: 1000, mps: 1 }], 5), 1000, 2000)).toBe(5);
  });

  it('measures a constant profile the simple way', () => {
    expect(distanceTravelledM(constantSpeed(10), 0, 2500)).toBe(25);
    expect(profileDurationMs(constantSpeed(10))).toBe(Number.POSITIVE_INFINITY);
    expect(profileDurationMs(profile)).toBe(6000);
  });

  it('refuses time running backwards and a malformed profile', () => {
    expect(() => distanceTravelledM(profile, 100, 0)).toThrow(RangeError);
    expect(() => phasedSpeed([])).toThrow(RangeError);
    expect(() => phasedSpeed([{ durationMs: 0, mps: 1 }])).toThrow(RangeError);
    expect(() => phasedSpeed([{ durationMs: 1, mps: -1 }])).toThrow(RangeError);
    expect(() => constantSpeed(-1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Ticking
// ---------------------------------------------------------------------------

describe('ticking', () => {
  it('emits a GeolocationPosition-shaped tick from the injected clock', () => {
    const { simulator, clock } = makeSimulator();
    clock.set(1_700_000_000_000);
    const tick = simulator.step();
    expect(tick?.kind).toBe('position');
    if (tick?.kind !== 'position') return;
    expect(tick.position.timestamp).toBe(1_700_000_000_000);
    expect(tick.position.coords.accuracy).toBe(DEFAULT_SIMULATED_ACCURACY_M);
    expect(tick.position.coords.speed).toBeCloseTo(CITY_MPS, 12);
    expect(tick.position.coords.heading).toBeCloseTo(0, 3);
    // Nothing is simulated that is not simulated.
    expect(tick.position.coords.altitude).toBeNull();
    expect(tick.position.coords.altitudeAccuracy).toBeNull();
  });

  it('advances by speed times elapsed clock time, not by the tick interval', () => {
    const { simulator, clock } = makeSimulator();
    simulator.step();
    clock.advance(2000);
    const tick = simulator.step();
    expect(tick?.kind).toBe('position');
    if (tick?.kind !== 'position') return;
    expect(tick.routeM).toBeCloseTo(CITY_MPS * 2, 9);
  });

  it('emits the tick that lands on the end of the route and nothing after it', () => {
    const { simulator } = makeSimulator({ lengthFt: 200, speedMps: feetToMetres(100) });
    const ticks = simulator.runToEnd();
    expect(ticks).toHaveLength(3); // 0 ft, 100 ft, 200 ft
    expect(simulator.snapshot().ended).toBe(true);
    expect(simulator.step()).toBeNull();
  });

  it('refuses a clock that runs backwards', () => {
    const { simulator, clock } = makeSimulator();
    simulator.step();
    clock.set(-1000);
    expect(() => simulator.step()).toThrow(RangeError);
  });

  it('will not invent a way to make time pass', () => {
    const clock = createTestClock(0);
    const simulator = createDriveSimulator({
      route: straightSegment(ORIGIN, 0, 1000),
      speedProfile: constantSpeed(CITY_MPS),
      clock,
      tickIntervalMs: 1000,
    });
    expect(simulator.snapshot().canRunHeadless).toBe(false);
    expect(() => simulator.runTicks(3)).toThrow(/advanceClock/);
  });

  it('notifies subscribers and stops when unsubscribed', () => {
    const { simulator } = makeSimulator();
    const seen: number[] = [];
    const unsubscribe = simulator.subscribe((tick) => seen.push(tick.tickIndex));
    simulator.runTicks(3);
    expect(seen).toStrictEqual([0, 1, 2]);
    unsubscribe();
    simulator.runTicks(2);
    expect(seen).toStrictEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Pause is not a stop
// ---------------------------------------------------------------------------

describe('pause and resume', () => {
  it('emits nothing while paused and does not move the car', () => {
    const { simulator, clock } = makeSimulator();
    simulator.runTicks(3);
    const before = simulator.snapshot().routeM;

    simulator.pause();
    expect(simulator.isPaused()).toBe(true);
    clock.advance(60_000);
    expect(simulator.step()).toBeNull();
    expect(simulator.snapshot().routeM).toBe(before);
  });

  it('does not teleport the car forward by the time spent paused', () => {
    const { simulator, clock } = makeSimulator();
    simulator.runTicks(3);
    const before = simulator.snapshot().routeM;

    simulator.pause();
    clock.advance(60_000);
    simulator.resume();
    clock.advance(1000);
    simulator.step();
    // One second of travel, not sixty-one.
    expect(simulator.snapshot().routeM - before).toBeCloseTo(CITY_MPS, 6);
  });

  it('is not the same thing as a stop: a zero-speed phase still emits ticks', () => {
    const clock = createTestClock(0);
    const simulator = createDriveSimulator({
      route: straightSegment(ORIGIN, 0, 5000),
      speedProfile: phasedSpeed([{ durationMs: 10_000, mps: 0, label: 'red light' }], CITY_MPS),
      clock,
      tickIntervalMs: 1000,
      advanceClock: (ms: number): void => { clock.advance(ms); },
    });
    const ticks = positionTicks(simulator.runTicks(5));
    expect(ticks).toHaveLength(5);
    for (const tick of ticks) {
      expect(tick.routeM).toBe(0);
      expect(tick.position.coords.speed).toBe(0);
      // Real GPS reports no heading when the vehicle is not moving.
      expect(tick.position.coords.heading).toBeNull();
      expect(tick.phaseLabel).toBe('red light');
    }
  });
});

// ---------------------------------------------------------------------------
// Jumping and overrides
// ---------------------------------------------------------------------------

describe('jumping', () => {
  it('teleports to a waypoint without rewinding the speed profile', () => {
    const clock = createTestClock(0);
    const simulator = createDriveSimulator({
      route: straightSegment(ORIGIN, 0, 2000, 500),
      speedProfile: phasedSpeed([{ durationMs: 3000, mps: CITY_MPS, label: 'a' }], 0),
      clock,
      tickIntervalMs: 1000,
      advanceClock: (ms: number): void => { clock.advance(ms); },
    });
    simulator.runTicks(2);
    const elapsedBefore = simulator.snapshot().elapsedMs;

    simulator.jumpToWaypoint(3);
    const snapshot = simulator.snapshot();
    expect(metresToFeet(snapshot.routeM)).toBeCloseTo(1500, 4);
    expect(snapshot.elapsedMs).toBe(elapsedBefore);
  });

  it('un-ends a finished drive when jumping back onto the route', () => {
    const { simulator } = makeSimulator({ lengthFt: 200, speedMps: feetToMetres(100) });
    simulator.runToEnd();
    expect(simulator.snapshot().ended).toBe(true);
    simulator.jumpToWaypoint(0);
    expect(simulator.snapshot().ended).toBe(false);
    expect(simulator.step()).not.toBeNull();
  });

  it('rejects an index off the end of the route', () => {
    const { simulator } = makeSimulator();
    expect(() => simulator.jumpToWaypoint(-1)).toThrow(RangeError);
    expect(() => simulator.jumpToWaypoint(999)).toThrow(RangeError);
  });
});

describe('overrides', () => {
  it('replaces the profile speed until handed back', () => {
    const { simulator } = makeSimulator();
    simulator.step();
    simulator.setSpeedOverrideMps(10);
    simulator.runTicks(2);
    // One tick was already spent at index 0; the override covers the second.
    expect(simulator.snapshot().speedMps).toBe(10);
    simulator.setSpeedOverrideMps(null);
    expect(simulator.snapshot().speedMps).toBeCloseTo(CITY_MPS, 12);
    expect(() => simulator.setSpeedOverrideMps(-1)).toThrow(RangeError);
  });

  it('degrades accuracy on demand, and the engine stops alerting because of it', () => {
    const loose = DEFAULT_GPS_ACCURACY_LIMIT_M + 30;
    const gated = runScenario('approaching-to-in-range', { accuracyM: loose });
    const clean = runScenario('approaching-to-in-range');

    // The state machine is untouched: a loose fix suppresses delivery only.
    expect(gated.transitions).toStrictEqual([...clean.transitions]);
    expect(gated.history).toStrictEqual([...clean.history]);
    expect(gated.exposure).toStrictEqual(clean.exposure);

    expect(gated.delivery.alertsDelivered).toBe(0);
    const alerting = gated.ticks.filter((tick) => tick.state !== 'clear');
    expect(alerting.length).toBeGreaterThan(0);
    for (const tick of alerting) {
      expect(tick.shouldAlertUser).toBe(false);
      expect(tick.suppressedBy).toContain('accuracy');
      expect(tick.alert?.accuracyM).toBe(loose);
    }
    expect(() => makeSimulator().simulator.setAccuracyOverrideM(-1)).toThrow(RangeError);
  });

  it('can withhold speed, forcing the engine down its derived-speed fallback', () => {
    const withheld = runScenario('approaching-to-in-range', { reportSpeed: false });
    const reported = runScenario('approaching-to-in-range');

    expect(withheld.transitions).toStrictEqual([...reported.transitions]);
    const sources = withheld.ticks.map((tick) => tick.alert?.speedSource);
    expect(sources[0]).toBe('unknown');
    expect(sources.slice(1).every((source) => source === 'derived')).toBe(true);
    expect(reported.ticks.every((tick) => tick.alert?.speedSource === 'gps')).toBe(true);

    // The derived speed has to be close to the real one, or the stationary
    // logic would be reading a fiction.
    const settled = withheld.ticks[withheld.ticks.length - 2];
    expect(settled?.speedMps).toBeGreaterThan(CITY_MPS * 0.99);
    expect(settled?.speedMps).toBeLessThan(CITY_MPS * 1.01);

    // The FINAL tick is deliberately not asserted against that band. The route
    // ends mid-interval, so the last sample covers less ground than a whole
    // tick and a position-delta speed reads low - which is exactly what a real
    // GPS-derived speed does when the car stops between samples, and is why
    // the engine treats a derived speed as weaker evidence than a reported one.
    const last = withheld.ticks[withheld.ticks.length - 1];
    expect(last?.speedMps).toBeLessThan(settled?.speedMps ?? 0);
    expect(last?.alert?.speedSource).toBe('derived');
  });
});

// ---------------------------------------------------------------------------
// Losing the fix
// ---------------------------------------------------------------------------

describe('losing the fix', () => {
  it('stops the positions without stopping the vehicle', () => {
    const { simulator } = makeSimulator();
    simulator.runTicks(2);
    const routeBefore = simulator.snapshot().routeM;

    simulator.setFixLost(true);
    expect(simulator.isFixLost()).toBe(true);
    const outage = simulator.runTicks(3);
    expect(fixLostTicks(outage)).toHaveLength(3);
    expect(positionTicks(outage)).toHaveLength(0);
    // The car covered ground while the phone had nothing to say about it.
    expect(simulator.snapshot().routeM).toBeGreaterThan(routeBefore);

    simulator.setFixLost(false);
    const back = simulator.step();
    expect(back?.kind).toBe('position');
  });

  it('reports the age of the last real fix, which is what NO GPS renders', () => {
    const { simulator } = makeSimulator();
    simulator.runTicks(1);
    simulator.setFixLost(true);
    const ticks = fixLostTicks(simulator.runTicks(3));
    expect(ticks.map((tick) => tick.fixAgeMs)).toStrictEqual([1000, 2000, 3000]);
    for (const tick of ticks) expect(tick.reason).toBe('simulator-lose-fix');
  });

  it('has no fix age before the first fix, rather than a plausible number', () => {
    const { simulator } = makeSimulator();
    simulator.setFixLost(true);
    const [tick] = fixLostTicks(simulator.runTicks(1));
    expect(tick?.lastFixAtMs).toBeNull();
    expect(tick?.fixAgeMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

describe('projections', () => {
  it('maps a simulated position onto the engine fix and the adapter fix', () => {
    const { simulator } = makeSimulator();
    const [tick] = positionTicks(simulator.runTicks(2));
    expect(tick).toBeDefined();
    if (tick === undefined) return;

    const fix = toPositionFix(tick.position);
    expect(fix.lat).toBe(tick.position.coords.latitude);
    expect(fix.lon).toBe(tick.position.coords.longitude);
    expect(fix.timestampMs).toBe(tick.position.timestamp);
    // exactOptionalPropertyTypes: the field is absent, not undefined.
    expect(Object.hasOwn(fix, 'motionMagnitudeMps2')).toBe(false);
    expect(Object.hasOwn(toPositionFix(tick.position, { motionMagnitudeMps2: 1 }), 'motionMagnitudeMps2')).toBe(true);

    const geo = toGeoFix(tick.position);
    expect(geo.accuracyM).toBe(tick.position.coords.accuracy);
    expect(geo.altitudeM).toBeNull();
    expect(geo.timestamp).toBe(tick.position.timestamp);
  });

  it('lets device motion veto a stationary conclusion without ever setting a speed', () => {
    const camera = fixtureCamera(FIXTURE_CAMERA_IDS.readingTennessee);
    const cameras = toCameraLikes([camera]);
    const start = pointAtDistanceFt(camera, 180, 400);

    const build = (motion: number | null): { stationary: boolean; speedMps: number | null } => {
      const clock = createTestClock(0);
      const simulator = createDriveSimulator({
        route: [start, pointAtDistanceFt(camera, 180, 399)],
        speedProfile: constantSpeed(0),
        clock,
        tickIntervalMs: 1000,
        advanceClock: (ms: number): void => { clock.advance(ms); },
      });
      const engine = createAlertEngine({ clock });
      let last = engine.update(toPositionFix({ coords: { latitude: start.lat, longitude: start.lon, accuracy: 4, altitude: null, altitudeAccuracy: null, heading: null, speed: 0 }, timestamp: 0 }), cameras);
      for (let i = 0; i < 200; i++) {
        clock.advance(1000);
        const tick = simulator.step();
        if (tick === null || tick.kind !== 'position') break;
        last = engine.update(toPositionFix(tick.position, { motionMagnitudeMps2: motion }), cameras);
      }
      return { stationary: last.stationary, speedMps: last.speedMps };
    };

    // Parked: the dwell elapses and delivery goes quiet.
    expect(build(null).stationary).toBe(true);
    // Same zero speed, but the accelerometer says otherwise.
    const vetoed = build(MOTION_STATIONARY_VETO_MPS2 * 2);
    expect(vetoed.stationary).toBe(false);
    // Motion is supporting evidence only. It never becomes a speed.
    expect(vetoed.speedMps).toBe(0);
  });

  it('keeps the simulated position on the road it was given', () => {
    const camera = fixtureCamera(FIXTURE_CAMERA_IDS.readingTennessee);
    const clock = createTestClock(0);
    const simulator = createDriveSimulator({
      route: [pointAtDistanceFt(camera, 180, 900), pointAtDistanceFt(camera, 180, 300)],
      speedProfile: constantSpeed(feetToMetres(100)),
      clock,
      tickIntervalMs: 1000,
      advanceClock: (ms: number): void => { clock.advance(ms); },
    });
    const distances = positionTicks(simulator.runToEnd()).map((tick) =>
      distanceFt(tick.position.coords.latitude, tick.position.coords.longitude, camera.lat, camera.lon),
    );
    // Straight at the camera along a meridian, 100 ft a tick.
    expect(distances[0]).toBeCloseTo(900, 4);
    expect(distances[1]).toBeCloseTo(800, 4);
    expect(distances[distances.length - 1]).toBeCloseTo(300, 4);
  });
});

describe('construction', () => {
  it('rejects a route, hz or interval that cannot describe a drive', () => {
    const clock = createTestClock(0);
    const base = { speedProfile: constantSpeed(1), clock } as const;
    expect(() => createDriveSimulator({ ...base, route: [ORIGIN] })).toThrow(RangeError);
    expect(() => createDriveSimulator({ ...base, route: straightSegment(ORIGIN, 0, 10), hz: 0 })).toThrow(RangeError);
    expect(() =>
      createDriveSimulator({ ...base, route: straightSegment(ORIGIN, 0, 10), tickIntervalMs: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      createDriveSimulator({ ...base, route: straightSegment(ORIGIN, 0, 10), accuracyM: -1 }),
    ).toThrow(RangeError);
  });

  it('resets to the start line', () => {
    const { simulator } = makeSimulator();
    simulator.runTicks(4);
    expect(simulator.snapshot().routeM).toBeGreaterThan(0);
    simulator.reset();
    const snapshot = simulator.snapshot();
    expect(snapshot.routeM).toBe(0);
    expect(snapshot.elapsedMs).toBe(0);
    expect(snapshot.tickCount).toBe(0);
    expect(snapshot.started).toBe(false);
    expect(simulator.lastPosition()).toBeNull();
  });
});
