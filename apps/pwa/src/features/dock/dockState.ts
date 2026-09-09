/**
 * THE DOCK'S VOCABULARY. Three heights, one merged pane, one ramp.
 *
 * `dockv3.dc.html` is the specification -- a page that renders every state at
 * real size in both themes. This file is the machine-readable half of it: which
 * pane a state draws in, what its slots are called, and every rule about a
 * number that is a rule rather than a drawing. It renders nothing, imports no
 * CSS and names no colour.
 *
 * THREE HEIGHTS, BORDER-BOX, AND NOTHING BETWEEN THEM. 150 collapsed, 170
 * navigating, 302 expanded, hairline included. V2's 147 / 288 / 168 are gone,
 * and so is the pair of slabs they measured: the alert body and the tab row are
 * ONE element now, inset 10 on all four sides, radius 24, split by a 1px
 * divider that the tab row sits under. Section G of the spec publishes all of
 * it in one place and this file carries the three numbers.
 *
 * WHAT MOVED HERE FROM V2, AND WHAT LEFT.
 *
 *   LEFT   `DockFamily` / `DOCK_FAMILY` -- browse / expanded / drive, and the
 *          three dead numbers on them. `Dock.tsx` owns the state-to-pane table
 *          now (`DOCK_PANE`) because it owns the height, and two live tables
 *          disagreeing about a number the brief locked is the failure this
 *          deletion prevents. `DOCK_HEIGHT` stays, re-keyed to the pane.
 *   LEFT   `DockEdge` / `DOCK_EDGE`. The edge, the ground and every per-state
 *          hue come off `data-fwm-state` in `dock.css`'s own selectors; a
 *          second copy of that mapping in TypeScript would be the copy that
 *          drifts, because nothing renders from it.
 *   LEFT   `dockAroundLabel` and `dockAroundSpoken`. The detour key is
 *          `Reroute around N` in every slot that draws it -- rule 7 of the
 *          handoff -- and the bare `Around N` that those two spelled is
 *          withdrawn rather than left as a second spelling of one word.
 *   ARRIVED the DENSITY RAMP, which is a rule about a count and not a drawing,
 *          and the NAVIGATION VOCABULARY, which is six states plus two
 *          expanded views where v2 had one `navigating`.
 *
 * COLOUR IS NOT HERE. Not one hex, not one token name. `check-design-values.mjs`
 * fails the build on a raw value outside `tokens.css`, and the deeper reason is
 * that the driver picked one of seventeen skins and the dock follows all of
 * them.
 */

import type { DockIconName, DockTurn } from './icons.tsx';

/**
 * `DockTurn` is declared beside the drawings it selects, because a direction
 * token exists so that a turn is never a text character. Re-exported here so a
 * consumer of the data layer does not have to reach into the icon module for
 * the type of a field the data layer owns.
 */
export type { DockTurn };

/* ------------------------------------------------------------------------ *
 * THE THREE HEIGHTS
 * ------------------------------------------------------------------------ */

/**
 * Which of the three heights a pane draws at.
 *
 *   collapsed   150  section A, and section B's five drive states
 *   navigating  170  section E, the six routed states
 *   expanded    302  sections C and F, the three sheets
 *
 * `Dock.tsx` declares this union too, and maps every state id onto it. The two
 * spellings are identical by construction and only one of them is a table; at
 * integration `Dock.tsx` should import this one. Named `pane` and not `family`
 * because v3 has one pane with three heights where v2 had three compositions.
 */
export type DockPane = 'collapsed' | 'navigating' | 'expanded';

/**
 * LOCKED, BORDER-BOX, HAIRLINE INCLUDED. No fourth height exists.
 *
 * `height: 150px` is literally correct. Escalation inside a pane is colour,
 * weight and the number -- never size -- because a pane that grows mid-turn
 * moves the target under a driver's thumb at the worst possible moment. A label
 * that would push a row taller truncates instead.
 */
