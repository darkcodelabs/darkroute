/**
 * THE MINI MAP'S ARITHMETIC - everything about the picture that is not GL.
 *
 * `MiniMap.tsx` owns a MapLibre instance and a WebGL context, neither of which
 * a unit test can look at. Every DECISION the picture makes is here instead:
 * how close it sits to the ground, which way the lens is drawn to be looking,
 * and what the caption is allowed to claim about the ground under the mark.
 *
 * Pure, and deliberately importing nothing. It is read by the card's view model
 * as well as by the component, and the model does no I/O by contract.
 */

/**
 * HOW CLOSE THE PICTURE SITS TO THE GROUND.
 *
 * Web Mercator resolution is `156543.03 * cos(lat) / 2^zoom` metres per pixel.
 * At zoom 16 and latitude 39 -- Kansas City, the archive's densest corner --
 * that is 1.86 m/px, so the 112px box the card draws spans about 208 metres:
 * the camera, its junction, and the block either side of it.
 *
 * One step out (z15) spans 415 m, which turns a junction into a neighbourhood
 * and stops answering "which corner is it on". One step in (z17) spans 104 m,
 * which is a picture of the pole and no context at all. The useful reading is
 * the one that shows the intersection the camera is watching, and that is 16.
 *
 * NOT the scope's `DEFAULT_ZOOM` of 14. That is a driving zoom, chosen for a
 * full-screen map moving at 60 mph; borrowing it here would draw four
 * kilometres of nothing into a thumbnail.
 */
export const MINI_MAP_ZOOM = 16;

/**
 * HOW WIDE A FACING MARK IS, when the mapper wrote a bearing rather than an arc.
 *
 * 60 degrees, which is the SWEEP PRIMITIVES figure ("facing arc: 60 deg stroke
 * 3px, hue of dot") and the same number `sweep/geometry.ts` still carries as
 * `FACING_ARC_SPAN_DEG`. Not imported from there: the dial no longer draws the
 * arc at all -- v2 removed it because a scope full of contacts drew overlapping
 * broken rings that "read as damage" -- so importing it would tie a live
 * feature to a dead one.
 *
 * The dial's reason for dropping it does not apply here. There is exactly ONE
 * camera in this picture, so there is nothing for its cone to overlap, and
 * "which way is it pointing" is the question the card exists to answer.
 *
 * It is an approximation and it is drawn as one - a soft cone, not a beam -
 * because `direction=90` says where the lens points and says nothing whatever
 * about the lens's field of view.
 */
export const FACING_SPAN_DEG = 60;

/** One drawn cone: compass degrees, clockwise from `fromDeg` to `toDeg`. */
export interface FacingSpan {
  readonly fromDeg: number;
  readonly toDeg: number;
}

/**
 * What the mapper wrote, in the shape this module reads it.
 *
 * Structural on purpose, so `intelState.ts`'s `CoveredDirection` fits without
 * either module importing the other: this one stays pure geometry, and the
 * card's model keeps the single reading of what the OSM tags mean.
 */
export interface BearingLike {
  readonly kind: 'bearing';
  readonly deg: number;
}

export interface ArcLike {
  readonly kind: 'arc';
  readonly fromDeg: number;
  readonly toDeg: number;
}

export type CoveredLike = BearingLike | ArcLike;

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function centredSpan(deg: number): FacingSpan {
  const half = FACING_SPAN_DEG / 2;
  return { fromDeg: wrap360(deg - half), toDeg: wrap360(deg + half) };
}

/**
 * The cones to draw for one camera.
 *
 * EVERY direction the mapper wrote, not just the derived one. 3.37% of records
 * carry an arc (`338-23`) and some carry a semicolon list, and the FACING tile
 * directly above this picture already says how many there are ("041 +2") -- a
 * picture that drew one of three would contradict the tile beside it.
 *
 * `primaryDeg` is the record's own `directionDeg`, and it is the FALLBACK
 * rather than the preference: it is derived at build time, so a record can
 * carry it with no `direction` tag left to read.
 *
 * An empty result is the honest answer for the majority of records. Nothing is
 * drawn then, and the card says nothing about where the lens points.
 */
export function facingSpans(
  covered: readonly CoveredLike[],
  primaryDeg: number | null,
): readonly FacingSpan[] {
  const out: FacingSpan[] = [];
  for (const direction of covered) {
    if (direction.kind === 'arc') {
      const from = wrap360(direction.fromDeg);
      const to = wrap360(direction.toDeg);
      // An arc of zero width is not a fact about a camera, it is a typo in the
      // tag. Drawn as the default cone rather than as an invisible sliver.
      out.push(from === to ? centredSpan(from) : { fromDeg: from, toDeg: to });
      continue;
    }
    if (!Number.isFinite(direction.deg)) continue;
    out.push(centredSpan(direction.deg));
  }
  if (out.length > 0) return out;
  if (primaryDeg === null || !Number.isFinite(primaryDeg)) return [];
  return [centredSpan(primaryDeg)];
}

