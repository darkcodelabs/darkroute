/**
 * THE NAVIGATION FAMILY. One skeleton, six states, 170px, and it does not move.
 *
 * `dockv3.dc.html` section E publishes the whole of it in one line: 12 pad +
 * 56 maneuver + 32 footer + 4 pad + 1 divider + 63 tabs, +2 hairline. THE 56
 * AND THE 32 ARE THE ONLY TWO THIS FILE DRAWS. The 12 and the 4 are the body's
 * own padding -- `dock.css` puts them on `.fwm-dock-body` for the collapsed and
 * navigating panes together, because they are the same two numbers -- and the
 * divider and the tab row belong to the shell, which draws them in all
 * nineteen states.
 *
 * SIX STATES, NOT ONE. V2 had a single NAVIGATING row and it could not say the
 * six things a route actually has to say -- that a line has been proposed and
 * not started, that a turn is 500 feet out, that a reader is sitting on that
 * turn, that a new line is being found, that you have left the old one, and
 * that you have arrived. Every one of them fills the same 104px, because
 * mid-turn is the worst possible moment to move a target and "proposing" and
 * "arriving" are five minutes apart on the same drive.
 *
 * THE ROW IS THREE SLOTS AND THE FOOTER IS TWO.
 *
 *   MARK    28px, 30px or 34px, flush left. What kind of thing this is: a
 *           route, a maneuver, a spinner, a strike-through, a check.
 *   STACK   the readout over its sentence. TWO SHAPES and no third --
 *           MEASURED, where a number and its unit share a baseline and the
 *           sentence sits under them (E1, E2, E3); and TITLED, where a short
 *           phrase stands in for the number because there is no number worth
 *           printing (E4, E5, E6). `data-fwm-shape` is how the stylesheet
 *           tells them apart -- it is what opens the stack's 1px gap to the 2
 *           the spec gives two runs of prose -- so neither has to be a
 *           separate class tree.
 *   INSET   48px of static tile, in four of the six. `MapInset` draws it and
 *           the header of that file says why it is not a map.
 *
 *   FOOTER  a 13px line that may truncate, and one verb that may not. The rule
 *           the whole family obeys: EVERY STATE OFFERS EXACTLY ONE ACTION.
 *           Start, End, Reroute around N, Cancel, Recalculate, Save drive. A
 *           driver mid-turn can hold one choice in their head and the design
 *           spends it rather than saving it up.
 *
 * NO GRAB HANDLE AND NO EXPAND CHEVRON. V3 deletes both -- the chevron
 * collided with the pane's corner and the bar under the tab row duplicated the
 * system gesture bar -- and the whole pane is the target instead. That press
 * belongs to the shell, which owns the pane; what this file owns is making
 * sure the one key in the footer does not fire it too. See `stopPropagation`
 * below, and note that it is the only event handling in this file.
 *
 * THE CLASS NAMES ARE THE COLLAPSED PANE'S WHEREVER THE BOX IS THE SAME BOX.
 * `.fwm-dock-lead`, `.fwm-dock-stack`, `.fwm-dock-title`, `.fwm-dock-count`,
 * `.fwm-dock-headline`, `.fwm-dock-caption`, `.fwm-dock-line-meta`,
 * `.fwm-dock-action` and `.fwm-dock-inset` are all section 4's and section 6's,
 * used here for exactly what they mean there -- a figure is the figure slot in
 * both panes, and the 40px action target is the same target. THE SIZE IS NOT
 * ALWAYS THE SAME, and `dock.css` scopes the difference to `.fwm-dock-maneuver`
 * rather than to a second class: the collapsed lede sets the figure at 30 with
 * one line beside it, and a maneuver row sets it at 26 with a unit on its
 * baseline and a road under it. E2 alone takes the 30 back, because under 800
 * feet the number is the whole message. Only two names are new, because only
 * two boxes are: `.fwm-dock-maneuver`, the 56px row, and `.fwm-dock-footer`,
 * the 32px row under it with the rule that splits the pair. A third,
 * `.fwm-dock-unit`, is the unit riding a figure's baseline, which the
 * collapsed pane never draws.
 *
 * WHAT THE STATE FIXES AND WHAT THE DATA FILLS. The mark, the tile, the shape
 * of the stack and the verb are all properties of the STATE and live in
 * `NAV_SHAPE` -- a caller cannot put `Save drive` on a rerouting dock, or draw
 * a cone in a state that has no reader. The data carries only what the state
 * cannot know: the numbers, the streets, and which way the turn goes.
 *
 * THIS FILE DRAWS NO COLOUR. Not one hex, not one token name. The state goes
 * onto the pane as `data-fwm-state` and `dock.css` resolves every hue from
 * there, including the three tinted grounds -- E2's accent, E3's amber, E6's
 * green -- which is why a lit state can keep its own tint at the same 0.72 and
 * still read as the same glass.
 */

