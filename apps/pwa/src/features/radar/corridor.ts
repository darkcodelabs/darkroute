/**
 * THE CORRIDOR - what is on the road ahead, not what is around you.
 *
 * =============================================================================
 * WHY A SECOND READING OF THE SAME CAMERAS
 * =============================================================================
 * The scope answers "what is around me", which is the right question when you
 * are deciding whether to keep driving. It is the wrong question when you are
 * deciding whether to turn: a camera 400 ft away that you have already passed
 * is a bright marker on the scope and completely irrelevant to the next mile.
 *
 * This is the same cameras, read along the direction of travel. Distance ahead,
 * on a line, with everything behind and to the side dropped. It is what turns
 * "eleven cameras nearby" into "clear for 0.6 miles, then four in a
 * 0.8 mile stretch" - a sentence a driver can act on at a glance.
 *
 * =============================================================================
 * WHY A CONE AND NOT A LINE
 * =============================================================================
 * A road bends. A strict line ahead would drop every camera on the curve you
 * are about to take, which is most of them on anything but a motorway.
 *
 * {@link CORRIDOR_HALF_ANGLE_DEG} is deliberately wide enough to hold a road
 * that turns and narrow enough to exclude the parallel street one block over.
 * It is not a claim that you will pass these cameras - it cannot be, without a
 * route - and the wording it feeds must never promise that you will.
 *
 * =============================================================================
 * WHAT IT REFUSES TO SAY
 * =============================================================================
 * With no heading there is no ahead. A stationary vehicle has no direction of
 * travel, a compass can be absent or uncalibrated, and guessing produces a
 * corridor pointing somewhere the driver is not going - which is worse than no
 * corridor, because it reads as information.
 *
 * `corridorFor` returns null in that case and the strip does not render.
 */

import type { CameraAssessment } from '../../stores/fwmCore.ts';

/** How far ahead the corridor looks. Three miles at 60 mph is three minutes. */
/** Feet in a mile. Named because three places were spelling out 5280. */
export const FT_PER_MILE = 5280;

export const CORRIDOR_RANGE_FT = 3 * FT_PER_MILE;

/**
 * Half the width of the cone, in degrees either side of the heading.
 *
 * 35 holds a road through a normal bend and a slip road, and excludes the
 * parallel street one block over at any distance the corridor shows. Wider
 * starts counting cameras on roads the driver is not on; narrower loses the
 * camera around the next curve, which is the one they most need.
 */
export const CORRIDOR_HALF_ANGLE_DEG = 35;

/**
 * How close two cameras must be to count as one stretch, in feet.
 *
 * The corridor's whole job is to distinguish "one camera" from "a run of
 * them". A quarter mile is about fifteen seconds at speed: close enough that a
 * driver experiences them as one gauntlet rather than as separate events.
 */
export const CORRIDOR_STRETCH_GAP_FT = 1_320;

export interface CorridorCamera {
  readonly id: string;
  /** Distance along the corridor, in feet. Always positive. */
  readonly distanceFt: number;
  /** Degrees off the heading, signed. Negative is left. */
  readonly offsetDeg: number;
  readonly state: 'in_range' | 'approaching' | 'clear';
}

export interface CorridorStretch {
  readonly fromFt: number;
  readonly toFt: number;
  readonly count: number;
}

export interface Corridor {
  /**
   * The direction the corridor runs, or NULL for a north-up proximity view.
   *
   * See {@link aroundYou}. A null heading is not a degraded corridor -- it is a
   * different, honest reading of the same cameras, and every consumer that
   * prints a direction has to branch on it rather than assume one.
   */
  readonly headingDeg: number | null;
  readonly rangeFt: number;
  readonly cameras: readonly CorridorCamera[];
  /**
   * How far you can go before the first camera ahead, in feet.
   *
   * The full range when the corridor is empty - "clear for 3 miles" is the
   * honest reading of "nothing in the next 3 miles", not a claim about mile
   * four.
   */
  readonly clearForFt: number;
  /** The worst run ahead, or null when the cameras are spread out. */
  readonly worstStretch: CorridorStretch | null;
}

