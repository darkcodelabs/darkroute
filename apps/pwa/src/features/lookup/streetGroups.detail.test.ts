/**
 * THE ROW'S SECOND AND THIRD LINES -- everything the record knows, in order,
 * and nothing it does not.
 */

import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../../services/db/schema.ts';

import { contextLineOf, detailLineOf, installedYearOf, shortMaker } from './streetGroups.ts';

function camera(extra: Partial<CameraRecord> = {}): CameraRecord {
  return { id: 'osm:1', lat: 38.9, lon: -94.67, directionDeg: null, ...extra };
}

describe('the context line', () => {
  it('names the maker short, the mount, a zone that is not traffic, the facing and the town', () => {
    expect(
      contextLineOf(
        camera({
          directionDeg: 135,
          locality: 'Overland Park',
          tags: { manufacturer: 'Flock Safety', 'camera:mount': 'pole', 'surveillance:zone': 'parking' },
        }),
      ),
    ).toBe('Flock · pole · parking · faces SE · Overland Park');
  });

  it('leaves the traffic zone unsaid, because it is the default and says nothing', () => {
    expect(
      contextLineOf(camera({ tags: { manufacturer: 'Genetec Inc.', 'surveillance:zone': 'traffic' } })),
    ).toBe('Genetec');
  });

  it('falls all the way back to the id only when the record knows nothing else', () => {
    expect(contextLineOf(camera())).toBe('osm:1');
  });

  it('keeps a maker it has no short form for', () => {
    expect(shortMaker('Leonardo')).toBe('Leonardo');
    expect(shortMaker('Motorola Solutions')).toBe('Motorola');
  });
});

describe('the detail line', () => {
  it('says operator, the year it went up, and the id', () => {
    expect(
      detailLineOf(camera({ tags: { operator: 'Overland Park Police Department', start_date: '2023-04' } })),
    ).toBe('Overland Park Police Department · since 2023 · osm:1');
  });

  it('says the operator is not recorded rather than leaving a gap, and skips a year it cannot read', () => {
    expect(detailLineOf(camera({ tags: { start_date: 'spring 2023' } }))).toBe('operator not recorded · osm:1');
  });

  it('trusts only a leading four-digit year', () => {
    expect(installedYearOf(camera({ tags: { start_date: '2021' } }))).toBe('2021');
    expect(installedYearOf(camera({ tags: { start_date: '2021-11-03' } }))).toBe('2021');
    expect(installedYearOf(camera({ tags: { start_date: '20211' } }))).toBeNull();
    expect(installedYearOf(camera())).toBeNull();
  });
});
