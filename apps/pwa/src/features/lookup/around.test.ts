/**
 * AROUND YOU -- the card is a reading of the same hits the rows draw, and
 * every absence on it is a deliberate one.
 */

import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../../services/db/schema.ts';

import {
  ATLAS_NONE,
  aroundSummary,
  atlasLineOf,
  makerLineOf,
  makerShares,
  shortAgency,
} from './around.ts';
import type { SearchHit } from './search.ts';

function camera(id: string, extra: Partial<CameraRecord> = {}): CameraRecord {
  return { id, lat: 38.9, lon: -94.67, directionDeg: null, ...extra };
}

function hit(record: CameraRecord, metres: number | null, bearing: string | null = null): SearchHit {
  return { camera: record, metres, bearing };
}

const OVERLAND_PARK = {
  locality: 'Overland Park',
  countyFips: '20091',
  tags: { manufacturer: 'Flock Safety' },
};

const COUNTY = (fips: string | undefined): string | null => (fips === '20091' ? 'JOHNSON CO, KS' : null);

describe('the card', () => {
  it('draws nothing over an empty list', () => {
    expect(aroundSummary({ hits: [], hasFix: true, countyLabel: COUNTY, atlas: null })).toBeNull();
  });

  it('reads the town and the county off the nearest hit, not the list', () => {
    const summary = aroundSummary({
      hits: [
        hit(camera('osm:1', OVERLAND_PARK), 2400, 'NE'),
        hit(camera('osm:2', { locality: 'Leawood', countyFips: '20091' }), 5000, 'E'),
      ],
      hasFix: true,
      countyLabel: COUNTY,
      atlas: null,
    });
    expect(summary?.place).toBe('Overland Park');
    expect(summary?.county).toBe('JOHNSON CO, KS');
    expect(summary?.nearest).toBe('1.5 mi NE');
    expect(summary?.withinTwoMiles).toBe(1);
  });

  it('claims no distance and no radius count without a fix', () => {
    const summary = aroundSummary({
      hits: [hit(camera('osm:1', OVERLAND_PARK), null)],
      hasFix: false,
      countyLabel: COUNTY,
      atlas: null,
    });
    expect(summary?.nearest).toBeNull();
    expect(summary?.withinTwoMiles).toBeNull();
    expect(summary?.place).toBe('Overland Park');
  });

  it('asks the atlas about the nearest camera county and prints its answer', () => {
    const summary = aroundSummary({
      hits: [hit(camera('osm:1', OVERLAND_PARK), 100)],
      hasFix: true,
      countyLabel: COUNTY,
      atlas: (fips) => ({
        coverage: fips === '20091' ? 'recorded' : 'unknown',
        county: {
          fips: '20091',
          deployments: 9,
          agencies: [
            'Lenexa Police Department',
            'Olathe Police Department',
            'Overland Park Police Department',
            'Shawnee Police Department',
          ],
          vendors: ['Flock Safety'],
          vendorKnown: 8,
        },
      }),
    });
    expect(summary?.atlasLine).toBe(
      'EFF Atlas: 4 agencies on record running ALPR in this county: Lenexa PD, Olathe PD, Overland Park PD +1',
    );
  });
});

describe('the maker line', () => {
  it('counts makers most common first, shortened, at most three', () => {
    const hits = [
      hit(camera('a', { tags: { manufacturer: 'Genetec Inc.' } }), 1),
      hit(camera('b', { tags: { manufacturer: 'Flock Safety' } }), 1),
      hit(camera('c', { tags: { manufacturer: 'Flock Safety' } }), 1),
      hit(camera('d', { tags: { manufacturer: 'Axon Enterprise' } }), 1),
      hit(camera('e', { tags: { manufacturer: 'Leonardo' } }), 1),
      hit(camera('f'), 1),
    ];
    expect(makerShares(hits)).toEqual([
      { name: 'Flock', count: 2 },
      { name: 'Axon', count: 1 },
      { name: 'Genetec', count: 1 },
    ]);
    expect(makerLineOf(makerShares(hits))).toBe('Flock 2 · Axon 1 · Genetec 1');
    expect(makerLineOf([])).toBeNull();
  });
});

describe('the atlas sentence', () => {
  it('says nothing while nothing is known, and says not-a-census when the atlas has no row', () => {
    expect(atlasLineOf({ coverage: 'unknown', county: null })).toBeNull();
    expect(atlasLineOf({ coverage: 'none', county: null })).toBe(ATLAS_NONE);
  });

  it('counts agencies, never deployments, and singularises one', () => {
    expect(
      atlasLineOf({
        coverage: 'recorded',
        county: {
          fips: '10001',
          deployments: 3,
          agencies: ['Smyrna Police Department'],
          vendors: [],
          vendorKnown: 0,
        },
      }),
    ).toBe('EFF Atlas: 1 agency on record running ALPR in this county: Smyrna PD');
  });

  it('abbreviates the way an officer writes it', () => {
    expect(shortAgency('Johnson County Sheriff’s Office')).toBe('Johnson County Sheriff');
    expect(shortAgency("Harris County Sheriff's Office")).toBe('Harris County Sheriff');
    expect(shortAgency('Texas Department of Public Safety')).toBe('Texas DPS');
    expect(shortAgency('Kansas City Police Department')).toBe('Kansas City PD');
  });
});