export const DOCK_HEIGHT: Readonly<Record<DockPane, number>> = {
  collapsed: 150,
  navigating: 170,
  expanded: 302,
};

/**
 * The same three, less the two hairlines the border-box total includes.
 *
 * Published because the spec badges both numbers on every section header -- 150
 * outer against 148 of content -- and a rebuild that reads only the outer one
 * has to rediscover which of the two a padding is measured from.
 */
export const DOCK_CONTENT_HEIGHT: Readonly<Record<DockPane, number>> = {
  collapsed: 148,
  navigating: 168,
  expanded: 300,
};

/** The pane is inset this far on all four sides. Safe-area adds BELOW it. */
export const DOCK_INSET = 10;

/** The tab row's own height, counted inside all three of the above. */
export const DOCK_TAB_ROW_HEIGHT = 63;

/* ------------------------------------------------------------------------ *
 * THE COLLAPSED STATES
 * ------------------------------------------------------------------------ */

/**
 * Every state that draws the 150px body: section A's card and section B's five.
 *
 * SECTION B IS SECTION A'S BODY, BYTE FOR BYTE. V2 gave the drive family a
 * fourth composition at a fourth height; v3's whole argument is that CRUISING
 * and IDLE are the same box and only the tint and the ink change. So there is
 * one collapsed vocabulary and the drive states are in it.
 */
export type DockCollapsedStateId =
  | 'idle'            /* nothing within two miles and nothing within five */
  | 'armed'           /* a reader within five miles, none within two */
  | 'dense'           /* the exposure card: the count within two miles */
  | 'muted'           /* a mute is running */
  | 'offline'         /* no network, working from cache */
  | 'cruising'        /* moving, the nearest reader more than 90s away */
  | 'approaching'     /* 30 to 90 seconds to a reader */
  | 'passing'         /* inside the cone */
  | 'cleared'         /* a few seconds after passing */
  | 'abuse-zone'      /* a jurisdiction with at least one sourced report */
  | 'abuse-entering'  /* entering one, while moving */
  | 'gps-weak'        /* accuracy worse than about 100 ft */
  | 'mesh-sync'       /* a sync event, about six seconds */
  | 'unmapped';       /* an anomaly where the archive has nothing */

/** All fourteen, in the order the ladder reaches them. */
export const DOCK_COLLAPSED_STATE_IDS: readonly DockCollapsedStateId[] = [
  'idle',
  'armed',
  'dense',
  'muted',
  'offline',
  'cruising',
  'approaching',
  'passing',
  'cleared',
  'abuse-zone',
  'abuse-entering',
  'gps-weak',
  'mesh-sync',
  'unmapped',
];

/**
 * THE EXPANDED PANE'S TINT, which is a state and not a view.
 *
 * Section C and section F are three DIFFERENT SHEETS at one height, and which
 * sheet is drawn is `DockExpandedViewId`. This is the other half: which of the
 * nineteen tints the pane the sheet is inside, so that expanding during a drive
 * does not drop the drive's own hue.
 */
export type DockExpandedStateId = 'armed-expanded' | 'navigating-expanded';

/**
 * V2 IDS THAT NOTHING REACHES ANY MORE, kept so two tables stay total.
 *
 *   navigating  the single routed state. Superseded by all six of section E --
 *               see `DockNavStateId`, and note that `arrived` is one of them
 *               and keeps its spelling, so `DOCK_PANE.arrived` still lines up.
 *   rerouted    a SYSTEM-initiated reroute, six seconds long. Section E's
 *               REROUTING is the state a re-plan draws now, and it is a routed
 *               state at 170 rather than a collapsed one.
 *
 * They are still members of `DockStateId` because `Dock.DOCK_PANE` and
 * `BrowseRow.MARK` are `Record<DockStateId, ...>` and an id removed here is a
 * missing key there. The ladder in `useDockState.ts` returns neither, and both
 * should be deleted in the same commit that reconciles those two tables.
 */
export type DockSupersededStateId = 'navigating' | 'rerouted';

