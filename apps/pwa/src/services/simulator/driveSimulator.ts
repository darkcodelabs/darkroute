/**
 * THE DRIVE SIMULATOR
 * =============================================================================
 * A controllable, deterministic drive that feeds the real alert engine.
 *
 * The whole foreground loop - position in, distance measured, state derived,
 * haptics decided - has to be exercisable at a desk with no car, no network,
 * no backend and no GPS. That is not a convenience. A counter-surveillance app
 * whose only integration test is "drive to Avondale and see what happens" is an
 * app whose alert logic is never actually tested, and the one bug that matters
 * here is the silent one: the screen says CLEAR and there is a camera.
 *
 * WHAT THIS IS NOT
 *
 *   It is not a fake `navigator.geolocation`. It does not patch a global, does
 *   not install itself anywhere, and has no side effect on import. A caller
 *   wires its output into whatever it wants.
 *
 *   It does not own time. There is no `setInterval` in this file. Every
 *   decision reads the injected {@link Clock}, and a headless run needs an
 *   explicit `advanceClock` because a simulator that could silently make its
 *   own time pass is a simulator whose test can pass for the wrong reason.
 *   See {@link DriveSimulatorOptions.advanceClock}.
 *
 *   It does not measure anything itself. Distance and bearing come from
 *   `@fwm/core` - the same functions the engine uses on the phone.
 *
 * PAUSE IS NOT A STOP
 *
 *   `pause()` freezes the SIMULATION: no ticks, no time, nothing moves. That is
 *   a dev-panel control.
 *
 *   A red light is not that. A car stopped at a light is still producing
 *   position fixes, once a second, all reporting zero - which is exactly what
 *   makes the engine's stationary-dwell suppression reachable. So a stop is a
 *   phase of the SPEED PROFILE with `mps: 0`, and the simulator keeps ticking
 *   through it. Confusing the two would make the stationary path untestable.
 *
 * LOSING THE FIX IS NOT SLOWING DOWN
 *
 *   `setFixLost(true)` stops POSITIONS, not the vehicle. The car keeps covering
 *   ground; the simulator emits {@link FixLostTick} instead of a position, and
 *   the engine simply is not called. That is what really happens in a tunnel,
 *   and it is what the design's "NO GPS / last fix 40s ago / showing cached
 *   cameras only" state is for. Emitting a made-up position during an outage
 *   would be faking a capability, which this file must never do.
 *
 * PRIVACY
 *
 *   Simulated coordinates are not a person's coordinates, but this module is
 *   still built so that pointing it at a real fix later cannot leak one: it
 *   holds no history of where it has been beyond the current cursor, and it
 *   writes nothing anywhere. There is no plate anywhere in this file.
 */

import type { GeoFix } from '../adapters/geolocation.ts';
import type { Clock, PositionFix } from './fwmCore.ts';
import {
  buildRouteGeometry,
  positionOnRoute,
  type LatLon,
  type RouteGeometry,
} from './geometry.ts';

// ---------------------------------------------------------------------------
// Speed profile
// ---------------------------------------------------------------------------

/**
 * One stretch of the drive, held at one speed for a fixed length of time.
 *
 * Time-based rather than distance-based on purpose. "Stopped at a light for
 * three minutes" is a duration; expressed as a distance it is a zero-length
 * stretch the cursor would never leave, and the simulator would hang.
 */
export interface SpeedPhase {
  /** How long this phase lasts, milliseconds. */
  readonly durationMs: number;
  /** Speed held through it, metres per second. `0` is a full stop. */
  readonly mps: number;
  /** Free label for the dev panel. Never shown to a driver. */
  readonly label?: string;
}

/**
 * How fast the vehicle is going, as a function of elapsed simulation time.
 *
 * `constant` is the everyday case. `phases` is the one that can express a light
 * cycle, a jam, a highway on-ramp or a car left parked with the app open.
 */
export type SpeedProfile =
  | { readonly kind: 'constant'; readonly mps: number }
  | {
      readonly kind: 'phases';
      readonly phases: readonly SpeedPhase[];
      /** Speed once every phase has elapsed. Defaults to 0 - the drive is over. */
      readonly thenMps?: number;
    };

/** A constant-speed profile. */
export function constantSpeed(mps: number): SpeedProfile {
  assertNonNegative(mps, 'constantSpeed(mps)');
  return { kind: 'constant', mps };
}

