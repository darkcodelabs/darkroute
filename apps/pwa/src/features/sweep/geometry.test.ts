/**
 * The scope's measurements, against what v2's `02 · SWEEP` and SWEEP PRIMITIVES
 * draw.
 *
 * Every expectation here is a number read off the design, not a number read off
 * the implementation: the four ring mask stops (10 / 21 / 34 / 48.5 % of the
 * mask reach on a 343px scope), the 60 deg facing arc, the 18x20 ego arrow, and
 * the rule that the scale stops at the outer ring instead of pinning far-away
 * cameras to the rim.
 *
 * The ring block is the one that reads `sweep.css` as well: the mask stops in
 * the stylesheet ARE the ring scale, and a dot placed against a different set
 * of numbers than the ring drawn for it would be wrong silently.
 *
 * The tap-target block is the exception and is the load-bearing one: it asserts
 * that two cameras close together cannot swap taps, and that the target stays
 * in step with the touch floor it claims to mirror.
 */

// `tokens.css` is READ FROM DISK. `DOT_HIT_RADIUS` mirrors `--fwm-touch-min`
// and cannot reference it -- an SVG user unit does not resolve a CSS variable
// -- so the only way the two stay in step is a test that reads both.
// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DIAL_CENTRE,
  DIAL_UNITS,
  DOT_HIT_RADIUS,
  DOT_RADIUS,
  EGO_MARKER_POINTS,
  EGO_RING_RADIUS,
  FACING_ARC_SPAN_DEG,
  MASK_REACH,
  OUTER_RADIUS,
  RETICLE_ARM,
  RETICLE_HALF,
  RING_MASK_PCT,
  SWEEP_MAX_FT,
  SWEEP_RINGS,
  calloutFor,
  dialPoint,
  facingArcPath,
  hitRadiusForDot,
  radiusForDistanceFt,
  reticlePath,
  ringLabelY,
  screenAngleDeg,
} from './geometry.ts';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const tokensCss: string = readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8');
const sweepCss: string = readFileSync(`${HERE}/sweep.css`, 'utf8');

describe('the ring scale', () => {
  it('spaces the four rings evenly, because the scale is linear', () => {
    // The design LABELLED them 100 / 300 / 500 / 1000 and DREW them at
    // 20.6 / 43.3 / 70.1 / 100 % of the radius. Those two facts are only
    // consistent if the scale bends, and a bending scale is what curved the
    // roads and distorted the spacing between cameras.
    //
    // The rings stay exactly where the design drew them. What each one STANDS
    // FOR now follows from its radius on a proportional scale, so the drawing
    // and the meaning cannot disagree.
    const radii = SWEEP_RINGS.map((ring) => ring.radius);
    const outer = radii.at(-1) ?? 0;
    for (const [index, ring] of SWEEP_RINGS.entries()) {
      const expected = (SWEEP_MAX_FT * (radii[index] ?? 0)) / outer;
      expect(ring.ft).toBeCloseTo(expected, 3);
    }
    // Outermost still means the full range, which is what anchors the scale.
    expect(SWEEP_RINGS.at(-1)?.ft).toBeCloseTo(SWEEP_MAX_FT, 3);
  });

  it('is v2\'s 343px scope, and the centre is the centre', () => {
    expect(DIAL_UNITS).toBe(343);
    expect(DIAL_CENTRE).toBe(DIAL_UNITS / 2);
  });

  it('reads 100% of a ring mask as the half DIAGONAL, which is what a browser does', () => {
    // `radial-gradient(circle at center, ...)` sizes itself `farthest-corner`.
    // Reading the stops as a fraction of the RADIUS instead would pull every
    // ring in by 29% and put every camera on a scale nobody drew.
    expect(MASK_REACH).toBeCloseTo(DIAL_UNITS * Math.SQRT1_2, 6);
    expect(MASK_REACH).toBeGreaterThan(DIAL_CENTRE);
  });

  it('puts each ring where v2 masks it: 10 / 21 / 34 / 48.5 percent', () => {
    expect([...RING_MASK_PCT]).toStrictEqual([0.1, 0.21, 0.34, 0.485]);
    expect(SWEEP_RINGS.map((ring) => ring.radius)).toStrictEqual([
      24.254, 50.933, 82.463, 117.631,
    ]);
  });

  it('draws those same four stops in sweep.css, so a dot lands on its ring', () => {
    // The stylesheet is the other half of the scale. If either side moves
    // alone the dots come off the rings and nothing else complains.
    for (const pct of RING_MASK_PCT) {
      const stop = `var(--fwm-mask-solid) ${String(pct * 100)}%`;
      expect(sweepCss).toContain(stop);
    }
  });

  it('leaves the rim outside the outer ring, as every v2 scope does', () => {
    const outer = SWEEP_RINGS[SWEEP_RINGS.length - 1];
    expect(outer).toBeDefined();
    expect(outer?.radius).toBeLessThan(DIAL_CENTRE);
  });

  it('is not linear in distance -- the near rings get more of the scope', () => {
    const [innermost] = SWEEP_RINGS;
    const outer = SWEEP_RINGS[SWEEP_RINGS.length - 1];
    expect(innermost).toBeDefined();
    // A linear scale would put 100 ft at a tenth of the outer ring.
    expect(innermost?.radius).toBeGreaterThan((outer?.radius ?? 0) / 10);
  });
});

