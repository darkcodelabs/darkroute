/**
 * OSM TAGGING - that it writes what the corpus uses and invents nothing.
 *
 * These are mostly about ABSENCE. Every tag this produces lands in a public
 * database under a real person's account, and the failures that got comparable
 * apps reverted were all over-claiming: a guessed operator, a defaulted mount,
 * a placeholder pasted literally. So the tests that matter are the ones
 * asserting a tag is NOT there.
 */

import { describe, expect, it } from 'vitest';

import { changesetTags, editorUrl, nearbyExisting, newCameraTags, FLOCK_WIKIDATA } from './osmTags.ts';
import { emptyDraft } from './reportDraft.ts';
import type { ReportDraft, ReportSubject } from './reportDraft.ts';

const AT: ReportSubject = {
  cameraId: null,
  lat: 38.9183,
  lon: -94.692,
  accuracyM: 6,
  satellites: 11,
};

function draft(over: Partial<ReportDraft> = {}): ReportDraft {
  return { ...emptyDraft('new'), ...over };
}

describe('the tags the corpus actually uses', () => {
  it('writes the ALPR surveillance triple', () => {
    const tags = newCameraTags(draft(), AT);
    expect(tags['man_made']).toBe('surveillance');
    expect(tags['surveillance:type']).toBe('ALPR');
    expect(tags['surveillance']).toBe('public');
    expect(tags['surveillance:zone']).toBe('traffic');
    expect(tags['camera:type']).toBe('fixed');
  });

  it('writes `direction`, NOT `camera:direction`', () => {
    // The wiki documents camera:direction; the corpus does not use it.
    // `direction` is on 93.6% of these nodes, camera:direction on effectively
    // none. Write what the data uses.
    const tags = newCameraTags(draft({ facingDeg: 241.4, facingSource: 'compass' }), AT);
    expect(tags['direction']).toBe('241');
    expect(tags['camera:direction']).toBeUndefined();
  });

  it('normalises a bearing into 0-359 whole degrees', () => {
    expect(newCameraTags(draft({ facingDeg: -90 }), AT)['direction']).toBe('270');
    expect(newCameraTags(draft({ facingDeg: 361.6 }), AT)['direction']).toBe('2');
  });

  it('says MANUFACTURER for Flock, never operator', () => {
    // The community split these deliberately: Flock builds the camera, the
    // operator is the agency holding the footage. Conflating them is the error
    // that produced `operator=(AllentownPolice)` in real OSM data.
    const tags = newCameraTags(draft({ makeModel: 'Flock Falcon' }), AT);
    expect(tags['manufacturer']).toBe('Flock Safety');
    expect(tags['manufacturer:wikidata']).toBe(FLOCK_WIKIDATA);
    expect(tags['operator']).toBeUndefined();
  });
});

describe('it refuses to claim what the driver did not observe', () => {
  it('omits direction entirely when nothing supplied a bearing', () => {
    expect(newCameraTags(draft(), AT)['direction']).toBeUndefined();
  });

  it('omits the mount when the driver said UNSURE', () => {
    // The screen offers `unsure` because at speed a driver may genuinely not
    // know. Defaulting it to `pole` because that is the commonest answer would
    // put a guess in a public database under their name.
    expect(newCameraTags(draft({ mount: 'unsure' }), AT)['camera:mount']).toBeUndefined();
    expect(newCameraTags(draft({ mount: 'pole' }), AT)['camera:mount']).toBe('pole');
  });

  it('omits the mount for TRAILER too, because the value barely exists', () => {
    /*
     * Measured, not assumed: `camera:mount=trailer` has 38 uses worldwide,
     * against 117,721 for `pole`, and it does not appear at all among ALPR
     * nodes. Beside it sits an unconsolidated long tail - `speed trailer` 6,
     * `Trailer` 5, `pole_and_trailer` 5 - which is what a tag looks like before
     * anybody has agreed on it.
     *
     * Pointing a whole userbase at that value would not be adopting a
     * convention, it would be manufacturing one, and this app has written zero
     * OSM objects so far. The observation still lives in the report; it just
     * does not become a public claim about how the world tags things.
     */
    expect(newCameraTags(draft({ mount: 'trailer' }), AT)['camera:mount']).toBeUndefined();
  });

  it('does NOT name a manufacturer the driver did not name', () => {
    expect(newCameraTags(draft({ makeModel: '' }), AT)['manufacturer']).toBeUndefined();
    expect(newCameraTags(draft({ makeModel: 'grey box on a pole' }), AT)['manufacturer'])
      .toBeUndefined();
  });

  it('never emits an operator tag under any input', () => {
    for (const makeModel of ['Flock Falcon', 'Motorola', '', 'police camera']) {
      expect(newCameraTags(draft({ makeModel, mount: 'pole', facingDeg: 90 }), AT)['operator'])
        .toBeUndefined();
    }
  });
});