/**
 * Every id that can be stamped on the pane as `data-fwm-state`, minus the six
 * navigation ids, which are their own union because the navigating pane's props
 * are their own arm of `DockProps`.
 *
 * `arrived` is in BOTH this union and `DockNavStateId`, deliberately and with
 * one spelling: the drive ends the same way whether or not it was routed, and
 * `dock.css` resolves one selector for it.
 */
export type DockStateId =
  | DockCollapsedStateId
  | DockExpandedStateId
  | DockSupersededStateId
  | 'arrived';

/** All nineteen, so a conformance test can walk the whole vocabulary. */
export const DOCK_STATE_IDS: readonly DockStateId[] = [
  ...DOCK_COLLAPSED_STATE_IDS,
  'armed-expanded',
  'navigating-expanded',
  'navigating',
  'rerouted',
  'arrived',
];

/* ------------------------------------------------------------------------ *
 * THE NAVIGATION FAMILY
 * ------------------------------------------------------------------------ */

/**
 * SECTION E, WHICH IS THE SINGLE SOURCE FOR EVERY ROUTED STATE.
 *
 * Six states on one 170px skeleton -- 12 pad + 56 maneuver + 32 footer + 4 pad
 * + 1 divider + 63 tabs, +2 hairline -- and the spec's caption says what the
 * ladder then has to obey: while a route is running, the dock is one of these
 * six and not a collapsed alert. That is why a reader on the line is E3 rather
 * than a drop to the 150px UNDER SURVEILLANCE card. Nothing resizes mid-drive.
 *
 * `DriveRows.tsx` declares this union as well, because it is the file that
 * draws them and a type with no renderer is a guess. The two are identical and
 * that file's own note says it becomes a re-export of this one at integration.
 */
export type DockNavStateId =
  | 'route-proposed'    /* E1 -- a line exists and has not been started */
  | 'turn-imminent'     /* E2 -- the next maneuver, and under 800 ft it shouts */
  | 'camera-on-route'   /* E3 -- a reader is on the line ahead */
  | 'rerouting'         /* E4 -- a new line is being found, the old one live */
  | 'off-route'         /* E5 -- the driver has left the line */
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
 * UNDER 800 FT, which is section E2's own caption and the only threshold the
 * navigation family publishes.
 *
 * It selects a state rather than a weight, and the state selects the weight:
 * E2 draws the maneuver arrow at 34px and 2.3 stroke because at five hundred
 * feet the arrow is the loudest thing on the glass.
 */
export const DOCK_TURN_IMMINENT_FT = 800;

/**
 * SECTION C AND SECTION F -- three sheets, one height, one ceiling.
 *
 * They are VIEWS and not states: the pane's tint still comes from the state
 * underneath (`DockExpandedStateId`), and expanding during a drive keeps the
 * maneuver row and the footer exactly where they were and grows a list under
 * them. There is one expanded height in the whole application and navigation
 * borrows it rather than inventing a fourth.
 */
export type DockExpandedViewId = 'nearby' | 'turn-list' | 'route-choice';

/** All three, C then F1 then F2. */
export const DOCK_EXPANDED_VIEW_IDS: readonly DockExpandedViewId[] = [
  'nearby',
  'turn-list',
  'route-choice',
];

/** Anything that can be stamped as `data-fwm-state`, either union. */
export type DockAnyStateId = DockStateId | DockNavStateId;

/* ------------------------------------------------------------------------ *
 * THE DENSITY RAMP
 * ------------------------------------------------------------------------ */

/**
 * SECTION B2. Four tiers, and what they colour is the NUMBER -- never the pane.
 *
 * Hue says what, scope says when. Amber on the number means how exposed this
 * area is; amber on the whole pane means you are approaching one. Same hue, two
 * scopes, and collapsing them costs the driver the difference between a dense
 * neighbourhood and a reader four hundred feet ahead.
 *
 * COLOUR NEVER TRAVELS ALONE. `DOCK_TIER_WORD` rides beside the colour in every
 * view that draws the ramp -- for anyone who cannot use hue, and for anyone
 * reading in sunlight.
 *
 * THERE IS NO FIFTH TIER, and B2 says why: a downtown grid reading sixty still
 * says `high`, because escalating past it would cost a hue that alerting needs
 * and a driver cannot act on the difference between forty and sixty anyway.
 */
