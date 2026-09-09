/**
 * THE DISTANCE RAMP, AND THE ONE PROPERTY IT HAS TO KEEP.
 *
 * The border and the camera list are coloured by these bands, and the whole
 * claim they make is CLOSER IS WORSE. That claim is easy to break by accident:
 * the previous palette ran green, cyan, amber, red, and cyan reads cooler than
 * the green before it - so the middle of the ramp ran backwards while every
 * test still passed, because nothing tested the ORDER.
 *
 * These pin the order and the boundaries, so a band added or a multiplier
 * nudged cannot quietly invert the thing the colour is for.
 */

import { describe, expect, it } from 'vitest';

import { proximityBand } from './DriveScreen.tsx';
import type { ProximityBand } from './DriveScreen.tsx';

/** Coolest to hottest. The colours follow this, so this is the contract. */
const RAMP: readonly ProximityBand[] = ['far', 'near', 'approaching', 'closing', 'in-range'];

const THRESHOLD = 500;

describe('proximityBand', () => {
  it('gets hotter, monotonically, as the camera gets closer', () => {
    // The property in one assertion: walk in from far away and the band index
    // may never go DOWN. This is what "cyan after green" broke.
    let lowest = -1;
    for (let ft = THRESHOLD * 8; ft >= 10; ft -= 10) {
      const at = RAMP.indexOf(proximityBand(ft, THRESHOLD));
      expect(at, `no ramp position for ${String(ft)} ft`).toBeGreaterThan(-1);
      expect(at, `the ramp went backwards at ${String(ft)} ft`).toBeGreaterThanOrEqual(lowest);
      lowest = at;
    }
  });

  it('puts the warning exactly at the threshold the driver set', () => {
    // Not one foot early and not one late: the band change IS the promise the
    // alert setting makes.
    expect(proximityBand(THRESHOLD, THRESHOLD)).toBe('in-range');
    expect(proximityBand(THRESHOLD + 1, THRESHOLD)).not.toBe('in-range');
  });

  it('reaches the top of the scale before the threshold, not at it', () => {
    // `closing` is the last band before the warning. If it collapsed into
    // `in-range` the ramp would jump from orange straight to red and the
    // approach would have no yellow at all.
    expect(proximityBand(THRESHOLD * 1.2, THRESHOLD)).toBe('closing');
  });

  it('bands against the DRIVER’s threshold, not a fixed distance', () => {
    // The same colour must mean the same thing at every radius setting, which
    // is the reason these are multiples rather than feet.
    for (const threshold of [100, 500, 1000]) {
      expect(proximityBand(threshold * 0.5, threshold)).toBe('in-range');
      expect(proximityBand(threshold * 1.2, threshold)).toBe('closing');
      expect(proximityBand(threshold * 3, threshold)).toBe('near');
      expect(proximityBand(threshold * 9, threshold)).toBe('far');
    }
  });

  it('says nothing rather than guessing when there is nothing to measure', () => {
    expect(proximityBand(null, THRESHOLD)).toBe('none');
    expect(proximityBand(Number.NaN, THRESHOLD)).toBe('none');
    expect(proximityBand(Number.POSITIVE_INFINITY, THRESHOLD)).toBe('none');
    // A threshold of zero is not a radius, so nothing can be inside it.
    expect(proximityBand(10, 0)).toBe('none');
  });
});
