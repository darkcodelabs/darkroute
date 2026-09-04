/**
 * The zone's arithmetic, against the engine's own answers.
 *
 * The fixture is a real disc: a centre at 39.1000 N, 84.5800 W and cameras at
 * measured offsets from it, so `camerasInZone` is exercised through
 * `@fwm/core`'s `distanceFt` / `bearing` rather than against a hand-built
 * offset that could agree with a mistake.
 *
 * The load-bearing test in this file is `counts a muted pass exactly like an
 * unmuted one`: the same log is counted twice, once with every entry flagged
 * muted, and the counts are compared.
 */

// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { latLonToTile } from '../../stores/fwmCore.ts';
import type { AlertLogEntry, CameraRecord } from '../../stores';
import { cameraPasses } from '../log/exposure.ts';

import {
  DEFAULT_ZONE_RADIUS_MI,
  HEAT_CAPTION,
  HEAT_CAPTION_RECORDED,
  HEAT_GRID_COLS,
  HEAT_GRID_ROWS,
  HEAVY_READS,
  HEAVY_READS_PER_MI,
  MEDIUM_READS,
  MEDIUM_READS_PER_MI,
  ZONE_RADII_MI,
  ZONE_STAT_ROWS,
  camerasInZone,
  cardProvenance,
  cardSentence,
  cellFor,
  formatRadiusReadout,
  heatCaption,
  heatCells,
  heatRank,
  heatScope,
  heatUnavailableReason,
  inReadWindow,
  isZoneRadiusMi,
  nextZoneRadius,
  readCounts,
  tripOverlayLabel,
  zoneStatValue,
  zoneStats,
  zoneTilesCached,
} from './zone.ts';

const CENTRE = { lat: 39.1, lon: -84.58 };

/** Measured offsets from CENTRE. The comment is what the engine returns. */
const NORTH_1_MI = { lat: 39.11448, lon: -84.58 }; /*  5274 ft (0.999 mi), col 4 row 1 */
const EAST_1_MI = { lat: 39.1, lon: -84.56136 }; /*    5290 ft, col 6 row 2 */
const SOUTH_HALF_MI = { lat: 39.09276, lon: -84.58 }; /* 2637 ft, col 4 row 3 */
const WEST_1_5_MI = { lat: 39.1, lon: -84.60796 }; /*  7935 ft, col 0 row 2 */
const NORTH_3_MI = { lat: 39.14344, lon: -84.58 }; /* 15822 ft, outside 2 mi */

function camera(over: Partial<CameraRecord> & { readonly id: string }): CameraRecord {
  return {
    lat: CENTRE.lat,
    lon: CENTRE.lon,
    directionDeg: null,
    ...over,
  };
}

/** The four cameras inside a 2 mi disc, plus one outside it. */
const CACHE: readonly CameraRecord[] = [
  camera({ id: 'FWM-N1', ...NORTH_1_MI, directionDeg: 180, ownerType: 'police', confirmations: 4 }),
  camera({ id: 'FWM-E1', ...EAST_1_MI, directionDeg: 270, ownerType: 'inter_agency' }),
  camera({ id: 'FWM-S05', ...SOUTH_HALF_MI, ownerType: 'hoa', confirmations: 2 }),
  camera({ id: 'FWM-W15', ...WEST_1_5_MI, directionDeg: 0, ownerType: 'private' }),
  camera({ id: 'FWM-FAR', ...NORTH_3_MI, ownerType: 'police' }),
];

let nextEntryId = 1;

function entry(over: Partial<AlertLogEntry> = {}): AlertLogEntry {
  return {
    id: nextEntryId++,
    cameraId: 'FWM-N1',
    label: null,
    atMs: 1_760_000_000_000,
    state: 'in_range',
    previousState: 'clear',
    distanceFt: 420,
    speedMph: 41,
    headingDeg: 0,
    muted: false,
    outcome: null,
    ...over,
  };
}

