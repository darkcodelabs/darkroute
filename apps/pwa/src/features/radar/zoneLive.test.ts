/**
 * The live zone reading.
 *
 * The thing worth testing here is not arithmetic - it is that this agrees with
 * ZONE AUDIT. Two screens that count the same cameras differently give a driver
 * two answers and no way to tell which one is real, so the owner buckets are
 * asserted against the same classes `zone.ts` uses, by name.
 */

import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../../services/db/schema.ts';
import { AREA_RADIUS_M, AREA_RADIUS_MI } from '../../services/cameras/watchedArea.ts';

import { EMPTY_ZONE, zoneLive } from './zoneLive.ts';

const HERE = { lat: 38.9181, lon: -94.6923 };

/** ~1 degree of latitude is 111,320 m; this puts a camera a known way north. */
function north(metres: number): number {
  return HERE.lat + metres / 111_320;
}

function camera(overrides: Partial<CameraRecord> = {}): CameraRecord {
  return {
    id: 'osm/node/1',
    lat: HERE.lat,
    lon: HERE.lon,
    source: 'osm',
    ...overrides,
  } as CameraRecord;
}

describe('zoneLive', () => {
  it('reads empty with no fix, so a cold start never draws a hollow zero', () => {
    expect(zoneLive(null, [camera()])).toBe(EMPTY_ZONE);
  });

  it('reads empty when nothing is cached in range', () => {
    expect(zoneLive(HERE, [])).toBe(EMPTY_ZONE);
    expect(zoneLive(HERE, [camera({ lat: north(AREA_RADIUS_M * 2) })])).toBe(EMPTY_ZONE);
  });

  it('counts every cached camera inside the radius, not just the assessed ones', () => {
    // The alert engine looks at what it must to decide an alert. This describes
    // the area - a camera behind you still watches the road you are on.
    const zone = zoneLive(HERE, [
      camera({ id: 'a' }),
      camera({ id: 'b', lat: north(500) }),
      camera({ id: 'c', lat: north(AREA_RADIUS_M - 10) }),
      camera({ id: 'far', lat: north(AREA_RADIUS_M + 500) }),
    ]);
    expect(zone.total).toBe(3);
  });

  it('sorts owners into ZONE AUDIT’s own three classes', () => {
    const zone = zoneLive(HERE, [
      camera({ id: 'p1', ownerType: 'police' }),
      camera({ id: 'p2', ownerType: 'inter_agency' }),
      camera({ id: 'h1', ownerType: 'hoa' }),
      camera({ id: 'h2', ownerType: 'private' }),
      camera({ id: 'u1' }),
    ]);
    expect(zone.police).toBe(2);
    expect(zone.hoaPrivate).toBe(2);
    expect(zone.unverified).toBe(1);
    expect(zone.police + zone.hoaPrivate + zone.unverified).toBe(zone.total);
  });

  it('names the zone after where MOST of its cameras are, not the nearest one', () => {
    // On a boundary the nearest camera can be across a line from everything
    // else. Naming the zone after it flips the label back and forth as you
    // drive past a single node.
    const zone = zoneLive(HERE, [
      camera({ id: 'near', placeGeoid: '2099999', countyFips: '20999' }),
      camera({ id: 'a', lat: north(400), placeGeoid: '2053775', countyFips: '20091' }),
      camera({ id: 'b', lat: north(500), placeGeoid: '2053775', countyFips: '20091' }),
    ]);
    expect(zone.placeGeoid).toBe('2053775');
    expect(zone.countyFips).toBe('20091');
  });

  it('reports no place at all rather than the nearest one', () => {
    // 26,289 cameras sit on unincorporated land. "Near Overland Park" and "in
    // Overland Park" are different claims and only one is in the data.
    const zone = zoneLive(HERE, [camera({ countyFips: '20091' })]);
    expect(zone.placeGeoid).toBeNull();
    expect(zone.countyFips).toBe('20091');
  });

  it('reports the radius it actually used, in miles', () => {
    expect(zoneLive(HERE, [camera()]).radiusMi).toBe(AREA_RADIUS_MI);
    expect(zoneLive(HERE, [camera()], 1609.344).radiusMi).toBe(1);
  });

  it('still counts a muted camera -- muting removes the alert, never the record', () => {
    const zone = zoneLive(HERE, [camera({ id: 'm', muted: true } as Partial<CameraRecord>)]);
    expect(zone.total).toBe(1);
  });
});
