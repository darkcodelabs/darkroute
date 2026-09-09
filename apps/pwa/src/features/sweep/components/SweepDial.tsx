/**
 * THE SCOPE: a dot lattice, four masked rings, a rotating scan line, the ego
 * marker and its ring, the camera markers, and the telemetry corners.
 *
 * SOURCE: `Flockys App Screens v2.dc.html`, `02 · SWEEP`; `DarkRoute Design
 * System.dc.html`, SWEEP PRIMITIVES.
 *
 * =============================================================================
 * WHAT V2 CHANGED, AND WHY THE FILE IS SPLIT THE WAY IT IS
 * =============================================================================
 * v2 replaced v1's 311px bordered dial and its three 1px inner circles with a
 * 343px borderless SCOPE built entirely out of masked layers -- a grey 5px dot
 * lattice under a vignette, four scan-cyan dot rings, two conic tick combs, two
 * crosshairs. Every one of those is a background under a mask, which CSS does
 * and SVG does not, so they are `<div>`s in `sweep.css`, exactly as RADAR's v2
 * scope does it.
 *
 * Everything with a MEASURED position stays in the SVG: the ring labels, the
 * ego marker, and every camera marker. The viewBox is v2's own 343 pixels, so
 * `stroke-width: var(--fwm-space-1)` in the stylesheet means what it says at
 * full width and the same fraction of it on a narrower surface -- the SVG
 * scales as one piece. See the header of `geometry.ts`.
 *
 * The repo forbids inline styles, which is the only way a stack of absolutely
 * positioned `<div>`s could carry a per-camera position; an SVG puts every
 * measured value in a geometry ATTRIBUTE, where it belongs, and leaves every
 * visual value -- stroke widths, hues, type size, the hit radius -- in
 * `sweep.css` as a `var(--fwm-*)` token.
 *
 * =============================================================================
 * THE THREE MARKERS V2 DRAWS
 * =============================================================================
 *   in range   a 34x34 RETICLE: four 9px corner brackets around the face
 *   known      a 20x20 ring at 35% around the face
 *   flocky     an 11px DASHED circle at 65%, no fill
 *
 * v1's `box-shadow:0 0 12px` halo on the in-range dot is gone: v2 draws a
 * different treatment on the same element, so v2 wins.
 * GAP: docs/gaps-inbox/sweep-v2.md#in-range-glow-replaced-by-a-reticle
 *
 * The current product no longer draws those reticles and rings. It uses one
 * plasma-weighted circular contact per camera; the marker comment below records
 * why the earlier emoji glyph and its surrounding furniture were removed.
 *
 * =============================================================================
 * WHAT A MARKER IS ALLOWED TO SAY
 * =============================================================================
 * A camera marker is a button: it carries the camera id, it is announced with
 * its distance, and tapping it opens the INTEL CARD. A ghost is not: presence
 * publishes a distance and never a direction, so a ghost's angle is
 * presentational, it is not tappable, and its label says "nearby" and no more.
 *
 * An in-range camera also gets v2's CALLOUT -- `FWM-0442` over `425FT`, hung
 * outward from the reticle. Only the in-range ones: v2 labels its two crimson
 * markers and neither of its amber ones, and labelling everything would fill
 * the scope with type at exactly the moment a driver has least attention.
 *
 * A muted camera is drawn exactly like any other camera, in grey. It keeps its
 * face, its arc, its tap target and its place in the tally. A muted camera
 * whose mute the engine PIERCED is not that camera: it resolves back to
 * `in_range`, and it is drawn as an in-range marker, reticle included. The
 * treatment follows the resolved hue, never the mute switch -- see
 * {@link DotMark}.
 *
 * =============================================================================
 * A TAP GOES TO THE MARKER IT WAS AIMED AT
 * =============================================================================
 * The tap target is bigger than the marker and invisible, and SVG has no
 * z-index, so an unclamped target belonging to a far camera would sit on top of
 * a near camera's face. {@link hitRadiusForDot} is given every marker's
 * position and shrinks each target to the halfway line, so no marker can take a
 * tap that landed nearer another one.
 *
 * =============================================================================
 * PINCH -- NOT IN ANY DESIGN FILE, AND NOT DELETED BY V2 EITHER
 * =============================================================================
 * The scope's outer ring is a continuous number and a two-finger pinch moves
 * it; the arithmetic is in `../pinch.ts`, which is pure, and this file only
 * tracks pointers and calls in. v2 redrew what the scope LOOKS like and says
 * nothing about the gesture, so the gesture stands. The two coexist cleanly
 * because they touch different things: v2 owns the layers and the markers,
 * the pinch owns what the ring LABELS say, and the ring RADII -- which are
 * v2's mask stops -- never move for either.
 */

import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react';

import { NO_VALUE, distanceUnit, formatDistanceValue } from '../../radar';
import {
  CALLOUT_LINE,
  DIAL_CENTRE,
  DIAL_UNITS,
  frameHalfSpan,
  OUTER_RADIUS,
  DOT_RADIUS,
  EGO_MARKER_POINTS,
  EGO_RING_RADIUS,
  RING_MASK_PCT,
  ringsForOuterFt,
  radiusForDistanceFt,
  calloutFor,
  dialPoint,
  hitRadiusForDot,
  ringLabelY,
} from '../geometry.ts';
import type { DialPoint } from '../geometry.ts';
import type { SweepDot } from '../sweepState.ts';
import type { RadarState } from '../../radar/radarState.ts';
import { DEFAULT_SWEEP_ZOOM, RING_RATIOS, clampOuterFt, ringLabelFor } from '../zoom.ts';
import { pinchLimit, pinchOuterFt, spread } from '../pinch.ts';
import { NO_PAN, PAN_START_PX, isPanned, panForZoom, panFromDrag } from '../pan.ts';
import { HEAT_ORIGIN_UNITS, HEAT_SPAN_UNITS, HeatLayer } from './HeatLayer.tsx';

