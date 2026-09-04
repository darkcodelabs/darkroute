/**
 * THE DEV PANEL CONTROLLER - headless.
 * =============================================================================
 * Everything a developer-only UI needs to load a scenario, drive it, bend it
 * and read what the alert engine concluded. No React, no DOM, no CSS, no
 * design value: this is state plus verbs, and a component binds to it later.
 *
 * Keeping it headless is not tidiness. The controller is the thing that has to
 * be exercisable in a node test, and the moment it imports a hook it stops
 * being that.
 *
 * ---------------------------------------------------------------------------
 * IT IS A DEV TOOL AND IT DOES NOT SHIP MOUNTED
 *
 * {@link DEV_PANEL_ENABLED} reads `import.meta.env.DEV`. This module does NOT
 * enforce it - a controller that silently no-ops in production is a code path
 * nobody ever runs and therefore nobody ever tests. The host decides whether to
 * mount, the flag tells it what the build is, and the module has no import-time
 * side effect so a production bundle that never imports it drops it entirely.
 *
 * ---------------------------------------------------------------------------
 * PRIVACY: THE PANEL DOES NOT PRINT A POSITION
 *
 * {@link DevPanelState} carries `approxLat` / `approxLon`, rounded through the
 * geolocation adapter's own `redactCoordinate` - three decimal places, about
 * 110 m. Not because a simulated coordinate is sensitive, but because this
 * controller is the obvious thing to point at the live geolocation adapter one
 * afternoon, and a panel that renders full precision is a panel that ends up in
 * a screenshot in a bug report. There is no toggle that unlocks it. Nothing
 * here is a plate, and nothing here is logged.
 */

import { redactCoordinate, REDACTION_DECIMALS } from '../adapters/geolocation.ts';
import {
  metresPerSecondToMph,
  metresToFeet,
  mphToMetresPerSecond,
  type AlertState,
  type CameraAssessment,
  type DeliveryStats,
  type ExposureSnapshot,
  type RelativeDirection,
  type SpeedSource,
  type SuppressionReason,
} from './fwmCore.ts';
import type { DriveSimulatorSnapshot } from './driveSimulator.ts';
import {
  SCENARIO_IDS,
  createScenarioDriver,
  isScenarioId,
  scenario,
  type ScenarioDriver,
  type ScenarioId,
  type ScenarioOverrides,
  type ScenarioRun,
  type ScenarioTickRecord,
} from './scenarios.ts';

/**
 * Is this a development build?
 *
 * Advisory. See the module note: the controller does not gate itself on it.
 */
export const DEV_PANEL_ENABLED: boolean = import.meta.env.DEV;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** One camera as the panel lists it. Distances in feet, the unit the app speaks. */
export interface DevPanelCameraRow {
  readonly id: string;
  readonly distanceFt: number;
  readonly inRange: boolean;
  /** Muted cameras stay in this list. Muting removes the alert, never the record. */
  readonly muted: boolean;
  /** `null` when the platform gave no heading. */
  readonly relativeDirection: RelativeDirection | null;
  /** `null` when the camera's facing is unknown. Never coerced to `false`. */
  readonly facingVehicle: boolean | null;
  readonly bearingDeg: number;
  /** Every reported id this record stands for after dedupe. */
  readonly mergedIds: readonly string[];
}

export interface DevPanelState {
  /** What `import.meta.env.DEV` said. Advisory; the host does the gating. */
  readonly enabled: boolean;
  readonly scenarioIds: readonly ScenarioId[];

  // --- the loaded scenario ------------------------------------------------
  readonly scenarioId: ScenarioId | null;
  readonly title: string | null;
  readonly proves: string | null;
  readonly loaded: boolean;

  // --- the drive ----------------------------------------------------------
  readonly paused: boolean;
  readonly ended: boolean;
  readonly fixLost: boolean;
  readonly tickCount: number;
  readonly elapsedMs: number;
  readonly routeFt: number;
  readonly routeTotalFt: number;
  readonly waypointIndex: number;
  readonly waypointCount: number;
  readonly phaseLabel: string | null;
  readonly speedMph: number | null;
  readonly speedSource: SpeedSource | null;
  readonly accuracyM: number | null;
  readonly speedOverrideMph: number | null;
  readonly accuracyOverrideM: number | null;
  /** Coordinates rounded to {@link REDACTION_DECIMALS}. Never full precision. */
  readonly approxLat: number | null;
  readonly approxLon: number | null;
  readonly coordinatePrecision: 'approx-3dp';
  /** How many decimal places survived the rounding. Straight from the adapter. */
  readonly coordinateDecimals: number;
  /** Milliseconds since the last real fix - the design's "last fix 40s ago". */
  readonly fixAgeMs: number | null;

