/**
 * The ranking, which is the one part of v1's LOOK UP that can be wrong in a way
 * a screenshot would not show.
 */

import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../../services/db/schema.ts';

import { formatDistance, matches, placeOf, searchCameras, subtitleOf, titleOf } from './search.ts';
// The same shortener the card uses. Asserted against rather than transcribed,
// so the row and the card it opens cannot render one operator two ways.
import { shortOperator } from '../intel/intelState.ts';

function camera(over: Partial<CameraRecord> & { id: string }): CameraRecord {
  return { lat: 33.78, lon: -84.38, directionDeg: null, ...over };
}

const PEACHTREE_10TH = camera({
  id: 'fwm-1',
  street: 'PEACHTREE ST NE',
  cross: '10TH ST',
  ownerType: 'police',
  lat: 33.781,
  lon: -84.383,
});

const PEACHTREE_12TH = camera({
  id: 'fwm-2',
  street: 'PEACHTREE ST NE',
  cross: '12TH ST',
  ownerType: 'police',
  lat: 33.79,
  lon: -84.383,
});

const NO_STREET = camera({ id: 'fwm-3', lat: 34.5, lon: -84.383 });

const AT = { lat: 33.7815, lon: -84.3831 };

describe('matching', () => {
  it('needs every word, in any field, in any order', () => {
    // The design's own example. "peachtree" is the street and "10th" the cross,
    // and a driver has no way to know which the archive calls which.
    expect(matches(PEACHTREE_10TH, ['peachtree', '10th'])).toBe(true);
    expect(matches(PEACHTREE_10TH, ['10th', 'peachtree'])).toBe(true);
    expect(matches(PEACHTREE_10TH, ['peachtree', '12th'])).toBe(false);
  });

  it('matches the id, so a camera with no street is still findable', () => {
    expect(matches(NO_STREET, ['fwm-3'])).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(matches(NO_STREET, [])).toBe(true);
  });
});

describe('searching', () => {
  const cameras = [PEACHTREE_12TH, PEACHTREE_10TH, NO_STREET];

  it('returns nearest first when there is a fix', () => {
    const hits = searchCameras({ cameras, query: 'peachtree', ownerType: null, at: AT });
    expect(hits.map((hit) => hit.camera.id)).toEqual(['fwm-1', 'fwm-2']);
  });

  it('is stable, not arbitrary, when there is no fix', () => {
    const hits = searchCameras({ cameras, query: 'peachtree', ownerType: null, at: null });
    expect(hits.map((hit) => hit.camera.id)).toEqual(['fwm-1', 'fwm-2']);
    for (const hit of hits) expect(hit.metres).toBeNull();
  });

  it('filters by owner without touching the ordering', () => {
    const hits = searchCameras({ cameras, query: '', ownerType: 'police', at: AT });
    expect(hits.map((hit) => hit.camera.id)).toEqual(['fwm-1', 'fwm-2']);
  });

  it('excludes a record whose owner is unrecorded from an owner filter', () => {
    // Absent is not "unverified". A record with no owner class must not be
    // swept into one, or the filter is inventing an attribution.
    const hits = searchCameras({ cameras, query: '', ownerType: 'unverified', at: AT });
    expect(hits).toEqual([]);
  });
});

describe('formatting', () => {
  it('reads feet under a mile and miles over it', () => {
    expect(formatDistance(100)).toBe('328 ft');
    expect(formatDistance(3218.7)).toBe('2.0 mi');
  });

  it('says nothing when there is nothing to measure', () => {
    expect(formatDistance(null)).toBeNull();
  });

  it('names a place by its streets, and falls back to the id', () => {
    expect(placeOf(PEACHTREE_10TH)).toBe('PEACHTREE ST NE at 10TH ST');
    expect(placeOf(camera({ id: 'fwm-4', street: 'ONLY ST' }))).toBe('ONLY ST');
    expect(placeOf(NO_STREET)).toBe('fwm-3');
  });
});

describe('what a result row is called', () => {
  // Typed, not `as const`: the literal widths from `as const` do not satisfy
  // `CameraRecord`, and a fixture that only compiles by accident is a fixture
  // that stops compiling when the record grows a field.
  const base: CameraRecord = {
    id: 'osm:13639701701',
    lat: 38.9,
    lon: -94.6,
    confirmations: 1,
    directionDeg: null,
  };

  it('leads with the operator, because that is the name', () => {
    // The list showed the street, and three rows in a row said ACCESS RD.
    const row = { ...base, street: 'ACCESS RD', tags: { operator: 'Johnson County Park & Rec District' } };

    expect(titleOf(row)).toBe(shortOperator('Johnson County Park & Rec District'));
    // ...and the street moves underneath rather than being lost.
    expect(subtitleOf(row, 'PRIVATE / BUSINESS')).toBe('ACCESS RD');
  });

  it('falls back to the street when nobody recorded an operator', () => {
    const row = { ...base, street: 'ACCESS RD' };

    expect(titleOf(row)).toBe('ACCESS RD');
    // The street is already the title, so repeating it would waste the row.
    expect(subtitleOf(row, 'PRIVATE / BUSINESS')).toBe('PRIVATE / BUSINESS');
  });

  it('falls back to the id last, which is at least quotable in a report', () => {
    expect(titleOf(base)).toBe('osm:13639701701');
    expect(subtitleOf(base, 'PRIVATE / BUSINESS')).toBe('PRIVATE / BUSINESS');
  });

  it('keeps the owner class visible when the operator IS the title but no street exists', () => {
    // Neither line may become the id: the title is the operator and the
    // subtitle would otherwise fall through to `placeOf`, which returns the id.
    const row = { ...base, tags: { operator: 'Overland Park Police Department' } };

    expect(titleOf(row)).toBe(shortOperator('Overland Park Police Department'));
    expect(subtitleOf(row, 'POLICE / AGENCY')).toBe('POLICE / AGENCY');
  });
});
