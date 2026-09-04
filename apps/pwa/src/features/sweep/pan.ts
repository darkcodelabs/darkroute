/**
 * PAN - put a thumb on the scope and move it, then recentre.
 *
 * =============================================================================
 * WHAT IT IS FOR
 * =============================================================================
 * The scope is drawn around the vehicle, which is the right default and the
 * wrong only option. "What is over there" is a question a driver has, and
 * answering it by zooming out to 25 miles shows everything at once and nothing
 * usefully. Dragging the view is how every map answers it.
 *
 * Recentring is the other half and it has to be one obvious action, because a
 * panned scope is a LIED-TO scope: the vehicle is no longer in the middle, so
 * bearings read off the dial are wrong and the driver must be able to undo it
 * without thinking. Pressing RADAR - the key for the screen you are already on
 * - is that action.
 *
 * =============================================================================
 * WHY THE PAN IS IN DIAL UNITS AND NOT IN PIXELS
 * =============================================================================
 * Everything on the scope is placed in the 343-unit viewBox: the rings, the
 * markers, the vehicle. A pan held in pixels would have to be converted at
 * every use and would drift out of step with the drawing the moment the dial
 * is a different size on screen - which it is, because the bleed variant is
 * 132% of the column.
 *
 * Held in units, panning is one subtraction on the viewBox origin and the
 * entire scope moves together, correctly, at any size.
 *
 * =============================================================================
 * WHY IT IS BOUNDED
 * =============================================================================
 * An unbounded pan lets a driver drag the scope until it is empty, with no clue
 * which way is back. The clamp keeps the vehicle within one scope-width of the
 * view, so the thing you are is always at most one flick away.
 */

/**
 * The furthest the view may be dragged from the vehicle, in dial units.
 *
 * A MAP'S WORTH, not a nudge. This was 114 -- a third of the scope -- on the
 * reasoning that the vehicle should always stay on screen. What that actually
 * did was make panning pointless: at a one-mile range a third of the scope is
 * about a kilometre, and a camera tile is fifteen, so a driver could drag as
 * hard as they liked and never reach ground that had not already been loaded.
 * Measured: zero new tiles fetched after a full-width drag.
 *
 * A map lets you go and look. Twenty scope-widths is far enough to cross a
 * metro at a close zoom and still bounded, so a gesture cannot send the view
 * somewhere it would take a hundred tiles to fill.
 *
 * The vehicle leaving the screen is fine because getting back is one press:
 * RECENTRE appears in the map controls the moment the view is displaced, and
 * the RADAR key does it too.
 */
export const PAN_LIMIT_UNITS = 3_430;

export interface PanOffset {
  /** Positive x moves the VIEW right, which moves the scope left under it. */
  readonly x: number;
  readonly y: number;
}

export const NO_PAN: PanOffset = Object.freeze({ x: 0, y: 0 });

export function isPanned(pan: PanOffset): boolean {
  return pan.x !== 0 || pan.y !== 0;
}

function clampAxis(value: number): number {
  return Math.min(PAN_LIMIT_UNITS, Math.max(-PAN_LIMIT_UNITS, value));
}

export function clampPan(pan: PanOffset): PanOffset {
  return { x: clampAxis(pan.x), y: clampAxis(pan.y) };
}

/**
 * The pan after a drag, in dial units.
 *
 * `scale` converts screen pixels to dial units - the dial is `DIAL_UNITS`
 * across in its own coordinates and some other number of CSS pixels wide on
 * screen, so a 100px drag is a different number of units on a phone than on a
 * tablet. Passing it in keeps this function pure and testable.
 *
 * The sign is inverted on purpose: dragging the map RIGHT should reveal what is
 * to the LEFT, which is what direct manipulation means. Getting this backwards
 * is the single most common way a pan feels wrong.
 */
export function panFromDrag(
  start: PanOffset,
  dxPx: number,
  dyPx: number,
  scale: number,
): PanOffset {
  if (!Number.isFinite(scale) || scale <= 0) return start;
  return clampPan({
    x: start.x - dxPx / scale,
    y: start.y - dyPx / scale,
  });
}

/**
 * The viewBox for a given pan.
 *
 * NOT USED BY THE DIAL ANY MORE, and kept deliberately. The scope pans its
 * WORLD -- the roads and the contacts -- inside a fixed reticle, because
 * moving the window moved the rings and the vehicle with it and a ring is a
 * distance from the vehicle. A surface that really is a map, with no reticle
 * over it, wants exactly this function; the MAP screen is that surface.
 *
 * Panning is a translation of the ORIGIN, not a transform on the content: a
 * transform would need a wrapper element and an inline style, and would move
 * the markers out of step with the CSS-drawn lattice underneath them. Moving
 * the window instead moves everything drawn in these coordinates at once.
 */
