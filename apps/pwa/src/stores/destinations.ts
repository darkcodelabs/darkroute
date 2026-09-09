/**
 * DESTINATION HISTORY - the places somebody actually drove to, kept on the
 * phone and nowhere else.
 *
 * Section C of `DarkRoute Search Entry.html`. It is the reason the search panel
 * can open to PLACES instead of to a cursor, which is why the spec writes its
 * rules out as a section of the design rather than leaving them to be a storage
 * detail.
 *
 * =============================================================================
 * THREE FILES, ONE FEATURE, AND NONE OF THEM DUPLICATES ANOTHER
 * =============================================================================
 *   `features/search/places.ts`            THE RULES. Pure functions over a
 *                                          `PlaceBook`: what a write does, what
 *                                          eviction keeps, what expiry drops,
 *                                          what promotion moves. Storage-free,
 *                                          so every rule can be checked by
 *                                          handing it a book.
 *   `services/db/repositories/destinations.ts`
 *                                          THE ROW. Reads one record, proves it
 *                                          is a book, writes one back. Holds no
 *                                          rule at all.
 *   this file                              THE WIRING. Holds the book in memory
 *                                          for the panel to draw, applies the
 *                                          rules from the first, and writes
 *                                          through the second.
 *
 * Nothing here re-implements a rule. If a behaviour in this file looks like a
 * decision, it is a bug: the decision belongs one file up.
 *
 * =============================================================================
 * WHY THIS SLICE PERSISTS WHEN `stores/route.ts` REFUSES TO
 * =============================================================================
 * Read that file's header first, because the two look like a contradiction and
 * are not. `route.ts` holds the destination of the drive HAPPENING NOW and the
 * line the router drew to it, and it says - correctly - that "where this car was
 * going, and when" is precisely the record an ALPR network is built to assemble.
 * It is memory-only and it must stay that way.
 *
 * This slice holds something different: the NAMES of places a person chose to
 * go back to. Not a track, not a route, not a time of day, not a duration -
 * section C forbids all four by name. An address book is not a movement log,
 * and the difference is not a technicality: a track says where a vehicle was at
 * a moment, and this says where a person keeps going. The second is still
 * sensitive, which is why it never leaves the device, expires by default, holds
 * nine rows, and goes completely on a wipe.
 *
 * A FUTURE CONTRIBUTOR WHO SPOTS THE APPARENT CLASH SHOULD CHANGE NEITHER FILE
 * until they have read both headers, because "fixing" it in the obvious
 * direction - persisting the live route - is the exact harm `route.ts` exists
 * to prevent.
 *
 * =============================================================================
 * WRITE-THROUGH, AND THE ONE MOMENT A WRITE IS LEGAL
 * =============================================================================
 * `rememberRouteStart` is the only function here that adds anything, and it is
 * named for the moment it may be called: the route STARTED. Not on search, not
 * on tap, not on a preview somebody backed out of. Section C calls a destination
 * you looked at and abandoned "the common privacy complaint about every other
 * navigation app", and the guard against becoming that app is that there is
 * exactly one writer and it is named after the event.
 *
 * Every mutation writes through to IndexedDB as it happens rather than being
 * flushed on an interval or on `beforeunload`, for `historyPersistence.ts`'s
 * reason: a driving app does not get a clean shutdown. The write is awaited
 * here, unlike the alert path's fire-and-forget, because it happens once per
 * trip rather than once per position fix and a `forget` that has not landed by
 * the time the user closes the app is a place they asked to delete and did not.
 */

import { create } from 'zustand';

import {
  EMPTY_BOOK,
  expireRecents,
  forgetAllRecents,
  forgetRecent,
  orderedRecents,
  orderedSaved,
  promoteToSaved,
  rememberOnStart,
  saveAsKind,
} from '../features/search/places.ts';
import type { PlaceBook, RecentPlace, SavedKind, SavedPlace } from '../features/search/places.ts';
import { openFwmDb } from '../services/db/index.ts';
import { createDestinationsRepository } from '../services/db/index.ts';
import type { DestinationsRepository } from '../services/db/index.ts';
import { useSettingsStore } from './settings.ts';

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * What this slice needs from storage, and nothing else.
 *
 * Declared as an interface rather than taken as `FwmDatabase` so a test can
 * drive every rule in this file against a plain object. `fake-indexeddb` is
 * available and the repository's own test uses it; this slice's tests are about
 * ORDER and GATING, and running them through a real database would make an
 * assertion about eviction fail for a reason that has nothing to do with
 * eviction.
 */
