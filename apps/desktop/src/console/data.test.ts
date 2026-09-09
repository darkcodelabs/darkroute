import { describe, expect, it } from 'vitest';

import type { AbuseRecord, Camera } from '../data/api.ts';
import {
  cameraLabel,
  compass,
  countByOwner,
  countyLabelFor,
  formatBytes,
  formatMiles,
  matchesQuery,
  metresBetween,
  misuseCsv,
  misuseRows,
  osmUrl,
  tileOf,
  viewGeoJson,
} from './data.ts';

function camera(over: Partial<Camera>): Camera {
  return {
    id: 'osm:1',
    lat: 38.94,
    lon: -94.67,
    ownerType: null,
    street: null,
    cross: null,
    directionDeg: null,
    operator: null,
    ...over,
  };
}

describe('naming a row', () => {
  it('uses the intersection, then on/off the street, then the id', () => {
    expect(cameraLabel(camera({ street: 'W 95th St', cross: 'Santa Fe Trail Dr' }))).toBe(
      'W 95th St & Santa Fe Trail Dr',
    );
    expect(cameraLabel(camera({ street: 'W 95th St', streetM: 12 }))).toBe('on W 95th St');
    expect(cameraLabel(camera({ street: 'W 95th St', streetM: 310 }))).toBe('off W 95th St');
    expect(cameraLabel(camera({}))).toBe('osm:1');
  });
  it('reads a compass point off a bearing', () => {
    expect(compass(135)).toBe('SE');
    expect(compass(359)).toBe('N');
    expect(compass(null)).toBeNull();
  });
  it('links a node or a way on OpenStreetMap', () => {
    expect(osmUrl('osm:13923421541')).toBe('https://www.openstreetmap.org/node/13923421541');
    expect(osmUrl('osm:w42')).toBe('https://www.openstreetmap.org/way/42');
  });
});

describe('counting a view', () => {
  it('counts every owner class, including the ones with nothing in view', () => {
    const counts = countByOwner([
      camera({ ownerType: 'police' }),
      camera({ id: 'osm:2', ownerType: 'police' }),
      camera({ id: 'osm:3', ownerType: null }),
    ]);
    expect(counts['police']).toBe(2);
    expect(counts['unverified']).toBe(1);
    expect(counts['hoa']).toBe(0);
  });
  it('measures distance and addresses a tile', () => {
    expect(Math.round(metresBetween({ lat: 38.94, lon: -94.67 }, { lat: 38.95, lon: -94.67 }))).toBe(1112);
    expect(formatMiles(2414)).toBe('1.5 mi');
    expect(tileOf(38.9401, -94.6678)).toEqual({ x: 485, y: 783 });
  });
  it('prints bytes the way the reference does', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(40_000)).toBe('39 KB');
    expect(formatBytes(4_400_000)).toBe('4.2 MB');
    expect(formatBytes(null)).toBe('');
  });
});

const RECORDS: readonly AbuseRecord[] = [
  { fips: '13139', agency: 'Hall County Sheriff', incidents: 3, year: 2026, sourceName: 'A', summary: '', sourceUrl: 'https://a' },
  { fips: '13139', agency: 'Hall County Sheriff', incidents: 3, year: 2026, sourceName: 'B', summary: '', sourceUrl: 'https://b' },
  { fips: '20173', agency: 'Kechi Police', incidents: 1, year: 2025, sourceName: 'C', summary: '', sourceUrl: 'https://c' },
];
const COUNTIES = [
  { fips: '13139', name: 'Hall', lsad: 'County', state: 'GA', label: 'HALL CO, GA', cameras: 10 },
];

describe('the misuse table', () => {
  it('groups by year, agency and county, newest and busiest first', () => {
    const rows = misuseRows(RECORDS, COUNTIES);
    expect(rows.map((r) => [r.year, r.agency, r.cases, r.incidents, r.county])).toEqual([
      [2026, 'Hall County Sheriff', 2, 6, 'HALL CO, GA'],
      [2025, 'Kechi Police', 1, 1, 'FIPS 20173'],
    ]);
  });
  it('writes a CSV that survives commas and quotes', () => {
    const csv = misuseCsv(misuseRows([{ ...RECORDS[2]!, agency: 'Kechi, "The" Police' }], null));
    expect(csv.split('\n')[0]).toBe('year,agency,county,fips,cases,incidents,source,source_url');
    expect(csv).toContain('"Kechi, ""The"" Police"');
  });
  it('labels a county it knows and admits one it does not', () => {
    expect(countyLabelFor('13139', COUNTIES)).toBe('HALL CO, GA');
    expect(countyLabelFor('', null)).toBe('—');
  });
});

describe('exporting a view', () => {
  it('writes a FeatureCollection with the attribution on it', () => {
    const doc = JSON.parse(viewGeoJson([camera({ street: 'Main St', ownerType: 'hoa' })])) as {
      type: string;
      licence: string;
      features: { geometry: { coordinates: number[] }; properties: { street: string } }[];
    };
    expect(doc.type).toBe('FeatureCollection');
    expect(doc.licence).toBe('ODbL-1.0');
    expect(doc.features[0]?.geometry.coordinates).toEqual([-94.67, 38.94]);
    expect(doc.features[0]?.properties.street).toBe('Main St');
  });
  it('searches street, id, town and operator in any case', () => {
    const c = camera({ street: 'Metcalf Ave', locality: 'Overland Park', operator: 'Overland Park PD' });
    expect(matchesQuery(c, 'metcalf')).toBe(true);
    expect(matchesQuery(c, 'osm:1')).toBe(true);
    expect(matchesQuery(c, 'overland')).toBe(true);
    expect(matchesQuery(c, 'lenexa')).toBe(false);
    expect(matchesQuery(c, '')).toBe(true);
  });
});
