import { describe, expect, it } from 'vitest';

import { pinchLimit, pinchOuterFt, spread } from './pinch.ts';
import {
  MAX_OUTER_FT,
  MIN_OUTER_FT,
  clampOuterFt,
  formatOuterFt,
  nearestZoom,
  ringLabelFor,
} from './zoom.ts';

const FIVE_MI = 26_400;

describe('the pinch gesture', () => {
  it('measures the spread between two fingers', () => {
    expect(spread({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('zooms IN when the fingers move apart', () => {
    // The classic pinch bug is this backwards, and it feels broken instantly.
    // Fingers apart means "show me less ground, bigger", so the outer ring
    // must SHRINK.
    const anchor = { startSpread: 100, startOuterFt: FIVE_MI };

    const zoomedIn = pinchOuterFt(anchor, 200);

    expect(zoomedIn).toBeLessThan(FIVE_MI);
  });

  it('zooms OUT when the fingers come together', () => {
    const anchor = { startSpread: 200, startOuterFt: FIVE_MI };

    expect(pinchOuterFt(anchor, 100)).toBeGreaterThan(FIVE_MI);
  });

  it('returns to where it began when the fingers do', () => {
    // Anchored to the start rather than integrated frame by frame: accumulating
    // deltas drifts, and a driver who pinches out and back would find a
    // different range than they started with.
    const anchor = { startSpread: 140, startOuterFt: FIVE_MI };

    pinchOuterFt(anchor, 300);
    pinchOuterFt(anchor, 60);

    expect(pinchOuterFt(anchor, 140)).toBeCloseTo(FIVE_MI, 6);
  });

  it('scales by ratio, so the same squeeze does the same thing anywhere', () => {
    const near = pinchOuterFt({ startSpread: 100, startOuterFt: 2000 }, 200);
    const far = pinchOuterFt({ startSpread: 100, startOuterFt: 20_000 }, 200);

    expect(near / 2000).toBeCloseTo(far / 20_000, 6);
  });

  it('never leaves the range the dial can honestly draw', () => {
    // The ratios have to beat the whole ladder, which now runs 1000 ft to 100
    // miles -- a factor of 528. A gesture that only spans part of that lands
    // inside the range and proves nothing about the clamp.
    const wideOpen = pinchOuterFt({ startSpread: 1, startOuterFt: MAX_OUTER_FT }, 100_000);
    const squeezed = pinchOuterFt({ startSpread: 100_000, startOuterFt: MIN_OUTER_FT }, 1);

    expect(wideOpen).toBe(MIN_OUTER_FT);
    expect(squeezed).toBe(MAX_OUTER_FT);
  });

  it('holds still on a degenerate gesture rather than jumping', () => {
    const anchor = { startSpread: 120, startOuterFt: FIVE_MI };

    expect(pinchOuterFt(anchor, 0)).toBe(FIVE_MI);
    expect(pinchOuterFt(anchor, Number.NaN)).toBe(FIVE_MI);
    expect(pinchOuterFt({ startSpread: 0, startOuterFt: FIVE_MI }, 200)).toBe(FIVE_MI);
  });

  it('says which way it can still go, so a maxed dial does not feel dead', () => {
    expect(pinchLimit(MIN_OUTER_FT)).toBe('min');
    expect(pinchLimit(MAX_OUTER_FT)).toBe('max');
    expect(pinchLimit(FIVE_MI)).toBeNull();
  });
});

describe('a range between the named ones', () => {
  it('stays inside the bounds', () => {
    expect(clampOuterFt(10)).toBe(MIN_OUTER_FT);
    expect(clampOuterFt(9_999_999)).toBe(MAX_OUTER_FT);
    expect(clampOuterFt(Number.NaN)).toBe(MIN_OUTER_FT);
  });

  it('highlights the nearest key by RATIO, not by feet', () => {
    // 1000 ft and 1 mi are 4,280 ft apart; 5 mi and 25 mi are 105,600 apart.
    // A linear nearest would snap almost everything to the widest key.
    expect(nearestZoom(1100).id).toBe('1000ft');
    expect(nearestZoom(5000).id).toBe('1mi');
    expect(nearestZoom(20_000).id).toBe('5mi');
    expect(nearestZoom(100_000).id).toBe('25mi');
  });

  it('labels rings in feet under a mile and miles above it', () => {
    expect(ringLabelFor(1000, 1)).toBe('1000');
    expect(ringLabelFor(1000, 0.1)).toBe('100');
    expect(ringLabelFor(FIVE_MI, 1)).toBe('5');
    expect(ringLabelFor(FIVE_MI, 0.1)).toBe('0.5');
  });

  it('rounds a pinched range to something readable at a glance', () => {
    // A ring label is read in traffic. "3,187" is noise; it is also not a
    // measurement of anything the driver chose.
    expect(ringLabelFor(3187, 1)).toBe('3190');
    expect(formatOuterFt(3187)).toBe('3190 FT');
    expect(formatOuterFt(17_000)).toBe('3.2 MI');
  });
});
