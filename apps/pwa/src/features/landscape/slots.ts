/**
 * WHAT OCCUPIES THE TWO SLOTS -- `DarkRoute Landscape Mode.html`, section C.
 *
 * =============================================================================
 * THE MODE SWITCH CHANGES THE OCCUPANT, NEVER THE BOX
 * =============================================================================
 * "Neither slot ever changes size, and an alert inserts a third 56 px band
 *  under the top slot rather than growing it."  -- section C
 *
 * So this module answers one question -- WHAT GOES IN EACH BOX -- and answers it
 * with data only. It names no length: every number the slots are is in
 * `geometry.ts` and every one is a constant in both modes. A function here that
 * could return a height would be the seam through which a mode eventually
 * changed one.
 *
 * =============================================================================
 * MONITOR DOES NOT RENDER AN EMPTY TOP SLOT. IT HAS NO TOP SLOT.
 * =============================================================================
 * Measured, and it settles a real ambiguity in the handoff. Frame A2's direct
 * children are the map, the scrim, the left rail, the BOTTOM slot and the right
 * rail -- five elements. There is no 336 x 84 box in that frame at any opacity.
 * The spec's own subtitle says it out loud: "the top slot is not empty, it does
 * not exist".
 *
 * That is why {@link LandscapeSlots} makes `top` nullable rather than giving it
 * an "empty" variant. A box that renders nothing still takes 84px of column,
 * still casts a shadow on the map and still has to be explained to a driver who
 * can see it; an absent one costs nothing and says nothing.
 *
 * =============================================================================
 * IT DERIVES, IT DOES NOT READ
 * =============================================================================
 * Nothing here subscribes to a store, and no figure is computed from a fix. The
 * whole input is the dock's own derived state plus the route's own facts,
 * because the landscape column and the portrait dock have to be showing the
 * same drive -- two derivations of "what is happening now" is how a driver ends
 * up with a maneuver on one surface and a different one on another after
 * rotating. `MonitorCard.tsx` gives the same argument for the same reason.
 */

import type { DockNavStateId } from '../dock/dockState.ts';
import type { DockDerived } from '../dock/useDockState.ts';
import type { DockTurn } from '../dock/icons.tsx';
import { type CameraCount, COUNT_DASH, COUNT_UNKNOWN, counted } from '../search/panel.ts';

/** Section A1 is navigation, A2 is monitor. There is no third. */
export type LandscapeMode = 'monitor' | 'navigation';

/**
 * WHICH MODE THE COLUMN IS IN, off the dock's own pane and nothing else.
 *
 * A SECOND READING OF THE ROUTE STORE WOULD BE A SECOND ANSWER. `useDockState`
 * already runs the whole ladder -- route active, planning, off-route, arrived --
 * and the landscape column is the same drive seen sideways, so it takes that
 * verdict rather than re-deciding "are we navigating" from `route !== null`.
 * The two would disagree during a reroute, which is exactly when a driver is
 * looking.
 *
 * EXPANDED IS NOT A MODE. Section D: "Tapping the bottom slot slides a 336 px
 * panel up the left column to full height". That is the same mode with the
 * column showing a list, which is why `expanded` is a separate flag on the
 * chrome and not a third value here -- and why a driver who expands the list
 * mid-drive is still in navigation mode underneath it.
 */
export function landscapeMode(derived: DockDerived): LandscapeMode {
  if (derived.pane === 'navigating') return 'navigation';
  if (derived.pane === 'expanded') {
    return derived.view.view === 'nearby' ? 'monitor' : 'navigation';
  }
  return 'monitor';
}

/**
 * THE TOP SLOT -- "what is happening now" (section C).
 *
 * A maneuver, drawn as a readout and a line. Every field is optional for the
 * reason `DockData`'s are: `exactOptionalPropertyTypes` is on, so an ABSENT
 * FIELD IS AN ABSENT SLOT rather than a second spelling of an empty one.
 */
