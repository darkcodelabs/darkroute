/**
 * FINDING A PLACE BY NAME - the one request this product makes on a driver's
 * behalf, and the reasons it is shaped the way it is.
 *
 * =============================================================================
 * WHY THIS EXISTS AT ALL, ON THIS PRODUCT
 * =============================================================================
 * DarkRoute's search runs on the phone. That is not a limitation being worked
 * around; it is the feature, and `SearchBar.tsx` has a test that spies on
 * `fetch` to keep it true.
 *
 * But a driver typing "1420 Baltimore Ave" is asking a question the phone
 * cannot answer. There are 139,918 cameras on it and no addresses at all, and
 * "we only do cameras" is not an answer to "take me to the hospital".
 *
 * So: the phone answers what it can, and this answers the rest - ONLY when
 * somebody presses a key that says it will. The client never calls this while
 * typing. There is no autocomplete here and there must never be one, because an
 * autocomplete is a keystroke logger you have agreed to.
 *
 * =============================================================================
 * WHY IT IS A PROXY RATHER THAN A DIRECT CALL
 * =============================================================================
 * The obvious build is to have the phone call Nominatim directly. It is one
 * fewer hop and it is the wrong answer, for a reason that is the whole point of
 * this application:
 *
 *   A DIRECT CALL HANDS A THIRD PARTY THE DRIVER'S IP ADDRESS ALONGSIDE THE
 *   NAME OF WHERE THEY ARE GOING.
 *
 * That pair - who and where-to - is precisely the record an ALPR network
 * assembles, and building a surveillance-avoidance tool that leaks it to a
 * geocoder would be indefensible. Through this Worker, the geocoder sees one
 * server asking about a place. It does not see a person.
 *
 * The cost is that WE see the query instead, which is why nothing here logs
 * one, and why the response is cached at the edge by the query alone - the same
 * lookup by two different drivers is one upstream request, and neither is
 * distinguishable in it.
 *
 * =============================================================================
 * WHY NOMINATIM
 * =============================================================================
 * The archive is OSM-derived and ODbL; the geocoder is the OSM project's own,
 * over the same data. Anything else would mean this app's idea of a place and
 * its idea of a camera came from two different maps, which is how a route ends
 * up avoiding a reader on a road the destination is not actually on.
 *
 * Its usage policy asks for a real User-Agent, no heavy use, and caching. All
 * three are here. `_middleware.ts` caps a caller at 60 requests a minute before
 * this file is reached, and this file caps what one request may ask for.
 */

import { json } from './_middleware.ts';

interface Env {
  /**
   * Override the geocoder. Present so a self-hosted Nominatim can be pointed at
   * without a code change - the OSM instance is a courtesy, not an entitlement,
   * and an app that grows into it should move off it.
   */
  readonly NOMINATIM_URL?: string;
}

const DEFAULT_NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/**
 * WHO IS ASKING, in the header the OSM policy requires.
 *
 * A contact address rather than a product name alone: the policy exists so an
 * operator can reach whoever is generating traffic, and a User-Agent with no
 * way to answer that is a technicality rather than compliance.
 */
const USER_AGENT = 'DarkRoute/1.0 (+https://darkroute.ai; cory@darkcode.ai)';

/** Enough to choose from, few enough that the sheet is readable at a glance. */
export const MAX_RESULTS = 6;

/**
 * How long a place lives at the edge.
 *
 * An hour. Addresses do not move, and the cache is the thing that makes the
 * upstream request rate a function of DISTINCT places rather than of drivers -
 * which is what the OSM usage policy actually asks for.
 */
const CACHE_SECONDS = 3600;

/** The longest query worth forwarding. Beyond this it is not an address. */
export const MAX_QUERY = 120;