/** Signed difference between two bearings, in [-180, 180). */
export function bearingDelta(from: number, to: number): number {
  const raw = ((to - from + 540) % 360) - 180;
  return raw;
}

/**
 * The corridor ahead, or null when there is no ahead.
 *
 * `thresholdFt` decides which cameras are drawn hot. It is the driver's own
 * alert threshold, so the strip and the scope agree about what counts as close
 * - two different answers to that would be the product arguing with itself.
 */
export function corridorFor(
  assessments: readonly CameraAssessment[],
  headingDeg: number | null,
  thresholdFt: number,
  rangeFt: number = CORRIDOR_RANGE_FT,
): Corridor | null {
  if (headingDeg === null || !Number.isFinite(headingDeg)) return null;

  const ahead: CorridorCamera[] = [];
  for (const assessment of assessments) {
    const distanceFt = assessment.distanceFt;
    if (!Number.isFinite(distanceFt) || distanceFt < 0 || distanceFt > rangeFt) continue;
    const offsetDeg = bearingDelta(headingDeg, assessment.bearingDeg);
    if (Math.abs(offsetDeg) > CORRIDOR_HALF_ANGLE_DEG) continue;
    ahead.push({
      id: assessment.id,
      distanceFt,
      offsetDeg,
      // The same three bands the scope uses, off the same threshold.
      state:
        distanceFt <= thresholdFt
          ? 'in_range'
          : distanceFt <= thresholdFt * 3
            ? 'approaching'
            : 'clear',
    });
  }

  ahead.sort((a, b) => a.distanceFt - b.distanceFt);

  const first = ahead[0];
  const clearForFt = first === undefined ? rangeFt : first.distanceFt;

  return {
    headingDeg,
    rangeFt,
    cameras: ahead,
    clearForFt,
    worstStretch: worstStretchIn(ahead),
  };
}

/**
 * EVERY CAMERA AROUND YOU, BY DISTANCE - the ladder when there is no "ahead".
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * `corridorFor` needs a heading, and below walking pace there is not one worth
 * having: a GPS course at a standstill is derived from measurement noise, and a
 * magnetometer answers for the phone rather than the vehicle. Feeding either to
 * a three-mile forward projection produced a different future every second --
 * observed on a stationary device: "CLEAR FOR 1.5 MI, THEN 7 IN A 1210 FT
 * STRETCH", then "CLEAR FOR 2.1 MI, THEN 1 CAMERA", seconds apart.
 *
 * Refusing to answer fixed that and replaced it with an empty box, which is
 * more honest and no more useful. Standing still is exactly when somebody has
 * time to look at the screen.
 *
 * =============================================================================
 * THE ANSWER IS TO DROP THE DIRECTION, NOT THE DATA
 * =============================================================================
 * "What is ahead of me" is unanswerable without a heading. "What is near me" is
 * not, and it is the same cameras measured the same way -- distance is absolute
 * and needs no course at all. So the cone filter is removed and nothing else
 * changes: the same range, the same three bands off the same threshold, the
 * same densest-run arithmetic, the same ladder.
 *
 * The result is NORTH-UP in the only sense a distance ladder can be: it makes
 * no claim about direction whatsoever. `headingDeg` is null and `offsetDeg` is
 * zero for every camera, so anything that would print a bearing has nothing to
 * print rather than a plausible number.
 *
 * `clearForFt` still means "how far to the first one", but with no direction it
 * reads as NEAREST rather than CLEAR FOR -- see `corridorClearLine`.
 */