import type { ReactElement } from 'react';

import type { DockActionKey } from './dockState.ts';
import type { DockTurn } from './icons.tsx';
import { DOCK_MANEUVER_ICON, DockIcon, type DockIconName } from './icons.tsx';
import { DOCK_INSET_NAV, MapInset, type DockInsetVariant } from './MapInset.tsx';

/* ------------------------------------------------------------------------ *
 * THE SIX
 *
 * NEW IDS, AND THEY BELONG IN `dockState.ts`. That file still spells v2's
 * nineteen, where the whole of navigation was one `navigating` state and a
 * `navigating-expanded` beside it. The six below supersede both. They are
 * declared here because this is the file that draws them and a type with no
 * renderer is a guess; at integration they move into `DockStateId`, join
 * `DOCK_FAMILY` as the `navigation` family at 170px, and this block becomes a
 * re-export. See the handoff notes.
 * ------------------------------------------------------------------------ */

export type DockNavStateId =
  | 'route-proposed'    /* E1 -- a line exists and has not been started */
  | 'turn-imminent'     /* E2 -- under 800 ft to the maneuver */
  | 'camera-on-route'   /* E3 -- a reader is sitting on that maneuver */
  | 'rerouting'         /* E4 -- a new line is being found, the old one still live */
  | 'off-route'         /* E5 -- you are no longer on the line */
  | 'arrived';          /* E6 -- destination reached */

/** All six, in the spec's own order, E1 through E6. */
export const DOCK_NAV_STATE_IDS: readonly DockNavStateId[] = [
  'route-proposed',
  'turn-imminent',
  'camera-on-route',
  'rerouting',
  'off-route',
  'arrived',
];

/**
 * THE SKELETON'S OWN KEYS, which are the six states plus the two expanded
 * headers that reuse them.
 *
 * F1 and F2 are not navigation STATES -- they are the navigation dock with a
 * list grown underneath -- but their 56px row and 32px footer are the same
 * skeleton with a different mark and a different verb, so they are entries in
 * the same table rather than a second one. F2's header is E1's exactly, minus
 * the tile; F1's is a maneuver in neutral ink over the whole trip, offering
 * the one thing an open turn list should offer, which is out.
 */
export type DockNavShapeId = DockNavStateId | 'turn-list' | 'route-choice';

/**
 * The six verbs, one per state.
 *
 * `around` and `end` are shared with the rest of the dock; `start`, `cancel`,
 * `recalculate` and `save` exist nowhere else, because nowhere else in the
 * product can start a line, cancel the search for one, recalculate after
 * leaving it, or save the drive it just finished. All six now live in
 * `DockActionKey`, and this is EXTRACTED from that union rather than restated:
 * a member removed there fails here rather than silently un-drawing a footer.
 *
 * `recalculate` IS NOT `reroute`. `reroute` re-plans a line that is still under
 * you to steer around a reader; `recalculate` picks up a line you have already
 * left. Reusing one key for both is the kind of saving that costs a turn.
 */
export type DockNavAction = Extract<
  DockActionKey,
  'start' | 'end' | 'around' | 'cancel' | 'recalculate' | 'save'
>;

/**
 * THE DETOUR KEY'S FACE, SPELLED ONCE.
 *
 * `Reroute around 3`, never a bare `Around 3`. Rule 7 of the handoff, and the
 * reason is grammar: `Around 3` names a quantity without saying what happens
 * to it, and a driver reading four characters at 70mph gets a number and no
 * verb. The glyph beside it is an arrow leaving a corner and the word is the
 * same arrow said out loud; the pair is the offer.
 *
 * `dockState.ts` still exports `dockAroundLabel`, which returns the bare
 * `Around N` that v3 withdrew. It has no caller left after this rebuild and
 * should be retired rather than left as a second spelling of one word.
 */
export function dockRerouteLabel(count: number): string {
  return `Reroute around ${String(count)}`;
}

/* ------------------------------------------------------------------------ *
 * WHAT EACH STATE IS
 * ------------------------------------------------------------------------ */

