/**
 * Every assertion here is against a string the design files literally render.
 *
 * Sources: `01 · RADAR - IN RANGE` (425 / FT / AHEAD · SLIGHT LEFT / 47 / NE /
 * 041° / 12 / 39.0997 N, 84.5786 W / 7 SATS / THRESHOLD 500 FT), the RADAR state
 * matrix (820 / AHEAD · CLOSING / 2.4 / MI TO NEAREST / MUTED 8:12 / last fix
 * 40s ago / STILL TRACKING), and `A2 · OFFLINE` (610 / CACHED CAMERA · AHEAD).
 */

import { describe, expect, it } from 'vitest';

import {
  NO_VALUE,
  coarseDirection,
  directionLine,
  distanceUnit,
  fineDirection,
  formatCoordinates,
  formatCount,
  formatDistanceValue,
  formatFixAge,
  formatHeadingCardinal,
  formatHeadingDegrees,
  formatMuteCountdown,
  formatSatellites,
  formatSpeedMph,
} from './format.ts';

describe('distance', () => {
  it('renders whole feet under a mile-scale distance, exactly as drawn', () => {
    expect(formatDistanceValue(425)).toBe('425');
    expect(formatDistanceValue(820)).toBe('820');
    expect(formatDistanceValue(610)).toBe('610');
    expect(distanceUnit(425)).toBe('FT');
  });

  it('switches to one-decimal miles at the approaching boundary', () => {
    // 2.4 mi is the clear card's readout; 1000 ft is APPROACHING_OUTER_FT, the
    // engine's own line, so the unit and the amber change at the same distance.
    expect(formatDistanceValue(12672)).toBe('2.4');
    expect(distanceUnit(12672)).toBe('MI');
    expect(distanceUnit(999)).toBe('FT');
    expect(distanceUnit(1000)).toBe('MI');
  });

  it('renders an em dash rather than a fabricated zero when there is no distance', () => {
    expect(formatDistanceValue(null)).toBe(NO_VALUE);
    expect(formatDistanceValue(Number.NaN)).toBe(NO_VALUE);
  });
});

describe('mute countdown', () => {
  it('renders m:ss as the header draws it', () => {
    expect(formatMuteCountdown(8 * 60_000 + 12_000)).toBe('8:12');
    expect(formatMuteCountdown(60_000)).toBe('1:00');
  });

  it('never reads 0:00 while the mute is still on', () => {
    expect(formatMuteCountdown(1)).toBe('0:01');
    expect(formatMuteCountdown(0)).toBe('0:00');
  });
});

describe('coordinates', () => {
  it('renders the four-decimal hemisphere form the GPS row draws', () => {
    expect(formatCoordinates(39.0997, -84.5786)).toBe('39.0997 N, 84.5786 W');
    expect(formatCoordinates(-33.8688, 151.2093)).toBe('33.8688 S, 151.2093 E');
  });

  it('renders an em dash rather than 0.0000 when there is no fix', () => {
    expect(formatCoordinates(null, null)).toBe(NO_VALUE);
  });
});

describe('satellites', () => {
  it('renders the real count when the platform gives one', () => {
    expect(formatSatellites(7, 4)).toBe('7 SATS');
    expect(formatSatellites(0, 4)).toBe('0 SATS');
  });

  it('falls back to the accuracy figure rather than claiming zero satellites', () => {
    // A browser GeolocationPosition carries no satellite count. Printing
    // "0 SATS" beside a live lock would report a working fix as a broken one.
    expect(formatSatellites(null, 4)).toBe('±4 M');
    expect(formatSatellites(null, null)).toBe(NO_VALUE);
  });
});

describe('heading', () => {
  it('renders the eight-point cardinal and the zero-padded degrees as drawn', () => {
    expect(formatHeadingCardinal(41)).toBe('NE');
    expect(formatHeadingDegrees(41)).toBe('041°');
    expect(formatHeadingCardinal(0)).toBe('N');
    expect(formatHeadingCardinal(180)).toBe('S');
    expect(formatHeadingCardinal(315)).toBe('NW');
    expect(formatHeadingCardinal(359)).toBe('N');
  });

  it('renders an em dash when the platform reports no heading', () => {
    expect(formatHeadingCardinal(null)).toBe(NO_VALUE);
    expect(formatHeadingDegrees(null)).toBe(NO_VALUE);
  });
});

