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
 *   - haptics belong to camera alerts. `vibration.buzz` throws for any other
 *     source, and county entry and watchlist notifications are always silent.
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
  CameraAlertPayload,
  ComposedNotification,
  CountyRecordPayload,
  NotificationChannel,
  NotificationEvent,
  NotificationOutcome,
  NotificationPayload,
  NotificationResult,
  NotificationsAdapter,
  WatchlistPayload,
} from './notifications';
export {
  ALERT_CHANNELS,
  CAMERA_ALERT_TAG,
  COUNTY_RECORD_TAG,
  SILENT_CHANNELS,
  WATCHLIST_TAG,
  composeNotification,
  createNotificationsAdapter,
  isSilentChannel,
  notificationsCapability,
} from './notifications';

export type {
  HapticSource,
  VibrationAdapter,
  VibrationEvent,
  VibrationRequest,
  VibrationResult,
} from './vibration';
export {
  CAMERA_ALERT_PATTERNS,
  PULSE_PATTERNS,
  SilentChannelError,
  assertCameraAlertOnly,
  createVibrationAdapter,
  patternForPulses,
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
