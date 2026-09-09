/**
 * A ROUTE THAT AVOIDS THE CAMERAS - the thing this whole application is for.
 *
 * =============================================================================
 * WHY THE APP STOPPED HANDING OFF TO A MAPS APP
 * =============================================================================
 * Until now, "route around these" opened Google Maps with the cameras turned
 * into via-points. It worked, and it was the wrong shape for this product for
 * two reasons that are not going to improve:
 *
 *   1. IT TELLS A MAPS COMPANY WHERE YOU ARE GOING. Handing off means the
 *      driver's origin, destination and the fact that they are steering around
 *      something all arrive at a third party, attached to whatever account is
 *      signed in on that phone. An app that exists to keep a car's movements out
 *      of a database should not begin by posting them to a larger one.
 *
 *   2. VIA-POINTS ARE NOT AVOIDANCE. A via-point says "go through here"; what a
 *      driver wants is "do not go through there". Bending a route around a
 *      reader by threading it through a nearby point is a guess that gets worse
 *      the more readers there are - which is exactly when it matters.
 *
 * =============================================================================
 * WHY VALHALLA
 * =============================================================================
 * Because it takes `exclude_polygons`, and that is the whole product thesis
 * expressed in one request field. Each camera becomes a small square the router
 * may not enter, and the engine solves the actual problem - find me a legal
 * driving route that does not pass through any of these - rather than
 * approximating it with waypoints.
 *
 * It is also OSM-native, which matters more than it sounds: the cameras are
 * placed against OSM ways, so an exclusion drawn around one lands on the same
 * geometry the router is solving over. A route from a different map's road
 * network would avoid a point that is not quite on the road the reader watches.
 *
 * =============================================================================
 * WHY IT IS A PROXY, AND WHAT THAT COSTS
 * =============================================================================
 * Same reason as `place.ts`, and more sharply: a routing request contains the
 * driver's exact origin AND their destination in one payload. That pair is the
 * single most sensitive thing this app ever computes. It does not leave the
 * phone to a third party; it comes here, and this asks on the app's behalf.
 *
 * Nothing in this file logs a coordinate. The response is not cached - unlike a
 * place name, a route is personal to one driver at one moment, and an edge
 * cache keyed on it would be a store of exactly the records this app exists to
 * prevent existing.
 */

import { json } from './_middleware.ts';

interface Env {
  /** Override the router. See `place.ts` for why an override exists. */
  readonly VALHALLA_URL?: string;
}

const DEFAULT_VALHALLA = 'https://valhalla1.openstreetmap.de/route';

const USER_AGENT = 'DarkRoute/1.0 (+https://darkroute.ai; cory@darkcode.ai)';

/**
 * HOW MANY CAMERAS ONE REQUEST MAY EXCLUDE.
 *
 * Every exclusion is work the router has to do, and a request carrying a
 * thousand of them is either a mistake or an attempt to make the upstream do
 * something expensive on our behalf. Sixty is more readers than any single
 * drive passes near, and the client sends the ones ON the corridor rather than
 * every reader it knows about.
 */
export const MAX_EXCLUSIONS = 60;

/**
 * HOW BIG AN EXCLUSION IS, in metres.
 *
 * =============================================================================
 * IT MUST BE AT LEAST THE CLIENT'S DETECTION CORRIDOR. THAT IS THE WHOLE RULE.
 * =============================================================================
 * `corridor.ts` in the app calls a reader "on the route" when it is within
 * `CORRIDOR_M` - 60 m - of the line. This is the box the router may not enter.
 * If this is SMALLER than that corridor, there is a band of readers that the
 * app detects and the router cannot avoid: the reader is 40 m from the road,
 * so it is reported as on the corridor and sent as an exclusion, but a 28 m box
 * does not touch the road and Valhalla drives straight down it.
 *
 * That is not a near miss, it is a permanent one. `buildDarkRoute` stops when a
 * round adds no NEW readers to the avoid set, so a reader in that band ends the
 * iteration immediately, still on the line, reported as `remaining`. The app
 * says "could not be avoided" about a camera nothing ever tried to avoid.
 *
 * This was 0.00025 degrees - about 28 m against a 60 m corridor - so every
 * reader between 28 m and 60 m of its road was structurally unavoidable. It is
 * the corridor width now, and the invariant is: EXCLUSION_M >= CORRIDOR_M.
 *
 * THE TWO NUMBERS CANNOT IMPORT EACH OTHER. This is a Worker and that is the
 * app; the boundary is the wire. So the coupling is stated here, asserted in
 * `route.test.ts`, and if the corridor ever moves this has to move with it.
 *
 * Bigger is not free - too large and the router refuses to find any route at
 * all in a dense downtown - which is the argument for tracking the corridor
 * exactly rather than padding it further.
 */
