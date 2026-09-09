/**
 * DESTINATION HISTORY, END TO END - section C's rules as the app runs them.
 *
 * `features/search/places.test.ts` proves each rule against the pure function
 * that holds it, and `services/db/repositories/destinations.test.ts` proves the
 * row survives a trip to disk and back. Neither of those can catch the failure
 * this file is for: a rule that is correct and is never reached, or is reached
 * at the wrong moment, or is reached and not written down.
 *
 * So every test here goes through the store, with a port standing in for the
 * database, and asserts BOTH halves - what the panel would draw, and what
 * landed on disk. A store that published the right book and wrote nothing looks
 * perfect until the next cold start.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { EMPTY_BOOK, RECENTS_KEPT } from '../features/search/places.ts';
import type { PlaceBook } from '../features/search/places.ts';
import {
  destinationsActions,
  setDestinationsPort,
  useDestinationsStore,
} from './destinations.ts';
import type { DestinationsPort } from './destinations.ts';
import { useSettingsStore } from './settings.ts';

const DAY = 86_400_000;
/**
 * Anchored to the real clock, not to a fixed epoch.
 *
 * `hydrate()` sweeps against `Date.now()` and the default window is ninety
 * days, so a fixture pinned to a literal timestamp would age out of the book
 * the moment the literal was more than three months old - a test that passed
 * on the day it was written and failed silently, for a reason having nothing to
 * do with what it asserts.
 */
const NOW = Date.now();

/** A port over a plain object, so a rule failing fails for its own reason. */
function memoryPort(initial: PlaceBook = EMPTY_BOOK): DestinationsPort & { book: PlaceBook; writes: number } {
  const port = {
    book: initial,
    writes: 0,
    read: () => Promise.resolve(port.book),
    write: (book: PlaceBook) => {
      port.book = book;
      port.writes += 1;
      return Promise.resolve();
    },
    clear: () => Promise.resolve({ saved: port.book.saved.length, recents: port.book.recents.length }),
  };
  return port;
}

function place(name: string, lat = 39, lon = -94) {
  return { name, detail: 'Kansas City', lat, lon };
}

function recent(name: string, lastUsedMs: number, trips = 1) {
  return { id: name, name, detail: '', lat: 39, lon: -94, lastUsedMs, trips };
}

beforeEach(() => {
  destinationsActions.reset();
  useSettingsStore.getState().reset();
  useSettingsStore.getState().markHydrated();
  setDestinationsPort(memoryPort());
});

describe('WHEN IT IS WRITTEN - on route start, not on search and not on tap', () => {
  it('has exactly one function that adds a place, and it is named for the moment', () => {
    // Not a behavioural assertion - a structural one. Section C's promise that
    // "a destination you looked at and abandoned leaves no trace" survives only
    // as long as there is one writer, so this fails the day a second appears.
    const adders = Object.keys(destinationsActions).filter((name) =>
      /^(remember|add|record|save)/.test(name),
    );
    expect(adders).toEqual(['rememberRouteStart', 'savePlace']);
    // `savePlace` promotes something already in the book; it adds no place the
    // user did not already drive to.
  });

  it('writes the destination through to storage when a route starts', async () => {
    const port = memoryPort();
    setDestinationsPort(port);

    await destinationsActions.rememberRouteStart(place('Oak Park Mall'), NOW);

    expect(useDestinationsStore.getState().book.recents).toHaveLength(1);
    expect(port.book.recents[0]?.name).toBe('Oak Park Mall');
  });

  it('writes nothing at all when Remember places is off', async () => {
    const port = memoryPort();
    setDestinationsPort(port);
    useSettingsStore.getState().setRememberPlaces(false);

    await destinationsActions.rememberRouteStart(place('Oak Park Mall'), NOW);

    // The gate is in the store and not at the call site, so a caller who has
    // never heard of the switch still obeys it.
    expect(useDestinationsStore.getState().book).toEqual(EMPTY_BOOK);
    expect(port.writes).toBe(0);
  });

  it('turning Remember places off keeps what is already there', async () => {
    const port = memoryPort();
    setDestinationsPort(port);
    await destinationsActions.rememberRouteStart(place('Oak Park Mall'), NOW);

    useSettingsStore.getState().setRememberPlaces(false);

    // A switch that shredded nine places would be a wipe wearing a toggle's
    // clothes. `Forget all recent places` is the control that deletes.
    expect(useDestinationsStore.getState().book.recents).toHaveLength(1);
    expect(port.book.recents).toHaveLength(1);
  });

  it('does not touch storage for a second visit that changes nothing about the book', async () => {
    const port = memoryPort({
      saved: [{ id: 'home', kind: 'home', name: 'Home', detail: '', lat: 39, lon: -94 }],
      recents: [],
    });
    setDestinationsPort(port);
    await destinationsActions.hydrate();

    await destinationsActions.rememberRouteStart(place('Home'), NOW);

    // Driving to a SAVED place does not add a recent - section C: never in
    // both - and a rule that returns the same book must not produce a write.
    expect(port.writes).toBe(0);
    expect(useDestinationsStore.getState().book.recents).toHaveLength(0);
  });
});