/**
 * How many cameras get their own tappable marker, nearest first.
 *
 * Not a rendering budget picked from nowhere: past a few hundred markers the
 * dots are closer together than a fingertip, so the extra ones are not
 * targets, they are just cost. The field draws the rest.
 */
export const DOT_LIMIT = 320;

/**
 * How many go into the coverage field.
 *
 * Much higher than the marker cap, because a canvas blob costs a fraction of
 * an SVG group with a hit circle and an ARIA label -- and density is exactly
 * the thing that needs the long tail to be right.
 *
 * RAISED FROM 900. Points are taken NEAREST FIRST, so a cap below the number of
 * cameras in range does not thin the picture evenly -- it clips it to a DISC
 * around the vehicle. At the widest range with 1,937 cameras in reach, the
 * field was the nearest 900 of them, which is a circle centred on the car no
 * matter how the cameras are really laid out. That is the other half of "this
 * doesn't seem data driven": the shape on screen was the shape of the cap.
 */
export const HEAT_LIMIT = 4_000;

import type { PanOffset } from '../pan.ts';
import type { PinchAnchor } from '../pinch.ts';

/** How many steps a contact's sweep phase is quantised to. See the marker. */
export const SWEEP_PHASES = 24;

/** Which phase step a contact's bearing falls in, 0..SWEEP_PHASES-1. */
export function sweepPhase(angleDeg: number): number {
  const wrapped = ((angleDeg % 360) + 360) % 360;
  return Math.floor((wrapped / 360) * SWEEP_PHASES) % SWEEP_PHASES;
}

/** The plasma steps, so a glow gradient can be generated for each. */
const BLEND_STEPS: readonly number[] = Object.freeze(
  Array.from({ length: PLASMA_STEPS }, (_, index) => index),
);

/**
 * The threshold band: the true radius, and a dimmer stroke either side of it.
 *
 * `core` is the ring itself, `edge` the pair that fade it into the lattice. Two
 * units out is enough to soften the boundary and not so much that the ring
 * stops meaning a distance.
 */
const THRESHOLD_BAND: readonly { readonly offset: number; readonly step: string }[] =
  Object.freeze([
    { offset: -2, step: 'edge' },
    { offset: 0, step: 'core' },
    { offset: 2, step: 'edge' },
  ]);
import {
  NODE_CORE_SCALE,
  PLASMA_STEPS,
  nodeOpacity,
  nodeRadius,
  plasmaStep,
} from '../node.ts';
import type { SweepZoom } from '../zoom.ts';

// THE STYLESHEET TRAVELS WITH THE DIAL, NOT WITH A SCREEN.
//
// It used to be imported by `SweepScreen.tsx`. When RADAR absorbed SWEEP and
// stopped rendering that screen, the import went with it -- and this component
// shipped its full markup (field, four bands, ticks, axes, beam, canvas) with
// no rules to draw it. Every element was present, sized and `visibility:
// visible`; the dial was a 406px rectangle of nothing.
//
// Nothing failed. 2,324 unit tests passed, because vitest runs with
// `css: false` and a DOM assertion cannot see a missing stylesheet. The build
// passed, the deploy verified, and the screen was blank on a real phone.
//
// So the import lives HERE, next to the markup it styles. A component that
// carries its own stylesheet cannot be orphaned from it by a routing change.
import '../sweep.css';
import { SweepTelemetry } from './SweepTelemetry.tsx';
import type { SweepTelemetry as SweepTelemetryModel } from '../telemetry.ts';
import { MapControls } from './MapControls.tsx';

export interface SweepDialProps {
  readonly dots: readonly SweepDot[];
  /** False when there is no fix: the scan line stops rather than miming a scan. */
  readonly scanning: boolean;
  /**
   * Draw the scope full width with no circular clip, as the screen's ground.
   *
   * RADAR sets this. The design's 343px puck with a hard rim reads as a widget
   * dropped on the page; the merged screen wants the scope to BE the page. See
   * the bleed block in `sweep.css` for what changes and what deliberately does
   * not -- the box stays square, because every dot position is computed in a
   * square viewBox and stretching it would move every camera.
   */
  readonly bleed?: boolean | undefined;
  /**
   * Writes the alert threshold. Absent renders no threshold control.
   *
   * This is the SETTINGS value, not a local one: there is one threshold, the
   * engine fires on it, the ring on this scope draws it, and the stepper on the
   * left edge changes it. A scope-local copy would be a picture of a setting
   * rather than the setting.
   */
  /**
   * UNUSED HERE. The threshold rail is gone -- a number with rules attached
   * belongs on SETTINGS beside the sentences that explain it, not on a rail
   * across a map. Kept on the props so the screen's wiring is unchanged and the
   * control can come back to the map if it ever earns the space.
   */
  readonly onThresholdChange?: ((thresholdFt: number) => void) | undefined;
  /** Where the view is dragged to, in dial units. `NO_PAN` is centred on you. */
  readonly pan?: PanOffset | undefined;
  /** A one-finger drag moved the view. Absent disables panning entirely. */
  readonly onPan?: ((pan: PanOffset) => void) | undefined;
  /** Projected road geometry, drawn beneath everything else on the scope. */
  /** True when the scope is heading-up. False means north-up, for want of a compass. */
  readonly headingUp: boolean;
  readonly onSelectCamera?: ((cameraId: string) => void) | undefined;
  /**
   * The named range the key row highlights. Kept for the `data-` attribute and
   * for a caller that has not adopted the continuous range; the ring LABELS
   * come from {@link outerFt}.
   */
  readonly zoom?: SweepZoom;
  /**
   * The scope's actual outer ring, in feet. A pinch moves it anywhere between
   * the named levels. Defaults to the drawn 1000 ft.
   */
  readonly outerFt?: number;
  /** Told the new outer ring while a pinch is running. Absent disables it. */
  readonly onPinch?: ((outerFt: number) => void) | undefined;
  /**
   * The driver's alert threshold, in feet. The glyph's hue blend runs across
   * it, so a camera sitting on the line reads as the colour between the two
   * states - which is what "on the line" means.
   */
  readonly thresholdFt: number;
  /**
   * RADAR's state, when the dial is drawing the alert threshold.
   *
   * Merged into RADAR, the threshold stopped being a ring on a separate screen
   * and became one of THIS dial's rings, lit in the state hue - "clear" is the
   * picture rather than a word inside a circle. Absent draws no threshold ring
   * at all, which is what SWEEP alone did.
   */
  readonly alertState?: RadarState | undefined;
  /**
   * v2's two telemetry corners. See `../telemetry.ts` for the privacy rules.
   *
   * OPTIONAL, AND RADAR DOES NOT PASS IT.
   *   On SWEEP these corners were the only place the scan rate, the render
   *   resolution and the vehicle's own coordinates appeared. Merged into RADAR
   *   they are duplicates of the header: the GPS row already prints the
   *   coordinates and the accuracy, and the strip above already prints speed
   *   and heading. `SCAN 2.4s / RES 12PX / SRC DB` is instrumentation, not
   *   something a driver needs.
   *
   *   They also collided. The corners are positioned inside the dial's square
   *   while the lattice and tick ring fill that same square, so on a phone the
   *   text was drawn straight through the rings.
   */
  readonly telemetry?: SweepTelemetryModel | undefined;
}

