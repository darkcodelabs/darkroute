/**
 * THE DESTINATION BOOK, ON DISK.
 *
 * The durable half of `features/search/places.ts`. That file is section C of
 * `DarkRoute Search Entry.html` as pure functions - what is stored, when it is
 * written, the order, the nine, the ninety days, the promotion, the clearing -
 * and it is deliberately storage-free so every one of those rules can be
 * checked by feeding it a book and asserting the book that comes back. This
 * file is the other half and holds no rule of its own: it reads a row, proves
 * it is a book, and writes one back.
 *
 * IT DOES NOT IMPORT THE RULES, AND THAT IS THE POINT. `rememberOnStart`,
 * `expireRecents`, `forgetAllRecents` and `promoteToSaved` are the caller's to
 * apply. A repository that quietly ran the expiry on every read would be a
 * second place the ninety days is decided, and the one that drifts is always
 * the copy nobody remembered. It does import the TYPES, because a second
 * declaration of `SavedPlace` here would be a second place the four fields
 * section C names could drift - which is the same argument pointed at data
 * instead of at behaviour.
 *
 * That import points from `services/` into `features/`, which is the wrong way
 * round for a dependency and is written here deliberately rather than by
 * accident. `services/alerts/delivery.ts` reaches into `features/alert` and
 * `features/radar` and `stores/history.ts` reaches into `features/log` for the
 * same reason: the model belongs to the feature that owns the rules, and the
 * storage layer is the thing that serialises it. Moving `places.ts` down into
 * `services/` would be the tidier answer and is not this brief's to make - the
 * search panel imports it from four files.
 *
 * =============================================================================
 * VALIDATED ON READ, LIKE `settings`
 * =============================================================================
 * The only writer is `write()`, which is typed. A value read back off disk has
 * been through a browser upgrade, a profile sync and possibly a devtools edit
 * since it was written, and this row in particular is a JSON structure rather
 * than a scalar - so `isPlaceBook` walks it and a row that does not answer is
 * treated as absent.
 *
 * A CORRUPT ROW READS AS EMPTY, IT DOES NOT THROW. The panel's failure mode for
 * "no book" is the first-run card, which is a real screen that tells a person
 * what fills it. Its failure mode for a rejected promise is a search field that
 * does not open. One of those is survivable.
 *
 * =============================================================================
 * WHY EVERY NUMBER THIS RETURNS IS COUNTED, NEVER ESTIMATED
 * =============================================================================
 * `clear()` returns what it removed because `clearLocalData()` reports to the
 * user what a wipe took, and section C promises the saved places go with it.
 * "Nothing, by design" is a promise a person cannot verify from the outside, so
 * the receipt has to be counted from the row that was there rather than from
 * what the caller believed was in it.
 */

import type { PlaceBook, RecentPlace, SavedPlace } from '../../../features/search/places.ts';
import { EMPTY_BOOK } from '../../../features/search/places.ts';
import type { DestinationBookRecord } from '../schema.ts';
import { DESTINATION_BOOK_KEY } from '../schema.ts';
import type { FwmDatabase, RepositoryDeps } from './support.ts';
import { resolveDeps } from './support.ts';

/** How many places a book holds, split the way section C splits them. */
export interface PlaceCounts {
  readonly saved: number;
  readonly recents: number;
}

export interface DestinationsRepository {
  /**
   * The book, or {@link EMPTY_BOOK} when there is no row or the row is not a
   * book. Never throws on a bad row - see the header.
   */
  read(): Promise<PlaceBook>;
  /** Replace the book. The whole pair of lists, always, in one `put`. */
  write(book: PlaceBook): Promise<void>;
  /** What is in the book right now, for the two counts SETTINGS prints. */
  counts(): Promise<PlaceCounts>;
  /**
   * Take the whole row - saved places included.
   *
   * Section C: "Nothing, by design. Saved places are user-entered data and go
   * with the wipe - if the wipe left anything behind, the promise would be
   * false." Returns what was there, counted before the delete.
   */
  clear(): Promise<PlaceCounts>;
}

