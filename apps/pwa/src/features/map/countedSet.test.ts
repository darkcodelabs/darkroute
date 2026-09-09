/**
 * THE COUNTED SET: that it is the DOCK'S set, and that its shape is a shape.
 *
 * The layers themselves are MapLibre style objects and are verified by looking
 * at the map, which is the same split `layers.test.ts` makes. What is worth
 * pinning here is the two things that can go wrong silently: the map drawing a
 * hull around a DIFFERENT fourteen than the number on the dock, and a hull
 * that is not actually a closed convex ring.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  COUNTED_MIN,
  COUNTED_RADIUS_FT,
  convexHull,
  countedCameras,
  countedGeometry,
  sameMembership,
} from './countedSet.ts';
import type { CountedMember } from './countedSet.ts';

interface Assessed {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly distanceFt: number;
}

/** `n` readers, all inside the radius, each at its own position. */
function inside(n: number): readonly Assessed[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `osm:${String(i)}`,
    lat: 38.9 + i * 0.001,
    lon: -94.6 + (i % 3) * 0.002,
    distanceFt: 500 + i,
  }));
}

interface Geometry {
  readonly type: string;
  readonly coordinates: readonly (readonly number[])[] | readonly number[];
}
interface Feature {
  readonly geometry: Geometry;
  readonly properties: Record<string, unknown>;
}

function featuresOf(members: readonly CountedMember[]): readonly Feature[] {
  return (countedGeometry(members) as { features: Feature[] }).features;
}

describe('the set the dock is counting', () => {
  it('uses the same two miles as the dock', () => {
    /*
     * THE GUARD THE HEADER OF `countedSet.ts` PROMISES.
     *
     * The map must not IMPORT the dock -- that is the coupling the whole
     * design avoids -- so this reads the dock's source as text and compares
     * the numerals. If the constants there are renamed or moved, this fails
     * loudly, which is correct: the map's copy is then unverified and somebody
     * has to reconcile the two (or, better, move both into a store selector
     * that the dock and the map read).
     *
     * Off the working directory rather than `import.meta.url`: under jsdom the
     * module URL is an http: one and `readFileSync` refuses it. Both
     * candidates are tried because cwd is `apps/pwa` under `pnpm test:unit`
     * and the repo root when vitest is pointed at it with `--root`.
     */
    const candidates = [
      'src/features/dock/dockState.ts',
      'apps/pwa/src/features/dock/dockState.ts',
    ];
    const found = candidates
      .map((rel) => resolve(process.cwd(), rel))
      .find((path) => existsSync(path));
    expect(found).toBeDefined();
    const source = readFileSync(found as string, 'utf8');

    /* THE RADIUS MOVED FILES AND KEPT ITS NUMBER. It was `DENSE_MI` in
       `useDockState.ts`; dock v3 makes it a published property of the density
       ramp -- B2 counts cameras per 2 mi -- so it lives in `dockState.ts` and
       the ramp, the exposure card, the detour key and this hull all read one
       figure. */
    const miles = /DOCK_DENSITY_RADIUS_MI\s*=\s*(\d+(?:\.\d+)?)/.exec(source)?.[1];
    expect(
      miles,
      'the dock no longer declares DOCK_DENSITY_RADIUS_MI; reconcile the radius',
    ).toBeDefined();
    expect(COUNTED_RADIUS_FT).toBe(Number(miles) * 5280);
  });

  it('keeps its own floor, which the dock no longer shares', () => {
    /*
     * THE GATE DIVERGED, DELIBERATELY, AND THIS IS WHERE IT IS WRITTEN DOWN.
     *
     * `DENSE_COUNT` is gone. Dock v3 puts the exposure count on screen whenever
     * there is one and lets the four-tier ramp -- 0 clear, 1-5 low, 6-12
     * moderate, 13+ high -- carry the escalation, because a card that cannot
     * exist below ten leaves the bottom half of that ramp unreachable.
     *
     * The MAP's floor is a different question and its own answer still holds: a
     * hull drawn around three readers would be drawn almost everywhere, and
     * "nothing is counted" being the common case is what makes the empty path
     * free. So ten stays here, and it is no longer the dock's number.
     *
     * What both surfaces still share is the RADIUS, pinned above. If somebody
     * wants the hull to follow the card again, that is a decision about the
     * map, not a reconciliation of a stale constant.
     */
    expect(COUNTED_MIN).toBe(10);
  });

  it('counts nothing at all until the dock would put a number on screen', () => {
    // Below the gate there is no list to point at, so pointing at one would be
    // the map indicating a set the driver was never told about.
    expect(countedCameras(inside(COUNTED_MIN - 1))).toHaveLength(0);
    expect(countedCameras(inside(COUNTED_MIN))).toHaveLength(COUNTED_MIN);
  });

  it('drops the readers outside the radius rather than the far half of the list', () => {
    const near = inside(COUNTED_MIN);
    const far = [{ id: 'far', lat: 39.5, lon: -94.6, distanceFt: COUNTED_RADIUS_FT + 1 }];
    const members = countedCameras([...near, ...far]);
    expect(members.map((m) => m.id)).not.toContain('far');
    expect(members).toHaveLength(COUNTED_MIN);
  });

  it('counts a reader exactly on the two-mile line, the way the dock does', () => {
    const members = countedCameras([
      ...inside(COUNTED_MIN),
      { id: 'edge', lat: 39, lon: -94.6, distanceFt: COUNTED_RADIUS_FT },
    ]);
    expect(members.map((m) => m.id)).toContain('edge');
  });

  it('does not assume the assessments arrive nearest-first', () => {
    // A prefix scan would be cheaper and would silently disagree with the
    // dock's filter the day anything reorders them.
    const shuffled = [
      { id: 'far', lat: 39.5, lon: -94.6, distanceFt: COUNTED_RADIUS_FT + 10 },
      ...inside(COUNTED_MIN),
    ];
    expect(countedCameras(shuffled)).toHaveLength(COUNTED_MIN);
  });

  it('returns the same empty array every time nothing is counted', () => {
    // The empty case runs once a second forever; it must not allocate.
    expect(countedCameras(inside(1))).toBe(countedCameras([]));
  });
});