describe('HOW MANY - nine, and the tenth trip evicts the oldest BY LAST-USED', () => {
  it('keeps nine after ten different places', async () => {
    const port = memoryPort();
    setDestinationsPort(port);

    for (let i = 0; i < 10; i++) {
      await destinationsActions.rememberRouteStart(place(`Place ${String(i)}`, 39 + i), NOW + i);
    }

    expect(useDestinationsStore.getState().book.recents).toHaveLength(RECENTS_KEPT);
    expect(port.book.recents).toHaveLength(RECENTS_KEPT);
  });

  it('evicts the least recently used, NOT the least visited', async () => {
    // The trap this rule exists to avoid: a place somebody went to eleven times
    // two years ago outranking the one they drove to twice this week. Sorting
    // by trips answers "where do you go"; section C wants "where are you going".
    const stale = recent('Stale', NOW - 400 * DAY, 40);
    const port = memoryPort({
      saved: [],
      recents: [stale, ...Array.from({ length: 8 }, (_, i) => recent(`Fresh ${String(i)}`, NOW - i))],
    });
    setDestinationsPort(port);
    await destinationsActions.hydrate();

    await destinationsActions.rememberRouteStart(place('Tenth', 40), NOW + 1);

    const names = port.book.recents.map((r) => r.name);
    expect(names).toHaveLength(RECENTS_KEPT);
    expect(names).not.toContain('Stale');
    expect(names).toContain('Tenth');
  });

  it('a second trip to the same place moves it up and counts it, without adding a row', async () => {
    const port = memoryPort();
    setDestinationsPort(port);

    await destinationsActions.rememberRouteStart(place('Oak Park Mall'), NOW);
    await destinationsActions.rememberRouteStart(place('Oak Park Mall'), NOW + DAY);

    expect(port.book.recents).toHaveLength(1);
    expect(port.book.recents[0]?.trips).toBe(2);
    expect(port.book.recents[0]?.lastUsedMs).toBe(NOW + DAY);
  });
});

describe('ORDER - saved first in a fixed order, then recents newest-first', () => {
  it('draws saved places above recents, never interleaved', () => {
    useDestinationsStore.setState({
      book: {
        saved: [
          { id: 'star', kind: 'other', name: "Mom's", detail: '', lat: 39, lon: -94 },
          { id: 'home', kind: 'home', name: 'Home', detail: '', lat: 39, lon: -94 },
        ],
        recents: [recent('Older', NOW - DAY), recent('Newer', NOW)],
      },
      hydrated: true,
    });

    const state = useDestinationsStore.getState();
    // Ordering is the store's job so a second surface - the landscape column,
    // a watch face - cannot draw the list differently by accident.
    expect(state.book.saved.map((p) => p.name)).toEqual(["Mom's", 'Home']);
  });
});

