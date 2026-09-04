/**
 * The six-state decision table, enumerated.
 *
 * Reference: `Flockys App Screens.dc.html` (screen 01 + the RADAR state matrix)
 * and `Flockys Screens II.dc.html` (A2 · OFFLINE).
 */

import { describe, expect, it } from 'vitest';

import type { AlertState, GpsStatus, PermissionStatus } from '../../stores';

import {
  hasLiveDistance,
  radarHue,
  radarRing,
  resolveRadarGate,
  resolveRadarState,
} from './radarState.ts';
import type { RadarInput, RadarState } from './radarState.ts';

const ALL_GPS: readonly GpsStatus[] = [
  'unknown',
  'unavailable',
  'denied',
  'searching',
  'lock',
  'stale',
];

const ALL_ALERT: readonly AlertState[] = ['clear', 'approaching', 'in_range', 'multiple'];

function input(over: Partial<RadarInput> = {}): RadarInput {
  return {
    alertState: 'clear',
    gps: 'lock',
    locationPermission: 'granted',
    muted: false,
    mutePierced: false,
    ...over,
  };
}

describe('resolveRadarGate', () => {
  it('is live once a fix has been seen', () => {
    expect(resolveRadarGate(input({ gps: 'lock' }))).toBe('live');
    // A stale fix is still a fix: the screen degrades to no_gps but the gate
    // stays live, because there is nothing to wait for and nobody to ask.
    expect(resolveRadarGate(input({ gps: 'stale' }))).toBe('live');
  });

  it('is loading only while nothing has arrived and nothing has been refused', () => {
    expect(resolveRadarGate(input({ gps: 'unknown' }))).toBe('loading');
    expect(resolveRadarGate(input({ gps: 'searching' }))).toBe('loading');
  });

  it('is denied when the driver refused, or when the platform has no geolocation', () => {
    expect(resolveRadarGate(input({ gps: 'denied' }))).toBe('denied');
    expect(resolveRadarGate(input({ gps: 'unavailable' }))).toBe('denied');
    expect(resolveRadarGate(input({ gps: 'searching', locationPermission: 'denied' }))).toBe(
      'denied',
    );
  });

  it('lets a refusal outrank a pending watch, whatever the gps slice still says', () => {
    for (const gps of ALL_GPS) {
      const permission: PermissionStatus = 'denied';
      expect(resolveRadarGate(input({ gps, locationPermission: permission }))).toBe('denied');
    }
  });
});

describe('resolveRadarState', () => {
  it('passes the engine verdict straight through when there is a lock', () => {
    for (const alertState of ALL_ALERT) {
      expect(resolveRadarState(input({ alertState }))).toBe(alertState);
    }
  });

  it('shows no_gps for every status that is not a live lock', () => {
    for (const gps of ALL_GPS) {
      const expected: RadarState = gps === 'lock' ? 'in_range' : 'no_gps';
      expect(resolveRadarState(input({ gps, alertState: 'in_range' }))).toBe(expected);
    }
  });

  it('shows muted instead of the alert state while a mute is live', () => {
    for (const alertState of ALL_ALERT) {
      expect(resolveRadarState(input({ alertState, muted: true }))).toBe('muted');
    }
  });

  it('gives the alert hue back when the mute is pierced', () => {
    // "RE-ALERT ON MUTED IF closer than 150 ft" -- the alert slice decides this
    // and publishes `mutePierced`; RADAR only obeys it.
    expect(
      resolveRadarState(input({ alertState: 'in_range', muted: true, mutePierced: true })),
    ).toBe('in_range');
  });

  it('puts no_gps above muted -- there is no distance to desaturate', () => {
    expect(resolveRadarState(input({ gps: 'stale', muted: true }))).toBe('no_gps');
  });
});

describe('hue', () => {
  it('gives each alert state its own hue and gives the two grey states none of them', () => {
    expect(radarHue('clear')).toBe('clear');
    expect(radarHue('approaching')).toBe('approaching');
    expect(radarHue('in_range')).toBe('in-range');
    expect(radarHue('multiple')).toBe('multiple');
    expect(radarHue('muted')).toBe('muted');
    // A coloured ring on RADAR always means a camera, so no_gps has no hue.
    expect(radarHue('no_gps')).toBeNull();
  });

  it('never reuses an alert hue for a non-alert state', () => {
    const alertHues = new Set([
      radarHue('clear'),
      radarHue('approaching'),
      radarHue('in_range'),
      radarHue('multiple'),
    ]);
    expect(alertHues.has(radarHue('muted'))).toBe(false);
    expect(alertHues.has(radarHue('no_gps'))).toBe(false);
  });
});

describe('scope treatment', () => {
  it('matches the treatment the design draws for each state', () => {
    expect(radarRing('clear')).toBe('solid');
    expect(radarRing('approaching')).toBe('pulse');
    expect(radarRing('in_range')).toBe('pulse-fast');
    expect(radarRing('multiple')).toBe('pulse-fast');
    expect(radarRing('no_gps')).toBe('dashed');
    expect(radarRing('muted')).toBe('flat');
  });

  it('breathes fast only for the two states that mean "inside the threshold"', () => {
    // v1 expanded a second ring out of the first (`fwmRing 1.1s`).
    // `Flockys App Screens v2.dc.html` declares that keyframe and uses it
    // nowhere: the alert states now breathe the scope's rim at 1.15s, which is
    // still the fastest thing on the screen and still only these two states.
    const fast = (
      ['clear', 'approaching', 'in_range', 'multiple', 'no_gps', 'muted'] as const
    ).filter((state) => radarRing(state) === 'pulse-fast');
    expect(fast).toEqual(['in_range', 'multiple']);
  });

  it('no longer reports a treatment nothing draws', () => {
    const treatments = (
      ['clear', 'approaching', 'in_range', 'multiple', 'no_gps', 'muted'] as const
    ).map((state) => radarRing(state));
    expect(treatments).not.toContain('expand');
  });
});

describe('hasLiveDistance', () => {
  it('keeps the distance live in every state except no_gps -- muted included', () => {
    expect(hasLiveDistance('muted')).toBe(true);
    expect(hasLiveDistance('clear')).toBe(true);
    expect(hasLiveDistance('approaching')).toBe(true);
    expect(hasLiveDistance('in_range')).toBe(true);
    expect(hasLiveDistance('multiple')).toBe(true);
    expect(hasLiveDistance('no_gps')).toBe(false);
  });
});
