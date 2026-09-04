/**
 * THE NODE - how big a contact is drawn, and how hard it glows.
 *
 * =============================================================================
 * WHY SIZE CAME BACK, AND WHY IT IS BOUNDED THIS TIME
 * =============================================================================
 * Markers were scaled by proximity, then made a constant size, and both were
 * wrong for the same reason: they were arguing about the wrong thing.
 *
 * Proximity weighting is RIGHT - a contact bearing down on you should look
 * heavier than one four miles off, and that is what makes a scope readable at a
 * glance rather than a scatter plot. What was wrong was the RANGE it ran over:
 * the ramp went up to a size where the closest cameras - which are also the
 * most densely packed - merged into blobs, and every marker carried a big digit
 * inside it, so the scope read as a chart of numbered discs.
 *
 * So the weighting is back, over a tight band. A far node is a 3-unit dot; a
 * near one is 7. That is a bit over twice the radius and five times the area,
 * which is plenty to rank them by eye, and no node is ever big enough to smear
 * into its neighbour.
 *
 * Clustering does the rest. Density is solved by merging, not by shrinking, so
 * the size ramp is free to mean only one thing: how close this is.
 *
 * =============================================================================
 * WHY THE GLOW IS A SECOND CIRCLE AND NOT A FILTER
 * =============================================================================
 * `feGaussianBlur` is the obvious way to make something glow and it is a
 * per-frame raster operation on every node, behind a sweep that repaints
 * continuously. That is exactly the cost that made the emoji markers lag.
 *
 * A larger, dimmer circle of the same colour behind the node costs the
 * compositor nothing, reads as a halo at any size, and - because both circles
 * take the same distance-driven colour - the whole node brightens as it
 * approaches instead of just growing.
 */

/**
 * The node's nominal radius in dial units, far end and near end.
 *
 * WIDENED, because the band was too narrow to see. At 3..7 the drawn core --
 * a fraction of this -- ran 1.3 to 2.9 units, and a 1.6-unit difference across
 * the whole scope is not a weighting anybody can read: every blip looked the
 * same size. The ramp only does its job if the far end and the near end are
 * obviously different things.
 *
 * 2.5..9 is a 3.6x radius and a 13x area, which ranks at a glance and still
 * leaves the largest node small enough that clustering handles density rather
 * than size hiding it.
 */
export const NODE_MIN_RADIUS = 2.5;
export const NODE_MAX_RADIUS = 9;

/** How much wider the bloom is than the node's nominal radius. */
export const NODE_GLOW_SCALE = 3.4;

/**
 * How small the hot core is, against that same radius.
 *
 * A blip reads as LIGHT rather than as a shape when its bright part is much
 * smaller than its glow, which is what a radar return looks like.
 *
 * RAISED HALF AGAIN, by request: the cores were too small to pick out against
 * the bloom. The GLOW scale is deliberately untouched -- inflating the halo
 * too would have made every marker bleed into its neighbours and added
 * overdraw to a scope that is already the expensive part of the frame. The
 * bright part grew; the soft part did not.
 */
export const NODE_CORE_SCALE = 0.83;

/**
 * The halo's opacity at the far end and the near end.
 *
 * THE FLOOR WAS RAISED. At 0.1 a far node's glow was a tenth of a colour that
 * was itself nearly the background -- three separate ramps (size, opacity and
 * the plasma step) all bottoming out on the same camera at once, which is what
 * made distant contacts disappear rather than recede. A node may be the
 * quietest thing on the scope; it may not be an invisible one.
 */
export const NODE_GLOW_MIN_OPACITY = 0.26;
export const NODE_GLOW_MAX_OPACITY = 0.46;

/** The dot's own opacity. Never fully transparent: a node either is or is not. */
export const NODE_MIN_OPACITY = 0.78;
export const NODE_MAX_OPACITY = 1;

/**
 * How many steps the weighting has. Ten, because that is what it is FOR:
 * "10 is on you and 1 is 25 miles away".
 *
 * Discrete on purpose. A continuous ramp gives two cameras a block apart two
 * radii that differ in the third decimal, which is a difference that exists in
 * the numbers and not on the screen. Ten tiers guarantee that two nodes are
 * either the same size or VISIBLY different sizes, and nothing in between.
 */
