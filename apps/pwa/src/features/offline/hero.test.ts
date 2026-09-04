/**
 * The hero, in the states A2 does not draw.
 *
 * Every test here is about the ungated composition being WRONG: a bare em dash
 * with no explanation, or A2's `CACHED CAMERA` printed over an empty cache.
 */

import { describe, expect, it } from 'vitest';

import { PRIVACY_NOTE, resolveOfflineHero } from './hero.ts';
import type { OfflineHeroInput } from './hero.ts';

/** The device A2 draws: a fix, a filled cache, a camera 610 ft ahead, no network. */
function a2(over: Partial<OfflineHeroInput> = {}): OfflineHeroInput {
  return {
    state: 'clear',
    gate: 'live',
    geolocationUnavailable: false,
    lastFixAgeMs: 0,
    distanceFt: 610,
    direction: 'ahead',
    bearingDeg: 41,
    headingDeg: 41,
    isClosing: true,
    offline: true,
    cachedCameras: 4182,
    storage: 'available',
    ...over,
  };
}

describe('the hero A2 draws', () => {
  it('is the readout, with the provenance line the design renders', () => {
    expect(resolveOfflineHero(a2())).toEqual({
      kind: 'readout',
      distanceFt: 610,
      directionLine: 'CACHED CAMERA · AHEAD',
    });
  });

  it('keeps the readout for a muted camera, because muting removes the alert only', () => {
    const hero = resolveOfflineHero(a2({ state: 'muted' }));

    expect(hero.kind).toBe('readout');
    if (hero.kind !== 'readout') return;
    expect(hero.distanceFt).toBe(610);
    expect(hero.directionLine).toBe('STILL TRACKING');
  });
});

describe('no fix', () => {
  it('explains itself in words rather than drawing a bare em dash', () => {
    // `directionLine()` returns null for `no_gps`, so an ungated hero would
    // render ` - ` beside `FT` with nothing under it and no reason given.
    const hero = resolveOfflineHero(a2({ state: 'no_gps', gate: 'live', lastFixAgeMs: 40_000 }));

    expect(hero.kind).toBe('message');
    if (hero.kind !== 'message') return;
    expect(hero.lead).toBe('last fix 40s ago.');
    expect(hero.note).toBe('showing cached cameras only.');
  });

  it('says the permission is off, with the privacy sentence, when it is refused', () => {
    const hero = resolveOfflineHero(a2({ state: 'no_gps', gate: 'denied' }));

    expect(hero.kind).toBe('message');
    if (hero.kind !== 'message') return;
    expect(hero.lead).toBe('location is off.');
    expect(hero.note).toBe(PRIVACY_NOTE);
  });

  it('distinguishes a device with no location service from a refusal', () => {
    const hero = resolveOfflineHero(
      a2({ state: 'no_gps', gate: 'denied', geolocationUnavailable: true }),
    );

    expect(hero.kind).toBe('message');
    if (hero.kind !== 'message') return;
    expect(hero.lead).toBe('this device has no location service.');
  });

  it('waits rather than blaming anything while the first fix is still coming', () => {
    const hero = resolveOfflineHero(a2({ state: 'no_gps', gate: 'loading', lastFixAgeMs: null }));

    expect(hero.kind).toBe('message');
    if (hero.kind !== 'message') return;
    expect(hero.lead).toBe('waiting for the first fix.');
    expect(hero.note).toBeNull();
  });

  it('says so plainly when there has never been a fix to age', () => {
    const hero = resolveOfflineHero(a2({ state: 'no_gps', gate: 'live', lastFixAgeMs: null }));

    expect(hero.kind).toBe('message');
    if (hero.kind !== 'message') return;
    expect(hero.lead).toBe('no fix.');
  });
});

describe('a fix, and no camera to measure', () => {
  it('never prints CACHED CAMERA when there is no cached camera', () => {
    // The bug this guards: `directionLine` takes the offline branch with no
    // coarse direction and returns the bare string `CACHED CAMERA`, which the
    // ungated hero drew over `CACHED CAMS 0`.
    const hero = resolveOfflineHero(a2({ distanceFt: null, direction: null, cachedCameras: 0 }));

    expect(hero.kind).toBe('message');
    if (hero.kind !== 'message') return;
    expect(hero.lead).toBe('nothing is cached on this device.');
    expect(JSON.stringify(hero)).not.toContain('CACHED CAMERA');
  });

  it('says the engine found none, not that the cache is empty, when it is not', () => {
    const hero = resolveOfflineHero(
      a2({ distanceFt: null, direction: null, cachedCameras: 4182 }),
    );

    expect(hero.kind).toBe('message');
    if (hero.kind !== 'message') return;
    expect(hero.lead).toBe('no cached camera nearby.');
  });

  it('treats a device with no storage as a device with nothing cached', () => {
    const hero = resolveOfflineHero(
      a2({ distanceFt: null, direction: null, cachedCameras: null, storage: 'unavailable' }),
    );

    expect(hero.kind).toBe('message');
    if (hero.kind !== 'message') return;
    expect(hero.lead).toBe('nothing is cached on this device.');
  });

  it('refuses a distance that is not a number', () => {
    const hero = resolveOfflineHero(a2({ distanceFt: Number.NaN }));

    expect(hero.kind).toBe('message');
  });
});