describe('the radius selector', () => {
  it('opens on the radius B6 draws', () => {
    expect(DEFAULT_ZONE_RADIUS_MI).toBe(2);
    expect(formatRadiusReadout(DEFAULT_ZONE_RADIUS_MI)).toBe('2 MI RADIUS');
  });

  it('advances through every offered radius and wraps back', () => {
    const seen = [DEFAULT_ZONE_RADIUS_MI];
    let current = DEFAULT_ZONE_RADIUS_MI;
    for (let step = 0; step < ZONE_RADII_MI.length; step++) {
      current = nextZoneRadius(current);
      seen.push(current);
    }
    expect(new Set(seen)).toEqual(new Set(ZONE_RADII_MI));
    expect(seen[seen.length - 1]).toBe(DEFAULT_ZONE_RADIUS_MI);
  });

  it('rejects a radius nobody offered', () => {
    expect(isZoneRadiusMi(2)).toBe(true);
    expect(isZoneRadiusMi(3)).toBe(false);
    expect(isZoneRadiusMi('2')).toBe(false);
  });
});

describe('the disc', () => {
  it('keeps the cameras inside the radius and drops the one outside it', () => {
    const inZone = camerasInZone(CACHE, CENTRE, 2);
    expect(inZone.map((item) => item.id)).toEqual(['FWM-S05', 'FWM-N1', 'FWM-E1', 'FWM-W15']);
  });

  it('narrows and widens with the radius', () => {
    expect(camerasInZone(CACHE, CENTRE, 1).map((item) => item.id)).toEqual(['FWM-S05', 'FWM-N1']);
    expect(camerasInZone(CACHE, CENTRE, 5)).toHaveLength(5);
  });

  it('is empty rather than centred on nothing when there is no fix', () => {
    expect(camerasInZone(CACHE, null, 2)).toEqual([]);
  });

  it('drops a camera whose position cannot be used instead of pinning it at the centre', () => {
    const broken = [...CACHE, camera({ id: 'FWM-BAD', lat: Number.NaN, lon: Number.NaN })];
    expect(camerasInZone(broken, CENTRE, 2).map((item) => item.id)).not.toContain('FWM-BAD');
  });

  it('carries the read count the log recorded for each camera', () => {
    const reads = new Map([
      ['FWM-N1', 3],
      ['FWM-E1', 1],
    ]);
    const byId = new Map(camerasInZone(CACHE, CENTRE, 2, reads).map((item) => [item.id, item]));
    expect(byId.get('FWM-N1')?.reads).toBe(3);
    expect(byId.get('FWM-E1')?.reads).toBe(1);
    expect(byId.get('FWM-S05')?.reads).toBe(0);
  });

  it('keeps the trip subset apart from the retained total, per camera', () => {
    const zone = camerasInZone(
      CACHE,
      CENTRE,
      2,
      new Map([['FWM-N1', 20]]),
      new Map([['FWM-N1', 2]]),
    );
    const north = zone.find((item) => item.id === 'FWM-N1');
    expect(north?.reads).toBe(20);
    expect(north?.tripReads).toBe(2);
    /* A camera the trip never reached has a trip count of zero, not its total. */
    expect(zone.find((item) => item.id === 'FWM-E1')?.tripReads).toBe(0);
  });

  it('says a camera with no recorded facing is unknown, never "not facing you"', () => {
    const byId = new Map(camerasInZone(CACHE, CENTRE, 2).map((item) => [item.id, item]));
    /* A lens at 180 due north of the centre looks back at it. */
    expect(byId.get('FWM-N1')?.facingInbound).toBe(true);
    /* A lens at 0 due west of the centre looks away from it. */
    expect(byId.get('FWM-W15')?.facingInbound).toBe(false);
    /* No recorded direction at all. */
    expect(byId.get('FWM-S05')?.facingInbound).toBeNull();
  });
});

