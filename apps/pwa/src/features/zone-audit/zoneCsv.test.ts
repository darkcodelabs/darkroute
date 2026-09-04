/**
 * EXPORT CSV, against the rules that decide what may be in it.
 *
 * The privacy invariants are asserted here rather than documented: the fixture
 * is a populated zone with real offsets and a real read history, and the whole
 * exported text is searched for the things that must never be in it.
 */

import { describe, expect, it } from 'vitest';

import {
  ZONE_CSV_COLUMNS,
  ZONE_CSV_SCHEMA,
  buildZoneCsv,
  csvField,
  facingField,
  sortForExport,
  zoneCsvFilename,
  zoneCsvRow,
} from './zoneCsv.ts';
import { camerasInZone } from './zone.ts';
import type { ZoneCamera } from './zone.ts';
import type { CameraRecord } from '../../stores';

const CENTRE = { lat: 39.1, lon: -84.58 };

/**
 * Ids and distances DISAGREE on purpose.
 *
 * Nearest first is `FWM-0873` (0.5 mi S), `FWM-0442` (1 mi N), `FWM-0118`
 * (1 mi E). By id it is `FWM-0118`, `FWM-0442`, `FWM-0873`. A file written in
 * the first order is a distance ranking from the driver's fix; a file written
 * in the second is a list of public infrastructure ids.
 */
const CACHE: readonly CameraRecord[] = [
  {
    id: 'FWM-0442',
    lat: 39.11448,
    lon: -84.58,
    directionDeg: 180,
    ownerType: 'police',
    confirmations: 4,
  },
  {
    id: 'FWM-0118',
    lat: 39.1,
    lon: -84.56136,
    directionDeg: null,
    ownerType: 'inter_agency',
  },
  {
    id: 'FWM-0873',
    lat: 39.09276,
    lon: -84.58,
    directionDeg: null,
    ownerType: 'hoa',
  },
];

const ZONE: readonly ZoneCamera[] = camerasInZone(CACHE, CENTRE, 2, new Map([['FWM-0442', 3]]));

/** The data rows' first field, unquoted, in the order the file writes them. */
function exportedIds(text: string): readonly string[] {
  return text
    .split('\r\n')
    .slice(1)
    .filter((line) => line !== '')
    .map((line) => line.split(',')[0]?.replaceAll('"', '') ?? '');
}

const EXPORTED_AT = Date.UTC(2026, 7, 19, 21, 30, 0);

describe('the format', () => {
  it('writes the header B6 does not name, and writes it first', () => {
    const bundle = buildZoneCsv(ZONE, EXPORTED_AT);
    expect(bundle.schema).toBe(ZONE_CSV_SCHEMA);
    expect(bundle.text.split('\r\n')[0]).toBe(
      '"camera_id","owner_type","facing_inbound","confirmations","reads"',
    );
    expect(ZONE_CSV_COLUMNS).toHaveLength(5);
  });

  it('writes one record per camera, terminated', () => {
    const bundle = buildZoneCsv(ZONE, EXPORTED_AT);
    const lines = bundle.text.split('\r\n');
    expect(bundle.rows).toBe(3);
    /* header + 3 records + the trailing terminator's empty tail */
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('');
  });

  it('carries the counts the log recorded, muted passes included', () => {
    const bundle = buildZoneCsv(ZONE, EXPORTED_AT);
    expect(bundle.text).toContain('"FWM-0442","police","yes","4","3"');
  });

  it('says unknown rather than no when a facing was never recorded', () => {
    expect(facingField(null)).toBe('unknown');
    expect(facingField(false)).toBe('no');
    expect(facingField(true)).toBe('yes');
    expect(buildZoneCsv(ZONE, EXPORTED_AT).text).toContain('"FWM-0118","inter_agency","unknown"');
  });

  it('quotes every field and escapes a quote inside one', () => {
    expect(csvField('plain')).toBe('"plain"');
    expect(csvField('say "hi", then')).toBe('"say ""hi"", then"');
  });

  it('leaves a missing confirmation count blank rather than guessing zero', () => {
    const row = zoneCsvRow({
      id: 'FWM-X',
      ownerType: null,
      facingInbound: null,
      confirmations: null,
      eastFt: 0,
      northFt: 0,
      reads: 0,
      tripReads: 0,
    });
    expect(row).toBe('"FWM-X","unknown","unknown","","0"');
  });

  it('names the file by a UTC date and by nothing about the driver', () => {
    expect(zoneCsvFilename(EXPORTED_AT)).toBe('fwm-zone-audit-20260819.csv');
    expect(buildZoneCsv(ZONE, EXPORTED_AT).filename).toBe('fwm-zone-audit-20260819.csv');
  });
});

