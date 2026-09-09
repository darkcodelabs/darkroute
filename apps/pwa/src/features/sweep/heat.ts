/**
 * THE COVERAGE FIELD - surveillance drawn as weather, not as pins.
 *
 * =============================================================================
 * WHY THIS REPLACED THE CONSTELLATION, AND THE COUNT BEFORE IT
 * =============================================================================
 * Three attempts at the same question -- "what does a lot of cameras in one
 * place look like" -- and the first two answered a different question:
 *
 *   A COUNT (`8`) said how many and nothing about where, and it promised a
 *   record that a tap could not deliver, because eight cameras have no single
 *   INTEL CARD between them.
 *
 *   A CONSTELLATION drew the members joined to a centre. Honest, but it read
 *   as a starburst -- spikes stuck through a blip -- and it still framed the
 *   group as an object with parts rather than as a CONDITION of the ground.
 *
 * What a driver needs off a glance is not an inventory. It is "come through
 * here and you are going to be seen", which is a statement about an AREA, and
 * areas are what weather maps are for. A storm cell is not drawn as a list of
 * raindrops with a number beside it.
 *
 * So: every camera is one small dot, drawn where it is, and underneath them a
 * field that adds up their reach. Two cameras far apart are two faint patches;
 * twenty along a corridor are one bright band you can see from across the car.
 * Nothing is merged, nothing is hidden, and every dot is still individually
 * tappable -- which is the other thing the count got wrong.
 *
 * =============================================================================
 * WHY IT IS A CANVAS AND NOT MORE SVG
 * =============================================================================
 * The field is overlapping translucent blobs, which is exactly the workload a
 * compositor is worst at: every SVG node was a gradient-filled circle 3.4x the
 * radius of its own dot, and fifty of them overlapping is fifty full-area
 * blends per frame behind an animating scope. That is where the frame time
 * went, and it is why performance was reported as bad on a real phone.
 *
 * One canvas draws the whole field in one pass with `lighter` compositing, at
 * whatever resolution the device can afford, and hands the compositor a single
 * texture. The dots stay in SVG, because they are the part that has to be hit-
 * tested, labelled and focused.
 *
 * =============================================================================
 * WHAT THE FIELD DOES NOT CLAIM
 * =============================================================================
 * The radius is a DRAWING radius, not a detection range. An ALPR's real read
 * distance depends on the lens, the mount, the plate and the light, and this
 * app does not know any of them. The field says "cameras are dense here",
 * which is a claim the data supports; it must never be read as "you are
 * captured inside this circle", which it does not.
 */

/**
 * How much GROUND one camera's contribution covers, in feet.
 *
 * =============================================================================
 * WHY THIS IS A DISTANCE AND NOT A FRACTION OF THE SCREEN
 * =============================================================================
 * It was a fraction of the ring radius, so a blob was the same SIZE ON SCREEN
 * at every zoom. That sounds reasonable and it destroys the thing the field is
 * for: zoom out to the whole metro and every blob covers miles of ground, so a
 * city's worth of cameras merges into one orange lump sitting on the vehicle.
 * Reported, correctly, as "this doesn't seem data driven like at all" -- and it
 * was not, because at that zoom the picture no longer depended on where the
 * cameras were, only on how many were near the middle.
 *
 * A camera covers a piece of GROUND. Half a mile of it, held constant in feet,
 * so zooming out shrinks the blobs and the real distribution appears -- dense
 * along the commercial corridors, thin on the residential grid between them --
 * and zooming in grows them until a single junction is one hot cell.
 *
 * That is what makes it a map of the data rather than a map of the viewport.
 */
export const HEAT_GROUND_FT = 2_640;

/**
 * Bounds on that, in dial units.
 *
 * The floor keeps a blob from collapsing to a point at the widest range -- at
 * 25 miles half a mile of ground is about three units, which is smaller than a
 * marker and would read as noise rather than as weather. The ceiling stops a
 * close-in scope painting one wash over the whole screen.
 */
export const HEAT_RADIUS_MIN_UNITS = 5;
export const HEAT_RADIUS_MAX_UNITS = 44;

/**
 * How much one camera contributes at its centre, 0..1.
 *
 * =============================================================================
 * TUNED AGAINST A MEASUREMENT, NOT AGAINST A FEELING
 * =============================================================================
 * This started at 0.13, on the theory that one camera should be a smudge you
 * could easily miss and only overlaps should be loud. Measured on the deployed
 * scope, that theory produced a field that was not there: hiding the canvas and
 * diffing the two screenshots changed 0.29 % OF THE PIXELS. Working through it,
 * a lone camera painted its colour at alpha 32/255, which over black is about
 * RGB(10, 25, 23) -- a value nobody can distinguish from the background.
 *
 * A field that cannot be seen is worse than no field, because the density it
 * was drawn to communicate now looks like empty ground.
 *
 * "Lightly coloured" is still the brief. It is a wash under the markers, not a
 * layer over them -- but a visible one.
 */
