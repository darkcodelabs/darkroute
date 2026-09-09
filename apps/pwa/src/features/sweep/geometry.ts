/**
 * SWEEP'S DIAL GEOMETRY. PURE, AND DELIBERATELY NOT A MAP.
 *
 * =============================================================================
 * THIS IS A POLAR DIAL, NOT A SLIPPY MAP
 * =============================================================================
 * `leaflet` and `react-leaflet` are in the lockfile and are imported by
 * nothing. SWEEP does not change that, on purpose:
 *
 *   "rings 100/300/500/1000ft ... ego marker 10px white, fixed center"
 *     -- Flockys Design System.dc.html, SWEEP PRIMITIVES
 *
 * The design draws four concentric distance rings, a rotating scan line, an ego
 * marker pinned at the centre and dots placed by DISTANCE AND BEARING. There is
 * no basemap, no north-up street grid, no tile in any of the four files. A tile
 * layer would also mean network requests keyed to the driver's position, which
 * is the one thing the product promises not to do. So the dial is an SVG whose
 * coordinate system is the dial itself.
 * See docs/gaps-inbox/sweep.md#sweep-is-not-a-map.
 *
 * =============================================================================
 * V2 REBUILT THE SCOPE, SO THE RING SCALE MOVED
 * =============================================================================
 * `Flockys App Screens v2.dc.html`, `02 · SWEEP` replaced v1's 311px bordered
 * dial and its three `inset:` rings with a 343px borderless SCOPE whose rings
 * are DOT LATTICES MASKED TO A RADIAL BAND:
 *
 *   mask: radial-gradient(circle at center, transparent A, #000 P, transparent B)
 *
 * with P = 10% / 21% / 34% / 48.5% for the four rings, innermost first. A CSS
 * `radial-gradient(circle at center, ...)` sizes itself `farthest-corner` by
 * default, so on a square box of side S, 100% is S x sqrt(1/2) -- the half
 * DIAGONAL, not the half side. {@link RING_MASK_PCT} and {@link MASK_REACH}
 * carry exactly that, which is what puts a drawn ring and a placed dot in the
 * same place. Getting this wrong is silent: the dots would sit on a scale
 * nobody drew.
 *
 * RADAR's v2 scope is built from the same construction at 18% / 32.5% / 47.5%,
 * so an outer ring at ~0.69 of the radius with a dark rim outside it is the v2
 * instrument look, not an artefact of this screen.
 * GAP: docs/gaps-inbox/sweep-v2.md#ring-scale-moved-with-the-v2-scope
 *
 * =============================================================================
 * THE USER SPACE IS THE DESIGN'S OWN PIXELS -- AT FULL WIDTH, AND ONLY THERE
 * =============================================================================
 * The SVG viewBox is {@link DIAL_UNITS} across, which is exactly the rendered
 * width `sweep.css` gives the scope (`--fwm-space-12 * 7.15` = 343.2px). One
 * user unit is one CSS pixel WHILE THE SCOPE RENDERS AT THAT WIDTH, and not
 * otherwise.
 *
 * It does not always. `sweep.css` sets `width: min(100%, 343.2px)` and
 * `app/surface.ts` resolves surfaces at 300px and 320px, so on a narrow phone
 * or a watch the body's 16px padding leaves less than 343px and the whole SVG
 * scales down. It scales UNIFORMLY, so every ratio the design draws survives --
 * but the CSS pixel a number stands for does not. `font-size:
 * var(--fwm-text-micro)` inside the SVG is 11 user units, which is 11px at full
 * width and less below it, and the tap target in {@link DOT_HIT_RADIUS} is 44
 * units across on exactly the same terms.
 *
 * What the 1:1 space does buy, unconditionally, is that every stroke width,
 * font size and radius in `sweep.css` stays a `var(--fwm-*)` token instead of
 * becoming a viewBox-relative number no checker can read, and that a token and
 * a measurement are in the same units when the two meet.
 * GAP: docs/gaps-inbox/sweep.md#dial-scales-below-full-width
 *
 * The numbers in THIS file are not visual values: they are the scope's
 * measurements, read off v2's `02 · SWEEP`, and each one is cited where it is
 * declared.
 *
 * =============================================================================
 * THE RING SCALE IS NOT LINEAR, AND THAT IS THE DESIGN'S CHOICE
 * =============================================================================
 * 100 / 300 / 500 / 1000 ft land at 10% / 21% / 34% / 48.5% of the mask reach,
 * which is nowhere near proportional -- the near rings are given far more of
 * the scope than a linear scale would allow, because the reading a driver needs
 * is "how close", and 100 ft has to be legible.
 * {@link radiusForDistanceFt} interpolates between the drawn rings rather than
 * inventing a formula, so a camera always lands where the design's own scale
 * puts it.
 */

