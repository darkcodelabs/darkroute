/**
 * WHAT SWEEP DRAWS, DECIDED AS A TABLE.
 *
 * Pure. No React, no store, no browser global, and -- like `radarState.ts` --
 * no arithmetic on a coordinate. Distance and bearing arrive already measured
 * by `@fwm/core`; this module only decides which of the three dot classes a
 * thing is, which hue that class carries, and what the legend counts.
 *
 * =============================================================================
 * ONE HUE VOCABULARY, SHARED WITH RADAR
 * =============================================================================
 * `radarHue()` and `resolveRadarState()` are imported from `../radar`, not
 * re-implemented. SWEEP draws the same six states RADAR draws, and two screens
 * that decide "what colour is this camera" separately are two screens that will
 * eventually disagree in front of a driver.
 *
 *   in range     `in_range`     --fwm-alert-in-range     #FF2D5E  + glow
 *   known        `approaching`  --fwm-alert-approaching  #FFC02E  flat
 *   muted        `muted`        --fwm-text-muted         #6B7381  flat
 *   flocky ghost  no state      --fwm-accent-mesh        #8A6BFF  at 60%
 *
 * The first three are read off SWEEP PRIMITIVES ("camera in range 9px + glow",
 * "camera known 9px flat", "flocky ghost 9px @60%"); the fourth is not an alert
 * state at all, which is exactly why it is the one hue RADAR has no word for.
 *
 * =============================================================================
 * MUTED CAMERAS STILL DRAW, AND STILL COUNT
 * =============================================================================
 *   "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 *    count in EXPOSURE, still log to LOOKUP."
 *      -- Flockys Screens II.dc.html, B4
 *
 * A muted camera keeps its dot, keeps its facing arc, keeps its tap target and
 * keeps its place in the IN RANGE tally. Muting changes one thing here: the
 * hue. There is no branch in this file that can remove a camera from the dial,
 * and `sweepState.test.ts` asserts that there never is.
 */

import type { CameraAssessment, GpsStatus, PermissionStatus, PresencePeer } from '../../stores';
import { radarHue, resolveRadarState } from '../radar';
import type { RadarHue, RadarState } from '../radar';

import { SWEEP_MAX_FT, scopeRadiusFt, screenAngleDeg } from './geometry.ts';

// ---------------------------------------------------------------------------
// The layer toggle
// ---------------------------------------------------------------------------

/**
 * The two keys in SWEEP's header: `ROUTE` and `MESH`.
 *
 * The design draws them as a pair of 36px mono keys, both in `#A7AFBD`, neither
 * marked as the selected one, and draws exactly one dial. It never draws a
 * ROUTE dial or a MESH dial, so this module refuses to invent a second picture:
 * the selection is carried as state, reported to the shell, and reflected on
 * the root as `data-fwm-sweep-layer`. What the dial shows does not change,
 * because the design does not say it changes -- and hiding cameras behind a
 * mode on a screen whose job is warning a driver about cameras is not a guess
 * worth making. GAP: docs/gaps-inbox/sweep.md#route-mesh-toggle-undefined
 */
export type SweepLayer = 'route' | 'mesh';

export const SWEEP_LAYERS: readonly SweepLayer[] = ['route', 'mesh'];

export const DEFAULT_SWEEP_LAYER: SweepLayer = 'route';

// ---------------------------------------------------------------------------
// Dots
// ---------------------------------------------------------------------------

/** The three classes SWEEP PRIMITIVES names. `muted` is a hue, not a class. */
export type SweepDotKind = 'in-range' | 'known' | 'ghost';

export interface SweepDot {
  /** Stable across renders. The camera id, or the peer's ephemeral id. */
  readonly key: string;
  /**
   * The camera a tap opens the INTEL CARD for, or `null` for a ghost.
   * A ghost is another driver, not a camera; there is nothing to open.
   */
  readonly cameraId: string | null;
  readonly kind: SweepDotKind;
  /** RADAR's word for this dot's state. `null` for a ghost, which has none. */
  readonly state: RadarState | null;
  /** The hue token suffix `sweep.css` keys off. `null` for a ghost. */
  readonly hue: RadarHue | null;
  readonly muted: boolean;
  /** Feet, as the engine measured it. Announced; never rounded for display here. */
  readonly distanceFt: number;
  /** Radius in dial units. Already on the design's non-linear ring scale. */
  readonly radius: number;
  /** Degrees clockwise from the top of the dial. */
  readonly angleDeg: number;
  /** Where the lens points, in the dial's frame. `null` when unknown. */
  readonly facingDeg: number | null;
  /**
   * False when the angle is presentational rather than measured -- which is
   * every ghost, because presence carries a distance and deliberately never a
   * direction. Nothing may read a bearing off a dot with this unset.
   */
  readonly bearingKnown: boolean;
}

/** Everything the table reads. All of it comes from a store selector. */
export interface SweepInput {
  /** Nearest-first, straight off the last engine tick. */
  readonly assessments: readonly CameraAssessment[];
  /** The vehicle's heading, for a heading-up dial. `null` falls back to north-up. */
  readonly headingDeg: number | null;
  readonly gps: GpsStatus;
  readonly locationPermission: PermissionStatus;
  /** A global mute is live right now. */
  readonly muted: boolean;
  readonly mutePierced: boolean;
  /** Other DarkRoute. Distances only -- see {@link SweepDot.bearingKnown}. */
  readonly peers: readonly PresencePeer[];
  /** Presence is switched on AND connected. Not "nobody is nearby". */
  readonly presenceLive: boolean;
  /**
   * The outermost ring, in feet. Defaults to the drawn 1000 ft.
   *
   * This changes what is DRAWN and nothing else: the alert threshold and the
   * engine's own ring scale are untouched by zooming out, because looking
   * further and being warned further are different questions.
   */
  readonly outerFt?: number;
  /**
   * How far from the VEHICLE a dot can be and still be on screen, in feet.
   *
   * Defaults to `outerFt`, which is right only while the viewport is sitting on
   * the vehicle. Once the driver has dragged the map, the frame is somewhere
   * else and this is larger -- see `reachFt` in `pan.ts`. Culling by `outerFt`
   * while panned is what drew the data inside a circle that slid around under
   * the drag.
   */
  readonly reachFt?: number;
}