describe('the card counts', () => {
  it('buckets the exclusive owner enum and counts facings across all of them', () => {
    const stats = zoneStats(camerasInZone(CACHE, CENTRE, 2));
    expect(stats.total).toBe(4);
    expect(stats.police).toBe(1);
    expect(stats.hoaPrivate).toBe(2);
    expect(stats.sharedOutside).toBe(1);
    /* The lens due north pointed at 180 and the lens due east pointed at 270
     * both look back at the middle of the zone; the one due west pointed at 0
     * looks away from it. */
    expect(stats.facingInbound).toBe(2);
  });

  it('counts an unclassified camera in the total and in no row', () => {
    const stats = zoneStats(
      camerasInZone([...CACHE, camera({ id: 'FWM-U', ...SOUTH_HALF_MI })], CENTRE, 2),
    );
    expect(stats.total).toBe(5);
    expect(stats.unclassified).toBe(1);
    expect(stats.police + stats.hoaPrivate + stats.sharedOutside).toBe(4);
  });

  it('resolves every row B6 draws', () => {
    const stats = zoneStats(camerasInZone(CACHE, CENTRE, 2));
    expect(ZONE_STAT_ROWS.map((row) => zoneStatValue(stats, row))).toEqual([1, 2, 1, 2]);
  });
});

describe('what counts as a read', () => {
  it('counts the transition into an alert and not the ticks that follow it', () => {
    const counts = readCounts([
      entry({ state: 'in_range', previousState: 'clear' }),
      entry({ state: 'in_range', previousState: 'in_range' }),
      entry({ state: 'clear', previousState: 'in_range' }),
      entry({ state: 'multiple', previousState: 'clear' }),
    ]);
    expect(counts.get('FWM-N1')).toBe(2);
  });

  it('ignores a transition that was about no camera', () => {
    expect(readCounts([entry({ cameraId: null })]).size).toBe(0);
  });

  it('counts a muted pass exactly like an unmuted one', () => {
    const drive = [
      entry({ cameraId: 'FWM-N1' }),
      entry({ cameraId: 'FWM-E1' }),
      entry({ cameraId: 'FWM-N1' }),
    ];
    const silenced = drive.map((item) => ({ ...item, muted: true }));
    expect([...readCounts(silenced)]).toEqual([...readCounts(drive)]);
  });

  /* The drift guard `zone.ts` claims. The predicate is IMPORTED from
   * `features/log/exposure.ts`, and this drives one fixture through both
   * surfaces so a change to LOG's definition of a pass cannot silently change
   * the number this screen prints on a shareable card. */
  it('counts exactly the rows LOG counts as passes, off one fixture', () => {
    const drive = [
      entry({ cameraId: 'FWM-N1', state: 'in_range', previousState: 'clear' }),
      entry({ cameraId: 'FWM-N1', state: 'in_range', previousState: 'in_range' }),
      entry({ cameraId: 'FWM-N1', state: 'clear', previousState: 'in_range' }),
      entry({ cameraId: 'FWM-E1', state: 'approaching', previousState: 'clear' }),
      entry({ cameraId: 'FWM-E1', state: 'multiple', previousState: 'approaching' }),
      entry({ cameraId: null, state: 'in_range', previousState: 'clear' }),
    ];
    const counted = [...readCounts(drive).values()].reduce((total, n) => total + n, 0);
    expect(counted).toBe(cameraPasses(drive).filter((row) => row.cameraId !== null).length);
    expect(counted).toBe(2);
  });

  describe('inside one window', () => {
    const TRIP_START = 2_000;
    const drive = [
      entry({ cameraId: 'FWM-N1', atMs: TRIP_START - 1 }),
      entry({ cameraId: 'FWM-N1', atMs: TRIP_START }),
      entry({ cameraId: 'FWM-N1', atMs: TRIP_START + 500 }),
      entry({ cameraId: 'FWM-N1', atMs: TRIP_START + 5_000 }),
    ];

    it('counts everything retained when no window is given', () => {
      expect(readCounts(drive).get('FWM-N1')).toBe(4);
    });

    it('drops the reads that happened before the window opened', () => {
      expect(readCounts(drive, { fromMs: TRIP_START, toMs: null }).get('FWM-N1')).toBe(3);
    });

    it('drops the reads that happened after it closed', () => {
      expect(readCounts(drive, { fromMs: TRIP_START, toMs: TRIP_START + 500 }).get('FWM-N1')).toBe(
        2,
      );
    });

    it('is inclusive at both ends and refuses a read with no usable clock', () => {
      expect(inReadWindow(10, { fromMs: 10, toMs: 20 })).toBe(true);
      expect(inReadWindow(20, { fromMs: 10, toMs: 20 })).toBe(true);
      expect(inReadWindow(21, { fromMs: 10, toMs: 20 })).toBe(false);
      expect(inReadWindow(Number.NaN, { fromMs: 10, toMs: 20 })).toBe(false);
      expect(inReadWindow(Number.NaN, null)).toBe(true);
    });
  });
});

