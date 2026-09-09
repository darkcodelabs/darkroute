/**
 * DESTINATION HISTORY -- section C, rule by rule.
 *
 * Eight rules and eight tests, and the two that matter most are the two a
 * person cannot check for themselves: that nothing is written until a route
 * STARTS, and that a wipe takes the saved places with it. Both are promises
 * this application makes in prose on a Settings screen, and prose does not
 * fail a build.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_BOOK,
  RECENTS_KEPT,
  expireRecents,
  forgetAllRecents,
  forgetRecent,
  isFirstRun,
  orderedRecents,
  orderedSaved,
  promoteToSaved,
  rememberOnStart,
  wiped,
} from './places.ts';
import type { PlaceBook, SavedPlace } from './places.ts';

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

function place(name: string, lat = 39.05, lon = -94.6) {
  return { name, detail: 'Overland Park, KS', lat, lon };
}

const HOME: SavedPlace = {
  id: 'home',
  kind: 'home',
  name: 'Home',
  detail: '7.2 mi',
  lat: 39.01,
  lon: -94.66,
};
const WORK: SavedPlace = { ...HOME, id: 'work', kind: 'work', name: 'Work', lat: 39.1 };
const MOM: SavedPlace = { ...HOME, id: 'mom', kind: 'other', name: "Mom's place", lat: 39.2 };

/** N trips to N different places, oldest first. */
function withTrips(count: number, from = NOW - count * DAY): PlaceBook {
  let book = EMPTY_BOOK;
  for (let i = 0; i < count; i++) {
    book = rememberOnStart(book, place(`Place ${String(i)}`, 39 + i / 100), from + i * DAY);
  }
  return book;
}

describe('what is stored, and when', () => {
  it('writes nothing at all until a route actually starts', () => {
    /* There is no other function in the module that can add a row. This is the
       assertion in its strongest available form: the module's whole surface is
       searched for a way to grow the book and there is exactly one. */
    expect(isFirstRun(EMPTY_BOOK)).toBe(true);
    expect(isFirstRun(rememberOnStart(EMPTY_BOOK, place('Oak Park Mall'), NOW))).toBe(false);
  });

  it('keeps the four fields section C names and no fifth', () => {
    const book = rememberOnStart(EMPTY_BOOK, place('Oak Park Mall'), NOW);
    const [entry] = book.recents;
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      ['detail', 'id', 'lastUsedMs', 'lat', 'lon', 'name', 'trips'].sort(),
    );
    /* No route, no time of day, no dwell. A list of (place, when, how often) is
       a list of destinations; add those three and it is a pattern of life. */
    expect(entry).not.toHaveProperty('route');
    expect(entry).not.toHaveProperty('dwellMs');
  });

  it('counts a second trip rather than drawing a second row', () => {
    const once = rememberOnStart(EMPTY_BOOK, place('Oak Park Mall'), NOW - DAY);
    const twice = rememberOnStart(once, place('Oak Park Mall'), NOW);
    expect(twice.recents).toHaveLength(1);
    expect(twice.recents[0]?.trips).toBe(2);
    expect(twice.recents[0]?.lastUsedMs).toBe(NOW);
  });

  it('does not put a saved place in recents, because it is never in both', () => {
    const book: PlaceBook = { saved: [HOME], recents: [] };
    const after = rememberOnStart(
      book,
      { name: HOME.name, detail: HOME.detail, lat: HOME.lat, lon: HOME.lon },
      NOW,
    );
    expect(after.recents).toHaveLength(0);
    expect(after).toBe(book);
  });
});