describe('changeset tags make the activity auditable', () => {
  it('carries created_by, a comment, the hashtag and the source', () => {
    const tags = changesetTags('0.1.0', 'Add ALPR camera on Metcalf Ave');
    // SPACE, matching iD, StreetComplete, Every Door and DeFlock. 83 of 100
    // sampled live changesets use this form; the slash form is legacy JOSM.
    expect(tags['created_by']).toBe('DarkRoute 0.1.0');
    expect(tags['comment']).toBe('Add ALPR camera on Metcalf Ave');
    expect(tags['hashtags']).toBe('#darkroute');
    // The driver stood next to it, which tells a reviewer the value came from
    // the ground rather than from imagery.
    expect(tags['source']).toBe('survey');
  });

  it('substitutes a real comment rather than uploading an empty one', () => {
    expect(changesetTags('0.1.0', '   ')['comment']).toBe('Add ALPR camera');
  });
});

describe('the editor link carries position and nothing else', () => {
  it('opens iD over the camera', () => {
    expect(editorUrl(38.9183, -94.692)).toBe(
      'https://www.openstreetmap.org/edit?editor=id#map=19/38.91830/-94.69200',
    );
  });

  it('refuses a non-finite position instead of linking to null island', () => {
    expect(editorUrl(Number.NaN, -94.692)).toBeNull();
    expect(editorUrl(38.9183, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('carries no tag payload at all', () => {
    // Deliberate. iD has no supported way to pre-fill arbitrary tags from a
    // URL, and the workaround -- handing the user text to paste -- is precisely
    // what got DeFlock's preset removed when people pasted the placeholders.
    const url = editorUrl(38.9183, -94.692) ?? '';
    expect(url).not.toMatch(/surveillance|manufacturer|direction|operator/i);
  });
});

describe('duplicates are surfaced before a new node can be proposed', () => {
  const here = { lat: 38.9183, lon: -94.692 };
  const M = 1.155e-5;

  it('finds an existing camera a few metres away, nearest first', () => {
    const found = nearbyExisting(here.lat, here.lon, [
      { id: 'far', lat: here.lat, lon: here.lon + 18 * M },
      { id: 'near', lat: here.lat, lon: here.lon + 4 * M },
    ]);
    expect(found.map((f) => f.record.id)).toEqual(['near', 'far']);
    expect(found[0]?.distanceM).toBeLessThan(6);
  });

  it('finds nothing when the nearest camera is well beyond the radius', () => {
    // 36% of MAPS.ME's edits were duplicates because it stopped asking this
    // question. An empty answer here is what permits creating a new node.
    expect(
      nearbyExisting(here.lat, here.lon, [{ id: 'blocks-away', lat: here.lat, lon: here.lon + 300 * M }]),
    ).toEqual([]);
  });

  it('ignores records with unusable coordinates rather than ranking NaN', () => {
    const found = nearbyExisting(here.lat, here.lon, [
      { id: 'broken', lat: Number.NaN, lon: here.lon },
      { id: 'fine', lat: here.lat, lon: here.lon + 2 * M },
    ]);
    expect(found.map((f) => f.record.id)).toEqual(['fine']);
  });

  it('refuses to answer for a position it does not have', () => {
    expect(nearbyExisting(Number.NaN, here.lon, [{ id: 'x', lat: here.lat, lon: here.lon }])).toEqual([]);
  });
});
