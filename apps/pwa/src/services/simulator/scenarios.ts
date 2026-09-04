/**
 * NAMED SCENARIOS - each one crosses a state boundary on purpose.
 * =============================================================================
 * Seven drives. Every one of them runs the SAME `AlertEngine` the phone runs,
 * with an injected `TestClock`, against fixture cameras, and every one of them
 * declares up front the exact sequence of `AlertState` transitions it produces.
 * `scenarios.test.ts` asserts that sequence. A scenario whose declared sequence
 * stops matching is a scenario that has stopped proving anything, and the test
 * fails rather than the expectation being edited to match.
 *
 * ---------------------------------------------------------------------------
 * WHY THE GEOMETRY IS ALL NORTH-SOUTH
 *
 * Every route here runs along the meridian through its target camera: the
 * vehicle starts due south of the camera and drives due north. That is not
 * scenery, it is arithmetic. Along a single meridian geodesic distances ADD, so
 * a vehicle placed 900.00 ft south of a camera and driven 68.93 ft is
 * 831.07 ft from it - exactly, by the engine's own Vincenty, with no
 * cross-track term to round. A diagonal approach would put every threshold
 * assertion at the mercy of a fourth decimal place.
 *
 * The waypoints are produced by `pointAtDistanceFt`, which converges against
 * `@fwm/core`'s `distanceM`, so "900 ft from the camera" is 900 ft as measured
 * by the code under test rather than as measured by something else.
 *
 * ---------------------------------------------------------------------------
 * WHAT EACH ONE IS FOR
 *
 *   clear-to-approaching      crossing the 1000 ft outer edge inward.
 *   approaching-to-in-range   crossing the 500 ft threshold inward.
 *   multiple-cameras          a second camera entering the widened threshold,
 *                             one tick after the first - in_range → multiple.
 *   threshold-flap            twelve swings across 500 ft that produce exactly
 *                             ONE transition, because the exit threshold is
 *                             550 ft. Hysteresis, proved.
 *   stationary-at-light       150 s stopped inside the threshold: the state
 *                             never moves, the alert goes quiet after the dwell
 *                             and comes back after the restore dwell.
 *   gps-lost                  six ticks with no fix at all. The engine is not
 *                             called, the state is untouched, and nothing is
 *                             invented to fill the gap.
 *   muted-drive               the same drive as approaching-to-in-range with a
 *                             global mute on. Identical history, identical
 *                             exposure, zero alerts delivered.
 */

import {
  createAlertEngine,
  createTestClock,
  feetToMetres,
  mphToMetresPerSecond,
  type AlertEngine,
  type AlertEngineOptions,
  type AlertHistoryEntry,
  type AlertState,
  type AlertTick,
  type CameraLike,
  type DeliveryStats,
  type ExposureSnapshot,
  type SuppressionReason,
  type TestClock,
} from './fwmCore.ts';
import {
  DEFAULT_SIMULATED_ACCURACY_M,
  constantSpeed,
  createDriveSimulator,
  phasedSpeed,
  toPositionFix,
  type DriveSimulator,
  type SpeedProfile,
} from './driveSimulator.ts';
import { pointAtDistanceFt, type LatLon } from './geometry.ts';
import {
  FIXTURE_CAMERA_IDS,
  fixtureCamera,
  fixtureCameras,
  toCameraLikes,
} from '../../test/fixtures/cameras.ts';

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

/** Due north of the camera. */
const NORTHWARD_DEG = 0;
/** Due south of the camera. */
const SOUTHWARD_DEG = 180;

/**
 * A point on the camera's meridian.
 *
 * `signedFt` is positive north of the camera and negative south of it, so a
 * route written `[-900, -300]` reads as "start 900 ft short of it, stop 300 ft
 * short of it" and `[-1000, 312]` reads as "drive past it".
 */
