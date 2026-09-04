/**
 * ROUTE VIA - hand a maps app a route with STOPS in it.
 *
 * =============================================================================
 * WHY THIS IS NOT `navigateTo`
 * =============================================================================
 * `navigateTo` hands over a DESTINATION: one point, through the `geo:` scheme,
 * which opens the phone's own app chooser and puts nothing on a network. That
 * is the right shape for "show me this camera" and it is deliberately the only
 * thing that file will do.
 *
 * A detour is not one point. `planDetour` returns an ORDERED LIST of places to
 * travel via, and a list of stops is the whole feature: one waypoint is a jog,
 * a sequence is a route around a run of cameras. No URI scheme that goes
 * through an OS chooser carries waypoints - not `geo:`, not
 * `google.navigation:` - so the only handoff that can express this is an HTTPS
 * directions URL, which is exactly the thing `navigateTo`'s header says the
 * browser must not request.
 *
 * =============================================================================
 * SO THIS CROSSES A LINE, AND IT MAY ONLY BE CROSSED BY ASKING
 * =============================================================================
 * Opening this URL is a request to Google carrying an IP address, a timestamp
 * and the points below. That is a real disclosure and it cannot be engineered
 * away - the alternative is not a private multi-stop handoff, it is no
 * multi-stop handoff.
 *
 * THE RULE THIS MODULE IS BUILT AROUND: nothing calls `routeVia` except a
 * surface that has already put the disclosure in front of the driver and taken
 * an explicit yes. `features/drive/DetourOffer.tsx` is that surface and is the
 * only caller. No default, no remembered answer, no silent send. A future
 * caller that skips the prompt is the defect; there is no platform check here
 * that would catch it, because there is no platform on which this is safe
 * without asking.
 *
 * =============================================================================
 * WHAT IS DELIBERATELY NOT IN THE URL
 * =============================================================================
 * THE ORIGIN. Google Maps routes from the device's own location when no
 * `origin` is given, and it already has that location under its own permission
 * with nothing from us - the argument `navigateTo` makes about turn-by-turn,
 * unchanged. So the driver's fix is never a parameter.
 *
 * THE REASON. No label, no note, nothing that says these points have anything
 * to do with cameras. The URL is a route; that it is a counter-surveillance
 * route is this phone's business.
 *
 * WHAT REMAINS DISCLOSED, and what the prompt therefore has to say out loud:
 * every point here is SYNTHETIC - a stop pushed a clearance off to one side,
 * and an end point out along the heading - so none of them is a place the
 * driver has been. Together, though, they bound where the car is now and which
 * way it is pointing to within a few thousand feet. That is the disclosure.
 * Saying "we never send your location" because the literal fix is absent would
 * be the kind of true-but-misleading claim this product does not make.
 */

import { MAX_HANDOFF_WAYPOINTS } from '../../stores/fwmCore.ts';

import { browserOpener, coord } from './navigateTo.ts';
import type { NavigateOpener } from './navigateTo.ts';

/**
 * WHO RECEIVES IT, in the words the prompt puts in front of the driver.
 *
 * One constant, so the adapter that makes the request and the sentence that
 * asks permission for it can never name different companies.
 */
export const ROUTE_VIA_SERVICE = 'Google Maps';

/** The host the request actually goes to. */
export const ROUTE_VIA_HOST = 'www.google.com';

export interface RouteViaPoint {
  readonly lat: number;
  readonly lon: number;
}

export interface RouteViaRequest {
  /** Where the route ends. */
  readonly destination: RouteViaPoint;
  /** The stops, in the order they are met. At least one - see `routeVia`. */
  readonly via: readonly RouteViaPoint[];
}

export type RouteViaOutcome = 'opened' | 'unavailable' | 'invalid';

export interface RouteViaOptions {
  readonly opener?: NavigateOpener | null;
}

function onEarth(point: RouteViaPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
  );
}

/** `38.9,-94.67` at the shared precision. See `coord` in `navigateTo.ts`. */
function pair(point: RouteViaPoint): string {
  return `${coord(point.lat)},${coord(point.lon)}`;
}

/**
 * A route with no stops is not a detour.
 *
 * Refusing it rather than opening a plain destination matters: a driver who
 * pressed a key called "route around" and got directions to a point two miles
 * ahead has been handed a route that avoids nothing, under a label that says
 * it does.
 *
 * More than the cap is refused too. Google truncates a longer `waypoints` list
 * silently, so a route the app believed had twelve stops would open with nine
 * and no indication which three were dropped. `planDetour` already caps and
 * REPORTS what it discarded; this is the boundary refusing to let a caller
 * that skipped the cap turn it into a quiet omission.
 */
export function routeIsSendable(request: RouteViaRequest): boolean {
  if (request.via.length === 0 || request.via.length > MAX_HANDOFF_WAYPOINTS) return false;
  return onEarth(request.destination) && request.via.every(onEarth);
}

/**
 * The URL, built and not opened.
 *
 * Separate from `routeVia` so a test can read what would be sent without
 * anything being sent, which is the assertion that matters most in this file.
 */
export function routeViaUrl(request: RouteViaRequest): string {
  const params = new URLSearchParams({
    // The documented Maps URLs form. Without `api=1` the path is a legacy one
    // whose parameter names differ and whose waypoint support does not exist.
    api: '1',
    destination: pair(request.destination),
    waypoints: request.via.map(pair).join('|'),
    travelmode: 'driving',
  });
  return `https://${ROUTE_VIA_HOST}/maps/dir/?${params.toString()}`;
}

/**
 * Open it. Only from a surface that has already taken an explicit yes.
 *
 * There is no user-agent gate, and its absence is deliberate: `navigateTo`
 * hides itself on iOS because iOS would have turned a silent `geo:` handoff
 * into an unannounced HTTPS request. This handoff is an HTTPS request on every
 * platform and is announced on every platform, so a platform check would not
 * be protecting anybody - it would only be withholding the feature from iPhone
 * drivers who had already been asked and had already said yes.
 */
export function routeVia(
  request: RouteViaRequest,
  options: RouteViaOptions = {},
): RouteViaOutcome {
  if (!routeIsSendable(request)) return 'invalid';
  const opener = options.opener === undefined ? browserOpener() : options.opener;
  if (opener === null) return 'unavailable';

  opener.open(routeViaUrl(request));
  return 'opened';
}
