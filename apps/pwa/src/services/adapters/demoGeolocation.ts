/**
 * DEMO DRIVE - a position the operator moves by hand.
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * Every interesting thing this app does happens when a car gets near a reader,
 * and the only way to see it was to drive somewhere with a reader. That makes
 * the alert states, the navigation family and the abuse zones effectively
 * undemonstrable at a desk, which is how a pane ships looking wrong for a week
 * without anybody noticing.
 *
 * `services/simulator/` already replays SCENARIOS - a fixed route driven at a
 * fixed speed. That is the right tool for a test and the wrong one for a demo:
 * a scenario goes where it goes, and somebody showing the app wants to steer
 * INTO a particular camera and stop next to it.
 *
 * So this is the other half: a fix the operator positions directly.
 *
 * =============================================================================
 * IT WRAPS THE REAL ADAPTER RATHER THAN REPLACING IT
 * =============================================================================
 * `createPlatformAdapters()` runs once at boot. An implementation chosen there
 * from a setting would need a reload to switch, and a demo you have to reload
 * into is a demo nobody turns on.
 *
 * `wrapWithDemoDrive` therefore returns ONE adapter that answers from whichever
 * source is live. Demo off: every call and every fix is the real adapter's,
 * unchanged and untouched. Demo on: the real watch is left running but its
 * fixes are dropped, and subscribers get the hand-placed position instead.
 *
 * THE REAL WATCH IS DELIBERATELY NOT STOPPED. Turning demo off has to put a
 * live fix back on the glass immediately, and a watch that has to be restarted
 * takes seconds to produce its first one - which on this product looks exactly
 * like the failure it is supposed to be preventing.
 *
 * =============================================================================
 * WHAT IT REFUSES TO DO
 * =============================================================================
 * It does not touch permission or `request()`. A demo cannot be a way to skip
 * the location prompt, because a build where the prompt can be skipped is a
 * build where somebody eventually ships that path to a driver.
 *
 * It does not persist a position. The setting says whether demo mode is on;
 * WHERE you put yourself dies with the tab, because a saved coordinate is the
 * one thing in this module that would be worth stealing.
 */

import type {
  GeoFix,
  GeoWatchOptions,
  GeolocationAdapter,
} from './geolocation';

/** Where the demo says you are, and how fast the app should think you are going. */
export interface DemoDriveFix {
  readonly lat: number;
  readonly lon: number;
  /** Degrees clockwise from true north. Set by whichever way you last moved. */
  readonly headingDeg: number | null;
  /** Metres per second. Zero while parked, which is a state worth demoing. */
  readonly speedMps: number;
}

export interface DemoDriveState {
  readonly active: boolean;
  readonly fix: DemoDriveFix | null;
}

type Listener = (state: DemoDriveState) => void;

/**
 * MODULE STATE, and it is the right shape here.
 *
 * There is exactly one device and exactly one demo position, the adapter is
 * already a singleton built once at boot, and threading a store through
 * `createPlatformAdapters` for a developer control would put a demo concern
 * into the app's dependency graph permanently. It resets on reload because
 * nothing writes it to disk.
 */
let state: DemoDriveState = { active: false, fix: null };
const listeners = new Set<Listener>();

function publish(next: DemoDriveState): void {
  state = next;
  for (const listener of [...listeners]) listener(state);
}

export function demoDriveState(): DemoDriveState {
  return state;
}

