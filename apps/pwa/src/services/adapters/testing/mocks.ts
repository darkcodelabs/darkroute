/**
 * MOCK ADAPTERS - the same contract, driven by you instead of by hardware.
 *
 * Two jobs:
 *   TESTS      drive a screen through clear -> approaching -> in range -> multiple
 *              without a GPS, and assert what it did.
 *   DESKTOP    develop RADAR on a laptop that has no compass, no vibration
 *              motor and no ALPR camera outside, without any screen learning to
 *              special-case "we are in dev".
 *
 * Every mock satisfies the real adapter interface, so a screen cannot tell the
 * difference - and cannot accidentally depend on a mock-only method, because
 * the extra controls live behind one `mock` property that the real adapters do
 * not have.
 *
 * The mocks reproduce the rules, not just the shapes. `vibration.buzz` runs the
 * real `assertCameraAlertOnly` guard, and `notifications.show` runs the real
 * `composeNotification`, so a test that drives a mock is testing the same
 * decisions the device would make.
 */

import type { AmbientLightAdapter, AmbientLightSample } from '../ambientLight';
import type { BatteryAdapter, BatteryState } from '../battery';
import type { CameraCaptureAdapter, CaptureOptions, CapturedPhoto } from '../cameraCapture';
import type { ClipboardAdapter, ClipboardKind, ClipboardWrite } from '../clipboard';
import { createCore } from '../core';
import type { GeoFix, GeolocationAdapter, GeoWatchOptions } from '../geolocation';
import type { MotionAdapter, MotionSample } from '../motion';
import type { NetworkAdapter, NetworkState } from '../network';
import {
  CAMERA_ALERT_TAG,
  composeNotification,
  type ComposedNotification,
  type NotificationEvent,
  type NotificationPayload,
  type NotificationResult,
  type NotificationsAdapter,
} from '../notifications';
import type { Heading, OrientationAdapter } from '../orientation';
import type { WakeLockAdapter, WakeLockStatus } from '../screenWakeLock';
import type { AdapterSet } from '../set';
import type { ShareAdapter, ShareOutcome, SharePayload, ShareStatus } from '../share';
import type { SpeechAdapter, SpeechMode, SpeechOptions, SpeechResult } from '../speechRecognition';
import {
  BackgroundConsentRequiredError,
  NO_BRIDGE_REASON,
  type BackgroundConsent,
  type BridgeInfo,
  type TwaLocationBridgeAdapter,
} from '../twaLocationBridge';
import {
  CAMERA_ALERT_PATTERNS,
  assertCameraAlertOnly,
  type VibrationAdapter,
  type VibrationEvent,
  type VibrationRequest,
  type VibrationResult,
} from '../vibration';
import type { LifecycleState, VisibilityAdapter } from '../visibility';
import {
  ok,
  type Adapter,
  type AlertState,
  type Capability,
  type PermissionOutcome,
  type RequestOutcome,
} from '../types';

/** The handle every mock exposes. Nothing in product code may reach for it. */
export interface MockControls<TValue> {
  /** Make the platform say no: `setCapability(no('reason'))`. */
  setCapability(capability: Capability): void;
  setPermission(state: PermissionOutcome): void;
  setRequestOutcome(outcome: RequestOutcome): void;
  /** Set `current()` without notifying subscribers. */
  set(value: TValue | null): void;
  /** Set `current()` and notify subscribers, exactly like the real adapter. */
  emit(value: TValue): void;
  fail(code: string, message: string): void;
  clearError(): void;
  /** Back to a fresh, supported, granted, stopped adapter with no value. */
  reset(): void;
  starts(): number;
  stops(): number;
  requests(): number;
  started(): boolean;
  subscribers(): number;
}

export type Mocked<TAdapter, TValue> = TAdapter & { readonly mock: MockControls<TValue> };

interface MockBase<TValue, TOptions> extends Adapter<TValue, TOptions> {
  // Required here even though the base contract leaves them optional: every
  // mock answers both, so a spread of a mock base satisfies the concrete
  // adapter interfaces that also require them.
  permission(): Promise<PermissionOutcome>;
  request(): Promise<RequestOutcome>;
  readonly mock: MockControls<TValue>;
}

