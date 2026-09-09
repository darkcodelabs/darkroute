/**
 * THE NAVIGATION CARD - the drive in progress. Where you are going, every turn
 * between here and there, and the reader you are about to pass.
 *
 * =============================================================================
 * ONE CARD, AND NO SMALL VERSION OF IT
 * =============================================================================
 * DRIVE used to put a destination card and a closest-camera card on the map at
 * the same time, each with its own expand/collapse, and a driver at 70mph got
 * to decide which of two overlapping panels to read. That is gone. There is one
 * card on screen: this one while a route is planned, the monitor card when
 * there is no destination, and no mini variant of either. A card that can be
 * shrunk to a stub is a camera that can go unnoticed, and a second card beside
 * it is a question nobody asked to be given.
 *
 * =============================================================================
 * IT IS PRESENTATIONAL, AND THAT IS LOAD-BEARING
 * =============================================================================
 * Every figure on this card arrives as a prop, already measured and already
 * formatted. Nothing here reads a store, asks a service or starts a request -
 * a routing request carries a driver's position AND their destination, which is
 * precisely the record an ALPR network exists to build, and it is not something
 * a render should be able to cause. `services/route/planRoute.ts` says the same
 * thing about itself; this is the other end of that promise.
 *
 * =============================================================================
 * THE NUMBERS INCLUDE THE UNFLATTERING ONES
 * =============================================================================
 * The same rule the destination card was built on. A build once reported
 * "2 readers avoided" over a line that passed nine, and both numbers were real.
 * So this card leads with what is STILL on the line, prints what the detour
 * cost in miles and minutes, and says "could not be" out loud. An avoidance
 * feature that shows only the cameras avoided is selling rather than reporting.
 */

import type { ReactElement } from 'react';

import { ClosestPanel, type ClosestPanelProps } from './ClosestPanel.tsx';

import './navigationCard.css';

/** The key that abandons the route. Same word the destination card used. */
export const NAV_END = 'End';
/** Said while the two requests are in flight. See the status prop. */
export const NAV_PLANNING = 'Finding a way around them…';
/** The last resort, when the refusal carried no sentence of its own. */
export const NAV_FAILED = 'that route could not be planned.';

/** Said when the planned line passes nothing. */
export const NAV_CLEAR = 'no readers on this route.';

/**
 * "1 reader" / "9 readers" - and never "1 readers".
 *
 * `DestinationCard` says this same sentence through its own `readerCount`, and
 * this is deliberately not an import of it: this card and the monitor card are
 * what REPLACE that one, and carrying a dependency on a component on its way
 * out means deleting it later breaks the screen that replaced it. The sentence
 * is four words long; the coupling would have outlived it.
 */
export function readers(count: number): string {
  return `${String(count)} ${count === 1 ? 'reader' : 'readers'}`;
}

/**
 * EVERY DISTANCE ON THIS CARD IS HANDED IN BARE, and the card writes the unit.
 *
 * `miles` is '23.0', not '23.0 mi', in the props of the card, of each turn and
 * of the arrival - and one function puts "mi" on all three. The alternative was
 * a caller formatting some of them and not others, which is how a turn list
 * ends up reading "1.2 mi" above "0.4" on the same drive.
 */
export function milesLabel(miles: string): string {
  return `${miles} mi`;
}

/**
 * WHAT IS STILL ON THE LINE, which is the first thing this card owes a driver.
 *
 * Stated even when the answer is none, because "no readers on this route" is a
 * result and an empty space is not - a driver who sees nothing cannot tell
 * whether the app checked.
 */
export function onTheWayLine(onLine: number): string {
  if (onLine === 0) return NAV_CLEAR;
  return `${readers(onLine)} on the way`;
}

/**
 * WHAT THE ROUTE ACHIEVED, and what it could not.
 *
 * `cleared` is what was ACTUALLY avoided, not the size of the exclusion set the
 * router was handed - the readers still on the final line are a subset of the
 * ones it was told to keep out of, so printing the exclusion count beside the
 * leftovers double-counts them. The caller does that subtraction; this only
 * refuses to bury the second half of it.
 *
 * Null before anything has been avoided, because "0 readers avoided" on the
 * first plain route of a drive is noise rather than news.
 */
export function avoidedLine(cleared: number, onLine: number): string | null {
  if (cleared === 0) return null;
  if (onLine === 0) return `${readers(cleared)} avoided · clear`;
  return `${readers(cleared)} avoided · ${readers(onLine)} could not be`;
}