import { SWEEP_RING_FT } from '../../stores/fwmCore.ts';

// ---------------------------------------------------------------------------
// The scope
// ---------------------------------------------------------------------------

/**
 * The scope's user space, in the design's pixels.
 *
 * v2's `02 · SWEEP` draws it `width:343px; height:343px` -- the full 375px
 * frame less the body's 16px padding on each side. `sweep.css` renders
 * `min(100%, calc(var(--fwm-space-12) * 7.15))` = up to 343.2px, the nearest
 * value derived from a token, and this viewBox matches that so 1 unit = 1px
 * wherever the scope gets its full width. See the header of this file.
 */
export const DIAL_UNITS = 343;

/** The ego marker's fixed position: the centre of the scope. */
export const DIAL_CENTRE = DIAL_UNITS / 2;

/**
 * What 100% means to the ring masks: the half diagonal of the square the scope
 * is drawn in, because `radial-gradient(circle at center, ...)` defaults to
 * `farthest-corner`. See the header of this file.
 */
export const MASK_REACH = DIAL_UNITS * Math.SQRT1_2;

/**
 * Where each ring's mask puts its opaque stop, innermost first. Read off v2's
 * `02 · SWEEP`: `#000 10%`, `#000 21%`, `#000 34%`, `#000 48.5%`. Paired below
 * with `SWEEP_RING_FT` (100/300/500/1000), the engine's copy of the same line.
 * `sweep.css` draws the same four numbers; they are the ONE pair of values that
 * has to agree across the two files, and `geometry.test.ts` reads the
 * stylesheet to check that it does.
 */
export const RING_MASK_PCT: readonly number[] = [0.1, 0.21, 0.34, 0.485];

export interface SweepRing {
  /** Feet this ring stands for. Straight from `SWEEP_RING_FT`. */
  readonly ft: number;
  /** Radius in scope units. */
  readonly radius: number;
}

/** Three decimals is well past sub-pixel at any surface this renders on. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The radius the ring at `index` is drawn at, in scope units. */
function ringRadius(index: number): number {
  return round(MASK_REACH * (RING_MASK_PCT[index] ?? 0));
}

/**
 * The range the design drew the scope at. 1000 ft, the outermost of its four
 * labelled rings, and the anchor the linear scale is defined against.
 */
const DESIGN_OUTER_FT: number = SWEEP_RING_FT.reduce((max, ft) => Math.max(max, ft), 0);

/**
 * The four drawn rings, nearest first, at the design's own range.
 *
 * Their DISTANCES are derived from their radii on the linear scale, not taken
 * from `SWEEP_RING_FT`. The design labelled them 100 / 300 / 500 / 1000 and
 * drew them at 20.6 / 43.3 / 70.1 / 100 % of the radius, which is only
 * consistent if the scale bends -- and a bending scale is what curved the roads
 * and distorted the spacing between cameras.
 *
 * The rings stay exactly where they are drawn. What they stand for follows from
 * the projection, so the two can never disagree.
 */