/** A drawing at the size the spec draws it, and its weight where v3 varies it. */
interface NavMark {
  readonly name: DockIconName;
  readonly size: number;
  readonly strokeWidth?: number;
}

/** A maneuver has no name until the data says which way the road goes. */
interface NavManeuver {
  readonly size: number;
  readonly strokeWidth?: number;
}

interface NavShape {
  /**
   * The leading mark, or `null` where it is the maneuver arrow and therefore
   * comes from the data. E2 and E3 both lead with the turn you are about to
   * make; the other four lead with a mark the state owns.
   */
  readonly mark: NavMark | null;
  /** The maneuver's size in the two states that draw one. */
  readonly maneuver: NavManeuver | null;
  /** Which tile, or `null` in the two states that draw none. */
  readonly inset: DockInsetVariant | null;
  /** The one verb. */
  readonly action: DockNavAction;
  /**
   * The word on it, or `null` where the key counts -- `around` spells itself
   * off `data.around` through `dockRerouteLabel`, and draws nothing at all
   * when the count is unknown, because a key offering to route around an
   * unstated number of readers is a promise the dock cannot keep.
   */
  readonly face: string | null;
}

/* The maneuver sizes, written once. E2 draws it at 34 and thickens it to 2.3,
   because at 500 feet the arrow is the loudest thing on the glass; E3 draws
   the same arrow at 30 in neutral ink, because there the amber belongs to the
   reader and a turn instruction that shouts in the alert's own hue is a second
   alert. */
const MANEUVER_IMMINENT: NavManeuver = { size: 34, strokeWidth: 2.3 };
const MANEUVER_COMPOUND: NavManeuver = { size: 30 };

const NAV_SHAPE: Readonly<Record<DockNavShapeId, NavShape>> = {
  'route-proposed': {
    mark: { name: 'route-branch', size: 28 },
    maneuver: null,
    inset: 'route',
    action: 'start',
    face: 'Start',
  },
  'turn-imminent': {
    mark: null,
    maneuver: MANEUVER_IMMINENT,
    inset: 'turn',
    action: 'end',
    face: 'End',
  },
  'camera-on-route': {
    mark: null,
    maneuver: MANEUVER_COMPOUND,
    inset: 'camera-on-route',
    action: 'around',
    face: null,
  },
  rerouting: {
    mark: { name: 'refresh', size: 28 },
    maneuver: null,
    inset: null,
    action: 'cancel',
    face: 'Cancel',
  },
  'off-route': {
    mark: { name: 'off-route', size: 28 },
    maneuver: null,
    inset: 'off-route',
    action: 'recalculate',
    face: 'Recalculate',
  },
  arrived: {
    mark: { name: 'check', size: 28, strokeWidth: 2.2 },
    maneuver: null,
    inset: null,
    action: 'save',
    face: 'Save drive',
  },

  /* THE TWO EXPANDED HEADERS. Neither draws a tile: the list under them is
     already the picture, and a 48px schematic beside a scrolling route reads
     as a second, smaller answer to a question the list is answering better. */
  'turn-list': {
    mark: null,
    maneuver: MANEUVER_COMPOUND,
    inset: null,
    action: 'end',
    face: 'End',
  },
  'route-choice': {
    mark: { name: 'route-branch', size: 28 },
    maneuver: null,
    inset: null,
    action: 'start',
    face: 'Start',
  },
};

/** The 15px mark inside the detour key. The verb, so the face need not be. */
const DETOUR_ICON_SIZE = 15;

/**
 * What leads the row: the state's own mark, or the maneuver the data names.
 *
 * Returns `null` rather than a substitute when the direction has no drawing.
 * The row then starts at the readout and loses nothing but a picture; a
 * mirrored or borrowed arrow would lose the driver a turn.
 */
function leadMark(shape: NavShape, turn: DockTurn | undefined): NavMark | null {
  if (shape.mark !== null) return shape.mark;
  if (shape.maneuver === null || turn === undefined) return null;
  const name = DOCK_MANEUVER_ICON[turn];
  return name === undefined ? null : { ...shape.maneuver, name };
}

/* ------------------------------------------------------------------------ *
 * THE DATA
 * ------------------------------------------------------------------------ */