export type DockDensityTier = 'clear' | 'low' | 'moderate' | 'high';

/**
 * THE SPEC'S OWN BOUNDARIES, as data rather than as three comparisons.
 *
 * B2 publishes them per card: 0 is clear, 1-5 low, 6-12 moderate, 13+ high.
 * Written as the LAST count each tier holds so the thresholds read the way the
 * spec states them; `high` has no ceiling, which is the point of it.
 */
export const DOCK_DENSITY_CEILING: Readonly<Record<Exclude<DockDensityTier, 'high'>, number>> = {
  clear: 0,
  low: 5,
  moderate: 12,
};

/**
 * WHAT THE COUNT IS. Cameras within two miles, and nothing else.
 *
 * B2's own subtitle -- `cameras per 2 mi` -- so the radius the count is taken
 * over is part of the ramp rather than a number the caller chose. It is the
 * same two miles the detour horizon uses, so the reading, the offer and the
 * plan are one set counted once.
 */
export const DOCK_DENSITY_RADIUS_MI = 2;

/** The tier a count is in. */
export function dockDensityTier(count: number): DockDensityTier {
  if (count <= DOCK_DENSITY_CEILING.clear) return 'clear';
  if (count <= DOCK_DENSITY_CEILING.low) return 'low';
  if (count <= DOCK_DENSITY_CEILING.moderate) return 'moderate';
  return 'high';
}

/**
 * WHAT EACH TIER IS CALLED ON THE GLASS, spelled once for every pane.
 *
 * `exposure high` AND NOT A BARE `high`. B2's cards label the number alone,
 * where the card around it already says what is being counted; section A draws
 * the real dock and spells the noun, because on a pane that also carries a
 * distance and a route count one adjective on its own is a word the driver has
 * to work out.
 */
export const DOCK_TIER_WORD: Readonly<Record<DockDensityTier, string>> = {
  clear: 'exposure clear',
  low: 'exposure low',
  moderate: 'exposure moderate',
  high: 'exposure high',
};

/* ------------------------------------------------------------------------ *
 * THE TAB ROW
 * ------------------------------------------------------------------------ */

/** Five, in the spec's order. Report is NOT among them. */
export type DockTabKey = 'map' | 'exposure' | 'mesh' | 'lookup' | 'more';

/**
 * Where a tab goes.
 *
 * These ids are the app's existing screen ids and MUST NOT be renamed: every
 * `?screen=<id>` link, the alert restore path and `app/screenState.ts` all
 * speak them. The dock relabels and reorders the five destinations; it does
 * not rename them.
 */
export type DockScreenId = 'radar' | 'log' | 'node' | 'lookup' | 'more';

export interface DockTab {
  readonly key: DockTabKey;
  /** Sentence case, as drawn. The 11px label under the 21px glyph. */
  readonly label: string;
  /**
   * THE SAME KEY, SPELLED FOR A 52px COLUMN.
   *
   * "Five items ... labels shortened to fit -- Expose, not Exposure. Same
   *  order, same active treatment as portrait."
   *                        -- `DarkRoute Landscape Mode.html`, section D
   *
   * ONE TAB IN FIVE NEEDS IT and the field is optional so the other four say so
   * by being absent rather than by repeating themselves. `TabRow` falls back to
   * `label`, which means a rail label can never drift from its bar label by
   * accident -- only deliberately, here.
   *
   * IT IS NOT A TRUNCATION AND MUST NOT BECOME ONE. `Exposure`.slice(0, 6) is
   * `Exposu`. The shortened form is a word the owner chose; a rule that clipped
   * labels to fit would ship that string the first time a tab was renamed.
   */
  readonly shortLabel?: string;
  readonly screen: DockScreenId;
  readonly icon: DockIconName;
}