function meridianPoint(camera: LatLon, signedFt: number): LatLon {
  if (signedFt === 0) return { lat: camera.lat, lon: camera.lon };
  return signedFt > 0
    ? pointAtDistanceFt(camera, NORTHWARD_DEG, signedFt)
    : pointAtDistanceFt(camera, SOUTHWARD_DEG, -signedFt);
}

/** A straight run along the camera's meridian, from one signed offset to another. */
function meridianRoute(cameraId: string, fromSignedFt: number, toSignedFt: number): LatLon[] {
  const camera = fixtureCamera(cameraId);
  return [meridianPoint(camera, fromSignedFt), meridianPoint(camera, toSignedFt)];
}

// ---------------------------------------------------------------------------
// Design-sourced speeds
// ---------------------------------------------------------------------------

/** "14:22:08 · 47 MPH · 380 FT" - the LOG timeline's city speed. */
const CITY_MPH = 47;
/** "13:58:12 · 62 MPH · 210 FT" - the LOG timeline's highway speed. */
const HIGHWAY_MPH = 62;

const CITY_MPS = mphToMetresPerSecond(CITY_MPH);
const HIGHWAY_MPS = mphToMetresPerSecond(HIGHWAY_MPH);

/** One second between fixes, which is what a phone GPS actually delivers. */
const ONE_HZ_MS = 1000;
/** Twice a second, used only where a boundary is finer than a 1 Hz step. */
const TWO_HZ_MS = 500;

// ---------------------------------------------------------------------------
// Scenario shapes
// ---------------------------------------------------------------------------

export type ScenarioId =
  | 'clear-to-approaching'
  | 'approaching-to-in-range'
  | 'multiple-cameras'
  | 'threshold-flap'
  | 'stationary-at-light'
  | 'gps-lost'
  | 'muted-drive';

/** Hook run immediately before each tick, so a scenario can work the controls. */
export interface ScenarioTickContext {
  readonly tickIndex: number;
  readonly simulator: DriveSimulator;
  readonly engine: AlertEngine;
  readonly clock: TestClock;
}

export interface ScenarioDefinition {
  readonly id: ScenarioId;
  /** Short label for the dev panel. Lowercase, blunt. */
  readonly title: string;
  /** What crossing this drive proves. One sentence. */
  readonly proves: string;
  /** Fixture camera ids fed to the engine. The first is the route's anchor. */
  readonly cameraIds: readonly string[];
  readonly route: readonly LatLon[];
  readonly speedProfile: SpeedProfile;
  readonly tickIntervalMs: number;
  /** Hard cap so a broken scenario terminates instead of spinning. */
  readonly maxTicks: number;
  /** Engine configuration this scenario needs. Everything else is the default. */
  readonly engineOptions: Omit<AlertEngineOptions, 'clock'>;
  /** Global mute applied before the first tick. */
  readonly muteAllAtStart: boolean;
  /** The exact transition sequence the drive produces. Asserted by the tests. */
  readonly expectedTransitions: readonly AlertState[];
  /** Exact number of ticks emitted, position and outage together. Asserted. */
  readonly expectedTickCount: number;
  /**
   * How the drive stops.
   *
   * `true` - the road runs out, and `maxTicks` is only a runaway guard.
   * `false` - the drive is open-ended and `maxTicks` IS the length. Only
   * `threshold-flap` is like that: it oscillates in place, so "how long" is a
   * tick count rather than a distance.
   */
  readonly endsAtRouteEnd: boolean;
  readonly beforeTick?: (context: ScenarioTickContext) => void;
}

// ---------------------------------------------------------------------------
// threshold-flap geometry
// ---------------------------------------------------------------------------

/** Inside the 500 ft threshold. */
const FLAP_NEAR_FT = 480;
/**
 * Outside the 500 ft threshold but INSIDE the 550 ft exit threshold - which is
 * the whole point. The swing has to straddle the entry boundary without
 * reaching the exit one, or it is not testing hysteresis, it is testing
 * arithmetic.
 */
const FLAP_FAR_FT = 530;
const FLAP_SWING_FT = FLAP_FAR_FT - FLAP_NEAR_FT;
/** Twelve swings - enough that a missing hysteresis band is unmissable. */
const FLAP_LEGS = 12;

