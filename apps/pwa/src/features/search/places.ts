/**
 * DESTINATION HISTORY -- section C of `DarkRoute Search Entry.html`.
 *
 * The places a person has actually driven to, and the two or three they have
 * named. It is what the search panel opens to, and section C is eight rules
 * about it rather than a data structure, so this file is those eight rules and
 * nothing else.
 *
 * =============================================================================
 * WHY IT IS PURE, AND WHY IT IS NOT A STORE
 * =============================================================================
 * Every function here takes a book and returns a new one. Eviction, expiry,
 * promotion and the write-on-route-start rule are the parts that can be WRONG,
 * and a rule is checked by feeding it a book and asserting the book that comes
 * back -- which needs it to be a function. `stores/` and the panel hold the
 * result; nothing here reads or writes anything.
 *
 * =============================================================================
 * THE PRIVACY SHAPE, WHICH IS THE REASON MOST OF THIS EXISTS
 * =============================================================================
 * `stores/history.ts` says it in as many words: A COORDINATE HISTORY IS A
 * MOVEMENT HISTORY. That file therefore holds no latitude at all. This one
 * has to -- you cannot route to a place you cannot locate -- so it carries the
 * narrowest record that still answers "take me back there", and section C
 * names the four fields exactly:
 *
 *   name, coordinates, the timestamp of the LAST trip, and a trip COUNT.
 *
 * NOT the route taken. NOT the time of day. NOT how long you stayed. A list of
 * (place, when, how often) is a list of destinations; add the route and the
 * dwell and it becomes a pattern of life, which is the record an ALPR network
 * is assembled to build and the thing this application is against.
 *
 * WRITTEN ON ROUTE START, NOT ON SEARCH AND NOT ON TAP. {@link rememberOnStart}
 * is the only function in this file that adds anything, it is named for the
 * moment it is legal to call it, and the panel calls it from the ROUTING
 * transition and nowhere else. A destination somebody looked at and abandoned
 * leaves no trace -- section C calls that "the common privacy complaint about
 * every other navigation app", and it is the one behaviour here that a user
 * cannot verify for themselves, so it is guarded by a test rather than by a
 * comment.
 *
 * AND IT ALL GOES ON A WIPE. {@link wiped} returns an EMPTY book, saved places
 * included. Section C: "Nothing, by design. Saved places are user-entered data
 * and go with the wipe -- if the wipe left anything behind, the promise would
 * be false."
 *
 * PERSISTED, AS OF THE DESTINATION-HISTORY BRIEF. The book is one row in the
 * `destinations` object store, written through by `stores/destinations.ts` and
 * read back by `services/db/repositories/destinations.ts`. It goes with
 * `clearLocalData()`, saved places included, and `features/settings/storage.ts`
 * lists it as `removed` so the "what this device is holding" screen says so out
 * loud. Nothing in THIS file changed to make that work, which was the point of
 * it being pure: the rules are the same rules, and the store applies them.
 *
 * The two rules the store had to reach past this file for are recorded as gaps
 * rather than as edits made by a second author mid-flight - see
 * docs/gaps-inbox/search-panel.md.
 */

/** What a saved place is FOR. The badge, and the fixed order, both read this. */
export type SavedKind = 'home' | 'work' | 'other';

/**
 * A place the user named. Never expires, never evicted, always above recents.
 */
export interface SavedPlace {
  /** Stable across renames, so the badge and the row keep their identity. */
  readonly id: string;
  readonly kind: SavedKind;
  readonly name: string;
  /** The line under the name. A locality, a street, or ''. */
  readonly detail: string;
  readonly lat: number;
  readonly lon: number;
}

/** Somewhere a route actually ran to. Section C's four fields, and no fifth. */
export interface RecentPlace {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly lat: number;
  readonly lon: number;
  /** When the LAST trip there started. Eviction and expiry both read this. */
  readonly lastUsedMs: number;
  /** How many trips. Shown in the sub-line; it decides nothing. */
  readonly trips: number;
}