/**
 * Every string the six states render.
 *
 * FIELDS ARE NAMED FOR THE SLOT THEY FILL, not for one state's meaning of the
 * value in it -- the question a renderer asks is always "what goes in this
 * box". `figure` is minutes in E1 and feet in E2 and miles in E3; the unit
 * beside it is what says which, which is exactly why they are two fields.
 *
 * Fields are optional because no state uses more than six. Every one names the
 * states that DO use it, with the spec's own value.
 *
 * THIS BELONGS IN `dockState.ts` beside `DockData`, and is declared here for
 * the same reason the ids are. It is deliberately NOT a subset of `DockData`:
 * that interface's `figure` is a 38px readout with no unit beside it and its
 * `subline` is sized per state, both of which v3 withdrew.
 */
export interface DockNavData {
  /**
   * The readout. 26px in E1 and E3, 30px in E2.
   *
   *   E1  route-proposed    `18`
   *   E2  turn-imminent     `500`
   *   E3  camera-on-route   `0.4`
   */
  readonly figure?: string;

  /**
   * What the readout is counting, on its baseline. Never a bare unit where the
   * spec writes more: E1 spends the slot on the whole trip.
   *
   *   E1  `min · 7.2 mi`
   *   E2  `ft`
   *   E3  `mi`
   */
  readonly unit?: string;

  /**
   * The phrase that stands in for a readout in the three states with no number
   * worth printing. 19px.
   *
   *   E4  rerouting   `Finding a way around`
   *   E5  off-route   `Off route`
   *   E6  arrived     `Arrived`
   */
  readonly title?: string;

  /**
   * The sentence under either one. 14px, or 15px and bold in E2, where it is
   * the instruction rather than a note about one.
   *
   *   E1  `avoids 3 of 5 cameras`
   *   E2  `Right onto W 119th St`
   *   E3  `Right onto W 119th St`
   *   E4  `holding your destination`
   *   E5  `0.3 mi from W 119th St`
   *   E6  `11800 Overland Pkwy`
   */
  readonly sub?: string;

  /**
   * The footer's flexible, ellipsised line. 13px.
   *
   *   E1  `2 routes compared · pull up to switch`
   *   E2  `then 1.2 mi to Metcalf Ave`
   *   E3  `600 ft · Flock at the turn`
   *   E4  `keep driving — old route stays live`
   *   E5  `still watching 4 cameras nearby`
   *   E6  `18 min · avoided 3, passed 2`
   */
  readonly footer?: string;

  /**
   * HOW MANY READERS THE DETOUR WOULD ROUTE AROUND. E3 only, and it is the
   * numeral in `Reroute around 1`.
   *
   * Absent takes the key off the dock rather than blanking its face. A key
   * that offers to route around nothing is a key that refuses.
   */
  readonly around?: number;

  /**
   * Which way the maneuver goes. E2, E3 and F1's turn list header.
   *
   * `up` and `end` draw NO mark. V3 draws the maneuver arrow exactly once and
   * it is a right turn; `maneuver-left` is its hand-written mirror and there
   * is no straight-ahead or arrive drawing at that size anywhere in the file.
   * A turn the spec never drew renders nothing rather than the wrong thing.
   */
  readonly turn?: DockTurn;

  /**
   * The reader's facing, in compass degrees, for E3's cone. Absent draws the
   * spec's own bearing; see `MapInset`.
   */
  readonly facingDeg?: number;
}

/* ------------------------------------------------------------------------ *
 * THE SKELETON
 * ------------------------------------------------------------------------ */

export interface NavigationBodyProps {
  readonly state: DockNavShapeId;
  readonly data: DockNavData;
  readonly onAction: ((action: DockNavAction) => void) | undefined;
}

/**
 * THE 56px MANEUVER ROW AND THE 32px FOOTER, and nothing else.
 *
 * Exported because section F expands the navigation dock by growing a list
 * UNDER exactly this pair and changing nothing about it -- same mark, same
 * readout, same footer, same verb. Drawing it twice is how the expanded turn
 * list ends up half a pixel or one weight away from the row it expanded from,
 * which is the tell that a sheet is a different component rather than the same
 * one taller. One skeleton means one function.
 */