/**
 * A cone as an SVG path, in a viewBox whose origin is the camera.
 *
 * Compass convention, not screen convention: 0 is north, which is UP because
 * the picture is north-up and cannot be rotated. So a bearing runs
 * `x = r sin(deg)`, `y = -r cos(deg)`, and the arc's sweep flag is 1 -- angles
 * increase clockwise, the way a compass does and the way SVG's y-down space
 * happens to as well.
 *
 * `A` rather than a polygon approximation: an arc command is exact at any size,
 * and this is drawn at 112 CSS px on a 3x phone where a twelve-segment fan
 * shows its corners.
 */
export function conePath(span: FacingSpan, radius: number): string {
  const width = wrap360(span.toDeg - span.fromDeg);
  const start = point(span.fromDeg, radius);
  const end = point(span.toDeg, radius);
  // large-arc-flag: a span past a half turn has to say so or SVG draws the
  // SHORT way round, which turns a camera watching most of a junction into one
  // watching the sliver it cannot see.
  const largeArc = width > 180 ? 1 : 0;
  return `M 0 0 L ${start} A ${round(radius)} ${round(radius)} 0 ${String(largeArc)} 1 ${end} Z`;
}

function point(deg: number, radius: number): string {
  const radians = (wrap360(deg) * Math.PI) / 180;
  return `${round(radius * Math.sin(radians))} ${round(-radius * Math.cos(radians))}`;
}

/** Two decimals. A path is a string, and 14 digits of float noise is 14 bytes. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * WHAT THE PICTURE IS ACTUALLY SHOWING.
 *
 *   pending  the map is still resolving. Nothing is claimed either way.
 *   ground   the archive answered and features were painted.
 *   bare     no ground under the mark: no archive configured, the tiles for
 *            this area are not cached and cannot be fetched, or the map
 *            settled with nothing on it.
 *
 * `bare` is a first-class state rather than an error. This app is used in dead
 * zones by design, and a driver looking at a camera in one is entitled to the
 * mark and the honest caption instead of a spinner that never resolves.
 */
export type MiniMapGround = 'pending' | 'ground' | 'bare';

/**
 * The caption, which is the whole degrade story in one line.
 *
 * `ground` prints the attribution rather than a status: the tiles are ODbL and
 * the licence is a condition of drawing them, and a line that says "map loaded"
 * tells the reader something they can already see. `bare` says what is missing,
 * because a mark floating on flat colour with no explanation reads as a bug.
 */
export const GROUND_NOTE: Readonly<Record<MiniMapGround, string>> = Object.freeze({
  pending: '',
  ground: '© OpenStreetMap',
  bare: 'no map cached here',
});

/**
 * The same notes for a picture whose SCREEN already credits OpenStreetMap.
 *
 * ODbL wants the credit on the surface the tiles are drawn on. It does not want
 * it twice: the DRIVE card stands on top of the scope, and the scope carries
 * MapLibre's own attribution control (`MapCanvas.tsx`), so a caption under the
 * thumbnail was the same screen saying it a second time in smaller type.
 *
 * Only the ATTRIBUTION drops. `bare` still speaks, because "no map cached here"
 * is not a credit - it is the picture admitting the ground is missing, which is
 * the one thing a driver in a dead zone needs it to say, and the scope behind it
 * cannot say it for this camera.
 */
export const GROUND_NOTE_CREDITED: Readonly<Record<MiniMapGround, string>> = Object.freeze({
  pending: '',
  ground: '',
  bare: GROUND_NOTE.bare,
});

/**
 * What a screen reader is told the picture contains.
 *
 * The cones are the only place the facing is DRAWN, and a drawn-only fact is a
 * fact withheld from anybody not looking at it. The FACING tile carries the
 * degrees, so this says the direction in words rather than repeating them.
 */
export function miniMapLabel(spans: readonly FacingSpan[], ground: MiniMapGround): string {
  const base = ground === 'bare' ? 'camera position, no map cached' : 'camera position on the map';
  if (spans.length === 0) return base;
  if (spans.length === 1) return `${base}, lens facing marked`;
  return `${base}, ${String(spans.length)} lens directions marked`;
}