  // --- what RADAR would be showing ----------------------------------------
  readonly alertState: AlertState;
  readonly nearestCameraId: string | null;
  readonly nearestDistanceFt: number | null;
  readonly countInRange: number;
  readonly thresholdFt: number | null;
  readonly effectiveThresholdFt: number | null;
  readonly isClosing: boolean | null;
  readonly stationary: boolean;
  readonly shouldAlertUser: boolean;
  readonly hapticPulses: 0 | 1 | 2;
  readonly suppressedBy: readonly SuppressionReason[];
  readonly globallyMuted: boolean;
  readonly globalMuteRemainingMs: number;
  readonly cameras: readonly DevPanelCameraRow[];

  // --- the record ---------------------------------------------------------
  readonly transitions: readonly AlertState[];
  readonly expectedTransitions: readonly AlertState[];
  /** Does the run so far match the scenario's declared sequence, as a prefix? */
  readonly matchesExpectation: boolean;
  readonly exposure: ExposureSnapshot | null;
  readonly delivery: DeliveryStats | null;
}

export type DevPanelUnsubscribe = () => void;

export interface DevPanelController {
  state(): DevPanelState;
  subscribe(listener: (state: DevPanelState) => void): DevPanelUnsubscribe;

  /** Load a scenario. Replaces anything already loaded. */
  load(id: ScenarioId, overrides?: ScenarioOverrides): void;
  /** Load from an untrusted string - a URL fragment, a select element. */
  loadById(id: string, overrides?: ScenarioOverrides): boolean;
  /** Reload the current scenario from the start. */
  reload(): void;
  /** Forget the scenario entirely. */
  unload(): void;

  /** Advance `count` ticks. Stops early at the end of the route. */
  step(count?: number): ScenarioTickRecord[];
  /** Run the rest of the drive. */
  runToEnd(): ScenarioTickRecord[];

  pause(): void;
  resume(): void;
  jumpToWaypoint(index: number): void;

  /** Override the speed, in mph - the unit the panel shows. `null` restores the profile. */
  setSpeedOverrideMph(mph: number | null): void;
  /** Override reported accuracy, metres. Push it past 50 to watch the gate bite. */
  setAccuracyOverrideM(metres: number | null): void;
  /** Stop the fixes without stopping the car. */
  setFixLost(lost: boolean): void;

  muteAll(durationMs?: number): void;
  unmuteAll(): void;
  muteCamera(cameraId: string, durationMs?: number): void;
  unmuteCamera(cameraId: string): void;
  /** Move the alert threshold, feet. Rejected outside the slider's 100 - 1000. */
  setThresholdFt(thresholdFt: number): void;