export function aroundYou(
  assessments: readonly CameraAssessment[],
  thresholdFt: number,
  rangeFt: number = CORRIDOR_RANGE_FT,
): Corridor {
  const near: CorridorCamera[] = [];
  for (const assessment of assessments) {
    const distanceFt = assessment.distanceFt;
    if (!Number.isFinite(distanceFt) || distanceFt < 0 || distanceFt > rangeFt) continue;
    near.push({
      id: assessment.id,
      distanceFt,
      // No heading, so no offset. Zero is not "straight ahead" here -- nothing
      // reads it while `headingDeg` is null, and that is the contract.
      offsetDeg: 0,
      state:
        distanceFt <= thresholdFt
          ? 'in_range'
          : distanceFt <= thresholdFt * 3
            ? 'approaching'
            : 'clear',
    });
  }

  near.sort((a, b) => a.distanceFt - b.distanceFt);
  const first = near[0];

  return {
    headingDeg: null,
    rangeFt,
    cameras: near,
    clearForFt: first === undefined ? rangeFt : first.distanceFt,
    worstStretch: worstStretchIn(near),
  };
}

/**
 * The densest run of cameras in the corridor, or null.
 *
 * Null for a single camera on purpose: "1 in a 0 mile stretch" is not a
 * sentence, and a lone camera is already fully described by how far ahead it
 * is. A stretch is a claim about a GAUNTLET, and two is the smallest number
 * that can be one.
 */
export function worstStretchIn(cameras: readonly CorridorCamera[]): CorridorStretch | null {
  if (cameras.length < 2) return null;

  let best: CorridorStretch | null = null;
  let runStart = 0;
  for (let i = 1; i <= cameras.length; i += 1) {
    const previous = cameras[i - 1];
    const current = cameras[i];
    const broken =
      current === undefined ||
      previous === undefined ||
      current.distanceFt - previous.distanceFt > CORRIDOR_STRETCH_GAP_FT;
    if (!broken) continue;

    const count = i - runStart;
    if (count >= 2) {
      const from = cameras[runStart];
      const to = cameras[i - 1];
      if (from !== undefined && to !== undefined) {
        // Ties go to the run that starts SOONER: two equally bad gauntlets, and
        // the one you reach first is the one you can still avoid.
        if (best === null || count > best.count) {
          best = { fromFt: from.distanceFt, toFt: to.distanceFt, count };
        }
      }
    }
    runStart = i;
  }
  return best;
}

/** Feet as the corridor says them: one decimal mile, or whole feet under half a mile. */
export function corridorDistance(feet: number): string {
  if (feet < 2_640) return `${String(Math.round(feet / 10) * 10)} FT`;
  return `${String(Math.round((feet / FT_PER_MILE) * 10) / 10)} MI`;
}


// ---------------------------------------------------------------------------
// The sentences the strip and the top block both print
// ---------------------------------------------------------------------------

/**
 * These live here, not in a component.
 *
 * They were declared inside `CorridorStrip.tsx`, which made the top block have
 * to import from a component it replaces. They are pure string functions over
 * a corridor -- the same class of thing as everything else in this file -- and
 * putting them here means the strip can be deleted without taking them with it.
 */

/** `CLEAR FOR 0.6 MI`, or the honest version when nothing is ahead at all. */
export function corridorClearLine(corridor: Corridor): string {
  /*
   * "CLEAR FOR 2 MI" IS A CLAIM ABOUT A DIRECTION, so it may only be made when
   * there is one. Without a heading the same number means "the nearest camera
   * is 2 miles away, somewhere" -- true, useful, and a completely different
   * sentence. Printing the directional wording over a proximity reading would
   * tell a driver the road ahead is clear on the strength of a measurement that
   * never looked at the road ahead.
   */
  const omnidirectional = corridor.headingDeg === null;
  if (corridor.cameras.length === 0) {
    return omnidirectional
      ? `NONE WITHIN ${corridorDistance(corridor.rangeFt)}`
      : `CLEAR FOR ${corridorDistance(corridor.rangeFt)}`;
  }
  return omnidirectional
    ? `NEAREST ${corridorDistance(corridor.clearForFt)}`
    : `CLEAR FOR ${corridorDistance(corridor.clearForFt)}`;
}

