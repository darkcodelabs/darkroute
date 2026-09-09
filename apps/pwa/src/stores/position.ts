/**
 * POSITION - the fix RADAR is built on, cached and nothing more.
 *
 * Inputs only: a `GeoFix` from the geolocation adapter, a `Heading` from the
 * orientation adapter, a `MotionSample` from the motion adapter. This slice
 * maps fields, records a status and stops. It computes no distance, no bearing
 * and no relative direction - that is `@fwm/core`'s job, and the alert slice
 * caches the answers.
 *
 * PRIVACY (non-negotiable)
 *   `fix.lat` / `fix.lon` are the most sensitive values in the product. They
 *   live here in memory because distance cannot be computed without them, and
 *   they go NOWHERE else: this slice is never persisted, never serialised into
 *   a URL, never attached to a notification and never logged. The only
 *   sanctioned way a fix becomes diagnostic text is
 *   {@link positionForDiagnostics}, which rounds through the adapter's
 *   `redact()` (three decimals, ~110 m) and drops altitude entirely. There is
 *   no debug mode that unlocks full precision; that switch does not exist.
 *
 * SATELLITE COUNT
 *   The design renders "7 SATS" (01 · RADAR) and "±3 M · 4 HZ · 9 SATS" (A3 ·
 *   CONNECT). The web Geolocation API does not expose a satellite count at all,
 *   so {@link PositionState.satellites} stays null on a plain browser and is
 *   populated only by the ESP32 node / TWA bridge, which really does have one.
 *   Rendering a plausible number here would be fabricating instrument data.
 */

import { create } from 'zustand';

import { magnitudeOf } from '../services/adapters';
import type { AdapterError, GeoFix, Heading, MotionSample, RedactedGeoFix } from '../services/adapters';
import { redact } from '../services/adapters';
import { metresPerSecondToMph } from './fwmCore.ts';
import type { PositionFix, SpeedSource } from './fwmCore.ts';

export type { GeoFix, Heading, MotionSample, PositionFix, RedactedGeoFix, SpeedSource };

/**
 * What the GPS block on RADAR is showing.
 *
 *   lock         "GPS LOCK · 7 SATS"
 *   searching    permission granted, nothing has arrived yet
 *   stale        "NO FIX · NO GPS · last fix 40s ago" - we had one, it aged out
 *   denied       the user said no; the app runs on cached cameras only
 *   unavailable  this platform has no geolocation at all
 *   unknown      nothing has been asked yet
 */
export type GpsStatus = 'unknown' | 'unavailable' | 'denied' | 'searching' | 'lock' | 'stale';

/** Where the heading on screen came from. GPS course beats the compass. */
export type HeadingOrigin = 'gps' | 'compass';

export interface PositionState {
  /** The engine's input shape, ready to hand to `AlertEngine.update()`. */
  readonly fix: PositionFix | null;
  /** Epoch ms the platform stamped on the position, not when we handled it. */
  readonly fixAtMs: number | null;
  readonly accuracyM: number | null;
  readonly speedMps: number | null;
  /** Cached unit conversion from `@fwm/core`. The SPEED tile reads this. */
  readonly speedMph: number | null;
  readonly speedSource: SpeedSource;
  /** Compass degrees to render. GPS course when moving, compass otherwise. */
  readonly headingDeg: number | null;
  readonly headingOrigin: HeadingOrigin | null;
  /** True only when the platform vouched for an absolute (true-north) heading. */
  readonly headingAbsolute: boolean;
  /** Gravity-excluded acceleration magnitude. Supporting evidence only. */
  readonly motionMagnitudeMps2: number | null;
  /** Only ever set by the hardware bridge. Null on a plain browser. */
  readonly satellites: number | null;
  readonly gps: GpsStatus;
  readonly error: AdapterError | null;
}

export interface PositionActions {
  /** One position sample from the geolocation adapter. */
  ingestFix(fix: GeoFix): void;
  /** One compass sample. Used when the platform reports no GPS course. */
  ingestHeading(heading: Heading): void;
  /** One motion sample. It can veto "stationary"; it can never set a speed. */
  ingestMotion(sample: MotionSample): void;
  /** The hardware bridge reported a real satellite count. */
  setSatellites(count: number | null): void;
  /** Permission granted, watch started, nothing has arrived yet. */
  markSearching(): void;
  /** The last fix has aged past the tolerance. Driven by the loop, not a timer. */
  markStale(): void;
  markDenied(): void;
  markUnavailable(reason: string): void;
  noteError(error: AdapterError | null): void;
  reset(): void;
}

