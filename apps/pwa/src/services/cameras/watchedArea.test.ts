import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../db/schema.ts';

import {
  AREA_ENTRY_COUNT,
  AREA_EXIT_COUNT,
  NO_AREA,
  camerasWithin,
  stepWatchedArea,
  watchedAreaNotice,
} from './watchedArea.ts';

const AT = { lat: 38.9181, lon: -94.6923 };

/** `n` cameras a few hundred metres out, well inside the radius. */
function cluster(n: number): CameraRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `osm:${String(i)}`,
    lat: AT.lat + (i + 1) * 0.0005,
    lon: AT.lon,
    directionDeg: null,
    ownerType: 'unverified' as const,
    confirmations: 1,
  }));
}

/** One camera far outside the radius. */
const FAR: CameraRecord = {
  id: 'osm:far',
  lat: AT.lat + 0.5,
  lon: AT.lon,
  directionDeg: null,
  ownerType: 'unverified',
  confirmations: 1,
};

describe('counting an area', () => {
  it('counts what is inside the radius and ignores what is not', () => {
    expect(camerasWithin(AT, [...cluster(5), FAR])).toBe(5);
  });

  it('counts nothing from nothing', () => {
    expect(camerasWithin(AT, [])).toBe(0);
  });
});

describe('the watched-area latch', () => {
  it('says nothing about an ordinary road', () => {
    // A handful of cameras is any arterial. The notice has to mean something
    // the driver did not already assume.
    const area = stepWatchedArea(NO_AREA, AT, cluster(AREA_ENTRY_COUNT - 1));

    expect(area.inside).toBe(false);
    expect(area.entered).toBe(false);
    expect(watchedAreaNotice(area)).toBeNull();
  });

  it('fires once on entry, and reports the count', () => {
    const entered = stepWatchedArea(NO_AREA, AT, cluster(23));

    expect(entered.entered).toBe(true);
    expect(entered.inside).toBe(true);
    expect(entered.count).toBe(23);
    expect(watchedAreaNotice(entered)).toBe('entering a watched area · 23 cameras within 2 mi');
  });

  it('does not re-announce the same town on the next tick', () => {
    const first = stepWatchedArea(NO_AREA, AT, cluster(23));
    const second = stepWatchedArea(first, AT, cluster(23));

    expect(second.entered).toBe(false);
    expect(second.inside).toBe(true);
  });

  it('holds through a dip, so driving the boundary is not a strobe', () => {
    // The bug this prevents: without hysteresis a driver along the edge gets
    // the same notice every 250 m until they stop reading it.
    const inside = stepWatchedArea(NO_AREA, AT, cluster(AREA_ENTRY_COUNT + 2));
    const dipped = stepWatchedArea(inside, AT, cluster(AREA_ENTRY_COUNT - 1));

    expect(dipped.inside).toBe(true);
    expect(dipped.entered).toBe(false);
  });

  it('lets go once the area is properly behind you', () => {
    const inside = stepWatchedArea(NO_AREA, AT, cluster(20));
    const left = stepWatchedArea(inside, AT, cluster(AREA_EXIT_COUNT));

    expect(left.inside).toBe(false);
    expect(watchedAreaNotice(left)).toBeNull();
  });

  it('can fire again for the NEXT town', () => {
    const inside = stepWatchedArea(NO_AREA, AT, cluster(20));
    const left = stepWatchedArea(inside, AT, []);
    const nextTown = stepWatchedArea(left, AT, cluster(30));

    expect(nextTown.entered).toBe(true);
    expect(nextTown.count).toBe(30);
  });

  it('says nothing at all without a fix', () => {
    const inside = stepWatchedArea(NO_AREA, AT, cluster(20));
    expect(stepWatchedArea(inside, null, cluster(20))).toEqual(NO_AREA);
  });

  it('counts one camera as one camera', () => {
    const area = stepWatchedArea(NO_AREA, AT, cluster(1), { entryCount: 1 });
    expect(watchedAreaNotice(area)).toBe('entering a watched area · 1 camera within 2 mi');
  });
});