/**
 * Spare legs beyond the twelve that are actually driven.
 *
 * Without them the drive would end by running out of road on the same tick it
 * ends by running out of ticks, and which of the two wins would be decided by
 * whether twelve measured leg lengths sum to a hair more or a hair less than
 * twelve nominal ones - a coin flip at the seventh decimal place, and a
 * flaky tick count. With the headroom the tick cap always wins and the run
 * length is exact.
 */
const FLAP_SPARE_LEGS = 2;

function flapRoute(cameraId: string): LatLon[] {
  const camera = fixtureCamera(cameraId);
  const points: LatLon[] = [];
  for (let i = 0; i <= FLAP_LEGS + FLAP_SPARE_LEGS; i++) {
    points.push(meridianPoint(camera, i % 2 === 0 ? -FLAP_NEAR_FT : -FLAP_FAR_FT));
  }
  return points;
}

/**
 * One swing per tick.
 *
 * The speed is chosen so that a tick covers exactly one leg, which puts every
 * sample on a waypoint rather than somewhere between two. That removes
 * interpolation from a test about a boundary.
 */
const FLAP_MPS = feetToMetres(FLAP_SWING_FT);

// ---------------------------------------------------------------------------
// gps-lost outage window
// ---------------------------------------------------------------------------

/** First tick with no fix. By then the state is already `approaching`. */
export const GPS_LOST_FIRST_TICK = 12;
/** Last tick with no fix. Six ticks of outage at 62 mph is about 550 ft of road. */
export const GPS_LOST_LAST_TICK = 17;

// ---------------------------------------------------------------------------
// stationary-at-light phases
// ---------------------------------------------------------------------------

/** Long enough to get inside the threshold at city speed. */
const LIGHT_APPROACH_MS = 8_000;
/**
 * Stopped. Longer than `DEFAULT_STATIONARY_DWELL_MS` (120 s) with margin, so
 * the run contains ticks on both sides of the dwell rather than landing on it.
 */
const LIGHT_STOP_MS = 150_000;
/** Moving again, longer than `DEFAULT_MOVING_DWELL_MS` (5 s), so alerts return. */
const LIGHT_DEPART_MS = 12_000;

/**
 * Per-camera notification cooldown for the stationary scenario, ms.
 *
 * The default is ten minutes, which would suppress every tick of a 170-second
 * drive on its own and make "suppressed because stationary" unprovable - the
 * alert would have been quiet either way. Five seconds makes the stationary
 * dwell the only thing that can explain the silence.
 */
const LIGHT_COOLDOWN_MS = 5_000;

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const CLEAR_TO_APPROACHING: ScenarioDefinition = {
  id: 'clear-to-approaching',
  title: 'clear to approaching',
  proves: 'crossing 1000 ft inward turns clear into approaching, once',
  cameraIds: [FIXTURE_CAMERA_IDS.readingTennessee],
  route: meridianRoute(FIXTURE_CAMERA_IDS.readingTennessee, -1400, -900),
  speedProfile: constantSpeed(CITY_MPS),
  tickIntervalMs: ONE_HZ_MS,
  maxTicks: 60,
  engineOptions: {},
  muteAllAtStart: false,
  expectedTransitions: ['approaching'],
  expectedTickCount: 9,
  endsAtRouteEnd: true,
};

const APPROACHING_TO_IN_RANGE: ScenarioDefinition = {
  id: 'approaching-to-in-range',
  title: 'approaching to in range',
  proves: 'crossing the 500 ft threshold inward turns approaching into in_range',
  cameraIds: [FIXTURE_CAMERA_IDS.readingTennessee],
  route: meridianRoute(FIXTURE_CAMERA_IDS.readingTennessee, -900, -300),
  speedProfile: constantSpeed(CITY_MPS),
  tickIntervalMs: ONE_HZ_MS,
  maxTicks: 60,
  engineOptions: {},
  muteAllAtStart: false,
  expectedTransitions: ['approaching', 'in_range'],
  expectedTickCount: 10,
  endsAtRouteEnd: true,
};