const EXCLUSION_M = 60;
const M_PER_DEG_LAT = 111_320;

/** The longest drive this will plan. Beyond it, the request is not a drive. */
export const MAX_SPAN_DEG = 12;

export interface Point {
  readonly lat: number;
  readonly lon: number;
}

/** `lat,lon` -> a point, or null when it is not one. */
export function readPoint(raw: string | null): Point | null {
  if (raw === null) return null;
  const [rawLat, rawLon] = raw.split(',');
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * `lat,lon;lat,lon;...` -> the readers to route around.
 *
 * Malformed entries are DROPPED rather than refused. A route that avoids
 * fifty-nine of sixty readers is worth having; refusing the whole request
 * because one coordinate was mangled leaves the driver with no route at all,
 * which is the worse failure by a wide margin.
 */
export function readExclusions(raw: string | null): Point[] {
  if (raw === null || raw.trim() === '') return [];
  const points: Point[] = [];
  for (const chunk of raw.split(';')) {
    const point = readPoint(chunk);
    if (point !== null) points.push(point);
    if (points.length >= MAX_EXCLUSIONS) break;
  }
  return points;
}

/**
 * One reader -> the square the router may not enter.
 *
 * Valhalla wants each ring as an array of `[lon, lat]` pairs, closed. Note the
 * order: it is the opposite of every other coordinate in this file, which is
 * exactly the kind of detail that produces a route that avoids a point in the
 * ocean and nobody notices until a driver passes a camera.
 */
export function exclusionRing(point: Point): [number, number][] {
  /*
   * A DEGREE OF LONGITUDE IS NOT A DEGREE OF LATITUDE, and using one number for
   * both is how a box that measures 60 m north-south measures 47 m east-west in
   * Kansas and 20 m in Alaska. The east-west half-width is divided by
   * `cos(latitude)` so the box is `EXCLUSION_M` on every side wherever it is
   * drawn. The clamp stops the division running away at extreme latitudes;
   * 0.2 covers past 78 degrees, which is north of anywhere this ships to.
   */
  const dLat = EXCLUSION_M / M_PER_DEG_LAT;
  const dLon = dLat / Math.max(0.2, Math.cos((point.lat * Math.PI) / 180));
  const w = point.lon - dLon;
  const e = point.lon + dLon;
  const s = point.lat - dLat;
  const n = point.lat + dLat;
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

/**
 * Valhalla's polyline, decoded.
 *
 * Same algorithm as Google's encoded polyline with one difference that will
 * silently halve or double every distance if it is missed: Valhalla encodes at
 * SIX decimal places, not five.
 */
export function decodeShape(encoded: string, precision = 6): Point[] {
  const factor = 10 ** precision;
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f && index < encoded.length);
    lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f && index < encoded.length);
    lon += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / factor, lon: lon / factor });
  }
  return points;
}

/**
 * WHAT KIND OF TURN IT IS, in the terms a card can draw an arrow for.
 *
 * Valhalla answers with a NUMBER - 10 for a right, 15 for a left, 20 for an
 * exit ramp - and a number is not something a driver reads. This is the small
 * vocabulary the app draws, so the arrow on the turn list is chosen here once
 * rather than by every surface that renders one.
 */
export type TurnKind =
  | 'start'
  | 'arrive'
  | 'straight'
  | 'left'
  | 'right'
  | 'sharp-left'
  | 'sharp-right'
  | 'slight-left'
  | 'slight-right'
  | 'uturn'
  | 'merge'
  | 'ramp'
  | 'roundabout';

/** One instruction on the way, in the order it is driven. */
export interface Maneuver {
  /** The router's own sentence: "Turn right onto West 119th Street." */
  readonly instruction: string;
  /** The street it puts you on, or '' where the router names none. */
  readonly street: string;
  readonly miles: number;
  readonly seconds: number;
  readonly turn: TurnKind;
  /** Index into the WHOLE route shape. See the offset note in `readTrip`. */
  readonly beginShapeIndex: number;
}

/**
 * Valhalla's numeric maneuver type -> the arrow the app draws.
 *
 * The codes are Valhalla's documented `DirectionsLeg.Maneuver.Type` list. Codes
 * 2, 3, 4, 6, 10, 15, 17, 18, 20, 23 and 24 were observed on live responses from
 * valhalla1.openstreetmap.de while this was written; the rest come from that
 * list and are mapped by name.
 *
 * ANYTHING NOT NAMED HERE FALLS BACK TO 'straight' ON PURPOSE. That covers the
 * codes a driving route does not emit - transit, ferry, elevator, steps,
 * escalator, building enter/exit - and any code a future Valhalla adds. A
 * guessed arrow is worse than a neutral one: an arrow pointing left at a
 * junction where the road goes right is a wrong instruction delivered with
 * confidence, and the instruction text beside it is still the router's own.
 */
