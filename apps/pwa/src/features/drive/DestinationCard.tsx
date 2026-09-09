/**
 * THE DESTINATION CARD - where you are going, what is on the way, and the one
 * key that steers around it.
 *
 * =============================================================================
 * WHAT IT REPLACED
 * =============================================================================
 * "Route around all 9" used to open Google Maps with the readers turned into
 * via-points. Two things were wrong with that and neither was going to improve:
 * it posted the driver's origin and destination to a maps company, and
 * via-points are not avoidance - a point says "go through here", and what a
 * driver wants is "do not go through there".
 *
 * The route is planned by this app now, through this app's own endpoint, with
 * each reader as a polygon the router may not enter. Nothing opens. Nothing
 * hands off. The line is drawn on DarkRoute's own map.
 *
 * =============================================================================
 * THE NUMBERS ON IT ARE MEASURED, INCLUDING THE UNFLATTERING ONE
 * =============================================================================
 * The card shows what the detour COSTS - the extra miles and the extra minutes
 * against the plain route - because a driver deciding whether to take it is
 * entitled to both halves. An avoidance feature that shows only the cameras
 * avoided, and not the twelve minutes it added, is selling rather than
 * reporting.
 *
 * When the router says no route avoids all of them, the card says exactly that
 * in the server's own words rather than "routing failed", because "try fewer of
 * them" is something a person can act on and "failed" is not.
 */

import type { ReactElement } from 'react';

import type { CameraRecord } from '../../stores/cameras.ts';
import type { Destination, RouteStatus } from '../../stores/route.ts';
import type { PlannedRoute } from '../../services/route/planRoute.ts';

import './destinationCard.css';

/**
 * Said while the two requests are in flight.
 *
 * "Finding a way around them", not "finding a way": setting a destination now
 * builds the dark route, and the sentence should say which of the two questions
 * is being answered while somebody waits on it.
 */
export const DEST_PLANNING = 'Finding a way around them…';
export const DEST_CLEAR = 'End';
export const DEST_NO_CAMERAS = 'no readers on this route.';

/** "1 reader" / "9 readers" - said the same way everywhere on this screen. */
export function readerCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'reader' : 'readers'}`;
}

/**
 * THE KEY'S OWN WORDS, and they name the thing rather than the mechanism.
 *
 * A route to a destination is the route any map would give you. THE DARK ROUTE
 * is the one this application exists to build: the same destination, with the
 * readers taken out of it. That is the product, so it is what the key says.
 *
 * Four states, written out rather than one label with a number substituted in -
 * that produced "Route around all 0" on a clean corridor and "Route around all
 * 1" beside a single camera.
 */
export function avoidLabel(onRoute: number, avoided: number): string {
  // STILL READERS ON THE LINE after a dark route was built: the key becomes a
  // retry rather than a claim, because pressing it again is genuinely the only
  // thing left to try and calling it "avoided" over a line that passes three
  // would be the lie this card exists not to tell.
  if (avoided > 0 && onRoute > 0) return `Reroute · ${readerCount(onRoute)} still on it`;
  // CLEARED, not asked-for. See `clearedCount`.
  if (avoided > 0) return `Dark route · ${readerCount(clearedCount(avoided, onRoute))} avoided`;
  if (onRoute === 0) return 'Nothing to avoid';
  if (onRoute === 1) return 'Build the dark route · 1 reader';
  return `Build the dark route · ${String(onRoute)} readers`;
}

/**
 * HOW MANY WERE ACTUALLY CLEARED, which is NOT the size of the exclusion set.
 *
 * `planDarkRoute` adds every reader it finds on a line to the avoid set BEFORE
 * it decides whether to stop, on both exit paths - so the readers still on the
 * final route are a SUBSET of the ones the router was asked to keep out of.
 * Printing the exclusion set's size beside the leftovers double-counts them:
 * five excluded with two still there is three cleared, not five.
 *
 * `Math.max` because a future change to the loop's exit could break the subset
 * property, and a card that renders "-1 readers avoided" is worse than one that
 * renders zero.
 */
export function clearedCount(avoided: number, stillOn: number): number {
  return Math.max(0, avoided - stillOn);
}

/**
 * THE LINE UNDER THE FIGURES, and it has to be true.
 *
 * A build reported "2 readers avoided" over a route that passed nine. Both
 * numbers were real - two were excluded, and the road it moved onto had nine of
 * its own - and putting only the flattering one on screen made the app a liar
 * about the single thing it exists to do.
 *
 * So when readers remain, that is what the line leads with, and the figure
 * beside it is what was CLEARED rather than what was asked for.
 */
export function outcomeLine(avoided: number, stillOn: number): string | null {
  if (avoided === 0) return null;
  const cleared = clearedCount(avoided, stillOn);
  if (stillOn === 0) return `${readerCount(cleared)} avoided · clear`;
  return `${readerCount(cleared)} avoided · ${readerCount(stillOn)} could not be`;
}

/**
 * HOW LOUD THE CARD IS, from how many readers are on the line.
 *
 * The owner's words: "the more cameras the colorful the card". This is that,
 * and it deliberately reuses THE ALERT ENGINE'S OWN FOUR STATES rather than
 * inventing a scale - `clear`, `approaching`, `in-range`, `multiple` already
 * mean "none / one / some / a lot of them" everywhere else in this app, so a
 * driver reads this card without learning a second colour language.
 *
 * The thresholds are where the meaning changes rather than round numbers: one
 * reader is a fact, a handful is a road worth reconsidering, and past five the
 * corridor is the problem rather than any particular camera on it.
 */
export type RouteHeat = 'clear' | 'approaching' | 'in-range' | 'multiple';

export function routeHeat(onRoute: number): RouteHeat {
  if (onRoute === 0) return 'clear';
  if (onRoute === 1) return 'approaching';
  if (onRoute <= 5) return 'in-range';
  return 'multiple';
}

/** "18 min", or "1 hr 4 min" once it is long enough for that to be clearer. */
export function describeDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} hr` : `${String(hours)} hr ${String(rest)} min`;
}

