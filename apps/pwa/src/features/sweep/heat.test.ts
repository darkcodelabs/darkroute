/**
 * THE COVERAGE FIELD - that density is what it actually measures.
 *
 * The field's whole claim is "several cameras here look different from one".
 * If the ramp or the accumulation is wrong, it still LOOKS like weather while
 * telling the driver nothing, which is the worst failure available to it: a
 * picture that is confidently meaningless.
 */

import { describe, expect, it } from 'vitest';

import {
  HEAT_ALPHA_CURVE,
  HEAT_MAX_ALPHA,
  HEAT_PEAK_ALPHA,
  HEAT_RADIUS_MAX_UNITS,
  HEAT_RADIUS_MIN_UNITS,
  HEAT_SATURATION,
  HEAT_STOPS_FALLBACK,
  heatColour,
  heatRadiusUnits,
} from './heat.ts';

describe('a blob is a piece of GROUND, not a piece of the screen', () => {
  const RING = 171.5;
  const MILE = 5280;

  /**
   * THE BUG. The radius was a fraction of the ring, so a blob was the same size
   * on screen at every zoom -- which meant zooming out made every blob cover
   * miles of ground and the whole metro merged into one lump sitting on the
   * vehicle. The picture stopped depending on where the cameras were.
   */
  it('shrinks on screen as the scope widens, so the distribution appears', () => {
    const close = heatRadiusUnits(RING, MILE);
    const wide = heatRadiusUnits(RING, 25 * MILE);
    expect(wide).toBeLessThan(close);
  });

  it('covers the same ground at both, which is the point', () => {
    // Convert each back to feet: they must agree until a bound clamps them.
    const mid = heatRadiusUnits(RING, 5 * MILE);
    const groundFt = (mid / RING) * 5 * MILE;
    expect(groundFt).toBeCloseTo(2640, -2);
  });

  it('never becomes a pinprick or a wash', () => {
    for (const outerFt of [500, MILE, 5 * MILE, 25 * MILE]) {
      const value = heatRadiusUnits(RING, outerFt);
      expect(value).toBeGreaterThanOrEqual(HEAT_RADIUS_MIN_UNITS);
      expect(value).toBeLessThanOrEqual(HEAT_RADIUS_MAX_UNITS);
    }
  });

  it('falls back rather than returning NaN on a broken scope', () => {
    expect(heatRadiusUnits(Number.NaN, MILE)).toBe(HEAT_RADIUS_MIN_UNITS);
    expect(heatRadiusUnits(0, MILE)).toBe(HEAT_RADIUS_MIN_UNITS);
    expect(heatRadiusUnits(RING, 0)).toBe(HEAT_RADIUS_MIN_UNITS);
    expect(heatRadiusUnits(RING, Number.NaN)).toBe(HEAT_RADIUS_MIN_UNITS);
  });
});

describe('the ramp runs cool to hot, in the markers own palette', () => {
  const cool = HEAT_STOPS_FALLBACK[0];
  const hot = HEAT_STOPS_FALLBACK[HEAT_STOPS_FALLBACK.length - 1];

  it('lands exactly on its stops at each end', () => {
    // Plasma, reversed: sparse ground is the cold end, a lined corridor the
    // incandescent one. The SAME eleven colours the dots are drawn in -- the
    // field used to have its own ramp and the map spoke two colour languages.
    expect(heatColour(0)).toEqual(cool);
    expect(heatColour(1)).toEqual(hot);
    expect(HEAT_STOPS_FALLBACK).toHaveLength(11);
  });

  it('gets hotter as density rises, which is the whole signal', () => {
    const low = heatColour(0.1);
    const high = heatColour(0.9);
    // Warmer: more red, much less blue.
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(high[2]).toBeLessThan(low[2]);
  });

  it('clamps rather than extrapolating past either end', () => {
    expect(heatColour(-3)).toEqual(cool);
    expect(heatColour(50)).toEqual(hot);
    expect(heatColour(Number.NaN)).toEqual(hot);
  });

  it('takes the stops it is given, so a theme restates the weather', () => {
    // The live values come off --fwm-accent-scan / -approaching / -in-range.
    const themed = [
      [0, 0, 0],
      [128, 128, 128],
      [255, 255, 255],
    ] as const;
    expect(heatColour(0, themed)).toEqual([0, 0, 0]);
    expect(heatColour(1, themed)).toEqual([255, 255, 255]);
    expect(heatColour(0.5, themed)).toEqual([128, 128, 128]);
  });

  it('survives a degenerate ramp instead of dividing by zero', () => {
    expect(heatColour(0.5, [])).toEqual([255, 255, 255]);
    expect(heatColour(0.5, [[10, 20, 30]])).toEqual([10, 20, 30]);
  });
});

describe('THE BUG: a field nobody could see', () => {
  /**
   * Measured on the deployed scope, before the tuning: hiding the canvas and
   * diffing the two screenshots changed 0.29 % of the pixels. The field was
   * being painted correctly and was, in practice, not there.
   *
   * The arithmetic that produced it: one camera contributed alpha 0.13, the
   * saturation ceiling was nine cameras, so a lone camera landed at density
   * 0.11 and a final alpha of 32/255 -- about RGB(10, 25, 23) over black.
   *
   * These assertions are about the FLOOR, not about the exact numbers. A field
   * that cannot be seen is worse than no field at all, because the density it
   * exists to communicate then reads as empty ground.
   */
  const alphaFor = (cameras: number): number => {
    const accumulated = Math.min(255, HEAT_PEAK_ALPHA * 255 * cameras);
    const density = Math.min(1, accumulated / (HEAT_PEAK_ALPHA * HEAT_SATURATION * 255));
    return Math.round(Math.min(1, density ** HEAT_ALPHA_CURVE) * HEAT_MAX_ALPHA);
  };

  it('makes ONE camera visible against the background', () => {
    // The old value was 32. Over black that is indistinguishable from nothing.
    expect(alphaFor(1)).toBeGreaterThan(60);
  });

  it('still keeps one camera quiet enough to be a wash, not a marker', () => {
    // The brief is "lightly coloured". The dots are the markers; this is
    // weather under them, and it must not compete with them.
    expect(alphaFor(1)).toBeLessThan(HEAT_MAX_ALPHA * 0.6);
  });

  it('gets meaningfully hotter as cameras pile up', () => {
    expect(alphaFor(3)).toBeGreaterThan(alphaFor(1));
    expect(alphaFor(5)).toBeGreaterThan(alphaFor(3));
  });

  it('keeps the ceiling inside the byte density accumulates in', () => {
    // Density piles up in the ALPHA CHANNEL, which stops at 255 however many
    // cameras overlap. A ceiling above that makes the hot end of the ramp
    // unreachable everywhere; a ceiling far below it makes the hot end
    // reachable EVERYWHERE, which is what turned a whole metro into one flat
    // red slab. Both failures are this one number.
    const ceiling = HEAT_PEAK_ALPHA * HEAT_SATURATION * 255;
    expect(ceiling).toBeLessThan(255);
    expect(ceiling).toBeGreaterThan(180);
  });

  it('leaves real gradient between one camera and a full corridor', () => {
    const densityAt = (cameras: number): number =>
      Math.min(1, Math.min(255, HEAT_PEAK_ALPHA * 255 * cameras) / (HEAT_PEAK_ALPHA * HEAT_SATURATION * 255));
    // Six overlapping cameras must be somewhere in the MIDDLE of the ramp --
    // not already pinned at the hot end the way five was before.
    const mid = densityAt(6);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.6);
    expect(densityAt(HEAT_SATURATION)).toBeCloseTo(1, 1);
  });
});