describe('speed and counts', () => {
  it('renders whole mph, and an em dash when there is no speed', () => {
    expect(formatSpeedMph(47.4)).toBe('47');
    expect(formatSpeedMph(null)).toBe(NO_VALUE);
  });

  it('renders a real zero for a count -- no passes today is a fact, not an absence', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12)).toBe('12');
  });
});

describe('fix age', () => {
  it('renders seconds up to a minute, then minutes', () => {
    expect(formatFixAge(40_000)).toBe('40s');
    expect(formatFixAge(59_999)).toBe('59s');
    expect(formatFixAge(120_000)).toBe('2m');
    expect(formatFixAge(null)).toBeNull();
  });
});

describe('direction', () => {
  it("renders the four coarse sectors in the design's words", () => {
    expect(coarseDirection('ahead')).toBe('AHEAD');
    expect(coarseDirection('left')).toBe('LEFT');
    expect(coarseDirection('right')).toBe('RIGHT');
    expect(coarseDirection('behind')).toBe('BEHIND');
    expect(coarseDirection(null)).toBeNull();
  });

  it('refines the ahead sector into the rendered "AHEAD · SLIGHT LEFT"', () => {
    expect(fineDirection({ direction: 'ahead', bearingDeg: 10, headingDeg: 41 })).toBe(
      'AHEAD · SLIGHT LEFT',
    );
    expect(fineDirection({ direction: 'ahead', bearingDeg: 72, headingDeg: 41 })).toBe(
      'AHEAD · SLIGHT RIGHT',
    );
  });

  it('stays coarse inside the middle of the ahead sector and outside it', () => {
    expect(fineDirection({ direction: 'ahead', bearingDeg: 45, headingDeg: 41 })).toBe('AHEAD');
    expect(fineDirection({ direction: 'left', bearingDeg: 300, headingDeg: 41 })).toBe('LEFT');
  });

  it('stays coarse when there is no heading to be relative to', () => {
    expect(fineDirection({ direction: 'ahead', bearingDeg: 10, headingDeg: null })).toBe('AHEAD');
    expect(fineDirection({ direction: null, bearingDeg: 10, headingDeg: 41 })).toBeNull();
  });
});

describe('the direction line', () => {
  const base = { direction: 'ahead', bearingDeg: 41, headingDeg: 41, offline: false } as const;

  it('renders the exact string each state draws', () => {
    expect(directionLine({ ...base, state: 'in_range', isClosing: true })).toBe('AHEAD');
    expect(directionLine({ ...base, state: 'approaching', isClosing: true })).toBe(
      'AHEAD · CLOSING',
    );
    expect(directionLine({ ...base, state: 'clear', isClosing: null })).toBe(
      'CLEAR · NEAREST AHEAD',
    );
    expect(directionLine({ ...base, state: 'muted', isClosing: true })).toBe('STILL TRACKING');
    expect(directionLine({ ...base, state: 'no_gps', isClosing: null })).toBeNull();
  });

  it('renders the offline provenance line, but never over a live in-range direction', () => {
    expect(directionLine({ ...base, state: 'clear', isClosing: null, offline: true })).toBe(
      'CACHED CAMERA · AHEAD',
    );
    expect(directionLine({ ...base, state: 'in_range', isClosing: true, offline: true })).toBe(
      'AHEAD',
    );
  });

  it('keeps approaching coarse so the line reads exactly as designed', () => {
    // A refined "AHEAD · SLIGHT LEFT · CLOSING" is three clauses at the moment
    // the alert is about to fire. The design writes two.
    expect(
      directionLine({
        state: 'approaching',
        direction: 'ahead',
        bearingDeg: 10,
        headingDeg: 41,
        isClosing: true,
        offline: false,
      }),
    ).toBe('AHEAD · CLOSING');
  });

  it('drops the CLOSING clause when the engine says the camera is receding', () => {
    expect(directionLine({ ...base, state: 'approaching', isClosing: false })).toBe('AHEAD');
  });
});