describe('placing a distance on the scale', () => {
  it('puts the centre of the dial at zero feet', () => {
    expect(radiusForDistanceFt(0)).toBe(0);
  });

  it('lands the full range at the edge of the frame', () => {
    // The scale used to be pinned to the outermost DRAWN ring, at 34.3 % of the
    // canvas -- so a camera at the full range sat a third of the way out and
    // the map used the middle third of its own frame, leaving a wide empty
    // margin. With the radar graphic gone there is no ring to line up with and
    // that margin was pure waste.
    expect(radiusForDistanceFt(1000, 1000)).toBeCloseTo(OUTER_RADIUS, 3);
    expect(radiusForDistanceFt(500, 1000)).toBeCloseTo(OUTER_RADIUS / 2, 3);
  });

  it('is PROPORTIONAL: twice the distance is twice the radius', () => {
    // The property the whole projection turns on, and the one it did not have.
    // Without it a straight road bends on screen, two cameras a block apart are
    // drawn closer together near the rim than near the centre, and zooming
    // reorganises the picture instead of magnifying it.
    const near = radiusForDistanceFt(250, 1000) ?? 0;
    const far = radiusForDistanceFt(500, 1000) ?? 0;
    expect(far).toBeCloseTo(near * 2, 3);

    // And it holds at any range, which is what makes zoom a scale factor.
    const wide = radiusForDistanceFt(5_000, 20_000) ?? 0;
    expect(wide).toBeCloseTo(near, 3);
  });

  it('refuses to draw a camera past the outer ring rather than pinning it to the rim', () => {
    expect(SWEEP_MAX_FT).toBe(1000);
    expect(radiusForDistanceFt(1001)).toBeNull();
    expect(radiusForDistanceFt(5280)).toBeNull();
  });

  it('refuses a distance that is not a distance', () => {
    expect(radiusForDistanceFt(Number.NaN)).toBeNull();
    expect(radiusForDistanceFt(-1)).toBeNull();
  });
});

describe('which way is up', () => {
  it('puts a camera dead ahead at the top of the dial when the vehicle has a heading', () => {
    expect(screenAngleDeg(41, 41)).toBe(0);
  });

  it('swings a camera to the left of the vehicle onto the left of the dial', () => {
    // Bearing 10, heading 40: the camera is 30 deg off the nose, to the left.
    expect(screenAngleDeg(10, 40)).toBe(330);
  });

  it('falls back to north-up when the platform gave no heading', () => {
    expect(screenAngleDeg(41, null)).toBe(41);
  });

  it('normalises past a full turn', () => {
    expect(screenAngleDeg(400, 0)).toBe(40);
  });
});