/** Statute feet per mile. Exact by definition, and not a screen length. */
const FEET_PER_MILE = 5280;

/**
 * Which of RADAR's six states one camera is in, on this dial.
 *
 * `in_range` and `approaching` stand for the design's "in range" and "known"
 * dot classes: those are the two hues SWEEP PRIMITIVES draws for a camera, and
 * they are the same two tokens RADAR uses for the same two situations. The mute
 * gate and the no-fix gate are `resolveRadarState`'s, unchanged.
 */
export function cameraDotState(assessment: CameraAssessment, input: SweepInput): RadarState {
  return resolveRadarState({
    alertState: assessment.inRange ? 'in_range' : 'approaching',
    gps: input.gps,
    locationPermission: input.locationPermission,
    muted: input.muted || assessment.muted,
    mutePierced: input.mutePierced,
  });
}

/**
 * Every dot on the dial, cameras first.
 *
 * A camera is dropped only when it is off the SCREEN entirely -- further away
 * than the viewport can reach, which depends on where the driver has dragged
 * the map to and is answered by `reachFt`. Nothing else removes one: not
 * muting, not a stale record, not a filter, and NOT the outer ring, which sets
 * the scale and no longer decides what exists.
 */
export function sweepDots(input: SweepInput): readonly SweepDot[] {
  const dots: SweepDot[] = [];

  const outerFt = input.outerFt ?? SWEEP_MAX_FT;
  const reach = input.reachFt ?? outerFt;

  for (const assessment of input.assessments) {
    if (assessment.distanceFt > reach) continue;
    const radius = scopeRadiusFt(assessment.distanceFt, outerFt);
    if (radius === null) continue;

    const state = cameraDotState(assessment, input);
    const angleDeg = screenAngleDeg(assessment.bearingDeg, input.headingDeg);

    dots.push({
      key: assessment.id,
      cameraId: assessment.id,
      kind: assessment.inRange ? 'in-range' : 'known',
      state,
      hue: radarHue(state),
      muted: input.muted || assessment.muted,
      distanceFt: assessment.distanceFt,
      radius,
      angleDeg,
      facingDeg:
        assessment.directionDeg === null
          ? null
          : screenAngleDeg(assessment.directionDeg, input.headingDeg),
      bearingKnown: true,
    });
  }

  if (input.presenceLive) {
    for (const peer of input.peers) {
      const peerFt = peer.distanceMi * FEET_PER_MILE;
      if (peerFt > reach) continue;
      const radius = scopeRadiusFt(peerFt, outerFt);
      if (radius === null) continue;

      dots.push({
        key: peer.id,
        cameraId: null,
        kind: 'ghost',
        state: null,
        hue: null,
        muted: false,
        distanceFt: peer.distanceMi * FEET_PER_MILE,
        radius,
        angleDeg: ghostAngleDeg(peer.id),
        facingDeg: null,
        bearingKnown: false,
      });
    }
  }

  return dots;
}

/**
 * A ghost's angle on the dial. PRESENTATIONAL, AND NOT A BEARING.
 *
 * `PresencePeer` carries `distanceMi` and no coordinate, on purpose: "DISTANCE
 * ONLY · NO COORDINATES SHARED" (A5). So the radius of a ghost dot is measured
 * and its angle is not, and there is no honest angle to draw -- the design puts
 * its ghosts at arbitrary positions for the same reason.
 *
 * Derived from the peer's ephemeral id so the dot does not skitter around the
 * dial between renders or when another peer joins. Every ghost is marked
 * `bearingKnown: false`, is not tappable, and is announced without a direction.
 * GAP: docs/gaps-inbox/sweep.md#ghosts-have-no-bearing
 */
export function ghostAngleDeg(peerId: string): number {
  let hash = 0;
  for (let index = 0; index < peerId.length; index += 1) {
    hash = (hash * 31 + peerId.charCodeAt(index)) % 360;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// The legend
// ---------------------------------------------------------------------------

/**
 * `IN RANGE 3 · KNOWN 11 · HAKCERS 2`, as `02 · SWEEP` draws it.
 *
 * `darkroute` is `null`, not `0`, when presence is not live. A build with
 * presence switched off has not looked, and "HAKCERS 0" would be a claim that
 * nobody is nearby. The legend renders an em dash instead.
 */
export interface SweepCounts {
  readonly inRange: number;
  readonly known: number;
  readonly darkroute: number | null;
}

/**
 * The three tallies.
 *
 * `inRange` is the engine's count and is passed straight through -- it counts
 * muted cameras, and re-deriving it here is how a screen starts disagreeing
 * with the alert that is buzzing the driver's pocket. `known` is every other
 * assessed camera, dial or no dial: the design shows KNOWN 11 beside six drawn
 * dots, so the tally is what is known, not what fits.
 */
export function sweepCounts(input: SweepInput, countInRange: number, nearbyCount: number): SweepCounts {
  const known = Math.max(0, input.assessments.length - countInRange);
  return {
    inRange: Math.max(0, countInRange),
    known,
    darkroute: input.presenceLive ? Math.max(0, nearbyCount) : null,
  };
}