/** `THEN 4 IN A 0.8 MI STRETCH`, or nothing when there is no run ahead. */
export function corridorStretchLine(corridor: Corridor): string | null {
  const worst = corridor.worstStretch;
  // "THEN" is sequence, and sequence needs a direction of travel. Standing
  // still there is no then -- there is only how many, and how close.
  const omnidirectional = corridor.headingDeg === null;
  if (worst === null) {
    if (corridor.cameras[0] === undefined) return null;
    if (!omnidirectional) return 'THEN 1 CAMERA';
    const count = corridor.cameras.length;
    return count === 1 ? '1 CAMERA AROUND YOU' : `${String(count)} CAMERAS AROUND YOU`;
  }
  const span = corridorDistance(Math.max(0, worst.toFt - worst.fromFt));
  if (omnidirectional) {
    /*
     * ONE NUMBER WHEN THERE IS ONE NUMBER.
     *
     * This always printed both counts, and standing still they are usually the
     * SAME count -- every camera around you is inside the densest run, because
     * the run is the whole set. "45 AROUND YOU · 45 WITHIN 1.5 MI" says 45
     * twice, and it was 74px too wide for the line at default text and 151px
     * over at 125%.
     *
     * The two-number form is kept for when they actually differ, which is when
     * it is worth saying: 45 around you, 30 of them packed into a mile.
     */
    const total = corridor.cameras.length;
    return worst.count === total
      ? `${String(total)} WITHIN ${span}`
      : `${String(total)} AROUND YOU · ${String(worst.count)} WITHIN ${span}`;
  }
  return `THEN ${String(worst.count)} IN A ${span} STRETCH`;
}

/**
 * Where each camera sits on the ladder, as the quantised attribute the
 * stylesheet keys off.
 *
 * NOT an inline style. A position is a measurement and the design gate keeps
 * measurements in the stylesheet, so the component emits a whole-percent bucket
 * and `radar.css` turns it into an offset -- the same arrangement the blend
 * ramp uses.
 */
export interface CorridorMark {
  readonly id: string;
  readonly state: string;
  /** Whole percent times ten, matching the rules in `radar.css`. */
  readonly at: number;
  /** How many cameras this bar stands for. */
  readonly count: number;
  /**
   * How far the NEAREST camera in this bar is, in feet.
   *
   * Carried so a bar can say what it is when it becomes a control -- a button
   * labelled "camera" tells a screen reader nothing, and "1,200 ft ahead" is
   * the same sentence the rest of the screen is already making.
   */
  readonly distanceFt: number;
  /** 2..10, as a tenth of the tallest bar. See `corridorMarks`. */
  readonly height: number;
  /**
   * HOW CLOSE, as one of six buckets, 0 (nearest) to 5 (far end of the range).
   *
   * The three alert states could not carry this. They are cut off the ALERT
   * THRESHOLD -- in-range at or under it, approaching within three times it --
   * and the threshold is a few hundred feet while the corridor is three miles.
   * So every camera past about a quarter-mile lands in `clear` and the whole
   * ladder drew one flat green, whatever the shape of the road ahead. Observed:
   * six cameras between one and two miles, all identical.
   *
   * Distance along the corridor is the reading the ladder is actually FOR, so
   * the colour is cut off the position instead, and the plasma ramp the map's
   * heat layer already uses gives it a language a driver has seen before:
   * hot near, cool far.
   *
   * `state` is untouched and still decides nothing here -- an in-range camera
   * is by definition at the near end and gets the hot colour anyway.
   */
  readonly heat: number;
}

/** How many closeness buckets the ladder colours by. See `CorridorMark.heat`. */
export const CORRIDOR_HEAT_STEPS = 6;

