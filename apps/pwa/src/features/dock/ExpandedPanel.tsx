/**
 * THE EXPANDED PANE. 302px, three views, ONE height.
 *
 * `dockv3.dc.html` publishes two of them and they add up the same way:
 *
 *   C   2 hairline + 84 header + 1 divider + 151 list + 1 divider + 63 tabs
 *   F   2 hairline + 12 + 56 + 32 + 1 divider + 135 list + 1 divider + 63 tabs
 *
 * There is ONE expanded height in the whole app and navigation borrows it
 * rather than inventing a fourth. The list is the only thing that flexes, and
 * it does not flex either -- it is a hard 151 or 135 and it scrolls inside
 * itself. A sheet whose list pushes the pane taller as data arrives is a sheet
 * that moves under a thumb, which is the thing all three locked heights exist
 * to stop.
 *
 * THE THREE VIEWS.
 *
 *   nearby        C. The collapsed dock's own 84px header -- count, headline,
 *                 exposure tier, detour key -- with the readers behind it,
 *                 sorted by distance. This is what tapping the collapsed pane
 *                 opens.
 *   turn-list     F1. The navigation dock's own 56 + 32, with the rest of the
 *                 route under it and each step carrying its camera count.
 *   route-choice  F2. The same header, with the lines you could take instead.
 *                 The faster route is never hidden and never scolded: it
 *                 states its cost in cameras and lets the driver decide.
 *
 * THE HEADER IS NOT REDRAWN FOR F. `NavigationBody` in `DriveRows.tsx` is the
 * 56px maneuver row and the 32px footer, and both F views call it. Expanding
 * during a drive keeps the maneuver row and the footer exactly where they were
 * and grows a list underneath; drawing that pair a second time here is how the
 * expanded dock ends up one weight or half a pixel away from the row it
 * expanded from.
 *
 * NO GRABBER. V3 deletes it along with the expand chevron -- the whole pane is
 * the target, in both directions -- so there is no 40x4 pull tab at the top of
 * this sheet and no `onCollapse` for it to call. The bar under the tab row
 * went with it; it duplicated the system gesture bar.
 *
 * THE HEAD IS AN ELEMENT AND THE LIST IS THE FLEXIBLE ONE. `.fwm-dock-body`
 * carries no padding in the expanded pane -- the collapsed and navigating panes
 * take theirs from `dock.css`, and the two heads here are different heights, 84
 * for C and 100 for F -- so the pane's own 12 and 4 are the head's padding and
 * `data-fwm-head` says which. The list underneath is `flex: 1 1 auto` and takes
 * whatever is left, which is 151 under C's head and 135 under F's, out of one
 * locked 302. Written as flex rather than as two hard heights so the arithmetic
 * cannot drift out of agreement with the shell.
 *
 * AND THE DIVIDER ABOVE THE LIST IS THE LIST'S OWN `border-top`, not a node.
 * Drawing a hairline element as well would put two rules a pixel apart under
 * every expanded header.
 *
 * NO TAB ROW EITHER, AND THAT IS A MOVE RATHER THAN A DELETION. V3 makes the
 * tab row permanent chrome: 63px, byte-identical, present in all nineteen
 * states and counted inside all three heights, with state colour stopping at
 * the divider above it. A row that is the same in nineteen states belongs to
 * the surface that is the same in nineteen states, which is the shell. This
 * file draws everything ABOVE that divider and nothing below it.
 *
 * WHERE OPERATOR IDENTITY LIVES. The 9px dot on a nearby row is the only place
 * in the entire dock that carries it, and it only appears where a named
 * operator sits beside it -- so the colour marks a row rather than making a
 * claim. It is published as `data-fwm-owner` and `dock.css` resolves it to the
 * `--dr-owner-*` family that already exists; nothing about whose hardware is on
 * the pole is decided in this file.
 */

import type { ReactElement } from 'react';

import type { DockNavAction, DockNavData } from './DriveRows.tsx';
import { dockRerouteLabel, NavigationBody } from './DriveRows.tsx';
import { DockIcon } from './icons.tsx';

/* ------------------------------------------------------------------------ *
 * THE DENSITY RAMP
 *
 * Four tiers, and the number is what they colour -- never the pane. Section B2
 * is explicit about why: text colour is WHERE YOU ARE and surface colour is
 * ACT NOW, and collapsing them loses the driver the difference between a dense
 * neighbourhood and a reader 400 feet ahead. Amber on the number means how
 * exposed this area is; amber on the whole pane means you are approaching one.
 *
 * COLOUR NEVER TRAVELS ALONE. The tier WORD rides beside it in every view that
 * draws the ramp, for anyone who cannot use hue and for anyone reading in
 * sunlight.
 *
 * THERE IS NO FIFTH TIER. A downtown grid reading 60 still says `high`:
 * escalating past it would cost a hue that alerting needs, and a driver cannot
 * act on the difference between 40 and 60 anyway.
 *
 * THIS BELONGS IN `dockState.ts` beside `DOCK_FAMILY`. It is a rule about a
 * count rather than a rendering decision, and the collapsed row draws the same
 * ramp on the same number. It is declared here because this is the first file
 * to need it; at integration it moves and both callers read it.
 */
