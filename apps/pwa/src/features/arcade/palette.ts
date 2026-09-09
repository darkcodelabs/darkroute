/**
 * THE GAME'S TOKENS, READ OFF THE DOCUMENT.
 *
 * A canvas is the one surface in this app that cannot read `var()`, and
 * `features/map/palette.ts` already solved that for MapLibre: resolve the
 * tokens off the document at the moment they are needed and hand the renderer
 * literals. This is the same trick with a different list. `tokens.css` stays
 * the only place a colour is decided, and the design gate stays at zero
 * because not one hex, `rgb(`, `px` or `ms` is written here -- every value
 * below is either a token NAME or a bare number.
 *
 * WHAT IS IN THE LIST, and why nothing else is:
 *
 *   --dr-ink            the ship. The dock's own ink, not a hue.
 *   --dr-ink-muted      a rock clamped to the edge: the game's world, not a
 *                       distance claim.
 *   --dr-accent         the shots.
 *   --dr-owner-*        the rocks. The five owner classes wear the same five
 *                       hues here that they wear on the map, the layers panel
 *                       and the dock's nearby sheet.
 *   --dr-px-1 .. 6      the burst. The mark's own pixel vocabulary.
 *   --fwm-space-1       the unit -- a burst square, a shot, a stroke.
 *   --fwm-dur-fast      the shot cadence.
 *   --fwm-dur-alert     how long a burst square lives.
 *
 * NOT the exposure tier ramp, NOT the alert ramp. A toy wearing a reading's
 * colour is the thing `dock.css` warns about, and the rocks already say what
 * they are through the owner class.
 */

import { readTokens } from '../map/palette.ts';
import type { DockNearbyOwner } from '../dock/ExpandedPanel.tsx';
import { DEFAULT_BURST_S, DEFAULT_CADENCE_S } from './sim.ts';

export const ARCADE_TOKENS = [
  '--dr-ink',
  '--dr-ink-muted',
  '--dr-accent',
  '--dr-owner-flock',
  '--dr-owner-police',
  '--dr-owner-hoa',
  '--dr-owner-private',
  '--dr-owner-unverified',
  '--dr-px-1',
  '--dr-px-2',
  '--dr-px-3',
  '--dr-px-4',
  '--dr-px-5',
  '--dr-px-6',
  '--fwm-space-1',
  '--fwm-dur-fast',
  '--fwm-dur-alert',
] as const;

export type ArcadeToken = (typeof ARCADE_TOKENS)[number];

/** The six burst hues, indexed by `Particle.tone - 1`. */
export const BURST_TOKENS: readonly ArcadeToken[] = [
  '--dr-px-1',
  '--dr-px-2',
  '--dr-px-3',
  '--dr-px-4',
  '--dr-px-5',
  '--dr-px-6',
];

/** Which token paints a rock of each owner class. */
export const OWNER_TOKEN: Readonly<Record<DockNearbyOwner, ArcadeToken>> = {
  flock: '--dr-owner-flock',
  police: '--dr-owner-police',
  hoa: '--dr-owner-hoa',
  private: '--dr-owner-private',
  unverified: '--dr-owner-unverified',
};

/** What the owner class is called beside its colour. Colour never travels alone. */
export const OWNER_WORD: Readonly<Record<DockNearbyOwner, string>> = {
  flock: 'Flock',
  police: 'Police',
  hoa: 'HOA',
  private: 'Private',
  unverified: 'Unverified',
};

export interface ArcadePalette {
  readonly colours: Readonly<Record<ArcadeToken, string>>;
  /** `--fwm-space-1` in CSS pixels. Falls back to the token's own 4. */
  readonly unitPx: number;
  /** `--fwm-dur-fast` in seconds. */
  readonly cadenceS: number;
  /** `--fwm-dur-alert` in seconds. */
  readonly burstS: number;
}

/** The unit when there is no document: the same number `tokens.css` states. */
const DEFAULT_UNIT_PX = 4;

/** `4px` -> 4. Anything else -> the fallback. */
export function parseLengthPx(value: string, fallback: number): number {
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  if (match === null || match[1] === undefined) return fallback;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `160ms` -> 0.16, `.4s` -> 0.4. Anything else -> the fallback. */
export function parseDurationS(value: string, fallback: number): number {
  const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (match === null || match[1] === undefined) return fallback;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return fallback;
  return match[2] === 'ms' ? parsed / 1000 : parsed;
}

/** Resolve every token off `element` (or the document root), or fall back. */
export function readArcadePalette(element?: Element | null): ArcadePalette {
  const colours = readTokens(ARCADE_TOKENS, element);
  return {
    colours,
    unitPx: parseLengthPx(colours['--fwm-space-1'], DEFAULT_UNIT_PX),
    cadenceS: parseDurationS(colours['--fwm-dur-fast'], DEFAULT_CADENCE_S),
    burstS: parseDurationS(colours['--fwm-dur-alert'], DEFAULT_BURST_S),
  };
}