export function corridorMarks(corridor: Corridor | null): readonly CorridorMark[] {
  if (corridor === null || corridor.rangeFt <= 0) return [];
  // HOW TALL, NOT JUST WHERE. The design draws the ladder as a bar chart, and
  // the height is the reading: three cameras at one junction is a different
  // fact from one, and a row of identical hairlines cannot say which is which.
  // Cameras are bucketed by position and the tallest bucket sets full height,
  // so the chart is always self-scaling rather than clipped.
  const buckets = new Map<
    number,
    { count: number; state: string; id: string; distanceFt: number }
  >();
  for (const camera of corridor.cameras) {
    const at = Math.round((camera.distanceFt / corridor.rangeFt) * 100) * 10;
    const found = buckets.get(at);
    if (found === undefined) {
      // `corridor.cameras` is distance-sorted, so the FIRST camera into a
      // bucket is its nearest -- which is the one a tap should open and the
      // one the label should name.
      buckets.set(at, {
        count: 1,
        state: camera.state,
        id: camera.id,
        distanceFt: camera.distanceFt,
      });
      continue;
    }
    found.count += 1;
    // The worst state in a bucket wins its colour: a bar hiding an in-range
    // camera behind an approaching one would under-report the thing that
    // matters.
    if (camera.state === 'in_range') found.state = 'in_range';
    else if (camera.state === 'approaching' && found.state !== 'in_range') {
      found.state = 'approaching';
    }
  }

  const tallest = Math.max(1, ...[...buckets.values()].map((b) => b.count));
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, bucket]) => ({
      id: bucket.id,
      state: bucket.state,
      at,
      count: bucket.count,
      distanceFt: bucket.distanceFt,
      // Quantised to tens like the offset, for the same reason: a height is a
      // measurement and measurements live in the stylesheet.
      height: Math.max(2, Math.round((bucket.count / tallest) * 10)),
      // `at` is already 0..1000 across the range, so the bucket is a straight
      // division. Clamped because a camera exactly at the far edge would
      // otherwise land one past the last step.
      heat: Math.min(
        CORRIDOR_HEAT_STEPS - 1,
        Math.floor((at / 1000) * CORRIDOR_HEAT_STEPS),
      ),
    }));
}

/**
 * HOW MANY CAMERAS PER MILE OF CORRIDOR, as the block's right-hand readout.
 *
 * A count alone does not scale: "42" means something very different over three
 * miles of interstate than over three miles of downtown. Density is the figure
 * that survives the comparison, and it is the one number here that says
 * something about the PLACE rather than about this drive.
 *
 * WHAT IT IS NOT. It is not a rate of change -- nothing in this build holds a
 * time series of camera placements, so "cameras appearing per month" is not
 * computable and is not what this is. The `+` is a density marker, not growth.
 *
 * Null when the corridor is empty: "+0 / M" over an empty road is a reading
 * about nothing, and the block draws a dash instead.
 */
export function corridorPerMile(corridor: Corridor | null): number | null {
  if (corridor === null || corridor.cameras.length === 0) return null;
  const miles = corridor.rangeFt / FT_PER_MILE;
  if (miles <= 0) return null;
  return Math.max(1, Math.round(corridor.cameras.length / miles));
}

/**
 * WHERE THE CLEAR STRETCH ENDS, AND WHERE THE TROUBLE STARTS.
 *
 * Two positions on the ladder, bucketed to twentieths - the resolution of the
 * table in `radar.css`, because the codebase places things on that panel with
 * data attributes rather than inline styles and a finer bucket would be a
 * hundred rules whose difference is below a pixel.
 *
 * These drive the washes, and the washes are what make an EMPTY ladder mean
 * something. Bars alone give a count; the green wash says how much road is
 * accounted for and the red glow says where the cluster is. Without them a
 * clear corridor and a corridor nobody has data for draw identically.
 */
export const CORRIDOR_SPAN_STEPS = 20;

function spanBucket(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * CORRIDOR_SPAN_STEPS);
}