export const SWEEP_RINGS: readonly SweepRing[] = RING_MASK_PCT.map((_, index) => ({
  ft: (DESIGN_OUTER_FT * ringRadius(index)) / round(MASK_REACH * (RING_MASK_PCT.at(-1) ?? 0)),
  radius: ringRadius(index),
}));

/** Beyond this the scope does not draw at the drawn range. 1000 ft. */
export const SWEEP_MAX_FT: number = DESIGN_OUTER_FT;

/**
 * The four rings at any range, nearest first.
 *
 * The RADII never move -- they are the design's mask stops -- and only what
 * each ring STANDS FOR changes. Passing the drawn outer ring returns
 * {@link SWEEP_RINGS} exactly, which is asserted by a test rather than assumed:
 * the zoom feature is only safe to add if the default level is provably
 * unchanged by it.
 *
 * See `./zoom.ts` for why the ratios and not the spacing are what scale.
 */
export function ringsForOuterFt(outerFt: number): readonly SweepRing[] {
  // Each drawn ring stands for the distance its RADIUS represents on a linear
  // scale. The rings are where the design drew them; what they MEAN follows
  // from the projection rather than from a separate table, so the two can never
  // disagree about where 500 ft is.
  return RING_MASK_PCT.map((_, index) => ({
    ft: (outerFt * ringRadius(index)) / OUTER_RADIUS,
    radius: ringRadius(index),
  }));
}

/**
 * The scale's full-scale deflection, in dial units.
 *
 * THE HALF-WIDTH OF THE CANVAS, not the outermost drawn ring.
 *
 * It was the ring -- 34.3 % of the box -- because the scale existed to line up
 * with a drawn gauge. With the radar graphic gone there is no gauge to line up
 * with, and that number became pure waste: a camera at the full range landed a
 * third of the way out, so the map used the middle third of its canvas and left
 * a wide empty margin on every side. That margin is the dead space above and
 * below the map on screen.
 *
 * At the half-width, the full range reaches the edge of the frame and the map
 * fills the space it is given. The corners reach slightly further, which is
 * correct: a square frame does show more along its diagonal, exactly as a
 * rectangular map does.
 */
export const OUTER_RADIUS: number = DIAL_CENTRE;

/**
 * Where a distance sits on the drawn scale, or `null` when it is off the scope.
 *
 * =============================================================================
 * LINEAR. THIS IS A MAP, NOT A GAUGE.
 * =============================================================================
 * It was piecewise-linear between the four drawn rings, which are NOT evenly
 * spaced - so the mapping from distance to radius was not proportional. The
 * numbers, measured off the drawn ring positions:
 *
 *     10 % of the range was drawn at 20.6 % of the radius
 *     30 %                          43.3 %
 *     50 %                          70.1 %
 *
 * Half the distance span was crammed into the outer 30 % of the scope. Three
 * consequences, all of which shipped:
 *
 *   A STRAIGHT ROAD BENDS. Every vertex on a road is projected independently,
 *   so a road running away from the vehicle curves on screen. Roads are the one
 *   thing on this scope whose real shape a driver already knows.
 *
 *   SPACING LIES. Two cameras a block apart near the rim are drawn closer
 *   together than two cameras a block apart near the centre, so the clustering
 *   that decides what merges is operating on distorted positions.
 *
 *   ZOOM MAKES IT WORSE. Zooming in does not simply magnify - it moves
 *   everything along a curve, so the picture reorganises rather than scaling,
 *   and detail near the vehicle collapses instead of opening up.
 *
 * A map is proportional. Distance times a constant is the radius, the rings are
 * whatever distances their radii work out to, and zooming is a scale factor.
 *
 * Still never extrapolates: a camera past the outer ring is not drawn at the
 * rim, because a dot on the rim would claim a distance it does not have.
 */