export const HEAT_PEAK_ALPHA = 0.05;

/**
 * Past this many overlapping cameras the field stops getting brighter.
 *
 * THE CEILING HAS A HARD LIMIT, AND FIVE WAS PAST IT.
 *
 * Density accumulates in the alpha CHANNEL, which is a byte: it stops at 255
 * however many cameras overlap. So the ceiling -- `HEAT_PEAK_ALPHA * this *
 * 255` -- has to stay under 255 or the top of the ramp is unreachable, and it
 * has to stay well under the typical overlap count or the top of the ramp is
 * reached everywhere.
 *
 * At 0.3 x 5 the ceiling was 382, so a mere five overlapping cameras pinned the
 * density at 1 -- and in a metro almost every point has five. The result was a
 * single flat red slab over the whole city with no gradient in it at all, which
 * is the same failure as the invisible version wearing the opposite colour.
 *
 * 0.05 x 18 puts the ceiling at 229 -- inside the byte, with real headroom. One
 * camera is a faint wash, six is mid-ramp, eighteen is the hot end.
 */
export const HEAT_SATURATION = 18;

/**
 * The field's alpha at full density, 0..255, and how fast it gets there.
 *
 * The exponent lifts the LOW end: a single camera is the most common case on
 * the map and a linear curve left it invisible. Below 1 it rises steeply at
 * first and flattens, so one camera reads and ten do not simply saturate to a
 * white blob.
 */
export const HEAT_MAX_ALPHA = 170;
export const HEAT_ALPHA_CURVE = 0.35;

export interface HeatPoint {
  readonly cx: number;
  readonly cy: number;
}

/**
 * The drawing radius for one camera, in dial units.
 *
 * `HEAT_GROUND_FT` of real ground, converted through the scope's own scale, so
 * the blob is a piece of the WORLD rather than a piece of the screen. Zooming
 * out therefore shrinks it and the distribution appears; zooming in grows it
 * until a junction is one cell.
 */
export function heatRadiusUnits(outerRadiusUnits: number, outerFt: number): number {
  if (!Number.isFinite(outerRadiusUnits) || outerRadiusUnits <= 0) {
    return HEAT_RADIUS_MIN_UNITS;
  }
  if (!Number.isFinite(outerFt) || outerFt <= 0) return HEAT_RADIUS_MIN_UNITS;
  const raw = (HEAT_GROUND_FT / outerFt) * outerRadiusUnits;
  return Math.min(HEAT_RADIUS_MAX_UNITS, Math.max(HEAT_RADIUS_MIN_UNITS, raw));
}

/**
 * The colour the field takes at a given density, as `r, g, b` channels.
 *
 * THE PLASMA RAMP, RUN BACKWARDS.
 *
 * It was a separate teal-amber-red ramp, on the reasoning that the dots are
 * coloured by DISTANCE and the field by DENSITY, and two different facts should
 * not share a palette. That reasoning is wrong in practice: what it produced
 * was a map with two unrelated colour languages on it at once, and a reader has
 * to learn both before either means anything.
 *
 * One palette. Plasma reversed, so density runs the same direction heat always
 * does: the far/cool end of the ramp (pale blue) for sparse ground, through
 * violet and magenta, to the near/hot end (orange, then yellow-white) where a
 * corridor is lined with cameras. Sparse is cold, dense is incandescent, and it
 * is the same eleven colours the markers are already drawn in.
 */
export type HeatStop = readonly [number, number, number];

/**
 * The ramp, if the tokens cannot be read.
 *
 * The eleven `--fwm-plasma-*` tokens, reversed, written out. They are a
 * FALLBACK and not the source of truth: `HeatLayer` reads the live token
 * values and passes them in, so a theme that restates plasma restates the
 * weather with it. Duplicating them here is only so a canvas in an environment
 * with no computed styles still paints something recognisable.
 */
export const HEAT_STOPS_FALLBACK: readonly HeatStop[] = Object.freeze([
  [127, 196, 255],
  [158, 155, 255],
  [182, 129, 242],
  [200, 107, 216],
  [212, 91, 174],
  [219, 79, 134],
  [225, 100, 98],
  [245, 138, 71],
  [252, 166, 54],
  [253, 202, 38],
  [240, 249, 33],
]);

