/**
 * THE STATE MODEL - twelve slices, one import.
 * =============================================================================
 * Screens import from here and from nowhere else in this directory. What they
 * get is TYPED SELECTORS and ACTIONS; the raw store shape is deliberately not
 * part of the public surface, so a refactor of a slice cannot ripple into
 * twenty components.
 *
 * THE SLICES
 *   navigation    screen, overlay stack, presentation priority   (mirrors app/screenState)
 *   capabilities  what this device can do, and what it permitted
 *   position      fix, heading, speed, motion, GPS accuracy
 *   cameras       cached tiles, and the engine's camera answers
 *   alert         the state machine, the mute gate, the takeover
 *   session       anonymous id + optional handle                 (persisted)
 *   presence      other DarkRoute, as distances only
 *   history       the LOG timeline, the trip, the exposure counts
 *   destinations  the places driven to, and the ones named   (persisted, IDB)
 *   sync          the queue, and why it is holding
 *   settings      everything the driver chose                    (persisted)
 *   network       online / offline / unmetered
 *
 * THREE RULES THAT HOLD ACROSS ALL OF THEM
 *
 *   1. NO DERIVED GEOSPATIAL MATHS. Distance, bearing, relative direction and
 *      the alert state machine live in `@fwm/core`. Stores hold the engine's
 *      inputs and cache its outputs; `./fwmCore.ts` is the only door.
 *
 *   2. NO BROWSER APIS. Every platform value arrives through the adapters in
 *      `services/adapters`, which capability-detect and never prompt on load.
 *
 *   3. TWO SLICES PERSIST THROUGH `persist.ts`, AND NEITHER MAY CARRY A PLATE.
 *      `settings` and `session` go through the guarded storage there, which
 *      throws before a plate-shaped value can reach a serializer.
 *
 *      `destinations` PERSISTS TOO AND DOES NOT GO THROUGH THAT PORT. It writes
 *      its own IndexedDB row through `services/db`, on purpose: `persist.ts`'s
 *      blob is `untouched` by the removal path because preferences are not
 *      personal data, and a book of places somebody drives to must be `removed`.
 *      Putting it in the guarded blob would have made "Wipe everything on this
 *      phone takes both" false by inheritance. It is the only slice holding a
 *      coordinate, and the coordinate is one the user typed.
 *
 * ONE WRITE PATH FOR THE DRIVING LOOP
 *   {@link ingestAlertTick} is it. It fans one `AlertTick` out to the alert,
 *   cameras and history slices in a fixed order so those three can never
 *   disagree about what just happened.
 * =============================================================================
 */

// --- navigation ------------------------------------------------------------
export type {
  DockScreen,
  NavigationActions,
  NavigationState,
  NavigationStore,
  Overlay,
  Presentation,
  ScreenId,
} from './navigation.ts';
export {
  createNavigationStore,
  navigationActions,
  useIsScreenActive,
  useNavigationDepth,
  useNavigationStore,
  useOverlays,
  usePresentation,
  useSavedOverlays,
  useScreen,
  useTopOverlay,
} from './navigation.ts';

// --- capabilities ----------------------------------------------------------
export type {
  AdapterName,
  Capability,
  CapabilitiesActions,
  CapabilitiesState,
  CapabilitiesStore,
  CapabilityStatus,
  PermissionOutcome,
  PermissionStatus,
  RequestOutcome,
} from './capabilities.ts';
export {
  capabilitiesActions,
  capabilityStatus,
  createCapabilitiesStore,
  useAdapterError,
  useCapabilitiesProbed,
  useCapabilitiesStore,
  useCapability,
  useCapabilityStatus,
  useLocationPermission,
  usePermission,
  useRequestingPermission,
} from './capabilities.ts';

// --- position --------------------------------------------------------------
export type {
  GeoFix,
  GpsStatus,
  Heading,
  HeadingOrigin,
  MotionSample,
  PositionActions,
  PositionFix,
  PositionState,
  PositionStore,
  RedactedGeoFix,
  SpeedSource,
} from './position.ts';
export {
  createPositionStore,
  fixAgeMs,
  positionActions,
  positionForDiagnostics,
  useAccuracyM,
  useCurrentFix,
  useGpsStatus,
  useHasFix,
  useHeadingDeg,
  useLastFixAtMs,
  usePositionError,
  usePositionStore,
  useSatellites,
  useSpeedMph,
  useSpeedMps,
} from './position.ts';

