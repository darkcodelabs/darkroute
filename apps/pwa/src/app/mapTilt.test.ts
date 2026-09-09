/**
 * The two angles, and the ceiling the map is built with.
 *
 * The one that matters is `maxTiltDeg`: MapCanvas passes it to `maxPitch`, so a
 * ceiling that drifts below the steepest entry in the table silently clamps the
 * tilt button to something shallower than it asked for, with nothing anywhere
 * reporting a problem.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAP_TILT,
  FWM_MAP_TILTS,
  MAP_TILT_DEG,
  MAP_TILT_LABELS,
  MAP_TILT_NOTES,
  isMapTilt,
  maxTiltDeg,
  nextMapTilt,
  resolveMapTilt,
} from './mapTilt.ts';

describe('the tilt table', () => {
  it('defaults to the pitched view a driver actually uses', () => {
    // Top-down was the default while the pitched camera was new. The shipping
    // default is the driving view; flat stays in the picker.
    expect(DEFAULT_MAP_TILT).toBe('angled');
    expect(MAP_TILT_DEG[DEFAULT_MAP_TILT]).toBeGreaterThan(0);
  });

  it('describes every angle it offers', () => {
    for (const tilt of FWM_MAP_TILTS) {
      expect(MAP_TILT_LABELS[tilt]).toBeTruthy();
      expect(MAP_TILT_NOTES[tilt]).toBeTruthy();
      expect(MAP_TILT_DEG[tilt]).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the horizon off the screen', () => {
    // Past 60 the sky enters the frame and MapLibre draws far-field tiles two
    // pixels tall - GPU cost for ground ten minutes away.
    for (const tilt of FWM_MAP_TILTS) expect(MAP_TILT_DEG[tilt]).toBeLessThanOrEqual(60);
  });
});

describe('maxTiltDeg', () => {
  it('is the steepest angle in the table, so the map can reach every one', () => {
    // MapCanvas builds with `maxPitch: maxTiltDeg()`. If this fell below any
    // entry, that entry would clamp on the way in and nothing would say so.
    expect(maxTiltDeg()).toBe(Math.max(...FWM_MAP_TILTS.map((t) => MAP_TILT_DEG[t])));
    for (const tilt of FWM_MAP_TILTS) expect(MAP_TILT_DEG[tilt]).toBeLessThanOrEqual(maxTiltDeg());
  });
});

describe('resolveMapTilt', () => {
  it('lands a stored value that is no longer a tilt on the default', () => {
    expect(resolveMapTilt('birdseye')).toBe(DEFAULT_MAP_TILT);
    expect(resolveMapTilt(undefined)).toBe(DEFAULT_MAP_TILT);
    expect(resolveMapTilt(55)).toBe(DEFAULT_MAP_TILT);
  });

  it('keeps one it recognises', () => {
    expect(resolveMapTilt('angled')).toBe('angled');
  });
});

describe('isMapTilt', () => {
  it('is false for anything not in the list', () => {
    expect(isMapTilt('flat')).toBe(true);
    expect(isMapTilt('tilted')).toBe(false);
    expect(isMapTilt(null)).toBe(false);
  });
});

describe('nextMapTilt', () => {
  it('is a round trip, so the button can always undo itself', () => {
    let tilt = DEFAULT_MAP_TILT;
    for (let i = 0; i < FWM_MAP_TILTS.length; i += 1) tilt = nextMapTilt(tilt);
    expect(tilt).toBe(DEFAULT_MAP_TILT);
  });
});