export function pannedViewBox(pan: PanOffset, units: number): string {
  const x = Math.round(pan.x * 100) / 100;
  const y = Math.round(pan.y * 100) / 100;
  return `${String(x)} ${String(y)} ${String(units)} ${String(units)}`;
}

/**
 * How long a released pan is held before the scope returns to the vehicle.
 *
 * THIS WAS REMOVED ONCE AND THAT WAS THE WRONG CORRECTION. It was two seconds,
 * which yanked the map back while a driver was still looking at it. The
 * response was to delete the return entirely -- and then ANY stray gesture left
 * the scope displaced for good, with nothing on screen saying how to undo it.
 * Measured after the removal: a short flick of about fifty pixels moved the world to
 * `translate(0 -39.7)` and it was still there four seconds later.
 *
 * The fault was the duration, not the idea. Six seconds outlasts a look and
 * still self-corrects a gesture nobody meant to make.
 *
 * PANNING IS A GLANCE, NOT A MODE. A driver drags to see what is off to one
 * side, and then they are driving again - but a pan that stays put leaves the
 * scope permanently off-centre, with the vehicle in a corner and every ring
 * measuring from somewhere the driver is not. It reads as broken, and it is:
 * the instrument is lying about where you are relative to everything on it.
 *
 * Pressing RADAR still recentres immediately, for somebody who wants it now.
 */
export const PAN_RETURN_MS = 6_000;

/**
 * How far a finger must travel before the scope pans at all, in pixels.
 *
 * A tap on a camera, and the small slide that comes with any real tap, must
 * move nothing. So must the flick a driver makes trying to scroll a page --
 * which is where the displacement was coming from: the whole map shifted
 * because somebody swiped at a screen that does not scroll.
 *
 * Two dozen pixels: past a tap's slop and well short of a deliberate drag.
 */
export const PAN_START_PX = 24;

/** Feet per degree of latitude. Constant enough at any scale this draws. */
const FEET_PER_DEGREE_LAT = 364_000;