// --- cameras ---------------------------------------------------------------
export type {
  AssessmentUpdate,
  CameraAssessment,
  CameraOwnerType,
  CameraRecord,
  CamerasActions,
  CamerasState,
  CamerasStore,
  TileEntry,
  TileFreshness,
  TileRef,
  TileSource,
} from './cameras.ts';
export {
  camerasActions,
  camerasForEngine,
  createCamerasStore,
  findAssessment,
  findCamera,
  flattenTiles,
  useCachedCameraCount,
  useCachedCameras,
  useCachedTileCount,
  useCameraAssessments,
  useCameraGeneration,
  useCamerasError,
  useCamerasStore,
  useCountInRange,
  useNearestCamera,
  useNearestDistanceFt,
  useSelectedCameraId,
  useTilesLoading,
  useTilesUpdatedAtMs,
} from './cameras.ts';

// --- alert -----------------------------------------------------------------
export type {
  AlertActions,
  AlertSliceState,
  AlertState,
  AlertStore,
  AlertTakeover,
  AlertTick,
  IngestContext,
  SuppressionReason,
} from './alert.ts';
export {
  TAKEOVER_IDLE,
  alertActions,
  blocksDelivery,
  createAlertStore,
  ingestAlertTick,
  isAlertingState,
  mutePierces,
  useAlertState,
  useAlertStore,
  useAlertTakeover,
  useAlertTickCount,
  useEffectiveThresholdFt,
  useHapticPulses,
  useIsAlertTakeoverActive,
  useIsCameraMuted,
  useIsClosing,
  useIsMuted,
  useIsStationary,
  useMutePierced,
  useMuteRemainingMs,
  useMutedCameraIds,
  useShouldAlertUser,
  useShouldSpeak,
  useShouldVibrate,
  useSuppressionReasons,
} from './alert.ts';

// --- session ---------------------------------------------------------------
export type {
  PersistedSession,
  SessionActions,
  SessionState,
  SessionStore,
  SessionStoreOptions,
} from './session.ts';
export {
  ANONYMOUS_LABEL,
  ANONYMOUS_SESSION,
  SessionError,
  assertHandleSafe,
  createSessionStore,
  displayName,
  useHandle,
  useHasSession,
  useSessionHydrated,
  useSessionId,
  useSessionStore,
} from './session.ts';

// --- presence --------------------------------------------------------------
export type {
  MeshEvent,
  MeshEventKind,
  PresenceActions,
  PresenceAvailability,
  PresencePeer,
  PresenceState,
  PresenceStore,
} from './presence.ts';
export {
  PRESENCE_DISTANCE_PRECISION_MI,
  PRESENCE_EVENT_DELAY_MS,
  PresencePrivacyError,
  assertNoCoordinates,
  createPresenceStore,
  presenceActions,
  roundDistanceMi,
  useIsPresenceLive,
  useMeshEvents,
  useNearbyDarkrouteCount,
  useNearbyPeers,
  usePresenceAvailability,
  usePresenceReason,
  usePresenceStore,
} from './presence.ts';

// --- destinations ----------------------------------------------------------
// THE PLACES SOMEBODY DROVE TO, which is a different thing from `history` above
// (the LOG timeline) and from `route` (the drive happening now, memory-only by
// design). Read `destinations.ts`'s header before assuming any two of the three
// should be merged.
export type {
  DestinationsActions,
  DestinationsPort,
  DestinationsState,
  DestinationsStore,
  PlaceBook,
  RecentPlace,
  SavedKind,
  SavedPlace,
} from './destinations.ts';
export {
  destinationsActions,
  setDestinationsPort,
  useDestinationBook,
  useDestinationsDurable,
  useDestinationsHydrated,
  useDestinationsStore,
  useRecentPlaces,
  useSavedPlaces,
} from './destinations.ts';

// --- history ---------------------------------------------------------------
export type {
  AlertLogEntry,
  AlertOutcome,
  DayExposure,
  HistoryActions,
  HistoryState,
  HistoryStore,
  NewAlertLogEntry,
  TripProgress,
} from './history.ts';
export {
  createHistoryStore,
  historyActions,
  useAlertLog,
  useAlertLogLength,
  useAllTimePasses,
  useCurrentTrip,
  useHistoryStore,
  useLatestAlert,
  useTodayExposure,
  useTodayPasses,
  useTodayUniqueCount,
} from './history.ts';