/** A phased profile. */
export function phasedSpeed(phases: readonly SpeedPhase[], thenMps = 0): SpeedProfile {
  if (phases.length === 0) {
    throw new RangeError('phasedSpeed: at least one phase is required');
  }
  for (const [index, phase] of phases.entries()) {
    assertNonNegative(phase.mps, `phasedSpeed(phases[${String(index)}].mps)`);
    if (!Number.isFinite(phase.durationMs) || phase.durationMs <= 0) {
      throw new RangeError(
        `phasedSpeed: phases[${String(index)}].durationMs must be finite and > 0, received ${String(phase.durationMs)}`,
      );
    }
  }
  assertNonNegative(thenMps, 'phasedSpeed(thenMps)');
  return { kind: 'phases', phases, thenMps };
}

/**
 * Speed at an instant, metres per second.
 *
 * Phase boundaries are half-open, `[start, end)`, so the instant a phase ends
 * belongs to the next one. That is what makes "brakes at t = 8 s" mean the fix
 * stamped 8 s already reports zero, which is the moment the engine starts its
 * stationary dwell.
 */
export function speedAtMs(profile: SpeedProfile, elapsedMs: number): number {
  if (profile.kind === 'constant') return profile.mps;
  let start = 0;
  for (const phase of profile.phases) {
    const end = start + phase.durationMs;
    if (elapsedMs < end) return phase.mps;
    start = end;
  }
  return profile.thenMps ?? 0;
}

/** The label of the phase covering an instant, or `null`. */
export function phaseLabelAtMs(profile: SpeedProfile, elapsedMs: number): string | null {
  if (profile.kind === 'constant') return null;
  let start = 0;
  for (const phase of profile.phases) {
    const end = start + phase.durationMs;
    if (elapsedMs < end) return phase.label ?? null;
    start = end;
  }
  return null;
}

/**
 * Ground covered between two instants, metres - the exact integral of a
 * piecewise-constant speed, boundaries included.
 *
 * Not `speed * dt`: a tick that straddles the moment the car stops at a light
 * would otherwise record a whole second of motion or none, and either way the
 * cursor and the reported speed would start disagreeing about where the car is.
 *
 * @throws RangeError when time runs backwards.
 */
export function distanceTravelledM(profile: SpeedProfile, fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new RangeError('distanceTravelledM: fromMs and toMs must be finite');
  }
  if (toMs < fromMs) {
    throw new RangeError(
      `distanceTravelledM: toMs (${String(toMs)}) is before fromMs (${String(fromMs)}); time does not run backwards`,
    );
  }
  if (toMs === fromMs) return 0;
  if (profile.kind === 'constant') return (profile.mps * (toMs - fromMs)) / 1000;

  let metres = 0;
  let start = 0;
  for (const phase of profile.phases) {
    const end = start + phase.durationMs;
    const overlap = Math.min(toMs, end) - Math.max(fromMs, start);
    if (overlap > 0) metres += (phase.mps * overlap) / 1000;
    start = end;
    if (start >= toMs) return metres;
  }
  const tailOverlap = toMs - Math.max(fromMs, start);
  if (tailOverlap > 0) metres += ((profile.thenMps ?? 0) * tailOverlap) / 1000;
  return metres;
}

/** Total time the phases account for, ms. `Infinity` for a constant profile. */
export function profileDurationMs(profile: SpeedProfile): number {
  if (profile.kind === 'constant') return Number.POSITIVE_INFINITY;
  return profile.phases.reduce((total, phase) => total + phase.durationMs, 0);
}

// ---------------------------------------------------------------------------
// Emitted shapes
// ---------------------------------------------------------------------------

/**
 * Structurally a `GeolocationCoordinates`.
 *
 * Written out rather than reusing the DOM type because the DOM interface is a
 * class with a prototype and cannot be object-literalled, and because this must
 * be constructible in a plain node test with no DOM at all.
 */
export interface SimulatedCoordinates {
  readonly latitude: number;
  readonly longitude: number;
  /** Horizontal accuracy in metres, 95% confidence. Always present, per spec. */
  readonly accuracy: number;
  readonly altitude: number | null;
  readonly altitudeAccuracy: number | null;
  /** Degrees clockwise from true north. `null` when stationary - as real GPS reports. */
  readonly heading: number | null;
  /** Metres per second, or `null` when the simulator is told not to vouch for it. */
  readonly speed: number | null;
}

/** Structurally a `GeolocationPosition`. */
export interface SimulatedPosition {
  readonly coords: SimulatedCoordinates;
  /** Epoch ms, from the injected clock. Never `Date.now()`. */
  readonly timestamp: number;
}