describe('order, and how many', () => {
  it('draws saved first in a fixed order: home, work, then the starred ones', () => {
    const book: PlaceBook = { saved: [MOM, WORK, HOME], recents: [] };
    expect(orderedSaved(book).map((entry) => entry.name)).toEqual(['Home', 'Work', "Mom's place"]);
  });

  it('draws recents newest-first', () => {
    const book = withTrips(3);
    expect(orderedRecents(book).map((entry) => entry.name)).toEqual([
      'Place 2',
      'Place 1',
      'Place 0',
    ]);
  });

  it('keeps nine, and the tenth trip evicts the oldest BY LAST-USED', () => {
    /* The trap this guards: a place driven to eleven times two years ago must
       lose to one driven to twice this week, or the list answers "where do you
       go" rather than "where are you going". */
    let book = withTrips(RECENTS_KEPT);
    const stale = { ...place('Loyal old haunt', 38.5), name: 'Loyal old haunt' };
    book = rememberOnStart(book, stale, NOW - 400 * DAY);
    book = rememberOnStart(book, stale, NOW - 399 * DAY);
    book = rememberOnStart(book, stale, NOW - 398 * DAY);
    expect(book.recents).toHaveLength(RECENTS_KEPT);

    book = rememberOnStart(book, place('Somewhere new', 40), NOW);
    expect(book.recents).toHaveLength(RECENTS_KEPT);
    expect(book.recents.map((entry) => entry.name)).toContain('Somewhere new');
    expect(book.recents.map((entry) => entry.name)).not.toContain('Loyal old haunt');
  });
});

describe('expiry, promotion and clearing', () => {
  it('drops a recent ninety days after its last trip, and keeps one used since', () => {
    const book: PlaceBook = {
      saved: [],
      recents: [
        { ...place('Old'), id: 'old', lastUsedMs: NOW - 91 * DAY, trips: 1 },
        { ...place('Fresh', 39.4), id: 'fresh', lastUsedMs: NOW - 89 * DAY, trips: 1 },
      ],
    };
    expect(expireRecents(book, NOW).recents.map((entry) => entry.id)).toEqual(['fresh']);
  });

  it('never expires anything when the setting is never', () => {
    const book: PlaceBook = {
      saved: [],
      recents: [{ ...place('Ancient'), id: 'ancient', lastUsedMs: 0, trips: 1 }],
    };
    expect(expireRecents(book, NOW, null).recents).toHaveLength(1);
  });

  it('takes a promoted recent OUT of recents, so it is never in both lists', () => {
    const book = rememberOnStart(EMPTY_BOOK, place('119th & Antioch'), NOW);
    const id = book.recents[0]?.id ?? '';
    const after = promoteToSaved(book, id, 'home');
    expect(after.recents).toHaveLength(0);
    expect(after.saved.map((entry) => entry.name)).toEqual(['119th & Antioch']);
  });

  it('replaces the old home rather than drawing two rows with the same badge', () => {
    const book: PlaceBook = {
      saved: [HOME],
      recents: [{ ...place('New house', 39.9), id: 'new', lastUsedMs: NOW, trips: 1 }],
    };
    const after = promoteToSaved(book, 'new', 'home');
    expect(after.saved.filter((entry) => entry.kind === 'home')).toHaveLength(1);
    expect(after.saved[0]?.name).toBe('New house');
  });

  it('forgets one place on a long press and leaves the rest alone', () => {
    const book = withTrips(3);
    const id = book.recents[1]?.id ?? '';
    expect(forgetRecent(book, id).recents).toHaveLength(2);
    expect(forgetRecent(book, id).recents.map((entry) => entry.id)).not.toContain(id);
  });

  it('clears the recents list from Settings and KEEPS the saved places', () => {
    const book: PlaceBook = { ...withTrips(3), saved: [HOME, WORK] };
    const after = forgetAllRecents(book);
    expect(after.recents).toHaveLength(0);
    expect(after.saved).toHaveLength(2);
  });

  it('takes saved places WITH the wipe, because a wipe that leaves two coordinates is a false promise', () => {
    expect(wiped()).toEqual(EMPTY_BOOK);
    expect(isFirstRun(wiped())).toBe(true);
  });
});