export type DockDensityTier = 'clear' | 'low' | 'moderate' | 'high';

/**
 * WHAT EACH TIER IS CALLED ON THE GLASS, spelled once for both panes.
 *
 * `exposure` AND NOT A BARE `high`. Section B2's cards label the number alone,
 * where the surrounding card already says what is being counted. Section A
 * draws the real dock and spells it `exposure high` in the meta line, because
 * on a pane that also carries a distance and a route count, one adjective with
 * no noun is a word the driver has to work out.
 */
export const DOCK_TIER_WORD: Readonly<Record<DockDensityTier, string>> = {
  clear: 'exposure clear',
  low: 'exposure low',
  moderate: 'exposure moderate',
  high: 'exposure high',
};

/** The spec's own boundaries: 0, 1-5, 6-12, 13+. */
export function dockDensityTier(count: number): DockDensityTier {
  if (count <= 0) return 'clear';
  if (count <= 5) return 'low';
  if (count <= 12) return 'moderate';
  return 'high';
}

/* ------------------------------------------------------------------------ *
 * THE ROWS
 * ------------------------------------------------------------------------ */

/**
 * Whose hardware is on the pole.
 *
 * The five the `--dr-owner-*` token family already names, rather than a new
 * vocabulary: the spec's C list draws four distinct dots -- Flock, a police
 * department, a private lot and an unverified report -- and the tokens for all
 * of them exist. Anything the caller cannot attribute is `unverified`, which
 * is what an unattributed reader is.
 */
export type DockNearbyOwner = 'flock' | 'police' | 'private' | 'hoa' | 'unverified';

/** One row of C's list. 44px. */
export interface DockNearbyRow {
  /** Never rendered: the React key, and the id a press opens. */
  readonly id: string;
  /** 14px, ellipsised. `Antioch Rd & W 119th St`. */
  readonly where: string;
  /** 12px, ellipsised, under it. `Flock · inter-agency shared`. */
  readonly who: string;
  /** The 9px dot. */
  readonly owner: DockNearbyOwner;
  /** 14px, weight 700, trailing. `0.4 mi`. */
  readonly distance: string;
}

/**
 * What a step's note is saying, as a token rather than a colour.
 *
 * The spec hands each step a hue directly -- amber where a camera sits on it,
 * grey where it is clear, green on the destination -- so that the exposure of
 * the whole route is readable without leaving the dock. The hue is the
 * stylesheet's; the meaning is this.
 */
export type DockStepTone = 'alert' | 'quiet' | 'clear';

/** One row of F1's list. 42px. */
export interface DockTurnStep {
  readonly id: string;
  /** 13px, weight 700, in a fixed 44px cell so every road starts at one x. */
  readonly distance: string;
  /** 14px. `W 119th St`. */
  readonly road: string;
  /** 12px, in the tone's hue. `1 camera at Antioch`, `clear`, `destination`. */
  readonly note: string;
  readonly tone: DockStepTone;
}

/** One option in F2's list. 54px. */
export interface DockRouteOption {
  readonly id: string;
  /** 15px. `18 min · avoids 3 of 5`. The cost, stated in cameras. */
  readonly headline: string;
  /** 12px, under it. `7.2 mi · recommended`, `6.8 mi · 2 min faster`. */
  readonly detail: string;
  /** Which one is selected. Exactly one, and the pane draws the radio for it. */
  readonly chosen: boolean;
}

/* ------------------------------------------------------------------------ *
 * THE DATA
 * ------------------------------------------------------------------------ */

/** C. The collapsed header's own values, plus the list behind them. */
export interface DockNearbyData {
  /** The 30px readout: how many the list holds. */
  readonly count: number;
  /**
   * THE NUMBER THE RAMP IS RUN ON, when it is not `count`.
   *
   * The ramp is a rule about two miles - `cameras per 2 mi`, B2's own subtitle
   * - and `count` is whatever the list holds. They are the same number on the
   * exposure card and different on ARMED, whose sheet lists the reader within
   * five miles precisely because there is none within two. Absent, `count` is
   * the exposure; present, this is, and the tier word says `clear` over a list
   * of one reader three miles out rather than `low`.
   */
  readonly exposure?: number;
  /** 15px, beside it. `cameras within 2 mi`. */
  readonly headline: string;
  /** 13px, after the tier word. `sorted by distance`. */
  readonly note: string;
  /** The detour key's count. Absent takes the key off the pane. */
  readonly around?: number;
  readonly nearby: readonly DockNearbyRow[];
}