describe('polar to the svg', () => {
  it('puts zero degrees at the top and ninety to the right', () => {
    expect(dialPoint(DIAL_CENTRE, 0)).toStrictEqual({ cx: DIAL_CENTRE, cy: 0 });
    expect(dialPoint(100, 90)).toStrictEqual({ cx: DIAL_CENTRE + 100, cy: DIAL_CENTRE });
    expect(dialPoint(100, 180)).toStrictEqual({ cx: DIAL_CENTRE, cy: DIAL_CENTRE + 100 });
  });

  it('puts the ego marker at the centre, pointing up', () => {
    // v2: 18px wide, 20px tall, `margin:-11px 0 0 -9px` -- the apex 11 above
    // the centre and the base 9 below it, which is not symmetric on purpose.
    //
    // FOUR points, not three: the tail notches back up toward the apex, which
    // is what makes it a navigation arrow rather than a triangle. A triangle
    // reads as a blob at this size; the notch is the convention every mapping
    // product uses for "you, and the way you are pointing".
    expect(EGO_MARKER_POINTS).toBe('171.5,160.5 180.5,180.5 171.5,174.6 162.5,180.5');
  });

  it('rings the ego marker at v2\'s 44 units', () => {
    expect(EGO_RING_RADIUS * 2).toBe(44);
  });

  it('drops each scale label just inside its own ring', () => {
    expect(ringLabelY(DIAL_CENTRE)).toBe(15);
    expect(ringLabelY(0)).toBe(DIAL_CENTRE + 15);
  });
});

// ---------------------------------------------------------------------------
// v2's marker furniture
// ---------------------------------------------------------------------------

describe("v2's in-range reticle", () => {
  it('is four corner brackets on a 34x34 box', () => {
    expect(RETICLE_HALF * 2).toBe(34);
    expect(RETICLE_ARM).toBe(9);

    const path = reticlePath({ cx: 100, cy: 100 });
    // Four subpaths, one per corner, each an L of two arms.
    expect(path.match(/M /g)).toHaveLength(4);
    expect(path.match(/L /g)).toHaveLength(8);
    // The box's own corners, all four of them.
    expect(path).toContain('83 83');
    expect(path).toContain('117 83');
    expect(path).toContain('117 117');
    expect(path).toContain('83 117');
  });
});

describe("v2's callout", () => {
  it('hangs outward, so a label never runs across the ego marker', () => {
    const left = calloutFor({ cx: DIAL_CENTRE - 40, cy: DIAL_CENTRE });
    const right = calloutFor({ cx: DIAL_CENTRE + 40, cy: DIAL_CENTRE });

    expect(left.anchor).toBe('end');
    expect(left.x).toBeLessThan(DIAL_CENTRE - 40);
    expect(right.anchor).toBe('start');
    expect(right.x).toBeGreaterThan(DIAL_CENTRE + 40);
  });

  it('sits above its marker, where v2 hangs it off the reticle box', () => {
    const callout = calloutFor({ cx: DIAL_CENTRE, cy: DIAL_CENTRE });
    expect(callout.y).toBeLessThan(DIAL_CENTRE);
  });
});