/**
 * The turns this card knows how to draw an arrow for.
 *
 * Declared here rather than imported from `services/route/planRoute.ts` on
 * purpose: this card renders strings and takes no dependency on the router's
 * types, so the two can be changed on different days without one build blocking
 * the other. `turnBody` below is what absorbs the difference if they ever drift.
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
 * THE ARROWS, DRAWN RATHER THAN LOADED.
 *
 * Every one of these is geometry in a 24x24 box painted in `currentColor`, and
 * it has to be: DarkRoute ships nineteen themes, several of them light, and a
 * raster arrow is one colour forever. On `paper` and `e-ink` a white PNG is an
 * invisible turn. Stroke width, cap and join are declared once on
 * `.fwm-nav-glyph` in this component's own stylesheet, so the paint travels
 * with the drawing instead of arriving from a sheet nobody imported.
 *
 * They are read the same way throughout: the shaft starts at the bottom of the
 * box, because that is where the driver is, and the head is a chevron drawn
 * through the tip so a 45-degree turn and a 90-degree one are told apart by the
 * angle of the arm rather than by the length of the line.
 *
 * A `Record<TurnKind, ...>` so a fourteenth kind cannot be added to the union
 * without somebody drawing it, which is the compile-time version of "never
 * substitute a character from the font".
 */
const TURN_GLYPH: Record<TurnKind, ReactElement> = {
  // START - the pin you set off from, and the road out of it.
  start: (
    <>
      <circle className="fwm-nav-glyph-fill" cx="12" cy="18" r="2.4" />
      <path d="M12 15.6 V6" />
      <path d="M8.5 9.5 L12 6 L15.5 9.5" />
    </>
  ),
  // ARRIVE - the checkered flag. Also the last row of every turn list.
  arrive: (
    <>
      <path d="M6.5 21 V4" />
      <rect x="6.5" y="4" width="12" height="8" />
      <rect className="fwm-nav-glyph-fill" x="6.5" y="4" width="3" height="4" />
      <rect className="fwm-nav-glyph-fill" x="12.5" y="4" width="3" height="4" />
      <rect className="fwm-nav-glyph-fill" x="9.5" y="8" width="3" height="4" />
      <rect className="fwm-nav-glyph-fill" x="15.5" y="8" width="3" height="4" />
    </>
  ),
  straight: (
    <>
      <path d="M12 21 V6" />
      <path d="M8.5 9.5 L12 6 L15.5 9.5" />
    </>
  ),
  left: (
    <>
      <path d="M15 21 V11.5 A2.5 2.5 0 0 0 12.5 9 H6" />
      <path d="M9.5 5.5 L6 9 L9.5 12.5" />
    </>
  ),
  right: (
    <>
      <path d="M9 21 V11.5 A2.5 2.5 0 0 1 11.5 9 H18" />
      <path d="M14.5 5.5 L18 9 L14.5 12.5" />
    </>
  ),
  // SHARP - the shaft climbs past the junction before it doubles back, which is
  // what tells the eye this is more than the ninety degrees of `left`/`right`.
  'sharp-left': (
    <>
      <path d="M15 21 V8.5 L7.5 14.5" />
      <path d="M12 14.5 L7.5 14.5 L7.5 10" />
    </>
  ),
  'sharp-right': (
    <>
      <path d="M9 21 V8.5 L16.5 14.5" />
      <path d="M12 14.5 L16.5 14.5 L16.5 10" />
    </>
  ),
  'slight-left': (
    <>
      <path d="M15 21 V13.5 L7 5.5" />
      <path d="M11.5 5.5 L7 5.5 L7 10" />
    </>
  ),
  'slight-right': (
    <>
      <path d="M9 21 V13.5 L17 5.5" />
      <path d="M12.5 5.5 L17 5.5 L17 10" />
    </>
  ),
  uturn: (
    <>
      <path d="M8 21 V11 A4 4 0 0 1 16 11 V17" />
      <path d="M12.5 13.5 L16 17 L19.5 13.5" />
    </>
  ),
  // MERGE - your lane bending into a road that was already there.
  merge: (
    <>
      <path d="M16 21 V6" />
      <path d="M12.5 9.5 L16 6 L19.5 9.5" />
      <path d="M7.5 21 V16 C7.5 12 16 14 16 10" />
    </>
  ),
  // RAMP - the mirror of merge: the through road carries on, you leave it.
  ramp: (
    <>
      <path d="M8 21 V5" />
      <path d="M8 14 C8 10 16 11 16 6" />
      <path d="M12.5 9.5 L16 6 L19.5 9.5" />
    </>
  ),
  roundabout: (
    <>
      <circle cx="12" cy="10" r="4" />
      <path d="M12 21 V14" />
      <path d="M16 10 H19" />
      <path d="M15.5 6.5 L19 10 L15.5 13.5" />
    </>
  ),
};