/** Both lists together, because every rule in section C is about the pair. */
export interface PlaceBook {
  readonly saved: readonly SavedPlace[];
  readonly recents: readonly RecentPlace[];
}

/** A book with nothing in it -- the first-run state, and the state after a wipe. */
export const EMPTY_BOOK: PlaceBook = { saved: [], recents: [] };

/**
 * NINE. F. GEOMETRY publishes "recents shown 9" and section C publishes "Nine
 * recents in the list, all of them searchable. The tenth trip evicts the oldest
 * by last-used, not by trip count."
 *
 * ONE NUMBER, NOT TWO. The list shows nine and the book keeps nine, so there is
 * no tenth recent held back that a query could surface and a scroll could not.
 * "All of them searchable" is true because there are no others.
 */
export const RECENTS_KEPT = 9;

/**
 * NINETY DAYS SINCE LAST USE, and the four settings section C offers.
 *
 * `null` is "never", which is a real choice and not a missing value -- a person
 * who drives the same six places forever should not lose them to a timer.
 */
export const EXPIRY_DAYS_DEFAULT = 90;
export const EXPIRY_DAYS_CHOICES: readonly (number | null)[] = [30, 90, 365, null];

const MS_PER_DAY = 86_400_000;

/**
 * TWO PLACES ARE THE SAME PLACE WHEN THEY ARE THE SAME PLACE.
 *
 * Coordinates to five decimals -- about a metre -- and the name folded to
 * lower case. Not the geocoder's id, because the same destination reaches this
 * file three ways: off the geocoder, off a saved place, and off a pin dropped
 * on the map, and only two of those have an id. Keying on what they all carry
 * is what stops "Home" arriving from a pin and appearing twice.
 *
 * A metre rather than an exact match, because a pin dropped on a driveway and
 * the geocoder's answer for the same house differ in the seventh decimal.
 */