describe('what may never be in it', () => {
  const bundle = buildZoneCsv(ZONE, EXPORTED_AT);

  it('carries no coordinate: not a camera position, not the zone centre, not the fix', () => {
    /* Every coordinate in the fixture, in every form it could be printed in. */
    const coordinates = ['39.1', '39.11448', '39.09', '-84.58', '-84.56136', '84.58', '84.56'];
    for (const value of coordinates) expect(bundle.text).not.toContain(value);
  });

  it('carries no distance and no bearing, which would locate the centre by inference', () => {
    /* The offsets the zone model holds for these two cameras, rounded hard. */
    expect(bundle.text).not.toContain('5274');
    expect(bundle.text).not.toContain('5290');
    for (const column of ZONE_CSV_COLUMNS) {
      expect(column).not.toContain('lat');
      expect(column).not.toContain('lon');
      expect(column).not.toContain('distance');
      expect(column).not.toContain('bearing');
      expect(column).not.toContain('east');
      expect(column).not.toContain('north');
    }
  });

  it('carries no timestamp, because when a read happened is a movement trace', () => {
    expect(bundle.text).not.toContain('2026');
    expect(bundle.text).not.toContain(String(EXPORTED_AT));
    for (const column of ZONE_CSV_COLUMNS) {
      expect(column).not.toMatch(/(^|_)(at|time|timestamp|date|seen|when)($|_)/);
    }
  });

  it('carries no plate, and has no column that could hold one', () => {
    expect(bundle.text.toLowerCase()).not.toContain('plate');
    for (const column of ZONE_CSV_COLUMNS) expect(column).not.toContain('plate');
  });

  /* ROW ORDER IS A FIELD. `camerasInZone()` returns nearest first, so writing
   * the rows in the order they arrive makes line number an ordinal distance
   * ranking from the driver's fix -- the `no distance` rule above, defeated by
   * the shape of the file rather than by any column in it. */
  it('carries no distance ranking in the order it writes the rows', () => {
    const nearestFirst = ZONE.map((camera) => camera.id);
    expect(nearestFirst).toEqual(['FWM-0873', 'FWM-0442', 'FWM-0118']);

    const written = exportedIds(bundle.text);
    expect(written).not.toEqual(nearestFirst);
    expect(written).toEqual(['FWM-0118', 'FWM-0442', 'FWM-0873']);
    expect(written).toEqual([...written].sort());
  });

  it('writes the same order whichever order the zone hands it over in', () => {
    const reversed = buildZoneCsv([...ZONE].reverse(), EXPORTED_AT);
    const shuffled = buildZoneCsv([ZONE[1], ZONE[2], ZONE[0]] as ZoneCamera[], EXPORTED_AT);
    expect(reversed.text).toBe(bundle.text);
    expect(shuffled.text).toBe(bundle.text);
  });

  it('does not reorder the caller list it was handed', () => {
    const given = [...ZONE];
    sortForExport(given);
    expect(given.map((camera) => camera.id)).toEqual(ZONE.map((camera) => camera.id));
  });

  it('is empty of records rather than fabricated when the zone is empty', () => {
    const empty = buildZoneCsv([], EXPORTED_AT);
    expect(empty.rows).toBe(0);
    expect(empty.text.split('\r\n').filter((line) => line !== '')).toHaveLength(1);
  });
});