/**
 * THE SAME DRAWINGS, KEYED BY A WORD THIS CARD DID NOT CHOOSE.
 *
 * A `Map` rather than an index straight into `TURN_GLYPH`, and that is not
 * style: `turn` arrives over the wire, and an object literal inherits
 * `constructor`, `toString` and the rest from `Object.prototype`, so a router
 * that ever emits one of those words would have handed a function to React
 * where an arrow belongs. A `Map` has no inherited keys to hit. It is built
 * once at module load rather than walked per row, because a cross-metro drive
 * is forty of these rows re-rendering behind a live map.
 */
const TURN_LOOKUP = new Map<string, ReactElement>(Object.entries(TURN_GLYPH));

/**
 * WHY THIS TAKES A STRING AND NOT A `TurnKind`.
 *
 * The kind comes off the router, over the wire, and this build does not get to
 * assume it has heard of every word Valhalla will ever send. A card that
 * renders nothing where the arrow goes is worse than one that renders
 * straight-ahead: the row loses its shape, the connector line breaks, and the
 * instruction beside it is still perfectly correct - it is only the picture
 * that is unknown, so the picture is what degrades.
 */
function turnBody(turn: string): ReactElement {
  return TURN_LOOKUP.get(turn) ?? TURN_GLYPH.straight;
}

function TurnGlyph({ turn }: { readonly turn: string }): ReactElement {
  return (
    <svg className="fwm-nav-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {turnBody(turn)}
    </svg>
  );
}

export interface NavigationCardProps {
  readonly destination: { readonly name: string; readonly detail: string };
  /** '34 min', already spelled out by the caller. */
  readonly eta: string;
  /** '23.0'. The unit is this card's to write; see `milesLabel`. */
  readonly miles: string;
  /** Readers still on the final line. */
  readonly onLine: number;
  /** Readers actually avoided - cleared, not the size of the exclusion set. */
  readonly cleared: number;
  /** '1.2 mi further · 6 min longer', or null when there is no baseline yet. */
  readonly cost: string | null;
  readonly turns: readonly {
    readonly key: string;
    readonly turn: string;
    readonly instruction: string;
    readonly miles: string;
  }[];
  readonly arrival: {
    readonly name: string;
    readonly detail: string;
    readonly eta: string;
    readonly miles: string;
  };
  readonly onReroute: () => void;
  readonly rerouteLabel: string;
  readonly onEnd: () => void;
  readonly closest: ClosestPanelProps | null;
  /**
   * WHAT THE ROUTE IS DOING, so this card can hold the whole navigating state.
   *
   * The old destination card owned "finding a way" and "the router refused",
   * and this one replaced it. Without these the screen would fall back to the
   * MONITOR card for the second or two a plan takes - flicking between the two
   * modes on a press, which is exactly what the one-card ruling forbids.
   *
   * `error` is the SERVER'S OWN SENTENCE. "No driving route avoids all of
   * those, try again with fewer" tells a driver what to do next; "failed" does
   * not.
   */
  readonly status: 'idle' | 'planning' | 'ready' | 'failed';
  readonly error: string | null;
}