export function NavigationBody({ state, data, onAction }: NavigationBodyProps): ReactElement {
  const shape = NAV_SHAPE[state];
  /* The maneuver is looked up through a PARTIAL map on purpose -- see
     `DockNavData.turn`. An unknown direction leaves the slot empty and the
     readout takes the space, which is the only honest thing a row can do with
     a turn it cannot draw. */
  const mark = leadMark(shape, data.turn);
  const counted = shape.action === 'around';
  const face = counted
    ? data.around === undefined
      ? null
      : dockRerouteLabel(data.around)
    : shape.face;

  return (
    <>
      <div className="fwm-dock-maneuver">
        {mark === null ? null : (
          <span className="fwm-dock-lead">
            {mark.strokeWidth === undefined ? (
              <DockIcon name={mark.name} size={mark.size} />
            ) : (
              <DockIcon name={mark.name} size={mark.size} strokeWidth={mark.strokeWidth} />
            )}
          </span>
        )}

        {/* TWO SHAPES, ONE BOX. MEASURED puts the number and its unit on one
            baseline; TITLED puts a phrase where the number would be, so a
            state that has nothing to count does not have to pretend. The size
            follows the class -- 26 or 30 on `.fwm-dock-count`, 19 on
            `.fwm-dock-headline` -- and `data-fwm-shape` carries the one thing
            the classes cannot: the leading between the two lines, 1 under a
            reading and 2 under a sentence. */}
        <span
          className="fwm-dock-stack"
          data-fwm-shape={data.figure === undefined ? 'titled' : 'measured'}
        >
          {data.figure === undefined ? (
            data.title === undefined ? null : (
              <span className="fwm-dock-headline">{data.title}</span>
            )
          ) : (
            <span className="fwm-dock-title">
              <span className="fwm-dock-count">{data.figure}</span>
              {data.unit === undefined ? null : <span className="fwm-dock-unit">{data.unit}</span>}
            </span>
          )}
          {data.sub === undefined ? null : <span className="fwm-dock-caption">{data.sub}</span>}
        </span>

        {/* 48 IN A NAVIGATION ROW, 56 IN A DRIVE ROW, and the number is the
            tile's rather than this row's -- `MapInset` publishes both and
            there is no third. */}
        {shape.inset === null ? null : (
          <MapInset
            variant={shape.inset}
            size={DOCK_INSET_NAV}
            {...(data.turn === 'left' ? { turn: 'left' as const } : {})}
            {...(data.facingDeg === undefined ? {} : { facingDeg: data.facingDeg })}
          />
        )}
      </div>

      <div className="fwm-dock-footer">
        {data.footer === undefined ? null : (
          <span className="fwm-dock-line-meta">{data.footer}</span>
        )}

        {/* THE ONE KEY, AND IT REFUSES THE PRESS THE PANE WANTS.
            V3 makes the whole pane body the tap target. `dock.css` stretches
            `.fwm-dock-tap` under everything and gives the keys
            `position: relative` so a press on a key lands on the key -- so the
            stack already separates them. `stopPropagation` is the belt to that
            brace: it is the only thing standing between `End` and an expand if
            the target is ever moved to an ANCESTOR of this row rather than a
            sibling of it, and a driver pressing End mid-turn is the worst
            place in the product to find out.

            NO `aria-label` ON THE DETOUR KEY. Every other icon-bearing key in
            the dock needs one because it paints no word; this one paints
            `Reroute around 1`, so the visible label IS the accessible name. A
            longer spoken form would hide the words on the glass from a driver
            using voice control, who can only say what they can see -- which is
            exactly the bug the bare `Around 3` had. */}
        {face === null ? null : (
          <button
            type="button"
            className="fwm-dock-action"
            data-fwm-action={shape.action}
            onClick={(event) => {
              event.stopPropagation();
              onAction?.(shape.action);
            }}
          >
            {counted ? <DockIcon name="reroute" size={DETOUR_ICON_SIZE} /> : null}
            {face}
          </button>
        )}
      </div>
    </>
  );
}

export interface DriveRowsProps {
  readonly state: DockNavStateId;
  readonly data: DockNavData;
  readonly onAction: ((action: DockNavAction) => void) | undefined;
}

/**
 * A navigation dock at 170px.
 *
 * THE BODY AND NOTHING ELSE. The 12 above the maneuver row and the 4 below the
 * footer are `.fwm-dock-body`'s own padding, which `dock.css` sets once for the
 * collapsed and navigating panes together because they are the same two
 * numbers. Adding a spacer element here would draw the four pixels twice and
 * make the pane 174.
 *
 * So this is `NavigationBody` under a different name, and the name is the
 * point: section F calls the body directly, inside an expanded pane whose
 * padding is not this one's.
 */
export function DriveRows({ state, data, onAction }: DriveRowsProps): ReactElement {
  return <NavigationBody state={state} data={data} onAction={onAction} />;
}