/**
 * Map, Exposure, Mesh, Lookup, More. Order is fixed, and the row is permanent
 * chrome: it is never absent, and all three published heights count its 63px.
 *
 * Pressing the tab you are already on means RECENTRE, not navigate --
 * `screenState.ts` treats a re-select as a reselect notification rather than a
 * history push, and the dock inherits that.
 */
export const DOCK_TABS: readonly DockTab[] = [
  { key: 'map', label: 'Map', screen: 'radar', icon: 'navigate' },
  { key: 'exposure', label: 'Exposure', shortLabel: 'Expose', screen: 'log', icon: 'bars' },
  { key: 'mesh', label: 'Mesh', screen: 'node', icon: 'mesh-hex' },
  { key: 'lookup', label: 'Lookup', screen: 'lookup', icon: 'search' },
  { key: 'more', label: 'More', screen: 'more', icon: 'menu' },
];

/* ------------------------------------------------------------------------ *
 * ACTIONS
 * ------------------------------------------------------------------------ */

/**
 * Every key in the dock that is not a tab, not Report, and not the pane's own
 * stretched tap target.
 *
 *   undo         MUTED's key
 *   dismiss      a trailing text key
 *   reroute      re-plan the line that is still under you
 *   end          stop the route -- the ONLY End in the application
 *   add          UNMAPPED's filled key
 *   wrong        CLEARED's dispute key
 *   around       THE DETOUR KEY. See `dockRerouteLabel`.
 *
 *   start        E1 -- begin a proposed line
 *   cancel       E4 -- stop looking for a new one, keep the old
 *   recalculate  E5 -- pick up a line the driver has already left
 *   save         E6 -- keep the drive that just finished
 *
 * `recalculate` IS NOT `reroute`, and collapsing the two would be the kind of
 * saving that costs a driver a turn. `reroute` re-plans a line that is still
 * under you to steer around a reader; `recalculate` picks up a line you have
 * already left. Different offers, different consequences, and section E5 spells
 * the second one out on its own key.
 *
 * `DriveRows.DockNavAction` is `Extract`ed from this union rather than restated,
 * so a member removed here fails there rather than silently un-drawing a footer.
 */
export type DockActionKey =
  | 'undo'
  | 'dismiss'
  | 'reroute'
  | 'end'
  | 'add'
  | 'wrong'
  | 'around'
  | 'start'
  | 'cancel'
  | 'recalculate'
  | 'save'
  /*
   * PEW. The one key on the dock that is not about the road: the arcade,
   * `features/arcade/`. Drawn only on `dense` while parked in range of a
   * reader, in the slot the map inset leaves empty -- see `DockData.arcade`.
   */
  | 'arcade';

/**
 * THE DETOUR KEY'S FACE. `Reroute around 3`, and never a bare `Around 3`.
 *
 * Rule 7 of the handoff, and the reason is grammar: `Around 3` names a quantity
 * without saying what happens to it, so a driver reading four characters at
 * 70mph gets a number and no verb. The glyph beside it is an arrow leaving a
 * corner and the word is that arrow said out loud; the pair is the offer.
 *
 * V2 spelled the bare form here as `dockAroundLabel` and both renderers then
 * spelled the full one locally rather than call it. Those three spellings
 * collapse to this one: `BrowseRow.dockDetourLabel` and
 * `DriveRows.dockRerouteLabel` should re-export it.
 */
export function dockRerouteLabel(count: number): string {
  return `Reroute around ${String(count)}`;
}

/**
 * WHAT THE KEY SAYS OUT LOUD, which is not quite what it draws.
 *
 * The painted label is already a whole sentence, so the spoken one only has to
 * name what is being routed around -- a reader, not a number.
 */
