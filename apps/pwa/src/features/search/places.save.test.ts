/**
 * SET HOME / SET WORK from a place that has never been driven to.
 */

import { describe, expect, it } from 'vitest';

import { EMPTY_BOOK, saveAsKind } from './places.ts';
import type { PlaceBook } from './places.ts';

const HOME = { name: '119th & Antioch', detail: 'Overland Park, KS', lat: 38.912, lon: -94.681 };
const OFFICE = { name: 'Sprint Campus', detail: 'Overland Park, KS', lat: 38.93, lon: -94.72 };

describe('saving a typed place', () => {
  it('writes a saved place of that kind into an empty book', () => {
    const book = saveAsKind(EMPTY_BOOK, HOME, 'home');
    expect(book.saved).toHaveLength(1);
    expect(book.saved[0]).toMatchObject({ kind: 'home', name: HOME.name, lat: HOME.lat, lon: HOME.lon });
    expect(book.recents).toEqual([]);
  });

  it('keeps one home and one work, replacing rather than doubling', () => {
    const first = saveAsKind(EMPTY_BOOK, HOME, 'home');
    const second = saveAsKind(first, OFFICE, 'home');
    expect(second.saved.map((place) => place.name)).toEqual([OFFICE.name]);
  });

  it('leaves a starred place alone and lifts the same place out of the recents', () => {
    const book: PlaceBook = {
      saved: [{ id: 'star', kind: 'other', name: "Mom's place", detail: '', lat: 39, lon: -95 }],
      recents: [{ id: 'sprint campus@38.93000,-94.72000', ...OFFICE, lastUsedMs: 1, trips: 2 }],
    };
    const next = saveAsKind(book, OFFICE, 'work');
    expect(next.saved.map((place) => place.kind)).toEqual(['other', 'work']);
    expect(next.recents).toEqual([]);
  });
});
