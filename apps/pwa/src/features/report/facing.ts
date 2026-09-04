/**
 * THE FACING DIAL'S GEOMETRY. PURE, AND IN THE DESIGN'S OWN PIXELS.
 *
 * SOURCE: `Flockys App Screens v2.dc.html`, `06 · REPORT - SHEET FROM THE DOCK
 * KEY` (v1 titled the same panel `SHEET FROM ANY SCREEN`; the geometry below is
 * identical in both - v2 changed the disc's paint, not its size):
 * a 120px circle with a 1px edge, a `conic-gradient(from 200deg, … 0 60deg)`
 * wedge, an 8px centre dot and four 9px cardinals inset 6px from the edge.
 *
 * =============================================================================
 * AN SVG, BECAUSE A CONIC GRADIENT CANNOT BE TAPPED AND CANNOT BE TOKENISED
 * =============================================================================
 * The design paints the wedge with `conic-gradient(rgba(255,45,94,.35) …)`.
 * That is a raw colour function, it cannot carry a `var(--fwm-*)` hue through a
 * mode swap without one, and a painted gradient has no element to attach a tap
 * to. The wedge is therefore a path: its ANGLE lives here as geometry, its HUE
 * lives in `report.css` as a token, and the whole dial is one control the
 * driver can point at - which is what `TAP ARC TO ADJUST` asks for.
 *
 * The viewBox is {@link DIAL_UNITS} across, exactly the width `report.css`
 * gives the dial, so one user unit is one CSS pixel and every stroke width and
 * type size stays a token in the stylesheet instead of becoming a viewBox
 * fraction nobody can check. Same construction as `features/sweep/geometry.ts`.
 *
 * The numbers below are measurements read off the panel, not visual values.
 */

import { normaliseDegrees } from './reportDraft.ts';

// ---------------------------------------------------------------------------
// The dial
// ---------------------------------------------------------------------------

/** `width:120px; height:120px` on the panel. */
export const DIAL_UNITS = 120;

export const DIAL_CENTRE = DIAL_UNITS / 2;

/** The edge ring, drawn inside the box so its 1px stroke is not clipped. */
export const RING_RADIUS = DIAL_CENTRE - 0.5;

/** The wedge fills the disc, as the conic gradient does (`inset:0`). */
export const WEDGE_RADIUS = DIAL_CENTRE - 1;

/** `conic-gradient(from 200deg, … 0 60deg)` - a 60 degree wedge. */
export const ARC_SPAN_DEG = 60;

/** The 8px white dot at the centre. */
export const CENTRE_DOT_RADIUS = 4;

/**
 * How far the `N` / `E` / `S` / `W` glyph centres sit inside the ring.
 * The panel insets them 6px and sets them 9px; they render here at the 11px
 * micro floor (DESIGN-GAPS.md#micro-type-below-stated-floor), so the centre
 * line moves in to 11 to keep the taller glyph clear of the edge.
 */
const CARDINAL_INSET = 11;

export interface DialPoint {
  readonly x: number;
  readonly y: number;
}

export interface DialCardinal {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

/** North up, clockwise - the order the panel draws them in. */
export const DIAL_CARDINALS: readonly DialCardinal[] = [
  { label: 'N', x: DIAL_CENTRE, y: CARDINAL_INSET },
  { label: 'E', x: DIAL_UNITS - CARDINAL_INSET, y: DIAL_CENTRE },
  { label: 'S', x: DIAL_CENTRE, y: DIAL_UNITS - CARDINAL_INSET },
  { label: 'W', x: CARDINAL_INSET, y: DIAL_CENTRE },
];

/** Three decimals is well past sub-pixel on any surface this renders on. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Polar to the SVG's coordinates. 0 deg is up (north), angles run clockwise. */
export function dialPoint(radius: number, angleDeg: number): DialPoint {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: round(DIAL_CENTRE + radius * Math.sin(radians)),
    y: round(DIAL_CENTRE - radius * Math.cos(radians)),
  };
}

/**
 * The wedge, centred on the bearing the lens points along.
 *
 * The panel's gradient starts at 200deg and runs 60deg, which centres it on
 * 230deg beside a readout of 223deg. Centring the wedge ON the bearing is the
 * only reading under which the arc and the number can never disagree.
 * GAP: see docs/gaps-inbox/report.md#wedge-start-angle-vs-readout
 */
export function facingWedgePath(facingDeg: number): string {
  const half = ARC_SPAN_DEG / 2;
  const from = dialPoint(WEDGE_RADIUS, facingDeg - half);
  const to = dialPoint(WEDGE_RADIUS, facingDeg + half);
  // large-arc-flag 0: 60 deg is well under a half turn.
  // sweep-flag 1: angles increase clockwise in this coordinate system.
  const parts: readonly (string | number)[] = [
    'M',
    DIAL_CENTRE,
    DIAL_CENTRE,
    'L',
    from.x,
    from.y,
    'A',
    WEDGE_RADIUS,
    WEDGE_RADIUS,
    0,
    0,
    1,
    to.x,
    to.y,
    'Z',
  ];
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Tap to adjust
// ---------------------------------------------------------------------------

/** The part of a `DOMRect` this module needs, named so a test can supply it. */
export interface DialRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Which bearing a tap at (clientX, clientY) points at, or null.
 *
 * Null when the element has no measured size (nothing has laid out yet) or the
 * tap landed exactly on the centre, where there is no direction to read. A
 * control that answers a question it was not asked is worse than one that
 * declines: an unreadable tap leaves the bearing exactly as it was.
 */
export function bearingFromPoint(rect: DialRect, clientX: number, clientY: number): number | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (dx === 0 && dy === 0) return null;
  // atan2(east, north): 0 is up, and the angle grows clockwise, matching a
  // compass bearing and `dialPoint` above.
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const wrapped = degrees % 360;
  return round(wrapped < 0 ? wrapped + 360 : wrapped);
}

/**
 * Keyboard steps for the arc.
 *
 * The design says `TAP ARC TO ADJUST` and nothing more, because it is drawing a
 * phone. A control reachable only by touch is unreachable to anyone driving it
 * from a keyboard or a switch, so the arc is an ARIA slider as well as a tap
 * target - the same accommodation `SweepDial` makes for its dots.
 * GAP: see docs/gaps-inbox/report.md#arc-adjust-is-touch-only-in-the-design
 */
export const FACING_STEP_DEG = 1;
export const FACING_COARSE_STEP_DEG = 15;

/**
 * The bounds the slider declares.
 *
 * A bearing is an angle on a circle, so 360 IS 0 and the range is half-open:
 * [0, 360). The largest value a bearing can report is therefore 359, and
 * {@link facingAriaValue} wraps a rounded 359.7 back to 0 rather than letting
 * it announce 360 and sit above the declared maximum.
 */
export const FACING_MIN_DEG = 0;
export const FACING_MAX_DEG = 359;

/**
 * The whole-degree bearing the slider reports and the screen reader reads.
 *
 * One function so `aria-valuenow` and `aria-valuetext` can never name two
 * different numbers, and so neither of them can exceed {@link FACING_MAX_DEG}.
 * The same normalise-after-round that `radar/format.ts` does for its heading
 * caption.
 */
export function facingAriaValue(facingDeg: number): number {
  return Math.round(normaliseDegrees(facingDeg)) % 360;
}