export function radiusForDistanceFt(
  distanceFt: number,
  outerFt: number = SWEEP_MAX_FT,
): number | null {
  if (!Number.isFinite(distanceFt) || distanceFt < 0) return null;
  if (!Number.isFinite(outerFt) || outerFt <= 0) return null;
  if (distanceFt > outerFt) return null;
  return round((distanceFt / outerFt) * OUTER_RADIUS);
}

/**
 * The same scale, with the range cut split off from it.
 *
 * =============================================================================
 * WHY THE CUT HAD TO LEAVE THIS FUNCTION
 * =============================================================================
 * `radiusForDistanceFt` does two jobs: it converts feet to dial units, and it
 * decides what is too far to draw. Fusing them was fine while the viewport sat
 * on the vehicle, because then "outside the range" and "off the screen" were
 * the same sentence.
 *
 * Panning made them different sentences, and fusing them produced a bug you
 * could see from across the room: the drawn data ended at a fixed distance FROM
 * THE VEHICLE, so dragging the map slid a CIRCULAR EDGE across the viewport and
 * everything past it vanished. Measured, with the scope at 25 mi: pan one
 * range-width and 40 % of the frame still had data in it; pan two and it was
 * ZERO. A map bounded by an arc that moves when you drag is the exact look of a
 * globe, which is what it was reported as, and it is why zooming toward a
 * camera made the camera disappear.
 *
 * So: this converts, and nothing else. It extrapolates past the outer ring on
 * purpose -- a camera four ranges away has a real position and the caller may
 * well be looking straight at it. Deciding what is too far is now the CALLER's,
 * because only the caller knows where the viewport is. See `reachFt` in
 * `pan.ts`, which answers it from the pan.
 *
 * `radiusForDistanceFt` is unchanged and still right for the ring scale, which
 * genuinely does stop at the outer ring.
 */
export function scopeRadiusFt(distanceFt: number, outerFt: number): number | null {
  if (!Number.isFinite(distanceFt) || distanceFt < 0) return null;
  if (!Number.isFinite(outerFt) || outerFt <= 0) return null;
  return round((distanceFt / outerFt) * OUTER_RADIUS);
}

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

/**
 * Where a bearing points on the scope, in degrees clockwise from straight up.
 *
 * HEADING-UP WHENEVER THERE IS A HEADING. The ego marker is an arrow pointing
 * up the screen -- it is the vehicle, not a compass rose -- so straight up is
 * where the vehicle is going and a dot at the top is a camera ahead. That is
 * the same frame RADAR's `AHEAD · SLIGHT LEFT` is written in, and having the
 * two screens disagree about which way "up" is would be worse than either
 * choice on its own. v2's `HDG 041°` telemetry names the heading the scope is
 * turned to, so the frame is now stated on screen as well.
 *
 * With no heading there is no relative frame, so the scope falls back to
 * north-up and {@link SweepDot.bearingKnown}'s caller says so.
 * GAP: docs/gaps-inbox/sweep.md#dial-orientation-unstated
 */
export function screenAngleDeg(bearingDeg: number, headingDeg: number | null): number {
  const relative = headingDeg === null ? bearingDeg : bearingDeg - headingDeg;
  return ((relative % 360) + 360) % 360;
}

export interface DialPoint {
  readonly cx: number;
  readonly cy: number;
}

/** Polar to the SVG's coordinates. 0 deg is up, angles run clockwise. */
export function dialPoint(radius: number, angleDeg: number): DialPoint {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    cx: round(DIAL_CENTRE + radius * Math.sin(radians)),
    cy: round(DIAL_CENTRE - radius * Math.cos(radians)),
  };
}

// ---------------------------------------------------------------------------
// Marker furniture
// ---------------------------------------------------------------------------

/**
 * The flocky ghost's drawn circle. v2 draws it `width:11px; height:11px` with
 * a dashed edge and no fill; v1 drew the same 11px as a solid dot. The size is
 * the one thing both agree on.
 */
export const DOT_RADIUS = 5.5;

