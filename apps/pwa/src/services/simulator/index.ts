/**
 * The drive simulator, as one import.
 *
 * DEVELOPMENT ONLY. Nothing on a driver's phone should ever reach this
 * directory: it exists so the foreground alert loop can be exercised with no
 * driving, no network and no production services. It has no import-time side
 * effect, so a bundle that never imports it drops all of it.
 */

export {
  DEFAULT_SIMULATED_ACCURACY_M,
  DEFAULT_TICK_HZ,
  constantSpeed,
  createDriveSimulator,
  distanceTravelledM,
  fixLostTicks,
  phaseLabelAtMs,
  phasedSpeed,
  positionTicks,
  profileDurationMs,
  speedAtMs,
  toGeoFix,
  toPositionFix,
} from './driveSimulator.ts';
export type {
  DriveSimulator,
  DriveSimulatorOptions,
  DriveSimulatorSnapshot,
  FixLostTick,
  PositionFixExtras,
  PositionTick,
  SimulatedCoordinates,
  SimulatedPosition,
  SimulatorTick,
  SimulatorUnsubscribe,
  SpeedPhase,
  SpeedProfile,
} from './driveSimulator.ts';

export {
  MAX_SOLVER_LATITUDE_DEG,
  SOLVER_BEARING_TOLERANCE_DEG,
  SOLVER_MAX_ITERATIONS,
  SOLVER_TOLERANCE_M,
  buildRouteGeometry,
  curvedSegment,
  degreesToRadians,
  pointAlongLeg,
  pointAtDistanceFt,
  pointAtDistanceM,
  positionOnRoute,
  radiansToDegrees,
  routeLengthFt,
  straightSegment,
} from './geometry.ts';
export type { LatLon, RouteGeometry, RoutePosition } from './geometry.ts';

export {
  GPS_LOST_FIRST_TICK,
  GPS_LOST_LAST_TICK,
  SCENARIOS,
  SCENARIO_IDS,
  buildScenario,
  createScenarioDriver,
  isScenarioId,
  runAllScenarios,
  runScenario,
  scenario,
} from './scenarios.ts';
export type {
  BuiltScenario,
  ScenarioDefinition,
  ScenarioDriver,
  ScenarioId,
  ScenarioOverrides,
  ScenarioRun,
  ScenarioTickContext,
  ScenarioTickRecord,
} from './scenarios.ts';

export { DEV_PANEL_ENABLED, createDevPanel } from './devPanel.ts';
export type {
  DevPanelCameraRow,
  DevPanelController,
  DevPanelOptions,
  DevPanelState,
  DevPanelUnsubscribe,
} from './devPanel.ts';