/** F1. The navigation header, and the rest of the route under it. */
export interface DockTurnListData {
  readonly nav: DockNavData;
  readonly steps: readonly DockTurnStep[];
}

/** F2. The same header, and the lines you could take instead. */
export interface DockRouteChoiceData {
  readonly nav: DockNavData;
  readonly routes: readonly DockRouteOption[];
}

/* ------------------------------------------------------------------------ *
 * THE PANE
 * ------------------------------------------------------------------------ */

/** C's leading glyph. The reader, at the size the spec draws it. */
const HEADER_ICON_SIZE = 20;
/** The detour key's mark, and a step row's disclosure. */
const DETOUR_ICON_SIZE = 15;
const STEP_CHEVRON_SIZE = 15;

/**
 * A discriminated union rather than one bag of optional fields.
 *
 * The three views share a height and nothing else: C has a count and a list of
 * readers, F1 has a route header and a list of steps, F2 has the same header
 * and a list of alternatives. Spelling that as `nearby?: ... steps?: ...
 * routes?: ...` would let a caller hand the turn list a set of readers and get
 * an empty pane back with no error anywhere. The union makes the wrong call
 * unwritable.
 */
export type ExpandedPanelProps =
  | {
      readonly view: 'nearby';
      readonly data: DockNearbyData;
      /** A reader was pressed. The host opens that reader's intel card. */
      readonly onPick: ((id: string) => void) | undefined;
      readonly onAction: ((action: DockNavAction) => void) | undefined;
    }
  | {
      readonly view: 'turn-list';
      readonly data: DockTurnListData;
      /** A step was pressed. The host moves the map to it. */
      readonly onStep: ((id: string) => void) | undefined;
      readonly onAction: ((action: DockNavAction) => void) | undefined;
    }
  | {
      readonly view: 'route-choice';
      readonly data: DockRouteChoiceData;
      /** A line was chosen. It does not start; the footer's Start does that. */
      readonly onChoose: ((id: string) => void) | undefined;
      readonly onAction: ((action: DockNavAction) => void) | undefined;
    };

export function ExpandedPanel(props: ExpandedPanelProps): ReactElement {
  if (props.view === 'nearby') return <NearbyView {...props} />;
  if (props.view === 'turn-list') return <TurnListView {...props} />;
  return <RouteChoiceView {...props} />;
}

/* ------------------------------------------------------------------------ *
 * C -- THE NEARBY LIST
 * ------------------------------------------------------------------------ */