export function dockRerouteSpoken(count: number): string {
  return count === 1 ? 'Reroute around 1 reader' : `Reroute around ${String(count)} readers`;
}

/* ------------------------------------------------------------------------ *
 * THE COLLAPSED PANE'S DATA
 * ------------------------------------------------------------------------ */

/**
 * Every string and number the 150px body renders, and nothing else.
 *
 * V2's `DockData` also carried the expanded sheet's hero, its nearby list, the
 * route's ETA and its step list, because v2's one type served three
 * compositions. V3 splits them: `ExpandedPanel` owns the three sheets' shapes
 * and `DriveRows` owns the navigation row's, each as a discriminated union, so
 * a caller cannot hand the turn list a set of readers and get an empty pane
 * back with no error anywhere. What is left here is the collapsed pane's own
 * slots, which is the only thing `BrowseRow` reads.
 *
 * FIELDS ARE NAMED FOR THE SLOT THEY FILL, not for the meaning of one state's
 * value, because the question a renderer asks is always "what goes in this
 * box". `statusTrailing` is a mapped total in IDLE, a cache date in OFFLINE and
 * an accuracy in GPS WEAK -- one slot, one field, three meanings.
 *
 * Every field is optional because no state uses more than seven of them, and an
 * ABSENT FIELD IS AN ABSENT SLOT: `exactOptionalPropertyTypes` is on, so
 * `around: undefined` is a type error rather than a quiet second spelling of a
 * key that is not there.
 */
export interface DockData {
  /**
   * The 19px sentence, or the run that qualifies a figure. 15px as a caption.
   *
   * `Working from cache`, `cameras within 2 mi`, `Muted · Metcalf Ave`.
   */
  readonly statusText?: string;

  /** The small trailing value. `139,918 mapped`, `Sep 1`, `±180 ft`. */
  readonly statusTrailing?: string;

  /**
   * THE NUMBER THE DENSITY RAMP COLOURS. A bare count, no unit, no separator.
   *
   * Only a state whose count is a CAMERA DENSITY may carry the tier word beside
   * it -- ABUSE ZONE's three sourced reports are an accountability reading and
   * running the ramp on them would paint an accountability number in the
   * density hue. `BrowseRow.dockDensityOf` is where that gate lives.
   */
  readonly count?: number;

  /** Distance to the nearest reader, as a headline. `1.5 mi`. */
  readonly distance?: string;

  /** MUTED -- time left on the mute, `8:12`. */
  readonly countdown?: string;

  /**
   * The 30px readout where the reading is not a count and not a distance, or
   * the 19px sentence where there is no number worth printing at all.
   * `600`, `Cleared`, `Clear for 2.1 mi`, `Working from cache`.
   */
  readonly figure?: string;

  /**
   * UNDER SURVEILLANCE only -- `Likely under` / `surveillance`.
   *
   * A tuple rather than a string with a newline. V2 hard-broke it at 26px
   * because it drew a 71px row; v3 sets the whole phrase on one 19px line and
   * `BrowseRow` joins it. The tuple survives so the two spellings cannot drift
   * and so a future row that wants the break back has it.
   */
  readonly figureLines?: readonly [string, string];

  /** The line under the lede. `ahead on Overland Pkwy`, `nearest 1.4 mi`. */
  readonly subline?: string;

  /** The second sentence, when a state has one. `Flock · fixed pole`. */
  readonly secondaryText?: string;

  /**
   * The right slot's STATIC word -- a citation, not an action.
   *
   * `Read` on ABUSE, ENTERING and `Dismiss` on UNMAPPED. Drawn as a span and
   * never as a button, because a word that looks pressable and is not is worse
   * than a word that does not.
   */
  readonly secondaryTrailing?: string;

  /** The label on a key that has a word rather than a count. `Undo`, `Add`. */
  readonly keyLabel?: string;