export interface ViewCentre {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Where the VIEW is centred on the ground, which is not where the vehicle is.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * Cameras and roads are fetched for the tile the VEHICLE is in. That is right
 * while the view is centred on the vehicle and wrong the moment it is not:
 * panning moves the window over the world, and the world outside the vehicle's
 * own tiles was never loaded, so dragging revealed emptiness. A map loads what
 * the viewer is looking at, not what the driver is standing on.
 *
 * This turns a pan offset back into a position so the loaders can follow the
 * window.
 *
 * =============================================================================
 * THE THREE CONVERSIONS, IN ORDER
 * =============================================================================
 *   1. DIAL UNITS TO FEET. The scale is proportional -- `radiusForDistanceFt`
 *      maps the full range onto `OUTER_RADIUS` -- so one unit is
 *      `outerFt / OUTER_RADIUS` feet.
 *
 *   2. SCREEN TO GROUND. The scope is heading-up, so screen-up is the heading,
 *      not north. The offset is rotated back by the heading before it means
 *      anything on the ground. Skipping this is silent and looks almost right:
 *      the view would load the wrong side of the road whenever the vehicle was
 *      not pointing north.
 *
 *   3. FEET TO DEGREES. Latitude is a constant; longitude shortens with the
 *      cosine of latitude, and ignoring that puts the centre measurably east or
 *      west at any latitude this runs at.
 */
export function viewCentre(
  origin: ViewCentre,
  pan: PanOffset,
  outerFt: number,
  outerRadiusUnits: number,
  headingDeg: number | null,
): ViewCentre {
  if (!isPanned(pan)) return origin;
  if (outerRadiusUnits <= 0 || !Number.isFinite(outerFt) || outerFt <= 0) return origin;

  const feetPerUnit = outerFt / outerRadiusUnits;
  // Screen axes: +x is right, +y is DOWN. Panning the view right means looking
  // further right, so the centre moves right; y is inverted into "up-screen".
  const rightFt = pan.x * feetPerUnit;
  const upFt = -pan.y * feetPerUnit;

  // Screen-up is the heading on a heading-up scope, and north when there is no
  // heading to be up.
  const headingRad = ((headingDeg ?? 0) * Math.PI) / 180;
  const northFt = upFt * Math.cos(headingRad) - rightFt * Math.sin(headingRad) * -1;
  const eastFt = upFt * Math.sin(headingRad) + rightFt * Math.cos(headingRad);

  const feetPerDegreeLon = FEET_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  if (!Number.isFinite(feetPerDegreeLon) || feetPerDegreeLon === 0) return origin;

  return {
    lat: origin.lat + northFt / FEET_PER_DEGREE_LAT,
    lon: origin.lon + eastFt / feetPerDegreeLon,
  };
}

// ---------------------------------------------------------------------------
// How far the viewport can see
// ---------------------------------------------------------------------------

/**
 * How many outer-ring radii the frame reaches from its own centre.
 *
 * The dial's viewBox is a square of side `2 * OUTER_RADIUS`, drawn with
 * `slice`, so on a phone the SHORT axis fills the frame and the long axis
 * shows MORE world than the square holds -- about 2.2 radii on a 390x844
 * screen. 2.6 covers that, plus the corners of the square (a factor of 1.41 on
 * its own), plus a margin so nothing pops in at the edge mid-drag.
 *
 * Being generous here costs geometry that is clipped away unseen. Being mean
 * costs a visible edge, which is the whole bug.
 */
export const FRAME_REACH_RADII = 2.6;

/**
 * The furthest a drawn thing can be FROM THE VEHICLE and still be on screen.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * Everything is placed by its distance and bearing from the vehicle, which is
 * correct and stays. What is NOT correct is deciding what to draw by that same
 * distance: the viewport is not centred on the vehicle once the driver drags
 * it, so "within the range of the car" and "on the screen" stopped meaning the
 * same thing, and using the first as the second drew the data inside a circle
 * that slid around under the pan.
 *
 * This is the honest version of the question. The frame centre sits `|pan|`
 * units from the vehicle, the frame reaches `FRAME_REACH_RADII` beyond its own
 * centre, so anything within the sum of the two might be visible -- and
 * anything past it certainly is not.
 *
 * The result is deliberately a slight over-estimate: the pan is a vector and
 * this treats it as a radius, so it keeps a little geometry behind the driver
 * that could have been dropped. Clipping is cheap; a hole is not.
 */
export function reachFt(outerFt: number, pan: PanOffset, outerRadiusUnits: number): number {
  if (!Number.isFinite(outerFt) || outerFt <= 0) return 0;
  if (!Number.isFinite(outerRadiusUnits) || outerRadiusUnits <= 0) return outerFt;
  const panUnits = Math.hypot(pan.x, pan.y);
  const radii = FRAME_REACH_RADII + (Number.isFinite(panUnits) ? panUnits / outerRadiusUnits : 0);
  return outerFt * radii;
}

// ---------------------------------------------------------------------------
// Zooming about a point that is not the vehicle
// ---------------------------------------------------------------------------

/**
 * The pan that keeps one point of the map still while the range changes.
 *
 * =============================================================================
 * THE BUG THIS EXISTS FOR
 * =============================================================================
 * Zooming scales every position about the VEHICLE, because the vehicle is where
 * the coordinate system has its origin. That is correct arithmetic and the
 * wrong behaviour: put two fingers on a cluster half a screen to the left,
 * pinch in, and the cluster is thrown further left and off the edge -- the one
 * thing on screen you were trying to look at is the thing the gesture pushes
 * away. Reported exactly that way, with two screenshots of a cluster leaving.
 *
 * Every map zooms about the GESTURE instead. The point under the fingers stays
 * under the fingers; everything else moves around it.
 *
 * =============================================================================
 * THE ARITHMETIC
 * =============================================================================
 * A world point `w` renders at `w - pan`. Zooming by `k` about `centre` sends
 * `w` to `centre + (w - centre) * k`. Holding the frame position `f` still:
 *
 *     w  = f + pan                    (what is under the fingers now)
 *     w' = centre + (w - centre) * k  (where the zoom sends it)
 *     pan' = w' - f                   (what keeps it at f)
 *
 * With `focus` at the frame centre this reduces to `pan * k`, which is the
 * right answer for the +/- keys: they zoom about the middle of the screen, and
 * a panned map has to be scaled with everything else or it slides.
 */
export function panForZoom(
  pan: PanOffset,
  focus: { readonly x: number; readonly y: number },
  magnification: number,
  centre: number,
): PanOffset {
  if (!Number.isFinite(magnification) || magnification <= 0) return pan;
  if (!Number.isFinite(focus.x) || !Number.isFinite(focus.y)) return pan;
  return clampPan({
    x: centre + (focus.x + pan.x - centre) * magnification - focus.x,
    y: centre + (focus.y + pan.y - centre) * magnification - focus.y,
  });
}
