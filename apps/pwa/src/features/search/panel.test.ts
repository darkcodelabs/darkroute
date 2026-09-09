/**
 * THE PANEL'S BRAIN -- the four states, the ranking rule, and the count.
 *
 * The three things in this component that can be WRONG rather than ugly:
 *
 *   THE TIER      "0 cams" green, "1-3" amber, "4+" red, and an unmeasured row
 *                 a dash. A blank or a fake zero here is a lie about a road.
 *   THE RANKING   history above map results, and a history match keeps its
 *                 recent badge.
 *   THE ORDER     fewest cameras, then fastest, then avoid abuse areas -- which
 *                 is the product, not a preference.
 */

import { describe, expect, it } from 'vitest';

import {
  BADGE_PLACE,
  BADGE_RECENT,
  BADGE_SAVED_HOME,
  BADGE_SAVED_OTHER,
  COUNT_DASH,
  COUNT_UNKNOWN,
  ROUTE_OPTION_ORDER,
  countLabel,
  countTier,
  counted,
  idleRows,
  panelState,
  placeSub,
  recentSub,
  routeRows,
  sections,
  typingRows,
} from './panel.ts';
import { rememberOnStart } from './places.ts';
import type { PlaceBook, SavedPlace } from './places.ts';
import type { RouteOption } from './panel.ts';
import type { Place } from '../../services/route/planRoute.ts';
import type { SearchHit } from '../lookup/search.ts';

const NOW = 1_760_000_000_000;

const HOME: SavedPlace = {
  id: 'home',
  kind: 'home',
  name: 'Home',
  detail: '14 min · 7.2 mi',
  lat: 39.01,
  lon: -94.66,
};
const MOM: SavedPlace = { ...HOME, id: 'mom', kind: 'other', name: "Mom's place", lat: 39.2 };

const ANTIOCH: Place = {
  name: '119th & Antioch',
  detail: 'Overland Park, KS',
  lat: 38.92,
  lon: -94.68,
};

const CAMERA: SearchHit = {
  camera: {
    id: 'osm:1',
    lat: 38.92,
    lon: -94.68,
    directionDeg: null,
    ownerType: 'inter_agency',
    tags: { operator: 'Overland Park Police' },
  },
  metres: 2575,
};

describe('the camera count, which is the whole point of the panel', () => {
  it('tiers zero green, one to three amber and four or more red', () => {
    expect(countTier(counted(0))).toBe('clear');
    expect(countTier(counted(1))).toBe('some');
    expect(countTier(counted(3))).toBe('some');
    expect(countTier(counted(4))).toBe('many');
    expect(countTier(counted(11))).toBe('many');
  });

  it('says cam once and cams every other time', () => {
    expect(countLabel(counted(0))).toBe('0 cams');
    expect(countLabel(counted(1))).toBe('1 cam');
    expect(countLabel(counted(2))).toBe('2 cams');
  });

  it('shows a dash for a count nobody has measured, NOT a blank and NOT a zero', () => {
    /* Zero is a real and reassuring answer here -- it is the answer the whole
       product is looking for -- so defaulting an unknown to it would be telling
       a driver a road is clear because the app has not looked yet. */
    expect(countLabel(COUNT_UNKNOWN)).toBe(COUNT_DASH);
    expect(countLabel(COUNT_UNKNOWN)).not.toBe('');
    expect(countLabel(COUNT_UNKNOWN)).not.toBe('0 cams');
    expect(countTier(COUNT_UNKNOWN)).toBe('unknown');
  });

  it('refuses a count that is not a count rather than drawing it', () => {
    expect(counted(Number.NaN)).toEqual(COUNT_UNKNOWN);
    expect(counted(-1)).toEqual(COUNT_UNKNOWN);
  });
});

describe('the four states', () => {
  it('is idle with an empty field, typing with anything in it', () => {
    expect(panelState({ query: '', picked: null, routing: false })).toBe('idle');
    expect(panelState({ query: '   ', picked: null, routing: false })).toBe('idle');
    expect(panelState({ query: '119th', picked: null, routing: false })).toBe('typing');
  });

  it('is picked once a destination is chosen, whatever is in the field', () => {
    expect(panelState({ query: '119th', picked: ANTIOCH, routing: false })).toBe('picked');
    expect(panelState({ query: '', picked: ANTIOCH, routing: false })).toBe('picked');
  });

  it('is routing above everything else, because the panel dismisses', () => {
    expect(panelState({ query: '119th', picked: ANTIOCH, routing: true })).toBe('routing');
  });
});