export interface LandscapeTopSlot {
  /** The 30px readout. `0.4`, `900`, `18`. */
  readonly figure?: string;
  /** What it counts, on its baseline. `mi`, `ft`, `min · 7.2 mi`. */
  readonly unit?: string;
  /** The phrase that stands in where there is no number. `Off route`. */
  readonly title?: string;
  /** The 14px line under either. `Right onto W 119th St`. */
  readonly sub?: string;
  /**
   * WHICH WAY THE TURN GOES, as a direction and never as a character.
   *
   * Absent draws NO GLYPH rather than a default arrow -- `DriveRows.leadMark`
   * makes the same refusal: a mirrored or borrowed arrow costs the driver a
   * turn, and a slot that starts at the readout only costs a picture.
   */
  readonly turn?: DockTurn;
}

/**
 * THE ALERT BAND -- the third element, 56px, under the top slot.
 *
 * "Splits in two. Transient content goes to the top slot; standing state goes
 *  to the bottom slot."  -- section B, on the portrait alert card
 *
 * WHY THIS IS ITS OWN ELEMENT AND NOT A TOP-SLOT VARIANT, which is the shape
 * the portrait dock would suggest. The portrait pane has ONE body and so has to
 * choose: at `camera-on-route` it draws the reader and the maneuver goes away.
 * The landscape column has two boxes and a band, so it can draw both, and A1
 * does -- `0.4 mi / Right onto W 119th St` in the top slot with `900 ft · Flock
 * on route / Reroute` in the band beneath it. That is not a new composition
 * invented here: it is E3's own `figure`/`sub` in one element and E3's own
 * `footer`/`around` in the other, which is why the two can never describe
 * different readers.
 */
export interface LandscapeAlertBand {
  /** The 21px numeral. `900`. */
  readonly figure?: string;
  /** The rest of the sentence. `ft · Flock on route`. */
  readonly text: string;
  /** How many readers a detour would route around. Absent takes the key off. */
  readonly around?: number;
}

/**
 * THE BOTTOM SLOT -- "where you stand" (section C): counts, exposure, ETA.
 *
 * A discriminated union rather than one optional-everything record, because the
 * three variants section C draws are three different sentences and a renderer
 * that had to guess which one it held from which fields were present is a
 * renderer that draws `Retry` on a live route.
 */
export type LandscapeBottomSlot =
  | {
      readonly kind: 'navigation';
      /** `10:03`. Null while the route has no duration to add to the clock. */
      readonly arrival: string | null;
      /** `18`. Null for the same reason. */
      readonly minutes: string | null;
      /** How many readers are on the line. NEVER faked -- see `CameraCount`. */
      readonly onRoute: CameraCount;
      /** `7.2 mi remaining`. */
      readonly remaining: string | null;
    }
  | {
      readonly kind: 'monitor';
      /** The density count within two miles. */
      readonly count: CameraCount;
      /** `cameras within 2 mi`. */
      readonly statusText?: string;
      /** `nearest 0.4 mi`. */
      readonly subline?: string;
      /** The detour key's numeral. Absent takes the key off. */
      readonly around?: number;
    }
  | {
      readonly kind: 'offline';
      /** `Working from cache`. */
      readonly statusText: string;
      /** `1010 cameras stored`. */
      readonly detail?: string;
      /** `last synced 14 min ago`. */
      readonly subline?: string;
    };

export interface LandscapeSlots {
  readonly mode: LandscapeMode;
  /** Null in monitor mode, and the null is the point -- see the header. */
  readonly top: LandscapeTopSlot | null;
  /** Null unless a reader is on the line ahead. */
  readonly band: LandscapeAlertBand | null;
  readonly bottom: LandscapeBottomSlot;
}

/**
 * THE ROUTE'S OWN FACTS, which the dock's derived state does not carry.
 *
 * `DockNavData` publishes a readout, a sentence and a footer -- the three slots
 * the 170px pane has. The landscape bottom slot draws an ARRIVAL CLOCK, a
 * duration, a reader count and a distance remaining, and only one of those four
 * is ever in the dock's shape. So they arrive here as measurements rather than
 * as sentences, and this module does the formatting, once.
 *
 * NULL IS "NOT MEASURED YET" AND IT IS DRAWN AS SUCH. A route that has not
 * returned a duration has no arrival time, and printing the current clock in
 * the meantime would tell a driver they had already arrived.
 */
