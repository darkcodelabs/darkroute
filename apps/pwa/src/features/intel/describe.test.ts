/**
 * The words the card uses when the record does not name an owner.
 *
 * The failure this pins is a real one that shipped: the chip said UNVERIFIED on
 * a node whose tags said FLOCK SAFETY, which told the driver the app was unsure
 * instead of telling them what was on the pole.
 */

import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../../services/db/schema.ts';

import { chipLabel, makerOf, mountOf, mountPhrase, readableTag } from './describe.ts';
import { coveredDirections, formatCoveredDirections, shortOperator } from './intelState.ts';

function record(tags: Record<string, string>): CameraRecord {
  return {
    id: 'node/1',
    lat: 39,
    lon: -94,
    ownerType: 'unverified',
    tags,
  } as CameraRecord;
}

describe('readableTag', () => {
  it('turns a machine value into something a person reads', () => {
    expect(readableTag('traffic_signals')).toBe('traffic signals');
    expect(readableTag('street-lamp')).toBe('street lamp');
  });

  it('has nothing to say about an absent or empty tag', () => {
    expect(readableTag(null)).toBeNull();
    expect(readableTag('   ')).toBeNull();
  });
});

describe('makerOf', () => {
  it('prefers manufacturer, the tag 91% of these nodes carry', () => {
    expect(makerOf(record({ manufacturer: 'Flock Safety', brand: 'Other' }))).toBe('FLOCK SAFETY');
  });

  it('falls back to brand', () => {
    expect(makerOf(record({ brand: 'Motorola Solutions' }))).toBe('MOTOROLA SOLUTIONS');
  });

  it('does not invent a maker from the model number', () => {
    // "FALCON LR" is a part number, not an answer to "what is that".
    expect(makerOf(record({ model: 'Falcon LR' }))).toBeNull();
  });

  it('says nothing when there is no record at all', () => {
    expect(makerOf(null)).toBeNull();
  });
});

describe('mountOf', () => {
  it('reads camera:mount first and support second', () => {
    expect(mountOf(record({ 'camera:mount': 'pole', support: 'wall' }))).toBe('POLE');
    expect(mountOf(record({ support: 'wall' }))).toBe('WALL');
  });
});

describe('mountPhrase', () => {
  it('drops the shout, because the line it joins is prose', () => {
    expect(mountPhrase(record({ 'camera:mount': 'pole' }))).toBe('on a pole');
  });

  it('does not put "a" in front of the plural OSM actually uses', () => {
    expect(mountPhrase(record({ 'camera:mount': 'traffic_signals' }))).toBe('on traffic signals');
  });

  it('is absent on the majority of records, which carry no mount', () => {
    expect(mountPhrase(record({}))).toBeNull();
    expect(mountPhrase(null)).toBeNull();
  });
});

describe('chipLabel', () => {
  it('says the owner whenever somebody has attributed it', () => {
    expect(chipLabel('police', record({ manufacturer: 'Flock Safety' }))).toBe('POLICE');
    expect(chipLabel('hoa', null)).toBe('HOA');
  });

  it('says the MAKER rather than UNVERIFIED, which describes nothing', () => {
    expect(chipLabel('unverified', record({ manufacturer: 'Flock Safety' }))).toBe('FLOCK SAFETY');
  });

  it('falls back to UNVERIFIED only when the record names no maker either', () => {
    expect(chipLabel('unverified', record({}))).toBe('UNVERIFIED');
  });

  it('shows no chip at all when there is no owner field to fall back to', () => {
    expect(chipLabel(undefined, record({}))).toBeNull();
  });
});

describe('shortOperator', () => {
  it('uses the abbreviation OSM mappers already write by hand', () => {
    // ST. CHARLES COUNTY PD (159 records) and ST. LOUIS CITY PD (122) are in
    // the archive as written. This makes the spelled-out ones agree with them
    // instead of reading as two different agencies.
    expect(shortOperator('SAN DIEGO POLICE DEPARTMENT')).toBe('SAN DIEGO PD');
    expect(shortOperator('HAMPTON POLICE DIVISION')).toBe('HAMPTON PD');
  });

  it('shortens the transportation departments before the plain ones', () => {
    // Order matters: a naive DEPARTMENT rule turns this into
    // "NYC D OF TRANSPORTATION". 560 records take this branch.
    expect(shortOperator('NYC DEPARTMENT OF TRANSPORTATION')).toBe('NYC DOT');
  });

  it('handles both apostrophes, because the archive carries both', () => {
    expect(shortOperator("JOHNSON COUNTY SHERIFF'S OFFICE")).toBe('JOHNSON COUNTY SO');
    expect(shortOperator('JOHNSON COUNTY SHERIFF\u2019S OFFICE')).toBe('JOHNSON COUNTY SO');
    expect(shortOperator("LOS ANGELES COUNTY SHERIFF'S DEPARTMENT")).toBe('LOS ANGELES COUNTY SO');
  });

  it('only replaces a TRAILING phrase, never one inside a name', () => {
    expect(shortOperator('POLICE DEPARTMENT OF SOMEWHERE')).toBe('POLICE DEPARTMENT OF SOMEWHERE');
  });

  it('leaves a name it has no rule for exactly as the mapper wrote it', () => {
    expect(shortOperator('FLOCK SAFETY')).toBe('FLOCK SAFETY');
    expect(shortOperator("LOWE'S")).toBe("LOWE'S");
    expect(shortOperator('CALIFORNIA HIGHWAY PATROL (CHP)')).toBe('CALIFORNIA HIGHWAY PATROL (CHP)');
  });

  it('has nothing to say about an absent operator', () => {
    expect(shortOperator(null)).toBeNull();
    expect(shortOperator('   ')).toBeNull();
  });
});

describe('coveredDirections', () => {
  it('keeps every approach the mapper wrote, not just the first', () => {
    const covered = coveredDirections(record({ direction: '305;175;240' }));
    expect(covered).toHaveLength(3);
    expect(formatCoveredDirections(covered)).toBe('305\u00B0 \u00B7 175\u00B0 \u00B7 240\u00B0');
  });

  it('reads an arc as an arc rather than turning it into a hole', () => {
    // `Number("338-23")` is NaN. A plain number list drops this silently, and
    // 3.37% of the archive is written this way.
    const covered = coveredDirections(record({ direction: '338-23' }));
    expect(covered).toEqual([{ kind: 'arc', fromDeg: 338, toDeg: 23 }]);
    expect(formatCoveredDirections(covered)).toBe('338\u00B0-23\u00B0');
  });

  it('reads cardinals, which OSM also allows', () => {
    expect(coveredDirections(record({ direction: 'NW;E' }))).toEqual([
      { kind: 'bearing', deg: 315 },
      { kind: 'bearing', deg: 90 },
    ]);
  });

  it('falls back to camera:direction, the camera-specific key', () => {
    expect(coveredDirections(record({ 'camera:direction': '175' }))).toEqual([
      { kind: 'bearing', deg: 175 },
    ]);
  });

  it('does not list the same approach twice', () => {
    expect(coveredDirections(record({ direction: '90;90;360' }))).toEqual([
      { kind: 'bearing', deg: 90 },
      { kind: 'bearing', deg: 0 },
    ]);
  });

  it('is empty rather than undefined when nothing was recorded', () => {
    expect(coveredDirections(record({}))).toEqual([]);
    expect(coveredDirections(null)).toEqual([]);
    expect(formatCoveredDirections([])).toBeNull();
  });
});