describe('has this device looked at THIS zone', () => {
  const CENTRE_TILE = latLonToTile(CENTRE.lat, CENTRE.lon, 16);
  const ELSEWHERE = latLonToTile(37.7749, -122.4194, 16);

  it('says yes when the tile the centre falls in is cached', () => {
    expect(zoneTilesCached([CENTRE_TILE], CENTRE)).toBe(true);
  });

  /* The reassuring zero this screen exists not to print: a drive through
   * another city on another day left tiles in the cache, and a GLOBAL tile
   * count would call every zone on earth "looked at" for ever after. */
  it('says no when every cached tile belongs to somewhere else', () => {
    expect(zoneTilesCached([ELSEWHERE], CENTRE)).toBe(false);
    expect(zoneTilesCached([ELSEWHERE, CENTRE_TILE], CENTRE)).toBe(true);
  });

  it('says no with an empty cache and no with no fix', () => {
    expect(zoneTilesCached([], CENTRE)).toBe(false);
    expect(zoneTilesCached([CENTRE_TILE], null)).toBe(false);
  });

  it('answers at whatever zoom the cache holds, and picks none of its own', () => {
    expect(zoneTilesCached([latLonToTile(CENTRE.lat, CENTRE.lon, 12)], CENTRE)).toBe(true);
    expect(zoneTilesCached([latLonToTile(CENTRE.lat, CENTRE.lon, 18)], CENTRE)).toBe(true);
  });

  it('skips a tile whose zoom is not a zoom, rather than throwing on it', () => {
    expect(zoneTilesCached([{ x: 0, y: 0, z: 99 }, CENTRE_TILE], CENTRE)).toBe(true);
    expect(zoneTilesCached([{ x: 0, y: 0, z: Number.NaN }], CENTRE)).toBe(false);
  });
});

