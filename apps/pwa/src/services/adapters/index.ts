/**
 * PLATFORM ADAPTERS - the boundary between DarkRoute and the browser.
 *
 * Screen components never call a browser API. They take an adapter, read
 * `capability()` to find out whether this platform can do the thing at all,
 * `subscribe()` for values, and `error()` for the state to render when it goes
 * wrong. Every adapter has the same shape; see `./types`.
 *
 * Start here:
 *   createPlatformAdapters()  the real set, one of each
 *   createMockAdapters()      the same set, driveable (./testing/mocks)
 *   capabilityReport(set)     what this device can actually do
 *
 * Two invariants worth knowing before you touch anything in here:
 *   - `request()` is the only method that may raise an OS prompt, and it must
 *     be called from a user gesture. Nothing prompts on load.
 *   - `vibration.buzz` is camera-only and throws for every other source. That
 *     guard covers the PAGE-side API and nothing else: a notification carries
 *     its own `vibrate` pattern, and the abuse-area card deliberately has one
 *     that a driver can tell apart from a camera's. See the haptic table in
 *     `./notifications`. Watchlist is silent on both paths, always.
 */

export type {
  Adapter,
  AdapterError,
  AdapterName,
  AlertState,
  Capability,
  PermissionOutcome,
  RequestOutcome,
  Unsubscribe,
} from './types';
export { ADAPTER_NAMES, ALERT_STATES, queryPermission } from './types';

export type { AdapterSet } from './set';
export { capabilityReport, createPlatformAdapters, listAdapters, stopAll } from './set';

export type { GeoFix, GeoWatchOptions, GeolocationAdapter, RedactedGeoFix } from './geolocation';
export {
  DEFAULT_WATCH_OPTIONS,
  REDACTION_DECIMALS,
  createGeolocationAdapter,
  geolocationCapability,
  redact,
  redactCoordinate,
} from './geolocation';

export type { Heading, HeadingSource, OrientationAdapter } from './orientation';
export { createOrientationAdapter, headingFromEvent, orientationCapability } from './orientation';

export type { MotionAdapter, MotionSample, RotationRate, Vector3 } from './motion';
export { createMotionAdapter, magnitudeOf, motionCapability, sampleFromEvent } from './motion';

export type {
  AbuseAreaPayload,
  CameraAlertPayload,
  CardRenderer,
  ComposedNotification,
  NavigationPayload,
  NotificationAction,
  NotificationChannel,
  NotificationEvent,
  NotificationKind,
  NotificationOutcome,
  NotificationPayload,
  NotificationResult,
  NotificationsAdapter,
  NotificationsAdapterOptions,
  WatchlistPayload,
} from './notifications';
export {
  ABUSE_AREA_TAG,
  ABUSE_VIBRATION,
  ALERT_CHANNELS,
  CAMERA_ALERT_TAG,
  CAMERA_VIBRATION,
  NAVIGATION_TAG,
  NAVIGATION_VIBRATION,
  NOTIFICATION_KINDS,
  SILENT_CHANNELS,
  SILENT_VIBRATION,
  WATCHLIST_TAG,
  composeNotification,
  createNotificationsAdapter,
  isSilentChannel,
  notificationsCapability,
} from './notifications';

export type {
  BuzzingSource,
  HapticSource,
  SilentSource,
  VibrationAdapter,
  VibrationEvent,
  VibrationRequest,
  VibrationResult,
} from './vibration';
export {
  BUZZING_SOURCES,
  CAMERA_ALERT_PATTERNS,
  HAPTIC_SOURCES,
  SOURCE_PATTERNS,
  SilentChannelError,
  assertCanBuzz,
  createVibrationAdapter,
  patternFor,
  vibrationCapability,
} from './vibration';

export type { WakeLockAdapter, WakeLockRelease, WakeLockStatus } from './screenWakeLock';
export { createWakeLockAdapter, wakeLockCapability } from './screenWakeLock';

export type { SpeechAdapter, SpeechMode, SpeechOptions, SpeechResult } from './speechRecognition';
export {
  DEFAULT_LANG,
  createSpeechAdapter,
  speechCapability,
  wakeWordCapability,
} from './speechRecognition';

export type {
  CameraCaptureAdapter,
  CameraFacing,
  CaptureOptions,
  CapturedPhoto,
} from './cameraCapture';
export { cameraCaptureCapability, createCameraCaptureAdapter } from './cameraCapture';

export type {
  ShareAdapter,
  SharePayload,
  SharePayloadKind,
  ShareOutcome,
  ShareStatus,
} from './share';
export { createShareAdapter, fileShareCapability, shareCapability } from './share';

export type { ClipboardAdapter, ClipboardKind, ClipboardWrite } from './clipboard';
export { clipboardCapability, createClipboardAdapter } from './clipboard';

export type { EffectiveConnectionType, NetworkAdapter, NetworkState } from './network';
export {
  connectionDetailCapability,
  createNetworkAdapter,
  networkCapability,
  readNetworkState,
} from './network';

export type { LifecycleState, VisibilityAdapter, VisibilityValue } from './visibility';
export { createVisibilityAdapter, visibilityCapability } from './visibility';

export type { BatteryAdapter, BatteryState } from './battery';
export { batteryCapability, createBatteryAdapter } from './battery';

export type { AmbientLightAdapter, AmbientLightSample } from './ambientLight';
export { ambientLightCapability, createAmbientLightAdapter } from './ambientLight';

export type { BackgroundConsent, BridgeInfo, TwaLocationBridgeAdapter } from './twaLocationBridge';
export {
  BackgroundConsentRequiredError,
  NO_BRIDGE_REASON,
  TWA_BRIDGE_GLOBAL,
  TWA_FIX_CALLBACK,
  createTwaLocationBridgeAdapter,
  fixFromBridgePayload,
  twaBridgeCapability,
} from './twaLocationBridge';