export interface LandscapeRouteFacts {
  /** The plan's remaining duration. Null before the router has answered. */
  readonly seconds: number | null;
  /** The plan's remaining distance in miles. Null for the same reason. */
  readonly miles: number | null;
  /**
   * How many readers are on the line.
   *
   * NULL IS NOT ZERO AND THIS IS THE SAFETY RULE, not a style preference. Zero
   * readers on a route is a real, reassuring answer; printing it before anyone
   * has counted tells a driver the road is clear on the strength of a number
   * nobody computed. {@link COUNT_UNKNOWN} draws a dash instead.
   */
  readonly onRoute: number | null;
  /** `Date.now()` at render, injected so the clock is testable. */
  readonly nowMs: number;
}

/** Working from cache, and what is in it. Drawn in place of either variant. */
export interface LandscapeOfflineFacts {
  readonly statusText: string;
  readonly detail?: string;
  readonly subline?: string;
}

/**
 * THE ARRIVAL CLOCK. `10:03`, in the driver's own locale and time zone.
 *
 * `format` IS INJECTED, and the default is the only thing this module knows
 * about `Intl`. A test that asserted a wall-clock string would assert the
 * machine's time zone: the same code prints `10:03` in Kansas and `16:03` in
 * Berlin, and both are correct. So the seam is a parameter, the tests pass a
 * fixed formatter, and production gets the platform's.
 */
export function arrivalClock(
  nowMs: number,
  seconds: number | null,
  format: (at: Date) => string = defaultClock,
): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  return format(new Date(nowMs + seconds * 1000));
}

function defaultClock(at: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at);
}

/**
 * THE BARE NUMERAL, AND THE DASH WHERE THERE IS NONE.
 *
 * `countLabel` in `features/search/panel.ts` spells "14 cams", which is right
 * for a list row where the count is the only thing in the column and wrong for
 * both landscape slots, where the unit is a separate 11px caption beside a 30px
 * figure -- "14" over "cameras within 2 mi", "2" over "on route". So the figure
 * is taken bare here and the DASH is the one `panel.ts` publishes, imported
 * rather than respelled: there is one dash in this product and this is it.
 *
 * NEVER `String(0)` FOR AN UNMEASURED COUNT. Zero readers is a real and
 * reassuring answer, which is exactly why faking it is a safety lie rather than
 * a cosmetic one.
 */
export function countFigure(count: CameraCount): string {
  return count.state === 'known' ? String(count.cams) : COUNT_DASH;
}

/** `18` from 1080 seconds. Rounded, because a minute is the unit on the glass. */
export function remainingMinutes(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  return String(Math.round(seconds / 60));
}

/** `7.2 mi remaining`. One decimal, which is what A1 and section C both draw. */
export function remainingDistance(miles: number | null): string | null {
  if (miles === null || !Number.isFinite(miles) || miles < 0) return null;
  return `${miles.toFixed(1)} mi remaining`;
}

/** The six navigation states, and which of them puts a reader in the band. */
const BAND_STATES: ReadonlySet<DockNavStateId> = new Set<DockNavStateId>(['camera-on-route']);

/**
 * THE WHOLE COMPOSITION, from the dock's verdict and the route's measurements.
 *
 * `offline` WINS OVER BOTH MODES, and it wins because it is a statement about
 * whether the other two can be trusted. A count taken from a cache that last
 * synced fourteen minutes ago is not wrong, but a driver is entitled to know
 * which it is before they act on it -- and section C draws the cache sentence
 * as a bottom-slot variant rather than as a banner for exactly that reason.
 */
