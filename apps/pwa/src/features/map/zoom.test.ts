import { describe, expect, it } from 'vitest';

import { MAX_ZOOM, MIN_ZOOM, isZoomCommand, outerFtForZoom, zoomForOuterFt } from './zoom.ts';

const MILE = 5280;

describe('feet to zoom', () => {
  it('round-trips, so the map and the range readout cannot disagree', () => {
    // RELATIVE, not absolute. The zoom is rounded to two decimals because a
    // clean number is what gets stored and logged, and at 25 miles one
    // hundredth of a zoom step is about 900 ft. Asserting to the foot would be
    // asserting that the rounding does not happen.
    for (const ft of [1000, MILE, 5 * MILE, 25 * MILE]) {
      const back = outerFtForZoom(zoomForOuterFt(ft));
      expect(Math.abs(back - ft) / ft).toBeLessThan(0.01);
    }
  });

  it('goes IN as the range narrows, which is the direction that bites', () => {
    // Zoom and range run opposite ways: a smaller range is a HIGHER zoom.
    expect(zoomForOuterFt(1000)).toBeGreaterThan(zoomForOuterFt(MILE));
    expect(zoomForOuterFt(MILE)).toBeGreaterThan(zoomForOuterFt(25 * MILE));
  });

  it('lands the ladder in the range a street map is legible at', () => {
    expect(zoomForOuterFt(1000)).toBeGreaterThan(15);
    expect(zoomForOuterFt(25 * MILE)).toBeLessThan(11);
  });

  it('never asks MapLibre for a zoom it does not have', () => {
    for (const ft of [1, 100, 25 * MILE, 5000 * MILE]) {
      const z = zoomForOuterFt(ft);
      expect(z).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(z).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  it('falls back rather than handing NaN to the renderer', () => {
    expect(zoomForOuterFt(Number.NaN)).toBe(14);
    expect(zoomForOuterFt(0)).toBe(14);
    expect(zoomForOuterFt(-1)).toBe(14);
  });
});

/**
 * THE PINCH HOLDS.
 *
 * The failure these cover, in the driver's words: "the pinch to zoom on the map
 * doesn't hold anything I punch it just snaps back to a zoomed view." The map
 * re-applied the zoom PROP on every GPS fix, so a gesture survived about a
 * second and was then overwritten by the number the app last decided on.
 *
 * The fix only works if a pinch, converted to feet and read back as a prop,
 * comes back close enough to be recognised as the SAME zoom. These pin that
 * round trip -- if a future change to the range ladder or the quantisation
 * widens the error past the epsilon, the snap-back returns and these fail
 * instead of the driver finding out on a motorway.
 */
describe('a pinch is not mistaken for a command', () => {
  it('survives the round trip through feet at every zoom a driver can reach', () => {
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 0.13) {
      const roundTripped = zoomForOuterFt(outerFtForZoom(zoom));
      expect(isZoomCommand(zoom, roundTripped)).toBe(false);
    }
  });

  it('still recognises a real range step as a command', () => {
    // 1000 ft to 1 mi -- the smallest step on the range ladder, and about two
    // and a half zoom levels. Nothing near the rounding noise.
    expect(isZoomCommand(zoomForOuterFt(1000), zoomForOuterFt(5280))).toBe(true);
  });

  it('treats the first zoom as a command, having nothing to compare against', () => {
    expect(isZoomCommand(null, 14)).toBe(true);
  });
});