export type DestinationsPort = Pick<DestinationsRepository, 'read' | 'write' | 'clear'>;

let port: DestinationsPort | null = null;
let opening: Promise<DestinationsPort | null> | null = null;

/**
 * Open once, share the handle.
 *
 * Returns null rather than throwing when IndexedDB is unavailable - private
 * browsing, a storage-blocked context, a quota refusal. The panel works without
 * a durable book; it forgets between sessions, which is what it did before this
 * file existed and is strictly better than a search field that will not open.
 */
async function open(): Promise<DestinationsPort | null> {
  if (port !== null) return port;
  opening ??= (async () => {
    try {
      port = createDestinationsRepository(await openFwmDb());
      return port;
    } catch {
      return null;
    }
  })();
  return opening;
}

/** Test seam: run this slice against something that is not a database. */
export function setDestinationsPort(next: DestinationsPort | null): void {
  port = next;
  opening = next === null ? null : Promise.resolve(next);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface DestinationsState {
  /** Saved places and recents. `EMPTY_BOOK` is first-run, not an error. */
  readonly book: PlaceBook;
  /**
   * False until the row has been read back, or found absent, or found
   * unreadable.
   *
   * THE PANEL AND THE SETTINGS ROWS BOTH NEED THIS, and for the same reason the
   * camera counts need a dash: a count rendered before the read is a confident
   * zero, and "0 saved places" shown to somebody who has three is the same
   * class of lie as a fake `0 cams`. Nothing that prints a number from this
   * slice may print it while this is false.
   */
  readonly hydrated: boolean;
  /**
   * False when the book is RAM-only for this session - no IndexedDB, or the
   * open failed. The settings group says so rather than promising a durability
   * it does not have.
   */
  readonly durable: boolean;
}

export interface DestinationsActions {
  /**
   * Read the book back, sweep the expired recents, and publish it.
   *
   * MUST RUN AFTER THE SETTINGS SLICE HAS REHYDRATED. The sweep DELETES, and
   * the window it deletes against is a stored preference: sweeping with the
   * default while a user's `never` is still in flight would destroy the exact
   * rows that setting exists to protect. `bootStores()` orders the two, and
   * this refuses to sweep destructively if it is called early anyway.
   */
  hydrate(): Promise<boolean>;
  /**
   * A ROUTE STARTED. Write the destination down, once.
   *
   * Silently does nothing when `Remember places` is off - which is the whole
   * behaviour of that switch, and is checked HERE rather than at the call site
   * because a privacy gate a caller can forget is not a gate.
   */
  rememberRouteStart(
    place: { readonly name: string; readonly detail: string; readonly lat: number; readonly lon: number },
    atMs?: number,
  ): Promise<void>;
  /** Long-press a row to forget that one place. Saved or recent - see below. */
  forgetPlace(id: string): Promise<void>;
  /** `Forget all recent places`. Clears the recents, KEEPS saved. Returns how many went. */
  forgetAllRecentPlaces(): Promise<number>;
  /** A recent becomes a saved place, and leaves the recents list. */
  savePlace(id: string, kind: SavedKind): Promise<void>;
  /** Set home or work from a place that has never been driven to. */
  saveNewPlace(
    place: { readonly name: string; readonly detail: string; readonly lat: number; readonly lon: number },
    kind: SavedKind,
  ): Promise<void>;
  /**
   * The row has already been deleted by `clearLocalData()`; drop the mirror.
   *
   * Deliberately does NOT write. The wipe path is `services/privacy/forget.ts`
   * and `docs/plate-data-handling.md#removal` says the UI must call that and
   * nothing else, so this is the in-memory half of a deletion that has already
   * happened on disk - the same shape as `historyActions.reset()` after a wipe.
   */
  forgotten(): void;
  /** Back to initial, IN MEMORY ONLY. `resetAllStores()`'s contract. */
  reset(): void;
}

export type DestinationsStore = DestinationsState & DestinationsActions;

const INITIAL: DestinationsState = Object.freeze({
  book: EMPTY_BOOK,
  hydrated: false,
  durable: false,
});

export const useDestinationsStore = create<DestinationsStore>()((set, get) => {
  /**
   * Apply a rule to the current book, publish the result, and write it through.
   *
   * Every mutating action below is one line because of this: take the rule from
   * `places.ts`, hand it the book, keep what comes back. A rule that returns the
   * same book - `forgetRecent` for an id that is not there, `rememberOnStart`
   * for a place that is already saved - writes nothing, so a no-op press does
   * not touch the disk.
   */
  async function apply(rule: (book: PlaceBook) => PlaceBook): Promise<PlaceBook> {
    const before = get().book;
    const after = rule(before);
    if (after === before) return before;
    set({ book: after });
    const store = await open();
    if (store === null) {
      set({ durable: false });
      return after;
    }
    await store.write(after);
    return after;
  }

  return {
    ...INITIAL,

    async hydrate() {
      const store = await open();
      if (store === null) {
        set({ hydrated: true, durable: false });
        return false;
      }
      const stored = await store.read();
      const settings = useSettingsStore.getState();
      /*
       * THE SWEEP IS THE ONLY DESTRUCTIVE THING THAT HAPPENS ON A COLD START,
       * so it is gated twice.
       *
       * Once on the settings slice being hydrated, because the window is a
       * stored preference and `null` (never) is one of its four values -
       * sweeping at the ninety-day default while somebody's `never` was still
       * being read off disk would delete the rows that setting exists to keep.
       *
       * And once on the sweep having actually removed something, because a
       * write that changes nothing is a write nobody asked for.
       *
       * `expireRecents` is applied to what is PUBLISHED either way: an aged-out
       * row is not drawn and not matched even in the ungated case. What the gate
       * protects is the DELETE.
       */
      const swept = expireRecents(stored, Date.now(), settings.keepPlacesDays);
      set({ book: swept, hydrated: true, durable: true });
      if (settings.hydrated && swept !== stored) await store.write(swept);
      return true;
    },

    async rememberRouteStart(place, atMs) {
      // THE SWITCH, READ HERE. See the action's own doc comment.
      if (!useSettingsStore.getState().rememberPlaces) return;
      await apply((book) => rememberOnStart(book, place, atMs ?? Date.now()));
    },

    async forgetPlace(id) {
      /*
       * "LONG-PRESS ANY ROW TO FORGET THAT ONE PLACE" - section C, and ANY row
       * includes a saved one. `places.ts` publishes `forgetRecent` and has no
       * `forgetSaved`, so the saved half is composed here rather than left
       * undone, and the composition is the smallest thing that could be: filter
       * the saved list by id.
       *
       * GAP, and it should move: this is the one behaviour in this file that
       * is a rule rather than wiring, and rules belong in `places.ts`. It is
       * written here because that file was being edited in parallel and a
       * second author reaching into it mid-flight is how two half-rules end up
       * in one function. See gap record search-panel.
       */
      await apply((book) => {
        const recents = forgetRecent(book, id).recents;
        const saved = book.saved.filter((place) => place.id !== id);
        /*
         * THE ORIGINAL BOOK BACK WHEN NOTHING MATCHED, which `apply` reads as
         * "no write". `forgetRecent` builds a fresh object every time - it does
         * not short-circuit the way `expireRecents` does - so an identity check
         * on its result alone would put a disk write behind every long-press
         * that landed on nothing, including the ones a scroll caused.
         */
        if (recents.length === book.recents.length && saved.length === book.saved.length) {
          return book;
        }
        return { saved, recents };
      });
    },

    async forgetAllRecentPlaces() {
      const before = get().book.recents.length;
      await apply(forgetAllRecents);
      return before;
    },

    async savePlace(id, kind) {
      await apply((book) => promoteToSaved(book, id, kind));
    },
    async saveNewPlace(place, kind) {
      await apply((book) => saveAsKind(book, place, kind));
    },

    forgotten() {
      // `hydrated` STAYS TRUE. The book is empty because it was emptied, which
      // is a known state, and flipping this back to false would put the two
      // settings counts into their "still reading" dash immediately after a
      // wipe - reading as though the wipe had not finished.
      set({ book: EMPTY_BOOK });
    },

    reset() {
      set({ ...INITIAL });
    },
  };
});

// ---------------------------------------------------------------------------
// Selectors - what the panel and the settings group read
// ---------------------------------------------------------------------------

/** Both lists, unordered, for a caller that wants the whole book. */
export const useDestinationBook = (): PlaceBook => useDestinationsStore((state) => state.book);

/** False until the row has been read back. Nothing prints a count before this. */
export const useDestinationsHydrated = (): boolean =>
  useDestinationsStore((state) => state.hydrated);

/** False when the book is RAM-only for this session. */
export const useDestinationsDurable = (): boolean => useDestinationsStore((state) => state.durable);

/**
 * ORDER IS THE STORE'S JOB, NOT THE PANEL'S.
 *
 * Section C: "Saved places first in a fixed user order, then recents
 * newest-first." Both orderings come out of `places.ts`, so a second surface -
 * the landscape column, a future watch face - cannot draw the list in a
 * different order by accident.
 *
 * =============================================================================
 * THE ORDERINGS ARE CACHED PER BOOK, AND THEY HAVE TO BE
 * =============================================================================
 * `orderedSaved` and `orderedRecents` build a new array every call, and a
 * zustand selector that returns a fresh reference is never equal to its own
 * previous result - so the component re-renders, the selector runs again,
 * returns another fresh array, and React tears the tree down with "Maximum
 * update depth exceeded". That is not a hypothetical: it is what the first
 * draft of this file did, and it took the whole settings screen with it.
 *
 * A `WeakMap` keyed on the book itself is the fix, rather than `useMemo` in
 * every caller. The book is immutable - every rule in `places.ts` returns a new
 * one - so the identity of the book IS the cache key, and there is no
 * invalidation to get wrong. It is a `WeakMap` so a superseded book and its two
 * sorted copies are collected together. No `react` import in a store file,
 * which is this directory's rule, and no caller can forget to memoise.
 */
const SAVED_ORDER = new WeakMap<PlaceBook, readonly SavedPlace[]>();
const RECENT_ORDER = new WeakMap<PlaceBook, readonly RecentPlace[]>();

function savedOf(book: PlaceBook): readonly SavedPlace[] {
  const cached = SAVED_ORDER.get(book);
  if (cached !== undefined) return cached;
  const ordered = orderedSaved(book);
  SAVED_ORDER.set(book, ordered);
  return ordered;
}

function recentsOf(book: PlaceBook): readonly RecentPlace[] {
  const cached = RECENT_ORDER.get(book);
  if (cached !== undefined) return cached;
  const ordered = orderedRecents(book);
  RECENT_ORDER.set(book, ordered);
  return ordered;
}

export const useSavedPlaces = (): readonly SavedPlace[] =>
  useDestinationsStore((state) => savedOf(state.book));

export const useRecentPlaces = (): readonly RecentPlace[] =>
  useDestinationsStore((state) => recentsOf(state.book));

// ---------------------------------------------------------------------------
// Actions, for callers that are not components
// ---------------------------------------------------------------------------

export const destinationsActions = {
  hydrate: (): Promise<boolean> => useDestinationsStore.getState().hydrate(),
  rememberRouteStart: (
    place: { readonly name: string; readonly detail: string; readonly lat: number; readonly lon: number },
    atMs?: number,
  ): Promise<void> => useDestinationsStore.getState().rememberRouteStart(place, atMs),
  forgetPlace: (id: string): Promise<void> => useDestinationsStore.getState().forgetPlace(id),
  forgetAllRecentPlaces: (): Promise<number> =>
    useDestinationsStore.getState().forgetAllRecentPlaces(),
  savePlace: (id: string, kind: SavedKind): Promise<void> =>
    useDestinationsStore.getState().savePlace(id, kind),
  saveNewPlace: (
    place: { readonly name: string; readonly detail: string; readonly lat: number; readonly lon: number },
    kind: SavedKind,
  ): Promise<void> => useDestinationsStore.getState().saveNewPlace(place, kind),
  forgotten: (): void => {
    useDestinationsStore.getState().forgotten();
  },
  reset: (): void => {
    useDestinationsStore.getState().reset();
  },
};

export type { PlaceBook, RecentPlace, SavedKind, SavedPlace };
