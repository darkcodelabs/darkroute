/**
 * WHICH OF THE SIX RADAR STATES IS ON SCREEN, AND WHAT GATES IT.
 *
 * Pure. No React, no store, no browser global, no arithmetic on a coordinate.
 * Everything here is a decision table over values the stores already hold, so
 * the six states can be enumerated in a test without mounting anything.
 *
 * =============================================================================
 * THE SIX
 * =============================================================================
 *   clear        nothing inside the threshold          -- `--fwm-alert-clear`
 *   approaching  500-1000 ft and closing               -- `--fwm-alert-approaching`
 *   in_range     inside the threshold                  -- `--fwm-alert-in-range`
 *   multiple     2+ inside the threshold               -- `--fwm-alert-multiple`
 *   no_gps       the fix aged out or never arrived     -- grey, dashed
 *   muted        delivery silenced, tracking continues -- grey, desaturated
 *
 * The first four ARE `AlertState` and are never re-derived here: the engine in
 * `@fwm/core` owns that machine, including the 2-camera cut for `multiple`.
 * This module only decides when the two RADAR-only presentations -- `no_gps`
 * and `muted` -- displace it.
 *
 * =============================================================================
 * WHAT MUTING DOES, AND WHAT IT REFUSES TO DO
 * =============================================================================
 *   "MUTED - hue desaturates, data stays live"
 *     -- Flockys App Screens.dc.html, RADAR state matrix, card 4
 *
 * `muted` is a PRESENTATION state and nothing else. It removes the alert; it
 * removes nothing else. The distance still updates, the camera still counts in
 * EXPOSURE, the state machine still transitions underneath, and
 * {@link RadarInput.alertState} is carried through untouched so nothing
 * downstream can mistake "silenced" for "clear".
 *
 * The one exception is the design's own: a muted camera closer than the
 * re-alert distance pierces the mute ("RE-ALERT ON MUTED IF closer than
 * 150 ft"). The alert slice evaluates that and publishes `mutePierced`; when it
 * is set, the alert hue comes back, because at that distance the driver is
 * being warned whether or not they asked to be.
 *
 * =============================================================================
 * PRECEDENCE, AND WHY IT IS THIS WAY
 * =============================================================================
 *   no_gps  >  muted  >  alert state
 *
 * Without a fix there is no distance to desaturate, so `no_gps` outranks
 * `muted`. `muted` outranks the alert states because it is exactly the
 * substitution the driver asked for.
 */

import type { AlertState, GpsStatus, PermissionStatus } from '../../stores';

/** The six states RADAR draws. The first four are `AlertState` verbatim. */
export type RadarState = AlertState | 'no_gps' | 'muted';

/**
 * What is stopping RADAR from being a live radar, if anything.
 *
 *   live    we have, or recently had, a fix. The six states apply.
 *   loading nothing has arrived yet and nothing has been refused.
 *   denied  the driver said no, or this platform has no geolocation at all.
 *
 * The design draws neither `loading` nor `denied`.
 * GAP: see DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn and
 * docs/gaps-inbox/radar-screen.md#radar-loading-state-not-drawn
 */
export type RadarGate = 'live' | 'loading' | 'denied';

/**
 * Hue = state and nothing else.
 *
 * `muted` and `no_gps` are not alert states and deliberately do NOT get an
 * alert hue: the design draws both in grey precisely so that a coloured ring
 * always means a camera.
 */
export type RadarHue = 'clear' | 'approaching' | 'in-range' | 'multiple' | 'muted';

/**
 * How the scope is drawn. One value per documented treatment, no combinations.
 *
 * `expand` is gone. v1 drew `in_range` as a ring with an expanding copy
 * (`fwmRing 1.1s`); `Flockys App Screens v2.dc.html` declares that keyframe and
 * uses it nowhere, drawing the alert states as the fastest breath on the screen
 * instead -- `fwmPulse 1.15s` on the scope's rim, against the state matrix's
 * slower `1.4s` for `approaching`. `pulse-fast` is that rim breath.
 */
