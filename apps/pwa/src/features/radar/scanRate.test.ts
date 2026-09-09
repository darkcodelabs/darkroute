/**
 * The scope's `SCAN N HZ` readout is a measurement, and these are its terms.
 *
 * Reference: `Flockys App Screens v2.dc.html`, `01 · RADAR - IN RANGE` renders
 * `SCAN 4HZ` down the right edge of the scope; `Flockys Screens II.dc.html`,
 * `A3 · CONNECT` is where the 4 comes from -- the glovebox node "streaming at
 * 4 Hz over its own AP".
 */

import { describe, expect, it } from 'vitest';

import { NO_VALUE } from './format.ts';
import { SCAN_RATE_SAMPLES, formatScanRate, scanRateHz, trackFixTime } from './scanRate.ts';

describe('trackFixTime', () => {
  it('keeps the fix times it is given, oldest first', () => {
    let window: readonly number[] = [];
    for (const t of [1000, 1250, 1500]) window = trackFixTime(window, t);
    expect(window).toEqual([1000, 1250, 1500]);
  });

  it('ignores a timestamp it has already been given', () => {
    // The position slice republishes `fixAtMs` on every render until the next
    // fix lands, and React strict mode renders twice. Neither is a second fix.
    let window = trackFixTime([], 1000);
    window = trackFixTime(window, 1000);
    window = trackFixTime(window, 1000);
    expect(window).toEqual([1000]);
  });

  it('ignores a timestamp older than the newest one', () => {
    const window = trackFixTime([2000], 1000);
    expect(window).toEqual([2000]);
  });

  it('ignores null -- nothing has ever arrived', () => {
    expect(trackFixTime([1000], null)).toEqual([1000]);
  });

  it('never grows past the smoothing window', () => {
    let window: readonly number[] = [];
    for (let i = 0; i < SCAN_RATE_SAMPLES * 3; i += 1) window = trackFixTime(window, i * 250);
    expect(window).toHaveLength(SCAN_RATE_SAMPLES);
  });

  it('drops the oldest sample first, so the window is the RECENT past', () => {
    let window: readonly number[] = [];
    for (let i = 0; i < SCAN_RATE_SAMPLES + 1; i += 1) window = trackFixTime(window, i * 250);
    expect(window[0]).toBe(250);
    expect(window[window.length - 1]).toBe(SCAN_RATE_SAMPLES * 250);
  });
});

describe('scanRateHz', () => {
  it('reads 4 Hz off fixes 250 ms apart -- the design\'s own number', () => {
    let window: readonly number[] = [];
    for (let i = 0; i < 5; i += 1) window = trackFixTime(window, i * 250);
    expect(scanRateHz(window)).toBeCloseTo(4, 6);
  });

  it('reads 1 Hz off a browser cadence', () => {
    expect(scanRateHz([0, 1000, 2000, 3000])).toBeCloseTo(1, 6);
  });

  it('has no rate from a single fix -- one timestamp is an event', () => {
    expect(scanRateHz([1000])).toBeNull();
    expect(scanRateHz([])).toBeNull();
  });

  it('reports the stall rather than hiding it', () => {
    // Four fixes at 4 Hz then a ten-second gap: the honest reading is the slow
    // one, because the scope really has not been told anything for ten seconds.
    const stalled = scanRateHz([0, 250, 500, 750, 10_750]);
    expect(stalled).not.toBeNull();
    expect(stalled as number).toBeLessThan(1);
  });
});

describe('formatScanRate', () => {
  it('renders whole hertz with no space before the unit, as drawn', () => {
    expect(formatScanRate(4)).toBe('4HZ');
    expect(formatScanRate(1)).toBe('1HZ');
  });

  it('rounds to the nearest whole hertz at or above 1 Hz', () => {
    expect(formatScanRate(3.9)).toBe('4HZ');
    expect(formatScanRate(1.2)).toBe('1HZ');
  });

  it('keeps a decimal below 1 Hz rather than rounding a live stream to zero', () => {
    expect(formatScanRate(0.5)).toBe('0.5HZ');
    expect(formatScanRate(0.24)).toBe('0.2HZ');
  });

  it('says nothing rather than a fabricated 4HZ when there is no measurement', () => {
    expect(formatScanRate(null)).toBe(NO_VALUE);
    expect(formatScanRate(0)).toBe(NO_VALUE);
    expect(formatScanRate(Number.NaN)).toBe(NO_VALUE);
  });
});
