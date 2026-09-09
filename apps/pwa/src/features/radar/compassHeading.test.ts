/**
 * COMPASS HEADING - the platform differences, pinned without a phone.
 *
 * Android counts anticlockwise and iOS clockwise. That single sign is the
 * difference between a needle pointing where the car is going and a needle
 * pointing at its mirror image, and nobody was ever going to catch it at a
 * desk. So it is a test.
 */

import { describe, expect, it } from 'vitest';

import {
  COMPASS_STEP_DEG,
  headingFromOrientation,
  normalise,
  preferHeading,
  worthPublishing,
} from './compassHeading.ts';

describe('reading one orientation event', () => {
  it('takes iOS webkitCompassHeading as a bearing, unchanged', () => {
    // Already true-north and clockwise: exactly what the app means by heading.
    expect(headingFromOrientation({ webkitCompassHeading: 90 })).toBe(90);
    expect(headingFromOrientation({ webkitCompassHeading: 0 })).toBe(0);
    expect(headingFromOrientation({ webkitCompassHeading: 359.4 })).toBeCloseTo(359.4, 3);
  });

  it('FLIPS Android alpha, which counts the other way round', () => {
    // alpha 90 is WEST on Android. Read as a bearing it would say east, and the
    // needle would point at the mirror image of where the car is going.
    expect(headingFromOrientation({ alpha: 90, absolute: true })).toBe(270);
    expect(headingFromOrientation({ alpha: 270, absolute: true })).toBe(90);
    expect(headingFromOrientation({ alpha: 0, absolute: true })).toBe(0);
  });

  it('refuses a RELATIVE reading, which is not a compass at all', () => {
    // Chrome fires deviceorientation with absolute:false from a sensor whose
    // zero is wherever the phone was looking when the page loaded. Using it
    // would point the needle confidently at nothing.
    expect(headingFromOrientation({ alpha: 120, absolute: false })).toBeNull();
    expect(headingFromOrientation({ alpha: 120 })).toBeNull();
  });

  it('prefers the iOS value when a device somehow reports both', () => {
    expect(headingFromOrientation({ webkitCompassHeading: 45, alpha: 200, absolute: true })).toBe(
      45,
    );
  });

  it('returns null rather than NaN for junk', () => {
    expect(headingFromOrientation({})).toBeNull();
    expect(headingFromOrientation({ alpha: null, absolute: true })).toBeNull();
    expect(headingFromOrientation({ webkitCompassHeading: Number.NaN })).toBeNull();
  });
});

describe('which sensor wins', () => {
  it('takes the GPS course whenever there is one', () => {
    // A car is a steel box and the magnetometer inside is reading the car as
    // much as the earth. Once the course is real, it is the better number.
    expect(preferHeading(41, 200)).toEqual({ headingDeg: 41, source: 'gps' });
  });

  it('falls back to the compass when the car is standing still', () => {
    // THE WHOLE POINT. A parked car pointing north is pointing north, and the
    // screen used to say NO BEARING beside an accuracy chip reading ±8 M.
    expect(preferHeading(null, 200)).toEqual({ headingDeg: 200, source: 'compass' });
  });

  it('reports nothing when neither sensor has anything', () => {
    expect(preferHeading(null, null)).toEqual({ headingDeg: null, source: 'none' });
  });

  it('normalises whatever it is handed', () => {
    expect(preferHeading(-90, null).headingDeg).toBe(270);
    expect(preferHeading(null, 450).headingDeg).toBe(90);
  });
});

describe('not republishing every twitch', () => {
  it('publishes the first reading', () => {
    expect(worthPublishing(null, 12)).toBe(true);
  });

  it('ignores movement below the step', () => {
    expect(worthPublishing(100, 100 + COMPASS_STEP_DEG - 1)).toBe(false);
  });

  it('publishes movement at or past the step', () => {
    expect(worthPublishing(100, 100 + COMPASS_STEP_DEG)).toBe(true);
  });

  it('measures across the 360 wrap, not through it', () => {
    // 359 -> 1 is two degrees, not 358. Without this the needle would republish
    // on every sample that happened to cross north.
    expect(worthPublishing(359, 1)).toBe(false);
    expect(worthPublishing(359, 5)).toBe(true);
  });
});

describe('normalise', () => {
  it('wraps into [0, 360)', () => {
    expect(normalise(-1)).toBe(359);
    expect(normalise(360)).toBe(0);
    expect(normalise(720 + 45)).toBe(45);
  });
});