const MULTIPLE_CAMERAS: ScenarioDefinition = {
  id: 'multiple-cameras',
  title: 'two cameras in range',
  proves: 'a second camera inside the widened threshold turns in_range into multiple',
  // 60 ft apart on one meridian: outside the 50 ft dedupe epsilon, so they stay
  // two records; closer together than one 1 Hz step, so the run samples at
  // 2 Hz to catch the tick where only the nearer one is inside.
  cameraIds: [
    FIXTURE_CAMERA_IDS.readingBlairNorthbound,
    FIXTURE_CAMERA_IDS.readingBlairSouthbound,
  ],
  route: meridianRoute(FIXTURE_CAMERA_IDS.readingBlairNorthbound, -900, -200),
  speedProfile: constantSpeed(CITY_MPS),
  tickIntervalMs: TWO_HZ_MS,
  maxTicks: 80,
  engineOptions: {},
  muteAllAtStart: false,
  expectedTransitions: ['approaching', 'in_range', 'multiple'],
  expectedTickCount: 22,
  endsAtRouteEnd: true,
};

const THRESHOLD_FLAP: ScenarioDefinition = {
  id: 'threshold-flap',
  title: 'flap across the threshold',
  proves: 'twelve swings across 500 ft produce exactly one transition',
  cameraIds: [FIXTURE_CAMERA_IDS.readingTennessee],
  route: flapRoute(FIXTURE_CAMERA_IDS.readingTennessee),
  speedProfile: constantSpeed(FLAP_MPS),
  tickIntervalMs: ONE_HZ_MS,
  // The flap has no destination - it swings in place - so the run length is a
  // tick count, and the route carries spare legs so the road never ends first.
  maxTicks: FLAP_LEGS + 1,
  engineOptions: {},
  muteAllAtStart: false,
  expectedTransitions: ['in_range'],
  expectedTickCount: FLAP_LEGS + 1,
  endsAtRouteEnd: false,
};

const STATIONARY_AT_LIGHT: ScenarioDefinition = {
  id: 'stationary-at-light',
  title: 'stopped at a light',
  proves: 'a long stop silences delivery and changes nothing about the record',
  cameraIds: [FIXTURE_CAMERA_IDS.readingTennessee],
  // Past the camera and out the far side, so the stop has road on both sides.
  route: meridianRoute(FIXTURE_CAMERA_IDS.readingTennessee, -1000, 312),
  speedProfile: phasedSpeed(
    [
      { durationMs: LIGHT_APPROACH_MS, mps: CITY_MPS, label: 'approach' },
      { durationMs: LIGHT_STOP_MS, mps: 0, label: 'red light' },
      { durationMs: LIGHT_DEPART_MS, mps: CITY_MPS, label: 'pulling away' },
    ],
    // The car keeps going after the last modelled phase; it is the ROUTE that
    // ends, not the drive. Letting the tail fall to zero would report a
    // stationary vehicle on the final tick and restart the stationary dwell
    // for one sample, which is an artefact of the profile, not of the drive.
    CITY_MPS,
  ),
  tickIntervalMs: ONE_HZ_MS,
  maxTicks: 400,
  engineOptions: { notificationCooldownMs: LIGHT_COOLDOWN_MS },
  muteAllAtStart: false,
  expectedTransitions: ['approaching', 'in_range'],
  expectedTickCount: 171,
  endsAtRouteEnd: true,
};

const GPS_LOST: ScenarioDefinition = {
  id: 'gps-lost',
  title: 'lost the fix',
  proves: 'six ticks with no position call the engine zero times and change nothing',
  cameraIds: [FIXTURE_CAMERA_IDS.readingTennessee],
  route: meridianRoute(FIXTURE_CAMERA_IDS.readingTennessee, -2000, 300),
  speedProfile: constantSpeed(HIGHWAY_MPS),
  tickIntervalMs: ONE_HZ_MS,
  maxTicks: 120,
  engineOptions: {},
  muteAllAtStart: false,
  expectedTransitions: ['approaching', 'in_range'],
  expectedTickCount: 27,
  endsAtRouteEnd: true,
  beforeTick: ({ tickIndex, simulator }): void => {
    simulator.setFixLost(tickIndex >= GPS_LOST_FIRST_TICK && tickIndex <= GPS_LOST_LAST_TICK);
  },
};