/**
 * The in-range camera's RETICLE: four corner brackets on a 34x34 box.
 *
 * v2 replaced v1's `box-shadow:0 0 12px` halo with `width:34px; height:34px`
 * holding four `9px` L-shaped corners at `1.5px`. It is a direct disagreement
 * about the same element -- the alert treatment on an in-range camera -- so v2
 * wins and the halo is gone.
 * GAP: docs/gaps-inbox/sweep-v2.md#in-range-glow-replaced-by-a-reticle
 */
export const RETICLE_HALF = 17;
export const RETICLE_ARM = 9;

/**
 * The known camera's ring. v2 draws a 20x20 box with `border:1px ... ;
 * border-radius:999px` around a 7px dot, so the ring's radius is 10.
 */
export const KNOWN_RING_RADIUS = 10;

/**
 * The ring around the ego marker. v2: `width:44px; height:44px; margin:-22px`,
 * a 1px circle in `rgba(247,249,252,.18)` -- `--fwm-tint-text`. It is drawn at
 * the same 44 units as {@link DOT_HIT_RADIUS}'s diameter, which is a
 * coincidence of the design and not a derivation: this one is decoration and
 * takes no taps.
 */
export const EGO_RING_RADIUS = 22;

/** "facing arc: 60 deg stroke 3px, hue of dot" -- SWEEP PRIMITIVES. */
export const FACING_ARC_SPAN_DEG = 60;

/**
 * The facing arc's radius around its marker.
 *
 * v1's `02 · SWEEP` drew a 29px ring with a 3px stroke around an 11px dot, so
 * the stroke's centre line sat 13px from the dot's centre. v2 draws no facing
 * arc at all -- but it draws no substitute for it either, and the arc is the
 * only thing on this screen that says which way a lens points. It is kept at
 * v1's radius, which sits comfortably inside v2's 34-unit reticle box.
 * GAP: docs/gaps-inbox/sweep-v2.md#facing-arc-not-redrawn-in-v2
 */
export const FACING_ARC_RADIUS = 13;

/**
 * The invisible tap target under each marker, at full scope width and with
 * room.
 *
 * An 11px dot is a quarter of the product's own 44px touch floor, and this
 * screen is used in a car mount, so the target is `--fwm-touch-min` across:
 * radius 22 of the scope's 343 units. Two caveats, both real:
 *
 *   - 22 units is 44 CSS px only while the scope renders full width. See the
 *     header of this file.
 *   - 44px is the PHONE floor. `tokens.css` redefines `--fwm-touch-min` to 48px
 *     on `watch-round` and 68px on `dash-cast`, and a user unit cannot read a
 *     CSS variable, so on those surfaces the target is below their own floor.
 *
 * `geometry.test.ts` pins this constant to the base token so the two cannot
 * drift apart unnoticed. It is the CEILING, not the answer:
 * {@link hitRadiusForDot} clamps it whenever another dot is closer than that.
 * GAP: docs/gaps-inbox/sweep.md#hit-radius-mirrors-touch-min
 */
export const DOT_HIT_RADIUS = 22;

/**
 * One marker's tap target, given every marker on the scope.
 *
 * TWO CAMERAS CLOSE TOGETHER MUST NOT SWAP TAPS. The hit circle is invisible
 * and still hit-testable, it is 4x the width of the dot it sits under, and SVG
 * has no z-index -- the last group in document order is on top. The engine
 * hands its cameras over nearest first, so an unclamped target would put the
 * FARTHER camera's invisible circle over the nearer camera's visible marker.
 *
 * So a target never reaches past the halfway line to another marker. Every
 * point inside a hit circle is then closer to its own marker than to any other,
 * and the tap resolves to the marker the driver aimed at whatever the paint
 * order is. Inside that halfway line the two overlap visually anyway, and the
 * marker's own face still takes the tap through its group -- so there, what is
 * on top is what is tapped, which is the only honest answer available.
 *
 * Ghosts count here even though they are not tappable: the rule is that a tap
 * never resolves to anything but the nearest marker to the finger, and a ghost
 * that swallows a tap meant for nothing is better than a camera that claims a
 * tap aimed at a ghost.
 */
