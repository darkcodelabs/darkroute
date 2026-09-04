import { describe, expect, it } from 'vitest';

import { SWEEP_RING_FT } from '../../stores/fwmCore.ts';

import {
  DIAL_CENTRE,
  SWEEP_RINGS,
  radiusForDistanceFt,
  ringsForOuterFt,
} from './geometry.ts';
import {
  DEFAULT_SWEEP_ZOOM,
  FEET_PER_MILE,
  MAX_OUTER_FT,
  MIN_OUTER_FT,
  RING_RATIOS,
  SWEEP_ZOOMS,
  zoomById,
} from './zoom.ts';

describe('the zoom ramp', () => {
  it('still carries the design’s drawn range as the first rung', () => {
    // 1000 FT is what the design drew, and the ladder still starts there. It is
    // no longer where the dial OPENS -- see the next test.
    expect(SWEEP_ZOOMS[0]?.outerFt).toBe(1000);
    expect(SWEEP_ZOOMS[0]?.label).toBe('1000 FT');
  });

  it('opens with travel in both directions, not clamped at the floor', () => {
    // It used to open on SWEEP_ZOOMS[0], which is also MIN_OUTER_FT: the dial
    // started already clamped, so spreading two fingers -- the gesture for a
    // tighter range -- did nothing, and the only zoom control the merged RADAR
    // has read as broken. It also meant opening on a scope with nothing on it,
    // under a hero saying the nearest camera was 1.5 miles away.
    expect(DEFAULT_SWEEP_ZOOM.outerFt).toBeGreaterThan(MIN_OUTER_FT);
    expect(DEFAULT_SWEEP_ZOOM.outerFt).toBeLessThan(MAX_OUTER_FT);
    // Wide enough to hold the 500 ft alert threshold ring legibly.
    expect(DEFAULT_SWEEP_ZOOM.outerFt).toBeGreaterThanOrEqual(2_000);
  });

  it('reproduces the drawn ring POSITIONS exactly at the design’s drawn range', () => {
    // The rings are still drawn precisely where the design drew them -- that
    // part of the safety argument for adding zoom is unchanged and asserted.
    //
    // What each one STANDS FOR is no longer `SWEEP_RING_FT`. The design
    // labelled them 100 / 300 / 500 / 1000 while drawing them at 20.6 / 43.3 /
    // 70.1 / 100 % of the radius, which only holds if the scale bends -- and
    // that bend is what curved every road and distorted the spacing between
    // cameras. The scale is proportional now and a ring means what its radius
    // works out to.
    // The outermost ring no longer stands for the FULL range: the scale reaches
    // the edge of the frame now, and the rings sit inside that. They are the
    // inset gauge's furniture, drawn where the design drew them.
    const rings = ringsForOuterFt(1000);
    expect(rings.map((r) => r.radius)).toEqual(SWEEP_RINGS.map((r) => r.radius));
    expect(rings.at(-1)?.ft).toBeLessThan(1000);
    expect(rings.at(-1)?.ft).toBeGreaterThan(0);
  });

  it('keeps the radii fixed at every range - only what a ring MEANS changes', () => {
    const drawn = SWEEP_RINGS.map((r) => r.radius);
    for (const zoom of SWEEP_ZOOMS) {
      expect(ringsForOuterFt(zoom.outerFt).map((r) => r.radius)).toEqual(drawn);
    }
  });

  it('keeps the design’s compressed near field at every range', () => {
    // Ratios come from the design (100/300/500/1000), so a wider range is the
    // same picture at a different scale rather than a different picture.
    expect(RING_RATIOS).toEqual([0.1, 0.3, 0.5, 1]);
  });

  it('places a camera further in as the range widens, and never off the rim', () => {
    const at1000 = radiusForDistanceFt(500, 1000);
    const at1mi = radiusForDistanceFt(500, FEET_PER_MILE);

    expect(at1000).not.toBeNull();
    expect(at1mi).not.toBeNull();
    expect(at1mi as number).toBeLessThan(at1000 as number);
    expect(at1000 as number).toBeLessThanOrEqual(DIAL_CENTRE);
  });

  it('draws a camera that the default range has to drop', () => {
    // A mile away is off the drawn dial entirely - which is the reason to have
    // a zoom at all, and is asserted rather than described.
    expect(radiusForDistanceFt(FEET_PER_MILE, 1000)).toBeNull();
    expect(radiusForDistanceFt(FEET_PER_MILE, FEET_PER_MILE)).not.toBeNull();
  });

  it('still refuses anything past the outer ring, at every range', () => {
    for (const zoom of SWEEP_ZOOMS) {
      expect(radiusForDistanceFt(zoom.outerFt + 1, zoom.outerFt)).toBeNull();
      expect(radiusForDistanceFt(-1, zoom.outerFt)).toBeNull();
      expect(radiusForDistanceFt(Number.NaN, zoom.outerFt)).toBeNull();
    }
  });

  it('labels rings in the unit the key names', () => {
    const ft = zoomById('1000ft');
    expect(ft.ringLabel(0.1)).toBe('100');
    expect(ft.ringLabel(1)).toBe('1000');

    const fiveMi = zoomById('5mi');
    expect(fiveMi.ringLabel(0.1)).toBe('0.5');
    expect(fiveMi.ringLabel(1)).toBe('5');

    // A decimal only when there is one to show, at any magnitude: "7.5" beside
    // "13" would read as two scales on one dial.
    const twentyFive = zoomById('25mi');
    expect(twentyFive.ringLabel(0.3)).toBe('7.5');
    expect(twentyFive.ringLabel(0.5)).toBe('12.5');
    expect(twentyFive.ringLabel(1)).toBe('25');
  });

  it('falls back to the drawn range for an id it does not know', () => {
    expect(zoomById('50mi')).toBe(DEFAULT_SWEEP_ZOOM);
    expect(zoomById('')).toBe(DEFAULT_SWEEP_ZOOM);
  });

  it('never widens what alerts - the engine ring scale is untouched', () => {
    // Looking further and being warned further are different questions. If this
    // ever fails, a zoom control has become a driving hazard.
    expect(SWEEP_RING_FT).toEqual([100, 300, 500, 1000]);
  });
});
