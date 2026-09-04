/**
 * @fwm/core - the proximity + alert engine.
 *
 * Pure TypeScript. No React, no zustand, no browser global, no network. The
 * whole package is a function of (position fixes, camera records, an injected
 * clock), which is why the driving loop can be tested in node and why the same
 * code answers for the phone, the watch and the dash surface.
 *
 * Two invariants worth restating at the entry point:
 *
 *  - Muting suppresses delivery, never detection. `AlertState`, history,
 *    exposure counts and the camera list are identical whether or not anything
 *    is muted.
 *  - Nothing here stores or returns the vehicle's coordinates beyond the tick
 *    that produced them, and nothing here has ever seen a licence plate.
 */

export type {
  AlertState,
  CameraLike,
  PositionFix,
  RelativeDirection,
  SpeedSource,
  TileRef,
} from './types.ts';

export type { Clock, TestClock } from './clock.ts';
export { systemClock, createTestClock } from './clock.ts';

export {
  AHEAD_HALF_ANGLE_DEG,
  DEFAULT_FACING_TOLERANCE_DEG,
  EARTH_EQUATORIAL_RADIUS_M,
  EARTH_FLATTENING,
  EARTH_MEAN_RADIUS_M,
  EARTH_POLAR_RADIUS_M,
  FEET_PER_METRE,
  METRES_PER_FOOT,
  METRES_PER_SECOND_PER_MPH,
  MIN_METRES_PER_DEGREE_LATITUDE,
  angularDifferenceDeg,
  assertLatLon,
  bearing,
  destinationPoint,
  distanceFt,
  distanceM,
  feetToMetres,
  isFacingVehicle,
  metresPerSecondToMph,
  metresToFeet,
  mphToMetresPerSecond,
  normaliseBearingDeg,
  normaliseLongitudeDeg,
  relativeDirection,
} from './geo.ts';

export {
  CLUSTER_SPAN_MULTIPLE,
  DEFAULT_CLEARANCE_FT,
  MAX_HANDOFF_WAYPOINTS,
  closestApproachFt,
  planDetour,
} from './avoidance.ts';
export type { DetourOptions, DetourPlan, LatLon } from './avoidance.ts';

export {
  MAX_SURROUNDING_RADIUS,
  MAX_TILE_ZOOM,
  MIN_TILE_ZOOM,
  WEB_MERCATOR_MAX_LATITUDE,
  clampMercatorLatitude,
  latLonToTile,
  surroundingTiles,
  tileKey,
  tilesPerAxis,
} from './tiles.ts';

export type {
  AlertEngineConfig,
  AlertEngineOptions,
  AlertHistoryEntry,
  AlertTick,
  CameraAssessment,
  DedupedCamera,
  DeliveryStats,
  DeriveAlertStateInput,
  ExposureSnapshot,
  SuppressionReason,
} from './alert.ts';

export {
  ALERT_THRESHOLD_MAX_FT,
  ALERT_THRESHOLD_MIN_FT,
  ALERT_THRESHOLD_STEP_FT,
  APPROACHING_OUTER_FT,
  AlertEngine,
  CLOSING_EPSILON_FT,
  DEFAULT_ALERT_THRESHOLD_FT,
  DEFAULT_DEDUPE_EPSILON_FT,
  DEFAULT_GPS_ACCURACY_LIMIT_M,
  DEFAULT_HYSTERESIS_FT,
  DEFAULT_MAX_HISTORY_ENTRIES,
  DEFAULT_MOVING_DWELL_MS,
  DEFAULT_MUTE_DURATION_MS,
  DEFAULT_NOTIFICATION_COOLDOWN_MS,
  DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT,
  DEFAULT_STATIONARY_DWELL_MS,
  DEFAULT_STATIONARY_SPEED_MPS,
  DRIVE_MODE_MIN_SPEED_MPH,
  HAPTIC_PULSES_BY_STATE,
  MIN_SPEED_SAMPLE_MS,
  MOTION_STATIONARY_VETO_MPS2,
  MULTIPLE_MIN_CAMERAS,
  SPEED_SMOOTHING_ALPHA,
  SWEEP_RING_FT,
  assertThresholdFt,
  createAlertEngine,
  dedupeCameras,
  deriveAlertState,
  hapticPulsesForState,
  ringForDistanceFt,
  snapThresholdFt,
} from './alert.ts';