export function hitRadiusForDot(dot: DialPoint, all: readonly DialPoint[]): number {
  let radius = DOT_HIT_RADIUS;
  for (const other of all) {
    const gap = Math.hypot(other.cx - dot.cx, other.cy - dot.cy);
    // 0 is the dot itself -- or a second dot the engine did not deduplicate,
    // and there is no halfway line between a point and itself.
    if (gap === 0) continue;
    radius = Math.min(radius, gap / 2);
  }
  // Rounded DOWN, not to nearest: rounding a target up -- even by a thousandth
  // of a unit -- puts it back over the halfway line this whole function exists
  // to respect, and `geometry.test.ts` asserts the two targets never overlap.
  return Math.floor(radius * 1000) / 1000;
}

/**
 * The reticle around an in-range camera, as one SVG path with four subpaths.
 *
 * v2 draws four 9x9 corners on a 34x34 box, each keeping only the two edges
 * that meet at its corner of the box. One path rather than four elements
 * because the four are one mark: they share a stroke, a hue and an opacity, and
 * nothing ever addresses a single corner.
 */
export function reticlePath(dot: DialPoint): string {
  const left = round(dot.cx - RETICLE_HALF);
  const right = round(dot.cx + RETICLE_HALF);
  const top = round(dot.cy - RETICLE_HALF);
  const bottom = round(dot.cy + RETICLE_HALF);
  const inLeft = round(left + RETICLE_ARM);
  const inRight = round(right - RETICLE_ARM);
  const inTop = round(top + RETICLE_ARM);
  const inBottom = round(bottom - RETICLE_ARM);
  // Assembled by joining an array rather than by interpolation, for the same
  // reason `facingArcPath` does: a path is a sequence of commands and numbers,
  // and writing it that way keeps every number a value rather than a fragment
  // of a string.
  const corners: readonly (readonly (string | number)[])[] = [
    ['M', inLeft, top, 'L', left, top, 'L', left, inTop],
    ['M', inRight, top, 'L', right, top, 'L', right, inTop],
    ['M', right, inBottom, 'L', right, bottom, 'L', inRight, bottom],
    ['M', left, inBottom, 'L', left, bottom, 'L', inLeft, bottom],
  ];
  return corners.map((corner) => corner.join(' ')).join(' ');
}

/**
 * The callout beside an in-range camera: `FWM-0442` over `425FT`.
 *
 * v2 hangs it off the reticle box at `right:38px; top:8px` on the marker left
 * of centre and `left:38px; top:8px` on the marker right of it -- i.e. OUTWARD,
 * away from the middle of the scope, so a label never runs across the ego
 * marker. 38 from the far edge of a 34-wide box centred on the dot is 21 units
 * from the dot itself, and `top:8px` inside that box is 9 units above it.
 */
export const CALLOUT_DX = 21;
export const CALLOUT_DY = 9;
/** The drawn label is two 8px lines; the second sits a line box below. */
export const CALLOUT_LINE = 10;

export interface Callout {
  readonly x: number;
  readonly y: number;
  /** `start` when the label hangs to the right of its marker, `end` to the left. */
  readonly anchor: 'start' | 'end';
}

export function calloutFor(dot: DialPoint): Callout {
  const outward = dot.cx >= DIAL_CENTRE;
  return {
    x: round(outward ? dot.cx + CALLOUT_DX : dot.cx - CALLOUT_DX),
    y: round(dot.cy - CALLOUT_DY),
    anchor: outward ? 'start' : 'end',
  };
}