describe('1 · IDLE -- opens to places', () => {
  it('draws saved places first in fixed order, then recents newest-first', () => {
    let book: PlaceBook = { saved: [MOM, HOME], recents: [] };
    book = rememberOnStart(book, { ...ANTIOCH }, NOW - 86_400_000);
    book = rememberOnStart(book, { ...ANTIOCH, name: 'Oak Park Mall', lat: 38.93 }, NOW);

    expect(idleRows(book).map((row) => row.name)).toEqual([
      'Home',
      "Mom's place",
      'Oak Park Mall',
      '119th & Antioch',
    ]);
  });

  it('badges home with H, a starred place with the star, and a recent with the return arrow', () => {
    const book = rememberOnStart({ saved: [MOM, HOME], recents: [] }, { ...ANTIOCH }, NOW);
    const glyphs = idleRows(book).map((row) => row.glyph);
    expect(glyphs).toEqual([BADGE_SAVED_HOME, BADGE_SAVED_OTHER, BADGE_RECENT]);
    /* The codepoints, not a lookalike. U+2605 and U+21BB. */
    expect(BADGE_SAVED_OTHER.codePointAt(0)).toBe(0x2605);
    expect(BADGE_RECENT.codePointAt(0)).toBe(0x21bb);
  });

  it('tints a starred place amber and Home cyan, which is what the badge is FOR', () => {
    const book: PlaceBook = { saved: [HOME, MOM], recents: [] };
    expect(idleRows(book).map((row) => row.tone)).toEqual(['saved', 'other-saved']);
  });

  it('gives every row a count, and a dash when nobody has measured one', () => {
    const book = rememberOnStart({ saved: [HOME], recents: [] }, { ...ANTIOCH }, NOW);
    for (const row of idleRows(book)) {
      expect(row.trailing.kind).toBe('count');
      if (row.trailing.kind === 'count') expect(row.trailing.count).toEqual(COUNT_UNKNOWN);
    }
  });

  it('carries the trip count on a recent, and says recent alone on the first trip', () => {
    const once = rememberOnStart({ saved: [], recents: [] }, { ...ANTIOCH }, NOW);
    expect(recentSub(once.recents[0] as never)).toBe('recent');
    const twice = rememberOnStart(once, { ...ANTIOCH }, NOW + 1);
    expect(recentSub(twice.recents[0] as never)).toBe('recent · 2 trips');
  });
});

describe('2 · TYPING -- history ranks above the map', () => {
  const book = rememberOnStart({ saved: [], recents: [] }, { ...ANTIOCH }, NOW);
  const geocoded: readonly Place[] = [
    { name: 'W 119th St & Antioch Rd', detail: 'Overland Park, KS', lat: 38.92, lon: -94.681 },
    { name: 'Antioch Rd & W 119th Ter', detail: 'Leawood, KS', lat: 38.91, lon: -94.681 },
  ];

  it('puts somewhere you have been above a geocoder guess', () => {
    const rows = typingRows({ book, query: '119th ant', places: geocoded, cameras: [] });
    expect(rows.map((row) => row.name)).toEqual([
      '119th & Antioch',
      'W 119th St & Antioch Rd',
      'Antioch Rd & W 119th Ter',
    ]);
  });

  it('keeps the recent badge on a history match rather than turning it into a map result', () => {
    const rows = typingRows({ book, query: '119th ant', places: geocoded, cameras: [] });
    expect(rows[0]?.glyph).toBe(BADGE_RECENT);
    expect(rows[1]?.glyph).toBe(BADGE_PLACE);
    expect(rows[0]?.emphasis).toBe('history');
  });

  it('keeps a count on every row, history and map result alike', () => {
    const rows = typingRows({ book, query: '119th', places: geocoded, cameras: [] });
    expect(rows.every((row) => row.trailing.kind === 'count')).toBe(true);
  });

  it('matches every word in any order across the name and the line under it', () => {
    expect(typingRows({ book, query: 'antioch 119', places: null, cameras: [] })).toHaveLength(1);
    expect(typingRows({ book, query: 'antioch zzz', places: null, cameras: [] })).toHaveLength(0);
  });

  it('leads a map result with how far it is, so a long address cannot clip the distance', () => {
    /* A geocoder's detail is a whole address and the row ellipsises it. The
       distance is the fact the driver chooses on, so it goes first. */
    expect(placeSub('11601, East US Highway 40, Kansas City, Jackson County, Missouri', { minutes: 14, miles: 7.2 })).toBe(
      '7.2 mi · 11601, East US Highway 40, Kansas City, Jackson County, Missouri',
    );
    expect(placeSub('Leawood, KS', null)).toBe('Leawood, KS');
  });

  it('shows no map results at all until the geocoder has been asked', () => {
    /* `planRoute.ts` forbids a call while somebody types. Null is the normal
       state of that prop and the list has to be usable in it. */
    const rows = typingRows({ book, query: '119th', places: null, cameras: [] });
    expect(rows).toHaveLength(1);
  });

  it('does not draw a geocoder answer that is already a row of history', () => {
    const dupe = [{ ...ANTIOCH }, ...geocoded];
    const rows = typingRows({ book, query: '119th', places: dupe, cameras: [] });
    expect(rows.filter((row) => row.name === '119th & Antioch')).toHaveLength(1);
  });
});

