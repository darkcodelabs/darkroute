/**
 * THE CORRIDOR LADDER - the mark colouring, which is a reading and not a style.
 *
 * `corridor.ts` had no test file at all; this covers the part most likely to go
 * quietly wrong, because it is the part whose failure looks like a design
 * choice rather than a bug.
 */

import { describe, expect, it } from 'vitest';

import {
  ALERT_THRESHOLD_MAX_FT,
  ALERT_THRESHOLD_MIN_FT,
  ALERT_THRESHOLD_STEP_FT,
} from '../../stores/fwmCore.ts';

import {
  CORRIDOR_HEAT_STEPS,
  CORRIDOR_RANGE_FT,
  corridorFor,
  corridorMarks,
  corridorThresholdSpan,
} from './corridor.ts';

/**
 * COLOUR BY CLOSENESS - the reading the three alert states could not carry.
 *
 * `state` is cut off the ALERT THRESHOLD, a few hundred feet, while the
 * corridor is three miles. So every camera past about a quarter mile fell into
 * `clear` and the ladder drew one flat colour whatever the road ahead looked
 * like. `heat` is cut off POSITION instead.
 */
describe('mark heat', () => {
  const at = (distanceFt: number) => ({
    id: `c${String(distanceFt)}`,
    distanceFt,
    bearingDeg: 0,
    relativeDirection: 'ahead' as const,
    inRange: false,
  });

  function heatsFor(distances: readonly number[]): readonly number[] {
    const corridor = corridorFor(
      distances.map((d) => at(d)) as never,
      0,
      500,
    );
    return corridorMarks(corridor).map((m) => m.heat);
  }

  it('puts the nearest camera in the hottest bucket and the furthest in the coolest', () => {
    const heats = heatsFor([100, CORRIDOR_RANGE_FT - 100]);
    expect(heats[0]).toBe(0);
    expect(heats[heats.length - 1]).toBe(CORRIDOR_HEAT_STEPS - 1);
  });

  it('SEPARATES cameras the alert states cannot tell apart', () => {
    // The whole point. At a 500ft threshold both of these are `clear`, and the
    // old ladder drew them identically -- one at a mile, one at three.
    const heats = heatsFor([5_280, 15_000]);
    expect(new Set(heats).size).toBe(2);
  });

  it('never emits a bucket outside the ramp, including at the far edge', () => {
    for (const d of [0, 1, CORRIDOR_RANGE_FT - 1, CORRIDOR_RANGE_FT]) {
      for (const h of heatsFor([d])) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(CORRIDOR_HEAT_STEPS - 1);
      }
    }
  });
});

/**
 * THE ALERT THRESHOLD, ON THE LADDER.
 *
 * The setting a driver picks once and then cannot see anywhere on the driving
 * screen. What is tested here is the property that makes the band worth
 * drawing at all: that it MOVES when the setting moves. It is easy to write a
 * quantiser that puts every legal threshold in the same bucket -- the twentieth
 * scale the washes use does exactly that -- and the failure is invisible,
 * because a band that never moves still looks like a band.
 */
describe('threshold span', () => {
  const corridorAt = (rangeFt: number) =>
    corridorFor(
      [
        {
          id: 'c1',
          distanceFt: 100,
          bearingDeg: 0,
          relativeDirection: 'ahead' as const,
          inRange: true,
        },
      ] as never,
      0,
      // `corridorFor` takes the threshold third and the RANGE fourth. Both are
      // feet, so swapping them type-checks and silently builds a three-mile
      // corridor when a thousand-foot one was asked for.
      500,
      rangeFt,
    );

  it('gives every threshold the driver can pick its own position', () => {
    const corridor = corridorAt(CORRIDOR_RANGE_FT);
    const spans = new Set<number | null>();
    for (let ft = ALERT_THRESHOLD_MIN_FT; ft <= ALERT_THRESHOLD_MAX_FT; ft += ALERT_THRESHOLD_STEP_FT) {
      spans.add(corridorThresholdSpan(corridor, ft));
    }
    // 19 legal values. They need not all differ -- half a percent of three
    // miles is 79 ft and the step is 50 -- but "more than a handful" is the
    // difference between a control with travel and one with none. The
    // twentieth scale the washes use would produce 2 here.
    expect(spans.size).toBeGreaterThan(6);
  });

  it('moves outward as the threshold grows, never inward', () => {
    const corridor = corridorAt(CORRIDOR_RANGE_FT);
    const near = corridorThresholdSpan(corridor, ALERT_THRESHOLD_MIN_FT);
    const far = corridorThresholdSpan(corridor, ALERT_THRESHOLD_MAX_FT);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(far as number).toBeGreaterThan(near as number);
  });

  it('never collapses to nothing, because a real setting is never no band', () => {
    const corridor = corridorAt(CORRIDOR_RANGE_FT);
    // One foot rounds to bucket 0 without the floor, and a zero-width band
    // says "you have no alert zone" to a driver who has one.
    expect(corridorThresholdSpan(corridor, 1)).toBe(1);
  });

  it('draws nothing rather than lying when the threshold is off the ladder', () => {
    // A short range puts the threshold past a tenth of the panel. A clamp would
    // pin the band at 10% and go on claiming a distance that is not the
    // threshold; null draws nothing, which is the honest answer.
    expect(corridorThresholdSpan(corridorAt(1_000), 900)).toBeNull();
  });

  it('has nothing to draw without a corridor or without a setting', () => {
    expect(corridorThresholdSpan(null, 500)).toBeNull();
    expect(corridorThresholdSpan(corridorAt(CORRIDOR_RANGE_FT), 0)).toBeNull();
    expect(corridorThresholdSpan(corridorAt(CORRIDOR_RANGE_FT), Number.NaN)).toBeNull();
  });
});

/**
 * THE BAR IS A CONTROL, so it has to know which camera it opens.
 *
 * `corridorMarks` buckets by whole percent, and a bucket can hold several
 * cameras. Which one a tap opens is not a detail: at three miles a bucket is
 * about 160 ft wide near the vehicle and the wrong pick is a card for a
 * different pole.
 */
describe('what a bar stands for', () => {
  const at = (id: string, distanceFt: number) => ({
    id,
    distanceFt,
    bearingDeg: 0,
    relativeDirection: 'ahead' as const,
    inRange: false,
  });

  it('names the NEAREST camera in its bucket, not whichever arrived first', () => {
    // Both land in the same whole-percent bucket of a three-mile ladder:
    // 1150/15840 = 7.26% and 1180/15840 = 7.45%, which both round to 7.
    // Deliberately fed FAR FIRST, so first-in-wins would pick the wrong one.
    const corridor = corridorFor(
      [at('far', 1_180), at('near', 1_150)] as never,
      0,
      500,
      CORRIDOR_RANGE_FT,
    );
    const marks = corridorMarks(corridor);
    expect(marks).toHaveLength(1);
    expect(marks[0]?.count).toBe(2);
    expect(marks[0]?.id).toBe('near');
    expect(marks[0]?.distanceFt).toBe(1_150);
  });

  it('carries the distance the label reads out', () => {
    const corridor = corridorFor([at('solo', 2_640)] as never, 0, 500, CORRIDOR_RANGE_FT);
    expect(corridorMarks(corridor)[0]?.distanceFt).toBe(2_640);
  });
});