export const NODE_TIERS = 10;

/**
 * The ramp runs over the FRAME, not over the outer ring.
 *
 * =============================================================================
 * WHY THESE ARE DIFFERENT NUMBERS
 * =============================================================================
 * The outer ring is a SCALE -- it says how many feet a dial unit is worth. The
 * frame is what the driver can actually see, and it reaches further than the
 * ring does: the viewBox is square, the map is drawn `slice`, and a phone is
 * tall, so a screen shows about 2.6 ring radii of world. That is the same
 * `FRAME_REACH_RADII` the range cut uses, and for the same reason.
 *
 * Sizing against the ring instead was measurable on the live scope. At a 1 mi
 * range with the nearest camera 1.5 mi out, EVERY camera on screen was past the
 * ring, so every one of them scored ratio >= 1 and came back tier 1: seventeen
 * markers, two drawn radii, both the minimum. The ramp had already run out
 * before the first visible camera.
 *
 * Against the frame the same scope spreads those cameras across the middle of
 * the ramp, which is where a ramp is supposed to spend itself.
 *
 * DELIBERATELY NOT the panned reach. That grows as the driver drags, so node
 * sizes would change when the map moved -- a size measuring the viewport rather
 * than the camera. This is a fixed multiple of the range: pan all you like, a
 * given camera at a given zoom is a given size.
 */
export const NODE_RAMP_RADII = 2.6;

/**
 * How hard the ramp bends toward the near field.
 *
 * The ramp is `log(1 + K*r) / log(1 + K)`, and K is the whole character of it.
 * Bigger K spends more of the ten tiers on the first few percent of the range.
 *
 * It had to go up when the ramp moved from the ring to the frame: the frame is
 * 2.6x further, so at K=9 the near field got squeezed back into one tier and
 * five cameras across three miles of road went from three sizes to two. Caught
 * by the test that pins that exact case, which is why it exists.
 *
 * At 49 the same five cameras take three tiers again, AND a 1 mi scope with
 * everything past the ring still spreads. Both ends, one number.
 */
export const NODE_RAMP_CURVE = 49;

/**
 * Which tier a contact sits in: 10 on top of you, 1 at the edge of the scope.
 *
 * =============================================================================
 * WHY LOGARITHMIC, AND WHAT THE LINEAR ONE ACTUALLY DID
 * =============================================================================
 * The old ramp was `sqrt(1 - d / outerFt)`, and at the ranges this scope now
 * runs at it did not work at all. Measured, scope at 25 mi, five cameras spread
 * across three miles of road -- which is a completely ordinary thing to be
 * looking at:
 *
 *     radii: 8.80  8.90  9.00  8.90  8.80
 *
 * A 0.2-unit spread on a 343-unit dial. Every blip the same size, which is
 * exactly how it was reported. The cause is that `1 - d/outerFt` is FLAT near
 * zero and the square root flattens it further, so the entire near field --
 * where every camera a driver cares about is -- shares one value. Widening the
 * band could not fix it: the ramp was spending its whole travel on the empty
 * outer twenty miles.
 *
 * Distance is judged logarithmically, so the ramp is logarithmic. Half a mile
 * versus a mile and a half is a real difference and gets a real step; twenty
 * miles versus twenty-two is not and does not. Same scope, same five cameras,
 * this ramp: tiers 9, 8, 8, 7, 7 -- three distinct sizes where there were none.
 *
 * The `1 + 9 * ratio` inside the log is what puts the tiers where the cameras
 * are: at a 25 mi scope, half a mile is tier 9, a mile and a half is 8, five
 * miles is 6, twelve is 3, and the rim is 1.
 *
 * Past the outer ring the tier stays 1 rather than going negative. A camera the
 * driver has panned out to is still a camera; it is just the smallest one.
 */
export function nodeTier(distanceFt: number, outerFt: number): number {
  if (!Number.isFinite(distanceFt) || !Number.isFinite(outerFt) || outerFt <= 0) return 1;
  const ratio = Math.max(0, distanceFt) / (outerFt * NODE_RAMP_RADII);
  const compressed =
    Math.log10(1 + NODE_RAMP_CURVE * Math.min(1, ratio)) / Math.log10(1 + NODE_RAMP_CURVE);
  const tier = Math.round(NODE_TIERS - (NODE_TIERS - 1) * compressed);
  return Math.min(NODE_TIERS, Math.max(1, tier));
}

