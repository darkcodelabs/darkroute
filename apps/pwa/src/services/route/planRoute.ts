/**
 * ASKING FOR A ROUTE, AND WHAT THE APP PROMISES AROUND IT.
 *
 * =============================================================================
 * NOTHING HERE RUNS ON ITS OWN
 * =============================================================================
 * Same rule as `services/share/shareCorrection.ts`, for the same reason. There
 * is no timer, no queue drain, no call on app start and no call while somebody
 * types. Every function in this file runs because a person pressed something
 * that said it would, and if one ever acquires a caller that is not a direct
 * user action, that is a bug and not an optimisation.
 *
 * A routing request carries a driver's exact position AND where they are going.
 * That pair is the single most sensitive thing this application ever computes -
 * it is, precisely, the record an ALPR network is assembled to build. It is not
 * sent speculatively.
 *
 * =============================================================================
 * IT GOES TO DARKROUTE, NOT TO A MAPS COMPANY
 * =============================================================================
 * `/api/v1/route` and `/api/v1/place` are this app's own endpoints. They ask
 * OpenStreetMap's router and geocoder on the app's behalf, so those services
 * see one server asking about a place rather than a person asking from an IP
 * address. See the notes at the top of `functions/api/v1/route.ts`.
 *
 * The app used to hand off to Google Maps for this. It does not any more, and
 * this file is what replaced it.
 */

const PLACE_URL = '/api/v1/place';
const ROUTE_URL = '/api/v1/route';

export interface Place {
  readonly name: string;
  readonly detail: string;
  readonly lat: number;
  readonly lon: number;
}

export interface RoutePoint {
  readonly lat: number;
  readonly lon: number;
}

/**
 * THE ARROW A TURN GETS DRAWN AS.
 *
 * The same vocabulary `functions/api/v1/route.ts` maps Valhalla's numeric
 * maneuver types onto, restated here because this file is the other side of a
 * network boundary and does not import from the Worker. If a kind is added
 * there, it is added here - the two lists are one contract, and the endpoint's
 * copy is the one that decides.
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

/**
 * That same vocabulary again, as a table the COMPILER checks against the union.
 *
 * The obvious spelling is a `readonly string[]`, and it lets the two drift in
 * silence: add a kind to `TurnKind` above, forget the list, and every route
 * carrying that kind arrives as 'straight' with nothing anywhere reporting it
 * - a left turn drawn as an arrow pointing straight on. `Record<TurnKind,
 * true>` makes both halves of that mistake a build failure, the missing key
 * and the misspelt one.
 *
 * It cannot reach across the wire. Keeping this union in step with the
 * endpoint's is still a promise a person has to keep, because a type cannot be
 * imported from a Worker into the app; what the compiler now holds is the half
 * that lives in this file.
 */
const TURN_KINDS: Readonly<Record<TurnKind, true>> = {
  start: true,
  arrive: true,
  straight: true,
  left: true,
  right: true,
  'sharp-left': true,
  'sharp-right': true,
  'slight-left': true,
  'slight-right': true,
  uturn: true,
  merge: true,
  ramp: true,
  roundabout: true,
};

/**
 * A kind off the wire, or 'straight' when it is not one this app draws.
 *
 * `Object.hasOwn` rather than `in`, which walks the prototype chain and would
 * accept 'constructor' and 'toString' as turns.
 */
function readTurn(raw: unknown): TurnKind {
  if (typeof raw !== 'string' || !Object.hasOwn(TURN_KINDS, raw)) return 'straight';
  return raw as TurnKind;
}

/** One instruction on the way, in the order it is driven. */
export interface Maneuver {
  /** The router's own sentence: "Turn right onto West 119th Street." */
  readonly instruction: string;
  /** The street it puts you on, or '' where the router names none. */
  readonly street: string;
  readonly miles: number;
  readonly seconds: number;
  readonly turn: TurnKind;
  /**
   * Index into `shape`, across the WHOLE route.
   *
   * The endpoint has already added each leg's offset, so this indexes the line
   * this object carries rather than one leg of it.
   */
  readonly beginShapeIndex: number;
}

export interface PlannedRoute {
  readonly shape: readonly RoutePoint[];
  readonly miles: number;
  readonly seconds: number;
  /** How many readers the router was told to keep out of. */
  readonly avoided: number;
  /**
   * The turns, in driving order.
   *
   * EMPTY IS A LEGITIMATE ANSWER, not an error - a route from a fixture or from
   * a router build that returns no maneuvers still draws its line and still
   * counts the readers on it. Nothing here refuses a route for having no turn
   * list, because the line is the part the product depends on.
   */
  readonly maneuvers: readonly Maneuver[];
}

export class RouteRefused extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.name = 'RouteRefused';
    this.code = code;
  }
}

/**
 * The server's own sentence, not a generic one.
 *
 * These endpoints answer "no driving route avoids all of those" and "that is
 * further than this API will plan", which are things a driver can act on.
 * Replacing them with "routing failed" throws away the only useful part.
 */