/**
 * The ego marker, as v2's `02 · SWEEP` draws it: an 18px-wide, 20px-tall
 * triangle pointing up, offset `margin:-11px 0 0 -9px`. The offset is not
 * symmetric -- the apex sits 11 above the centre and the base 9 below -- which
 * puts the triangle's visual weight, not its bounding box, on the middle of the
 * scope. v1 drew 16x18 at `-9px 0 0 -8px`.
 *
 * SWEEP PRIMITIVES describes a 10px white dot instead. The rendered screen
 * wins, and the arrow is also the only one of the two that says which way the
 * vehicle is pointing -- which is the whole basis of a heading-up scope.
 * GAP: docs/gaps-inbox/sweep.md#ego-marker-arrow-vs-dot
 */
const EGO_HALF_WIDTH = 9;
const EGO_APEX_RISE = 11;
const EGO_BASE_DROP = 9;

/**
 * How far the tail notches back up toward the apex.
 *
 * This is what turns a triangle into a NAVIGATION ARROW. A plain triangle is a
 * shape; the notch is the convention every mapping product uses for "this is
 * you and this is the way you are pointing", and it reads as direction at a
 * size where a triangle reads as a blob.
 *
 * Two thirds of the drop: deep enough to be unmistakable, shallow enough that
 * the two tail points stay far enough apart to render cleanly at 343 units.
 */
const EGO_NOTCH_RISE = EGO_BASE_DROP * 0.66;

export const EGO_MARKER_POINTS: string = [
  [DIAL_CENTRE, DIAL_CENTRE - EGO_APEX_RISE],
  [DIAL_CENTRE + EGO_HALF_WIDTH, DIAL_CENTRE + EGO_BASE_DROP],
  [DIAL_CENTRE, DIAL_CENTRE + EGO_BASE_DROP - EGO_NOTCH_RISE],
  [DIAL_CENTRE - EGO_HALF_WIDTH, DIAL_CENTRE + EGO_BASE_DROP],
]
  .map((pair) => pair.map((n) => Math.round(n * 10) / 10).join(','))
  .join(' ');

/**
 * How far below its ring a scale label sits.
 *
 * v1 put the `1000` label 8px under a ring at `inset:0` and kept the same 8px
 * offset on the other three; 7 more carries the baseline of a ~9px glyph. v2
 * moved the four labels to `top:6/46/92/132` on the scope's vertical axis,
 * which lines up with NONE of its own four mask rings -- the labels and the
 * rings were placed separately in the mock. A scale label that is not on its
 * scale line is not a scale, so the v1 relationship is kept and the label rides
 * its ring wherever the ring is.
 * GAP: docs/gaps-inbox/sweep-v2.md#v2-ring-labels-do-not-sit-on-v2-rings
 */
const RING_LABEL_DROP = 15;

/** The y coordinate of a ring's scale label, on the vertical axis. */
export function ringLabelY(radius: number): number {
  return round(DIAL_CENTRE - radius + RING_LABEL_DROP);
}

/**
 * The same relationship, mirrored below the centre.
 *
 * THE THRESHOLD LABEL USES THIS, AND HAS TO.
 *   `THRESHOLD 500 FT` describes a ring, so it rides that ring the way a scale
 *   number does. But the threshold is USUALLY ONE OF THE FOUR SCALE RINGS -
 *   500 ft is both the default threshold and a drawn ring - and both labels
 *   placed by {@link ringLabelY} land on identical coordinates, at
 *   `text-anchor: middle` on the same axis. Rendered, that is literally
 *   `THRESHO[500]D 500 FT`: two live labels stacked into an unreadable smear.
 *
 *   Measured on the live build before this existed: the threshold label at
 *   x130..263 y361..375, the `500` scale label at x185..209 y361..375. Total
 *   overlap.
 *
 *   Mirroring puts the scale numbers above the centre and the threshold below
 *   it. Both still sit on their own line, they can never collide at any zoom,
 *   and the two kinds of label become distinguishable by position alone.
 */
