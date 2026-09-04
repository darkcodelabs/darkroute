/**
 * GEOLOCATION - the fix RADAR is built on.
 *
 * Exposes everything the screens read off a position: distance needs lat/lon
 * and accuracy, the "AHEAD · SLIGHT LEFT" bearing needs heading, the SPEED tile
 * needs speed, and "last fix 40s ago" in the NO GPS state needs the timestamp
 * the platform stamped on the position - not the time we happened to handle it.
 *
 * PRIVACY INVARIANT
 *   Exact coordinates never reach a log sink, a request body, telemetry or a
 *   crash report. `redact()` is the only sanctioned way a fix becomes
 *   diagnostic text: it rounds to three decimal places (~110 m at the equator),
 *   which is coarse enough to be useless for following someone and precise
 *   enough to tell two counties apart. Any logging path must call it. There is
 *   no "debug mode" that unlocks full precision - that switch does not exist.
 *
 * BACKGROUND TRACKING
 *   There is none here, and the web cannot provide it: `watchPosition` stops
 *   when the page is frozen or the screen locks. The wake lock adapter keeps
 *   RADAR alive in the foreground; anything beyond that needs the native TWA
 *   bridge, which is a separate adapter with a separate consent gate.
 */

import { createCore } from './core';
import {
  errorMessage,
  globalValue,
  nav,
  no,
  ok,
  queryPermission,
  type Adapter,
  type Capability,
  type PermissionOutcome,
  type RequestOutcome,
} from './types';

/** One position, in the units the screens actually render. */
export interface GeoFix {
  readonly lat: number;
  readonly lon: number;
  /** Horizontal accuracy in metres, 95% confidence. Always present per spec. */
  readonly accuracyM: number;
  readonly altitudeM: number | null;
  readonly altitudeAccuracyM: number | null;
  /** Metres per second. Null when the platform will not vouch for it. */
  readonly speedMps: number | null;
  /** Degrees clockwise from true north. Null when stationary or unknown. */
  readonly headingDeg: number | null;
  /** Epoch milliseconds stamped by the platform on the position itself. */
  readonly timestamp: number;
}

/**
 * What a fix is allowed to look like once it leaves this module for any
 * diagnostic purpose. There is no field here that can be resolved to a street.
 */
export interface RedactedGeoFix {
  readonly latApprox: number;
  readonly lonApprox: number;
  readonly precision: 'approx-3dp';
  readonly accuracyM: number;
  readonly speedMps: number | null;
  readonly headingDeg: number | null;
  readonly timestamp: number;
}

export interface GeoWatchOptions {
  readonly highAccuracy?: boolean;
  readonly timeoutMs?: number;
  readonly maximumAgeMs?: number;
}

export interface GeolocationAdapter extends Adapter<GeoFix, GeoWatchOptions> {
  /** Always implemented here; the base contract leaves it optional. */
  permission(): Promise<PermissionOutcome>;
  request(): Promise<RequestOutcome>;
  /** Milliseconds since the last fix, or null if there has never been one. */
  fixAgeMs(atMs?: number): number | null;
}

/** Decimal places kept by `redact`. Three is ~110 m of ambiguity. */
export const REDACTION_DECIMALS = 3;

/**
 * Sensor tuning, not design values: how the watch is configured to behave.
 *
 * =============================================================================
 * WHAT "HIGH ACCURACY" ACTUALLY BUYS, AND WHERE THE CEILING IS
 * =============================================================================
 * `enableHighAccuracy: true` is the ONE accuracy lever the web platform gives a
 * page, and it has always been on here. On Android it asks the fused location
 * provider for its GPS-backed mode instead of the cheap wifi/cell estimate; on
 * iOS it asks Core Location for its best available.
 *
 * It is not a promise of a number. The `±15 M` on screen is what the DEVICE
 * reported for that fix -- through trees, indoors, in a garage, or in the first
 * seconds before the GPS chip has settled, 15 m is a normal honest answer, and
 * it usually tightens to 3-5 m once moving with a clear sky.
 *
 * There is no further web API to reach for. Android's
 * `PRIORITY_HIGH_ACCURACY` and iOS's `kCLLocationAccuracyBestForNavigation`
 * are native calls; a Trusted Web Activity is still a WebView using this exact
 * geolocation API, so wrapping the PWA does not unlock them. Anything better
 * needs a native location service handing fixes to the web layer, which is a
 * real option and a much larger one.
 *
 * WHY `maximumAge` IS ZERO
 *   It was 2000 ms, which lets the platform hand back a fix up to two seconds
 *   old. At 60 mph that is 176 feet of staleness -- a third of the 500 ft alert
 *   threshold, spent before the engine has even looked at the position. For a
 *   product whose entire job is "how far away is it, right now", accepting a
 *   cached fix trades away the thing being measured. Zero forces a live one.
 */
export const DEFAULT_WATCH_OPTIONS: Required<GeoWatchOptions> = {
  highAccuracy: true,
  timeoutMs: 15_000,
  maximumAgeMs: 0,
};

export type GeoErrorCode =
  'unsupported' | 'permission-denied' | 'position-unavailable' | 'timeout' | 'watch-failed';

/**
 * Round a coordinate to `REDACTION_DECIMALS`. Exported so a test can assert the
 * rounding directly, and so nothing has to reimplement it badly elsewhere.
 */
export function redactCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(REDACTION_DECIMALS));
}

/**
 * The ONLY safe way to turn a fix into something loggable.
 *
 * Note what is dropped as well as what is rounded: altitude is gone, because a
 * precise altitude plus a coarse position still identifies a parking garage
 * floor. Speed and heading stay - they describe the vehicle, not the place.
 */