export function turnKind(type: number): TurnKind {
  switch (type) {
    // 1 kStart, 2 kStartRight, 3 kStartLeft. The side is which side of the
    // street you set off from, not a turn, so all three are just the start.
    case 1:
    case 2:
    case 3:
      return 'start';
    // 4 kDestination, 5 kDestinationRight, 6 kDestinationLeft.
    case 4:
    case 5:
    case 6:
      return 'arrive';
    case 9:
      return 'slight-right';
    case 10:
      return 'right';
    case 11:
      return 'sharp-right';
    // 12 kUturnRight, 13 kUturnLeft. Both are the same manoeuvre to a driver.
    case 12:
    case 13:
      return 'uturn';
    case 14:
      return 'sharp-left';
    case 15:
      return 'left';
    case 16:
      return 'slight-left';
    // 17-19 the ramps, 20-21 the exits. All of them mean "leave this road on a
    // slip road", which is one glyph.
    case 17:
    case 18:
    case 19:
    case 20:
    case 21:
      return 'ramp';
    // 23 kStayRight, 24 kStayLeft - a fork you keep to one side of, which is a
    // slight turn to the hands on the wheel even though Valhalla names it a
    // stay. 22 kStayStraight is straight and falls through to the default.
    case 23:
      return 'slight-right';
    case 24:
      return 'slight-left';
    // 25 kMerge, 37 kMergeRight, 38 kMergeLeft.
    case 25:
    case 37:
    case 38:
      return 'merge';
    // 26 kRoundaboutEnter, 27 kRoundaboutExit.
    case 26:
    case 27:
      return 'roundabout';
    default:
      return 'straight';
  }
}

interface RawManeuver {
  readonly type?: unknown;
  readonly instruction?: unknown;
  readonly street_names?: unknown;
  readonly length?: unknown;
  readonly time?: unknown;
  readonly begin_shape_index?: unknown;
}

interface Leg {
  readonly shape?: unknown;
  readonly maneuvers?: unknown;
}

/**
 * One of the router's maneuvers, or null when it is not one this can use.
 *
 * `shapeOffset` is added to `begin_shape_index` here rather than at the call
 * site so there is exactly one place the per-leg index becomes a whole-route
 * one. See the block in `readTrip` for why that offset exists at all.
 *
 * A maneuver with no instruction is DROPPED rather than carried with an empty
 * sentence: the turn list exists to say something out loud, and a blank row
 * with an arrow on it tells a driver less than no row at all.
 */
function readManeuver(raw: RawManeuver, shapeOffset: number): Maneuver | null {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.instruction !== 'string' || raw.instruction === '') return null;

  const begin = Number(raw.begin_shape_index);
  if (!Number.isFinite(begin) || begin < 0) return null;

  /*
   * The FIRST name only. Valhalla lists every name a way carries - a road can
   * come back as ["Metcalf Avenue", "US 169"] - and the one a driver matches
   * against the sign in front of them is the first, which is the local name.
   */
  const names = Array.isArray(raw.street_names) ? raw.street_names : [];
  const first = names[0];

  const length = Number(raw.length);
  const time = Number(raw.time);
  return {
    instruction: raw.instruction,
    street: typeof first === 'string' ? first : '',
    // Miles because the request asks for miles, same as `summary.length`.
    miles: Number.isFinite(length) ? length : 0,
    seconds: Number.isFinite(time) ? time : 0,
    turn: turnKind(Number(raw.type)),
    beginShapeIndex: Math.round(begin) + shapeOffset,
  };
}

interface Trip {
  readonly legs?: unknown;
  readonly summary?: { readonly length?: unknown; readonly time?: unknown };
}

/** The shape of what this endpoint answers with. */
export interface RouteAnswer {
  /** The line to draw, in order. */
  readonly shape: readonly Point[];
  readonly miles: number;
  readonly seconds: number;
  /** How many readers the router was told to keep out of. */
  readonly avoided: number;
  /** The turns, in driving order. Empty when the router gave none. */
  readonly maneuvers: readonly Maneuver[];
}