export interface PositionTick {
  readonly kind: 'position';
  readonly atMs: number;
  /** 0-based index of this tick within the run. */
  readonly tickIndex: number;
  readonly position: SimulatedPosition;
  /** Distance travelled along the route so far, metres. */
  readonly routeM: number;
  readonly legIndex: number;
  readonly atRouteEnd: boolean;
  /** Label of the speed phase in force, or `null`. */
  readonly phaseLabel: string | null;
}

/**
 * A tick during which the platform had no position to give.
 *
 * This is an EVENT, not a degraded position. Nothing here can be mistaken for a
 * fix, which is the point: the app's NO GPS state must be reachable, and it
 * must be reachable by the absence of data rather than by a flag on some
 * plausible-looking coordinate.
 */
export interface FixLostTick {
  readonly kind: 'fix-lost';
  readonly atMs: number;
  readonly tickIndex: number;
  readonly reason: 'simulator-lose-fix';
  /** When the last real fix arrived, or `null` if there has never been one. */
  readonly lastFixAtMs: number | null;
  /** Age of that fix - the design's "last fix 40s ago". `null` when there is none. */
  readonly fixAgeMs: number | null;
}

export type SimulatorTick = PositionTick | FixLostTick;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Default tick rate. Once a second, which is what a phone GPS actually gives. */
export const DEFAULT_TICK_HZ = 1;

/**
 * Accuracy the simulator reports unless told otherwise, metres.
 *
 * The design's good fix: "±4 M · 9 SATS" on the REPORT sheet. Comfortably
 * inside the engine's accuracy gate, so a plain drive alerts.
 */
export const DEFAULT_SIMULATED_ACCURACY_M = 4;

export interface DriveSimulatorOptions {
  /** Two or more waypoints. Interpolated between, measured by `@fwm/core`. */
  readonly route: readonly LatLon[];
  readonly speedProfile: SpeedProfile;
  /** Injected. Every timestamp and every elapsed calculation reads it. */
  readonly clock: Clock;
  /** Ticks per second. Ignored when `tickIntervalMs` is given. */
  readonly hz?: number;
  /** Milliseconds between ticks. Overrides `hz`. */
  readonly tickIntervalMs?: number;
  /** Baseline reported accuracy, metres. */
  readonly accuracyM?: number;
  /**
   * Whether `coords.speed` carries a number.
   *
   * `false` makes the platform withhold speed, which forces the engine down its
   * documented fallback - a smoothed position delta, reported as
   * `speedSource: 'derived'`. That path is otherwise unreachable in a test.
   */
  readonly reportSpeed?: boolean;
  /**
   * How the simulator moves the clock forward in a headless run.
   *
   * Pass `clock.advance` from a `TestClock` and {@link DriveSimulator.runTicks}
   * works. Leave it out for real-clock use, where the host - a rAF loop, a
   * dev-panel button - owns the timeline and calls `step()` itself. The
   * simulator will NOT invent a way to make time pass: `runTicks` throws
   * instead, because a headless run that silently used wall time would produce
   * a different answer every run.
   */
  readonly advanceClock?: (ms: number) => void;
}

/** Everything a dev panel needs to render the simulator's state. */
export interface DriveSimulatorSnapshot {
  readonly started: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly fixLost: boolean;
  readonly tickCount: number;
  /** Simulation time consumed by the speed profile. Frozen while paused. */
  readonly elapsedMs: number;
  readonly routeM: number;
  readonly routeTotalM: number;
  readonly legIndex: number;
  readonly waypointCount: number;
  readonly speedMps: number;
  readonly phaseLabel: string | null;
  readonly accuracyM: number;
  readonly speedOverrideMps: number | null;
  readonly accuracyOverrideM: number | null;
  readonly reportSpeed: boolean;
  readonly lastFixAtMs: number | null;
  readonly canRunHeadless: boolean;
}

export type SimulatorUnsubscribe = () => void;

export interface DriveSimulator {
  /** Compiled route geometry. Read-only; the simulator never mutates it. */
  readonly geometry: RouteGeometry;
  readonly tickIntervalMs: number;

