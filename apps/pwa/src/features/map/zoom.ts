/**
 * THE RANGE LADDER, IN A MAP'S UNITS.
 *
 * The dial's scale was an outer ring measured in FEET, because it drew that
 * ring itself. A slippy map's scale is a zoom level: a logarithmic number where
 * each step halves the ground covered.
 *
 * Both exist while both renderers exist, so one has to convert. This is the
 * only place that does it -- two conversions would drift, and the drift would
 * show up as the map and the range readout disagreeing about what "1 MI" means.
 *
 * The relationship: at zoom z the world is 256 * 2^z pixels around, so the
 * metres one pixel covers at latitude phi is
 *
 *     156543.03392 * cos(phi) / 2^z
 *
 * The scope's outer ring is half the frame, so the range is what fills roughly
 * half the shorter screen edge. `REFERENCE_PX` is that half-edge in CSS pixels
 * -- a phone, which is what this is for.
 */

const EQUATOR_METRES_PER_PIXEL = 156_543.03392;
const METRES_PER_FOOT = 0.3048;

/** Half the short edge of a phone, in CSS pixels. See the header. */
export const REFERENCE_PX = 195;

/** The latitude the conversion is anchored at. Mid-US; the error is small. */
export const REFERENCE_LAT = 39;

/** MapLibre's own limits, which a range must not ask it to exceed. */
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;

export function zoomForOuterFt(outerFt: number, latitude: number = REFERENCE_LAT): number {
  if (!Number.isFinite(outerFt) || outerFt <= 0) return 14;
  const metres = outerFt * METRES_PER_FOOT;
  const metresPerPixel = metres / REFERENCE_PX;
  const scale = (EQUATOR_METRES_PER_PIXEL * Math.cos((latitude * Math.PI) / 180)) / metresPerPixel;
  const zoom = Math.log2(scale);
  if (!Number.isFinite(zoom)) return 14;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/**
 * How far the zoom prop must move to count as a COMMAND rather than an echo.
 *
 * THE PINCH BUG lives here. `zoomForOuterFt` quantises to two decimals, so a
 * zoom the driver reached with their fingers, written out to feet and read back
 * as a prop, returns a few thousandths from where they left it. Treat that
 * rounding as a new instruction and the map eases itself back over the top of
 * the gesture. Every genuine command -- a range step -- moves whole zoom levels,
 * so there is a wide gap between the two and this sits in it.
 */
export const ZOOM_COMMAND_EPSILON = 0.02;

/** Whether a zoom prop is a fresh command or the echo of the driver's own pinch. */
export function isZoomCommand(commanded: number | null, next: number): boolean {
  if (commanded === null || !Number.isFinite(commanded) || !Number.isFinite(next)) return true;
  return Math.abs(commanded - next) > ZOOM_COMMAND_EPSILON;
}

/** The inverse, for a readout that still speaks in feet. */
export function outerFtForZoom(zoom: number, latitude: number = REFERENCE_LAT): number {
  if (!Number.isFinite(zoom)) return 0;
  const metresPerPixel =
    (EQUATOR_METRES_PER_PIXEL * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  return (metresPerPixel * REFERENCE_PX) / METRES_PER_FOOT;
}