  /**
   * HOW MANY READERS A DETOUR WOULD ROUTE AROUND. The numeral on the key.
   *
   * A COUNT, NOT A LABEL -- `dockRerouteLabel` spells it, so the slots that
   * draw it cannot end up saying different words. Absent takes the key off the
   * pane: a key offering to route around nothing is a key that refuses.
   *
   * AND NOT THE STATE'S OWN NUMERAL. DENSE AREA counts every reader within two
   * miles; this counts the ones a single line can be pushed off, and the road
   * rarely makes them equal. See `withDetourCount`.
   */
  readonly around?: number;

  /**
   * THE GAME IS ON OFFER. Present draws the 44px PEW key in the inset slot.
   *
   * `true` OR ABSENT, never `false`: the field is the key, the way `around`
   * is, so a renderer gates on presence and an absent field is an absent key.
   * Only `app/ShellDock.tsx` sets it, through `withArcadeOffer`, and only
   * from `features/arcade/offer.ts` -- the eight conditions live there, not
   * on any slot that draws the key.
   */
  readonly arcade?: true;

  /**
   * WHICH WAY THE LENS LOOKS, in compass degrees, for the 56px map inset.
   *
   * APPROACHING and UNDER SURVEILLANCE draw a tile because the facing is the
   * one thing the sentence beside it cannot say. Absent draws the spec's own
   * default bearing rather than a guessed one -- a reader whose facing nobody
   * measured has no cone to draw.
   */
  readonly facingDeg?: number;

  /**
   * ABUSE, ENTERING -- the outlet that reported it, and when.
   *
   * NOT render fields: the rendered line already contains both. They exist
   * because the brief makes the source a GATE -- the state fires on
   * jurisdiction entry and must cite outlet and date, and "if a report has no
   * source, do not raise the alert" -- so whoever decides to raise it needs the
   * outlet as a value it can test for, not as a substring.
   */
  readonly outlet?: string;
  readonly sourceDate?: string;
}

/**
 * PUT THE DETOUR'S OWN COUNT ON THE DATA, or take the key off the dock.
 *
 * `around` is the one field here that is not read off a store and counted. It
 * is the size of a PLAN -- how many readers a detour built from this fix
 * actually steers around, through `plan.consideredCameras` -- so only the
 * surface that plans it can know the number, which is `app/ShellDock.tsx`. It
 * arrives through this function so the rule below is written once instead of at
 * each slot that draws the key.
 *
 * NULL DELETES THE FIELD RATHER THAN BLANKING IT, because both renderers gate
 * the key on the field being present, so an absent field IS an absent key.
 */
export function withDetourCount(data: DockData, count: number | null): DockData {
  const { around: _replaced, ...rest } = data;
  return count === null ? rest : { ...rest, around: count };
}

/**
 * PUT THE ARCADE OFFER ON THE DATA, OR TAKE THE KEY OFF THE DOCK.
 *
 * `withDetourCount`'s rule, for the other field the ladder does not derive:
 * whether the game may be offered is `features/arcade/offer.ts`'s answer and
 * only the shell asks it. FALSE DELETES THE FIELD RATHER THAN BLANKING IT --
 * `exactOptionalPropertyTypes` is on and `arcade: undefined` would be a
 * second spelling of an absent key.
 */
export function withArcadeOffer(data: DockData, on: boolean): DockData {
  const { arcade: _replaced, ...rest } = data;
  return on ? { ...rest, arcade: true } : rest;
}

/* ------------------------------------------------------------------------ *
 * THE SPEC'S OWN VALUES
 * ------------------------------------------------------------------------ */

/**
 * Sections A and B, transcribed once.
 *
 * The spec page, the tests and any future rebuild of it all need these exact
 * strings, and transcribing them a second time somewhere else is how they
 * drift. Punctuation is the file's: `·` is U+00B7 MIDDLE DOT, `—` is U+2014
 * with a space either side, `±` is U+00B1. Nothing here is tidied.
 *
 * This is a FIXTURE, not a default. It is the spec's example data, and a real
 * dock is fed by `useDockState`. Sections E, F and C carry their own, beside
 * the components that draw them.
 *
 * SEVEN OF THE FOURTEEN ARE NOT DRAWN IN THE SPEC PAGE. B crops to five cards
 * and A draws the exposure card; MUTED, GPS WEAK, MESH SYNC, ABUSE ZONE, ABUSE
 * ENTERING, ARMED and UNMAPPED keep the copy brief 1 published for them, which
 * that brief still governs. Where v3 restates a line, v3 wins.
 */