function NearbyView({
  data,
  onPick,
  onAction,
}: Extract<ExpandedPanelProps, { view: 'nearby' }>): ReactElement {
  const tier = dockDensityTier(data.exposure ?? data.count);

  return (
    <>
      {/* THE COLLAPSED DOCK'S OWN HEADER, UNCHANGED BY EXPANDING, and drawn
          out of the collapsed pane's own classes rather than out of copies of
          them: 12 pad, a 44px lede, a 24px meta line, 4 pad, which is section
          A's arithmetic and `dock.css` section 4's box model. Tapping a pane
          must not redraw the thing you tapped -- the list arrives underneath
          and nothing above the rule moves.

          THE DENSITY ATTRIBUTE IS NOT SET HERE. `dock.css` scopes the ramp to
          `.fwm-dock-body[data-fwm-density]` so that one attribute colours the
          figure, the glyph and the tier word together; the body is the shell's
          and the shell derives the tier from the same `dockDensityTier` above.
          A second attribute on this head would be a second source of one
          number. */}
      <div className="fwm-dock-head" data-fwm-head="nearby">
        <div className="fwm-dock-split">
          <div className="fwm-dock-column">
            <div className="fwm-dock-lede">
              <span className="fwm-dock-mark">
                <DockIcon name="camera" size={HEADER_ICON_SIZE} />
              </span>
              <span className="fwm-dock-count">{data.count}</span>
              <span className="fwm-dock-caption">{data.headline}</span>
            </div>

            <div className="fwm-dock-meta">
              {/* THE WORD RIDES BESIDE THE COLOUR, always. `exposure high` is
                  one emphasised run in the spec and one node here, so the hue
                  and the word cannot be separated by a later edit to either. */}
              <span className="fwm-dock-line-meta">
                <strong className="fwm-dock-tier">{DOCK_TIER_WORD[tier]}</strong>
                {` · ${data.note}`}
              </span>

              {data.around === undefined ? null : (
                <button
                  type="button"
                  className="fwm-dock-action"
                  data-fwm-action="around"
                  onClick={(event) => {
                    /* The pane behind this key is the collapse target. Without
                       this the driver who asks for a detour also closes the
                       list they were reading it from. */
                    event.stopPropagation();
                    onAction?.('around');
                  }}
                >
                  <DockIcon name="reroute" size={DETOUR_ICON_SIZE} />
                  {dockRerouteLabel(data.around)}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="fwm-dock-list" data-fwm-list="nearby">
        {data.nearby.map((cam) => (
          /* A REAL BUTTON, because the row leads somewhere. The spec draws
             these with a pointer cursor and nothing bound; a row that offers a
             press and refuses it is worse than a row that offers none. The
             press opens the same intel card a tapped dot on the map opens.

             THE NAME IS THE ROW. Distance, then place, then operator -- what
             the row says, in the order it says it. No `aria-label` shorter
             than the row's own contents, because that would hide the operator
             from the only person who cannot see the dot beside it. */
          <button
            type="button"
            className="fwm-dock-row"
            key={cam.id}
            onClick={(event) => {
              event.stopPropagation();
              onPick?.(cam.id);
            }}
          >
            <span className="fwm-dock-dot" data-fwm-owner={cam.owner} />
            <span className="fwm-dock-stack">
              <span className="fwm-dock-line">{cam.where}</span>
              <span className="fwm-dock-sub">{cam.who}</span>
            </span>
            <span className="fwm-dock-trail">{cam.distance}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * F1 -- THE TURN LIST
 * ------------------------------------------------------------------------ */

function TurnListView({
  data,
  onStep,
  onAction,
}: Extract<ExpandedPanelProps, { view: 'turn-list' }>): ReactElement {
  return (
    <>
      <div className="fwm-dock-head" data-fwm-head="navigating">
        <NavigationBody state="turn-list" data={data.nav} onAction={onAction} />
      </div>

      {/* NO TURN ARROW ON A STEP, and that is v3's change rather than an
          omission. The row leads with its distance in a fixed cell instead, so
          the column of distances reads as a column; the arrow was carrying the
          same information the road name already carries. */}
      <div className="fwm-dock-list" data-fwm-list="steps">
        {data.steps.map((step) => (
          <button
            type="button"
            className="fwm-dock-row"
            key={step.id}
            onClick={(event) => {
              event.stopPropagation();
              onStep?.(step.id);
            }}
          >
            <span className="fwm-dock-trail">{step.distance}</span>
            <span className="fwm-dock-stack">
              <span className="fwm-dock-line">{step.road}</span>
              {/* EACH STEP CARRIES ITS CAMERA COUNT IN THE STATE'S OWN HUE, so
                  the exposure of the whole route is readable without leaving
                  the dock. `clear` is a word here, not an absence. */}
              <span className="fwm-dock-sub" data-fwm-tone={step.tone}>
                {step.note}
              </span>
            </span>
            <DockIcon name="chevron-right" size={STEP_CHEVRON_SIZE} />
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * F2 -- THE ROUTE CHOICE
 * ------------------------------------------------------------------------ */

function RouteChoiceView({
  data,
  onChoose,
  onAction,
}: Extract<ExpandedPanelProps, { view: 'route-choice' }>): ReactElement {
  return (
    <>
      <div className="fwm-dock-head" data-fwm-head="navigating">
        <NavigationBody state="route-choice" data={data.nav} onAction={onAction} />
      </div>

      {/* A RADIO GROUP, because that is what it is: two lines, one of them
          taken, and choosing does not start anything -- the footer's Start
          does. The spec draws a ring and a filled ring, which is the radio a
          driver already knows; saying so in the markup is what makes the
          arrow keys and the screen reader agree with the picture. */}
      <div className="fwm-dock-list" data-fwm-list="routes" role="radiogroup" aria-label="Routes">
        {data.routes.map((route) => (
          <button
            type="button"
            className="fwm-dock-option"
            key={route.id}
            role="radio"
            aria-checked={route.chosen}
            data-fwm-chosen={route.chosen ? 'true' : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onChoose?.(route.id);
            }}
          >
            {/* The ring, and its dot only when taken. Drawn rather than
                inherited from the platform: a native radio cannot be 15px with
                a 7px pip on a glass surface in seventeen skins. */}
            <span className="fwm-dock-radio">
              {route.chosen ? <span className="fwm-dock-radio-dot" /> : null}
            </span>
            <span className="fwm-dock-stack">
              <span className="fwm-dock-line">{route.headline}</span>
              <span className="fwm-dock-sub">{route.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
