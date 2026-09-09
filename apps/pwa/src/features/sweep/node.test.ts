/**
 * THE NODE RAMP - the two properties that were broken, asserted with numbers.
 *
 * Both bugs this file exists for shipped under a full green suite, because
 * nothing here was covered. The ramp had a test-shaped hole exactly where it
 * was wrong: every existing assertion checked the ENDS of the ramp, which were
 * always fine, and nothing checked the MIDDLE, which was flat.
 *
 * So the assertions below are about spread, not about endpoints.
 */

import { describe, expect, it } from 'vitest';

import {
  NODE_MAX_RADIUS,
  NODE_MIN_RADIUS,
  NODE_RAMP_RADII,
  NODE_TIERS,
  nodeOpacity,
  nodeRadius,
  nodeTier,
} from './node.ts';

const MILE = 5280;
const SCOPE_25_MI = 25 * MILE;
/**
 * Where the ramp actually bottoms out.
 *
 * NOT the outer ring. The ramp runs over the FRAME, which reaches further than
 * the ring -- see `NODE_RAMP_RADII`. Sizing against the ring put every camera
 * on a 1 mi scope at tier 1, because on that scope the nearest camera was
 * already past the ring.
 */
const RAMP_END = SCOPE_25_MI * NODE_RAMP_RADII;

describe('the tier runs 10 down to 1', () => {
  it('puts a camera you are on top of at 10 and the rim at 1', () => {
    expect(nodeTier(0, SCOPE_25_MI)).toBe(NODE_TIERS);
    expect(nodeTier(RAMP_END, SCOPE_25_MI)).toBe(1);
  });

  it('never goes below 1, however far past the rim a panned-to camera is', () => {
    // A camera the driver has panned out to is still a camera. Before the
    // range cut was split from the scale it was not drawn at all.
    expect(nodeTier(RAMP_END * 4, SCOPE_25_MI)).toBe(1);
    expect(nodeTier(Number.MAX_SAFE_INTEGER, SCOPE_25_MI)).toBe(1);
  });

  it('never rises with distance', () => {
    let previous = NODE_TIERS + 1;
    for (let ft = 0; ft <= RAMP_END; ft += RAMP_END / 200) {
      const tier = nodeTier(ft, SCOPE_25_MI);
      expect(tier).toBeLessThanOrEqual(previous);
      previous = tier;
    }
  });

  it('is 1 for nonsense rather than NaN', () => {
    expect(nodeTier(Number.NaN, SCOPE_25_MI)).toBe(1);
    expect(nodeTier(1000, 0)).toBe(1);
    expect(nodeTier(-1, SCOPE_25_MI)).toBe(NODE_TIERS);
  });
});

describe('THE BUG: every blip the same size', () => {
  /**
   * The exact case that was reported, measured off the old ramp:
   *
   *     sqrt(1 - d/outerFt)  ->  8.80  8.90  9.00  8.90  8.80
   *
   * A 0.2-unit spread on a 343-unit dial, i.e. none. Five cameras strung along
   * three miles of road is not an edge case; it is the ordinary contents of the
   * screen at this scope.
   */
  const spread = [1.5, 0.75, 0, 0.75, 1.5].map((offsetMi) =>
    nodeRadius(offsetMi * MILE, SCOPE_25_MI),
  );

  it('gives five cameras along three miles of road three sizes', () => {
    expect(new Set(spread).size).toBe(3);
  });

  /**
   * The ramp measures distance FROM THE VEHICLE, and it is supposed to.
   *
   * The consequence is worth stating rather than discovering: pan ten miles out
   * and every camera on screen is about ten miles away, so they converge on one
   * size again. That is not the bug above coming back -- it is the ramp telling
   * the truth. Every one of those cameras IS equally far from the driver, and a
   * size that grew because the driver dragged the map would be measuring the
   * viewport instead of the threat.
   *
   * The near field is where the ramp has to work, because that is where the
   * driver is deciding something, and that is what the test above pins.
   */
  it('converges when the driver pans far away, on purpose', () => {
    const farOut = [26, 26.75, 27.5].map((mi) => nodeTier(mi * MILE, SCOPE_25_MI));
    expect(new Set(farOut).size).toBe(1);
  });

  it('separates half a mile from a mile and a half by a whole tier', () => {
    expect(nodeTier(0.5 * MILE, SCOPE_25_MI)).toBeGreaterThan(
      nodeTier(1.5 * MILE, SCOPE_25_MI),
    );
  });

  it('spends its tiers on the near field, where the cameras are', () => {
    // Half the ramp is used up inside the first fifth of the range. That is the
    // whole point of the log: the outer twenty miles are mostly empty and were
    // previously consuming the entire ramp.
    const atOneFifth = nodeTier(RAMP_END / 5, SCOPE_25_MI);
    expect(atOneFifth).toBeLessThanOrEqual(6);
    expect(atOneFifth).toBeGreaterThanOrEqual(5);
  });

  it('holds up at the 100 mi scope too, not just the one it was tuned at', () => {
    const wide = 100 * MILE;
    expect(nodeTier(4 * MILE, wide) - nodeTier(100 * MILE, wide)).toBeGreaterThanOrEqual(4);
  });

  it('THE LIVE FAILURE: a 1 mi scope with everything past the ring', () => {
    // Measured on the deployed scope: range 1 mi, nearest camera 1.5 mi, and
    // all seventeen markers came back at the minimum radius because the ramp
    // had ended before the first visible camera. Against the frame they
    // spread.
    const scope = MILE;
    const tiers = [1.5, 2.968, 0.4].map((mi) => nodeTier(mi * MILE, scope));
    expect(new Set(tiers).size).toBeGreaterThan(1);
    expect(Math.max(...tiers)).toBeGreaterThan(4);
  });

  it('keeps a tier step big enough to see once the glow scales it', () => {
    // The drawn thing is the glow, at NODE_GLOW_SCALE x this radius. One tier
    // has to survive that multiplication as more than a rounding difference.
    const step = (NODE_MAX_RADIUS - NODE_MIN_RADIUS) / (NODE_TIERS - 1);
    expect(step).toBeGreaterThan(0.5);
  });
});

describe('size, opacity and glow step together', () => {
  it('changes opacity on the same distances that change size', () => {
    for (const ft of [0, 0.5 * MILE, 3 * MILE, 12 * MILE, SCOPE_25_MI]) {
      const near = nodeTier(ft, SCOPE_25_MI);
      const nearer = nodeTier(Math.max(0, ft - MILE), SCOPE_25_MI);
      if (near === nearer) {
        expect(nodeOpacity(ft, SCOPE_25_MI)).toBe(
          nodeOpacity(Math.max(0, ft - MILE), SCOPE_25_MI),
        );
      }
    }
  });

  it('stays inside the declared band at both ends', () => {
    expect(nodeRadius(0, SCOPE_25_MI)).toBeCloseTo(NODE_MAX_RADIUS, 5);
    expect(nodeRadius(RAMP_END, SCOPE_25_MI)).toBeCloseTo(NODE_MIN_RADIUS, 5);
  });
});