/**
 * How close this is, 0 at the scope's edge and 1 at the centre.
 *
 * Now the tier expressed as a fraction, so size, opacity and glow all step
 * together. Three ramps that agreed on distance but disagreed on where their
 * steps fell would make one node brighter than another the same size, which
 * reads as two facts when there is one.
 */
export function nodeProximity(distanceFt: number, outerFt: number): number {
  return (nodeTier(distanceFt, outerFt) - 1) / (NODE_TIERS - 1);
}

export function nodeRadius(distanceFt: number, outerFt: number): number {
  const t = nodeProximity(distanceFt, outerFt);
  return Math.round((NODE_MIN_RADIUS + (NODE_MAX_RADIUS - NODE_MIN_RADIUS) * t) * 100) / 100;
}

export function nodeOpacity(distanceFt: number, outerFt: number): number {
  const t = nodeProximity(distanceFt, outerFt);
  return Math.round((NODE_MIN_OPACITY + (NODE_MAX_OPACITY - NODE_MIN_OPACITY) * t) * 100) / 100;
}

export function nodeGlowOpacity(distanceFt: number, outerFt: number): number {
  const t = nodeProximity(distanceFt, outerFt);
  return (
    Math.round(
      (NODE_GLOW_MIN_OPACITY + (NODE_GLOW_MAX_OPACITY - NODE_GLOW_MIN_OPACITY) * t) * 100,
    ) / 100
  );
}

/**
 * A cluster is drawn slightly heavier than a lone camera at the same distance.
 *
 * Not proportionally - a cluster of forty must not be forty times anything, or
 * one junction swallows the scope. A flat step says "this is more than one"
 * and leaves the CONSTELLATION to say how many and where.
 */
export const CLUSTER_RADIUS_BONUS = 2;

/**
 * One member of a cluster, drawn where that member actually is.
 *
 * =============================================================================
 * WHY THE COUNT BECAME A SHAPE
 * =============================================================================
 * A cluster used to be one blip with a digit beside it: `8`. Two things wrong
 * with that, and the second is the serious one.
 *
 * It answered a question nobody asked. "Eight" is not what a driver needs off
 * a glance at a map; "several, spread along that road" is, and a number cannot
 * say it while a shape can.
 *
 * And it promised a record it could not keep. Tapping the 8 opened the INTEL
 * CARD for whichever member happened to sort first, with nothing on the card
 * admitting the other seven or that this one was arbitrary. Drawing the
 * members instead makes the marker honestly plural, which is what lets the tap
 * stop pretending to be about one camera and become "go in until it is".
 *
 * Small, because there can be a lot of them inside one bloom and they are a
 * texture rather than a set of things to read one at a time.
 */
export const CLUSTER_NODE_RADIUS = 1.6;

/** How many steps the plasma ramp is quantised to. */
export const PLASMA_STEPS = 11;

/**
 * Which plasma step a contact takes: 0 on you, 10 at the edge of the scope.
 *
 * COLOUR IS DISTANCE HERE, and that is a deliberate reassignment. The node used
 * to take the alert blend -- amber to crimson across the threshold -- which
 * meant every node inside the threshold was the same colour and every node
 * outside it was the same colour, so the one channel with the most range on the
 * scope carried a single bit of information.
 *
 * Distance uses all of it. The alert state is still said, loudly, by the things
 * whose job that is: the hero readout, the state word, the threshold ring, and
 * the dock. A driver does not need the marker to shout it a fifth time; they
 * need to see, at a glance, which of fifteen contacts is the near one.
 *
 * Runs off {@link nodeProximity}, so it is the same curve the size and
 * brightness use. All three channels agree.
 */
export function plasmaStep(distanceFt: number, outerFt: number): number {
  const t = nodeProximity(distanceFt, outerFt);
  // `1 - t` because step 0 is nearest and t is 1 at the centre.
  return Math.min(PLASMA_STEPS - 1, Math.max(0, Math.round((1 - t) * (PLASMA_STEPS - 1))));
}