export const DOCK_FIXTURES: Readonly<Record<DockCollapsedStateId, DockData>> = {
  /* A's own card, at the tier the spec draws: fourteen within two miles. The
     tier word is not in `secondaryText` because `BrowseRow` draws it from
     `DOCK_TIER_WORD`; what is left of A's meta line is the rest of it. */
  dense: {
    count: 14,
    statusText: 'cameras within 2 mi',
    secondaryText: '9 on route · 2 inter-agency',
    around: 9,
  },
  cruising: {
    figure: '3',
    statusText: 'ahead on Overland Pkwy',
    subline: 'nearest 1.4 mi',
    around: 3,
  },
  approaching: {
    figure: '600',
    statusText: 'ft · Antioch & 119th',
    subline: 'Flock · fixed pole, both directions',
    around: 1,
  },
  passing: {
    figureLines: ['Likely under', 'surveillance'],
    subline: 'plate read expected · 2 shared networks',
    secondaryTrailing: 'Log it',
  },
  cleared: {
    figure: 'Clear for 2.1 mi',
    subline: 'next at Metcalf · 4 min',
    secondaryTrailing: 'Dismiss',
  },
  offline: {
    figure: 'Working from cache',
    subline: 'last synced 14 min ago · 1010 cameras stored',
    secondaryTrailing: 'Retry',
  },
  idle: {
    count: 0,
    statusText: 'Clear for 4.2 mi',
    statusTrailing: '139,918 mapped',
  },
  armed: {
    distance: '1.5 mi',
    statusText: 'Flock Safety · faces SE',
  },
  muted: {
    statusText: 'Muted · Metcalf Ave',
    statusTrailing: '8:12',
    countdown: '8:12',
    keyLabel: 'Undo',
  },
  'abuse-zone': {
    count: 3,
    statusText: 'abuse reports · Overland Park PD',
  },
  'abuse-entering': {
    figure: 'Reported abuse',
    statusText: 'Entering Overland Park PD',
    subline: 'Data shared outside agency · KCUR, Aug 2026',
    secondaryTrailing: 'Read',
    outlet: 'KCUR',
    sourceDate: 'Aug 2026',
  },
  'gps-weak': {
    statusText: 'GPS weak · alerts may arrive late',
    statusTrailing: '±180 ft',
  },
  'mesh-sync': {
    statusText: 'Mesh · 7 drivers confirming nearby',
    statusTrailing: 'Synced 2m',
  },
  unmapped: {
    figure: 'Saw one?',
    statusText: 'Nothing mapped at this signal',
    keyLabel: 'Add',
    secondaryTrailing: 'Dismiss',
  },
};

/**
 * Which tab the spec draws lit, per collapsed state.
 *
 * Thirteen of the fourteen light Map. MESH SYNC is the one exception and it is
 * the whole point of that state: a sync event is the one ambient thing worth
 * pointing at the Mesh screen for.
 *
 * This lives here rather than in `DOCK_FIXTURES` because the active tab is a
 * prop on the dock, not data a state carries.
 */
export const DOCK_FIXTURE_TAB: Readonly<Record<DockCollapsedStateId, DockTabKey>> = {
  idle: 'map',
  armed: 'map',
  dense: 'map',
  muted: 'map',
  offline: 'map',
  cruising: 'map',
  approaching: 'map',
  passing: 'map',
  cleared: 'map',
  'abuse-zone': 'map',
  'abuse-entering': 'map',
  'gps-weak': 'map',
  'mesh-sync': 'mesh',
  unmapped: 'map',
};
