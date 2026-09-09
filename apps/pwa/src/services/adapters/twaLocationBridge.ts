/**
 * TWA LOCATION BRIDGE - the only honest route to background location.
 *
 * DarkRoute ships as a Trusted Web Activity on Android. When it is
 * running inside that shell, the native side injects a JavaScript interface and
 * this adapter is the only thing allowed to talk to it. When it is running as a
 * plain web page - which is every desktop, every iPhone, and the site opened in
 * a browser tab - the interface is absent and `capability()` says exactly why:
 *
 *     "no native bridge; foreground web geolocation only"
 *
 * That sentence is the product's whole background-location story on the web.
 * `watchPosition` stops when the screen locks. There is no service worker trick
 * and no wake-lock trick that changes it. Anything claiming otherwise is wrong.
 *
 * CONSENT - WHY start() DOES NOT START ANYTHING
 *   Background location is the most invasive permission an Android app can
 *   hold, and this product's entire argument is about who gets to follow whom.
 *   So `start()` only attaches the receive path and reads whatever fix the
 *   native side already has. Continuous background tracking begins only when
 *   `startBackgroundTracking()` is handed an explicit, acknowledged consent
 *   object; without one it throws. There is no code path that turns background
 *   tracking on as a side effect of anything else.
 *
 * TRUST
 *   Everything crossing the bridge is a string, because an Android
 *   `addJavascriptInterface` object can only carry primitives. Every payload is
 *   parsed and validated field by field before it becomes a fix. A malformed
 *   payload is dropped and recorded, never coerced into a plausible position.
 */

import { createCore } from './core';
import type { GeoFix } from './geolocation';
import {
  errorMessage,
  globalValue,
  no,
  ok,
  type Adapter,
  type Capability,
  type PermissionOutcome,
  type RequestOutcome,
} from './types';

/** The name the Android shell injects. Contract, fixed on both sides. */
export const TWA_BRIDGE_GLOBAL = 'DarkrouteNative';
/** The callback the native side invokes with each fix, as a JSON string. */
export const TWA_FIX_CALLBACK = '__fwmNativeFix';

/** The exact sentence a web-only platform gets. Asserted by a test. */
export const NO_BRIDGE_REASON = 'no native bridge; foreground web geolocation only';

/** Bounded poll after asking the native side to show the OS dialog. */
export const PERMISSION_POLL_ATTEMPTS = 40;
export const PERMISSION_POLL_INTERVAL_MS = 250;

/**
 * Proof that a human was shown what background tracking means and said yes.
 * A boolean parameter would be too easy to pass by accident.
 */
export interface BackgroundConsent {
  readonly acknowledged: true;
  /** Epoch ms the user accepted. Recorded so consent can be shown to expire. */
  readonly grantedAt: number;
}

export interface BridgeInfo {
  readonly present: boolean;
  readonly version: string | null;
  readonly canRequestPermission: boolean;
  readonly canTrackInBackground: boolean;
}

export interface TwaLocationBridgeAdapter extends Adapter<GeoFix> {
  permission(): Promise<PermissionOutcome>;
  request(): Promise<RequestOutcome>;
  bridgeInfo(): BridgeInfo;
  /** Throws without acknowledged consent. Never called as a side effect. */
  startBackgroundTracking(consent: BackgroundConsent): boolean;
  stopBackgroundTracking(): void;
  backgroundTracking(): boolean;
}

export class BackgroundConsentRequiredError extends Error {
  override readonly name = 'BackgroundConsentRequiredError';
  constructor() {
    super(
      'background location tracking needs explicit acknowledged consent; ' +
        'it is never started as a side effect of start() or of a screen mounting',
    );
  }
}

interface NativeBridge {
  getBridgeVersion?: () => string;
  hasBackgroundLocationPermission?: () => boolean;
  requestBackgroundLocationPermission?: () => void;
  startBackgroundUpdates?: (optionsJson: string) => boolean;
  stopBackgroundUpdates?: () => void;
  getLastFix?: () => string;
}

function bridge(): NativeBridge | undefined {
  const injected = globalValue<NativeBridge>(TWA_BRIDGE_GLOBAL);
  if (injected === null || typeof injected !== 'object') return undefined;
  return injected;
}