const MUTED_DRIVE: ScenarioDefinition = {
  id: 'muted-drive',
  title: 'muted drive',
  proves: 'muting removes the alert and nothing else - same history, same exposure',
  cameraIds: [FIXTURE_CAMERA_IDS.readingTennessee],
  // Deliberately the same road as approaching-to-in-range, and deliberately
  // never closer than 300 ft: `DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT` is 150 ft,
  // and a drive that pierced the mute would prove the opposite of the point.
  route: meridianRoute(FIXTURE_CAMERA_IDS.readingTennessee, -900, -300),
  speedProfile: constantSpeed(CITY_MPS),
  tickIntervalMs: ONE_HZ_MS,
  maxTicks: 60,
  engineOptions: {},
  muteAllAtStart: true,
  expectedTransitions: ['approaching', 'in_range'],
  expectedTickCount: 10,
  endsAtRouteEnd: true,
};

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioDefinition>> = {
  'clear-to-approaching': CLEAR_TO_APPROACHING,
  'approaching-to-in-range': APPROACHING_TO_IN_RANGE,
  'multiple-cameras': MULTIPLE_CAMERAS,
  'threshold-flap': THRESHOLD_FLAP,
  'stationary-at-light': STATIONARY_AT_LIGHT,
  'gps-lost': GPS_LOST,
  'muted-drive': MUTED_DRIVE,
};

export const SCENARIO_IDS: readonly ScenarioId[] = Object.keys(SCENARIOS) as ScenarioId[];

/**
 * One scenario by id.
 *
 * @throws RangeError on an unknown id.
 */
export function scenario(id: ScenarioId): ScenarioDefinition {
  const found = SCENARIOS[id];
  // The index signature is exhaustive, but an id arriving from a URL, a dev
  // panel or JSON has not been through the type checker.
  if (found === undefined) {
    throw new RangeError(`scenario: unknown id ${String(id)}. Known: ${SCENARIO_IDS.join(', ')}`);
  }
  return found;
}

/** Is this string one of the scenario ids? Safe on untrusted input. */
export function isScenarioId(value: string): value is ScenarioId {
  return Object.prototype.hasOwnProperty.call(SCENARIOS, value);
}

// ---------------------------------------------------------------------------
// Building and running
// ---------------------------------------------------------------------------

export interface ScenarioOverrides {
  /** Epoch ms the test clock starts at. Defaults to 0 - elapsed, not wall, time. */
  readonly startMs?: number;
  /** Merged over the scenario's own engine options. The clock is never overridable. */
  readonly engineOptions?: Omit<AlertEngineOptions, 'clock'>;
  readonly maxTicks?: number;
  /**
   * Skip the scenario's `muteAll`.
   *
   * This exists for exactly one purpose: running `muted-drive` twice, once
   * muted and once not, on byte-identical inputs, so the two histories can be
   * compared. Comparing against a different scenario would compare two routes.
   */
  readonly skipMute?: boolean;
  /** Accuracy the simulated fixes report, metres. */
  readonly accuracyM?: number;
  /** Withhold `coords.speed`, forcing the engine's derived-speed fallback. */
  readonly reportSpeed?: boolean;
}

export interface BuiltScenario {
  readonly definition: ScenarioDefinition;
  readonly clock: TestClock;
  readonly simulator: DriveSimulator;
  readonly engine: AlertEngine;
  readonly cameras: readonly CameraLike[];
  readonly maxTicks: number;
}

/**
 * Assemble a scenario without running it - for a dev panel that wants to drive
 * the controls by hand, or a test that wants to intervene mid-drive.
 */
