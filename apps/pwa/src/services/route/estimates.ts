/**
 * HOW FAR, HOW LONG, AND HOW MANY READERS -- for the rows the panel is showing.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * `DarkRoute Search Entry.html` puts three things on every destination row: a
 * name, a drive, and a camera count.
 *
 *   name: 'Home',          sub: '14 min · 7.2 mi',  cams: '2 cams'
 *   name: 'Oak Park Mall', sub: '9 min · 4.1 mi',   cams: '3 cams'
 *
 * The panel has always been able to draw all three. `SearchPanel` even reports
 * which rows nobody has measured, through `onCountsNeeded`. Nothing answered
 * it, so every row on production drew the place's ADDRESS and a dash -- the
 * two facts a driver actually chooses on, missing, on the surface built to
 * choose. This is the answer.
 *
 * =============================================================================
 * WHAT LEAVES THE PHONE, AND WHAT DOES NOT
 * =============================================================================
 * A count is a route, and a route is planned by the server: this sends a
 * destination coordinate to darkroute.ai for each row it measures. That is a
 * widening -- before, one destination went when a row was pressed -- and it is
 * written here rather than buried:
 *
 *   - THE CAMERAS ARE COUNTED ON THIS DEVICE. `camerasOnRoute` runs against the
 *     archive already in IndexedDB, so the server is never told which readers a
 *     driver cares about. That rule is `services/route/corridor.ts`'s and it is
 *     not relaxed here.
 *   - ONLY DESTINATIONS THE PANEL IS ALREADY SHOWING, capped at {@link MAX_PLACES}.
 *   - ONLY WITH A POSITION. No fix, no origin, no request; the rows keep their
 *     locality and their dash, which is a working search.
 *   - NOTHING IS SENT WHILE A ROW IS UNPRESSED AND UNSEEN: the caller asks for
 *     exactly the rows it drew.
 *
 * =============================================================================
 * A REFUSED ROUTE IS NOT A ZERO
 * =============================================================================
 * The map this returns simply has no entry for a place whose route failed, so
 * `CameraCount` stays `unknown` and the row draws its dash. A `0` here would
 * read as "no readers on the way there", which is the strongest claim this
 * application makes, published because a fetch timed out.
 */

import type { CameraRecord } from '../db/schema.ts';
import { camerasOnRoute } from './corridor.ts';
import { planRoute } from './planRoute.ts';
import type { RoutePoint } from './planRoute.ts';

/** One row's answer. Minutes and miles are the spec's units. */
export interface PlaceEstimate {
  readonly minutes: number;
  readonly miles: number;
  readonly cameras: number;
}

/**
 * The panel shows six destination rows before it scrolls. Planning more than it
 * draws is a request nobody reads, and this endpoint is ours to be gentle with.
 */
export const MAX_PLACES = 6;

/** Two at a time. A phone on a mount is not a machine to open six sockets on. */
export const CONCURRENCY = 2;

/**
 * ~11 metres. Two recents on the same block share a route for this purpose, and
 * re-opening search for the same six places costs nothing the second time.
 */
const KEY_PRECISION = 4;

export function estimateKey(place: { readonly lat: number; readonly lon: number }): string {
  return `${place.lat.toFixed(KEY_PRECISION)},${place.lon.toFixed(KEY_PRECISION)}`;
}

/**
 * THE SESSION'S ANSWERS, AND THEY DO NOT EXPIRE.
 *
 * A route's length does not change while somebody types. What does change is
 * the ORIGIN, so the cache is keyed by both ends: a driver who has moved a mile
 * gets a fresh answer, and one who has not gets the one already paid for.
 */
const cache = new Map<string, PlaceEstimate>();

function cacheKey(from: RoutePoint, place: { lat: number; lon: number }): string {
  return `${estimateKey(from)}>${estimateKey(place)}`;
}

/** Test seam. The cache is module state, and a test that shares it is flaky. */
export function clearEstimateCache(): void {
  cache.clear();
}

async function estimateOne(
  from: RoutePoint,
  place: { readonly lat: number; readonly lon: number },
  cameras: readonly CameraRecord[],
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<readonly [string, PlaceEstimate] | null> {
  const key = cacheKey(from, place);
  const hit = cache.get(key);
  if (hit !== undefined) return [estimateKey(place), hit];
  if (signal?.aborted === true) return null;

  try {
    const planned = await planRoute(
      { from, to: { lat: place.lat, lon: place.lon }, avoid: [] },
      fetchImpl,
    );
    /* THE FASTEST ROUTE, which is what the panel's footer promises the number
       is about: "count is cameras on the fastest route". `avoid: []` above is
       that promise in one argument. */
    const estimate: PlaceEstimate = {
      minutes: Math.max(0, Math.round(planned.seconds / 60)),
      miles: planned.miles,
      cameras: camerasOnRoute(planned.shape, cameras).length,
    };
    cache.set(key, estimate);
    return [estimateKey(place), estimate];
  } catch {
    /* Refused, unreachable, or aborted. No entry, so the row keeps its dash. */
    return null;
  }
}

/**
 * Measure a batch of places. Returns only what it actually measured.
 *
 * The map is keyed by {@link estimateKey}, which is the coordinate rather than
 * the place's name: the same corner reached from a recent and from a geocoder
 * answer is one route, and paying for it twice would be paying to say the same
 * thing in two rows.
 */
export async function estimatePlaces(input: {
  readonly from: RoutePoint;
  readonly places: readonly { readonly lat: number; readonly lon: number }[];
  readonly cameras: readonly CameraRecord[];
  readonly signal?: AbortSignal | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}): Promise<ReadonlyMap<string, PlaceEstimate>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  /* DEDUPED BEFORE IT IS CAPPED, so six rows pointing at four corners spend
     four routes and the cap counts what will actually be asked. */
  const wanted = new Map<string, { lat: number; lon: number }>();
  for (const place of input.places) {
    const key = estimateKey(place);
    if (!wanted.has(key)) wanted.set(key, { lat: place.lat, lon: place.lon });
    if (wanted.size >= MAX_PLACES) break;
  }

  const queue = [...wanted.values()];
  const out = new Map<string, PlaceEstimate>();
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (input.signal?.aborted === true) return;
      const index = next;
      next += 1;
      const place = queue[index];
      if (place === undefined) return;
      const answer = await estimateOne(
        input.from,
        place,
        input.cameras,
        fetchImpl,
        input.signal,
      );
      if (answer !== null) out.set(answer[0], answer[1]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return out;
}