export type PositionStore = PositionState & PositionActions;

const INITIAL_STATE: PositionState = Object.freeze({
  fix: null,
  fixAtMs: null,
  accuracyM: null,
  speedMps: null,
  speedMph: null,
  speedSource: 'unknown',
  headingDeg: null,
  headingOrigin: null,
  headingAbsolute: false,
  motionMagnitudeMps2: null,
  satellites: null,
  gps: 'unknown',
  error: null,
});

/**
 * WHO IS ALLOWED TO WRITE A POSITION.
 *
 * Normally the answer is "whatever the geolocation watcher reports", and there
 * is nothing to arbitrate. DEMO MODE is the exception: it walks a scripted
 * route, and the real watcher keeps reporting where the phone actually is, so
 * the two fight and the phone wins - measured, the demo froze on its first
 * frame while looking like it was running.
 *
 * A latch rather than stopping the sensor runtime: stopping it means tearing
 * down a permission-bearing watch and rebuilding it afterwards, and a demo
 * must not be able to leave a driver without GPS if it crashes halfway. The
 * watch keeps running and its fixes are dropped, so recovery is one flag.
 */
let scriptedOwner = false;

/** Take or release position. `features/demo` is the only caller. */
export function setScriptedPosition(owned: boolean): void {
  scriptedOwner = owned;
}

export function isScriptedPosition(): boolean {
  return scriptedOwner;
}

export function createPositionStore() {
  return create<PositionStore>()((set, get) => ({
    ...INITIAL_STATE,

    ingestFix(geo) {
      // While a script owns position, the real watcher is ignored. See
      // `setScriptedPosition`. The demo writes through `ingestScriptedFix`.
      if (scriptedOwner && !acceptingScripted) return;
      const previous = get();
      // GPS course wins whenever the platform vouches for one: it is the
      // direction the vehicle is travelling, which is what "AHEAD · SLIGHT
      // LEFT" is relative to. The compass is a fallback and, on the REPORT
      // sheet, the thing being measured.
      const useGpsHeading = geo.headingDeg !== null;
      const fix: PositionFix = {
        lat: geo.lat,
        lon: geo.lon,
        headingDeg: geo.headingDeg,
        speedMps: geo.speedMps,
        accuracyM: geo.accuracyM,
        motionMagnitudeMps2: previous.motionMagnitudeMps2,
        timestampMs: geo.timestamp,
      };
      set({
        fix,
        fixAtMs: geo.timestamp,
        accuracyM: geo.accuracyM,
        speedMps: geo.speedMps,
        speedMph: geo.speedMps === null ? null : metresPerSecondToMph(geo.speedMps),
        speedSource: geo.speedMps === null ? 'unknown' : 'gps',
        headingDeg: useGpsHeading ? geo.headingDeg : previous.headingDeg,
        headingOrigin: useGpsHeading ? 'gps' : previous.headingOrigin,
        headingAbsolute: useGpsHeading ? true : previous.headingAbsolute,
        gps: 'lock',
        error: null,
      });
    },

    ingestHeading(heading) {
      // Never overwrite a GPS course with a compass reading: a drifting
      // relative-orientation value would swing "AHEAD" around at a stoplight.
      if (get().headingOrigin === 'gps') return;
      set({
        headingDeg: heading.headingDeg,
        headingOrigin: 'compass',
        headingAbsolute: heading.absolute,
      });
    },

    /**
     * A MOTION SAMPLE DOES NOT MINT A NEW FIX.
     *
     * It used to: every `devicemotion` event rebuilt `fix` with a fresh object
     * so it could carry the new magnitude. `devicemotion` fires at up to 60 Hz,
     * and the consequences ran the length of the app:
     *
     *   - every `useCurrentFix()` consumer re-rendered at sensor rate, which is
     *     DRIVE, RADAR, REPORT and the map;
     *   - `engineLoop` subscribes to this store and ticks on `state.fix`, and a
     *     new object every time meant the FULL alert engine ran over the entire
     *     cached camera set sixty times a second. That is the phone getting hot
     *     in your hand.
     *
     * The magnitude is still recorded, at the top level, where it always was.
     * A fix picks it up when a fix actually arrives - see `ingestFix`, which
     * already copies `previous.motionMagnitudeMps2` onto every new one - so the
     * engine still sees it. `packages/core/src/types.ts` calls it "SUPPORTING
     * EVIDENCE ONLY" for the stationary check, and evidence that is one GPS
     * sample old is evidence the engine was designed to work with.
     */
    ingestMotion(sample) {
      set({ motionMagnitudeMps2: magnitudeOf(sample.accelerationMps2) });
    },

    setSatellites(count) {
      set({ satellites: count });
    },

    markSearching() {
      set({ gps: 'searching' });
    },

    markStale() {
      // The fix itself is KEPT. "showing cached cameras only" still needs the
      // last known position to decide which cached cameras those are; what
      // changes is that the screen must say the number is old.
      set({ gps: 'stale' });
    },

    markDenied() {
      set({ gps: 'denied', fix: null, fixAtMs: null, satellites: null });
    },

    markUnavailable(reason) {
      set({
        gps: 'unavailable',
        fix: null,
        fixAtMs: null,
        satellites: null,
        error: { code: 'unsupported', message: reason },
      });
    },

    noteError(error) {
      set({ error });
    },

    reset() {
      set({ ...INITIAL_STATE });
    },
  }));
}