export function twaBridgeCapability(): Capability {
  if (bridge() === undefined) return no(NO_BRIDGE_REASON);
  return ok();
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse and validate one bridge payload. Returns null for anything that is not
 * unambiguously a position. Exported because this is the trust boundary and it
 * deserves its own test rather than an integration test that happens to cover it.
 */
export function fixFromBridgePayload(payload: string): GeoFix | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;

  const lat = readNumber(source, 'lat');
  const lon = readNumber(source, 'lon');
  const accuracyM = readNumber(source, 'accuracyM');
  const timestamp = readNumber(source, 'timestamp');
  if (lat === null || lon === null || accuracyM === null || timestamp === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (accuracyM < 0) return null;

  return {
    lat,
    lon,
    accuracyM,
    altitudeM: readNumber(source, 'altitudeM'),
    altitudeAccuracyM: readNumber(source, 'altitudeAccuracyM'),
    speedMps: readNumber(source, 'speedMps'),
    headingDeg: readNumber(source, 'headingDeg'),
    timestamp,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTwaLocationBridgeAdapter(): TwaLocationBridgeAdapter {
  const core = createCore<GeoFix>();
  let tracking = false;
  let callbackInstalled = false;

  const receive = (payload: string): void => {
    const fix = fixFromBridgePayload(payload);
    if (fix === null) {
      // Never coerced into a position. The count matters, the payload does not,
      // and the payload is exactly the thing that must not be written down.
      core.fail('bad-bridge-payload', 'the native bridge sent a payload that is not a position');
      return;
    }
    core.clearError();
    core.emit(fix);
  };

  const installCallback = (): void => {
    if (callbackInstalled) return;
    const bag = globalThis as unknown as Record<string, unknown>;
    bag[TWA_FIX_CALLBACK] = receive;
    callbackInstalled = true;
  };

  const removeCallback = (): void => {
    if (!callbackInstalled) return;
    const bag = globalThis as unknown as Record<string, unknown>;
    bag[TWA_FIX_CALLBACK] = undefined;
    callbackInstalled = false;
  };

  return {
    name: 'twaLocationBridge',

    capability: twaBridgeCapability,

    async permission(): Promise<PermissionOutcome> {
      const native = bridge();
      if (native === undefined) return 'unavailable';
      if (typeof native.hasBackgroundLocationPermission !== 'function') return 'unavailable';
      try {
        return native.hasBackgroundLocationPermission() ? 'granted' : 'prompt';
      } catch (cause) {
        core.fail('bridge-call-failed', errorMessage(cause, 'the native bridge threw'));
        return 'unavailable';
      }
    },

    /**
     * USER GESTURE ONLY. This asks the Android shell to raise the background
     * location dialog, which is a two-step OS flow the user must be expecting.
     * The bridge call returns immediately, so the result is polled from
     * `hasBackgroundLocationPermission()` for a bounded time.
     */
    async request(): Promise<RequestOutcome> {
      const native = bridge();
      if (native === undefined) return 'unavailable';
      const ask = native.requestBackgroundLocationPermission;
      const read = native.hasBackgroundLocationPermission;
      if (typeof ask !== 'function' || typeof read !== 'function') return 'unavailable';
      try {
        if (read()) return 'granted';
        ask();
        for (let attempt = 0; attempt < PERMISSION_POLL_ATTEMPTS; attempt += 1) {
          await sleep(PERMISSION_POLL_INTERVAL_MS);
          if (read()) return 'granted';
        }
        return 'denied';
      } catch (cause) {
        core.fail('bridge-call-failed', errorMessage(cause, 'the native bridge threw'));
        return 'unavailable';
      }
    },

    /**
     * Attach the receive path and pick up whatever fix the shell already holds.
     * DOES NOT start background updates - see the consent note at the top.
     * Idempotent.
     */
    start(): void {
      const capability = twaBridgeCapability();
      if (!capability.supported) {
        core.fail('no-bridge', capability.reason ?? NO_BRIDGE_REASON);
        return;
      }
      if (core.running()) return;
      core.setRunning(true);
      installCallback();

      const native = bridge();
      if (native && typeof native.getLastFix === 'function') {
        try {
          receive(native.getLastFix());
        } catch (cause) {
          core.fail('bridge-call-failed', errorMessage(cause, 'the native bridge threw'));
        }
      }
    },

    /** Idempotent. Also stops background tracking: leaving it on would be the
     *  exact behaviour this product exists to complain about. */
    stop(): void {
      const native = bridge();
      if (tracking && native && typeof native.stopBackgroundUpdates === 'function') {
        try {
          native.stopBackgroundUpdates();
        } catch {
          // The shell is gone; there is nothing left to stop.
        }
      }
      tracking = false;
      removeCallback();
      core.setRunning(false);
    },

    startBackgroundTracking(consent: BackgroundConsent): boolean {
      if (consent.acknowledged !== true) throw new BackgroundConsentRequiredError();
      const native = bridge();
      if (native === undefined || typeof native.startBackgroundUpdates !== 'function') {
        core.fail('no-bridge', NO_BRIDGE_REASON);
        return false;
      }
      installCallback();
      try {
        const accepted = native.startBackgroundUpdates(
          JSON.stringify({ consentGrantedAt: consent.grantedAt }),
        );
        tracking = accepted === true;
        if (!tracking) {
          core.fail('background-refused', 'the native shell refused to start background updates');
        }
        return tracking;
      } catch (cause) {
        tracking = false;
        core.fail('bridge-call-failed', errorMessage(cause, 'the native bridge threw'));
        return false;
      }
    },

    stopBackgroundTracking(): void {
      const native = bridge();
      if (native && typeof native.stopBackgroundUpdates === 'function') {
        try {
          native.stopBackgroundUpdates();
        } catch {
          // Nothing to stop.
        }
      }
      tracking = false;
    },

    backgroundTracking(): boolean {
      return tracking;
    },

    bridgeInfo(): BridgeInfo {
      const native = bridge();
      if (native === undefined) {
        return {
          present: false,
          version: null,
          canRequestPermission: false,
          canTrackInBackground: false,
        };
      }
      let version: string | null = null;
      if (typeof native.getBridgeVersion === 'function') {
        try {
          const reported = native.getBridgeVersion();
          version = typeof reported === 'string' ? reported : null;
        } catch {
          version = null;
        }
      }
      return {
        present: true,
        version,
        canRequestPermission: typeof native.requestBackgroundLocationPermission === 'function',
        canTrackInBackground: typeof native.startBackgroundUpdates === 'function',
      };
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
  };
}