export function readTrip(body: unknown, avoided: number): RouteAnswer | null {
  if (typeof body !== 'object' || body === null) return null;
  const trip = (body as { trip?: Trip }).trip;
  if (typeof trip !== 'object' || trip === null) return null;
  if (!Array.isArray(trip.legs)) return null;

  const shape: Point[] = [];
  const maneuvers: Maneuver[] = [];
  for (const leg of trip.legs as readonly Leg[]) {
    if (typeof leg !== 'object' || leg === null) continue;
    if (typeof leg.shape !== 'string') continue;

    /*
     * A LEG WITH NO LINE IS SKIPPED WHOLE - its maneuvers with it - and the
     * emptiness is measured AFTER decoding, not before.
     *
     * A missing `shape` and a `shape` of '' are the same leg, but only the
     * first fails a typeof check. An empty string decodes to zero points, adds
     * nothing to the line, and leaves its maneuvers indexing the NEXT leg's
     * geometry - which is exactly the bug the offset below exists to prevent,
     * walking in through the one door the typeof check leaves open.
     */
    const points = decodeShape(leg.shape);
    if (points.length === 0) continue;

    /*
     * WHY THE OFFSET, and it is not a nicety.
     *
     * `begin_shape_index` counts from the start of ITS OWN LEG - a two-stop
     * trip's second leg starts again at 0, which is what the live router
     * returns - and this function concatenates every leg's points into one
     * line. Added straight through, a turn thirty miles into leg 1 would index
     * a point a few hundred metres into leg 0, and the app would tell a driver
     * the next turn is here when it is half an hour away.
     *
     * Read BEFORE the points are pushed, so it is the count of everything
     * already on the line and nothing from this leg.
     */
    const shapeOffset = shape.length;
    /*
     * Appended one at a time rather than `shape.push(...points)`. `MAX_SPAN_DEG`
     * lets this endpoint be asked for a drive of some eight hundred miles, and
     * the live router returned between 26 and 35 shape points per mile over the
     * suburban roads this was measured on - denser in a city. That puts a
     * long answer in the same order of magnitude as the engine's cap on spread
     * arguments, and a spread past that cap throws RangeError. A driver would
     * see the route fail rather than come back short, which is a hard failure
     * to trace back to a line that looks like a convenience.
     */
    for (const point of points) shape.push(point);

    if (!Array.isArray(leg.maneuvers)) continue;
    for (const raw of leg.maneuvers as readonly RawManeuver[]) {
      const maneuver = readManeuver(raw, shapeOffset);
      if (maneuver !== null) maneuvers.push(maneuver);
    }
  }
  if (shape.length === 0) return null;

  const length = Number(trip.summary?.length);
  const time = Number(trip.summary?.time);
  return {
    shape,
    // Valhalla is asked for miles below, so this is already in them.
    miles: Number.isFinite(length) ? length : 0,
    seconds: Number.isFinite(time) ? time : 0,
    avoided,
    maneuvers,
  };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const from = readPoint(url.searchParams.get('from'));
  const to = readPoint(url.searchParams.get('to'));

  if (from === null || to === null) {
    return json(400, {
      error: 'missing_points',
      detail: 'pass ?from=lat,lon and ?to=lat,lon.',
    });
  }
  if (
    Math.abs(from.lat - to.lat) > MAX_SPAN_DEG ||
    Math.abs(from.lon - to.lon) > MAX_SPAN_DEG
  ) {
    return json(400, {
      error: 'too_far',
      detail: 'that is further than this API will plan in one request.',
    });
  }

  const exclusions = readExclusions(url.searchParams.get('avoid'));

  const body = {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: 'auto',
    units: 'miles',
    /*
     * The whole point. Absent when there is nothing to avoid, rather than an
     * empty array - a router given an empty exclusion list is being asked a
     * subtly different question than one given none, and the plain route is
     * what a driver with no readers on their corridor should get.
     */
    ...(exclusions.length === 0
      ? {}
      : { exclude_polygons: exclusions.map((point) => exclusionRing(point)) }),
    directions_options: { units: 'miles' },
  };

  let response: Response;
  try {
    response = await fetch(context.env.VALHALLA_URL ?? DEFAULT_VALHALLA, {
      method: 'POST',
      headers: {
        'user-agent': USER_AGENT,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return json(502, {
      error: 'router_unreachable',
      detail: 'the router could not be reached. the cameras on your phone still work.',
    });
  }

  if (!response.ok) {
    /*
     * A 400 from the router usually means the exclusions closed every road -
     * which is a real answer to a real question and deserves its own sentence,
     * because "no route" and "the router is broken" are different problems and
     * only one of them is worth retrying.
     */
    return json(response.status === 400 ? 409 : 502, {
      error: response.status === 400 ? 'no_route' : 'router_failed',
      detail:
        response.status === 400
          ? 'no driving route avoids all of those. try again with fewer of them, or accept the ' +
            'ones you cannot get around.'
          : `the router answered ${String(response.status)}.`,
    });
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return json(502, {
      error: 'router_unreadable',
      detail: 'the router returned something this API could not read.',
    });
  }

  const answer = readTrip(parsed, exclusions.length);
  if (answer === null) {
    return json(502, {
      error: 'router_empty',
      detail: 'the router returned no usable route.',
    });
  }

  return json(
    200,
    { ...answer, attribution: '© OpenStreetMap contributors (ODbL) · routing by Valhalla' },
    // NOT cached. A route is one driver's origin and destination; see the note
    // at the top of this file.
    { 'cache-control': 'no-store' },
  );
};