async function readError(response: Response): Promise<RouteRefused> {
  let code = 'unknown';
  let detail = `the router answered ${String(response.status)}`;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;
      if (typeof record['error'] === 'string') code = record['error'];
      if (typeof record['detail'] === 'string') detail = record['detail'];
    }
  } catch {
    // A non-JSON body is worth reporting as its status alone.
  }
  return new RouteRefused(code, detail);
}

/**
 * Look up a place by name. Called from a PRESS, never from a keystroke.
 *
 * `near` only biases the answer toward the driver's part of the country; it
 * does not restrict it, so planning a trip to another state still works. See
 * `viewboxAround` in the endpoint.
 */
export async function findPlaces(
  query: string,
  near: RoutePoint | null,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly Place[]> {
  const url = new URL(PLACE_URL, globalThis.location?.origin ?? 'https://darkroute.ai');
  url.searchParams.set('q', query);
  if (near !== null) url.searchParams.set('near', `${String(near.lat)},${String(near.lon)}`);

  const response = await fetchImpl(url.toString());
  if (!response.ok) throw await readError(response);

  const body = (await response.json()) as { places?: unknown };
  if (!Array.isArray(body.places)) return [];
  return body.places as readonly Place[];
}

export interface RouteRequest {
  readonly from: RoutePoint;
  readonly to: RoutePoint;
  /**
   * The readers to route around. Empty means "just get me there" - which is a
   * legitimate request, and is what a driver gets before they press the key
   * that says to avoid anything.
   */
  readonly avoid: readonly RoutePoint[];
}

/**
 * The turn list off the wire, checked rather than cast.
 *
 * The endpoint builds this and the endpoint is ours, so the temptation is to
 * cast the array and move on. It is checked anyway for one reason: `turn` picks
 * the ARROW the driver sees, and an unrecognised value cast through would
 * render as nothing or as whatever the last branch of a switch happened to be.
 * An unknown kind becomes 'straight', which is the same fallback the endpoint
 * uses for a maneuver code it cannot name, and the instruction text beside it
 * is the router's own either way.
 *
 * A malformed entry is DROPPED rather than failing the route. The line and the
 * cameras on it are what this app is for; losing one row of the turn list is
 * not worth refusing a drive over.
 */
function readManeuvers(raw: unknown): readonly Maneuver[] {
  if (!Array.isArray(raw)) return [];
  const out: Maneuver[] = [];
  for (const entry of raw as readonly Record<string, unknown>[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (typeof entry['instruction'] !== 'string') continue;
    /*
     * WHOLE AND NON-NEGATIVE, because this names a shape POINT and not a
     * distance. `nextManeuver` walks whole segments from the driver to the
     * turn, so a 4.5 off the wire makes it count segment 4 entire and report
     * the turn half a segment further away than it is - and a negative one
     * only survives downstream because that function clamps it. The endpoint
     * already rounds and drops negatives; doing the same here keeps the two
     * ends of the wire agreeing about what the field means.
     */
    const begin = entry['beginShapeIndex'];
    if (typeof begin !== 'number' || !Number.isFinite(begin) || begin < 0) continue;
    out.push({
      instruction: entry['instruction'],
      street: typeof entry['street'] === 'string' ? entry['street'] : '',
      miles: typeof entry['miles'] === 'number' ? entry['miles'] : 0,
      seconds: typeof entry['seconds'] === 'number' ? entry['seconds'] : 0,
      turn: readTurn(entry['turn']),
      beginShapeIndex: Math.round(begin),
    });
  }
  return out;
}

/** Ask for a route. Resolves with the line to draw and what it cost. */
export async function planRoute(
  request: RouteRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<PlannedRoute> {
  const url = new URL(ROUTE_URL, globalThis.location?.origin ?? 'https://darkroute.ai');
  url.searchParams.set('from', `${String(request.from.lat)},${String(request.from.lon)}`);
  url.searchParams.set('to', `${String(request.to.lat)},${String(request.to.lon)}`);
  if (request.avoid.length > 0) {
    url.searchParams.set(
      'avoid',
      request.avoid.map((point) => `${String(point.lat)},${String(point.lon)}`).join(';'),
    );
  }

  const response = await fetchImpl(url.toString());
  if (!response.ok) throw await readError(response);

  const body = (await response.json()) as {
    shape?: unknown;
    miles?: unknown;
    seconds?: unknown;
    avoided?: unknown;
    maneuvers?: unknown;
  };
  if (!Array.isArray(body.shape) || body.shape.length === 0) {
    throw new RouteRefused('router_empty', 'the router returned no usable route.');
  }
  return {
    shape: body.shape as readonly RoutePoint[],
    miles: typeof body.miles === 'number' ? body.miles : 0,
    seconds: typeof body.seconds === 'number' ? body.seconds : 0,
    avoided: typeof body.avoided === 'number' ? body.avoided : 0,
    maneuvers: readManeuvers(body.maneuvers),
  };
}