  /**
   * Advance one tick and emit.
   *
   * Time comes from the clock, not from the interval: a caller that has not
   * moved the clock gets a tick at the same position, which is correct - the
   * vehicle has not moved either. Returns `null` when nothing was emitted,
   * which means the route has ended or the simulator is paused; `snapshot()`
   * distinguishes them.
   *
   * @throws RangeError if the clock has gone backwards since the last tick.
   */
  step(): SimulatorTick | null;
  /**
   * Advance the clock and step, `count` times.
   *
   * @throws Error when no `advanceClock` was supplied.
   * @throws RangeError on a non-positive count.
   */
  runTicks(count: number): SimulatorTick[];
  /** Run until the route ends or `maxTicks` is reached, whichever is first. */
  runToEnd(maxTicks?: number): SimulatorTick[];

  pause(): void;
  resume(): void;
  isPaused(): boolean;

  /**
   * Teleport to a waypoint. The speed profile's clock is NOT rewound: a jump
   * moves the car, it does not un-happen the drive.
   *
   * @throws RangeError on an index outside the route.
   */
  jumpToWaypoint(index: number): void;
  /** Teleport to a distance along the route, metres. Clamped to the route. */
  jumpToRouteM(metres: number): void;

  /** Force a speed, ignoring the profile. `null` hands control back. */
  setSpeedOverrideMps(mps: number | null): void;
  /** Force a reported accuracy, to exercise the engine's accuracy gate. `null` restores. */
  setAccuracyOverrideM(metres: number | null): void;
  /** Withhold or restore `coords.speed`. */
  setReportSpeed(report: boolean): void;
  /** Stop emitting positions without stopping the vehicle. */
  setFixLost(lost: boolean): void;
  isFixLost(): boolean;

  /** Back to the start line: cursor 0, no elapsed time, no overrides cleared. */
  reset(): void;