describe('the facing arc', () => {
  it('is the 60 degree arc SWEEP PRIMITIVES specifies', () => {
    expect(FACING_ARC_SPAN_DEG).toBe(60);
  });

  it('centres the arc on the direction the lens points', () => {
    const path = facingArcPath({ cx: DIAL_CENTRE, cy: DIAL_CENTRE }, 0);
    // 13 units from the marker, 30 deg either side of straight up.
    expect(path).toBe('M 165 160.242 A 13 13 0 0 1 178 160.242');
  });

  it('rotates with the lens', () => {
    const up = facingArcPath({ cx: DIAL_CENTRE, cy: DIAL_CENTRE }, 0);
    const right = facingArcPath({ cx: DIAL_CENTRE, cy: DIAL_CENTRE }, 90);
    expect(right).not.toBe(up);
    expect(right.startsWith('M ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tap targets
// ---------------------------------------------------------------------------

describe('the tap target under a dot', () => {
  it('is the touch floor across when the dot has the dial to itself', () => {
    const alone = dialPoint(105.5, 0);
    expect(hitRadiusForDot(alone, [alone])).toBe(DOT_HIT_RADIUS);
    expect(DOT_HIT_RADIUS * 2).toBe(44);
  });

  it('never reaches past the halfway line to the next dot', () => {
    // The two cameras panel 02 would draw on one bearing: 425 ft and 500 ft,
    // which the design's own ring scale puts at radius 105.5 and 122 -- 16.5
    // units apart, well inside an unclamped 22-unit target.
    const near = dialPoint(105.5, 0);
    const far = dialPoint(122, 0);
    const separation = Math.hypot(far.cx - near.cx, far.cy - near.cy);
    expect(separation).toBeCloseTo(16.5, 3);

    const nearHit = hitRadiusForDot(near, [near, far]);
    const farHit = hitRadiusForDot(far, [near, far]);

    // The bug this replaces: both targets were 22, so the FARTHER camera's
    // invisible circle covered the nearer camera's dot and took its taps.
    expect(nearHit + farHit).toBeLessThanOrEqual(separation);
    expect(nearHit).toBeCloseTo(separation / 2, 3);
    expect(farHit).toBeCloseTo(separation / 2, 3);
  });

  it('leaves a dot with a target it can still be tapped by', () => {
    const near = dialPoint(105.5, 0);
    const far = dialPoint(122, 0);
    // Half of 16.5 still clears the 5.5-unit dot it sits under.
    expect(hitRadiusForDot(near, [near, far])).toBeGreaterThan(DOT_RADIUS);
  });

  it('shrinks for a dot on any bearing, not just a radial neighbour', () => {
    const here = dialPoint(100, 0);
    const beside = dialPoint(100, 6);
    const separation = Math.hypot(beside.cx - here.cx, beside.cy - here.cy);
    expect(separation).toBeLessThan(DOT_HIT_RADIUS * 2);
    expect(hitRadiusForDot(here, [here, beside]) * 2).toBeLessThanOrEqual(separation);
  });

  it('counts a ghost as a neighbour -- a tap resolves to the nearest dot, camera or not', () => {
    const camera = dialPoint(105.5, 0);
    const ghost = dialPoint(112, 0);
    expect(hitRadiusForDot(camera, [camera, ghost])).toBeLessThan(DOT_HIT_RADIUS);
  });

  it('ignores the dot itself and a dot drawn on top of it', () => {
    const point = dialPoint(105.5, 0);
    // There is no halfway line between a point and itself, and a duplicate the
    // engine failed to deduplicate must not shrink the target to nothing.
    expect(hitRadiusForDot(point, [point, { ...point }])).toBe(DOT_HIT_RADIUS);
  });

  it('stays in step with the touch floor it mirrors', () => {
    const floors = [...tokensCss.matchAll(/--fwm-touch-min:\s*([\d.]+)px/g)].map((match) =>
      Number(match[1]),
    );
    const [phone] = floors;

    // The :root value comes first; the rest are surface overrides.
    expect(phone).toBe(DOT_HIT_RADIUS * 2);
    // And it is NOT the only floor in the file -- `watch-round` and `dash-cast`
    // raise it, and a dial unit cannot follow them. That is the caveat recorded
    // on DOT_HIT_RADIUS and in the gap entry; this assertion is what keeps the
    // claim from quietly becoming false.
    expect(new Set(floors).size).toBeGreaterThan(1);
  });
});