export function heatColour(
  density: number,
  stops: readonly HeatStop[] = HEAT_STOPS_FALLBACK,
): readonly [number, number, number] {
  // NaN survives BOTH Math.min and Math.max, so the usual clamp idiom does not
  // clamp it -- it hands NaN straight through to the channel arithmetic and
  // paints garbage. Checked first, and treated as full density, because the
  // safe failure for a surveillance warning is the loud one.
  const t = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 1;
  if (stops.length === 0) return [255, 255, 255];
  if (stops.length === 1) return stops[0] ?? [255, 255, 255];
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const from = stops[index] ?? stops[0];
  const to = stops[index + 1] ?? stops[stops.length - 1];
  if (from === undefined || to === undefined) return [255, 255, 255];
  return [
    Math.round(from[0] + (to[0] - from[0]) * local),
    Math.round(from[1] + (to[1] - from[1]) * local),
    Math.round(from[2] + (to[2] - from[2]) * local),
  ];
}

/**
 * Paint the field.
 *
 * TWO PASSES, AND THEY CANNOT BE ONE. The first accumulates density in the
 * alpha channel with `lighter`, which is what makes overlaps add up. The second
 * reads that back and replaces it with the ramp, which is what turns a pile of
 * translucent smudges into weather. Colouring during the first pass instead
 * would blend the COLOURS -- teal over teal is still teal, however many there
 * are, so a corridor would never go hot.
 *
 * `deviceScale` is applied to the canvas backing store rather than to the
 * geometry, so the field is drawn once at the device's real resolution and the
 * coordinates stay in dial units like everything else on the scope.
 */
export function paintHeat(
  context: CanvasRenderingContext2D,
  points: readonly HeatPoint[],
  options: {
    readonly widthUnits: number;
    readonly heightUnits: number;
    readonly radiusUnits: number;
    readonly deviceScale: number;
    /**
     * The canvas's top-left corner IN DIAL UNITS.
     *
     * The field is not the viewBox. The scope is drawn `slice` and culls at
     * `FRAME_REACH_RADII`, so the world a driver can see runs well outside the
     * nominal 0..DIAL_UNITS box -- at a close range EVERY visible camera is
     * outside it. A canvas sized to the viewBox therefore painted an empty
     * texture while the markers were all off its edges, which is exactly what
     * happened: the field measured 0% painted with 27 cameras on screen.
     */
    readonly originX?: number | undefined;
    readonly originY?: number | undefined;
    /** The ramp, read off the design tokens by the caller. */
    readonly stops?: readonly HeatStop[] | undefined;
  },
): void {
  const { widthUnits, heightUnits, radiusUnits, deviceScale } = options;
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const stops = options.stops ?? HEAT_STOPS_FALLBACK;
  const pixelWidth = Math.max(1, Math.round(widthUnits * deviceScale));
  const pixelHeight = Math.max(1, Math.round(heightUnits * deviceScale));

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  if (points.length === 0) return;

  // Dial units in, canvas pixels out: shift the world so the canvas's corner
  // is the origin, then scale to the backing store.
  context.setTransform(deviceScale, 0, 0, deviceScale, -originX * deviceScale, -originY * deviceScale);

  // --- pass one: density ---------------------------------------------------
  context.globalCompositeOperation = 'lighter';
  for (const point of points) {
    const gradient = context.createRadialGradient(
      point.cx,
      point.cy,
      0,
      point.cx,
      point.cy,
      radiusUnits,
    );
    gradient.addColorStop(0, `rgba(255, 255, 255, ${String(HEAT_PEAK_ALPHA)})`);
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(point.cx, point.cy, radiusUnits, 0, Math.PI * 2);
    context.fill();
  }

  // --- pass two: the ramp --------------------------------------------------
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'source-over';
  const image = context.getImageData(0, 0, pixelWidth, pixelHeight);
  const data = image.data;
  const ceiling = HEAT_PEAK_ALPHA * HEAT_SATURATION * 255;

  for (let i = 0; i < data.length; i += 4) {
    const accumulated = data[i + 3] ?? 0;
    if (accumulated === 0) continue;
    const density = Math.min(1, accumulated / ceiling);
    const [r, g, b] = heatColour(density, stops);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    // The alpha curve lifts the low end so a LONE camera is visible -- see
    // HEAT_ALPHA_CURVE. It is still a curve and not a step: the field has to
    // keep a gradient across it or it stops saying anything about density.
    data[i + 3] = Math.round(Math.min(1, density ** HEAT_ALPHA_CURVE) * HEAT_MAX_ALPHA);
  }
  context.putImageData(image, 0, 0);
}