export type RadarRing = 'solid' | 'pulse' | 'pulse-fast' | 'dashed' | 'flat';

/** Everything the decision table reads. All of it comes from a store selector. */
export interface RadarInput {
  /** The engine's verdict, straight through. Never recomputed. */
  readonly alertState: AlertState;
  readonly gps: GpsStatus;
  /** The passive permission read. Never a prompt. */
  readonly locationPermission: PermissionStatus;
  /** A global mute is live right now. */
  readonly muted: boolean;
  /** The mute is live but the camera is inside the re-alert distance. */
  readonly mutePierced: boolean;
}

/** GPS states that mean "we cannot say where the vehicle is right now". */
const NO_POSITION: ReadonlySet<GpsStatus> = new Set<GpsStatus>([
  'unknown',
  'unavailable',
  'denied',
  'searching',
  'stale',
]);

/** GPS states that mean "and nobody is going to fix that by waiting". */
const REFUSED: ReadonlySet<GpsStatus> = new Set<GpsStatus>(['unavailable', 'denied']);

/**
 * Is anything blocking RADAR, and is it worth waiting out?
 *
 * `denied` covers both a refusal and a platform with no geolocation: from the
 * driver's side both mean "this will not start on its own", and the screen
 * says which one it is in its copy rather than in its structure.
 */
export function resolveRadarGate(input: RadarInput): RadarGate {
  if (input.locationPermission === 'denied' || REFUSED.has(input.gps)) return 'denied';
  if (input.gps === 'unknown' || input.gps === 'searching') return 'loading';
  return 'live';
}

/**
 * Which of the six is on screen.
 *
 * Note what this does NOT do: it never inspects a distance, a count or a
 * camera. `multiple` arrives already decided by the engine, because the
 * 2-camera cut, the hysteresis and the dedupe that produce it are the engine's
 * and duplicating any of them here is how two parts of an app start disagreeing
 * about how many cameras there are.
 */
export function resolveRadarState(input: RadarInput): RadarState {
  if (NO_POSITION.has(input.gps)) return 'no_gps';
  if (input.muted && !input.mutePierced) return 'muted';
  return input.alertState;
}

/** The hue token suffix for a state. `no_gps` has no hue -- it is drawn grey. */
export function radarHue(state: RadarState): RadarHue | null {
  switch (state) {
    case 'clear':
      return 'clear';
    case 'approaching':
      return 'approaching';
    case 'in_range':
      return 'in-range';
    case 'multiple':
      return 'multiple';
    case 'muted':
      return 'muted';
    case 'no_gps':
      return null;
  }
}

/**
 * The scope treatment for a state, read off the design.
 *
 *   clear        solid green + glow, no animation                -- matrix card 1
 *   approaching  solid amber + `fwmPulse 1.4s`                   -- matrix card 2
 *   in_range     the dot lattice, rim breathing at `fwmPulse 1.15s`
 *                                                                -- v2 screen 01
 *   multiple     in_range's treatment in the multiple hue        -- STANDING IN,
 *                DESIGN-GAPS.md#multiple-state-never-rendered
 *   no_gps       `3px dashed #3A3F4B`, no animation, no pip      -- matrix card 3
 *   muted        the lattice in grey, no animation, no glow      -- matrix card 4
 */
export function radarRing(state: RadarState): RadarRing {
  switch (state) {
    case 'clear':
      return 'solid';
    case 'approaching':
      return 'pulse';
    case 'in_range':
    case 'multiple':
      return 'pulse-fast';
    case 'no_gps':
      return 'dashed';
    case 'muted':
      return 'flat';
  }
}

/**
 * Is this state one where a distance readout is live?
 *
 * True for `muted` on purpose. That is the whole point of the mute rule: the
 * numbers keep moving, the alert does not fire.
 */
export function hasLiveDistance(state: RadarState): boolean {
  return state !== 'no_gps';
}
