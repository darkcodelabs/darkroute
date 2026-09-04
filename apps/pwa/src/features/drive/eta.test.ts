/**
 * The ETA is the number a driver acts on, and the ways it can lie are all
 * arithmetic that looks fine. Every case here is one of them.
 */

import { describe, expect, it } from 'vitest';

import { MAX_USEFUL_SECONDS, MIN_MOVING_MPH, describeEta, etaSeconds } from './eta.ts';

describe('etaSeconds', () => {
  it('is distance over speed when both are real', () => {
    // 2640 ft is half a mile; at 30 mph that is a minute.
    expect(etaSeconds({ distanceFt: 2640, speedMph: 30 })).toBe(60);
  });

  it('REFUSES TO ANSWER WHEN STOPPED', () => {
    // The bug this exists to prevent. At a light, distance over speed divides
    // by roughly zero: 2640 ft at 0.5 mph is fifty minutes, and the screen
    // would confidently announce a camera the driver can see out of the
    // window. Silence is the correct output.
    expect(etaSeconds({ distanceFt: 2640, speedMph: 0 })).toBeNull();
    expect(etaSeconds({ distanceFt: 2640, speedMph: 0.5 })).toBeNull();
    expect(etaSeconds({ distanceFt: 2640, speedMph: MIN_MOVING_MPH - 0.1 })).toBeNull();
  });

  it('treats an unknown speed as unknown, not as slow', () => {
    // GPS gives no speed on a first fix and drops it indoors.
    expect(etaSeconds({ distanceFt: 2640, speedMph: null })).toBeNull();
    expect(etaSeconds({ distanceFt: 2640, speedMph: Number.NaN })).toBeNull();
  });

  it('has no answer for a camera that is not getting closer', () => {
    // A camera behind you has no time-to-arrival however fast you are going.
    expect(etaSeconds({ distanceFt: 2640, speedMph: 40, closing: false })).toBeNull();
  });

  it('answers when closing is merely unknown', () => {
    // On the first fixes there is no history to say either way, and a
    // shrinking distance is the common case. Withholding here would mean the
    // figure never appeared at the start of a drive.
    expect(etaSeconds({ distanceFt: 2640, speedMph: 30, closing: null })).toBe(60);
  });

  it('withholds a figure too far out to act on', () => {
    // Ten minutes of straight-line driving is several turns away, and a number
    // that precise about it is false precision.
    const far = { distanceFt: 5280 * 20, speedMph: 20 };
    expect(etaSeconds(far)).toBeNull();
    expect(MAX_USEFUL_SECONDS).toBe(600);
  });

  it('refuses nonsense distances rather than rendering them', () => {
    for (const distanceFt of [null, Number.NaN, -100]) {
      expect(etaSeconds({ distanceFt, speedMph: 30 })).toBeNull();
    }
  });

  it('is a ceiling, so it errs early rather than late', () => {
    // Straight-line at current speed. A real route is longer, so the true time
    // is almost always more than this. A driver warned early is fine; one
    // warned late is not.
    const straight = etaSeconds({ distanceFt: 5280, speedMph: 60 });
    expect(straight).toBe(60);
  });
});

describe('describeEta', () => {
  it('reads in seconds inside the reacting window', () => {
    expect(describeEta(38)).toBe('38 SEC');
    expect(describeEta(119)).toBe('119 SEC');
  });

  it('switches to minutes where seconds stop being readable', () => {
    // "94 SEC" is a number to decode. Two minutes is a number to read.
    expect(describeEta(120)).toBe('2 MIN');
    expect(describeEta(300)).toBe('5 MIN');
  });

  it('passes an absence through as an absence', () => {
    // Never "0 SEC", which would read as "now".
    expect(describeEta(null)).toBeNull();
  });
});
