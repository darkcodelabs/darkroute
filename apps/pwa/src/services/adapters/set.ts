/**
 * The complete adapter set, and the one place the real implementations are
 * assembled. A screen takes the set (or one member of it) as a prop or from a
 * provider; it never imports a browser API and it never imports a concrete
 * adapter factory directly. Swapping in `createMockAdapters()` from
 * `./testing/mocks` is then a one-line change at the composition root, which is
 * what makes desktop development possible without lying about sensors.
 */

import { createAmbientLightAdapter, type AmbientLightAdapter } from './ambientLight';
import { createBatteryAdapter, type BatteryAdapter } from './battery';
import { createCameraCaptureAdapter, type CameraCaptureAdapter } from './cameraCapture';
import { createClipboardAdapter, type ClipboardAdapter } from './clipboard';
import { createGeolocationAdapter, type GeolocationAdapter } from './geolocation';
import { createMotionAdapter, type MotionAdapter } from './motion';
import { createNetworkAdapter, type NetworkAdapter } from './network';
import { createNotificationsAdapter, type NotificationsAdapter } from './notifications';
import { createOrientationAdapter, type OrientationAdapter } from './orientation';
import { createSpeechAdapter, type SpeechAdapter } from './speechRecognition';
import { createShareAdapter, type ShareAdapter } from './share';
import { createVibrationAdapter, type VibrationAdapter } from './vibration';
import { createVisibilityAdapter, type VisibilityAdapter } from './visibility';
import { createWakeLockAdapter, type WakeLockAdapter } from './screenWakeLock';
import { createTwaLocationBridgeAdapter, type TwaLocationBridgeAdapter } from './twaLocationBridge';
import { ADAPTER_NAMES, type Adapter, type AdapterName, type Capability } from './types';

export interface AdapterSet {
  readonly geolocation: GeolocationAdapter;
  readonly orientation: OrientationAdapter;
  readonly motion: MotionAdapter;
  readonly notifications: NotificationsAdapter;
  readonly vibration: VibrationAdapter;
  readonly screenWakeLock: WakeLockAdapter;
  readonly speechRecognition: SpeechAdapter;
  readonly cameraCapture: CameraCaptureAdapter;
  readonly share: ShareAdapter;
  readonly clipboard: ClipboardAdapter;
  readonly network: NetworkAdapter;
  readonly visibility: VisibilityAdapter;
  readonly battery: BatteryAdapter;
  readonly ambientLight: AmbientLightAdapter;
  readonly twaLocationBridge: TwaLocationBridgeAdapter;
}

/**
 * Build the real set. Constructing an adapter touches no browser API and
 * requests no permission - every probe happens when a screen asks for it.
 */
export function createPlatformAdapters(): AdapterSet {
  return {
    geolocation: createGeolocationAdapter(),
    orientation: createOrientationAdapter(),
    motion: createMotionAdapter(),
    notifications: createNotificationsAdapter(),
    vibration: createVibrationAdapter(),
    screenWakeLock: createWakeLockAdapter(),
    speechRecognition: createSpeechAdapter(),
    cameraCapture: createCameraCaptureAdapter(),
    share: createShareAdapter(),
    clipboard: createClipboardAdapter(),
    network: createNetworkAdapter(),
    visibility: createVisibilityAdapter(),
    battery: createBatteryAdapter(),
    ambientLight: createAmbientLightAdapter(),
    twaLocationBridge: createTwaLocationBridgeAdapter(),
  };
}

/** Every member, as the bare contract. Useful for sweeps over the whole set. */
export function listAdapters(set: AdapterSet): readonly Adapter<unknown, never>[] {
  return ADAPTER_NAMES.map((name) => set[name] as unknown as Adapter<unknown, never>);
}

/** One capability probe per adapter, for a diagnostics screen. */
export function capabilityReport(set: AdapterSet): Readonly<Record<AdapterName, Capability>> {
  const report: Partial<Record<AdapterName, Capability>> = {};
  for (const name of ADAPTER_NAMES) {
    report[name] = set[name].capability();
  }
  return report as Record<AdapterName, Capability>;
}

/** Stop everything. Safe to call when nothing was ever started. */
export function stopAll(set: AdapterSet): void {
  for (const name of ADAPTER_NAMES) set[name].stop();
}
