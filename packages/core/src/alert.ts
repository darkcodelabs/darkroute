/**
 * The proximity + alert engine.
 *
 * One object owns the driving loop: it takes position fixes and camera records
 * and produces an {@link AlertTick}. Everything it needs to be deterministic -
 * time, thresholds, dwell - is injected, so a whole drive replays identically
 * in a unit test.
 *
 * The rule the whole file is built around, from `Flockys Screens II.dc.html`
 * B4: "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 * count in EXPOSURE, still log to LOOKUP. Muting only removes the alert -
 * never the record." So mute touches exactly three fields of the tick
 * (`shouldAlertUser`, `hapticPulses`, `notifyCameraIds`) and nothing else.
 * Detection, state transitions, history and exposure are byte-identical muted
 * or not, and there is a test that proves it.
 *
 * PRIVACY: nothing here records the vehicle's latitude or longitude. The
 * history the LOG screen reads back holds distance, speed, camera id and
 * state - never a coordinate, never a plate.
 */

import { systemClock } from './clock.ts';
import type { Clock } from './clock.ts';
import {
  bearing,
  distanceFt,
  feetToMetres,
  isFacingVehicle,
  mphToMetresPerSecond,
  relativeDirection,
  MIN_METRES_PER_DEGREE_LATITUDE,
  assertLatLon,
} from './geo.ts';
import type { AlertState, CameraLike, PositionFix, RelativeDirection, SpeedSource } from './types.ts';

// ---------------------------------------------------------------------------
// Design-sourced constants
//
// Every number below was read out of the design files, not invented. The
// citation is the point: when one of these changes, the design changed.
// ---------------------------------------------------------------------------

/**
 * SWEEP's distance rings, feet.
 * `Flockys Design System.dc.html` § SWEEP PRIMITIVES: "rings 100/300/500/1000ft".
 */
export const SWEEP_RING_FT: readonly number[] = [100, 300, 500, 1000];

/**
 * Default alert threshold, feet.
 * `Flockys App Screens.dc.html` 01 · RADAR and `Flockys Watch.dc.html` W10:
 * "ALERT AT / 500 / FT".
 */
export const DEFAULT_ALERT_THRESHOLD_FT = 500;

/**
 * Threshold slider bounds, feet.
 * `Flockys Design System.dc.html` § settings: "ALERT AT · 500 FT" between
 * end labels "100" and "1000".
 */
export const ALERT_THRESHOLD_MIN_FT = 100;
export const ALERT_THRESHOLD_MAX_FT = 1000;

/**
 * Threshold increment, feet.
 * `Flockys Watch.dc.html` W10 · THRESHOLD - ROTARY BEZEL:
 * "TURN BEZEL · 50 FT STEPS / HAPTIC TICK EACH STEP".
 */
export const ALERT_THRESHOLD_STEP_FT = 50;

/**
 * Outer edge of the approaching band, feet.
 * `Flockys Design System.dc.html`: approaching is "#FFC02E · 500 - 1000 ft,
 * closing"; `Flockys App Screens.dc.html` RADAR state matrix:
 * "APPROACHING · 1 pulse @ 1000ft".
 */
export const APPROACHING_OUTER_FT = 1000;

/**
 * How many cameras inside the threshold make it `multiple`.
 * `Flockys Design System.dc.html`: "#FF3DBE · 2+ in range · 2-pulse haptic".
 */
export const MULTIPLE_MIN_CAMERAS = 2;

/**
 * A muted camera this close alerts anyway, feet.
 * `Flockys Screens II.dc.html` B4: "RE-ALERT ON MUTED IF / closer than 150 ft".
 */
export const DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT = 150;

/**
 * How long a mute lasts, ms.
 * `Flockys Design System.dc.html` § watch rules: "long-press = mute 10 min";
 * `Flockys Screens II.dc.html` B7: "Swipe left on the tile = mute 10 min".
 */
export const DEFAULT_MUTE_DURATION_MS = 600_000;

/**
 * The speed above which the product considers itself to be driving, mph.
 * `Flockys Design System.dc.html` § dash mode: "any list longer than 5 rows
 * collapses to a count + voice readout while speed > 5 mph".
 */
export const DRIVE_MODE_MIN_SPEED_MPH = 5;

/**
 * Haptic pulses per state.
 *
 * clear:       "CLEAR · no haptic, no sound" (App Screens, RADAR state matrix)
 * approaching: "APPROACHING · 1 pulse @ 1000ft" (App Screens, RADAR state matrix)
 * in_range:    "IN RANGE / ALERT · 2 PULSES" (Screens II B7 · WEAR, at 425 ft)
 * multiple:    "2+ in range · 2-pulse haptic" (Design System, alert states)
 *
 * in_range and multiple deliberately share a pulse count: that is what the two
 * design files say, and the states are told apart by hue, which is the rule
 * ("hue means state and nothing else"). These pulses are for CAMERAS ONLY -
 * county-entry and watchlist notifications are silent
 * ("Silent, no vibration - alert haptics stay reserved for cameras").
 */
export const HAPTIC_PULSES_BY_STATE: Readonly<Record<AlertState, 0 | 1 | 2>> = {
  clear: 0,
  approaching: 1,
  in_range: 2,
  multiple: 2,
};

export function hapticPulsesForState(state: AlertState): 0 | 1 | 2 {
  return HAPTIC_PULSES_BY_STATE[state];
}