export function landscapeSlots(
  derived: DockDerived,
  route: LandscapeRouteFacts,
  offline: LandscapeOfflineFacts | null = null,
): LandscapeSlots {
  const mode = landscapeMode(derived);

  if (offline !== null) {
    return {
      mode,
      top: mode === 'navigation' ? topOf(derived) : null,
      band: bandOf(derived),
      bottom: {
        kind: 'offline',
        statusText: offline.statusText,
        ...(offline.detail === undefined ? {} : { detail: offline.detail }),
        ...(offline.subline === undefined ? {} : { subline: offline.subline }),
      },
    };
  }

  if (mode === 'navigation') {
    return {
      mode,
      top: topOf(derived),
      band: bandOf(derived),
      bottom: {
        kind: 'navigation',
        arrival: arrivalClock(route.nowMs, route.seconds),
        minutes: remainingMinutes(route.seconds),
        onRoute: route.onRoute === null ? COUNT_UNKNOWN : counted(route.onRoute),
        remaining: remainingDistance(route.miles),
      },
    };
  }

  return { mode, top: null, band: null, bottom: monitorBottom(derived) };
}

/** E1-E6's readout and its line, lifted straight off `DockNavData`. */
function topOf(derived: DockDerived): LandscapeTopSlot | null {
  const data = navDataOf(derived);
  if (data === null) return null;
  return {
    ...(data.figure === undefined ? {} : { figure: data.figure }),
    ...(data.unit === undefined ? {} : { unit: data.unit }),
    ...(data.title === undefined ? {} : { title: data.title }),
    ...(data.sub === undefined ? {} : { sub: data.sub }),
    ...(data.turn === undefined ? {} : { turn: data.turn }),
  };
}

/**
 * The band, and ONLY at E3. The other five navigation states have nothing
 * transient to say that the top slot is not already saying, and a band that
 * appeared on every state would be a 56px element the column reserved for
 * nothing -- which is the portrait bug section C exists to avoid.
 */
function bandOf(derived: DockDerived): LandscapeAlertBand | null {
  if (derived.pane !== 'navigating') return null;
  if (!BAND_STATES.has(derived.state)) return null;
  const { footer, around } = derived.data;
  if (footer === undefined) return null;
  return { text: footer, ...(around === undefined ? {} : { around }) };
}

/** The navigating pane's own props, named so `topOf` does not re-narrow. */
type NavData = Extract<DockDerived, { readonly pane: 'navigating' }>['data'];

function navDataOf(derived: DockDerived): NavData | null {
  return derived.pane === 'navigating' ? derived.data : null;
}

/**
 * A2 AND A3'S SHARED HEADER: the density count and the two lines beside it.
 *
 * IT READS BOTH PANES, and it has to. A3 is the same monitor reading with the
 * list under it -- section D calls it "a 336 px panel ... to full height",
 * which is a different height and not a different answer -- but the dock's own
 * ladder moves the data from `DockData` to `DockNearbyData` when the sheet
 * opens, because the portrait sheet draws a different composition. Reading only
 * the collapsed shape would blank the count the moment a driver expanded the
 * list, which is precisely when they are looking at it.
 *
 * The two shapes name the same three things differently -- `statusText` is
 * `headline`, `subline` is `note` -- and this is the one place that translation
 * happens.
 */
function monitorBottom(derived: DockDerived): LandscapeBottomSlot {
  if (derived.pane === 'expanded' && derived.view.view === 'nearby') {
    const { count, headline, note, around } = derived.view.data;
    return {
      kind: 'monitor',
      count: counted(count),
      statusText: headline,
      subline: note,
      ...(around === undefined ? {} : { around }),
    };
  }

  const data = derived.pane === 'collapsed' ? derived.data : null;
  const count = data?.count;
  return {
    kind: 'monitor',
    /* NOT `counted(0)`. An absent `count` is a state with no density reading --
       MUTED, OFFLINE, GPS WEAK -- and printing a zero there would tell a driver
       there is nothing within two miles on the strength of a number nobody
       took. `COUNT_UNKNOWN` draws the dash. */
    count: count === undefined ? COUNT_UNKNOWN : counted(count),
    ...(data?.statusText === undefined ? {} : { statusText: data.statusText }),
    ...(data?.subline === undefined ? {} : { subline: data.subline }),
    ...(data?.around === undefined ? {} : { around: data.around }),
  };
}