  /** Everything recorded so far, as a finished run. `null` when nothing is loaded. */
  run(): ScenarioRun | null;
  /** Drop every listener. Idempotent. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCameraRow(assessment: CameraAssessment): DevPanelCameraRow {
  return {
    id: assessment.id,
    distanceFt: assessment.distanceFt,
    inRange: assessment.inRange,
    muted: assessment.muted,
    relativeDirection: assessment.relativeDirection,
    facingVehicle: assessment.facingVehicle,
    bearingDeg: assessment.bearingDeg,
    mergedIds: assessment.mergedIds,
  };
}

/** Is `actual` the opening of `expected`? A part-run must not read as a mismatch. */
function isPrefix(actual: readonly AlertState[], expected: readonly AlertState[]): boolean {
  if (actual.length > expected.length) return false;
  return actual.every((state, index) => state === expected[index]);
}

const EMPTY_STATE: DevPanelState = {
  enabled: DEV_PANEL_ENABLED,
  scenarioIds: SCENARIO_IDS,
  scenarioId: null,
  title: null,
  proves: null,
  loaded: false,
  paused: false,
  ended: false,
  fixLost: false,
  tickCount: 0,
  elapsedMs: 0,
  routeFt: 0,
  routeTotalFt: 0,
  waypointIndex: 0,
  waypointCount: 0,
  phaseLabel: null,
  speedMph: null,
  speedSource: null,
  accuracyM: null,
  speedOverrideMph: null,
  accuracyOverrideM: null,
  approxLat: null,
  approxLon: null,
  coordinatePrecision: 'approx-3dp',
  coordinateDecimals: REDACTION_DECIMALS,
  fixAgeMs: null,
  alertState: 'clear',
  nearestCameraId: null,
  nearestDistanceFt: null,
  countInRange: 0,
  thresholdFt: null,
  effectiveThresholdFt: null,
  isClosing: null,
  stationary: false,
  shouldAlertUser: false,
  hapticPulses: 0,
  suppressedBy: [],
  globallyMuted: false,
  globalMuteRemainingMs: 0,
  cameras: [],
  transitions: [],
  expectedTransitions: [],
  matchesExpectation: true,
  exposure: null,
  delivery: null,
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export interface DevPanelOptions {
  /** Load this scenario immediately. */
  readonly initialScenarioId?: ScenarioId;
  readonly overrides?: ScenarioOverrides;
}

export function createDevPanel(options: DevPanelOptions = {}): DevPanelController {
  let driver: ScenarioDriver | null = null;
  let currentId: ScenarioId | null = null;
  let currentOverrides: ScenarioOverrides = options.overrides ?? {};
  let cached: DevPanelState = EMPTY_STATE;
  const listeners = new Set<(state: DevPanelState) => void>();

  const buildState = (): DevPanelState => {
    if (driver === null || currentId === null) {
      return { ...EMPTY_STATE, enabled: DEV_PANEL_ENABLED, scenarioIds: SCENARIO_IDS };
    }
    const definition = driver.definition;
    const snapshot: DriveSimulatorSnapshot = driver.simulator.snapshot();
    const last = driver.last();
    const alert = last?.alert ?? null;
    const position = driver.simulator.lastPosition();
    const transitions = driver.transitions();

    return {
      enabled: DEV_PANEL_ENABLED,
      scenarioIds: SCENARIO_IDS,

      scenarioId: currentId,
      title: definition.title,
      proves: definition.proves,
      loaded: true,

      paused: snapshot.paused,
      ended: snapshot.ended,
      fixLost: snapshot.fixLost,
      tickCount: driver.records().length,
      elapsedMs: snapshot.elapsedMs,
      routeFt: metresToFeet(snapshot.routeM),
      routeTotalFt: metresToFeet(snapshot.routeTotalM),
      waypointIndex: snapshot.legIndex,
      waypointCount: snapshot.waypointCount,
      phaseLabel: snapshot.phaseLabel,
      speedMph: metresPerSecondToMph(snapshot.speedMps),
      speedSource: alert?.speedSource ?? null,
      accuracyM: snapshot.accuracyM,
      speedOverrideMph:
        snapshot.speedOverrideMps === null
          ? null
          : metresPerSecondToMph(snapshot.speedOverrideMps),
      accuracyOverrideM: snapshot.accuracyOverrideM,
      approxLat: position === null ? null : redactCoordinate(position.coords.latitude),
      approxLon: position === null ? null : redactCoordinate(position.coords.longitude),
      coordinatePrecision: 'approx-3dp',
      coordinateDecimals: REDACTION_DECIMALS,
      fixAgeMs:
        snapshot.lastFixAtMs === null ? null : driver.clock.now() - snapshot.lastFixAtMs,

      alertState: driver.engine.getState(),
      nearestCameraId: alert?.nearest?.id ?? null,
      nearestDistanceFt: alert?.nearest?.distanceFt ?? null,
      countInRange: alert?.countInRange ?? 0,
      thresholdFt: driver.engine.getConfig().thresholdFt,
      effectiveThresholdFt: alert?.effectiveThresholdFt ?? null,
      isClosing: alert?.isClosing ?? null,
      stationary: alert?.stationary ?? false,
      // A tick with no fix delivers nothing, so the alert flags fall back to
      // "not alerting" rather than to the last position tick's answer. Holding
      // a stale `true` here would be the panel claiming the phone is buzzing.
      shouldAlertUser: alert?.shouldAlertUser ?? false,
      hapticPulses: alert?.hapticPulses ?? 0,
      suppressedBy: alert?.suppressedBy ?? [],
      globallyMuted: driver.engine.isGloballyMuted(),
      globalMuteRemainingMs: driver.engine.globalMuteRemainingMs(),
      cameras: (alert?.cameras ?? []).map(toCameraRow),

      transitions,
      expectedTransitions: definition.expectedTransitions,
      matchesExpectation: isPrefix(transitions, definition.expectedTransitions),
      exposure: driver.engine.getExposure(),
      delivery: driver.engine.getDeliveryStats(),
    };
  };

  const publish = (): void => {
    cached = buildState();
    for (const listener of [...listeners]) listener(cached);
  };

  const requireDriver = (): ScenarioDriver | null => driver;

  const controller: DevPanelController = {
    state(): DevPanelState {
      return cached;
    },

    subscribe(listener: (state: DevPanelState) => void): DevPanelUnsubscribe {
      listeners.add(listener);
      listener(cached);
      return () => {
        listeners.delete(listener);
      };
    },

    load(id: ScenarioId, overrides?: ScenarioOverrides): void {
      // `scenario()` throws on an unknown id, which is the right failure for a
      // typed caller: a dev panel pointed at a scenario that does not exist has
      // a bug, and a silent empty screen would hide it.
      scenario(id);
      currentId = id;
      if (overrides !== undefined) currentOverrides = overrides;
      driver = createScenarioDriver(id, currentOverrides);
      publish();
    },

    loadById(id: string, overrides?: ScenarioOverrides): boolean {
      if (!isScenarioId(id)) return false;
      controller.load(id, overrides);
      return true;
    },

    reload(): void {
      if (currentId === null) return;
      controller.load(currentId, currentOverrides);
    },

    unload(): void {
      driver = null;
      currentId = null;
      publish();
    },

    step(count = 1): ScenarioTickRecord[] {
      const active = requireDriver();
      if (active === null) return [];
      if (!Number.isInteger(count) || count < 1) {
        throw new RangeError(`DevPanel.step: count must be an integer >= 1, received ${String(count)}`);
      }
      const produced: ScenarioTickRecord[] = [];
      for (let i = 0; i < count; i++) {
        const record = active.next();
        if (record === null) break;
        produced.push(record);
      }
      publish();
      return produced;
    },

    runToEnd(): ScenarioTickRecord[] {
      const active = requireDriver();
      if (active === null) return [];
      const produced = active.drain();
      publish();
      return produced;
    },

    pause(): void {
      driver?.simulator.pause();
      publish();
    },

    resume(): void {
      driver?.simulator.resume();
      publish();
    },

    jumpToWaypoint(index: number): void {
      driver?.simulator.jumpToWaypoint(index);
      publish();
    },

    setSpeedOverrideMph(mph: number | null): void {
      driver?.simulator.setSpeedOverrideMps(mph === null ? null : mphToMetresPerSecond(mph));
      publish();
    },

    setAccuracyOverrideM(metres: number | null): void {
      driver?.simulator.setAccuracyOverrideM(metres);
      publish();
    },

    setFixLost(lost: boolean): void {
      driver?.simulator.setFixLost(lost);
      publish();
    },

    muteAll(durationMs?: number): void {
      if (driver === null) return;
      if (durationMs === undefined) driver.engine.muteAll();
      else driver.engine.muteAll(durationMs);
      publish();
    },

    unmuteAll(): void {
      driver?.engine.unmuteAll();
      publish();
    },

    muteCamera(cameraId: string, durationMs?: number): void {
      if (driver === null) return;
      if (durationMs === undefined) driver.engine.muteCamera(cameraId);
      else driver.engine.muteCamera(cameraId, durationMs);
      publish();
    },

    unmuteCamera(cameraId: string): void {
      driver?.engine.unmuteCamera(cameraId);
      publish();
    },

    setThresholdFt(thresholdFt: number): void {
      driver?.engine.setThresholdFt(thresholdFt);
      publish();
    },

    run(): ScenarioRun | null {
      return driver?.finish() ?? null;
    },

    dispose(): void {
      listeners.clear();
    },
  };

  if (options.initialScenarioId !== undefined) {
    controller.load(options.initialScenarioId, currentOverrides);
  } else {
    cached = buildState();
  }

  return controller;
}