describe('deciding whether to redraw', () => {
  it('says nothing changed while the same readers are counted', () => {
    const members = inside(COUNTED_MIN);
    const ids = new Set(members.map((m) => m.id));
    expect(sameMembership(members, ids)).toBe(true);
  });

  it('notices a swap that leaves the count identical', () => {
    // The failure a count comparison would miss: one reader in, one out, same
    // fourteen on the dock and a different shape on the ground.
    const members = inside(COUNTED_MIN);
    const ids = new Set(members.map((m) => m.id));
    ids.delete('osm:0');
    ids.add('osm:99');
    expect(sameMembership(members, ids)).toBe(false);
  });

  it('notices an empty set arriving after a counted one', () => {
    expect(sameMembership([], new Set(['osm:0']))).toBe(false);
  });
});

describe('the hull', () => {
  it('is a closed ring, so it draws as a loop and not an arc', () => {
    const square: readonly (readonly [number, number])[] = [
      [-94.6, 38.9],
      [-94.5, 38.9],
      [-94.5, 39.0],
      [-94.6, 39.0],
    ];
    const [hull] = featuresOf(
      square.map(([lon, lat], i) => ({ id: String(i), lat, lon })),
    );
    expect(hull?.geometry.type).toBe('LineString');
    const ring = hull?.geometry.coordinates as readonly (readonly number[])[];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('keeps only the outline, not the readers inside it', () => {
    const box: readonly (readonly [number, number])[] = [
      [-94.6, 38.9],
      [-94.5, 38.9],
      [-94.5, 39.0],
      [-94.6, 39.0],
      // In the middle. A hull that kept this would not be convex.
      [-94.55, 38.95],
    ];
    const hull = convexHull(box);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([-94.55, 38.95]);
  });

  it('is nothing at all when the readers are in a line', () => {
    // A corridor of cameras along one road is the common dense case, and a
    // zero-area sliver drawn round it is a rendering artefact, not a shape.
    expect(
      convexHull([
        [-94.6, 38.9],
        [-94.5, 38.9],
        [-94.4, 38.9],
      ]),
    ).toEqual([]);
  });

  it('is nothing at all for two readers, or for one repeated', () => {
    expect(convexHull([[-94.6, 38.9], [-94.5, 38.9]])).toEqual([]);
    expect(convexHull([[-94.6, 38.9], [-94.6, 38.9], [-94.6, 38.9]])).toEqual([]);
  });
});

describe('the geometry handed to MapLibre', () => {
  it('gives every member a point, whether or not there is a hull', () => {
    const line: readonly CountedMember[] = [
      { id: 'a', lat: 38.9, lon: -94.6 },
      { id: 'b', lat: 38.9, lon: -94.5 },
    ];
    const features = featuresOf(line);
    // Collinear, so no hull -- but both readers still get their ring.
    expect(features).toHaveLength(2);
    expect(features.every((f) => f.geometry.type === 'Point')).toBe(true);
  });

  it('puts the coordinates in lon/lat order, which is the one that bites', () => {
    const [feature] = featuresOf([{ id: 'a', lat: 38.9, lon: -94.6 }]);
    expect(feature?.geometry.coordinates).toEqual([-94.6, 38.9]);
  });

  it('drops a reader with no usable position rather than poisoning the hull', () => {
    // One NaN in the sort takes the whole shape out, so it goes before it.
    const features = featuresOf([
      { id: 'a', lat: 38.9, lon: -94.6 },
      { id: 'bad', lat: Number.NaN, lon: -94.5 },
      { id: 'c', lat: 39.0, lon: -94.5 },
      { id: 'd', lat: 39.0, lon: -94.7 },
    ]);
    expect(features.filter((f) => f.geometry.type === 'Point')).toHaveLength(3);
    expect(features.filter((f) => f.geometry.type === 'LineString')).toHaveLength(1);
  });

  it('carries the id, so a ring can be traced back to a record', () => {
    const [feature] = featuresOf([{ id: 'osm:13755731802', lat: 38.9, lon: -94.6 }]);
    expect(feature?.properties['id']).toBe('osm:13755731802');
  });
});