export function subscribeDemoDrive(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Turn it on at a starting point - normally wherever the driver actually is,
 * so the first thing the demo shows is the map they were already looking at.
 */
export function startDemoDrive(at: { lat: number; lon: number }): void {
  publish({
    active: true,
    fix: { lat: at.lat, lon: at.lon, headingDeg: null, speedMps: 0 },
  });
}

export function stopDemoDrive(): void {
  /*
   * A NO-OP WHEN IT IS ALREADY OFF, AND THAT GUARD IS LOAD-BEARING.
   *
   * THE BUG IT CLOSES, because it took production down. `DriveScreen`'s demo
   * effect depends on the current GPS fix, so it re-runs on every tick - two or
   * three times a second - and with demo mode off it called this each time.
   * This published unconditionally; the wrapper below answers an inactive state
   * by re-emitting `real.current()` to every subscriber; that lands as a fresh
   * fix; the fix re-runs the effect; the effect calls this again. The main
   * thread never yielded, the map never finished building its style, and the
   * app rendered as a blank canvas under a spinner that never stopped.
   *
   * Publishing "nothing changed" is the whole fault. A state broadcast that
   * fires when the state did not change is an invitation to exactly this loop,
   * and the caller is not the right place to fix it - any caller would do.
   */
  if (!state.active && state.fix === null) return;
  publish({ active: false, fix: null });
}

/** Metres per degree of latitude. Good to about 0.1% anywhere a car can go. */
const M_PER_DEG_LAT = 111_320;

/**
 * MOVE. One step, in a compass direction, in metres.
 *
 * The longitude step is scaled by `cos(lat)` because a degree of longitude is
 * not a fixed distance - without it a step "east" in Anchorage is nearly three
 * times the distance it is in Miami, and a demo that moves further the further
 * north you are is a demo that walks off its own cameras.
 *
 * Heading is set from the direction moved, and speed is reported as the step
 * distance over a nominal second. Both matter: the alert engine's corridor is
 * heading-aware, and `planDetour` aims at the device heading when it has one,
 * so a demo that moved without a heading would exercise a different code path
 * than a real drive does.
 */
export function nudgeDemoDrive(bearingDeg: number, metres: number): void {
  const current = state.fix;
  if (!state.active || current === null) return;

  const radians = (bearingDeg * Math.PI) / 180;
  const north = Math.cos(radians) * metres;
  const east = Math.sin(radians) * metres;

  const lat = current.lat + north / M_PER_DEG_LAT;
  const lonScale = Math.cos((current.lat * Math.PI) / 180);
  const lon =
    current.lon + (lonScale === 0 ? 0 : east / (M_PER_DEG_LAT * lonScale));

  publish({
    active: true,
    fix: { lat, lon, headingDeg: bearingDeg, speedMps: metres },
  });
}

/** Drop yourself somewhere directly - used by a long-press on the map. */
export function placeDemoDrive(at: { lat: number; lon: number }): void {
  if (!state.active) return;
  const current = state.fix;
  publish({
    active: true,
    fix: {
      lat: at.lat,
      lon: at.lon,
      headingDeg: current?.headingDeg ?? null,
      speedMps: 0,
    },
  });
}

/** Park. Speed to zero without moving - the state most alerts are read in. */
export function haltDemoDrive(): void {
  const current = state.fix;
  if (!state.active || current === null) return;
  publish({ active: true, fix: { ...current, speedMps: 0 } });
}

/**
 * ACCURACY REPORTED BY THE DEMO, in metres.
 *
 * Ten, not zero. Several surfaces branch on accuracy - the corridor widens
 * with it, and RADAR says so when a fix is too vague to trust - and a demo
 * reporting a perfect fix would exercise none of that. Ten metres is a good
 * phone with a clear sky, which is the case worth demonstrating.
 */
const DEMO_ACCURACY_M = 10;

function toGeoFix(fix: DemoDriveFix, atMs: number): GeoFix {
  return {
    lat: fix.lat,
    lon: fix.lon,
    accuracyM: DEMO_ACCURACY_M,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: fix.speedMps,
    headingDeg: fix.headingDeg,
    timestamp: atMs,
  };
}

/**
 * The one adapter the app holds. See the header for why it wraps rather than
 * replaces, and why the real watch keeps running underneath.
 */
export function wrapWithDemoDrive(real: GeolocationAdapter): GeolocationAdapter {
  const subscribers = new Set<(v: GeoFix) => void>();
  let lastDemo: GeoFix | null = null;

  /* Demo fixes reach the app through the same subscriber set the real ones
     use, so nothing downstream can tell the difference - which is the point of
     a demo, and also the only way it exercises the real code path. */
  subscribeDemoDrive((next) => {
    if (!next.active || next.fix === null) {
      /*
       * ONLY ON A REAL TRANSITION OUT OF DEMO.
       *
       * The re-emit below exists so leaving demo mode puts a live fix on the
       * map immediately rather than waiting for the next GPS tick, which on a
       * stationary phone can be seconds. It must fire on the EDGE and never on
       * the level: an unconditional re-emit here feeds a fix back to whatever
       * caused the notification, and if that caller is watching fixes it never
       * stops. `lastDemo` is the edge - it is non-null only if demo had
       * actually been driving this adapter.
       */
      const wasDemo = lastDemo !== null;
      lastDemo = null;
      if (!wasDemo) return;
      const live = real.current();
      if (live !== null) for (const fn of [...subscribers]) fn(live);
      return;
    }
    lastDemo = toGeoFix(next.fix, Date.now());
    for (const fn of [...subscribers]) fn(lastDemo);
  });

  return {
    name: real.name,
    capability: () => real.capability(),
    permission: () => real.permission(),
    request: () => real.request(),
    start: (opts?: GeoWatchOptions) => real.start(opts),
    stop: () => {
      real.stop();
    },
    current: () => (demoDriveState().active ? lastDemo : real.current()),
    error: () => (demoDriveState().active ? null : real.error()),
    /* Age is measured from the demo fix while it is live. A demo position that
       reported the real watch's age would trip every staleness guard in the app
       the moment the phone stopped producing fixes. */
    fixAgeMs: (atMs?: number) => {
      if (!demoDriveState().active) return real.fixAgeMs(atMs);
      if (lastDemo === null) return null;
      return (atMs ?? Date.now()) - lastDemo.timestamp;
    },
    subscribe: (fn: (v: GeoFix) => void) => {
      subscribers.add(fn);
      const stopReal = real.subscribe((v) => {
        /* Dropped, not unsubscribed. See the header: the watch stays open so
           leaving demo mode puts a live fix back instantly. */
        if (demoDriveState().active) return;
        fn(v);
      });
      return () => {
        subscribers.delete(fn);
        stopReal();
      };
    },
  };
}