/**
 * WHAT THE AVOIDANCE COST, against the route that did not avoid anything.
 *
 * Null when there is nothing to compare against - the first plan of a drive has
 * no baseline, and inventing one would be worse than saying nothing.
 */
export function describeCost(plain: PlannedRoute | null, avoiding: PlannedRoute | null): string | null {
  if (plain === null || avoiding === null) return null;
  const miles = avoiding.miles - plain.miles;
  const minutes = Math.round((avoiding.seconds - plain.seconds) / 60);
  if (miles < 0.05 && minutes < 1) return 'no further, and no slower';
  const parts: string[] = [];
  if (miles >= 0.05) parts.push(`${miles.toFixed(1)} mi further`);
  if (minutes >= 1) parts.push(`${String(minutes)} min longer`);
  return parts.join(' · ');
}

export interface DestinationCardProps {
  readonly destination: Destination;
  readonly route: PlannedRoute | null;
  readonly status: RouteStatus;
  readonly error: string | null;
  /** Readers within the corridor of the CURRENT line. Measured on the phone. */
  readonly onRoute: readonly CameraRecord[];
  /** The readers the current route was planned to avoid. */
  readonly avoiding: readonly CameraRecord[];
  /** The plain route, kept so the card can price the detour. */
  readonly plain: PlannedRoute | null;
  readonly onAvoid: () => void;
  readonly onClear: () => void;
}

export function DestinationCard({
  destination,
  route,
  status,
  error,
  onRoute,
  avoiding,
  plain,
  onAvoid,
  onClear,
}: DestinationCardProps): ReactElement {
  const cost = describeCost(plain, avoiding.length > 0 ? route : null);
  const outcome = outcomeLine(avoiding.length, onRoute.length);

  return (
    <section
      className="fwm-dest"
      aria-label="Destination"
      /* THE HEAT, as an attribute rather than a class, so the CSS reads as one
         ramp of four cases instead of four unrelated modifier classes. */
      data-fwm-dest-heat={route === null ? 'clear' : routeHeat(onRoute.length)}
    >
      <header className="fwm-dest-head">
        <span className="fwm-dest-where">
          <span className="fwm-dest-name">{destination.name}</span>
          {destination.detail === '' ? null : (
            <span className="fwm-dest-detail fwm-data">{destination.detail}</span>
          )}
        </span>
        <button type="button" className="fwm-dest-clear" onClick={onClear}>
          {DEST_CLEAR}
        </button>
      </header>

      {status === 'planning' ? (
        <p className="fwm-dest-line fwm-data">{DEST_PLANNING}</p>
      ) : status === 'failed' ? (
        /* The server's own sentence. It names the constraint - "no driving
           route avoids all of those" - and that is the part a driver can do
           something about. */
        <p className="fwm-dest-failed fwm-data" role="status">
          {error ?? 'that could not be planned.'}
        </p>
      ) : route === null ? null : (
        <>
          <p className="fwm-dest-figures">
            <span className="fwm-dest-eta">{describeDuration(route.seconds)}</span>
            <span className="fwm-dest-miles fwm-data">{route.miles.toFixed(1)} mi</span>
            <span className="fwm-dest-readers fwm-data">
              {onRoute.length === 0 ? DEST_NO_CAMERAS : `${readerCount(onRoute.length)} on the way`}
            </span>
          </p>
          {/* WHAT IT ACHIEVED, and what it could not. See `outcomeLine`. */}
          {outcome === null ? null : (
            <p
              className="fwm-dest-outcome fwm-data"
              data-fwm-dest-clear={String(onRoute.length === 0)}
            >
              {outcome}
            </p>
          )}
          {cost === null ? null : (
            /* THE PRICE OF THE DETOUR, shown whether or not it flatters the
               feature. See the note at the top of this file. */
            <p className="fwm-dest-cost fwm-data">{cost}</p>
          )}
        </>
      )}

      <button
        type="button"
        className="fwm-dest-avoid"
        disabled={status === 'planning' || (onRoute.length === 0 && avoiding.length === 0)}
        onClick={onAvoid}
      >
        {avoidLabel(onRoute.length, avoiding.length)}
      </button>
    </section>
  );
}