// ---------------------------------------------------------------------------
// Engineering defaults
//
// The design files do not specify these. Each one is derived from a value that
// IS in the design, and each has an entry in docs/gaps-inbox/core-engine.md so
// the numbers get a decision rather than inheriting one by default.
// ---------------------------------------------------------------------------

/**
 * Width of the exit band, feet. GAP: see DESIGN-GAPS.md#alert-hysteresis-band
 * Stand-in: one bezel step (ALERT_THRESHOLD_STEP_FT), so the band a driver
 * cannot see is never wider than the smallest change they can make.
 */
export const DEFAULT_HYSTERESIS_FT = ALERT_THRESHOLD_STEP_FT;

/** Per-camera notification cooldown, ms. GAP: see DESIGN-GAPS.md#alert-cooldown-window */
export const DEFAULT_NOTIFICATION_COOLDOWN_MS = DEFAULT_MUTE_DURATION_MS;

/** Worst horizontal accuracy that may still alert, metres. GAP: see DESIGN-GAPS.md#gps-accuracy-gate */
export const DEFAULT_GPS_ACCURACY_LIMIT_M = 50;

/** At or below this the vehicle is not moving, m/s (= 5 mph). */
export const DEFAULT_STATIONARY_SPEED_MPS = mphToMetresPerSecond(DRIVE_MODE_MIN_SPEED_MPH);

/** Stationary this long before alerts are suppressed, ms. GAP: see DESIGN-GAPS.md#stationary-dwell */
export const DEFAULT_STATIONARY_DWELL_MS = 120_000;

/** Moving this long before alerts come back, ms. GAP: see DESIGN-GAPS.md#stationary-dwell */
export const DEFAULT_MOVING_DWELL_MS = 5_000;

/** Two cameras closer than this with different ids are one camera, feet. GAP: see DESIGN-GAPS.md#camera-dedupe-epsilon */
export const DEFAULT_DEDUPE_EPSILON_FT = 50;

/** Ring buffer size for the in-memory transition log. */
export const DEFAULT_MAX_HISTORY_ENTRIES = 500;

/** Smoothing factor for derived speed. GAP: see DESIGN-GAPS.md#derived-speed-smoothing */
export const SPEED_SMOOTHING_ALPHA = 0.4;

/** Samples closer together than this are too noisy to derive a speed from, ms. */
export const MIN_SPEED_SAMPLE_MS = 250;

/**
 * Device motion above this vetoes a "stationary" conclusion, m/s².
 * Supporting evidence only - it never establishes a speed.
 * GAP: see DESIGN-GAPS.md#motion-stationary-veto
 */
export const MOTION_STATIONARY_VETO_MPS2 = 0.6;

/** Distance change smaller than this is GPS noise, not closing or receding, feet. */
export const CLOSING_EPSILON_FT = 10;

// ---------------------------------------------------------------------------
// deriveAlertState
// ---------------------------------------------------------------------------

export interface DeriveAlertStateInput {
  /** Distance to the closest camera, or `null` when none is known. */
  nearestDistanceFt: number | null;
  /** How many cameras the caller counts as in range. */
  cameraCountInRange: number;
  /** Entry threshold, feet. */
  thresholdFt: number;
  /** State on the previous tick - what makes the band asymmetric. */
  previousState: AlertState;
  /** Extra feet a camera must travel back out before the state relaxes. */
  hysteresisFt: number;
}

/**
 * The state machine, as a pure function.
 *
 * Hysteresis is asymmetric on purpose. Entering costs `thresholdFt`; leaving
 * costs `thresholdFt + hysteresisFt`. Without that, a camera sitting at 500.0
 * ft with a metre of GPS jitter toggles the whole screen several times a
 * second.
 *
 * `cameraCountInRange` decides in_range vs multiple only. The caller is
 * expected to have counted at the same effective threshold; {@link AlertEngine}
 * does. When it has not, the nearest-distance gate still governs, which is the
 * conservative direction: it holds an alert rather than dropping one.
 *
 * @throws RangeError on a non-finite or negative threshold/hysteresis/count.
 */
