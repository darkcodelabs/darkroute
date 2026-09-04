import { describe, expect, it, vi } from 'vitest';

import { canUseGeoHandoff, geoUrl, navigateTo, prefersGeoScheme } from './navigateTo.ts';

const CAMERA = { lat: 38.95632, lon: -94.747541, label: 'osm:11716502458' };
const DERIVED_WAYPOINT = { lat: 38.97719, lon: -94.7214, label: 'around this stretch' };
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) Chrome/120';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari';

function opener() {
  const opened: string[] = [];
  return { opened, open: vi.fn((url: string) => opened.push(url)) };
}

describe('navigate here', () => {
  it('opens the OS chooser on android, not one vendor', () => {
    // geo: lets the driver's own maps app answer - Waze, OsmAnd, Google.
    // Choosing for them in a product about surveillance would be a bad look.
    const o = opener();

    expect(navigateTo(CAMERA, { opener: o, userAgent: ANDROID })).toBe('opened');
    expect(o.opened[0]).toMatch(/^geo:38\.95632,-94\.74754/);
  });

  it('fails closed on iOS for cameras and derived waypoints', () => {
    const o = opener();

    for (const target of [CAMERA, DERIVED_WAYPOINT]) {
      expect(navigateTo(target, { opener: o, userAgent: IPHONE })).toBe('unavailable');
    }

    expect(o.open).not.toHaveBeenCalled();
  });

  it('NEVER puts the driver’s own position in the url', () => {
    // The camera is the destination; the maps app supplies the origin from the
    // location permission it already holds. An origin parameter would put the
    // driver into a URL, a browser history and someone else's server log -
    // the exact thing the tile sync was built to avoid.
    for (const ua of [ANDROID, IPHONE]) {
      const o = opener();
      navigateTo(CAMERA, { opener: o, userAgent: ua });
      for (const url of o.opened) {
        expect(url).not.toMatch(/saddr|origin=|from=/);
      }
    }
  });

  it('carries no more precision than the tiles do', () => {
    // The source is five decimals. Printing more would claim a survey we did
    // not do, on a node a volunteer placed from aerial imagery.
    expect(geoUrl({ lat: 1.123456789, lon: 2.987654321 })).toContain('1.12346,2.98765');
  });

  it('escapes a label rather than pasting it into the url', () => {
    expect(geoUrl({ lat: 1, lon: 2, label: 'a b&c' })).toContain('(a%20b%26c)');
  });

  it('refuses an impossible coordinate instead of opening a map of nowhere', () => {
    const o = opener();

    expect(navigateTo({ lat: 999, lon: 0 }, { opener: o, userAgent: ANDROID })).toBe('invalid');
    expect(navigateTo({ lat: Number.NaN, lon: 0 }, { opener: o })).toBe('invalid');
    expect(o.open).not.toHaveBeenCalled();
  });

  it('says so when there is nothing to open with', () => {
    expect(navigateTo(CAMERA, { opener: null })).toBe('unavailable');
  });

  it('knows which platforms register geo:', () => {
    expect(prefersGeoScheme(ANDROID)).toBe(true);
    expect(prefersGeoScheme(IPHONE)).toBe(false);
    expect(canUseGeoHandoff(ANDROID)).toBe(true);
    expect(canUseGeoHandoff(IPHONE)).toBe(false);
  });
});