describe('the six result types', () => {
  it('gives a camera a distance over a verb rather than a camera count', () => {
    const rows = typingRows({ book: { saved: [], recents: [] }, query: 'overland', places: null, cameras: [CAMERA] });
    const camera = rows[0];
    expect(camera?.group).toBe('cameras');
    expect(camera?.trailing).toEqual({ kind: 'meta', far: '1.6 mi', verb: 'SHOW' });
    /* It never becomes a destination. */
    expect(camera?.action.kind).toBe('show');
  });

  it('tints an indexed camera to whose hardware it is', () => {
    const rows = typingRows({ book: { saved: [], recents: [] }, query: 'overland', places: null, cameras: [CAMERA] });
    expect(rows[0]?.tone).toBe('flock');
  });

  it('keeps an unverified camera purple and out of the verified tint', () => {
    const unverified: SearchHit = {
      ...CAMERA,
      camera: { ...CAMERA.camera, id: 'osm:2', ownerType: 'unverified' },
    };
    const rows = typingRows({ book: { saved: [], recents: [] }, query: 'overland', places: null, cameras: [unverified] });
    expect(rows[0]?.tone).toBe('unverified');
  });

  it('heads the groups only when there is something to distinguish from', () => {
    const book = rememberOnStart({ saved: [], recents: [] }, { ...ANTIOCH }, NOW);
    const alone = sections(typingRows({ book, query: '119th', places: null, cameras: [] }));
    expect(alone).toHaveLength(1);
    expect(alone[0]?.headed).toBe(false);

    const mixed = sections(
      typingRows({ book, query: 'a', places: null, cameras: [CAMERA] }),
    );
    expect(mixed.map((entry) => entry.group)).toEqual(['destinations', 'cameras']);
    expect(mixed.every((entry) => entry.headed)).toBe(true);
  });
});

describe('3 · PICKED -- fewest cameras is the default', () => {
  const options: readonly RouteOption[] = [
    { kind: 'fastest', detail: '6 min · 2.4 mi', count: counted(1) },
    { kind: 'avoid-abuse', detail: '11 min · 3.6 mi', count: counted(0) },
    { kind: 'fewest-cameras', detail: '8 min · 2.9 mi', count: counted(0) },
  ];

  it('ranks by exposure first whatever order the router answered in', () => {
    expect(routeRows(options).map((row) => row.name)).toEqual([
      'Fewest cameras',
      'Fastest',
      'Avoid abuse areas',
    ]);
    expect(ROUTE_OPTION_ORDER[0]).toBe('fewest-cameras');
  });

  it('fills the first row as the default and leaves the other two plain', () => {
    const rows = routeRows(options);
    expect(rows[0]?.emphasis).toBe('default');
    expect(rows[0]?.tone).toBe('keep');
    expect(rows[1]?.emphasis).toBe('none');
    expect(rows[2]?.emphasis).toBe('none');
  });

  it('numbers the badges by position, so two options are 1 and 2 with no gap', () => {
    const two = routeRows([options[1] as RouteOption, options[2] as RouteOption]);
    expect(two.map((row) => row.glyph)).toEqual(['1', '2']);
  });

  it('does not rank fastest above fewest even when fastest ties on cameras', () => {
    const tied: readonly RouteOption[] = [
      { kind: 'fastest', detail: '6 min', count: counted(0) },
      { kind: 'fewest-cameras', detail: '8 min', count: counted(0) },
    ];
    expect(routeRows(tied)[0]?.name).toBe('Fewest cameras');
  });
});
