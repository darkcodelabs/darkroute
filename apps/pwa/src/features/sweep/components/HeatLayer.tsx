/**
 * THE COVERAGE FIELD, on a canvas behind the scope.
 *
 * Why a canvas rather than more SVG is argued in `../heat.ts`. What matters
 * here is that this component owns exactly one element, repaints it only when
 * the points or the size actually change, and never participates in hit
 * testing -- every tap belongs to the SVG dots drawn over it.
 */

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

import { DIAL_CENTRE } from '../geometry.ts';
import { FRAME_REACH_RADII } from '../pan.ts';
import { HEAT_STOPS_FALLBACK, heatRadiusUnits, paintHeat } from '../heat.ts';
import type { HeatPoint, HeatStop } from '../heat.ts';

/**
 * The tokens the ramp is built from, cool to hot.
 *
 * THE SAME ELEVEN THE MARKERS USE, reversed. The field had its own teal-amber
 * ramp and the map ended up speaking two unrelated colour languages at once.
 * Reversed because plasma runs hot-to-cool by DISTANCE (yellow on you, blue
 * far away) while density runs the other way: sparse ground is cold, a lined
 * corridor is incandescent.
 *
 * Read off the document rather than written here, so the field belongs to the
 * theme like everything else -- restate the tokens and the weather restates
 * with them.
 */
export const HEAT_STOP_TOKENS = [
  '--fwm-plasma-10',
  '--fwm-plasma-9',
  '--fwm-plasma-8',
  '--fwm-plasma-7',
  '--fwm-plasma-6',
  '--fwm-plasma-5',
  '--fwm-plasma-4',
  '--fwm-plasma-3',
  '--fwm-plasma-2',
  '--fwm-plasma-1',
  '--fwm-plasma-0',
] as const;

function parseHex(value: string): HeatStop | null {
  const hex = value.trim().replace(/^#/, '');
  if (hex.length !== 6) return null;
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readStops(element: Element | null): readonly HeatStop[] {
  if (element === null || typeof globalThis.getComputedStyle !== 'function') {
    return HEAT_STOPS_FALLBACK;
  }
  const style = globalThis.getComputedStyle(element);
  const stops = HEAT_STOP_TOKENS.map((token) => parseHex(style.getPropertyValue(token)));
  return stops.every((stop): stop is HeatStop => stop !== null) ? stops : HEAT_STOPS_FALLBACK;
}

/**
 * The most device pixels per dial unit the field is drawn at.
 *
 * The field is soft-edged by nature, so it does not need the display's full
 * density to look right, and this is the single biggest lever on what it costs
 * -- the second pass walks EVERY pixel in JavaScript to apply the ramp, so the
 * work is quadratic in this number.
 *
 * Dropped from 1.5 to 0.6 after performance was reported as unusable: at 1.5
 * the buffer was 1338 square, which is 1.8 million pixels and about 7 MB of
 * `getImageData` to churn through per repaint. At 0.6 it is 535 square, a
 * quarter of the work, and the difference is invisible on a field whose whole
 * character is blur.
 */
export const HEAT_MAX_DEVICE_SCALE = 0.6;

/**
 * How wide the field is, in dial units.
 *
 * NOT the viewBox. The scope draws `slice` and culls at `FRAME_REACH_RADII`,
 * so the ground a driver can see reaches about 2.6 ring radii from the vehicle
 * -- and at a close range every visible camera is OUTSIDE the nominal box. A
 * canvas the size of the viewBox painted nothing at all while 27 cameras sat
 * on screen, because all 27 were past its edges.
 *
 * Sized to the reach, and placed so the vehicle stays in its middle.
 */
export const HEAT_SPAN_UNITS = Math.ceil(DIAL_CENTRE * FRAME_REACH_RADII * 2);

/** The field's top-left corner, in dial units. */
export const HEAT_ORIGIN_UNITS = DIAL_CENTRE - HEAT_SPAN_UNITS / 2;

export interface HeatLayerProps {
  /** Camera positions in dial units. Clusters are NOT merged: every camera. */
  readonly points: readonly HeatPoint[];
  /** The scope's outer radius in dial units. */
  readonly outerRadiusUnits: number;
  /** The scope's range in feet. With the radius, converts ground to units. */
  readonly outerFt: number;
}

/**
 * Whether this environment has a 2D canvas at all.
 *
 * jsdom does not, and calling `getContext` there logs a "Not implemented"
 * notice EVERY time -- once per render, in a suite with hundreds of them. The
 * first null is remembered so the notice appears at most once and the field
 * simply does not paint, which is the correct behaviour anywhere a canvas is
 * unavailable rather than something specific to tests.
 */
let canvasUsable = true;

export function HeatLayer({ points, outerRadiusUnits, outerFt }: HeatLayerProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * The latest points, without them being a dependency.
   *
   * The array is rebuilt on every render and the scope re-renders on every GPS
   * fix -- about once a second -- while the positions almost never change.
   * Depending on the array would repaint the whole field every tick for a
   * picture that is identical; depending on the signature and reading the
   * array through a ref repaints only when something actually moved.
   */
  const latest = useRef(points);
  latest.current = points;

  // A stable key for the points, so a re-render that did not move anything does
  // not repaint. The scope re-renders on every GPS fix -- about once a second
  // -- and almost none of those change where the cameras are.
  /**
   * A cheap hash of where everything is, quantised.
   *
   * TWO PROBLEMS THIS SOLVES, AND BOTH WERE COSTING FRAMES.
   *
   * It was a joined string over every point, rebuilt on every render. At nine
   * hundred cameras that is a nine-hundred-element map and a large string
   * concatenation per render, several times a second, to answer a yes/no
   * question. It is a rolling integer hash now.
   *
   * And it is QUANTISED to whole dial units. Every position on this scope is
   * measured from the vehicle, so when the vehicle moves a metre EVERY camera's
   * coordinates change -- which meant the signature changed on every GPS fix
   * and the whole field, pixel pass and all, was repainted about once a second
   * while parked. Rounding to the unit means the field repaints when the
   * picture would actually differ, and sub-unit GPS jitter is ignored.
   */
  let signature = points.length;
  for (const point of points) {
    signature = (signature * 31 + Math.round(point.cx)) | 0;
    signature = (signature * 31 + Math.round(point.cy)) | 0;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (!canvasUsable) return;
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext('2d');
    } catch {
      context = null;
    }
    if (context === null) {
      canvasUsable = false;
      return;
    }

    // No `max(1, dpr)` any more: the cap IS the target. A soft field does not
    // get better on a denser screen, it just costs more there.
    const deviceScale = HEAT_MAX_DEVICE_SCALE;
    const pixels = Math.max(1, Math.round(HEAT_SPAN_UNITS * deviceScale));
    if (canvas.width !== pixels) canvas.width = pixels;
    if (canvas.height !== pixels) canvas.height = pixels;

    canvas.setAttribute('data-fwm-heat-points', String(latest.current.length));
    canvas.setAttribute('data-fwm-heat-radius', String(heatRadiusUnits(outerRadiusUnits, outerFt)));
    paintHeat(context, latest.current, {
      widthUnits: HEAT_SPAN_UNITS,
      heightUnits: HEAT_SPAN_UNITS,
      originX: HEAT_ORIGIN_UNITS,
      originY: HEAT_ORIGIN_UNITS,
      radiusUnits: heatRadiusUnits(outerRadiusUnits, outerFt),
      deviceScale,
      stops: readStops(canvas),
    });
  }, [signature, outerRadiusUnits, outerFt]);

  return <canvas ref={canvasRef} className="fwm-sweep-heat" aria-hidden="true" />;
}