// --- sync ------------------------------------------------------------------
export type {
  PendingSyncCount,
  QueueSyncState,
  QueuedDrop,
  SyncActions,
  SyncHold,
  SyncState,
  SyncStatus,
  SyncStore,
} from './sync.ts';
export {
  createSyncStore,
  syncActions,
  useDeadLetteredCount,
  useHeldReportCount,
  useLastSyncAtMs,
  usePendingSyncCount,
  useQueuedDrops,
  useSyncError,
  useSyncHold,
  useSyncStatus,
  useSyncStore,
} from './sync.ts';

// --- settings --------------------------------------------------------------
export type {
  PersistedSettings,
  SettingsActions,
  SettingsState,
  SettingsStore,
  SettingsStoreOptions,
} from './settings.ts';
export {
  DEFAULT_SETTINGS,
  OWNER_TYPES,
  SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_VERSION,
  createSettingsStore,
  globalMuteRemainingMs,
  isCameraMutedAt,
  isGloballyMutedAt,
  mergePersistedSettings,
  useAlertThresholdFt,
  useAudioEnabled,
  useFwmMode,
  useTextScale,
  useTypeface,
  useGlass,
  useLiquid,
  useMapOwnerFilter,
  useMapView,
  useAbuseNearMe,
  useAbuseAlertOnEntry,
  useAbuseNameAgency,
  useMapTilt,
  useClear,
  useImmersiveOnLaunch,
  useTone,
  useFlat,
  useHideUnverified,
  useNotifyWhenParked,
  useOnboardingComplete,
  useOwnerTypesEnabled,
  useSettingsDurable,
  useSettingsHydrated,
  useSettingsStore,
  useShowHandle,
  useCapabilityEnabled,
  capabilityEnabled,
  useVibrationEnabled,
  useWakeLockEnabled,
  useWifiOnlySync,
} from './settings.ts';

// --- network ---------------------------------------------------------------
export type {
  EffectiveConnectionType,
  NetworkActions,
  NetworkState,
  NetworkStore,
} from './network.ts';
export {
  createNetworkStore,
  networkActions,
  useEffectiveConnectionType,
  useIsOffline,
  useIsOnline,
  useIsReachable,
  useIsUnmetered,
  useNetworkSupported,
  useSaveData,
} from './network.ts';

// --- the persistence boundary ----------------------------------------------
export type { GuardedStorageOptions, PersistPort } from './persist.ts';
export {
  PlateShapedValueError,
  assertPersistSafe,
  createGuardedPersistStorage,
  createMemoryPersistPort,
  getPersistPort,
  installPersistPort,
  isPersistDurable,
  resetPersistPort,
} from './persist.ts';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

import { alertActions } from './alert.ts';
import { camerasActions } from './cameras.ts';
import { capabilitiesActions } from './capabilities.ts';
import { destinationsActions } from './destinations.ts';
import { historyActions } from './history.ts';
import { navigationActions } from './navigation.ts';
import { networkActions } from './network.ts';
import { positionActions } from './position.ts';
import { presenceActions } from './presence.ts';
import { syncActions } from './sync.ts';
import { useSessionStore } from './session.ts';
import { useSettingsStore } from './settings.ts';

/**
 * Put every slice back to its initial state.
 *
 * Used by tests and by the "forget me" path. Order matters in one place: the
 * alert slice restores an interrupted overlay stack on reset, so it goes before
 * navigation is re-synced.
 *
 * The two persisted slices are reset IN MEMORY only. Clearing what is on disk
 * is `clearLocalData()`'s job in `services/db`, because a store must not be
 * able to delete a driver's queued evidence as a side effect of a reset.
 */
export function resetAllStores(): void {
  alertActions.reset();
  camerasActions.reset();
  capabilitiesActions.reset();
  // IN MEMORY, like every other line here. The book on disk is
  // `clearLocalData()`'s to take, and this slice's `reset()` deliberately does
  // not write - see the note above about a store that must not be able to
  // delete a driver's data as a side effect of a reset.
  destinationsActions.reset();
  historyActions.reset();
  networkActions.reset();
  positionActions.reset();
  presenceActions.reset();
  syncActions.reset();
  useSettingsStore.getState().reset();
  useSessionStore.getState().clear();
  navigationActions.sync();
}