export function buildScenario(id: ScenarioId, overrides: ScenarioOverrides = {}): BuiltScenario {
  const definition = scenario(id);
  const clock = createTestClock(overrides.startMs ?? 0);

  const simulator = createDriveSimulator({
    route: definition.route,
    speedProfile: definition.speedProfile,
    clock,
    tickIntervalMs: definition.tickIntervalMs,
    accuracyM: overrides.accuracyM ?? DEFAULT_SIMULATED_ACCURACY_M,
    reportSpeed: overrides.reportSpeed ?? true,
    advanceClock: (ms: number): void => {
      clock.advance(ms);
    },
  });

  const engine = createAlertEngine({
    ...definition.engineOptions,
    ...overrides.engineOptions,
    clock,
  });

  if (definition.muteAllAtStart && overrides.skipMute !== true) engine.muteAll();

  return {
    definition,
    clock,
    simulator,
    engine,
    cameras: toCameraLikes(fixtureCameras(definition.cameraIds)),
    maxTicks: overrides.maxTicks ?? definition.maxTicks,
  };
}

/** One tick of a scenario run, as the test and the dev panel read it. */
export interface ScenarioTickRecord {
  readonly tickIndex: number;
  readonly atMs: number;
  readonly kind: 'position' | 'fix-lost';
  /**
   * The engine's answer, or `null` on a tick with no fix.
   *
   * `null` is not "nothing happened" - it is "the engine was not called",
   * which is a different and more honest claim.
   */
  readonly alert: AlertTick | null;
  /** Engine state after this tick. Persists unchanged across an outage. */
  readonly state: AlertState;
  /** `true` when this tick moved the state. */
  readonly changed: boolean;
  readonly nearestDistanceFt: number | null;
  readonly nearestCameraId: string | null;
  readonly countInRange: number;
  readonly shouldAlertUser: boolean;
  readonly suppressedBy: readonly SuppressionReason[];
  readonly stationary: boolean;
  readonly speedMps: number | null;
}

export interface ScenarioRun {
  readonly id: ScenarioId;
  readonly definition: ScenarioDefinition;
  readonly ticks: readonly ScenarioTickRecord[];
  /** Every state the engine entered, in order. One entry per transition. */
  readonly transitions: readonly AlertState[];
  readonly history: readonly AlertHistoryEntry[];
  readonly exposure: ExposureSnapshot;
  readonly delivery: DeliveryStats;
  readonly finalState: AlertState;
  readonly positionTickCount: number;
  readonly fixLostTickCount: number;
  /** How many times `engine.update` was called. Never on an outage tick. */
  readonly engineUpdateCount: number;
}

/**
 * A scenario, stepped by hand.
 *
 * ONE tick loop exists in this codebase and it is the one inside `next()`.
 * `runScenario` drains this driver, and the dev panel steps it. Two loops would
 * eventually disagree about when the clock advances, and then a scenario would
 * pass headless and behave differently under the panel - which is precisely the
 * bug a simulator is supposed to catch, not cause.
 */
export interface ScenarioDriver {
  readonly definition: ScenarioDefinition;
  readonly clock: TestClock;
  readonly simulator: DriveSimulator;
  readonly engine: AlertEngine;
  readonly cameras: readonly CameraLike[];
  readonly maxTicks: number;
  /**
   * Advance one tick.
   *
   * Returns `null` when nothing was emitted: the route ended, the simulator is
   * paused, or `maxTicks` has been reached. `simulator.snapshot()` says which.
   */
  next(): ScenarioTickRecord | null;
  /** Drain to the end. Returns only the ticks this call produced. */
  drain(): ScenarioTickRecord[];
  records(): readonly ScenarioTickRecord[];
  last(): ScenarioTickRecord | null;
  transitions(): readonly AlertState[];
  /** Snapshot everything recorded so far as a finished run. */
  finish(): ScenarioRun;
}