/** "425 FT". The same formatter RADAR's readout uses, so the two agree. */
function distanceWords(distanceFt: number): string {
  const value = formatDistanceValue(distanceFt);
  return value === NO_VALUE ? NO_VALUE : `${value} ${distanceUnit(distanceFt)}`;
}

/** "425FT" -- v2's callout writes the range closed up, with no space. */
function calloutRange(distanceFt: number): string {
  const value = formatDistanceValue(distanceFt);
  return value === NO_VALUE ? NO_VALUE : `${value}${distanceUnit(distanceFt)}`;
}

function dotLabel(dot: SweepDot): string {
  if (dot.cameraId === null) return `another flocky, ${distanceWords(dot.distanceFt)} away`;
  const muted = dot.muted ? ', muted' : '';
  const range = dot.kind === 'in-range' ? ', in range' : '';
  return `camera ${dot.cameraId}, ${distanceWords(dot.distanceFt)}${range}${muted}`;
}

export interface ClusterMember {
  readonly key: string;
  readonly cx: number;
  readonly cy: number;
  readonly distanceFt: number;
}

/**
 * One arm of the constellation, as a curve rather than a spoke.
 *
 * Straight lines from the centre to each member drew a starburst -- a set of
 * grey spikes stuck through the blip, which is what they looked like on screen.
 * A quadratic with its control point pushed off the chord turns the same
 * connection into an arc, so a cluster reads as something orbiting a centre
 * instead of something impaled on one.
 *
 * The bow is a FRACTION of the arm's own length, so a tight cluster gets a
 * gentle curve and a loose one a wider sweep, rather than every arm bending by
 * the same absolute amount regardless of how far it reaches.
 */
export const CLUSTER_EDGE_BOW = 0.22;