export function redact(fix: GeoFix): RedactedGeoFix {
  return {
    latApprox: redactCoordinate(fix.lat),
    lonApprox: redactCoordinate(fix.lon),
    precision: 'approx-3dp',
    accuracyM: fix.accuracyM,
    speedMps: fix.speedMps,
    headingDeg: fix.headingDeg,
    timestamp: fix.timestamp,
  };
}

function geolocationApi(): Geolocation | undefined {
  const geo = nav()?.geolocation;
  if (!geo || typeof geo.watchPosition !== 'function') return undefined;
  return geo;
}

export function geolocationCapability(): Capability {
  if (nav() === undefined) return no('no navigator in this runtime');
  if (geolocationApi() === undefined) {
    return no('navigator.geolocation is not available in this browser');
  }
  const secure = globalValue<boolean>('isSecureContext');
  if (secure === false) {
    return no('geolocation needs a secure context (https or localhost); this page is not one');
  }
  return ok();
}

function toFix(position: GeolocationPosition): GeoFix {
  const c = position.coords;
  return {
    lat: c.latitude,
    lon: c.longitude,
    accuracyM: c.accuracy,
    altitudeM: typeof c.altitude === 'number' ? c.altitude : null,
    altitudeAccuracyM: typeof c.altitudeAccuracy === 'number' ? c.altitudeAccuracy : null,
    speedMps: typeof c.speed === 'number' ? c.speed : null,
    headingDeg: typeof c.heading === 'number' ? c.heading : null,
    timestamp: position.timestamp,
  };
}

function classify(err: GeolocationPositionError): { code: GeoErrorCode; message: string } {
  // The message the platform supplies never contains coordinates, so it is safe
  // to keep. The codes are the spec's numeric constants.
  if (err.code === 1) return { code: 'permission-denied', message: 'location permission denied' };
  if (err.code === 2) {
    return { code: 'position-unavailable', message: 'no position available from this device' };
  }
  if (err.code === 3) return { code: 'timeout', message: 'timed out waiting for a fix' };
  return { code: 'watch-failed', message: errorMessage(err, 'geolocation failed') };
}

export function createGeolocationAdapter(): GeolocationAdapter {
  const core = createCore<GeoFix>();
  let watchId: number | null = null;

  const clear = (): void => {
    const geo = geolocationApi();
    if (watchId !== null && geo && typeof geo.clearWatch === 'function') {
      geo.clearWatch(watchId);
    }
    watchId = null;
  };

  return {
    name: 'geolocation',

    capability: geolocationCapability,

    /** Passive read. Never prompts. Chromium answers; some browsers cannot. */
    async permission(): Promise<PermissionOutcome> {
      if (!geolocationCapability().supported) return 'unavailable';
      return queryPermission('geolocation');
    },

    /**
     * USER GESTURE ONLY. Geolocation has no separate "request" call: asking for
     * one position IS the prompt, so this must be wired to the onboarding
     * "GRANTED" button and to nothing else. Never call it on load or on start().
     *
     * No timeout is passed on purpose. A timeout here would resolve while the
     * OS prompt is still on screen and report a decision the user has not made.
     */
    async request(): Promise<RequestOutcome> {
      const geo = geolocationApi();
      if (!geo || typeof geo.getCurrentPosition !== 'function') return 'unavailable';
      return new Promise<RequestOutcome>((resolve) => {
        geo.getCurrentPosition(
          (position) => {
            core.clearError();
            core.emit(toFix(position));
            resolve('granted');
          },
          (err) => {
            const { code, message } = classify(err);
            core.fail(code, message);
            resolve(code === 'permission-denied' ? 'denied' : 'unavailable');
          },
          { enableHighAccuracy: DEFAULT_WATCH_OPTIONS.highAccuracy, maximumAge: 0 },
        );
      });
    },

    /** Idempotent: a second call while watching does nothing. */
    start(opts?: GeoWatchOptions): void {
      const capability = geolocationCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'geolocation is not available');
        return;
      }
      if (watchId !== null) return;
      const geo = geolocationApi();
      if (!geo) return;

      const settings = { ...DEFAULT_WATCH_OPTIONS, ...opts };
      try {
        watchId = geo.watchPosition(
          (position) => {
            core.clearError();
            core.emit(toFix(position));
          },
          (err) => {
            const { code, message } = classify(err);
            core.fail(code, message);
            // A denial is permanent for this page load. Holding an active watch
            // open would burn battery waiting for a callback that never comes.
            if (code === 'permission-denied') {
              clear();
              core.setRunning(false);
            }
          },
          {
            enableHighAccuracy: settings.highAccuracy,
            timeout: settings.timeoutMs,
            maximumAge: settings.maximumAgeMs,
          },
        );
        core.setRunning(true);
      } catch (cause) {
        watchId = null;
        core.setRunning(false);
        core.fail('watch-failed', errorMessage(cause, 'could not start the position watch'));
      }
    },

    /** Idempotent: safe to call when never started, and twice in a row. */
    stop(): void {
      clear();
      core.setRunning(false);
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
    // The watch's error callback above records a timeout or a refusal here.
    // Without this, the only reader was the sensor runtime's FIX subscription,
    // which cannot fire when the failure is that there are no fixes.
    subscribeToError: core.subscribeToError,

    fixAgeMs(atMs?: number): number | null {
      const fix = core.current();
      if (fix === null) return null;
      return (atMs ?? Date.now()) - fix.timestamp;
    },
  };
}