const NO_PLACES: PlaceCounts = Object.freeze({ saved: 0, recents: 0 });

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A saved place, proved field by field.
 *
 * `kind` is checked against the three the model publishes rather than against
 * "any string": a row carrying an unknown kind would sort into no group in
 * `orderedSaved()` and draw no badge, which is a place that exists and cannot
 * be seen.
 */
function isSavedPlace(value: unknown): value is SavedPlace {
  if (value === null || typeof value !== 'object') return false;
  const place = value as Partial<Record<keyof SavedPlace, unknown>>;
  return (
    typeof place.id === 'string' &&
    (place.kind === 'home' || place.kind === 'work' || place.kind === 'other') &&
    typeof place.name === 'string' &&
    typeof place.detail === 'string' &&
    isFiniteNumber(place.lat) &&
    isFiniteNumber(place.lon)
  );
}

/**
 * A recent, proved field by field - and the four fields section C names, with
 * nothing accepted beyond them being required.
 *
 * `trips` and `lastUsedMs` are checked as finite numbers because both drive a
 * SORT: a NaN in either makes the eviction comparator return false for every
 * pair, which silently leaves the list in insertion order and evicts the wrong
 * place. A row that cannot be compared is a row that cannot be trusted to be
 * the ninth.
 */
function isRecentPlace(value: unknown): value is RecentPlace {
  if (value === null || typeof value !== 'object') return false;
  const place = value as Partial<Record<keyof RecentPlace, unknown>>;
  return (
    typeof place.id === 'string' &&
    typeof place.name === 'string' &&
    typeof place.detail === 'string' &&
    isFiniteNumber(place.lat) &&
    isFiniteNumber(place.lon) &&
    isFiniteNumber(place.lastUsedMs) &&
    isFiniteNumber(place.trips)
  );
}

/** The stored row, proved to be a book. */
export function isPlaceBook(value: unknown): value is PlaceBook {
  if (value === null || typeof value !== 'object') return false;
  const book = value as Partial<Record<keyof PlaceBook, unknown>>;
  return (
    Array.isArray(book.saved) &&
    Array.isArray(book.recents) &&
    book.saved.every(isSavedPlace) &&
    book.recents.every(isRecentPlace)
  );
}

function countOf(book: PlaceBook): PlaceCounts {
  return { saved: book.saved.length, recents: book.recents.length };
}

export function createDestinationsRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps>,
): DestinationsRepository {
  const deps = resolveDeps(overrides);

  async function read(): Promise<PlaceBook> {
    const row = await db.get('destinations', DESTINATION_BOOK_KEY);
    if (row === undefined) return EMPTY_BOOK;
    if (!isPlaceBook(row.book)) return EMPTY_BOOK;
    // The guard above is the runtime proof; `book` is declared `unknown` in the
    // schema precisely so this is the only place its type is decided.
    return row.book;
  }

  return {
    read,

    async write(book) {
      const record: DestinationBookRecord = {
        key: DESTINATION_BOOK_KEY,
        book,
        updatedAt: deps.now(),
      };
      await db.put('destinations', record);
    },

    async counts() {
      return countOf(await read());
    },

    async clear() {
      /*
       * COUNTED BEFORE THE DELETE, inside one transaction with it, so the
       * receipt cannot report a book that a concurrent write changed between
       * the count and the clear. Every other `clear()` in this directory counts
       * rows and this one counts PLACES, which is the number the user is owed:
       * "9 recent places" is what they can check, and "1 row" is not.
       */
      const tx = db.transaction('destinations', 'readwrite');
      const row = await tx.store.get(DESTINATION_BOOK_KEY);
      const before = row !== undefined && isPlaceBook(row.book) ? countOf(row.book) : NO_PLACES;
      void tx.store.delete(DESTINATION_BOOK_KEY);
      await tx.done;
      return before;
    },
  };
}