export function ringLabelYBelow(radius: number): number {
  // Pushed clear of the vehicle marker.
  //
  // At a short threshold on a wide range -- 300 ft shown on a 1 mile scope --
  // the threshold ring is only a few units across, so its label landed inside
  // the 22-unit ego ring, printed straight through the white arrow. The label
  // is about a ring, so it rides that ring wherever it can; where the ring is
  // smaller than the vehicle it sits just outside the vehicle instead, which
  // is the nearest place it can be read at all.
  const clear = EGO_RING_RADIUS + RING_LABEL_DROP;
  return round(DIAL_CENTRE + Math.max(radius, clear));
}

/**
 * The 60 deg facing arc around a marker, as an SVG path.
 *
 * `facingScreenDeg` is the direction the lens points, already rotated into the
 * scope's frame by {@link screenAngleDeg}. The arc is centred on it, so the
 * bright side of the marker is the side the camera is looking at.
 */
export function facingArcPath(dot: DialPoint, facingScreenDeg: number): string {
  const half = FACING_ARC_SPAN_DEG / 2;
  const from = arcPoint(dot, facingScreenDeg - half);
  const to = arcPoint(dot, facingScreenDeg + half);
  // large-arc-flag 0: 60 deg is well under a half turn.
  // sweep-flag 1: angles increase clockwise in this coordinate system.
  const parts: readonly (string | number)[] = [
    'M',
    from.cx,
    from.cy,
    'A',
    FACING_ARC_RADIUS,
    FACING_ARC_RADIUS,
    0,
    0,
    1,
    to.cx,
    to.cy,
  ];
  return parts.join(' ');
}

function arcPoint(dot: DialPoint, angleDeg: number): DialPoint {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    cx: round(dot.cx + FACING_ARC_RADIUS * Math.sin(radians)),
    cy: round(dot.cy - FACING_ARC_RADIUS * Math.cos(radians)),
  };
}

// ---------------------------------------------------------------------------
// What the frame actually shows
// ---------------------------------------------------------------------------

/**
 * How far the visible rectangle reaches from its own centre, in dial units.
 *
 * =============================================================================
 * WHY THIS IS NOT JUST OUTER_RADIUS
 * =============================================================================
 * The dial is a SQUARE viewBox rendered with `preserveAspectRatio="slice"`,
 * which scales it to COVER the frame. On a portrait phone that means the height
 * is what fills -- the full `DIAL_UNITS` of world top to bottom -- while the
 * width shows LESS than the square holds, because the sides are cropped off.
 *
 * Anything that needs to know "is this on screen" has to ask in those terms.
 * Asking in terms of distance from the vehicle instead gives a disc, and a disc
 * is what produced markers that stopped at a circle in the middle of a
 * rectangular map while the coverage field carried on to the edges.
 *
 * The margin is deliberate: a marker culled exactly at the boundary pops into
 * existence as the driver drags, which reads as the map loading badly rather
 * than as a marker arriving.
 */
export const FRAME_CULL_MARGIN = 1.15;

export interface FrameSize {
  readonly w: number;
  readonly h: number;
}

export function frameHalfSpan(
  frame: FrameSize,
  _outerFt: number,
): { readonly x: number; readonly y: number } {
  // Before the first measurement, assume the whole square is visible. Culling
  // to a frame of zero would draw nothing at all on the first paint.
  if (!Number.isFinite(frame.w) || !Number.isFinite(frame.h) || frame.w <= 0 || frame.h <= 0) {
    return { x: DIAL_UNITS, y: DIAL_UNITS };
  }
  // `slice` scales by the LARGER ratio, so the larger screen edge maps to the
  // full viewBox and the smaller one maps to a fraction of it.
  const longest = Math.max(frame.w, frame.h);
  const halfX = (DIAL_UNITS * (frame.w / longest)) / 2;
  const halfY = (DIAL_UNITS * (frame.h / longest)) / 2;
  return { x: halfX * FRAME_CULL_MARGIN, y: halfY * FRAME_CULL_MARGIN };
}
