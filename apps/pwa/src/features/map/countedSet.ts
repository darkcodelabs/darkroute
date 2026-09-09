/**
 * THE SET THE DOCK IS COUNTING, AS A SHAPE ON THE GROUND.
 *
 * =============================================================================
 * THE COMPLAINT
 * =============================================================================
 * The dock says "14 cameras within 2 mi" and offers to route around those
 * fourteen. The map draws several hundred dots. Nothing connects the two, so
 * the driver's own words were: "I can't tell what cameras on the map are the
 * ones in the list."
 *
 * =============================================================================
 * WHY A HULL AND NOT A LINE THROUGH THEM
 * =============================================================================
 * A polyline threaded through the fourteen would imply an ORDER and a PATH
 * between them that does not exist -- and on a map that already draws a real
 * cyan route line, a second line reads as a second route. That is drawing a
 * journey nobody is taking.
 *
 * The CONVEX HULL is literally "the geometry of what those 14 look like": it
 * says where the counted ground is and how big it is, and it implies nothing
 * about order, sequence or travel. A RING on each member then answers the
 * other half of the question -- which dots are the ones being counted.
 *
 * Nothing else. No labels, no numerals on the map, no animation. The map is
 * already busy and the numeral is already on the dock.
 *
 * =============================================================================
 * WHY THESE TWO CONSTANTS ARE HERE AND NOT IMPORTED -- READ BEFORE CHANGING
 * =============================================================================
 * The set is `features/dock/useDockState.ts`'s: `DOCK_DETOUR_FT` (2 mi) and
 * `DENSE_COUNT` (10) are the same two numbers, and the dock's own note says
 * "One set, one number: `Around 12` beside the numeral 12 is the same twelve
 * readers, not a second measurement that could disagree with it."
 *
 * The map must not import them. The dock is chrome; a map that reaches into it
 * for a radius has been coupled to the surface drawn on top of it, and the next
 * screen that wants the same hull has to import the dock too.
 *
 * So there are two copies of one fact, which is exactly the setup that drifts,
 * and the honest fix is NOT this file: `detourCameras` and its radius belong in
 * `stores/cameras.ts` as a selector both halves read -- the store is where the
 * assessments already live, and neither the dock nor the map would then own a
 * distance. That is a hand-off, not a decision this file can make; the store is
 * not the map's to edit. Until it happens, `countedSet.test.ts` pins both
 * numbers against the dock's, so a change to either side fails a test rather
 * than quietly drawing a hull around a different fourteen.
 */

/** Feet in a mile. The dock declares its own; see the note above. */
const FT_PER_MILE = 5280;

/**
 * The radius the dock counts within. `DOCK_DETOUR_FT` is the same figure.
 *
 * Two miles because the detour planner is sized by its farthest input, which is
 * the reason the dock picked it -- the count, the `Around N` key and the plan
 * are all one set, and so is this hull.
 */
export const COUNTED_RADIUS_FT = 2 * FT_PER_MILE;

/**
 * How many make a set worth drawing. `DENSE_COUNT` is the same figure.
 *
 * BELOW THIS THERE IS NO LIST. The dock only puts a count on screen once ten
 * readers are inside the radius; a hull drawn around three would be the map
 * indicating a set the driver was never told about, and it would be drawn
 * almost everywhere. Ten keeps "nothing is counted" the common case, which is
 * what makes the empty path free.
 */
export const COUNTED_MIN = 10;

/** Shared and frozen: the empty case is the common one and allocates nothing. */
const NO_MEMBERS: readonly never[] = Object.freeze([]);