describe('EXPIRY - ninety days since last use, then deleted', () => {
  it('sweeps aged-out recents on hydrate and persists the shortened list', async () => {
    const port = memoryPort({
      saved: [],
      recents: [recent('Old', Date.now() - 120 * DAY), recent('Recent', Date.now() - DAY)],
    });
    setDestinationsPort(port);

    await destinationsActions.hydrate();

    // Both halves. Hiding an expired row is not what section C promises; it
    // promises the row is DELETED.
    expect(useDestinationsStore.getState().book.recents.map((r) => r.name)).toEqual(['Recent']);
    expect(port.book.recents.map((r) => r.name)).toEqual(['Recent']);
  });

  it('deletes nothing when the window is never', async () => {
    useSettingsStore.getState().setKeepPlacesDays(null);
    const port = memoryPort({ saved: [], recents: [recent('Ancient', Date.now() - 900 * DAY)] });
    setDestinationsPort(port);

    await destinationsActions.hydrate();

    // `null` is a choice, not a missing value. Somebody who drives the same six
    // places forever should not lose them to a timer.
    expect(port.book.recents).toHaveLength(1);
    expect(port.writes).toBe(0);
  });

  it('honours a shortened window', async () => {
    useSettingsStore.getState().setKeepPlacesDays(30);
    const port = memoryPort({
      saved: [],
      recents: [recent('Six weeks', Date.now() - 42 * DAY), recent('Yesterday', Date.now() - DAY)],
    });
    setDestinationsPort(port);

    await destinationsActions.hydrate();

    expect(port.book.recents.map((r) => r.name)).toEqual(['Yesterday']);
  });

  it('never sweeps saved places, however old the book is', async () => {
    useSettingsStore.getState().setKeepPlacesDays(30);
    const port = memoryPort({
      saved: [{ id: 'home', kind: 'home', name: 'Home', detail: '', lat: 39, lon: -94 }],
      recents: [recent('Gone', Date.now() - 900 * DAY)],
    });
    setDestinationsPort(port);

    await destinationsActions.hydrate();

    // Saved places have no last-used at all, which is the structural reason
    // they cannot expire - and the reason the record has no field for it.
    expect(port.book.saved).toHaveLength(1);
    expect(port.book.recents).toHaveLength(0);
  });

  it('REFUSES TO DELETE while the settings blob is still in flight', async () => {
    // The sweep is the only destructive thing that happens on a cold start, and
    // the window it deletes against is a stored preference whose four values
    // include `never`. Sweeping at the ninety-day default while somebody's
    // `never` was still being read off disk would destroy exactly the rows that
    // setting exists to keep. `bootStores()` orders the two; this is the guard
    // for the day somebody reorders them.
    useSettingsStore.setState({ hydrated: false });
    const port = memoryPort({ saved: [], recents: [recent('Ancient', Date.now() - 900 * DAY)] });
    setDestinationsPort(port);

    await destinationsActions.hydrate();

    expect(port.book.recents).toHaveLength(1);
    expect(port.writes).toBe(0);
    // The aged row is still not DRAWN - the sweep applies to what is published
    // either way. What the gate protects is the delete.
    expect(useDestinationsStore.getState().book.recents).toHaveLength(0);
  });
});

describe('PROMOTION - a recent that becomes saved leaves the recents list', () => {
  it('is in exactly one list afterwards, never both', async () => {
    const port = memoryPort({ saved: [], recents: [recent('Oak Park Mall', NOW)] });
    setDestinationsPort(port);
    await destinationsActions.hydrate();

    await destinationsActions.savePlace('Oak Park Mall', 'other');

    expect(port.book.saved.map((p) => p.name)).toEqual(['Oak Park Mall']);
    expect(port.book.recents).toHaveLength(0);
  });

  it('lands the move as ONE write, so no reader can observe it in both lists', async () => {
    const port = memoryPort({ saved: [], recents: [recent('Oak Park Mall', NOW)] });
    setDestinationsPort(port);
    await destinationsActions.hydrate();
    const writesBefore = port.writes;

    await destinationsActions.savePlace('Oak Park Mall', 'home');

    // The whole reason the book is one row. Two rows would make "never in both"
    // a window between two writes rather than a property of one.
    expect(port.writes).toBe(writesBefore + 1);
  });
});

