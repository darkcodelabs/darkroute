/**
 * THE POSTED LIMIT - mostly a test that it refuses to guess.
 *
 * The plate is a white MUTCD face: the most authoritative-looking object on the
 * screen. Anything it prints, it asserts. So most of what is worth pinning here
 * is the set of inputs that must produce a DASH rather than a number.
 */

import { describe, expect, it } from 'vitest';

import { OVER_LIMIT_TOLERANCE_MPH, parseMaxspeed, speedPlateState } from './speedLimit.ts';

describe('reading an OSM maxspeed', () => {
  it('takes an explicit mph value', () => {
    expect(parseMaxspeed('55 mph')).toBe(55);
    expect(parseMaxspeed('25mph')).toBe(25);
    expect(parseMaxspeed('  70 MPH ')).toBe(70);
  });

  it('converts an EXPLICIT metric value, which carries no ambiguity', () => {
    expect(parseMaxspeed('100 km/h')).toBe(62);
    expect(parseMaxspeed('30 kph')).toBe(19);
  });

  it('refuses every value that is not simply a number', () => {
    // Each of these means "the limit is not a number here", and the honest
    // rendering of that is a dash -- not a plausible default.
    for (const raw of ['signals', 'variable', 'none', 'walk', 'RU:urban', 'DE:motorway']) {
      expect(parseMaxspeed(raw)).toBeNull();
    }
  });

  it('refuses absent, empty and nonsense input', () => {
    expect(parseMaxspeed(null)).toBeNull();
    expect(parseMaxspeed(undefined)).toBeNull();
    expect(parseMaxspeed('')).toBeNull();
    expect(parseMaxspeed('   ')).toBeNull();
    expect(parseMaxspeed('0')).toBeNull();
    expect(parseMaxspeed('-20')).toBeNull();
  });
});

describe('what the plate prints', () => {
  it('shows a dash for an unknown limit, never a guess', () => {
    const state = speedPlateState(62, null);
    expect(state.limitLabel).toBe('—');
    expect(state.limitMph).toBeNull();
  });

  it('never calls you over the limit when the limit is unknown', () => {
    // Colouring a speed against a limit we do not have is the same guess,
    // wearing a different hat.
    expect(speedPlateState(95, null).over).toBe(false);
    expect(speedPlateState(95, 'signals').over).toBe(false);
  });

  it('never calls you over when the speed is unknown', () => {
    expect(speedPlateState(null, '25 mph').over).toBe(false);
    expect(speedPlateState(null, '25 mph').speedLabel).toBe('—');
  });

  it('goes over only outside the GPS noise band', () => {
    // A readout that flickers between two colours while the driver holds one
    // speed teaches them to stop looking at it.
    expect(speedPlateState(55, '55 mph').over).toBe(false);
    expect(speedPlateState(55 + OVER_LIMIT_TOLERANCE_MPH, '55 mph').over).toBe(false);
    expect(speedPlateState(55 + OVER_LIMIT_TOLERANCE_MPH + 1, '55 mph').over).toBe(true);
  });

  it('rounds the speed rather than printing a decimal on a road sign', () => {
    expect(speedPlateState(61.6, '55 mph').speedLabel).toBe('62');
  });

  it('refuses a negative or non-finite speed instead of drawing it', () => {
    expect(speedPlateState(-3, '55 mph').speedLabel).toBe('—');
    expect(speedPlateState(Number.NaN, '55 mph').speedLabel).toBe('—');
  });
});

describe('a bare number is refused rather than guessed', () => {
  it('prints nothing for a unitless value, whichever unit it meant', () => {
    // OSM says unitless is km/h; the US extract says these ~9,100 ways are
    // mistagged mph. Following the convention prints 16 for a road signed 25;
    // following the evidence prints a number on a hunch. On an object drawn as
    // a road sign, neither is allowed.
    expect(parseMaxspeed('25')).toBeNull();
    expect(parseMaxspeed('50')).toBeNull();
  });

  it('still converts an EXPLICIT metric value, which is not ambiguous', () => {
    expect(parseMaxspeed('50 km/h')).toBe(31);
    expect(parseMaxspeed('100 kph')).toBe(62);
  });

  it('still reads the mph values that make up 99.7% of the US extract', () => {
    expect(parseMaxspeed('55 mph')).toBe(55);
    expect(parseMaxspeed('25 MPH')).toBe(25);
  });
});
