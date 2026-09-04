/**
 * WHAT THE HERO SHOWS, INCLUDING WHEN IT HAS NOTHING TO SHOW.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A2 · OFFLINE - DEGRADED` -- `610` /
 * `FT` / `CACHED CAMERA · AHEAD`. A2 draws one moment: a device with a fix, a
 * cache, and a camera 610 feet ahead of it.
 *
 * =============================================================================
 * WHY THIS FILE EXISTS
 * =============================================================================
 * RADAR does not hand its readout an unguarded model. `RadarView` asks
 * `hasLiveDistance(state)` first and replaces the whole block with a sentence
 * when the answer is no, because " - FT" beside nothing is not a degraded
 * readout, it is a screen that has stopped explaining itself.
 *
 * OFFLINE renders the same `DistanceReadout` from the same `directionLine`, so
 * it needs the same gate or the two screens disagree in exactly the states the
 * design never drew:
 *
 *   no_gps          RADAR says "location is off." / "waiting for the first
 *                   fix." / "last fix 40s ago."; `directionLine()` returns null,
 *                   so an ungated OFFLINE would draw a bare ` - ` and no line.
 *   no camera       with a fix and `nearest === null`, `directionLine()` takes
 *                   the offline branch with no coarse direction and returns the
 *                   bare string `CACHED CAMERA` -- printed, in the ungated
 *                   version, directly above `CACHED CAMS 0`.
 *
 * =============================================================================
 * THE COPY IS RADAR'S, WORD FOR WORD
 * =============================================================================
 * The three degraded leads and the privacy note are the strings `RadarView`
 * renders for the same three conditions (its `degradedCopy`, which is a
 * module-private function of another feature's file). They are repeated here
 * rather than imported, and `OfflineScreen.test.tsx` renders RADAR beside
 * OFFLINE in each condition and asserts the rendered words match, so the
 * duplication cannot drift silently.
 * GAP: see docs/gaps-inbox/offline.md#degraded-hero-copy-is-duplicated
 *
 * The two "no camera" leads are this screen's own and the design draws neither.
 * GAP: see docs/gaps-inbox/offline.md#hero-with-no-camera-is-undrawn
 */

import { directionLine as composeDirectionLine, formatFixAge } from '../radar/format.ts';
import type { RelativeDirection } from '../radar/format.ts';
import { hasLiveDistance } from '../radar/radarState.ts';
import type { RadarGate, RadarState } from '../radar/radarState.ts';

import type { StorageStatus } from './capabilities.ts';

/**
 * Verbatim from `A1 · ONBOARDING - PERMISSIONS`, and the same string RADAR
 * renders under "location is off."
 */
export const PRIVACY_NOTE =
  'Required. Distance to cameras is computed on-device. Coordinates never leave the phone unless you file a report.';

/** Either the readout A2 draws, or the sentence that replaces it. */
export type OfflineHero =
  | {
      readonly kind: 'readout';
      readonly distanceFt: number;
      readonly directionLine: string | null;
    }
  | { readonly kind: 'message'; readonly lead: string; readonly note: string | null };

export interface OfflineHeroInput {
  /** One of the six, resolved by RADAR's `resolveRadarState`. */
  readonly state: RadarState;
  /** RADAR's gate: is anything blocking a fix, and is it worth waiting out. */
  readonly gate: RadarGate;
  /** This platform has no geolocation at all, as opposed to a refusal. */
  readonly geolocationUnavailable: boolean;
  /** Age of the last fix, for "last fix 40s ago." */
  readonly lastFixAgeMs: number | null;
  /** Feet to the nearest camera, straight off the engine's assessment. */
  readonly distanceFt: number | null;
  readonly direction: RelativeDirection | null;
  readonly bearingDeg: number | null;
  readonly headingDeg: number | null;
  readonly isClosing: boolean | null;
  readonly offline: boolean;
  /** Distinct cameras on disk, or null while the cache read is in flight. */
  readonly cachedCameras: number | null;
  readonly storage: StorageStatus;
}

/** The sentence RADAR renders in place of the readout, for the same reasons. */
function degradedCopy(input: OfflineHeroInput): { lead: string; note: string | null } {
  if (input.gate === 'denied') {
    return {
      lead: input.geolocationUnavailable
        ? 'this device has no location service.'
        : 'location is off.',
      note: PRIVACY_NOTE,
    };
  }
  if (input.gate === 'loading') {
    return { lead: 'waiting for the first fix.', note: null };
  }

  const age = formatFixAge(input.lastFixAgeMs);
  return {
    lead: age === null ? 'no fix.' : `last fix ${age} ago.`,
    note: 'showing cached cameras only.',
  };
}

/**
 * There is a position and no camera to measure from it.
 *
 * The two cases are different facts and are not merged: an empty cache is this
 * screen having nothing to work with, and a filled cache with no nearest camera
 * is the engine having looked and found none. Neither may borrow A2's
 * `CACHED CAMERA`, which is a provenance label for a distance that exists.
 */
function noCameraCopy(input: OfflineHeroInput): { lead: string; note: string | null } {
  const nothingCached = input.storage === 'unavailable' || input.cachedCameras === 0;
  if (nothingCached) {
    return {
      lead: 'nothing is cached on this device.',
      note: 'there is no camera here to measure against.',
    };
  }
  return { lead: 'no cached camera nearby.', note: null };
}

/**
 * The hero, gated the way RADAR gates it.
 *
 * `muted` deliberately keeps the readout: the mute removes the alert and
 * nothing else, so a muted camera still draws its distance and still reads
 * `STILL TRACKING` under it.
 */
export function resolveOfflineHero(input: OfflineHeroInput): OfflineHero {
  if (!hasLiveDistance(input.state)) {
    return { kind: 'message', ...degradedCopy(input) };
  }
  if (input.distanceFt === null || !Number.isFinite(input.distanceFt)) {
    return { kind: 'message', ...noCameraCopy(input) };
  }
  return {
    kind: 'readout',
    distanceFt: input.distanceFt,
    directionLine: composeDirectionLine({
      state: input.state,
      direction: input.direction,
      bearingDeg: input.bearingDeg,
      headingDeg: input.headingDeg,
      isClosing: input.isClosing,
      offline: input.offline,
    }),
  };
}