export interface Place {
  readonly name: string;
  /** The rest of the address, for telling two places of the same name apart. */
  readonly detail: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * Split Nominatim's `display_name` into a name and the rest.
 *
 * It returns one long comma-joined string - "Home Depot, 9600, Metcalf Avenue,
 * Overland Park, Johnson County, Kansas, 66212, United States" - and a result
 * row that renders the whole thing is unreadable. The first field is what the
 * place is called; the next few are what distinguish it from the other one with
 * the same name.
 */
export function splitDisplayName(display: string): { name: string; detail: string } {
  const parts = display.split(',').map((part) => part.trim()).filter((part) => part !== '');
  const first = parts[0];
  if (first === undefined) return { name: display.trim(), detail: '' };
  /*
   * Four fields of context, not all of them. The country and the postcode are
   * the last two and neither tells an American driver anything they did not
   * already assume.
   */
  return { name: first, detail: parts.slice(1, 5).join(', ') };
}

interface NominatimRow {
  readonly display_name?: unknown;
  readonly lat?: unknown;
  readonly lon?: unknown;
}

/**
 * Read the upstream rows into our own shape, dropping anything malformed.
 *
 * Exported for the tests, because "what happens when the geocoder returns
 * something unexpected" is a question worth being able to ask directly.
 */
export function readPlaces(body: unknown): Place[] {
  if (!Array.isArray(body)) return [];
  const places: Place[] = [];
  for (const row of body as readonly NominatimRow[]) {
    if (typeof row !== 'object' || row === null) continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const display = row.display_name;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (typeof display !== 'string' || display === '') continue;
    const { name, detail } = splitDisplayName(display);
    places.push({ name, detail, lat, lon });
    if (places.length >= MAX_RESULTS) break;
  }
  return places;
}

/**
 * A bounding box around the driver, used to PREFER nearby answers.
 *
 * `viewbox` with `bounded=0` is a nudge rather than a filter: a driver in
 * Kansas City typing "Home Depot" wants the one on Metcalf, but a driver
 * planning a trip typing "Denver" must still get Denver. Bounding it hard would
 * answer the first question by refusing the second.
 *
 * Two degrees - roughly 140 miles of longitude at this latitude - because that
 * is a drive rather than a neighbourhood.
 */
const NEAR_SPAN_DEG = 2;

export function viewboxAround(lat: number, lon: number): string {
  const west = lon - NEAR_SPAN_DEG;
  const east = lon + NEAR_SPAN_DEG;
  const south = lat - NEAR_SPAN_DEG;
  const north = lat + NEAR_SPAN_DEG;
  // Nominatim's order: left, top, right, bottom.
  return `${String(west)},${String(north)},${String(east)},${String(south)}`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  if (query === '') {
    return json(400, { error: 'missing_query', detail: 'pass ?q= with a place to look for.' });
  }
  if (query.length > MAX_QUERY) {
    return json(400, {
      error: 'query_too_long',
      detail: `a place name is at most ${String(MAX_QUERY)} characters.`,
    });
  }

  const upstream = new URL(context.env.NOMINATIM_URL ?? DEFAULT_NOMINATIM);
  upstream.searchParams.set('q', query);
  upstream.searchParams.set('format', 'jsonv2');
  upstream.searchParams.set('limit', String(MAX_RESULTS));
  upstream.searchParams.set('addressdetails', '0');
  /*
   * THE UNITED STATES, AND THAT IS A FILTER RATHER THAN A PREFERENCE.
   *
   * Typing `Walma` returned Distrik Walma in Papua Pegunungan, then Walma in
   * Yahukimo, then Walma in New South Wales -- three places a driver on I-435
   * cannot drive to, above the Walmart they meant. `viewbox` below is a NUDGE
   * by design (`bounded=0`, so planning a trip to Denver still works), and a
   * nudge cannot outrank an exact name match on the other side of the planet.
   *
   * The camera archive is US, DC and PR only -- `CAMERA_SOURCE_TERRITORIES`,
   * and `scripts/data/us-counties.geojson` is the geofence every reader is
   * placed against -- so a destination outside it is a route this application
   * cannot count cameras on. Refusing it in the query is honest; ranking it
   * third is not.
   *
   * `pr` and `vi` ride along with `us` in Nominatim's country codes, and `us`
   * covers DC. Nothing here narrows to a state: a drive from Kansas to Denver
   * is the case the viewbox exists to keep working.
   */
  upstream.searchParams.set('countrycodes', 'us,pr');

  /*
   * `near` is optional and is only ever a preference. A request without it is
   * answered; a request with a malformed one is answered too, without it,
   * rather than refused - the driver asked for a place, and where they happen
   * to be standing is not the part that has to be valid.
   */
  const near = url.searchParams.get('near');
  if (near !== null) {
    const [rawLat, rawLon] = near.split(',');
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      upstream.searchParams.set('viewbox', viewboxAround(lat, lon));
      upstream.searchParams.set('bounded', '0');
    }
  }

  let response: Response;
  try {
    response = await fetch(upstream.toString(), {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      // The edge cache is what keeps the upstream rate proportional to distinct
      // places rather than to drivers. See CACHE_SECONDS.
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
  } catch {
    return json(502, {
      error: 'geocoder_unreachable',
      detail: 'the place lookup could not be reached. the cameras on your phone still work.',
    });
  }

  if (!response.ok) {
    return json(502, {
      error: 'geocoder_failed',
      detail: `the place lookup answered ${String(response.status)}.`,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return json(502, {
      error: 'geocoder_unreadable',
      detail: 'the place lookup returned something this API could not read.',
    });
  }

  return json(
    200,
    {
      query,
      places: readPlaces(body),
      /*
       * ODbL requires attribution wherever the data is shown, and the client
       * cannot credit a source it was not told about. Carried in the payload
       * rather than assumed in the UI so a third-party consumer of this API
       * gets it too.
       */
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
    { 'cache-control': `public, max-age=${String(CACHE_SECONDS)}` },
  );
};
