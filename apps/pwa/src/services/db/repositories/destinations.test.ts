/**
 * THE DESTINATION BOOK'S ROW.
 *
 * The eight rules of section C are proved in `features/search/places.test.ts`,
 * against the pure functions that hold them. Nothing here re-proves one. What
 * this file is for is the two things that only exist once the book is on disk:
 * that a row survives a round trip unchanged, and that a row which has been
 * through a browser upgrade, a profile sync or a devtools edit cannot take the
 * panel down with it.
 *
 * And one promise that is only true if this file's `clear()` is right: section
 * C's "Nothing, by design. Saved places are user-entered data and go with the
 * wipe." A repository that cleared the recents and kept the saved ones would
 * pass every rule test in the other file and still break the promise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PlaceBook } from '../../../features/search/places.ts';
import { EMPTY_BOOK } from '../../../features/search/places.ts';
import { closeFwmDb, openFwmDb } from '../index.ts';
import { DESTINATION_BOOK_KEY } from '../schema.ts';
import type { MemoryIndexedDB } from '../testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../testing/memory-idb.ts';
import { createDestinationsRepository, isPlaceBook } from './destinations.ts';
import type { FwmDatabase } from './support.ts';

let memory: MemoryIndexedDB;
let counter = 0;

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

async function freshDb(): Promise<FwmDatabase> {
  return openFwmDb({ name: `fwm-destinations-${String(++counter)}` });
}

const BOOK: PlaceBook = {
  saved: [
    { id: 'home', kind: 'home', name: 'Home', detail: 'Waldo', lat: 38.9822, lon: -94.5919 },
    { id: 'work', kind: 'work', name: 'Work', detail: 'Crossroads', lat: 39.0913, lon: -94.5822 },
  ],
  recents: [
    {
      id: 'mall',
      name: 'Oak Park Mall',
      detail: 'Overland Park',
      lat: 38.9605,
      lon: -94.6708,
      lastUsedMs: 1_700_000_000_000,
      trips: 3,
    },
  ],
};

/** Write whatever the caller likes into the row, past the repository's types. */
async function putRaw(db: FwmDatabase, book: unknown): Promise<void> {
  await db.put('destinations', {
    key: DESTINATION_BOOK_KEY,
    book,
    updatedAt: 1,
  } as never);
}

describe('the row', () => {
  it('gives back exactly the book that was written', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);

    await repo.write(BOOK);

    // Deep-equal rather than identity: the row went through IndexedDB's
    // structured clone, so a pass here is a statement about the DATA surviving
    // and not about a reference being handed back.
    expect(await repo.read()).toEqual(BOOK);
    closeFwmDb(db);
  });

  it('reads an absent row as the empty book, which is the first-run state', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);

    // Not undefined, not a throw. The panel's answer to "no book" is the
    // first-run card, and that card is drawn from an empty book.
    expect(await repo.read()).toEqual(EMPTY_BOOK);
    closeFwmDb(db);
  });

  it('replaces the book rather than merging into it', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);

    await repo.write(BOOK);
    await repo.write(EMPTY_BOOK);

    // A merge would keep the saved places through `forgetAllRecents`, which is
    // right, and through a wipe, which is not - and the repository cannot tell
    // those two apart. So it never merges: the caller applies the rule.
    expect(await repo.read()).toEqual(EMPTY_BOOK);
    closeFwmDb(db);
  });
});

describe('a row that is not a book', () => {
  it('reads as empty rather than throwing, whatever is in it', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);

    for (const junk of [null, 42, 'a book', [], { saved: [] }, { recents: [] }]) {
      await putRaw(db, junk);
      expect(await repo.read()).toEqual(EMPTY_BOOK);
    }
    closeFwmDb(db);
  });

  it('rejects a recent whose lastUsedMs is not a number, because eviction sorts on it', async () => {
    // A NaN or a string there makes every comparison in the eviction sort
    // false, which silently leaves the list in insertion order and evicts a
    // place that is not the oldest. A row that cannot be compared cannot be
    // trusted to be the ninth.
    expect(
      isPlaceBook({
        saved: [],
        recents: [{ id: 'a', name: 'A', detail: '', lat: 1, lon: 2, lastUsedMs: NaN, trips: 1 }],
      }),
    ).toBe(false);
    expect(
      isPlaceBook({
        saved: [],
        recents: [{ id: 'a', name: 'A', detail: '', lat: 1, lon: 2, lastUsedMs: '3', trips: 1 }],
      }),
    ).toBe(false);
  });

  it('rejects a saved place whose kind is not one of the three', async () => {
    // An unknown kind sorts into no group and draws no badge: a place that
    // exists and cannot be seen.
    expect(
      isPlaceBook({
        saved: [{ id: 'a', kind: 'castle', name: 'A', detail: '', lat: 1, lon: 2 }],
        recents: [],
      }),
    ).toBe(false);
  });

  it('accepts the empty book', () => {
    expect(isPlaceBook(EMPTY_BOOK)).toBe(true);
  });
});

describe('clearing, which is the half of the wipe promise this file owns', () => {
  it('takes the saved places as well as the recents', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);
    await repo.write(BOOK);

    await repo.clear();

    // Section C: "Nothing, by design." Both lists, or the promise is false.
    expect(await repo.read()).toEqual(EMPTY_BOOK);
    expect(await db.get('destinations', DESTINATION_BOOK_KEY)).toBeUndefined();
    closeFwmDb(db);
  });

  it('reports PLACES and not rows, counted before the delete', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);
    await repo.write(BOOK);

    // The whole book is one row, so "1 removed" would be true and useless.
    // What the user can check against the panel they just closed is 2 and 1.
    expect(await repo.clear()).toEqual({ saved: 2, recents: 1 });
    closeFwmDb(db);
  });

  it('reports zeroes on an already-empty device rather than throwing', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);

    // The wipe path is idempotent by contract; pressing it twice must not fail.
    expect(await repo.clear()).toEqual({ saved: 0, recents: 0 });
    expect(await repo.clear()).toEqual({ saved: 0, recents: 0 });
    closeFwmDb(db);
  });

  it('counts nothing from a corrupt row, rather than guessing what was in it', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);
    await putRaw(db, { saved: 'three', recents: 'nine' });

    // The row still goes. The RECEIPT says zero, because a number invented for
    // a row nobody could read is worse than an honest zero next to a delete
    // that definitely happened.
    expect(await repo.clear()).toEqual({ saved: 0, recents: 0 });
    expect(await db.get('destinations', DESTINATION_BOOK_KEY)).toBeUndefined();
    closeFwmDb(db);
  });
});

describe('counts, for the two numbers SETTINGS prints', () => {
  it('answers zero and zero for a device with no book', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);
    expect(await repo.counts()).toEqual({ saved: 0, recents: 0 });
    closeFwmDb(db);
  });

  it('splits the two lists, because the settings rows print them separately', async () => {
    const db = await freshDb();
    const repo = createDestinationsRepository(db);
    await repo.write(BOOK);
    expect(await repo.counts()).toEqual({ saved: 2, recents: 1 });
    closeFwmDb(db);
  });
});
