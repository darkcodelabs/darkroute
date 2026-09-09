/**
 * STREET LOOKUP - that it refuses more often than it guesses.
 *
 * The value of this function is not the name it returns; it is the name it
 * declines to return. A wrong street on a surveillance record reads as a fact
 * about where a camera is watching, and the card degrades gracefully to what it
 * printed before. So most of these are about the refusals.
 */

import { describe, expect, it } from 'vitest';

import { AMBIGUITY_RATIO, MAX_SNAP_M, streetAt } from './streetAt.ts';

/** A north-south line at a given longitude, spanning the test latitudes. */
function road(name: string, lon: number) {
  return {
    properties: { name },
    geometry: { type: 'LineString', coordinates: [[lon, 38.9], [lon, 38.95]] },
  };
}

function mapWith(features: unknown[]) {
  return { querySourceFeatures: () => features as never };
}

/** A degree of longitude at 38.92 N is ~86.6 km, so 1 m is ~1.155e-5 deg. */
const M = 1.155e-5;

describe('streetAt names the road when it is unambiguous', () => {
  it('returns the nearest named road', () => {
    const map = mapWith([road('Metcalf Ave', -94.692)]);
    const found = streetAt(map, -94.692 + 5 * M, 38.92);
    expect(found?.name).toBe('Metcalf Ave');
    expect(found?.distanceM).toBeLessThan(10);
  });

  it('takes the minimum across features split at tile boundaries', () => {
    // One road arrives as several partial features; they share a name and the
    // answer is the closest point across all of them.
    const map = mapWith([
      { properties: { name: 'Shawnee Mission Pkwy' },
        geometry: { type: 'LineString', coordinates: [[-94.70, 38.92], [-94.699, 38.92]] } },
      { properties: { name: 'Shawnee Mission Pkwy' },
        geometry: { type: 'LineString', coordinates: [[-94.6921, 38.92], [-94.6920, 38.92]] } },
    ]);
    expect(streetAt(map, -94.692, 38.92)?.name).toBe('Shawnee Mission Pkwy');
  });

  it('reads MultiLineString geometry as well as LineString', () => {
    const map = mapWith([
      { properties: { name: 'Antioch Rd' },
        geometry: { type: 'MultiLineString', coordinates: [[[-94.692, 38.9], [-94.692, 38.95]]] } },
    ]);
    expect(streetAt(map, -94.692 + 3 * M, 38.92)?.name).toBe('Antioch Rd');
  });
});

describe('streetAt refuses rather than guesses', () => {
  it('refuses when the nearest road is beyond the snap radius', () => {
    const map = mapWith([road('Far Away Rd', -94.692)]);
    const found = streetAt(map, -94.692 + (MAX_SNAP_M + 20) * M, 38.92);
    expect(found).toBeNull();
  });

  it('REFUSES THE FRONTAGE-ROAD CASE: two roads at similar distance', () => {
    // The failure this exists to prevent. A frontage road runs parallel to a
    // freeway with a different name and a different speed limit; picking the
    // marginally closer centreline is a coin flip presented as a fact.
    // Placed genuinely between them -- roughly 13 m from each. A first draft of
    // this test put the point at 8.7 m from one and 17.3 m from the other,
    // which is a clear 2x win and SHOULD be answered; it was the test that was
    // wrong, not the rule.
    const map = mapWith([road('I-435', -94.692), road('Frontage Rd', -94.6917)]);
    const found = streetAt(map, -94.69185, 38.92);
    expect(found).toBeNull();
  });

  it('still answers when one road is clearly closer than the other', () => {
    const map = mapWith([road('Metcalf Ave', -94.692), road('Somewhere Else', -94.66)]);
    expect(streetAt(map, -94.692 + 2 * M, 38.92)?.name).toBe('Metcalf Ave');
  });

  it('ignores unnamed roads rather than reporting an empty name', () => {
    const map = mapWith([
      { properties: { name: '' },
        geometry: { type: 'LineString', coordinates: [[-94.692, 38.9], [-94.692, 38.95]] } },
      { properties: {}, geometry: { type: 'LineString', coordinates: [[-94.692, 38.9], [-94.692, 38.95]] } },
    ]);
    expect(streetAt(map, -94.692, 38.92)).toBeNull();
  });

  it('returns null when the source is not there, rather than throwing', () => {
    const hostile = {
      querySourceFeatures: () => {
        throw new Error('no such source');
      },
    };
    expect(streetAt(hostile, -94.692, 38.92)).toBeNull();
  });

  it('refuses a non-finite position instead of computing NaN distances', () => {
    const map = mapWith([road('Metcalf Ave', -94.692)]);
    expect(streetAt(map, Number.NaN, 38.92)).toBeNull();
    expect(streetAt(map, -94.692, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('has an ambiguity ratio that actually discriminates', () => {
    // Guards the constant itself: at 1 it would refuse everything, at 0 it
    // would never refuse, and either way the tests above would still pass.
    expect(AMBIGUITY_RATIO).toBeGreaterThan(0);
    expect(AMBIGUITY_RATIO).toBeLessThan(1);
  });
});