  subscribe(listener: (tick: SimulatorTick) => void): SimulatorUnsubscribe;
  snapshot(): DriveSimulatorSnapshot;
  /** The most recent position tick, or `null`. Not a history - one value. */
  lastPosition(): SimulatedPosition | null;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and >= 0, received ${String(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDriveSimulator(options: DriveSimulatorOptions): DriveSimulator {
  const geometry = buildRouteGeometry(options.route);

  const hz = options.hz ?? DEFAULT_TICK_HZ;
  if (!Number.isFinite(hz) || hz <= 0) {
    throw new RangeError(`createDriveSimulator: hz must be finite and > 0, received ${String(hz)}`);
  }
  const tickIntervalMs = options.tickIntervalMs ?? 1000 / hz;
  if (!Number.isFinite(tickIntervalMs) || tickIntervalMs <= 0) {
    throw new RangeError(
      `createDriveSimulator: tickIntervalMs must be finite and > 0, received ${String(tickIntervalMs)}`,
    );
  }
  const baseAccuracyM = options.accuracyM ?? DEFAULT_SIMULATED_ACCURACY_M;
  assertNonNegative(baseAccuracyM, 'createDriveSimulator(accuracyM)');

  const clock = options.clock;
  const profile = options.speedProfile;
  const advanceClock = options.advanceClock;

  let paused = false;
  let ended = false;
  let fixLost = false;
  let reportSpeed = options.reportSpeed ?? true;
  let speedOverrideMps: number | null = null;
  let accuracyOverrideM: number | null = null;

  let lastTickAtMs: number | null = null;
  let elapsedMs = 0;
  let routeM = 0;
  let tickCount = 0;
  let lastFixAtMs: number | null = null;
  let lastPositionValue: SimulatedPosition | null = null;
  let legIndex = 0;

  const listeners = new Set<(tick: SimulatorTick) => void>();

  const currentSpeedMps = (): number => speedOverrideMps ?? speedAtMs(profile, elapsedMs);
  const currentAccuracyM = (): number => accuracyOverrideM ?? baseAccuracyM;

  const advance = (dtMs: number): void => {
    const covered =
      speedOverrideMps === null
        ? distanceTravelledM(profile, elapsedMs, elapsedMs + dtMs)
        : (speedOverrideMps * dtMs) / 1000;
    elapsedMs += dtMs;
    routeM = Math.min(geometry.totalM, routeM + covered);
  };

  const emit = (tick: SimulatorTick): void => {
    for (const listener of [...listeners]) listener(tick);
  };

  const buildPositionTick = (nowMs: number): PositionTick => {
    const placed = positionOnRoute(geometry, routeM);
    legIndex = placed.legIndex;
    const speed = currentSpeedMps();
    const position: SimulatedPosition = {
      coords: {
        latitude: placed.point.lat,
        longitude: placed.point.lon,
        accuracy: currentAccuracyM(),
        // Neither is simulated. Reporting a made-up altitude would be exactly
        // the kind of plausible fiction this module is not allowed to produce.
        altitude: null,
        altitudeAccuracy: null,
        // Real GPS reports no heading when the vehicle is not moving.
        heading: speed === 0 ? null : placed.bearingDeg,
        speed: reportSpeed ? speed : null,
      },
      timestamp: nowMs,
    };
    return {
      kind: 'position',
      atMs: nowMs,
      tickIndex: tickCount,
      position,
      routeM,
      legIndex: placed.legIndex,
      atRouteEnd: placed.atEnd,
      phaseLabel: phaseLabelAtMs(profile, elapsedMs),
    };
  };

  const buildFixLostTick = (nowMs: number): FixLostTick => ({
    kind: 'fix-lost',
    atMs: nowMs,
    tickIndex: tickCount,
    reason: 'simulator-lose-fix',
    lastFixAtMs,
    fixAgeMs: lastFixAtMs === null ? null : nowMs - lastFixAtMs,
  });

  const simulator: DriveSimulator = {
    geometry,
    tickIntervalMs,

    step(): SimulatorTick | null {
      // `null` means "nothing was emitted". Two things cause that - the route
      // ended, or the panel is paused - and `snapshot()` says which.
      if (ended || paused) return null;
      const nowMs = clock.now();
      if (!Number.isFinite(nowMs)) {
        throw new RangeError(`DriveSimulator.step: clock returned ${String(nowMs)}`);
      }
      if (lastTickAtMs !== null) {
        const dtMs = nowMs - lastTickAtMs;
        if (dtMs < 0) {
          throw new RangeError(
            `DriveSimulator.step: the clock went backwards by ${String(-dtMs)} ms; a simulated drive cannot un-happen`,
          );
        }
        if (dtMs > 0) advance(dtMs);
      }
      lastTickAtMs = nowMs;

      const tick = fixLost ? buildFixLostTick(nowMs) : buildPositionTick(nowMs);
      if (tick.kind === 'position') {
        lastFixAtMs = nowMs;
        lastPositionValue = tick.position;
      }
      tickCount += 1;
      emit(tick);

      // The tick that lands on the end of the route is emitted; the next one is
      // not. A drive stops when the road does.
      if (routeM >= geometry.totalM) ended = true;
      return tick;
    },

    runTicks(count: number): SimulatorTick[] {
      if (advanceClock === undefined) {
        throw new Error(
          'DriveSimulator.runTicks: no advanceClock was supplied, so this simulator cannot make time pass on its own. Pass `advanceClock: clock.advance` from a TestClock for a headless run, or drive it with step() from a real timer.',
        );
      }
      if (!Number.isInteger(count) || count < 1) {
        throw new RangeError(`DriveSimulator.runTicks: count must be an integer >= 1, received ${String(count)}`);
      }
      const out: SimulatorTick[] = [];
      for (let i = 0; i < count; i++) {
        // The very first tick reads the clock where it stands; every later one
        // moves it on by exactly one interval first.
        if (lastTickAtMs !== null) advanceClock(tickIntervalMs);
        const tick = simulator.step();
        if (tick === null) break;
        out.push(tick);
      }
      return out;
    },

    runToEnd(maxTicks = 10_000): SimulatorTick[] {
      if (!Number.isInteger(maxTicks) || maxTicks < 1) {
        throw new RangeError(
          `DriveSimulator.runToEnd: maxTicks must be an integer >= 1, received ${String(maxTicks)}`,
        );
      }
      return simulator.runTicks(maxTicks);
    },

    pause(): void {
      paused = true;
    },

    resume(): void {
      if (!paused) return;
      paused = false;
      // Time that passed while paused did not happen for the drive. Re-anchor
      // so the first tick after a resume does not teleport the car forward by
      // however long the panel sat open. A simulator that has never ticked has
      // nothing to re-anchor, and must keep `null` so its first tick is still
      // treated as the first.
      if (lastTickAtMs !== null) lastTickAtMs = clock.now();
    },

    isPaused(): boolean {
      return paused;
    },

    jumpToWaypoint(index: number): void {
      if (!Number.isInteger(index) || index < 0 || index >= geometry.points.length) {
        throw new RangeError(
          `DriveSimulator.jumpToWaypoint: index must be an integer in [0, ${String(geometry.points.length - 1)}], received ${String(index)}`,
        );
      }
      simulator.jumpToRouteM(geometry.cumulativeM[index] ?? 0);
    },

    jumpToRouteM(metres: number): void {
      if (!Number.isFinite(metres)) {
        throw new RangeError(`DriveSimulator.jumpToRouteM: metres must be finite, received ${String(metres)}`);
      }
      routeM = Math.min(geometry.totalM, Math.max(0, metres));
      // Jumping back onto the route un-ends the drive. Jumping to the end does
      // not end it - the tick that lands there is still owed an emission.
      if (routeM < geometry.totalM) ended = false;
      legIndex = positionOnRoute(geometry, routeM).legIndex;
    },

    setSpeedOverrideMps(mps: number | null): void {
      if (mps !== null) assertNonNegative(mps, 'DriveSimulator.setSpeedOverrideMps(mps)');
      speedOverrideMps = mps;
    },

    setAccuracyOverrideM(metres: number | null): void {
      if (metres !== null) assertNonNegative(metres, 'DriveSimulator.setAccuracyOverrideM(metres)');
      accuracyOverrideM = metres;
    },

    setReportSpeed(report: boolean): void {
      reportSpeed = report;
    },

    setFixLost(lost: boolean): void {
      fixLost = lost;
    },

    isFixLost(): boolean {
      return fixLost;
    },

    reset(): void {
      paused = false;
      ended = false;
      lastTickAtMs = null;
      elapsedMs = 0;
      routeM = 0;
      tickCount = 0;
      lastFixAtMs = null;
      lastPositionValue = null;
      legIndex = 0;
    },

    subscribe(listener: (tick: SimulatorTick) => void): SimulatorUnsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    snapshot(): DriveSimulatorSnapshot {
      return {
        started: lastTickAtMs !== null,
        paused,
        ended,
        fixLost,
        tickCount,
        elapsedMs,
        routeM,
        routeTotalM: geometry.totalM,
        legIndex,
        waypointCount: geometry.points.length,
        speedMps: currentSpeedMps(),
        phaseLabel: phaseLabelAtMs(profile, elapsedMs),
        accuracyM: currentAccuracyM(),
        speedOverrideMps,
        accuracyOverrideM,
        reportSpeed,
        lastFixAtMs,
        canRunHeadless: advanceClock !== undefined,
      };
    },

    lastPosition(): SimulatedPosition | null {
      return lastPositionValue;
    },
  };

  return simulator;
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/** Extra evidence the geolocation API cannot supply. */
export interface PositionFixExtras {
  /**
   * Device-motion magnitude, m/s².
   *
   * SUPPORTING EVIDENCE ONLY, as the engine documents it: above
   * `MOTION_STATIONARY_VETO_MPS2` it can veto a "stationary" conclusion, and it
   * can never establish a speed. It is separate from the position because it
   * comes from a separate sensor with a separate permission.
   */
  readonly motionMagnitudeMps2?: number | null;
}

/**
 * A simulated position in the shape `@fwm/core`'s engine takes.
 *
 * `exactOptionalPropertyTypes` is on, so the motion field is added only when a
 * value was actually supplied - an absent field and an `undefined` one mean
 * different things, and "we did not measure motion" is the honest one.
 */
export function toPositionFix(
  position: SimulatedPosition,
  extras: PositionFixExtras = {},
): PositionFix {
  const base = {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    headingDeg: position.coords.heading,
    speedMps: position.coords.speed,
    accuracyM: position.coords.accuracy,
    timestampMs: position.timestamp,
  };
  if (extras.motionMagnitudeMps2 === undefined) return base;
  return { ...base, motionMagnitudeMps2: extras.motionMagnitudeMps2 };
}

/**
 * A simulated position in the shape the geolocation adapter emits, so a dev UI
 * can feed the simulator into exactly the pipeline a real fix travels.
 */
export function toGeoFix(position: SimulatedPosition): GeoFix {
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracyM: position.coords.accuracy,
    altitudeM: position.coords.altitude,
    altitudeAccuracyM: position.coords.altitudeAccuracy,
    speedMps: position.coords.speed,
    headingDeg: position.coords.heading,
    timestamp: position.timestamp,
  };
}

/** Narrow a mixed tick list to the position ticks. */
export function positionTicks(ticks: readonly SimulatorTick[]): PositionTick[] {
  return ticks.filter((tick): tick is PositionTick => tick.kind === 'position');
}

/** Narrow a mixed tick list to the outage ticks. */
export function fixLostTicks(ticks: readonly SimulatorTick[]): FixLostTick[] {
  return ticks.filter((tick): tick is FixLostTick => tick.kind === 'fix-lost');
}