export function clusterEdgePath(from: DialPoint, to: ClusterMember): string {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const midX = from.cx + dx / 2;
  const midY = from.cy + dy / 2;
  // Perpendicular to the arm, so the bow is always across the line and never
  // along it -- pushing along the chord would just move the control point
  // between the ends and leave the curve straight.
  const controlX = midX - dy * CLUSTER_EDGE_BOW;
  const controlY = midY + dx * CLUSTER_EDGE_BOW;
  return `M ${String(from.cx)} ${String(from.cy)} Q ${String(round2(controlX))} ${String(round2(controlY))} ${String(to.cx)} ${String(to.cy)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function DotMark({
  dot,
  point,
  hitRadius,
  outerFt,
  onSelectCamera,
}: {
  readonly dot: SweepDot;
  /** Where this marker sits, worked out once for the whole scope. */
  readonly point: DialPoint;
  /** This marker's target, already clamped against every other on the scope. */
  readonly hitRadius: number;
  /** The scope's outer ring, in feet. Weights the node's size and glow. */
  readonly outerFt: number;
  readonly onSelectCamera: ((cameraId: string) => void) | undefined;
}): ReactElement {
  const cameraId = dot.cameraId;
  // A ghost is another driver, not a camera: it keeps v2's dashed circle. Only
  // a camera gets the solid, plasma-weighted contact.
  const isCamera = dot.kind !== 'ghost';
  // Colour is DISTANCE now, on the plasma ramp -- see `../node.ts`. The alert
  // blend it used to take gave every node inside the threshold one colour and
  // every node outside it another, spending the scope's widest visual channel
  // on a single bit.
  const plasma = plasmaStep(dot.distanceFt, outerFt);
  // Distance-weighted, bounded, and stepped up a little for a cluster so a
  // junction reads as heavier than a single camera at the same range.
  const radius =
    nodeRadius(dot.distanceFt, outerFt);
  // A ghost has no alert state and therefore no RADAR hue; a camera whose fix
  // aged out resolves to `no_gps`, which has no hue either and is drawn grey.
  // Neither may fall through to the other's colour.
  const hueKey = dot.hue ?? (dot.kind === 'ghost' ? 'mesh' : 'no-gps');
  const callout = calloutFor(point);
  // One camera, one card. There is no longer any marker that stands for more
  // than one thing, so there is no longer any tap that has to guess.
  const press =
    cameraId === null || onSelectCamera === undefined
      ? null
      : () => {
          onSelectCamera(cameraId);
        };

  const onKeyDown = (event: KeyboardEvent<SVGGElement>): void => {
    if (press === null) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    press();
  };

  return (
    <g
      className="fwm-sweep-dot"
      data-fwm-sweep-dot={dot.kind}
      data-fwm-sweep-hue={hueKey}
      data-fwm-sweep-muted={dot.muted ? 'true' : 'false'}
      data-fwm-sweep-bearing={dot.bearingKnown ? 'measured' : 'unknown'}
      // WHERE THE BEAM IS RELATIVE TO THIS CONTACT.
      //
      // A radar return is not painted continuously -- it is LIT when the sweep
      // crosses it and decays until the sweep comes round again. That is the
      // whole visual grammar of a scope, and the one thing this dial had a
      // rotating beam for and did not do.
      //
      // The decay is one CSS animation on the same period as the beam, offset
      // per contact by a NEGATIVE delay equal to its own bearing: a marker at
      // 90 degrees starts its cycle a quarter of the way in, so its flash lands
      // exactly when the beam reaches it. Quantised to 24 steps because the
      // delays are declared in the stylesheet -- 15 degrees is well under what
      // an eye resolves on a 2.4-second rotation.
      data-fwm-sweep-phase={String(sweepPhase(dot.angleDeg))}
      {...(cameraId === null ? {} : { 'data-fwm-sweep-camera': cameraId })}
      role={press === null ? 'img' : 'button'}
      aria-label={dotLabel(dot)}
      {...(press === null ? {} : { tabIndex: 0 })}
      {...(press === null ? {} : { onClick: press })}
      {...(press === null ? {} : { onKeyDown })}
    >
      {/* NOTHING IS DRAWN AROUND A CONTACT ANY MORE.
       *
       * Three things used to be: a corner-bracket reticle on an in-range
       * marker, a 20-unit ring on a known one, and a 60-degree arc showing
       * which way the lens faces. Each was defensible alone. Together, on a
       * scope where cameras cluster along a road, they drew three broken rings
       * per contact that overlapped their neighbours into a mess of arcs -- and
       * the arc in particular reads as damage, not as a bearing.
       *
       * The contact itself now carries everything they carried: the hue is the
       * alert state, the size and fade are the distance, and the digit inside
       * is the proximity. The facing direction lives in the intel card, which
       * is where a driver reads details rather than glances at them.
       */}

      {isCamera ? (
        /* A DRAWN CONTACT, NOT AN EMOJI.
         *
         * This was `U+1F4F7 U+FE0E` -- a camera character with a
         * variation selector asking for the text form so it could take a
         * fill. On a phone it did not: Android and iOS both render it as a
         * COLOUR emoji, so twenty little yellow-and-grey cameras piled onto
         * the scope at every size, ignoring the alert hue entirely, and the
         * ones near each other overlapped into a smear.
         *
         * They were also slow. A colour emoji is a bitmap the text shaper has
         * to lay out and rasterise per glyph per frame; a hundred of them
         * re-rendering behind a 2.4s sweep is the lag.
         *
         * A circle is what a radar contact is. It takes the hue through
         * `currentColor`, it scales and fades on the same measured ramp the
         * glyph did -- `r` where `font-size` was -- and it costs the compositor
         * nothing.
         */
        <g>
          {/* ONE GLOWING THING.
              A hard-edged disc with a faint circle behind it is two shapes, and
              it reads as exactly that: a coloured dot with a ring of paint
              around it. A radar blip is a BLOOM -- a small intensely bright
              centre falling off smoothly into nothing -- so that is what this
              is: one gradient-filled circle carrying the whole falloff, with a
              tiny solid core for the hot centre.

              The core is deliberately small. The thing that makes a blip read
              as light rather than as a shape is that its bright part is much
              smaller than its glow. */}
          <circle
            className="fwm-sweep-dot-contact"
            cx={point.cx}
            cy={point.cy}
            // The hot centre only. Size still tracks distance -- see
            // `../node.ts` -- but over a small band, because the bloom around
            // it is what carries the weight.
            r={radius * NODE_CORE_SCALE}
            opacity={nodeOpacity(dot.distanceFt, outerFt)}
            data-fwm-sweep-plasma={String(plasma)}
            aria-hidden="true"
          />
        </g>
      ) : (
        <circle className="fwm-sweep-dot-core" cx={point.cx} cy={point.cy} r={DOT_RADIUS} />
      )}

      {/* v2's callout. `aria-hidden`, because the group's own label already
          says the id and the distance and a screen reader should not hear
          either twice. */}
      {dot.hue === 'in-range' && cameraId !== null ? (
        <text
          className="fwm-sweep-dot-callout"
          x={callout.x}
          y={callout.y}
          textAnchor={callout.anchor}
          dominantBaseline="hanging"
          aria-hidden="true"
        >
          <tspan className="fwm-sweep-dot-callout-id" x={callout.x}>
            {cameraId}
          </tspan>
          <tspan className="fwm-sweep-dot-callout-range" x={callout.x} dy={CALLOUT_LINE}>
            {calloutRange(dot.distanceFt)}
          </tspan>
        </text>
      ) : null}

      {press === null ? null : (
        <circle
          className="fwm-sweep-dot-hit"
          cx={point.cx}
          cy={point.cy}
          r={hitRadius}
          aria-hidden="true"
        />
      )}
    </g>
  );
}

interface PlacedDot {
  readonly dot: SweepDot;
  readonly point: DialPoint;
  readonly hitRadius: number;
}

/**
 * Every marker's position, and the tap target that position allows.
 *
 * Done for the whole scope at once because a target's size depends on where the
 * OTHER markers are: two cameras a few units apart get two small targets rather
 * than two overlapping big ones, and the tap lands on the marker it was aimed
 * at.
 */
function placeDots(dots: readonly SweepDot[]): readonly PlacedDot[] {
  const placed = dots.map((dot) => ({ dot, point: dialPoint(dot.radius, dot.angleDeg) }));
  // Only TAPPABLE markers constrain each other. A presence ghost has no camera
  // id and takes no taps, so letting one shrink a real camera's target traded a
  // usable control for nothing - the ambiguity the clamp exists to prevent
  // cannot arise between a target and a shape that is not a target.
  const rivals = placed
    .filter((entry) => entry.dot.cameraId !== null)
    .map((entry) => entry.point);
  return placed.map((entry) => ({
    ...entry,
    hitRadius: hitRadiusForDot(entry.point, rivals),
  }));
}

export function SweepDial({
  dots,
  scanning,
  bleed = false,
  pan = NO_PAN,
  onPan,
  headingUp,
  onSelectCamera,
  zoom = DEFAULT_SWEEP_ZOOM,
  outerFt,
  onPinch,
  thresholdFt,
  telemetry,
  alertState,
}: SweepDialProps): ReactElement {
  const range = clampOuterFt(outerFt ?? zoom.outerFt);
  const rings = ringsForOuterFt(range);
  const thresholdRadius =
    alertState === undefined ? null : radiusForDistanceFt(thresholdFt, range);

  // The two live pointers and where the gesture started. A ref, not state: a
  // pointer position is not something the scope re-renders for, and putting it
  // in state would re-render the whole dial on every `pointermove`.
  const pointers = useRef(new Map<number, { readonly x: number; readonly y: number }>());
  const anchor = useRef<PinchAnchor | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  /**
   * How much of the world the frame shows, in dial units.
   *
   * The dial is a square viewBox drawn `slice`, so the SHORT edge is the one
   * that fills and the long edge shows more world than the square holds. On a
   * portrait phone that means the full DIAL_UNITS vertically and rather less
   * horizontally -- and knowing which is which is what lets the markers be
   * culled to the actual rectangle a driver is looking at.
   */
  const [frame, setFrame] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const element = frameRef.current;
    if (element === null || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect();
      setFrame({ w: box.width, h: box.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  /**
   * How many screen pixels one dial unit is, right now.
   *
   * OFF THE SVG'S OWN MATRIX, not off the element's width. The dial is drawn
   * `slice`, so it scales to COVER the frame -- on a tall phone that is the
   * height that decides the scale, not the width, and `width / DIAL_UNITS` was
   * under-reading it by about 2.8x. Everything derived from it was wrong by
   * that factor, which is why a drag moved the map so much further than the
   * finger did.
   *
   * `getScreenCTM` is the browser's own answer and is right under any
   * `preserveAspectRatio`. jsdom has no layout, so the width is kept as the
   * fallback rather than dividing by zero in tests.
   */
  const pxPerUnit = (fallbackWidth: number): number => {
    const ctm = svgRef.current?.getScreenCTM?.() ?? null;
    if (ctm !== null && Number.isFinite(ctm.a) && ctm.a > 0) return ctm.a;
    return fallbackWidth === 0 ? 0 : fallbackWidth / DIAL_UNITS;
  };

  /** A client point in dial units, via the same matrix. */
  const clientToDial = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM?.() ?? null;
    if (svg === null || ctm === null) return null;
    const inverse = ctm.inverse();
    return {
      x: inverse.a * clientX + inverse.c * clientY + inverse.e,
      y: inverse.b * clientX + inverse.d * clientY + inverse.f,
    };
  };
  const [pinching, setPinching] = useState(false);

  const twoPointers = (): readonly { readonly x: number; readonly y: number }[] =>
    [...pointers.current.values()].slice(0, 2);

  // ONE finger pans, TWO pinch. The same pointer map serves both: a drag is
  // only a pan while exactly one pointer is down, and the moment a second
  // arrives the gesture becomes a pinch and the pan stops where it was.
  const dragOrigin = useRef<{ x: number; y: number; pan: PanOffset } | null>(null);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A timer that outlives its component fires into a torn-down tree. Cleared on
  // unmount rather than left to React to complain about.
  useEffect(
    () => () => {
      if (returnTimer.current !== null) clearTimeout(returnTimer.current);
    },
    [],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      if (onPan === undefined) return;
      // A new touch cancels a pending return: a driver who grabs it again is
      // still looking, and having the scope snap out from under their thumb is
      // the one thing worse than it not returning at all.
      if (returnTimer.current !== null) {
        clearTimeout(returnTimer.current);
        returnTimer.current = null;
      }
      dragOrigin.current = { x: event.clientX, y: event.clientY, pan };
      return;
    }

    // A second finger: a pinch, not a drag.
    dragOrigin.current = null;
    if (onPinch === undefined) return;
    const [a, b] = twoPointers();
    if (a === undefined || b === undefined) return;
    anchor.current = { startSpread: spread(a, b), startOuterFt: range };
    setPinching(true);
  };

  /**
   * The +/- keys, zooming about the MIDDLE OF THE SCREEN.
   *
   * They used to hand the new range straight to `onPinch` and leave the pan
   * alone, so on a panned map every press slid the view sideways -- the same
   * defect as the pinch, just with a fixed focal point. With the focus at the
   * frame centre `panForZoom` reduces to scaling the pan, which is exactly
   * what keeps the middle of the screen still.
   */
  const onZoomKey =
    onPinch === undefined
      ? undefined
      : (next: number): void => {
          if (onPan !== undefined && isPanned(pan)) {
            onPan(panForZoom(pan, { x: DIAL_CENTRE, y: DIAL_CENTRE }, range / next, DIAL_CENTRE));
          }
          onPinch(next);
        };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      const origin = dragOrigin.current;
      if (origin === null || onPan === undefined) return;

      // NOTHING MOVES UNTIL THE FINGER HAS COMMITTED.
      //
      // A tap carries a few pixels of slide, and a driver swiping at a screen
      // that does not scroll makes a flick -- both used to displace the entire
      // map. Measured before this: a short flick of about fifty pixels moved the world to
      // `translate(0 -39.7)` and left it there.
      const rawX = event.clientX - origin.x;
      const rawY = event.clientY - origin.y;
      const travelled = Math.hypot(rawX, rawY);
      if (travelled < PAN_START_PX) return;

      // The threshold is SUBTRACTED, not just used as a gate. Gating alone
      // makes the map jump by the whole distance the finger has already
      // travelled the instant it engages -- measured, a short scroll-flick snapped
      // world 28 units at once. Taking the threshold out means the map starts
      // moving from where the finger was when it committed, so a drag begins
      // at zero and a flick barely moves anything at all.
      const committed = (travelled - PAN_START_PX) / travelled;

      // Pixels to dial units. The dial is DIAL_UNITS across in its own
      // coordinates and some other width on screen, so the conversion has to
      // come from the element, not from a constant.
      const width = event.currentTarget.getBoundingClientRect().width;
      onPan(panFromDrag(origin.pan, rawX * committed, rawY * committed, pxPerUnit(width)));
      return;
    }

    if (onPinch === undefined) return;
    const start = anchor.current;
    if (start === null) return;
    const [a, b] = twoPointers();
    if (a === undefined || b === undefined) return;

    const next = pinchOuterFt(start, spread(a, b));

    // ZOOM ABOUT THE FINGERS, NOT ABOUT THE VEHICLE. Without this the whole
    // map scales around the car, so pinching on a cluster off to one side
    // throws that cluster further off. See `panForZoom`.
    if (onPan !== undefined) {
      const focus = clientToDial((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (focus !== null) onPan(panForZoom(pan, focus, range / next, DIAL_CENTRE));
    }
    onPinch(next);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    const wasDragging = dragOrigin.current !== null;
    dragOrigin.current = null;

    // NO TIMER HERE. A PANNED MAP STAYS PANNED UNTIL THE CAR MOVES.
    //
    // A timed return has been in and out twice and is not coming back: it undid
    // each drag a few seconds later, so a driver could never travel far enough
    // to reach ground that had not already been loaded. Measured at the time:
    // eight full-width drags ended at `translate(0 0)` with zero new tiles
    // fetched. Panning is how you go and LOOK at somewhere, and a timer is a
    // rule that says you may not.
    //
    // What replaces it is not a timer. The view follows the vehicle whenever
    // the vehicle is MOVING -- see `followsVehicle` in `pan.ts`. Standing
    // still, the drag survives indefinitely, because standing still is when
    // looking around is the whole point.
    void wasDragging;

    if (pointers.current.size >= 2) return;
    anchor.current = null;
    setPinching(false);
  };

  /*
   * THE ONLY INLINE STYLE IN THIS FEATURE, AND IT HAS TO BE ONE.
   *
   * Panning must move the CSS-drawn layers -- the dot lattice, the four ring
   * bands, the bearing ticks, the beam -- by exactly the distance the SVG
   * moved, or half the scope slides and the other half does not: the drawn
   * rings come off the ring bands they belong to and the instrument reads as
   * broken. That is precisely what happened when only the viewBox moved.
   *
   * A stylesheet cannot express "wherever this driver's thumb dragged to". The
   * value is a live gesture -- the same class of thing as a marker's radius,
   * which is an SVG attribute for the same reason -- and it is handed over as
   * two unitless custom properties that rules in `sweep.css` turn into a
   * transform. No paint decision leaves the stylesheet.
   */
  // In the scope's own units, so it needs no conversion and cannot drift from
  // the coordinates the roads and blips are already placed in.
  const panTransform = `translate(${String(-pan.x)} ${String(-pan.y)})`;

  /**
   * What gets an SVG marker, and what only makes it into the field.
   *
   * The reach cull answers "is this on screen", and at a hundred miles the
   * answer is yes for thousands of cameras. Thousands of `<g role="button">`
   * with their own hit circles is not a map, it is a layout cost per frame.
   *
   * So the nearest `DOT_LIMIT` are drawn as markers and everything else is
   * carried by the coverage field, which is one canvas however many points go
   * into it. Nothing disappears -- a camera past the limit is still painted
   * into the density that tells you the area is bad. What it loses is being
   * individually tappable, which is the right thing to lose first, and it gets
   * it back the moment you zoom in far enough that it is one of the nearest.
   */
  const placed = placeDots(dots);
  const byRange = [...placed].sort((a, b) => a.dot.distanceFt - b.dot.distanceFt);

  /**
   * THE MARKERS ARE CULLED TO THE VIEW, NOT TO A RANKING.
   *
   * They were the nearest `DOT_LIMIT` cameras BY DISTANCE FROM THE VEHICLE,
   * which is a disc -- so on a wide scope the markers stopped at a circle
   * around the car while the coverage field, which takes far more points, kept
   * going to the edges of the screen. The result was heat with no dots in it,
   * and a hard round edge that belonged to the cap rather than to anything on
   * the ground.
   *
   * What a driver has asked for by pinching and dragging is a RECTANGLE. So the
   * rectangle is what gets drawn: everything inside the frame, plus a margin so
   * nothing pops in at the edge mid-drag. The cap still exists as a backstop
   * against a downtown with thousands in one view, but it now bites on a set
   * that is already the right SHAPE, so thinning it cannot carve a circle out
   * of the picture.
   */
  const halfSpan = frameHalfSpan(frame, range);
  const inView = byRange.filter((entry) =>
    Math.abs(entry.point.cx - (DIAL_CENTRE + pan.x)) <= halfSpan.x &&
    Math.abs(entry.point.cy - (DIAL_CENTRE + pan.y)) <= halfSpan.y,
  );
  const visibleDots = inView.slice(0, DOT_LIMIT);
  const heatPoints = byRange.slice(0, HEAT_LIMIT).map((entry) => entry.point);

  return (
    <div
      ref={frameRef}
      className="fwm-sweep-dial"
      data-fwm-sweep-scanning={scanning ? 'true' : 'false'}
      data-fwm-sweep-bleed={bleed ? 'true' : 'false'}
      data-fwm-sweep-orientation={headingUp ? 'heading-up' : 'north-up'}
      data-fwm-sweep-pinching={pinching ? 'true' : 'false'}
      data-fwm-sweep-pinch-limit={pinchLimit(range) ?? 'none'}
      data-fwm-sweep-panned={isPanned(pan) ? 'true' : 'false'}
      {...(onPinch === undefined && onPan === undefined
        ? {}
        : { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp })}
    >
      {/* The masked layers v2 builds the scope out of, in its own paint order.
          Every one is a background under a mask, which is a CSS construction:
          see the header of this file. */}
      <div className="fwm-sweep-field" aria-hidden="true" />
      {RING_MASK_PCT.map((_, index) => (
        <div
          className="fwm-sweep-band"
          data-fwm-sweep-band={String(index + 1)}
          key={String(index)}
          aria-hidden="true"
        />
      ))}
      <div className="fwm-sweep-ticks" data-fwm-sweep-ticks="minor" aria-hidden="true" />
      <div className="fwm-sweep-ticks" data-fwm-sweep-ticks="major" aria-hidden="true" />
      <div className="fwm-sweep-axis" data-fwm-sweep-axis="vertical" aria-hidden="true" />
      <div className="fwm-sweep-axis" data-fwm-sweep-axis="horizontal" aria-hidden="true" />

      {/* The 70 deg conic scan line. Decoration over the rings, under the
          markers, and never in the way of a tap. */}
      <div className="fwm-sweep-beam" aria-hidden="true" />

      <svg
        ref={svgRef}
        className="fwm-sweep-canvas"
        // FIXED. Panning used to move this origin, which moved EVERYTHING --
        // rings, vehicle, labels -- and a ring is a distance from the vehicle,
        // so taking the vehicle with it made the scale meaningless. The
        // instrument is a fixed reticle; only the world under it moves, in the
        // panned group below.
        viewBox={`0 0 ${String(DIAL_UNITS)} ${String(DIAL_UNITS)}`}
        /* COVER, not fit. The viewBox is square because every camera position
           is computed in it; the FRAME is whatever shape the screen leaves.
           `slice` scales the square to cover that frame and crops the overflow
           -- uniform scale, nothing distorted, and no black band above and
           below the data. `meet` (the default) is what left one. */
        preserveAspectRatio={bleed ? 'xMidYMid slice' : 'xMidYMid meet'}
        role="group"
        aria-label={`sweep dial, ${headingUp ? 'heading up' : 'north up'}`}
      >
        {/* NO SVG ROAD LAYER. The former TIGER projection was removed. The
            normal RADAR path draws roads in MapLibre's canvas; this standalone
            fallback draws only the scope and its contacts rather than inventing
            or fetching a second road source. */}
        {/* THE GLOW GRADIENTS - what makes a node a glowing thing.
            A flat circle behind a flat circle is two flat circles: it reads as
            a disc with a ring of paint round it, which is what a yellow dot on
            a slide looks like. A radial gradient from opaque at the centre to
            transparent at the edge is an actual falloff, and it costs the
            compositor no more than the flat one did.

            One per blend step, because a gradient stop cannot inherit the
            colour of the shape referencing it -- `currentColor` inside `defs`
            resolves against the defs element, not the user. The stop colours
            come from the same `--fwm-blend-*` tokens the node does, set in
            `sweep.css`, so a theme that remaps a hue remaps the glow with
            it. */}
        <defs>
          {/* THE APERTURE.
              The scope is a hole cut in a board laid over a map: what you see
              through it is the map, and NOTHING exists outside it. The board
              does the hiding.
              Everything drawn here was clipped to the canvas's SQUARE instead,
              so contacts and roads spilled into the corners beyond the rings --
              bleeding onto the board. A circle is the hole. */}
          <clipPath id="fwm-scope-aperture">
            <circle cx={DIAL_CENTRE} cy={DIAL_CENTRE} r={OUTER_RADIUS} />
          </clipPath>

          {BLEND_STEPS.map((step) => (
            <radialGradient key={step} id={`fwm-glow-${String(step)}`}>
              {/* Intense at the centre and falling away fast, then a long
                  faint tail. A linear falloff reads as a soft disc; this reads
                  as light. */}
              <stop className={`fwm-sweep-plasma-stop-${String(step)}`} offset="0%" stopOpacity="1" />
              <stop className={`fwm-sweep-plasma-stop-${String(step)}`} offset="12%" stopOpacity="0.85" />
              <stop className={`fwm-sweep-plasma-stop-${String(step)}`} offset="30%" stopOpacity="0.34" />
              <stop className={`fwm-sweep-plasma-stop-${String(step)}`} offset="55%" stopOpacity="0.1" />
              <stop className={`fwm-sweep-plasma-stop-${String(step)}`} offset="100%" stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>

        {/* Bare numbers, as the design draws them. The unit is said once, on
            the zoom key, rather than four times on the scope. */}
        {/* THE ALERT THRESHOLD, as a ring on this dial.
            Drawn only when it falls inside the range being shown: a threshold
            off the edge is not a thing to draw a circle for, and a ring pinned
            at the rim would claim a distance that is not the threshold. */}
        {alertState === undefined || thresholdRadius === null ? null : (
          /* THE THRESHOLD RING, drawn as a soft band rather than a hard circle.
             One stroked circle is a hard edge on both sides -- it reads as a
             drawn boundary sitting on top of the scope instead of a region of
             it. Three concentric strokes, dimming outward from the true radius,
             fade into the lattice on either side at a fraction of the cost of a
             blurred filter, and adapt to any threshold because they are all
             derived from the one radius. */
          <g aria-hidden="true">
            {THRESHOLD_BAND.map(({ offset, step }) => (
              <circle
                key={offset}
                className="fwm-sweep-threshold"
                data-fwm-sweep-threshold={alertState}
                data-fwm-sweep-threshold-step={step}
                cx={DIAL_CENTRE}
                cy={DIAL_CENTRE}
                r={Math.max(1, thresholdRadius + offset)}
              />
            ))}
          </g>
        )}

        {/* NO THRESHOLD TEXT ON THE SCOPE.
            It read `THRESHOLD 200 FT` across the middle of the dial, over the
            rings and often over the vehicle. The rail along the bottom says
            the number now and the ring above draws it -- a third copy printed
            across the instrument was the one that had to go. */}

        {rings.map((ring, index) => (
          <text
            key={ring.ft}
            className="fwm-sweep-ring-label"
            data-fwm-sweep-ring-label={String(Math.round(ring.ft))}
            x={DIAL_CENTRE}
            y={ringLabelY(ring.radius)}
          >
            {ringLabelFor(range, RING_RATIOS[index] ?? 1)}
          </text>
        ))}

        {/* THE WORLD: everything that is at a PLACE.
            Roads, contacts, and THE VEHICLE. The vehicle was outside this group
            -- pinned to the centre as part of the instrument -- and that was
            wrong in a way that made panning look broken: drag the map and the
            arrow stayed behind while every road and camera slid away from it,
            stranding it in empty space with its own data in the corner.
            You are a thing at a place. When the map moves, you move with it. */}
        {/* THE HOLE IS FIXED; THE MAP MOVES INSIDE IT.
            Two groups, and they cannot be one: a `clipPath` and a `transform`
            on the SAME element are both evaluated in that element's user space,
            so the clip travelled with the pan and the hole slid off with the
            map -- leaving contacts and roads outside the aperture again. The
            board does not move when you drag what is under it. */}
        {/* THE APERTURE IS ONLY FOR THE INSET SCOPE.
            At full bleed there is no radar graphic to be a hole in -- no
            lattice, no rings, no board -- so cutting the map to a circle would
            be hiding the map for the sake of a shape that is no longer drawn.
            It fills its frame, and the canvas clips it to that. */}
        <g {...(bleed ? {} : { clipPath: 'url(#fwm-scope-aperture)' })}>
        <g transform={panTransform}>
          {/* v2's 44-unit ring around the vehicle. Decoration: the hit circles
              are the controls, and this one takes no taps. */}
          <circle
            className="fwm-sweep-ego-ring"
            cx={DIAL_CENTRE}
            cy={DIAL_CENTRE}
            r={EGO_RING_RADIUS}
            aria-hidden="true"
          />

          {/* The vehicle, at the centre of its own coordinates, pointing up. */}
          <polygon className="fwm-sweep-ego" points={EGO_MARKER_POINTS} aria-label="you" role="img" />

          {/* THE COVERAGE FIELD, under everything.
              A canvas, because it is overlapping translucent blobs and that is
              the one workload a compositor is worst at -- see `../heat.ts`.
              It lives INSIDE the panned group in a `foreignObject` so the pan
              and the zoom are the SVG's own transform rather than a second
              copy of it in CSS that could drift. */}
          <foreignObject
            x={HEAT_ORIGIN_UNITS}
            y={HEAT_ORIGIN_UNITS}
            width={HEAT_SPAN_UNITS}
            height={HEAT_SPAN_UNITS}
          >
            <HeatLayer points={heatPoints} outerRadiusUnits={OUTER_RADIUS} outerFt={range} />
          </foreignObject>


        {/* EVERY CAMERA, ON ITS OWN. No merging, no cluster marker, no
            count -- the FIELD behind them carries density now, which is the
            thing a count was a bad way of saying. A tap is therefore always a
            tap on one real camera, and the INTEL CARD is always about that
            camera, which is what the cluster marker could never honestly do.

            Capped: at a hundred miles the reach cull can still leave thousands
            of cameras on screen, and thousands of tap targets is not a map. The
            nearest ones are drawn; the rest are still in the field, so nothing
            vanishes -- it stops being individually tappable, which is the right
            thing to lose first. */}
        {visibleDots.map((placed) => (
          <DotMark
            outerFt={range}
            key={placed.dot.key}
            dot={placed.dot}
            point={placed.point}
            hitRadius={placed.hitRadius}
            onSelectCamera={onSelectCamera}
          />
        ))}
        </g>
        </g>
      </svg>

      {telemetry === undefined ? null : <SweepTelemetry telemetry={telemetry} />}

      {/* ONE CLUSTER OF MAP CONTROLS, in one corner.
          The range and threshold each had a full-width rail with its own row of
          labels, taking a band off the top and the bottom of the screen
          permanently for two controls that are touched rarely: the range is
          pinched, and the threshold is a setting somebody sets once. The
          threshold moved to SETTINGS; the range lives here, small,
          where every map puts its controls. */}
      <MapControls
        outerFt={range}
        onChange={onZoomKey}
        panned={isPanned(pan)}
        onRecenter={onPan === undefined ? undefined : () => { onPan(NO_PAN); }}
      />
    </div>
  );
}