export function createScenarioDriver(
  id: ScenarioId,
  overrides: ScenarioOverrides = {},
): ScenarioDriver {
  const built = buildScenario(id, overrides);
  const { definition, clock, simulator, engine, cameras, maxTicks } = built;

  const records: ScenarioTickRecord[] = [];
  const transitions: AlertState[] = [];
  let started = false;
  let positionTickCount = 0;
  let fixLostTickCount = 0;
  let engineUpdateCount = 0;

  const driver: ScenarioDriver = {
    definition,
    clock,
    simulator,
    engine,
    cameras,
    maxTicks,

    next(): ScenarioTickRecord | null {
      if (records.length >= maxTicks) return null;
      // The first tick reads the clock where it stands; every later one moves
      // it on by exactly one interval, which is what makes the run a pure
      // function of the definition.
      if (started) clock.advance(definition.tickIntervalMs);
      const tickIndex = records.length;
      definition.beforeTick?.({ tickIndex, simulator, engine, clock });

      const tick = simulator.step();
      if (tick === null) return null;
      started = true;

      if (tick.kind === 'fix-lost') {
        fixLostTickCount += 1;
        const record: ScenarioTickRecord = {
          tickIndex,
          atMs: tick.atMs,
          kind: 'fix-lost',
          alert: null,
          state: engine.getState(),
          changed: false,
          nearestDistanceFt: null,
          nearestCameraId: null,
          countInRange: 0,
          shouldAlertUser: false,
          suppressedBy: [],
          stationary: false,
          speedMps: null,
        };
        records.push(record);
        return record;
      }

      positionTickCount += 1;
      const alert = engine.update(toPositionFix(tick.position), cameras);
      engineUpdateCount += 1;
      if (alert.changed) transitions.push(alert.state);

      const record: ScenarioTickRecord = {
        tickIndex,
        atMs: tick.atMs,
        kind: 'position',
        alert,
        state: alert.state,
        changed: alert.changed,
        nearestDistanceFt: alert.nearest === null ? null : alert.nearest.distanceFt,
        nearestCameraId: alert.nearest === null ? null : alert.nearest.id,
        countInRange: alert.countInRange,
        shouldAlertUser: alert.shouldAlertUser,
        suppressedBy: alert.suppressedBy,
        stationary: alert.stationary,
        speedMps: alert.speedMps,
      };
      records.push(record);
      return record;
    },

    drain(): ScenarioTickRecord[] {
      const produced: ScenarioTickRecord[] = [];
      for (;;) {
        const record = driver.next();
        if (record === null) return produced;
        produced.push(record);
      }
    },

    records(): readonly ScenarioTickRecord[] {
      return records;
    },

    last(): ScenarioTickRecord | null {
      return records[records.length - 1] ?? null;
    },

    transitions(): readonly AlertState[] {
      return transitions;
    },

    finish(): ScenarioRun {
      return {
        id,
        definition,
        ticks: records,
        transitions,
        history: engine.getHistory(),
        exposure: engine.getExposure(),
        delivery: engine.getDeliveryStats(),
        finalState: engine.getState(),
        positionTickCount,
        fixLostTickCount,
        engineUpdateCount,
      };
    },
  };

  return driver;
}

/**
 * Drive a scenario to the end and record everything.
 *
 * Nothing in this path reads `Date.now()`, `performance.now()`, `Math.random()`
 * or any browser global, which is why the same run in CI and on a laptop
 * produces byte-identical history.
 */
export function runScenario(id: ScenarioId, overrides: ScenarioOverrides = {}): ScenarioRun {
  const driver = createScenarioDriver(id, overrides);
  driver.drain();
  return driver.finish();
}

/** Run every scenario. Used by the dev panel's "run them all" and by the tests. */
export function runAllScenarios(): Record<ScenarioId, ScenarioRun> {
  const out: Partial<Record<ScenarioId, ScenarioRun>> = {};
  for (const id of SCENARIO_IDS) out[id] = runScenario(id);
  return out as Record<ScenarioId, ScenarioRun>;
}