export function placeKey(place: {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}): string {
  return `${place.name.trim().toLowerCase()}@${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
}

/**
 * THE FIXED ORDER SAVED PLACES ARE DRAWN IN.
 *
 * Section A draws H, then W, then the star, and section C says "saved places
 * first in a FIXED USER ORDER". Both are true here: the kind decides the group
 * and the user's own array order decides everything inside it, so a person with
 * four starred places sees them in the order they added them and Home is still
 * the first row of the panel.
 */
const KIND_RANK: Readonly<Record<SavedKind, number>> = { home: 0, work: 1, other: 2 };

/** Saved places in the order the panel draws them. */
export function orderedSaved(book: PlaceBook): readonly SavedPlace[] {
  return book.saved
    .map((place, index) => ({ place, index }))
    .sort((a, b) => {
      const byKind = KIND_RANK[a.place.kind] - KIND_RANK[b.place.kind];
      return byKind === 0 ? a.index - b.index : byKind;
    })
    .map((entry) => entry.place);
}

/** Recents newest-first, which is the only order they are ever drawn in. */
export function orderedRecents(book: PlaceBook): readonly RecentPlace[] {
  return [...book.recents].sort((a, b) => b.lastUsedMs - a.lastUsedMs);
}

/** True when the book has never held anything -- the first-run test. */
export function isFirstRun(book: PlaceBook): boolean {
  return book.saved.length === 0 && book.recents.length === 0;
}

/**
 * A ROUTE STARTED. Write the destination down, once.
 *
 * THE ONLY FUNCTION IN THIS FILE THAT ADDS ANYTHING, and it is named for the
 * moment it is allowed to run. Searching writes nothing. Tapping a row writes
 * nothing. Looking at three route options and closing the panel writes nothing.
 *
 * ALREADY SAVED IS ALREADY REMEMBERED. Driving home does not put Home in the
 * recents list: section C is explicit that a place is never in both, and the
 * saved row is the one that survives.
 *
 * ONCE PER PLACE, NOT ONCE PER TRIP. A second trip to the same place moves it
 * to the top and increments the count; it does not add a row.
 */
export function rememberOnStart(
  book: PlaceBook,
  place: { readonly name: string; readonly detail: string; readonly lat: number; readonly lon: number },
  atMs: number,
): PlaceBook {
  const key = placeKey(place);
  if (book.saved.some((saved) => placeKey(saved) === key)) return book;

  const previous = book.recents.find((recent) => placeKey(recent) === key);
  const entry: RecentPlace = {
    id: previous?.id ?? key,
    name: place.name,
    detail: place.detail,
    lat: place.lat,
    lon: place.lon,
    lastUsedMs: atMs,
    trips: (previous?.trips ?? 0) + 1,
  };

  const rest = book.recents.filter((recent) => placeKey(recent) !== key);
  /*
   * EVICTION IS BY LAST-USED, NOT BY TRIP COUNT, and section C says so in
   * those words. Sorting by trips would pin a place somebody went to eleven
   * times two years ago above the one they have driven to twice this week, so
   * the list would answer "where do you go" rather than "where are you going".
   */
  const kept = [entry, ...rest].sort((a, b) => b.lastUsedMs - a.lastUsedMs).slice(0, RECENTS_KEPT);
  return { saved: book.saved, recents: kept };
}

/** Long-press a row to forget that one place. Saved places are untouched. */
export function forgetRecent(book: PlaceBook, id: string): PlaceBook {
  return { saved: book.saved, recents: book.recents.filter((recent) => recent.id !== id) };
}

/** "Forget all recent places" in Settings. Clears the list, KEEPS saved. */
export function forgetAllRecents(book: PlaceBook): PlaceBook {
  return { saved: book.saved, recents: [] };
}

/**
 * "Wipe everything on this phone" -- and saved places go with it.
 *
 * The obvious kindness is to keep Home and Work through a wipe. Section C
 * refuses it, and the reason is the whole of the promise: a wipe that leaves
 * two coordinates behind is a wipe that did not happen, and the person pressing
 * it has no way to find that out.
 */
export function wiped(): PlaceBook {
  return EMPTY_BOOK;
}

/**
 * Drop recents last used longer ago than the window. `null` never expires.
 *
 * Applied on read rather than on a timer: there is no background task in this
 * application and a nightly sweep would be one. A row that has aged out is not
 * drawn and not matched, and the write that follows the next trip persists the
 * shortened list.
 */
export function expireRecents(
  book: PlaceBook,
  nowMs: number,
  days: number | null = EXPIRY_DAYS_DEFAULT,
): PlaceBook {
  if (days === null) return book;
  const floor = nowMs - days * MS_PER_DAY;
  const kept = book.recents.filter((recent) => recent.lastUsedMs > floor);
  return kept.length === book.recents.length ? book : { saved: book.saved, recents: kept };
}

/**
 * A RECENT BECOMES A SAVED PLACE, AND LEAVES THE RECENTS LIST.
 *
 * Section C: "A recent promoted to saved leaves the recents list -- never in
 * both." Both halves happen here rather than in two calls a caller could get
 * half-right.
 */
export function promoteToSaved(book: PlaceBook, id: string, kind: SavedKind): PlaceBook {
  const recent = book.recents.find((entry) => entry.id === id);
  if (recent === undefined) return book;
  const saved: SavedPlace = {
    id: recent.id,
    kind,
    name: recent.name,
    detail: recent.detail,
    lat: recent.lat,
    lon: recent.lon,
  };
  /*
   * ONE HOME AND ONE WORK. Setting a second Home replaces the first rather
   * than drawing two rows with the same badge, which the panel has no way to
   * tell apart. `other` is unbounded -- that is what the star is for.
   */
  const others = book.saved.filter(
    (existing) => existing.id !== id && !(kind !== 'other' && existing.kind === kind),
  );
  return {
    saved: [...others, saved],
    recents: book.recents.filter((entry) => entry.id !== id),
  };
}
