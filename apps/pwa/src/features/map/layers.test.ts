/**
 * THE MAP'S DATA CONTRACT - that every OSM tag survives the trip.
 *
 * The styling itself is a MapLibre style object and is verified by looking at
 * the map. What is worth pinning here is the SHAPE handed to it, because that
 * is where a tag would silently go missing -- which is exactly what the old
 * ingest did, keeping two tags out of a dozen and bucketing one of them.
 */

import { describe, expect, it } from 'vitest';

import { M_PER_FT, RING_POINTS, thresholdRing, toFeatureCollection } from './layers.ts';
import type { CameraFeatureInput } from './layers.ts';

interface Feature {
  readonly geometry: { readonly coordinates: readonly number[] };
  readonly properties: Record<string, string | number>;
}

function features(input: readonly CameraFeatureInput[]): readonly Feature[] {
  return (toFeatureCollection(input) as { features: Feature[] }).features;
}

const CAMERA: CameraFeatureInput = {
  id: 'osm:13755731802',
  lat: 32.7341779,
  lon: -96.6883565,
  ownerType: 'police',
  directionDeg: 320,
  street: 'LAKE JUNE RD',
  cross: 'HILLBURN DR',
  tags: {
    'camera:type': 'fixed',
    direction: '320',
    manufacturer: 'Flock Safety',
    'manufacturer:wikidata': 'Q108485435',
    operator: 'Dallas Police Department',
    surveillance: 'public',
    'surveillance:zone': 'traffic',
  },
};

describe('GeoJSON for the camera source', () => {
  it('puts the coordinates in lon/lat order, which is the one that bites', () => {
    const [feature] = features([CAMERA]);
    expect(feature?.geometry.coordinates).toEqual([-96.6883565, 32.7341779]);
  });

  it('carries EVERY osm tag through, prefixed', () => {
    // The whole point of the ingest change. A style expression can then filter
    // on any of them -- `['get', 'osm:manufacturer']` is "only Flock Safety" --
    // without this module knowing the tag exists.
    const [feature] = features([CAMERA]);
    expect(feature?.properties['osm:manufacturer']).toBe('Flock Safety');
    expect(feature?.properties['osm:operator']).toBe('Dallas Police Department');
    expect(feature?.properties['osm:camera:type']).toBe('fixed');
    expect(feature?.properties['osm:surveillance:zone']).toBe('traffic');
    expect(feature?.properties['osm:manufacturer:wikidata']).toBe('Q108485435');
  });

  it('keeps the operator NAME, not just the bucket it was collapsed into', () => {
    // `ownerType` is our four-way grouping and it drives the marker colour.
    // "Dallas Police Department" is the fact, and it used to be discarded.
    const [feature] = features([CAMERA]);
    expect(feature?.properties['ownerType']).toBe('police');
    expect(feature?.properties['osm:operator']).toBe('Dallas Police Department');
  });

  it('carries the derived street, which is not an OSM tag at all', () => {
    const [feature] = features([CAMERA]);
    expect(feature?.properties['street']).toBe('LAKE JUNE RD');
    expect(feature?.properties['cross']).toBe('HILLBURN DR');
  });

  it('drops a camera with no usable position rather than placing it at null island', () => {
    const bad = features([
      { id: 'a', lat: Number.NaN, lon: -96 },
      { id: 'b', lat: 32, lon: Number.POSITIVE_INFINITY },
    ]);
    expect(bad).toHaveLength(0);
  });

  it('omits absent fields instead of writing undefined into the tile', () => {
    const [feature] = features([{ id: 'bare', lat: 32, lon: -96 }]);
    expect(Object.keys(feature?.properties ?? {})).toEqual(['id']);
  });
});

/**
 * THE THRESHOLD RING - a ground distance, not a screen distance.
 *
 * The failure this guards against is silent: `circle-radius` in pixels draws a
 * ring that looks right at one zoom and claims a different distance at every
 * other one. Nothing about that is visible, so it has to be asserted.
 */
describe('thresholdRing', () => {
  const ring = (lat: number, lon: number, ft: number) =>
    thresholdRing(lat, lon, ft) as {
      features: { geometry: { coordinates: [number, number][] } }[];
    };

  const coords = (lat: number, lon: number, ft: number) =>
    ring(lat, lon, ft).features[0]?.geometry.coordinates ?? [];

  it('closes the loop, so there is no gap at due east', () => {
    const points = coords(39, -94.7, 500);
    expect(points).toHaveLength(RING_POINTS + 1);
    expect(points[0]).toEqual(points[points.length - 1]);
  });

  it('is the asked-for ground distance north of the centre', () => {
    const ft = 1_000;
    const points = coords(39, -94.7, ft);
    // A quarter of the way round is due north: the latitude offset there is the
    // radius, and it must be the radius in METRES over metres-per-degree.
    const north = points[RING_POINTS / 4];
    const dLat = (north?.[1] ?? 0) - 39;
    expect(dLat * 111_320).toBeCloseTo(ft * M_PER_FT, 1);
  });

  /**
   * THE ONE THAT WOULD SHIP AS AN ELLIPSE. Without the cos(lat) correction the
   * ring is 29% too wide at 39 degrees -- clearly wrong on screen and, worse,
   * wrong about the distance in the direction a driver is usually travelling.
   */
  it('is round on the ground rather than round in degrees', () => {
    const lat = 39;
    const points = coords(lat, -94.7, 1_000);
    const east = points[0];
    const north = points[RING_POINTS / 4];
    const dLonDeg = (east?.[0] ?? 0) + 94.7;
    const dLatDeg = (north?.[1] ?? 0) - lat;
    // Same distance on the ground, so the longitude offset must be BIGGER in
    // degrees by exactly 1/cos(lat).
    expect(dLonDeg / dLatDeg).toBeCloseTo(1 / Math.cos((lat * Math.PI) / 180), 3);
  });

  it('draws nothing without a position or without a threshold', () => {
    expect(ring(Number.NaN, -94.7, 500).features).toHaveLength(0);
    expect(ring(39, -94.7, 0).features).toHaveLength(0);
    expect(ring(39, -94.7, Number.NaN).features).toHaveLength(0);
  });

  it('survives a pole rather than emitting infinite coordinates', () => {
    const points = coords(90, 0, 500);
    for (const [lon, lat] of points) {
      expect(Number.isFinite(lon)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
    }
  });
});