describe('the heat layer', () => {
  /* Four retained reads at FWM-N1, all four of them inside the open trip. */
  const zone = camerasInZone(CACHE, CENTRE, 2, new Map([['FWM-N1', 4]]), new Map([['FWM-N1', 4]]));

  it('places a camera in the cell the engine puts it in', () => {
    const byId = new Map(zone.map((item) => [item.id, item]));
    const north = byId.get('FWM-N1');
    const east = byId.get('FWM-E1');
    expect(north).toBeDefined();
    expect(east).toBeDefined();
    expect(cellFor(north?.eastFt ?? 0, north?.northFt ?? 0, 2)).toEqual({ col: 4, row: 1 });
    expect(cellFor(east?.eastFt ?? 0, east?.northFt ?? 0, 2)).toEqual({ col: 6, row: 2 });
  });

  it('always returns the whole grid, so an empty cell is empty and not missing', () => {
    const cells = heatCells({ cameras: zone, radiusMi: 2, milesDriven: 8, tripCameraIds: [] });
    expect(cells).toHaveLength(HEAT_GRID_COLS * HEAT_GRID_ROWS);
    expect(cells.filter((cell) => cell.cameras > 0)).toHaveLength(4);
    expect(cells.filter((cell) => cell.rank === 'none').length).toBeGreaterThan(0);
  });

  it('has no rate at all until miles have been driven, and says so in the caption', () => {
    const cells = heatCells({ cameras: zone, radiusMi: 2, milesDriven: null, tripCameraIds: [] });
    expect(cells.every((cell) => cell.readsPerMile === null)).toBe(true);
    expect(heatScope(null)).toBe('recorded');
    expect(heatCaption('recorded')).toBe(HEAT_CAPTION_RECORDED);
    expect(HEAT_CAPTION_RECORDED).not.toContain('PER MILE');
  });

  /* THE BUG THIS FILE EXISTS TO CATCH. Nothing in the product opens a trip
   * (`docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner`), so `milesDriven` is
   * null in every shipped build. The layer used to draw NOT ONE CELL in that
   * state, which made B6's most prominent element permanently blank. It counts
   * the passes it actually retains instead, under a caption that says so. */
  it('still bands the cells it has measured reads for when no trip is open', () => {
    const cells = heatCells({ cameras: zone, radiusMi: 2, milesDriven: null, tripCameraIds: [] });
    const banded = cells.filter((cell) => cell.rank !== 'none');
    expect(banded).toHaveLength(1);
    expect(banded[0]?.reads).toBe(4);
    expect(banded[0]?.rank).toBe('medium');
    expect(banded[0]?.readsPerMile).toBeNull();
  });

  /* THE OTHER HALF OF THE SAME BUG. A retained read count divided by ONE
   * trip's odometer is not a rate: the numerator is all-time and the
   * denominator is one drive. Twenty reads from previous days over a ten mile
   * drive that read nothing must band as nothing, not as HEAVY. */
  it('never divides the retained lifetime count by one trip odometer', () => {
    const lifetime = camerasInZone(
      CACHE,
      CENTRE,
      2,
      new Map([['FWM-N1', 20]]),
      new Map<string, number>(),
    );
    const cells = heatCells({
      cameras: lifetime,
      radiusMi: 2,
      milesDriven: 10,
      tripCameraIds: [],
    });
    const cell = cells.find((item) => item.col === 4 && item.row === 1);
    expect(cell?.reads).toBe(0);
    expect(cell?.readsPerMile).toBe(0);
    expect(cell?.rank).toBe('none');
    expect(cells.every((item) => item.rank === 'none')).toBe(true);
  });

  it('divides the trip subset by the trip miles, and nothing else', () => {
    const mixed = camerasInZone(
      CACHE,
      CENTRE,
      2,
      new Map([['FWM-N1', 20]]),
      new Map([['FWM-N1', 2]]),
    );
    const cells = heatCells({ cameras: mixed, radiusMi: 2, milesDriven: 4, tripCameraIds: [] });
    const cell = cells.find((item) => item.col === 4 && item.row === 1);
    expect(cell?.reads).toBe(2);
    expect(cell?.readsPerMile).toBe(0.5);
    expect(cell?.rank).toBe('medium');
  });

  it('divides a cell reads by the miles driven', () => {
    const cells = heatCells({ cameras: zone, radiusMi: 2, milesDriven: 4, tripCameraIds: [] });
    const hot = cells.find((cell) => cell.col === 4 && cell.row === 1);
    expect(hot?.reads).toBe(4);
    expect(hot?.readsPerMile).toBe(1);
    expect(hot?.rank).toBe('heavy');
  });

  it('marks the cells the open trip actually reached', () => {
    const cells = heatCells({
      cameras: zone,
      radiusMi: 2,
      milesDriven: 4,
      tripCameraIds: ['FWM-E1'],
    });
    expect(cells.filter((cell) => cell.onTrip).map((cell) => [cell.col, cell.row])).toEqual([
      [6, 2],
    ]);
  });

  it('bands a rate the way the legend names them', () => {
    expect(heatRank(null, 'trip')).toBe('none');
    expect(heatRank(0, 'trip')).toBe('none');
    expect(heatRank(MEDIUM_READS_PER_MI / 2, 'trip')).toBe('low');
    expect(heatRank(MEDIUM_READS_PER_MI, 'trip')).toBe('medium');
    expect(heatRank(HEAVY_READS_PER_MI, 'trip')).toBe('heavy');
    expect(heatRank(Number.NaN, 'trip')).toBe('none');
  });

  it('bands a count against the count cut points, never the per-mile ones', () => {
    expect(heatRank(1, 'recorded')).toBe('low');
    expect(heatRank(MEDIUM_READS, 'recorded')).toBe('medium');
    expect(heatRank(HEAVY_READS, 'recorded')).toBe('heavy');
    /* One read is HEAVY as a rate and LOW as a count: the units are different
     * and the cut points may not be shared. */
    expect(heatRank(1, 'trip')).toBe('heavy');
  });

  it('captions the drawn scope with B6 own string and never the other way round', () => {
    expect(heatScope(4)).toBe('trip');
    expect(heatCaption('trip')).toBe(HEAT_CAPTION);
    expect(heatScope(0)).toBe('recorded');
    expect(heatScope(Number.NaN)).toBe('recorded');
  });

  it('names which missing thing is missing, cache before emptiness', () => {
    expect(
      heatUnavailableReason({
        located: false,
        tilesCached: true,
        camerasInZone: 4,
        readsInZone: 8,
      }),
    ).toBe('NO FIX · ZONE NOT LOCATED');
    expect(
      heatUnavailableReason({
        located: true,
        tilesCached: false,
        camerasInZone: 0,
        readsInZone: 8,
      }),
    ).toBe('NO CAMERAS CACHED FOR THIS ZONE');
    expect(
      heatUnavailableReason({
        located: true,
        tilesCached: true,
        camerasInZone: 0,
        readsInZone: 0,
      }),
    ).toBe('NO CAMERAS IN THIS ZONE');
    expect(
      heatUnavailableReason({
        located: true,
        tilesCached: true,
        camerasInZone: 4,
        readsInZone: 0,
      }),
    ).toBe('NO READS RECORDED IN THIS ZONE YET');
    expect(
      heatUnavailableReason({
        located: true,
        tilesCached: true,
        camerasInZone: 4,
        readsInZone: 8,
      }),
    ).toBeNull();
  });

  /* An availability check that never depends on the odometer again: the layer
   * has something to draw the moment reads exist, trip or no trip. */
  it('does not hold the layer back for a missing odometer', () => {
    const reasons = [null, 0, 4].map((milesDriven) =>
      heatUnavailableReason({
        located: true,
        tilesCached: true,
        camerasInZone: 4,
        readsInZone: heatCells({
          cameras: zone,
          radiusMi: 2,
          milesDriven,
          tripCameraIds: [],
        }).reduce((total, cell) => total + cell.reads, 0),
      }),
    );
    expect(reasons).toEqual([null, null, null]);
  });
});