export function NavigationCard({
  destination,
  eta,
  miles,
  onLine,
  cleared,
  cost,
  turns,
  arrival,
  onReroute,
  rerouteLabel,
  onEnd,
  closest,
  status,
  error,
}: NavigationCardProps): ReactElement {
  const avoided = avoidedLine(cleared, onLine);
  const clear = String(onLine === 0);

  return (
    <section className="fwm-nav" aria-label={`Route to ${destination.name}`}>
      {/* THE THIRD COLUMN IS FIRST IN THE SOURCE, and that is the layout
          decision rather than an accident of markup.

          The design is landscape and three across, with the closest-camera
          panel on the right. This application is portrait-first on a phone, so
          the columns stack far more often than they sit side by side - and
          stacked, the reader you are about to pass outranks the destination you
          reach in half an hour and the turn you make after that. Source order
          is what a screen reader and a keyboard follow, so the phone case is
          the one the source is written for; `navigationCard.css` puts this back
          in column three when there is room for three columns. */}
      <div className="fwm-nav-cols">
        {/* THE READER COLUMN IS THIRD IN THE PICTURE AND FIRST IN THE MARKUP.
            The reader you are about to pass outranks the destination you reach
            in half an hour, so it leads for a screen reader and for the tab
            key; `navigationCard.css` orders it to the end. It is byte-identical
            to monitor column one - see `ClosestPanel`. */}
        {closest === null ? null : <ClosestPanel {...closest} />}

        <div className="fwm-nav-col fwm-nav-plan">
          {/* LINE ONE: THE ETA, THE DISTANCE AND WHERE YOU ARE GOING, in that
              order and on ONE line - the design's layout, and the reason it
              works is that the two figures are what a driver checks at a light
              and the destination is what they check once. The name is
              right-aligned and truncates; the figures never do. */}
          {status === 'planning' ? (
            <p className="fwm-nav-status fwm-data" role="status">
              {NAV_PLANNING}
            </p>
          ) : status === 'failed' ? (
            <p className="fwm-nav-failed fwm-data" role="status">
              {error ?? NAV_FAILED}
            </p>
          ) : (
            <p className="fwm-nav-figures">
              <span className="fwm-nav-eta fwm-data">{eta}</span>
              <span className="fwm-nav-miles fwm-data">{milesLabel(miles)}</span>
              <span className="fwm-nav-name fwm-data">{destination.name}</span>
            </p>
          )}

          {/* LINE TWO: the address and what the detour costs, joined. Two facts
              that are both "about this drive rather than about this moment", so
              the design gives them one quiet line instead of two. */}
          {status === 'planning' || status === 'failed' ? null : (
            <p className="fwm-nav-detail fwm-data">
              {[destination.detail, cost]
                .filter((part): part is string => part !== null && part !== '')
                .join(' · ')}
            </p>
          )}

          {/* LINE THREE: what is still on the line, and what was cleared. The
              dot carries the warning hue so the sentence does not have to shout
              it, and the avoided count sits right where the design puts it -
              the honest half of the same fact. */}
          {status === 'planning' || status === 'failed' ? null : (
            <p className="fwm-nav-online" data-fwm-nav-clear={clear}>
              <span className="fwm-nav-online-dot" aria-hidden="true" />
              <span className="fwm-nav-online-say fwm-data">{onTheWayLine(onLine)}</span>
              {avoided === null ? null : (
                <span className="fwm-nav-avoided fwm-data">{avoided}</span>
              )}
            </p>
          )}

          {/* REROUTE AND END SHARE THE ROW, as the owner drew it: the wide
              filled key does the thing you are here for, and END sits beside it
              as an outline so it reads as the way out rather than as a second
              offer. END is the only caller of `routeActions.clear()` in the app
              - without it a driver who starts a route cannot stop one - which is
              why it is here rather than dropped with the rest of the header. */}
          {status === 'planning' ? null : (
            <div className="fwm-nav-actions">
              <button type="button" className="fwm-nav-reroute" onClick={onReroute}>
                {`➤ ${rerouteLabel}`}
              </button>
              <button type="button" className="fwm-nav-end" onClick={onEnd}>
                {NAV_END}
              </button>
            </div>
          )}
        </div>

        <div className="fwm-nav-col fwm-nav-list">
          {/* An ordered list because the order is the content: these are the
              turns in driving order, and a screen reader announcing "3 of 11"
              is telling a driver something the visual list says with its own
              connector line. */}
          <ol className="fwm-nav-turns">
            {turns.map((row) => (
              <li className="fwm-nav-turn" key={row.key}>
                <span className="fwm-nav-turn-glyph">
                  <TurnGlyph turn={row.turn} />
                </span>
                <span className="fwm-nav-turn-say">
                  <span className="fwm-nav-turn-instruction">{row.instruction}</span>
                  <span className="fwm-nav-turn-far fwm-data">{milesLabel(row.miles)}</span>
                </span>
              </li>
            ))}

            {/* ALWAYS DRAWN, EVEN WITH NO TURNS ABOVE IT. A route the router
                returned no maneuvers for still ends somewhere, and a turn list
                that renders as nothing at all looks like a card that failed
                rather than a drive that is a straight line. */}
            <li className="fwm-nav-turn fwm-nav-arrive">
              <span className="fwm-nav-turn-glyph">
                <TurnGlyph turn="arrive" />
              </span>
              <span className="fwm-nav-turn-say">
                <span className="fwm-nav-turn-instruction">{`Arrive at ${arrival.name}`}</span>
                <span className="fwm-nav-turn-far fwm-data">{arrival.detail}</span>
              </span>
              <span className="fwm-nav-arrive-figures">
                <span className="fwm-nav-arrive-eta fwm-data">{arrival.eta}</span>
                <span className="fwm-nav-arrive-miles fwm-data">{milesLabel(arrival.miles)}</span>
              </span>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