/** How much of the ladder is clear road ahead, as a bucket 0..20. */
export function corridorClearSpan(corridor: Corridor | null): number {
  if (corridor === null || corridor.rangeFt <= 0) return 0;
  return spanBucket(corridor.clearForFt / corridor.rangeFt);
}

/**
 * Where the glow sits, as a bucket 0..20, or null when there is nothing to lift.
 *
 * The worst stretch when there is one, otherwise the nearest camera: the glow
 * marks the thing a driver would want their eye pulled to, and on a corridor
 * with one camera on it that is the camera.
 */
export function corridorHotSpan(corridor: Corridor | null): number | null {
  if (corridor === null || corridor.rangeFt <= 0) return null;
  if (corridor.worstStretch !== null) {
    return spanBucket(corridor.worstStretch.fromFt / corridor.rangeFt);
  }
  const nearest = corridor.cameras.reduce<number | null>(
    (best, camera) => (best === null || camera.distanceFt < best ? camera.distanceFt : best),
    null,
  );
  return nearest === null ? null : spanBucket(nearest / corridor.rangeFt);
}

/**
 * WHERE THE ALERT ACTUALLY FIRES, DRAWN ON THE LADDER THAT SHOWS THE ROAD.
 *
 * =============================================================================
 * THE COMPLAINT THIS ANSWERS
 * =============================================================================
 * The threshold is a number a driver sets once in SETTINGS and then never sees
 * again. Everything on RADAR is a distance -- the verdict, the marks, the mile
 * posts -- and none of it says which of those distances is the one that will
 * make the phone shout. So "CLEAR FOR 1.4 MI" and "NEAREST 220 FT" read as the
 * same kind of statement, when only one of them is inside the band that alerts.
 *
 * =============================================================================
 * WHY IT NEEDS ITS OWN SCALE AND CANNOT REUSE `spanBucket`
 * =============================================================================
 * The threshold is 100..1000 ft (`ALERT_THRESHOLD_MIN_FT`..`_MAX_FT`) and the
 * ladder is three miles. That is 0.63% to 6.3% of the panel -- the whole legal
 * range of the setting lives inside the FIRST TWENTIETH of the instrument.
 *
 * `spanBucket` quantises to twentieths, so every threshold a driver can pick
 * lands in bucket 0 or 1: the control would have two positions across its
 * entire travel and the default (500 ft) would be indistinguishable from the
 * minimum. Twentieths are the right resolution for a wash that spans miles and
 * the wrong one for a band that spans hundreds of feet.
 *
 * Two hundred steps is half a percent, or about 1.5px on a phone-width panel --
 * one step is a visible move and the table in `radar.css` stays 21 rules rather
 * than a hundred.
 */
export const CORRIDOR_THRESHOLD_STEPS = 200;

/**
 * The far edge of the band, as a bucket 0..20 (nought to a tenth of the ladder).
 *
 * NULL RATHER THAN A CLAMP past a tenth. A clamped band would pin itself at
 * 10% and go on claiming a distance that is not the threshold -- the same
 * mistake the sweep dial's ring refuses to make when the threshold falls
 * outside the range being drawn. It cannot happen at the shipped range; it can
 * happen to a caller that passes a short `rangeFt`, and the honest answer there
 * is to draw nothing.
 */
export function corridorThresholdSpan(
  corridor: Corridor | null,
  thresholdFt: number,
): number | null {
  if (corridor === null || corridor.rangeFt <= 0) return null;
  if (!Number.isFinite(thresholdFt) || thresholdFt <= 0) return null;
  const bucket = Math.round((thresholdFt / corridor.rangeFt) * CORRIDOR_THRESHOLD_STEPS);
  // A tenth of the ladder, in the same half-percent steps the table declares.
  if (bucket > CORRIDOR_THRESHOLD_STEPS / 10) return null;
  // Never zero: a threshold that rounds to nothing is still a real setting, and
  // a band of no width says "there is no alert zone", which is a lie about a
  // driver who has one. One step is the floor.
  return Math.max(1, bucket);
}