describe('the comments this module is trusted for', () => {
  const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
  const source: string = readFileSync(`${HERE}/zone.ts`, 'utf8');

  /* It named a file that does not exist. The assertion it points at is the one
   * that stops the model and the stylesheet drifting, so the pointer has to
   * resolve. */
  it('points the grid-resolution assertion at a test file that exists', () => {
    expect(source).not.toContain('HeatLayer.test.tsx');
    expect(source).toContain('components/ZoneAuditView.test.tsx');
    readFileSync(`${HERE}/components/ZoneAuditView.test.tsx`, 'utf8');
  });

  /* It claimed the pass predicate could not be imported and had to be
   * restated. It is imported, and there is no second copy to drift. */
  it('keeps no private copy of the pass predicate', () => {
    expect(source).toContain("import { isCameraPass } from '../log/exposure.ts'");
    expect(source).not.toMatch(/function isAlerting\b/);
  });
});

describe('the card copy', () => {
  it('drops the drawn place clause rather than inventing a name', () => {
    expect(cardSentence(2)).toBe('license plate readers within 2 miles.');
    expect(cardSentence(1)).toBe('license plate readers within 1 mile.');
  });

  it('restores the drawn sentence when something named the zone', () => {
    expect(cardSentence(2, 'Hartwell Elementary')).toBe(
      'license plate readers within 2 miles of Hartwell Elementary.',
    );
    expect(cardSentence(2, '   ')).toBe('license plate readers within 2 miles.');
  });

  it('prints the provenance line the way B6 prints it', () => {
    expect(cardProvenance(new Date(2026, 7, 19, 9, 30).getTime())).toBe(
      'COMMUNITY-REPORTED · AUG 19 2026',
    );
  });

  it('labels the trip overlay with the panel string', () => {
    expect(tripOverlayLabel(true)).toBe('TRIP OVERLAY ON');
    expect(tripOverlayLabel(false)).toBe('TRIP OVERLAY OFF');
  });
});
