/**
 * NAVIGATE HERE - hand a camera's position to whatever maps app the phone has.
 *
 * The intel card can already tell a driver a camera is 1.5 miles north-east.
 * It could not get them there, and "there" is the one thing every phone
 * already has an app for.
 *
 * WHY `geo:` ONLY
 *   `geo:lat,lon` is the RFC 5870 scheme. On Android it opens the OS chooser -
 *   Google Maps, Waze, OsmAnd, whatever the driver actually uses - rather than
 *   deciding for them, which matters in a product whose users have opinions
 *   about Google.
 *
 * WHY iOS IS UNAVAILABLE
 *   iOS does not register `geo:`. Falling back to a Google HTTPS URL would turn
 *   the camera coordinate - or a waypoint derived from the driver's live fix -
 *   into a network request carrying an IP address and timestamp. The browser
 *   must not make that request, so callers hide the action on iOS and this
 *   adapter refuses it if a caller reaches the boundary anyway.
 *
 * THE PRIVACY LINE THIS DOES NOT CROSS
 *   There is no `saddr`/origin parameter here and there never should be: it
 *   would put the driver's position into a URL, a browser history and someone
 *   else's server log, which is the exact thing the tile sync was designed to
 *   avoid. Turn-by-turn needs an origin, and every maps app uses the device's
 *   own location for that - which it already has, under its own permission,
 *   with nothing from us. So this hands over a destination, not a journey.
 *
 * =============================================================================
 * THE LINE THE *CALLER* CAN CROSS, AND ONE OF THEM DOES
 * =============================================================================
 * This block used to say "The URL carries the CAMERA's coordinates. It never
 * carries the driver's." The first sentence is true of the INTEL card, which
 * navigates to a camera. It is FALSE OF REROUTE, and the difference is not
 * something this file can see: it receives a `NavigateTarget`, and a target
 * derived from the driver's fix is indistinguishable from one read off a tile.
 *
 * `rerouteWaypoint` returns `origin.lat + …`, `origin.lon + …` where `origin`
 * is the live GPS fix (`RadarScreen.tsx`, the `onReroute` handler) and the two
 * offsets are the exported constants `REROUTE_LEAD_FT` and
 * `REROUTE_OFFSET_FT`. The result is a pure translation of the driver's
 * position by a publicly known 2.06 miles at a bearing derived from their
 * heading - measured in `features/radar/reroute.test.ts`.
 *
 * On platforms that register it, that point goes into a `geo:` OS intent. On
 * iOS this adapter returns `unavailable` before opening anything. That guard is
 * deliberately here as well as in the controls: a future caller cannot quietly
 * restore the HTTPS disclosure by forgetting the presentation-layer check.
 */

export interface NavigateTarget {
  readonly lat: number;
  readonly lon: number;
  /** Shown as the pin's name where the platform supports it. */
  readonly label?: string;
}

export interface NavigateOpener {
  open(url: string): void;
}

export type NavigateOutcome = 'opened' | 'unavailable' | 'invalid';

/**
 * Five decimals is ~1.1 m - the precision the tiles carry, and no more.
 *
 * EXPORTED so `routeVia.ts` cannot invent a second rounding rule. How much
 * precision leaves the phone is a privacy decision, and a product with two
 * copies of it has two of them to keep in agreement.
 */
export function coord(value: number): string {
  return String(Math.round(value * 1e5) / 1e5);
}

function valid(target: NavigateTarget): boolean {
  return (
    Number.isFinite(target.lat) &&
    Number.isFinite(target.lon) &&
    Math.abs(target.lat) <= 90 &&
    Math.abs(target.lon) <= 180
  );
}

/**
 * `geo:` with a `q` so the pin carries a label. The label is percent-encoded;
 * a camera id is ours and tame, but a name from a record is not.
 */
export function geoUrl(target: NavigateTarget): string {
  const point = `${coord(target.lat)},${coord(target.lon)}`;
  const label = target.label === undefined ? point : `${point}(${encodeURIComponent(target.label)})`;
  return `geo:${point}?q=${label}`;
}

/**
 * Whether this platform is likely to handle `geo:`.
 *
 * There is no way to ask a browser "will this scheme resolve" - a failed
 * `geo:` navigation is silent, which is precisely why guessing wrong is
 * expensive. iOS never registers it, so the user agent is the honest signal
 * available, and everything else gets the scheme that opens a chooser.
 */
export function prefersGeoScheme(userAgent: string): boolean {
  return !/iPad|iPhone|iPod/.test(userAgent);
}

/**
 * The shared presentation guard. Suppress map handoff controls when this is
 * false; `navigateTo` repeats the check so bypassing the UI still fails closed.
 */
export function canUseGeoHandoff(
  userAgent: string = globalThis.navigator?.userAgent ?? '',
): boolean {
  return prefersGeoScheme(userAgent);
}

export interface NavigateOptions {
  readonly opener?: NavigateOpener | null;
  readonly userAgent?: string;
}

export function navigateTo(
  target: NavigateTarget,
  options: NavigateOptions = {},
): NavigateOutcome {
  if (!valid(target)) return 'invalid';
  const opener = options.opener === undefined ? browserOpener() : options.opener;
  if (opener === null) return 'unavailable';

  const ua = options.userAgent ?? globalThis.navigator?.userAgent ?? '';
  if (!canUseGeoHandoff(ua)) return 'unavailable';

  opener.open(geoUrl(target));
  return 'opened';
}

/**
 * `noopener,noreferrer`: the opened page cannot reach back through
 * `window.opener`, and no referrer records which of our screens sent them.
 */
export function browserOpener(): NavigateOpener | null {
  if (typeof globalThis.window === 'undefined') return null;
  return {
    open(url: string): void {
      globalThis.window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}
