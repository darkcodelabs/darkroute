/**
 * THE DRAWING FILTER, ON ITS OWN.
 *
 * Three properties, and each one is here because getting it wrong has a cost
 * on the road or on the frame budget:
 *
 *   the null case returns the SAME ARRAY, because MapCanvas keys its data
 *   effect on the prop by identity and the null case is the default;
 *
 *   a non-null filter excludes the other classes, which is the feature;
 *
 *   a record with no recorded owner is excluded by every named filter and
 *   included by null, because absence of an assertion is not the assertion
 *   `unverified` and this module does not turn one into the other.
 *
 * What is NOT tested here is what the filter must not reach. That is
 * `ownerFilter.engine.test.ts` and `ownerFilter.wiring.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { visibleCameras } from './ownerFilter.ts';

/**
 * The shape the map actually consumes, narrowed to the two fields this module
 * reads. Annotated rather than inferred: the last row has no `ownerType` at
 * all, and an inferred tuple would give it a type with no property in common
 * with the others, which is the case the function is generic over.
 */
interface FixtureCamera {
  readonly id: string;
  readonly ownerType?: string;
}

const CAMERAS: readonly FixtureCamera[] = [
  { id: 'a', ownerType: 'police' },
  { id: 'b', ownerType: 'hoa' },
  { id: 'c', ownerType: 'inter_agency' },
  { id: 'd', ownerType: 'private' },
  { id: 'e', ownerType: 'unverified' },
  // The commonest record in the archive: an OSM node with no `operator` tag.
  { id: 'f' },
];

describe('visibleCameras', () => {
  it('hands back the very same array when nothing is filtered', () => {
    // Reference equality, not deep equality. A fresh array here would push the
    // whole archive through setData on every render of the default case.
    expect(visibleCameras(CAMERAS, null)).toBe(CAMERAS);
  });

  it('draws only the chosen class', () => {
    expect(visibleCameras(CAMERAS, 'police').map((c) => c.id)).toEqual(['a']);
    expect(visibleCameras(CAMERAS, 'hoa').map((c) => c.id)).toEqual(['b']);
    expect(visibleCameras(CAMERAS, 'inter_agency').map((c) => c.id)).toEqual(['c']);
    expect(visibleCameras(CAMERAS, 'private').map((c) => c.id)).toEqual(['d']);
  });

  it('keeps an unrecorded owner out of every named class', () => {
    // `f` has no ownerType at all. It is not silently folded into
    // `unverified`, which is a class somebody asserted.
    expect(visibleCameras(CAMERAS, 'unverified').map((c) => c.id)).toEqual(['e']);
    for (const owner of ['police', 'hoa', 'inter_agency', 'private', 'unverified'] as const) {
      expect(visibleCameras(CAMERAS, owner).map((c) => c.id)).not.toContain('f');
    }
  });

  it('includes the unrecorded owner under "all owners"', () => {
    // The reason the filter is one nullable value rather than five booleans:
    // this record has to be reachable, and no flag describes it.
    expect(visibleCameras(CAMERAS, null).map((c) => c.id)).toContain('f');
  });

  it('leaves the input untouched', () => {
    const before = CAMERAS.map((c) => c.id);
    visibleCameras(CAMERAS, 'police');
    expect(CAMERAS.map((c) => c.id)).toEqual(before);
  });

  it('returns an empty list rather than everything when no camera matches', () => {
    // The failure mode worth naming: a "no matches means show all" fallback
    // would make an empty result indistinguishable from no filter, and the
    // driver would read a full map as a filtered one.
    expect(visibleCameras([{ id: 'a', ownerType: 'police' }], 'hoa')).toEqual([]);
  });
});