export function deriveAlertState(input: DeriveAlertStateInput): AlertState {
  const { nearestDistanceFt, cameraCountInRange, thresholdFt, previousState, hysteresisFt } = input;

  if (!Number.isFinite(thresholdFt) || thresholdFt <= 0) {
    throw new RangeError(`deriveAlertState: thresholdFt must be finite and > 0, received ${String(thresholdFt)}`);
  }
  if (!Number.isFinite(hysteresisFt) || hysteresisFt < 0) {
    throw new RangeError(`deriveAlertState: hysteresisFt must be finite and >= 0, received ${String(hysteresisFt)}`);
  }
  if (!Number.isInteger(cameraCountInRange) || cameraCountInRange < 0) {
    throw new RangeError(
      `deriveAlertState: cameraCountInRange must be a non-negative integer, received ${String(cameraCountInRange)}`,
    );
  }
  if (nearestDistanceFt !== null && (!Number.isFinite(nearestDistanceFt) || nearestDistanceFt < 0)) {
    throw new RangeError(
      `deriveAlertState: nearestDistanceFt must be null or a finite distance >= 0, received ${String(nearestDistanceFt)}`,
    );
  }

  if (nearestDistanceFt === null) return 'clear';

  const wasInside = previousState === 'in_range' || previousState === 'multiple';
  const effectiveThresholdFt = wasInside ? thresholdFt + hysteresisFt : thresholdFt;

  if (nearestDistanceFt <= effectiveThresholdFt) {
    return cameraCountInRange >= MULTIPLE_MIN_CAMERAS ? 'multiple' : 'in_range';
  }
  if (nearestDistanceFt <= APPROACHING_OUTER_FT) return 'approaching';
  return 'clear';
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/** A camera that survived deduplication, plus every id that folded into it. */
export interface DedupedCamera extends CameraLike {
  /** Every input id this record stands for, sorted. Always includes `id`. */
  readonly mergedIds: readonly string[];
}

/**
 * Collapse the same physical camera reported more than once.
 *
 * Two things cause duplicates. Overlapping tile fetches return the same record
 * twice - caught by id. And two people reporting the same pole produce two ids
 * a few feet apart - caught by position.
 *
 * The survivor of a positional cluster is the lexicographically smallest id, so
 * the result does not depend on the order the tiles came back in. If any camera
 * in the cluster has a known facing, the survivor adopts it: a known direction
 * is strictly more information than `null`, and losing it to arbitrary ordering
 * would be a silent downgrade.
 *
 * @throws RangeError on a non-positive epsilon or an invalid camera coordinate.
 */
export function dedupeCameras(
  cameras: readonly CameraLike[],
  epsilonFt: number = DEFAULT_DEDUPE_EPSILON_FT,
): DedupedCamera[] {
  if (!Number.isFinite(epsilonFt) || epsilonFt < 0) {
    throw new RangeError(`dedupeCameras: epsilonFt must be finite and >= 0, received ${String(epsilonFt)}`);
  }

  // Pass 1 - identical ids. First occurrence wins, but a later duplicate that
  // carries a facing upgrades a `null` one.
  const byId = new Map<string, CameraLike>();
  for (const camera of cameras) {
    assertLatLon(camera.lat, camera.lon, `dedupeCameras(${camera.id})`);
    const existing = byId.get(camera.id);
    if (existing === undefined) {
      byId.set(camera.id, camera);
    } else if (existing.directionDeg === null && camera.directionDeg !== null) {
      byId.set(camera.id, camera);
    }
  }

  // Pass 2 - distinct ids at effectively the same place. Sorting by latitude
  // bounds the comparison window: two points within `epsilonFt` can differ by
  // at most that many feet of latitude, so the scan stops early instead of
  // going quadratic over a whole tile's worth of cameras.
  const unique = [...byId.values()].sort((a, b) => a.lat - b.lat || a.lon - b.lon || a.id.localeCompare(b.id));
  const latWindowDeg = feetToMetres(epsilonFt) / MIN_METRES_PER_DEGREE_LATITUDE;

  const clusterOf = new Map<string, string>(); // id -> cluster root id
  const rootOf = (id: string): string => {
    let root = id;
    let next = clusterOf.get(root);
    while (next !== undefined && next !== root) {
      root = next;
      next = clusterOf.get(root);
    }
    return root;
  };

  for (let i = 0; i < unique.length; i++) {
    const a = unique[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < unique.length; j++) {
      const b = unique[j];
      if (b === undefined) continue;
      if (b.lat - a.lat > latWindowDeg) break; // sorted: nothing further can be close enough
      if (distanceFt(a.lat, a.lon, b.lat, b.lon) > epsilonFt) continue;
      const rootA = rootOf(a.id);
      const rootB = rootOf(b.id);
      if (rootA === rootB) continue;
      const winner = rootA < rootB ? rootA : rootB;
      const loser = rootA < rootB ? rootB : rootA;
      clusterOf.set(loser, winner);
    }
  }

  const clusters = new Map<string, string[]>();
  for (const camera of unique) {
    const root = rootOf(camera.id);
    const members = clusters.get(root);
    if (members === undefined) clusters.set(root, [camera.id]);
    else members.push(camera.id);
  }

  const out: DedupedCamera[] = [];
  for (const [root, memberIds] of clusters) {
    const sortedIds = [...memberIds].sort((a, b) => a.localeCompare(b));
    const survivor = byId.get(root);
    if (survivor === undefined) continue;
    let directionDeg = survivor.directionDeg;
    if (directionDeg === null) {
      for (const id of sortedIds) {
        const member = byId.get(id);
        if (member !== undefined && member.directionDeg !== null) {
          directionDeg = member.directionDeg;
          break;
        }
      }
    }
    out.push({
      id: survivor.id,
      lat: survivor.lat,
      lon: survivor.lon,
      directionDeg,
      mergedIds: sortedIds,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Tick shapes
// ---------------------------------------------------------------------------

/** Why the user was not alerted, even though the state says something is there. */
export type SuppressionReason = 'accuracy' | 'stationary' | 'muted' | 'cooldown';

/** One camera, measured against the current fix. */
export interface CameraAssessment {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly distanceFt: number;
  /** Bearing from the vehicle to the camera, degrees. */
  readonly bearingDeg: number;
  /** `null` when the platform gave no heading - there is no "relative" without one. */
  readonly relativeDirection: RelativeDirection | null;
  /** `null` when the camera's facing is unknown. Never coerced to `false`. */
  readonly facingVehicle: boolean | null;
  readonly directionDeg: number | null;
  readonly inRange: boolean;
  /** This camera specifically is muted. Global mute is on the tick, not here. */
  readonly muted: boolean;
  /** Every reported id this record stands for. */
  readonly mergedIds: readonly string[];
}

/**
 * One transition, as the LOG screen reads it back.
 * Holds no coordinate and no plate - see the privacy note at the top of the file.
 */
export interface AlertHistoryEntry {
  readonly timestampMs: number;
  readonly state: AlertState;
  readonly previousState: AlertState;
  readonly nearestCameraId: string | null;
  readonly nearestDistanceFt: number | null;
  readonly countInRange: number;
  readonly speedMps: number | null;
}

/** What EXPOSURE counts. Provably identical whether or not anything was muted. */
export interface ExposureSnapshot {
  readonly camerasInRangeIds: readonly string[];
  readonly camerasInRangeCount: number;
  /** Times the state entered in_range/multiple from outside it. */
  readonly inRangeEvents: number;
}

/** Delivery accounting. Deliberately NOT part of the exposure record. */
export interface DeliveryStats {
  readonly alertsDelivered: number;
  readonly notificationsSuppressed: number;
}

/** The engine's answer for one position fix. */
export interface AlertTick {
  readonly timestampMs: number;
  readonly state: AlertState;
  readonly previousState: AlertState;
  readonly changed: boolean;
  /** Closest camera, or `null` when none is known. */
  readonly nearest: CameraAssessment | null;
  /** Deduplicated, nearest first. Muted cameras are present - they still draw. */
  readonly cameras: readonly CameraAssessment[];
  readonly countInRange: number;
  readonly thresholdFt: number;
  /** The threshold actually applied this tick, widened while inside. */
  readonly effectiveThresholdFt: number;
  /** `true` closing, `false` receding, `null` not yet known. */
  readonly isClosing: boolean | null;
  readonly speedMps: number | null;
  readonly speedSource: SpeedSource;
  readonly accuracyM: number | null;
  readonly stationary: boolean;
  readonly globallyMuted: boolean;
  /** The one field the rest of the app may use to buzz, ring or take over the screen. */
  readonly shouldAlertUser: boolean;
  readonly hapticPulses: 0 | 1 | 2;
  /** Cameras to notify for on this tick. Empty unless `shouldAlertUser`. */
  readonly notifyCameraIds: readonly string[];
  readonly suppressedBy: readonly SuppressionReason[];
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface AlertEngineOptions {
  thresholdFt?: number;
  hysteresisFt?: number;
  notificationCooldownMs?: number;
  gpsAccuracyLimitM?: number;
  /** Gate alerting when the platform reports no accuracy at all. Default false. */
  gateOnUnknownAccuracy?: boolean;
  stationarySpeedMps?: number;
  stationaryDwellMs?: number;
  movingDwellMs?: number;
  dedupeEpsilonFt?: number;
  reAlertWhenCloserThanFt?: number;
  /** Honour "500 - 1000 ft, CLOSING" literally. Default true. */
  requireClosingForApproaching?: boolean;
  maxHistoryEntries?: number;
  clock?: Clock;
}

export type AlertEngineConfig = Required<Omit<AlertEngineOptions, 'clock'>>;

const DEFAULT_CONFIG: AlertEngineConfig = {
  thresholdFt: DEFAULT_ALERT_THRESHOLD_FT,
  hysteresisFt: DEFAULT_HYSTERESIS_FT,
  notificationCooldownMs: DEFAULT_NOTIFICATION_COOLDOWN_MS,
  gpsAccuracyLimitM: DEFAULT_GPS_ACCURACY_LIMIT_M,
  gateOnUnknownAccuracy: false,
  stationarySpeedMps: DEFAULT_STATIONARY_SPEED_MPS,
  stationaryDwellMs: DEFAULT_STATIONARY_DWELL_MS,
  movingDwellMs: DEFAULT_MOVING_DWELL_MS,
  dedupeEpsilonFt: DEFAULT_DEDUPE_EPSILON_FT,
  reAlertWhenCloserThanFt: DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT,
  requireClosingForApproaching: true,
  maxHistoryEntries: DEFAULT_MAX_HISTORY_ENTRIES,
};

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`AlertEngine: ${label} must be finite and > 0, received ${String(value)}`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`AlertEngine: ${label} must be finite and >= 0, received ${String(value)}`);
  }
}

function resolveConfig(options: AlertEngineOptions): AlertEngineConfig {
  const config: AlertEngineConfig = {
    thresholdFt: options.thresholdFt ?? DEFAULT_CONFIG.thresholdFt,
    hysteresisFt: options.hysteresisFt ?? DEFAULT_CONFIG.hysteresisFt,
    notificationCooldownMs: options.notificationCooldownMs ?? DEFAULT_CONFIG.notificationCooldownMs,
    gpsAccuracyLimitM: options.gpsAccuracyLimitM ?? DEFAULT_CONFIG.gpsAccuracyLimitM,
    gateOnUnknownAccuracy: options.gateOnUnknownAccuracy ?? DEFAULT_CONFIG.gateOnUnknownAccuracy,
    stationarySpeedMps: options.stationarySpeedMps ?? DEFAULT_CONFIG.stationarySpeedMps,
    stationaryDwellMs: options.stationaryDwellMs ?? DEFAULT_CONFIG.stationaryDwellMs,
    movingDwellMs: options.movingDwellMs ?? DEFAULT_CONFIG.movingDwellMs,
    dedupeEpsilonFt: options.dedupeEpsilonFt ?? DEFAULT_CONFIG.dedupeEpsilonFt,
    reAlertWhenCloserThanFt: options.reAlertWhenCloserThanFt ?? DEFAULT_CONFIG.reAlertWhenCloserThanFt,
    requireClosingForApproaching:
      options.requireClosingForApproaching ?? DEFAULT_CONFIG.requireClosingForApproaching,
    maxHistoryEntries: options.maxHistoryEntries ?? DEFAULT_CONFIG.maxHistoryEntries,
  };

  assertThresholdFt(config.thresholdFt);
  assertNonNegative(config.hysteresisFt, 'hysteresisFt');
  assertNonNegative(config.notificationCooldownMs, 'notificationCooldownMs');
  assertPositive(config.gpsAccuracyLimitM, 'gpsAccuracyLimitM');
  assertNonNegative(config.stationarySpeedMps, 'stationarySpeedMps');
  assertNonNegative(config.stationaryDwellMs, 'stationaryDwellMs');
  assertNonNegative(config.movingDwellMs, 'movingDwellMs');
  assertNonNegative(config.dedupeEpsilonFt, 'dedupeEpsilonFt');
  assertNonNegative(config.reAlertWhenCloserThanFt, 'reAlertWhenCloserThanFt');
  if (!Number.isInteger(config.maxHistoryEntries) || config.maxHistoryEntries < 1) {
    throw new RangeError(
      `AlertEngine: maxHistoryEntries must be an integer >= 1, received ${String(config.maxHistoryEntries)}`,
    );
  }
  return config;
}

/**
 * Threshold bounds are a product decision, not a clamp: the slider goes 100 to
 * 1000 and the bezel steps in 50s, so a value outside that is a caller bug.
 */
export function assertThresholdFt(thresholdFt: number): void {
  if (
    !Number.isFinite(thresholdFt) ||
    thresholdFt < ALERT_THRESHOLD_MIN_FT ||
    thresholdFt > ALERT_THRESHOLD_MAX_FT
  ) {
    throw new RangeError(
      `AlertEngine: thresholdFt must be within [${String(ALERT_THRESHOLD_MIN_FT)}, ${String(ALERT_THRESHOLD_MAX_FT)}] ft, received ${String(thresholdFt)}`,
    );
  }
}

interface LastPosition {
  readonly lat: number;
  readonly lon: number;
  readonly timestampMs: number;
}

export class AlertEngine {
  readonly #clock: Clock;
  #config: AlertEngineConfig;

  #state: AlertState = 'clear';
  /** Not exposed and never logged: a coordinate history is a movement history. */
  #lastPosition: LastPosition | null = null;
  #smoothedSpeedMps: number | null = null;
  #lastNearestId: string | null = null;
  #lastNearestDistanceFt: number | null = null;
  #isClosing: boolean | null = null;

  #stationarySince: number | null = null;
  #movingSince: number | null = null;
  #stationarySuppressed = false;

  #globalMuteUntilMs: number | null = null;
  readonly #cameraMuteUntilMs = new Map<string, number>();
  readonly #lastNotifiedAtMs = new Map<string, number>();

  #history: AlertHistoryEntry[] = [];
  readonly #camerasSeenInRange = new Set<string>();
  /**
   * THE LAST DEDUPE, KEYED ON THE ARRAY IT CAME FROM.
   *
   * `dedupeCameras` is a pure function of (cameras, epsilon) and it is the most
   * expensive thing in `update` by a distance - measured over the shipped
   * archive it is 2.7 ms on a 987-camera window, 6.6 ms on the densest 3x3
   * (3,075) and 32.8 ms at the widest sync radius (9,961), which is 3.7x to
   * 6.4x the cost of ALL the geodesy in the assessment pass combined. It was
   * being recomputed on every GPS fix from an array that last changed when a
   * tile was written, minutes earlier.
   *
   * Array identity is a sufficient key. `dedupeEpsilonFt` is resolved once in
   * the constructor and there is no setter for it - `setThresholdFt` is the
   * only mutator on the config - so the cache cannot go stale on the epsilon.
   * On the producer side the camera store rebuilds the array wholesale on every
   * tile write, and the driving loop already depends on exactly that identity
   * contract to decide whether to re-run at all.
   */
  #dedupeCache: { input: readonly CameraLike[]; output: DedupedCamera[] } | null = null;

  #inRangeEvents = 0;
  #alertsDelivered = 0;
  #notificationsSuppressed = 0;

  constructor(options: AlertEngineOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#config = resolveConfig(options);
  }

  // -- configuration --------------------------------------------------------

  getConfig(): AlertEngineConfig {
    return { ...this.#config };
  }

  setThresholdFt(thresholdFt: number): void {
    assertThresholdFt(thresholdFt);
    this.#config = { ...this.#config, thresholdFt };
  }

  // -- mute -----------------------------------------------------------------

  /** Mute every camera for a while. Suppresses delivery only. */
  muteAll(durationMs: number = DEFAULT_MUTE_DURATION_MS): void {
    assertPositive(durationMs, 'muteAll(durationMs)');
    this.#globalMuteUntilMs = this.#clock.now() + durationMs;
  }

  unmuteAll(): void {
    this.#globalMuteUntilMs = null;
  }

  isGloballyMuted(): boolean {
    return this.#muteRemainingMs(this.#globalMuteUntilMs, this.#clock.now()) > 0;
  }

  /** Milliseconds left on the global mute - the "MUTED 8:12" readout. */
  globalMuteRemainingMs(): number {
    return this.#muteRemainingMs(this.#globalMuteUntilMs, this.#clock.now());
  }

  /** "MUTE THIS ONE" - one camera, still drawn, still counted, just silent. */
  muteCamera(cameraId: string, durationMs: number = DEFAULT_MUTE_DURATION_MS): void {
    assertPositive(durationMs, 'muteCamera(durationMs)');
    this.#cameraMuteUntilMs.set(cameraId, this.#clock.now() + durationMs);
  }

  unmuteCamera(cameraId: string): void {
    this.#cameraMuteUntilMs.delete(cameraId);
  }

  isCameraMuted(cameraId: string): boolean {
    return this.#muteRemainingMs(this.#cameraMuteUntilMs.get(cameraId) ?? null, this.#clock.now()) > 0;
  }

  #muteRemainingMs(untilMs: number | null, nowMs: number): number {
    if (untilMs === null) return 0;
    return Math.max(0, untilMs - nowMs);
  }

  // -- record ---------------------------------------------------------------

  getState(): AlertState {
    return this.#state;
  }

  getHistory(): readonly AlertHistoryEntry[] {
    return this.#history;
  }

  getExposure(): ExposureSnapshot {
    const ids = [...this.#camerasSeenInRange].sort((a, b) => a.localeCompare(b));
    return {
      camerasInRangeIds: ids,
      camerasInRangeCount: ids.length,
      inRangeEvents: this.#inRangeEvents,
    };
  }

  getDeliveryStats(): DeliveryStats {
    return {
      alertsDelivered: this.#alertsDelivered,
      notificationsSuppressed: this.#notificationsSuppressed,
    };
  }

  /** Wipe everything, including the mute timers. Used between trips and in tests. */
  reset(): void {
    this.#state = 'clear';
    this.#lastPosition = null;
    this.#smoothedSpeedMps = null;
    this.#lastNearestId = null;
    this.#lastNearestDistanceFt = null;
    this.#isClosing = null;
    this.#stationarySince = null;
    this.#movingSince = null;
    this.#stationarySuppressed = false;
    this.#globalMuteUntilMs = null;
    this.#cameraMuteUntilMs.clear();
    this.#lastNotifiedAtMs.clear();
    this.#history = [];
    this.#camerasSeenInRange.clear();
    this.#inRangeEvents = 0;
    this.#alertsDelivered = 0;
    this.#notificationsSuppressed = 0;
  }

  // -- the loop -------------------------------------------------------------

  /**
   * Advance one position fix.
   *
   * @throws RangeError on an invalid fix or camera coordinate.
   */
  update(fix: PositionFix, cameras: readonly CameraLike[] = []): AlertTick {
    assertLatLon(fix.lat, fix.lon, 'AlertEngine.update(fix)');
    const nowMs = fix.timestampMs ?? this.#clock.now();
    if (!Number.isFinite(nowMs)) {
      throw new RangeError(`AlertEngine.update: timestampMs must be finite, received ${String(nowMs)}`);
    }
    const config = this.#config;
    const previousState = this.#state;

    // --- speed, then stationarity -----------------------------------------
    const speed = this.#resolveSpeed(fix, nowMs);
    const stationary = this.#updateStationary(speed.mps, fix.motionMagnitudeMps2 ?? null, nowMs);

    // --- measure -----------------------------------------------------------
    const wasInside = previousState === 'in_range' || previousState === 'multiple';
    const effectiveThresholdFt = wasInside
      ? config.thresholdFt + config.hysteresisFt
      : config.thresholdFt;

    // See `#dedupeCache`. Same array in, same array out, no work.
    let deduped: DedupedCamera[];
    if (this.#dedupeCache !== null && this.#dedupeCache.input === cameras) {
      deduped = this.#dedupeCache.output;
    } else {
      deduped = dedupeCameras(cameras, config.dedupeEpsilonFt);
      this.#dedupeCache = { input: cameras, output: deduped };
    }

    const assessments: CameraAssessment[] = deduped
      .map((camera): CameraAssessment => {
        const distance = distanceFt(fix.lat, fix.lon, camera.lat, camera.lon);
        const bearingDeg = bearing(fix.lat, fix.lon, camera.lat, camera.lon);
        return {
          id: camera.id,
          lat: camera.lat,
          lon: camera.lon,
          distanceFt: distance,
          bearingDeg,
          relativeDirection:
            fix.headingDeg === null ? null : relativeDirection(fix.headingDeg, bearingDeg),
          facingVehicle: isFacingVehicle(camera.directionDeg, bearingDeg),
          directionDeg: camera.directionDeg,
          inRange: distance <= effectiveThresholdFt,
          muted: this.isCameraMuted(camera.id),
          mergedIds: camera.mergedIds,
        };
      })
      .sort((a, b) => a.distanceFt - b.distanceFt || a.id.localeCompare(b.id));

    const nearest = assessments[0] ?? null;
    const countInRange = assessments.reduce((total, a) => (a.inRange ? total + 1 : total), 0);

    // --- state -------------------------------------------------------------
    const isClosing = this.#updateClosing(nearest);
    let state = deriveAlertState({
      nearestDistanceFt: nearest === null ? null : nearest.distanceFt,
      cameraCountInRange: countInRange,
      thresholdFt: config.thresholdFt,
      previousState,
      hysteresisFt: config.hysteresisFt,
    });
    // "approaching · 500 - 1000 ft, CLOSING" - a camera you are driving away from
    // is not approaching, it is behind you.
    if (config.requireClosingForApproaching && state === 'approaching' && isClosing === false) {
      state = 'clear';
    }

    // --- the record. Identical whether or not anything is muted. ------------
    for (const assessment of assessments) {
      if (assessment.inRange) this.#camerasSeenInRange.add(assessment.id);
    }
    const nowInside = state === 'in_range' || state === 'multiple';
    if (nowInside && !wasInside) this.#inRangeEvents += 1;

    const changed = state !== previousState;
    if (changed) {
      this.#pushHistory({
        timestampMs: nowMs,
        state,
        previousState,
        nearestCameraId: nearest === null ? null : nearest.id,
        nearestDistanceFt: nearest === null ? null : nearest.distanceFt,
        countInRange,
        speedMps: speed.mps,
      });
    }
    this.#state = state;

    // --- delivery. The only part mute, accuracy and dwell can touch. -------
    const delivery = this.#resolveDelivery({
      state,
      assessments,
      nearest,
      stationary,
      accuracyM: fix.accuracyM,
      nowMs,
      config,
    });

    return {
      timestampMs: nowMs,
      state,
      previousState,
      changed,
      nearest,
      cameras: assessments,
      countInRange,
      thresholdFt: config.thresholdFt,
      effectiveThresholdFt,
      isClosing,
      speedMps: speed.mps,
      speedSource: speed.source,
      accuracyM: fix.accuracyM,
      stationary,
      globallyMuted: this.#muteRemainingMs(this.#globalMuteUntilMs, nowMs) > 0,
      shouldAlertUser: delivery.shouldAlertUser,
      hapticPulses: delivery.hapticPulses,
      notifyCameraIds: delivery.notifyCameraIds,
      suppressedBy: delivery.suppressedBy,
    };
  }

  // -- internals ------------------------------------------------------------

  #pushHistory(entry: AlertHistoryEntry): void {
    this.#history.push(entry);
    if (this.#history.length > this.#config.maxHistoryEntries) {
      this.#history = this.#history.slice(this.#history.length - this.#config.maxHistoryEntries);
    }
  }

  /**
   * Speed, in the documented source order.
   *
   * 1. `GeolocationCoordinates.speed`, when the platform supplies one.
   * 2. A smoothed position delta, when it does not.
   * 3. Device motion is NOT here. It is supporting evidence for "are we
   *    stopped", never a source of a number.
   */
  #resolveSpeed(fix: PositionFix, nowMs: number): { mps: number | null; source: SpeedSource } {
    if (fix.speedMps !== null && Number.isFinite(fix.speedMps) && fix.speedMps >= 0) {
      this.#smoothedSpeedMps = fix.speedMps;
      this.#lastPosition = { lat: fix.lat, lon: fix.lon, timestampMs: nowMs };
      return { mps: fix.speedMps, source: 'gps' };
    }

    const previous = this.#lastPosition;
    this.#lastPosition = { lat: fix.lat, lon: fix.lon, timestampMs: nowMs };
    if (previous === null) return { mps: this.#smoothedSpeedMps, source: this.#smoothedSpeedMps === null ? 'unknown' : 'derived' };

    const elapsedMs = nowMs - previous.timestampMs;
    if (elapsedMs < MIN_SPEED_SAMPLE_MS) {
      return { mps: this.#smoothedSpeedMps, source: this.#smoothedSpeedMps === null ? 'unknown' : 'derived' };
    }

    const travelledM = feetToMetres(distanceFt(previous.lat, previous.lon, fix.lat, fix.lon));
    const instantaneous = travelledM / (elapsedMs / 1000);
    this.#smoothedSpeedMps =
      this.#smoothedSpeedMps === null
        ? instantaneous
        : SPEED_SMOOTHING_ALPHA * instantaneous + (1 - SPEED_SMOOTHING_ALPHA) * this.#smoothedSpeedMps;
    return { mps: this.#smoothedSpeedMps, source: 'derived' };
  }

  /**
   * Stationary suppression with dwell on BOTH edges.
   *
   * A red light is 30 to 120 seconds of zero. Without dwell the app would go
   * quiet and loud again at every intersection, which trains a driver to
   * ignore it. Suppression needs `stationaryDwellMs` of continuous stillness;
   * restoring needs `movingDwellMs` of continuous movement. The restore dwell
   * is deliberately the shorter of the two - being late to alert is the
   * dangerous direction.
   */
  #updateStationary(speedMps: number | null, motionMps2: number | null, nowMs: number): boolean {
    const motionVeto = motionMps2 !== null && Number.isFinite(motionMps2) && motionMps2 > MOTION_STATIONARY_VETO_MPS2;
    // Unknown speed is not evidence of being parked. Without a number the
    // engine keeps alerting rather than guessing its way into silence.
    const stationaryNow =
      speedMps !== null && speedMps <= this.#config.stationarySpeedMps && !motionVeto;

    if (stationaryNow) {
      this.#movingSince = null;
      this.#stationarySince ??= nowMs;
      if (!this.#stationarySuppressed && nowMs - this.#stationarySince >= this.#config.stationaryDwellMs) {
        this.#stationarySuppressed = true;
      }
    } else {
      this.#stationarySince = null;
      this.#movingSince ??= nowMs;
      if (this.#stationarySuppressed && nowMs - this.#movingSince >= this.#config.movingDwellMs) {
        this.#stationarySuppressed = false;
      }
    }
    return this.#stationarySuppressed;
  }

  /** Sticky closing detector: flips only on a move bigger than GPS noise. */
  #updateClosing(nearest: CameraAssessment | null): boolean | null {
    if (nearest === null) {
      this.#lastNearestId = null;
      this.#lastNearestDistanceFt = null;
      this.#isClosing = null;
      return null;
    }
    const previousDistance = this.#lastNearestDistanceFt;
    if (this.#lastNearestId !== nearest.id || previousDistance === null) {
      this.#lastNearestId = nearest.id;
      this.#lastNearestDistanceFt = nearest.distanceFt;
      this.#isClosing = null;
      return null;
    }
    if (nearest.distanceFt < previousDistance - CLOSING_EPSILON_FT) this.#isClosing = true;
    else if (nearest.distanceFt > previousDistance + CLOSING_EPSILON_FT) this.#isClosing = false;
    this.#lastNearestDistanceFt = nearest.distanceFt;
    return this.#isClosing;
  }

  #resolveDelivery(args: {
    state: AlertState;
    assessments: readonly CameraAssessment[];
    nearest: CameraAssessment | null;
    stationary: boolean;
    accuracyM: number | null;
    nowMs: number;
    config: AlertEngineConfig;
  }): {
    shouldAlertUser: boolean;
    hapticPulses: 0 | 1 | 2;
    notifyCameraIds: readonly string[];
    suppressedBy: readonly SuppressionReason[];
  } {
    const { state, assessments, nearest, stationary, accuracyM, nowMs, config } = args;
    const silent = { shouldAlertUser: false, hapticPulses: 0 as const, notifyCameraIds: [] };

    if (state === 'clear') return { ...silent, suppressedBy: [] };

    const reasons: SuppressionReason[] = [];

    // A fix this loose cannot tell 400 ft from 600 ft. The state above was
    // still computed and still logged - only the buzz is withheld.
    const accuracyGated =
      accuracyM === null || !Number.isFinite(accuracyM)
        ? config.gateOnUnknownAccuracy
        : accuracyM > config.gpsAccuracyLimitM;
    if (accuracyGated) reasons.push('accuracy');
    if (stationary) reasons.push('stationary');

    // Which cameras drove this state.
    const candidates =
      state === 'approaching'
        ? nearest === null
          ? []
          : [nearest]
        : assessments.filter((a) => a.inRange);

    // Mute pierce: "RE-ALERT ON MUTED IF closer than 150 ft".
    const pierces = (a: CameraAssessment): boolean => a.distanceFt < config.reAlertWhenCloserThanFt;
    const globallyMuted = this.#muteRemainingMs(this.#globalMuteUntilMs, nowMs) > 0;
    const audible = candidates.filter((a) => {
      if (pierces(a)) return true;
      return !globallyMuted && !a.muted;
    });
    if (candidates.length > 0 && audible.length === 0) reasons.push('muted');

    const cooled = audible.filter((a) => {
      const last = this.#lastNotifiedAtMs.get(a.id);
      return last === undefined || nowMs - last >= config.notificationCooldownMs;
    });
    if (audible.length > 0 && cooled.length === 0) reasons.push('cooldown');

    const shouldAlertUser = !accuracyGated && !stationary && cooled.length > 0;
    if (!shouldAlertUser) {
      if (candidates.length > 0) this.#notificationsSuppressed += 1;
      return { ...silent, suppressedBy: reasons };
    }

    for (const a of cooled) this.#lastNotifiedAtMs.set(a.id, nowMs);
    this.#alertsDelivered += 1;
    return {
      shouldAlertUser: true,
      hapticPulses: hapticPulsesForState(state),
      notifyCameraIds: cooled.map((a) => a.id),
      suppressedBy: [],
    };
  }
}

/** Factory, for callers that would rather not write `new`. */
export function createAlertEngine(options: AlertEngineOptions = {}): AlertEngine {
  return new AlertEngine(options);
}

/**
 * Convenience for SWEEP: which ring a distance falls inside, or `null` beyond
 * the outermost. Keeps the ring list from being re-typed at the call site.
 */
export function ringForDistanceFt(distance: number): number | null {
  for (const ring of SWEEP_RING_FT) {
    if (distance <= ring) return ring;
  }
  return null;
}

/** Snap a threshold to the bezel's 50 ft steps and hold it inside the slider bounds. */
export function snapThresholdFt(thresholdFt: number): number {
  if (!Number.isFinite(thresholdFt)) {
    throw new RangeError(`snapThresholdFt: expected a finite value, received ${String(thresholdFt)}`);
  }
  const snapped = Math.round(thresholdFt / ALERT_THRESHOLD_STEP_FT) * ALERT_THRESHOLD_STEP_FT;
  return Math.min(ALERT_THRESHOLD_MAX_FT, Math.max(ALERT_THRESHOLD_MIN_FT, snapped));
}