describe('CLEARING - long-press one, forget all recents, or wipe everything', () => {
  it('forgets one recent and leaves the rest', async () => {
    const port = memoryPort({
      saved: [],
      recents: [recent('Keep', NOW), recent('Drop', NOW - DAY)],
    });
    setDestinationsPort(port);
    await destinationsActions.hydrate();

    await destinationsActions.forgetPlace('Drop');

    expect(port.book.recents.map((r) => r.name)).toEqual(['Keep']);
  });

  it('forgets a SAVED place too, because section C says any row', async () => {
    const port = memoryPort({
      saved: [{ id: 'home', kind: 'home', name: 'Home', detail: '', lat: 39, lon: -94 }],
      recents: [],
    });
    setDestinationsPort(port);
    await destinationsActions.hydrate();

    await destinationsActions.forgetPlace('home');

    // "Long-press ANY row to forget that one place." A long-press that worked
    // on eight rows and silently did nothing on the ninth is the worst kind of
    // affordance: it teaches the wrong lesson about what the app will delete.
    expect(port.book.saved).toHaveLength(0);
  });

  it('writes nothing when the id is not in the book', async () => {
    const port = memoryPort({ saved: [], recents: [recent('Keep', NOW)] });
    setDestinationsPort(port);
    await destinationsActions.hydrate();
    // After the hydrate, which may legitimately have written a swept book.
    const writesBefore = port.writes;

    await destinationsActions.forgetPlace('never-existed');

    expect(port.writes).toBe(writesBefore);
  });

  it('Forget all recent places clears the recents and KEEPS saved', async () => {
    const port = memoryPort({
      saved: [{ id: 'home', kind: 'home', name: 'Home', detail: '', lat: 39, lon: -94 }],
      recents: [recent('A', NOW), recent('B', NOW - DAY)],
    });
    setDestinationsPort(port);
    await destinationsActions.hydrate();

    const forgotten = await destinationsActions.forgetAllRecentPlaces();

    // The distinction the group's note exists to make, and the one difference
    // between this control and the wipe two groups down.
    expect(forgotten).toBe(2);
    expect(port.book.recents).toHaveLength(0);
    expect(port.book.saved).toHaveLength(1);
  });

  it('drops the in-memory book after a wipe WITHOUT writing, because the row is already gone', async () => {
    const port = memoryPort({
      saved: [{ id: 'home', kind: 'home', name: 'Home', detail: '', lat: 39, lon: -94 }],
      recents: [recent('A', NOW)],
    });
    setDestinationsPort(port);
    await destinationsActions.hydrate();
    const writesBefore = port.writes;

    destinationsActions.forgotten();

    // `services/privacy/forget.ts` is the only legal wipe path and
    // `docs/plate-data-handling.md#removal` says the UI must call that and
    // nothing else. This is the in-memory half of a delete that already
    // happened; a write here would be a second removal path.
    expect(useDestinationsStore.getState().book).toEqual(EMPTY_BOOK);
    expect(port.writes).toBe(writesBefore);
  });

  it('keeps saying it knows the counts after a wipe, rather than falling back to a dash', async () => {
    setDestinationsPort(memoryPort({ saved: [], recents: [recent('A', NOW)] }));
    await destinationsActions.hydrate();

    destinationsActions.forgotten();

    // An empty book is a known state. Flipping `hydrated` back to false would
    // put both settings counts into their "still reading" dash immediately
    // after a wipe, reading as though the wipe had not finished.
    expect(useDestinationsStore.getState().hydrated).toBe(true);
  });
});

describe('WHERE IT LIVES - and what happens when it cannot', () => {
  it('reports itself as not durable and still works when there is no database', async () => {
    setDestinationsPort(null);

    await destinationsActions.hydrate();
    await destinationsActions.rememberRouteStart(place('Oak Park Mall'), NOW);

    // The panel forgets between sessions, which is what it did before this
    // store existed and is strictly better than a search field that will not
    // open. The settings group says so rather than promising durability.
    expect(useDestinationsStore.getState().hydrated).toBe(true);
    expect(useDestinationsStore.getState().durable).toBe(false);
    expect(useDestinationsStore.getState().book.recents).toHaveLength(1);
  });

  it('prints no count until the book has actually been read back', () => {
    // Every number this slice feeds SETTINGS is a dash while this is false. A
    // count rendered before the read is a confident zero, and "0 saved places"
    // shown to somebody who has three is the same lie as a fake `0 cams`.
    expect(useDestinationsStore.getState().hydrated).toBe(false);
    expect(useDestinationsStore.getState().book).toEqual(EMPTY_BOOK);
  });
});

describe('WHAT IS STORED - four fields, and no fifth', () => {
  it('records nothing about the route, the time of day or the duration', async () => {
    const port = memoryPort();
    setDestinationsPort(port);

    await destinationsActions.rememberRouteStart(place('Oak Park Mall'), NOW);

    const stored = port.book.recents[0];
    expect(stored).toBeDefined();
    // Section C names four and forbids three by name. This asserts the WHOLE
    // key set rather than the absence of the three it happens to think of,
    // because the failure mode is a fifth field nobody predicted being added
    // for a good local reason.
    expect(Object.keys(stored ?? {}).sort()).toEqual([
      'detail',
      'id',
      'lastUsedMs',
      'lat',
      'lon',
      'name',
      'trips',
    ]);
  });
});