function createMockBase<TValue, TOptions = void>(name: string): MockBase<TValue, TOptions> {
  const core = createCore<TValue>();
  let capability: Capability = ok();
  let permissionState: PermissionOutcome = 'granted';
  let requestOutcome: RequestOutcome = 'granted';
  let starts = 0;
  let stops = 0;
  let requests = 0;

  return {
    name,

    capability: () => capability,

    async permission(): Promise<PermissionOutcome> {
      if (!capability.supported) return 'unavailable';
      return permissionState;
    },

    /** USER GESTURE ONLY in the real adapters; the mock records the call. */
    async request(): Promise<RequestOutcome> {
      requests += 1;
      if (!capability.supported) return 'unavailable';
      permissionState = requestOutcome === 'granted' ? 'granted' : 'denied';
      return requestOutcome;
    },

    /** Idempotent, like the real thing: a second call changes nothing. */
    start(_opts?: TOptions): void {
      starts += 1;
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? `${name} is not available`);
        return;
      }
      core.clearError();
      core.setRunning(true);
    },

    /** Idempotent. */
    stop(): void {
      stops += 1;
      core.setRunning(false);
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
    // The real adapters serve this from the same core, so a mock without it
    // would let a test pass against a runtime that reads nothing.
    subscribeToError: core.subscribeToError,

    mock: {
      setCapability(next) {
        capability = next;
      },
      setPermission(state) {
        permissionState = state;
      },
      setRequestOutcome(outcome) {
        requestOutcome = outcome;
      },
      set(value) {
        core.setCurrent(value);
      },
      emit(value) {
        core.emit(value);
      },
      fail(code, message) {
        core.fail(code, message);
      },
      clearError: core.clearError,
      reset() {
        capability = ok();
        permissionState = 'granted';
        requestOutcome = 'granted';
        starts = 0;
        stops = 0;
        requests = 0;
        core.setCurrent(null);
        core.clearError();
        core.setRunning(false);
      },
      starts: () => starts,
      stops: () => stops,
      requests: () => requests,
      started: core.running,
      subscribers: core.subscriberCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-adapter mocks
// ---------------------------------------------------------------------------

export type MockGeolocationAdapter = Mocked<GeolocationAdapter, GeoFix>;

export function createMockGeolocation(): MockGeolocationAdapter {
  const base = createMockBase<GeoFix, GeoWatchOptions>('geolocation');
  return {
    ...base,
    fixAgeMs(atMs?: number): number | null {
      const fix = base.current();
      return fix === null ? null : (atMs ?? Date.now()) - fix.timestamp;
    },
  };
}

export type MockOrientationAdapter = Mocked<OrientationAdapter, Heading>;

export function createMockOrientation(): MockOrientationAdapter {
  const base = createMockBase<Heading>('orientation');
  return {
    ...base,
    hasFix: () => base.current()?.absolute === true,
  };
}

export type MockMotionAdapter = Mocked<MotionAdapter, MotionSample>;

export function createMockMotion(): MockMotionAdapter {
  const base = createMockBase<MotionSample>('motion');
  return {
    ...base,
    lastMagnitude(): number | null {
      const v = base.current()?.accelerationMps2 ?? null;
      if (v === null) return null;
      const x = v.x ?? 0;
      const y = v.y ?? 0;
      const z = v.z ?? 0;
      return Math.sqrt(x * x + y * y + z * z);
    },
  };
}

export interface MockNotificationsControls {
  /** Every notification that reached the platform, in order. */
  shown(): readonly ComposedNotification[];
  /** Tags cleared, in order. */
  cleared(): readonly string[];
  clearHistory(): void;
}

export type MockNotificationsAdapter = Mocked<NotificationsAdapter, NotificationEvent> & {
  readonly notifications: MockNotificationsControls;
};

export function createMockNotifications(): MockNotificationsAdapter {
  const base = createMockBase<NotificationEvent>('notifications');
  let shown: ComposedNotification[] = [];
  let cleared: string[] = [];

  const clearTag = async (tag: string): Promise<void> => {
    cleared.push(tag);
    shown = shown.filter((entry) => entry.tag !== tag);
    return Promise.resolve();
  };

  return {
    ...base,
    compose: composeNotification,
    clear: clearTag,

    async show(payload: NotificationPayload): Promise<NotificationResult> {
      const composed = composeNotification(payload);
      const meta = { channel: composed.channel, tag: composed.tag, silent: composed.silent };
      const emit = (result: NotificationResult): NotificationResult => {
        base.mock.emit({
          channel: result.channel,
          tag: result.tag,
          outcome: result.outcome,
          silent: result.silent,
          timestamp: Date.now(),
        });
        return result;
      };

      const capability = base.capability();
      if (!capability.supported) {
        return emit({ ...meta, outcome: 'unsupported', reason: capability.reason ?? 'no' });
      }
      if ((await base.permission?.()) !== 'granted') {
        return emit({ ...meta, outcome: 'blocked', reason: 'notification permission not granted' });
      }
      if (!base.mock.started()) {
        return emit({
          ...meta,
          outcome: 'blocked',
          reason: 'the notifications adapter is stopped',
        });
      }
      if (payload.kind === 'camera-alert' && payload.state === 'clear') {
        await clearTag(CAMERA_ALERT_TAG);
        return emit({ ...meta, outcome: 'cleared' });
      }
      // The real replacement rule, reproduced: same tag evicts, never stacks.
      shown = shown.filter((entry) => entry.tag !== composed.tag);
      shown.push(composed);
      return emit({ ...meta, outcome: 'shown' });
    },

    notifications: {
      shown: () => [...shown],
      cleared: () => [...cleared],
      clearHistory() {
        shown = [];
        cleared = [];
      },
    },
  };
}

export type MockVibrationAdapter = Mocked<VibrationAdapter, VibrationEvent> & {
  /** Patterns actually delivered, in order. */
  readonly buzzes: () => readonly (readonly number[])[];
};

export function createMockVibration(): MockVibrationAdapter {
  const base = createMockBase<VibrationEvent>('vibration');
  const delivered: (readonly number[])[] = [];

  const patternFor = (state: AlertState): readonly number[] => CAMERA_ALERT_PATTERNS[state];

  return {
    ...base,
    patternFor,
    enabled: base.mock.started,

    buzz(request: VibrationRequest): VibrationResult {
      // The real guard, not a copy of it. A test that gets past this in the
      // mock would get past it on a device, and vice versa.
      assertCameraAlertOnly(request.source);
      const pattern = patternFor(request.state);
      const capability = base.capability();
      if (!base.mock.started()) {
        return { ok: false, pattern, reason: 'haptics are switched off in settings' };
      }
      if (!capability.supported) {
        return { ok: false, pattern, reason: capability.reason ?? 'vibration is not available' };
      }
      if (pattern.length === 0) {
        return { ok: false, pattern, reason: 'this alert state is silent by design' };
      }
      delivered.push(pattern);
      base.mock.emit({ state: request.state, pattern, timestamp: Date.now() });
      return { ok: true, pattern };
    },

    buzzes: () => [...delivered],
  };
}

export type MockWakeLockAdapter = Mocked<WakeLockAdapter, WakeLockStatus>;

export function createMockWakeLock(): MockWakeLockAdapter {
  const base = createMockBase<WakeLockStatus>('screenWakeLock');
  return {
    ...base,
    start(): void {
      base.start();
      if (base.mock.started()) {
        base.mock.emit({
          held: true,
          since: Date.now(),
          lastRelease: 'not-held',
          timestamp: Date.now(),
        });
      }
    },
    stop(): void {
      base.stop();
      base.mock.emit({ held: false, since: null, lastRelease: 'by-app', timestamp: Date.now() });
    },
    wanted: base.mock.started,
  };
}

export type MockSpeechAdapter = Mocked<SpeechAdapter, SpeechResult> & {
  /** Set what `wakeWordCapability()` reports, independently of the base. */
  readonly setWakeWordCapability: (capability: Capability) => void;
};

export function createMockSpeechRecognition(): MockSpeechAdapter {
  const base = createMockBase<SpeechResult, SpeechOptions>('speechRecognition');
  let wakeWord: Capability = ok();
  let mode: SpeechMode | null = null;

  const begin = (next: SpeechMode): void => {
    const capability = next === 'wake-word' ? wakeWord : base.capability();
    if (!capability.supported) {
      base.mock.fail(
        next === 'wake-word' ? 'wake-word-unavailable' : 'unsupported',
        capability.reason ?? 'speech recognition is not available',
      );
      return;
    }
    base.start();
    if (base.mock.started()) mode = next;
  };

  return {
    ...base,
    start(opts?: SpeechOptions): void {
      begin(opts?.mode ?? 'push-to-talk');
    },
    stop(): void {
      base.stop();
      mode = null;
    },
    startPushToTalk(): void {
      begin('push-to-talk');
    },
    stopPushToTalk(): void {
      base.stop();
      mode = null;
    },
    wakeWordCapability: () => wakeWord,
    mode: () => mode,
    listening: base.mock.started,
    sendsAudioOffDevice: () => false,
    setWakeWordCapability(capability: Capability) {
      wakeWord = capability;
    },
  };
}

export type MockCameraCaptureAdapter = Mocked<CameraCaptureAdapter, CapturedPhoto> & {
  /** What the next `capture()` resolves with. Null models a cancelled picker. */
  readonly setNextPhoto: (photo: CapturedPhoto | null) => void;
};

export function createMockCameraCapture(): MockCameraCaptureAdapter {
  const base = createMockBase<CapturedPhoto, CaptureOptions>('cameraCapture');
  let next: CapturedPhoto | null = null;

  return {
    ...base,
    async capture(): Promise<CapturedPhoto | null> {
      const capability = base.capability();
      if (!capability.supported) {
        base.mock.fail('unsupported', capability.reason ?? 'photo capture is not available');
        return null;
      }
      if (next !== null) base.mock.emit(next);
      return next;
    },
    abort(): void {
      next = null;
    },
    setNextPhoto(photo: CapturedPhoto | null) {
      next = photo;
    },
  };
}

export type MockShareAdapter = Mocked<ShareAdapter, ShareOutcome> & {
  readonly setNextStatus: (status: ShareStatus) => void;
  readonly shared: () => readonly SharePayload[];
};

export function createMockShare(): MockShareAdapter {
  const base = createMockBase<ShareOutcome>('share');
  const payloads: SharePayload[] = [];
  let nextStatus: ShareStatus = 'shared';

  return {
    ...base,
    canShare: () => base.capability().supported,
    async share(payload: SharePayload): Promise<ShareOutcome> {
      const withFiles = payload.files !== undefined && payload.files.length > 0;
      const capability = base.capability();
      const status: ShareStatus = capability.supported ? nextStatus : 'unsupported';
      if (status === 'shared') payloads.push(payload);
      const outcome: ShareOutcome = {
        kind: payload.kind,
        status,
        withFiles,
        timestamp: Date.now(),
      };
      base.mock.emit(outcome);
      return outcome;
    },
    setNextStatus(status: ShareStatus) {
      nextStatus = status;
    },
    shared: () => [...payloads],
  };
}

export type MockClipboardAdapter = Mocked<ClipboardAdapter, ClipboardWrite> & {
  readonly writes: () => readonly { kind: ClipboardKind; text: string }[];
};

export function createMockClipboard(): MockClipboardAdapter {
  const base = createMockBase<ClipboardWrite>('clipboard');
  const writes: { kind: ClipboardKind; text: string }[] = [];

  return {
    ...base,
    async writeText(kind: ClipboardKind, text: string): Promise<boolean> {
      const capability = base.capability();
      const success = capability.supported;
      if (success) writes.push({ kind, text });
      base.mock.emit({ kind, characters: text.length, ok: success, timestamp: Date.now() });
      return success;
    },
    writes: () => [...writes],
  };
}

export type MockNetworkAdapter = Mocked<NetworkAdapter, NetworkState> & {
  readonly setOnline: (online: boolean) => void;
};

export const OFFLINE_STATE: NetworkState = {
  online: false,
  effectiveType: null,
  downlinkMbps: null,
  rttMs: null,
  saveData: null,
  connectionType: null,
  timestamp: 0,
};

export function createMockNetwork(): MockNetworkAdapter {
  const base = createMockBase<NetworkState>('network');
  return {
    ...base,
    isUnmetered(): boolean {
      const state = base.current();
      if (state === null || !state.online) return false;
      return state.connectionType === 'wifi' || state.connectionType === 'ethernet';
    },
    setOnline(online: boolean) {
      const previous = base.current();
      base.mock.emit({
        ...(previous ?? OFFLINE_STATE),
        online,
        timestamp: Date.now(),
      });
    },
  };
}

export type MockVisibilityAdapter = Mocked<VisibilityAdapter, LifecycleState> & {
  readonly setVisible: (visible: boolean) => void;
};

export function createMockVisibility(): MockVisibilityAdapter {
  const base = createMockBase<LifecycleState>('visibility');
  return {
    ...base,
    isVisible: () => base.current()?.visibility !== 'hidden',
    setVisible(visible: boolean) {
      base.mock.emit({
        visibility: visible ? 'visible' : 'hidden',
        focused: visible,
        frozen: false,
        persisted: false,
        timestamp: Date.now(),
      });
    },
  };
}

export type MockBatteryAdapter = Mocked<BatteryAdapter, BatteryState>;

export function createMockBattery(): MockBatteryAdapter {
  const base = createMockBase<BatteryState>('battery');
  return {
    ...base,
    isBelow(fraction: number): boolean {
      const state = base.current();
      if (state === null) return false;
      return !state.charging && state.level < fraction;
    },
  };
}

export type MockAmbientLightAdapter = Mocked<AmbientLightAdapter, AmbientLightSample>;

export function createMockAmbientLight(): MockAmbientLightAdapter {
  const base = createMockBase<AmbientLightSample>('ambientLight');
  return {
    ...base,
    lux: () => base.current()?.illuminanceLux ?? null,
  };
}

export type MockTwaLocationBridgeAdapter = Mocked<TwaLocationBridgeAdapter, GeoFix> & {
  readonly setBridgeInfo: (info: BridgeInfo) => void;
};

/** Default: no bridge, because that is the truth on every non-TWA platform. */
export const NO_BRIDGE_INFO: BridgeInfo = {
  present: false,
  version: null,
  canRequestPermission: false,
  canTrackInBackground: false,
};

export function createMockTwaLocationBridge(): MockTwaLocationBridgeAdapter {
  const base = createMockBase<GeoFix>('twaLocationBridge');
  base.mock.setCapability({ supported: false, reason: NO_BRIDGE_REASON });
  let info: BridgeInfo = NO_BRIDGE_INFO;
  let tracking = false;

  return {
    ...base,
    bridgeInfo: () => info,
    startBackgroundTracking(consent: BackgroundConsent): boolean {
      if (consent.acknowledged !== true) throw new BackgroundConsentRequiredError();
      if (!info.canTrackInBackground) {
        base.mock.fail('no-bridge', NO_BRIDGE_REASON);
        return false;
      }
      tracking = true;
      return true;
    },
    stopBackgroundTracking(): void {
      tracking = false;
    },
    backgroundTracking: () => tracking,
    setBridgeInfo(next: BridgeInfo) {
      info = next;
      base.mock.setCapability(next.present ? ok() : { supported: false, reason: NO_BRIDGE_REASON });
    },
  };
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

export interface MockAdapterSet extends AdapterSet {
  readonly geolocation: MockGeolocationAdapter;
  readonly orientation: MockOrientationAdapter;
  readonly motion: MockMotionAdapter;
  readonly notifications: MockNotificationsAdapter;
  readonly vibration: MockVibrationAdapter;
  readonly screenWakeLock: MockWakeLockAdapter;
  readonly speechRecognition: MockSpeechAdapter;
  readonly cameraCapture: MockCameraCaptureAdapter;
  readonly share: MockShareAdapter;
  readonly clipboard: MockClipboardAdapter;
  readonly network: MockNetworkAdapter;
  readonly visibility: MockVisibilityAdapter;
  readonly battery: MockBatteryAdapter;
  readonly ambientLight: MockAmbientLightAdapter;
  readonly twaLocationBridge: MockTwaLocationBridgeAdapter;
}

/**
 * One call, the whole set. Drop-in replacement for `createPlatformAdapters()`
 * at the composition root.
 */
export function createMockAdapters(): MockAdapterSet {
  return {
    geolocation: createMockGeolocation(),
    orientation: createMockOrientation(),
    motion: createMockMotion(),
    notifications: createMockNotifications(),
    vibration: createMockVibration(),
    screenWakeLock: createMockWakeLock(),
    speechRecognition: createMockSpeechRecognition(),
    cameraCapture: createMockCameraCapture(),
    share: createMockShare(),
    clipboard: createMockClipboard(),
    network: createMockNetwork(),
    visibility: createMockVisibility(),
    battery: createMockBattery(),
    ambientLight: createMockAmbientLight(),
    twaLocationBridge: createMockTwaLocationBridge(),
  };
}

/** Reset every mock in a set. Cheaper than rebuilding it in an afterEach. */
export function resetMockAdapters(set: MockAdapterSet): void {
  set.geolocation.mock.reset();
  set.orientation.mock.reset();
  set.motion.mock.reset();
  set.notifications.mock.reset();
  set.notifications.notifications.clearHistory();
  set.vibration.mock.reset();
  set.screenWakeLock.mock.reset();
  set.speechRecognition.mock.reset();
  set.cameraCapture.mock.reset();
  set.share.mock.reset();
  set.clipboard.mock.reset();
  set.network.mock.reset();
  set.visibility.mock.reset();
  set.battery.mock.reset();
  set.ambientLight.mock.reset();
  set.twaLocationBridge.mock.reset();
  set.twaLocationBridge.setBridgeInfo(NO_BRIDGE_INFO);
}