export const usePositionStore = createPositionStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const useGpsStatus = (): GpsStatus => usePositionStore((s) => s.gps);
export const useHasFix = (): boolean => usePositionStore((s) => s.fix !== null);
export const useSpeedMph = (): number | null => usePositionStore((s) => s.speedMph);
export const useSpeedMps = (): number | null => usePositionStore((s) => s.speedMps);
export const useHeadingDeg = (): number | null => usePositionStore((s) => s.headingDeg);
export const useAccuracyM = (): number | null => usePositionStore((s) => s.accuracyM);
export const useSatellites = (): number | null => usePositionStore((s) => s.satellites);
export const useLastFixAtMs = (): number | null => usePositionStore((s) => s.fixAtMs);
export const usePositionError = (): AdapterError | null => usePositionStore((s) => s.error);

/**
 * The engine's input. Returned by reference so the driving loop can compare it
 * cheaply and so a component subscribing to it does not re-render on a heading
 * or a satellite-count change.
 */
export const useCurrentFix = (): PositionFix | null => usePositionStore((s) => s.fix);

/** "last fix 40s ago". Pure; the caller supplies the clock. */
export function fixAgeMs(state: PositionState, nowMs: number): number | null {
  if (state.fixAtMs === null) return null;
  return Math.max(0, nowMs - state.fixAtMs);
}

/**
 * The ONLY shape a fix may take on its way to a log line, a diagnostics screen
 * or a support export. Rounded to three decimals and stripped of altitude.
 */
export function positionForDiagnostics(state: PositionState): RedactedGeoFix | null {
  if (state.fix === null || state.fixAtMs === null) return null;
  return redact({
    lat: state.fix.lat,
    lon: state.fix.lon,
    accuracyM: state.fix.accuracyM ?? 0,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: state.fix.speedMps,
    headingDeg: state.fix.headingDeg,
    timestamp: state.fixAtMs,
  });
}

/** Set only while a scripted fix is being written, so the latch lets it past. */
let acceptingScripted = false;

export const positionActions = {
  ingestFix: (fix: GeoFix): void => {
    usePositionStore.getState().ingestFix(fix);
  },
  /**
   * A fix from a script rather than from the radio.
   *
   * Goes through the same store method, so a scripted drive exercises exactly
   * the code a real one does - the heading rules, the stationarity gate, the
   * staleness clock. Only the source differs.
   */
  ingestScriptedFix: (fix: GeoFix): void => {
    acceptingScripted = true;
    try {
      usePositionStore.getState().ingestFix(fix);
    } finally {
      acceptingScripted = false;
    }
  },
  ingestHeading: (heading: Heading): void => {
    usePositionStore.getState().ingestHeading(heading);
  },
  ingestMotion: (sample: MotionSample): void => {
    usePositionStore.getState().ingestMotion(sample);
  },
  markSearching: (): void => {
    usePositionStore.getState().markSearching();
  },
  markStale: (): void => {
    usePositionStore.getState().markStale();
  },
  markDenied: (): void => {
    usePositionStore.getState().markDenied();
  },
  markUnavailable: (reason: string): void => {
    usePositionStore.getState().markUnavailable(reason);
  },
  /**
   * Record a sensor error that is NOT a state change: a timeout in a tunnel,
   * a single failed sample. The watch is still open and `gps` stays where it
   * is, because a driver under a bridge has not lost permission.
   */
  noteError: (error: AdapterError | null): void => {
    usePositionStore.getState().noteError(error);
  },
  reset: (): void => {
    usePositionStore.getState().reset();
  },
};