/** One member of the counted set, as the map needs it. */
export interface CountedMember {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * The counted set, or nothing.
 *
 * GENERIC AND A FILTER, NOT A PREFIX SCAN. The store's assessments are
 * nearest-first, so stopping at the first camera past the radius would be
 * cheaper -- and it would silently disagree with the dock the day anything
 * reorders them, drawing a hull around a subset of the number on screen. The
 * dock's `detourCameras` is a filter; this is the same filter, so the two
 * cannot answer differently.
 */
export function countedCameras<T extends { readonly distanceFt: number }>(
  assessments: readonly T[],
): readonly T[] {
  const within = assessments.filter((camera) => camera.distanceFt <= COUNTED_RADIUS_FT);
  return within.length >= COUNTED_MIN ? within : NO_MEMBERS;
}

/**
 * Is this the same set of readers as last time?
 *
 * WHAT THIS SAVES. The members do not move; only the vehicle does. So the hull
 * and the rings are unchanged for as long as the MEMBERSHIP is unchanged, and
 * membership only changes when a camera crosses the two-mile line -- rarely,
 * next to once a second. Everything downstream of this (building the geometry,
 * `setData`, a MapLibre re-tile) is skipped on every tick that answers true.
 *
 * By id and not by count: a set that gains one reader and loses another has the
 * same count and a different shape.
 */
export function sameMembership(
  members: readonly { readonly id: string }[],
  previous: ReadonlySet<string>,
): boolean {
  if (members.length !== previous.size) return false;
  for (const member of members) {
    if (!previous.has(member.id)) return false;
  }
  return true;
}

/** `[lon, lat]`, which is GeoJSON's order and the order that bites. */
type Point = readonly [number, number];

/**
 * Twice the signed area of the triangle o->a->b. Positive is a left turn.
 */
function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** One monotone chain, with every clockwise and collinear point dropped. */
function chainOf(sorted: readonly Point[]): Point[] {
  const chain: Point[] = [];
  for (const point of sorted) {
    for (;;) {
      const back = chain[chain.length - 2];
      const last = chain[chain.length - 1];
      if (back === undefined || last === undefined) break;
      if (cross(back, last, point) > 0) break;
      chain.pop();
    }
    chain.push(point);
  }
  // The last point of each chain is the first of the other one, and a ring
  // that repeats it doubles two vertices.
  chain.pop();
  return chain;
}

/**
 * The convex hull of a set of positions, counter-clockwise.
 *
 * Andrew's monotone chain: sort, then walk the lower and upper halves dropping
 * any point that does not turn left. O(n log n), and n here is fourteen.
 *
 * =========================================================================
 * IN LON/LAT, NOT IN PROJECTED PIXELS, AND WHY THAT IS FINE HERE
 * =========================================================================
 * Web Mercator's y is a non-linear function of latitude, so a hull computed in
 * degrees is not exactly the hull of the projected points. Over the two miles
 * this is ever drawn across, the curvature that would move a vertex is far
 * below a pixel at any zoom the app allows. Doing it in world coordinates is
 * what keeps the shape a piece of GROUND: it is correct at every zoom, and it
 * does not have to be recomputed when the driver pinches.
 *
 * Fewer than three distinct positions, or a set that is exactly collinear,
 * has no hull to draw. Empty, not a degenerate sliver.
 */
export function convexHull(input: readonly Point[]): readonly Point[] {
  const sorted = [...input].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique: Point[] = [];
  for (const point of sorted) {
    const last = unique[unique.length - 1];
    if (last !== undefined && last[0] === point[0] && last[1] === point[1]) continue;
    unique.push(point);
  }
  if (unique.length < 3) return [];
  const hull = [...chainOf(unique), ...chainOf([...unique].reverse())];
  return hull.length < 3 ? [] : hull;
}

/**
 * The counted set as one GeoJSON collection: the hull, then every member.
 *
 * ONE SOURCE FOR BOTH LAYERS. The hull is the only LineString in it and the
 * members are the only Points, so the two layers separate themselves with a
 * `geometry-type` filter and the map does one `setData` per change rather than
 * two. See `countedHullLayer` and `countedRingLayer`.
 *
 * A position that is not finite is dropped rather than placed at null island,
 * the same rule `toFeatureCollection` follows -- and dropping it BEFORE the
 * hull matters, because one NaN poisons the sort and takes the whole shape out.
 */
export function countedGeometry(
  members: readonly CountedMember[],
  /** The dock's own tier word for this set, drawn inside the shaded area. */
  label?: string,
): unknown {
  const features: unknown[] = [];
  const points: Point[] = [];

  for (const member of members) {
    if (!Number.isFinite(member.lat) || !Number.isFinite(member.lon)) continue;
    points.push([member.lon, member.lat]);
    features.push({
      type: 'Feature',
      id: member.id,
      properties: { id: member.id },
      geometry: { type: 'Point', coordinates: [member.lon, member.lat] },
    });
  }

  const hull = convexHull(points);
  if (hull.length >= 3) {
    const first = hull[0];
    const ring = first === undefined ? hull : [...hull, first];

    /*
     * THE SHADED AREA, and its word.
     *
     * The hairline alone drew a shape and said nothing, so the map showed a
     * faint triangle over a suburb and the dock said `14 cameras within 2 mi ·
     * exposure high` with no visible connection between the two. Filling the
     * same ground in the same amber and writing the dock's own tier word inside
     * it is what makes them one statement instead of two.
     *
     * A POLYGON AS WELL AS THE LINE, not instead of it. MapLibre's `fill` has
     * no stroke worth the name - `fill-outline-color` is a hairline with no
     * width control and no join control - so the crisp edge stays a `line` and
     * the fill goes underneath it. One source, three geometry types, three
     * filters.
     *
     * `label` is carried as a PROPERTY rather than looked up at draw time,
     * because this module deliberately does not import the dock: see the
     * header. The caller passes the word the dock is showing, so the two cannot
     * drift into disagreeing about the same set.
     */
    features.unshift({
      type: 'Feature',
      properties: label === undefined ? {} : { label },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });

    features.unshift({
      type: 'Feature',
      properties: {},
      geometry: {
        // Closed by repeating the first vertex, which is what makes it a ring
        // rather than an arc with a gap in one side.
        type: 'LineString',
        coordinates: ring,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}
