/**
 * THE SEARCH PANEL'S BRAIN -- sections B, D, E and F of
 * `DarkRoute Search Entry.html`.
 *
 * The four states, the six result types, the ranking rule that puts somewhere
 * you have been above a geocoder's guess, and the camera-count tiers. All pure:
 * `SearchPanel.tsx` draws what this returns and decides nothing itself.
 *
 * =============================================================================
 * THE COUNT IS THE POINT, AND A DASH IS A REAL ANSWER
 * =============================================================================
 * Principle 03 of the spec: "Every row shows cameras on the fastest route
 * there, tiered by colour. It is why someone opens this app instead of Maps, so
 * it appears BEFORE the choice, not after."
 *
 * Which is why {@link CameraCount} is a two-armed type rather than a
 * `number | null` that the markup gets to interpret. E. RULES: "A row that
 * cannot compute a count shows a dash and a retry, NEVER A BLANK." And never a
 * zero either, which is the failure the two-armed type exists to make
 * impossible: zero is a real and reassuring answer here -- it is the answer the
 * whole product is trying to find -- and defaulting an unknown to it would be
 * telling a driver a road is clear because the app has not looked yet.
 *
 * =============================================================================
 * WHAT DOES NOT LIVE HERE
 * =============================================================================
 * The counts themselves. Computing "cameras on the fastest route to this saved
 * place" is a ROUTE, and `services/route/planRoute.ts` opens with the rule that
 * nothing in it may run except from a direct user action -- "no call while
 * somebody types". Nine recents on open would be nine origin-destination pairs
 * sent for a question nobody has asked, which is precisely the record this
 * application exists to avoid producing. So counts arrive as data, from a host
 * that has a right to them, and every row this file builds is honest about not
 * having one.
 * GAP: docs/gaps-inbox/search-panel.md#c-nobody-can-compute-the-camera-counts-yet
 */

import { formatDistance, subtitleOf, titleOf } from '../lookup/search.ts';
import { OWNER_LABELS } from '../triage/triage.ts';
import { orderedRecents, orderedSaved } from './places.ts';
import type { PlaceBook, RecentPlace, SavedPlace } from './places.ts';
import type { SearchHit } from '../lookup/search.ts';
import type { Place } from '../../services/route/planRoute.ts';

/* ========================================================================== *
 * THE COUNT
 * ========================================================================== */

/**
 * How many cameras are on the fastest route to a row's destination.
 *
 * `unknown` is not an error and not an empty state -- it is "not measured
 * yet", and the panel draws it as a dash with a retry beside it.
 */
export type CameraCount =
  | { readonly state: 'known'; readonly cams: number }
  | { readonly state: 'unknown' };

/** The one unknown value, so nothing has to construct it. */
export const COUNT_UNKNOWN: CameraCount = { state: 'unknown' };

/** A measured count. Negative is not a count and is refused rather than drawn. */
export function counted(cams: number): CameraCount {
  return Number.isFinite(cams) && cams >= 0
    ? { state: 'known', cams: Math.round(cams) }
    : COUNT_UNKNOWN;
}

/**
 * WHICH OF THE THREE COLOURS A COUNT IS DRAWN IN.
 *
 * "Green at zero, amber 1-3, red 4+" -- E. RULES, and `--dr-tier-*` in
 * `tokens.css` carry the hues. Returned as a NAME rather than as a colour so
 * this file stays free of paint and the stylesheet stays the only thing that
 * knows what amber is.
 */
export type CountTier = 'clear' | 'some' | 'many' | 'unknown';

export function countTier(count: CameraCount): CountTier {
  if (count.state === 'unknown') return 'unknown';
  if (count.cams === 0) return 'clear';
  return count.cams <= 3 ? 'some' : 'many';
}

/**
 * THE DASH A ROW SHOWS WHEN IT HAS NO COUNT.
 *
 * An EN dash, and deliberately not the repository's `NO_VALUE` em dash. "First
 * run is a sentence" forbids em dashes on this surface in the same breath as it
 * forbids a zero, so the panel does not draw one anywhere -- and the shorter
 * rule reads as a placeholder in a column of "0 cams" / "1 cam" rather than as
 * a typographic aside. Recorded in `docs/gaps-inbox/search-panel.md`: the spec
 * says "a dash" and does not say which.
 */
export const COUNT_DASH = '–';

/**
 * "0 cams" / "1 cam" / "6 cams" / "-".
 *
 * SINGULAR AT ONE. The spec draws "1 cam" and "2 cams" in the same list, and a
 * list that says "1 cams" is a list a person stops trusting about the numbers.
 */
export function countLabel(count: CameraCount): string {
  if (count.state === 'unknown') return COUNT_DASH;
  return count.cams === 1 ? '1 cam' : `${String(count.cams)} cams`;
}

/** What a screen reader hears instead of a bare dash. */
export function countName(count: CameraCount): string {
  return count.state === 'unknown'
    ? 'camera count not measured yet'
    : `${countLabel(count)} on the fastest route`;
}

/* ========================================================================== *
 * THE FOUR STATES
 * ========================================================================== */

/**
 * Section B, in order: idle, typing, picked, routing.
 *
 * DERIVED, NOT STORED. Four booleans that can disagree with each other is four
 * ways to be in two states at once; one function over the state that actually
 * exists cannot be.
 */
export type SearchState = 'idle' | 'typing' | 'picked' | 'routing';

export interface SearchStateInput {
  readonly query: string;
  /** The destination a row was tapped on, or null. */
  readonly picked: Place | null;
  /** A route has started. The panel dismisses. */
  readonly routing: boolean;
}

export function panelState({ query, picked, routing }: SearchStateInput): SearchState {
  if (routing) return 'routing';
  if (picked !== null) return 'picked';
  return query.trim() === '' ? 'idle' : 'typing';
}

/* ========================================================================== *
 * THE SIX RESULT TYPES -- section D
 * ========================================================================== */

/**
 * THE BADGE GLYPHS, AS CODEPOINTS, COPIED AND NOT SUBSTITUTED.
 *
 * The spec draws characters rather than icons for these and the brief says so
 * twice: "the spec draws a star glyph -- copy it, do not substitute", "Measure
 * the real glyphs in the DOM and copy them." So they are here as the literal
 * codepoints that were read out of the rendered document, with the escape
 * beside each one because a bare U+21BB in a source file is a character a diff
 * cannot show you and an editor can silently normalise.
 *
 * H and W are Latin capitals and carry no escape because there is nothing to
 * mistake them for.
 */
export const BADGE_SAVED_HOME = 'H';
export const BADGE_SAVED_WORK = 'W';
export const BADGE_SAVED_OTHER = '★'; /* BLACK STAR */
export const BADGE_RECENT = '↻'; /* CLOCKWISE OPEN CIRCLE ARROW */
export const BADGE_PLACE = '◎'; /* BULLSEYE */
export const BADGE_CAMERA = '◉'; /* FISHEYE */
export const BADGE_ABUSE = '▲'; /* BLACK UP-POINTING TRIANGLE */
export const BADGE_MANEUVER = '→'; /* RIGHTWARDS ARROW */

/**
 * WHAT COLOUR A BADGE IS, as a name the stylesheet resolves.
 *
 * Six types, and the operator tints are four of them because section D tints an
 * indexed camera's badge to WHOSE hardware it is. `unverified` is purple by the
 * owner's decision of 2026-09-08 and is never merged into the verified group.
 */
export type BadgeTone =
  | 'saved'
  | 'other-saved'
  | 'muted'
  | 'flock'
  | 'police'
  | 'hoa'
  | 'private'
  | 'unverified'
  | 'abuse'
  | 'keep';

/** The archive's owner classes, mapped onto the tints section D draws. */
const OWNER_TONE: Readonly<Record<string, BadgeTone>> = {
  inter_agency: 'flock',
  police: 'police',
  hoa: 'hoa',
  private: 'private',
  unverified: 'unverified',
};

/**
 * THE RIGHT-HAND SIDE OF A ROW, AND IT IS NOT ONE THING.
 *
 * A DESTINATION row carries a camera COUNT: how many readers are on the way
 * there, which is the question the panel exists to answer.
 *
 * A CAMERA or an ABUSE AREA row carries a two-line stack instead -- a distance
 * over a verb, "1.6 mi" above "SHOW" -- because a camera is not somewhere you
 * are going and "cameras on the route to this camera" is not a question. That
 * is what section D draws, and it is why E. RULES names only "saved, recent and
 * map results alike" when it says every row shows its count.
 *
 * The disagreement between that and sections A and B, which draw a count on
 * every row they contain, is recorded in `docs/gaps-inbox/search-panel.md`.
 */
export type RowTrailing =
  | { readonly kind: 'count'; readonly count: CameraCount }
  | { readonly kind: 'meta'; readonly far: string; readonly verb: string };

/** What tapping a row does. Section D publishes a verb for every type. */
export type RowAction =
  /** TAP TO ROUTE. A destination, and the panel moves to PICKED. */
  | { readonly kind: 'route'; readonly place: Place }
  /** TAP TO SHOW. Reveals the marker and opens its card. Never a destination. */
  | { readonly kind: 'show'; readonly cameraId: string }
  /** A route option in PICKED. Starting one is what writes history. */
  | { readonly kind: 'start'; readonly optionId: RouteOptionKind }
  /** The one press that leaves the device. */
  | { readonly kind: 'look-up' };

/**
 * The two groups section D headers the mixed list with, and the caption each
 * one carries. Drawn only when both are present: a list of destinations with a
 * DESTINATIONS header over it and nothing else is a header explaining itself.
 */
export type RowGroup = 'destinations' | 'cameras';

export const GROUP_LABEL: Readonly<Record<RowGroup, string>> = {
  destinations: 'DESTINATIONS',
  cameras: 'CAMERAS · INDEXED',
};
export const GROUP_VERB: Readonly<Record<RowGroup, string>> = {
  destinations: 'TAP TO ROUTE',
  cameras: 'TAP TO SHOW',
};

/**
 * HOW A ROW IS EDGED.
 *
 *   `none`     a plain row -- no border, no fill. Sections A and B draw every
 *              idle row this way.
 *   `history`  a TYPING match that is somewhere you have already been. Accent
 *              edge, accent wash, and it keeps its recent badge.
 *   `default`  the fewest-cameras route option. Green, not accent -- see the
 *              note on `--dr-keep-row-line` in `tokens.css`.
 */
export type RowEmphasis = 'none' | 'history' | 'default';

export interface SearchRow {
  readonly id: string;
  readonly group: RowGroup;
  readonly glyph: string;
  readonly tone: BadgeTone;
  readonly name: string;
  readonly sub: string;
  readonly trailing: RowTrailing;
  readonly emphasis: RowEmphasis;
  readonly action: RowAction;
}

/* ========================================================================== *
 * MATCHING
 * ========================================================================== */

/** The typed words, folded and split. Empty means "everything". */
export function words(query: string): readonly string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Word-AND across the name and the line under it, the same rule
 * `features/lookup/search.ts` uses on a camera record.
 *
 * Every word has to appear SOMEWHERE, in either field, in any order -- so
 * "antioch 119" finds "119th & Antioch" without the driver having to remember
 * which half the list put first.
 */
export function matchesPlace(
  place: { readonly name: string; readonly detail: string },
  typed: readonly string[],
): boolean {
  if (typed.length === 0) return true;
  const hay = `${place.name} ${place.detail}`.toLowerCase();
  return typed.every((word) => hay.includes(word));
}

/* ========================================================================== *
 * BUILDING THE LIST
 * ========================================================================== */

/**
 * Where a row's camera count comes from. Given a place, answer how many
 * readers are on the fastest route there -- or say you have not measured.
 *
 * A FUNCTION RATHER THAN A MAP, so a host that has an answer for two of nine
 * rows returns `COUNT_UNKNOWN` for the other seven instead of having to build a
 * complete table before the panel can draw at all.
 */
export type CountLookup = (place: {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}) => CameraCount;

/** Nothing has been measured. The honest default, and the one the app ships with. */
export const NO_COUNTS: CountLookup = () => COUNT_UNKNOWN;

function savedGlyph(place: SavedPlace): string {
  if (place.kind === 'home') return BADGE_SAVED_HOME;
  return place.kind === 'work' ? BADGE_SAVED_WORK : BADGE_SAVED_OTHER;
}

function savedRow(
  place: SavedPlace,
  counts: CountLookup,
  emphasis: RowEmphasis,
  estimates: EstimateLookup = NO_ESTIMATES,
): SearchRow {
  const estimate = estimates(place);
  return {
    id: `saved:${place.id}`,
    group: 'destinations',
    glyph: savedGlyph(place),
    /* H and W are cyan; a starred place is amber. Section D: "H, W or star." */
    tone: place.kind === 'other' ? 'other-saved' : 'saved',
    name: place.name,
    /* THE DRIVE WHEN IT IS KNOWN, the locality when it is not. */
    sub: estimate === null ? place.detail : driveSub(estimate),
    trailing: { kind: 'count', count: counts(place) },
    emphasis,
    action: { kind: 'route', place: { name: place.name, detail: place.detail, lat: place.lat, lon: place.lon } },
  };
}

/**
 * "recent · 2 trips", or "recent" on the first one.
 *
 * Section D: "Somewhere a route actually ran to. Sub-line carries the trip
 * count." The place's own detail is dropped for it -- a recent has already been
 * driven to, so its locality is a thing the driver knows and the count is not.
 */
export function recentSub(place: RecentPlace): string {
  return place.trips <= 1 ? 'recent' : `recent · ${String(place.trips)} trips`;
}

/**
 * THE DRIVE, WHICH IS WHAT THE SPEC'S SUB-LINE ACTUALLY CARRIES.
 *
 * `DarkRoute Search Entry.html`, state 1, transcribed from the file rather than
 * described:
 *
 *   name: 'Home',          sub: '14 min · 7.2 mi',  cams: '2 cams'
 *   name: 'Work',          sub: '22 min · 11.4 mi', cams: '6 cams'
 *   name: 'Oak Park Mall', sub: '9 min · 4.1 mi',   cams: '3 cams'
 *
 * Whole minutes, one decimal mile, U+00B7 with a space either side. Every row
 * in that drawing has one; the build shipped with the place's ADDRESS there and
 * a dash where the count goes, which is the row's two most useful facts missing
 * -- "how far is that from me, and what does it cost me to go".
 */
export interface RowEstimate {
  /** Whole minutes on the fastest route. */
  readonly minutes: number;
  /** Miles on the same route, to one decimal. */
  readonly miles: number;
}

/**
 * The host's answer for one place, or null when nothing has measured it.
 *
 * NULL IS NOT ZERO, the same discipline `CameraCount` keeps and for the same
 * reason: a row nobody has planned keeps the sub-line it already had rather
 * than claiming a drive of no minutes.
 */
export type EstimateLookup = (place: { readonly lat: number; readonly lon: number }) => RowEstimate | null;

export const NO_ESTIMATES: EstimateLookup = () => null;

/** `'14 min · 7.2 mi'` -- the spec's own format, in its own order. */
export function driveSub(estimate: RowEstimate): string {
  return `${String(Math.round(estimate.minutes))} min · ${estimate.miles.toFixed(1)} mi`;
}

/**
 * `'recent · 6 min'` -- state 2's THIRD form, and it is neither of the other
 * two. A history match while typing keeps its recency AND gains the drive,
 * because at that moment the driver is choosing between a place they know and a
 * geocoder result they do not.
 */
export function recentTypingSub(place: RecentPlace, estimate: RowEstimate | null): string {
  if (estimate === null) return recentSub(place);
  return `recent · ${String(Math.round(estimate.minutes))} min`;
}

/**
 * `'Leawood, KS · 4.2 mi'` -- state 2's map result, which keeps its locality
 * (two identical street names have to be tellable apart) and appends the
 * distance when it is known. The spec draws both forms, one row apart.
 */
export function placeSub(detail: string, estimate: RowEstimate | null): string {
  if (estimate === null) return detail;
  return `${detail} · ${estimate.miles.toFixed(1)} mi`;
}

function recentRow(
  place: RecentPlace,
  counts: CountLookup,
  emphasis: RowEmphasis,
  estimates: EstimateLookup = NO_ESTIMATES,
): SearchRow {
  const estimate = estimates(place);
  return {
    id: `recent:${place.id}`,
    group: 'destinations',
    glyph: BADGE_RECENT,
    tone: 'muted',
    name: place.name,
    /* IDLE draws the drive; TYPING draws `recent · N min`, which is the spec's
       own third form and is why `emphasis` decides this rather than a flag. */
    sub:
      estimate === null
        ? recentSub(place)
        : emphasis === 'history'
          ? recentTypingSub(place, estimate)
          : driveSub(estimate),
    trailing: { kind: 'count', count: counts(place) },
    emphasis,
    action: { kind: 'route', place: { name: place.name, detail: place.detail, lat: place.lat, lon: place.lon } },
  };
}

function placeRow(
  place: Place,
  counts: CountLookup,
  estimates: EstimateLookup = NO_ESTIMATES,
): SearchRow {
  const estimate = estimates(place);
  return {
    id: `place:${place.name}:${String(place.lat)},${String(place.lon)}`,
    group: 'destinations',
    glyph: BADGE_PLACE,
    tone: 'muted',
    name: place.name,
    /* The LOCALITY, so two identical street names are tellable apart -- which
       is what section D says this line is for -- and the distance beside it
       once something has measured one. The spec draws both forms one row
       apart: 'Overland Park, KS' and 'Leawood, KS · 4.2 mi'. */
    sub: placeSub(place.detail, estimate),
    trailing: { kind: 'count', count: counts(place) },
    emphasis: 'none',
    action: { kind: 'route', place },
  };
}

function cameraRow(hit: SearchHit): SearchRow {
  const owner = hit.camera.ownerType;
  const label = owner === undefined ? 'UNCLASSIFIED' : OWNER_LABELS[owner];
  return {
    id: `camera:${hit.camera.id}`,
    group: 'cameras',
    glyph: BADGE_CAMERA,
    tone: owner === undefined ? 'muted' : (OWNER_TONE[owner] ?? 'muted'),
    name: titleOf(hit.camera),
    sub: subtitleOf(hit.camera, label),
    /* DISTANCE OVER A VERB, not a camera count. See `RowTrailing`. */
    trailing: { kind: 'meta', far: formatDistance(hit.metres) ?? '', verb: 'SHOW' },
    emphasis: 'none',
    action: { kind: 'show', cameraId: hit.camera.id },
  };
}

/**
 * 1 · IDLE -- saved first in fixed order, then recents newest-first.
 *
 * No filtering, no query, no cursor. "Most trips are somewhere the user has
 * already been", so the panel's job on open is to show those.
 */
export function idleRows(
  book: PlaceBook,
  counts: CountLookup = NO_COUNTS,
  estimates: EstimateLookup = NO_ESTIMATES,
): readonly SearchRow[] {
  return [
    ...orderedSaved(book).map((place) => savedRow(place, counts, 'none', estimates)),
    ...orderedRecents(book).map((place) => recentRow(place, counts, 'none', estimates)),
  ];
}

export interface TypingInput {
  readonly book: PlaceBook;
  readonly query: string;
  /**
   * What the geocoder answered, or null when it has not been asked.
   *
   * NULL IS THE NORMAL STATE. `planRoute.ts` forbids a call while somebody
   * types, so these arrive only after the one press that says so.
   */
  readonly places: readonly Place[] | null;
  /** The readers already on this phone, from `searchCameras`. */
  readonly cameras: readonly SearchHit[];
  readonly counts?: CountLookup | undefined;
  /** The drive per place, for the sub-line the spec draws. See `RowEstimate`. */
  readonly estimates?: EstimateLookup | undefined;
}

/**
 * 2 · TYPING -- live filter, and HISTORY MATCHES RANK ABOVE MAP RESULTS.
 *
 * The one ranking rule the spec states outright, and the reason for it is in
 * the caption under state 2: somewhere you have been beats a geocoder's guess.
 * A person typing "119th and Ant" who has driven to 119th & Antioch six times
 * is not asking to be shown three ways of spelling it.
 *
 * A HISTORY MATCH KEEPS ITS RECENT BADGE. It does not become a map result
 * because a query happened to be typed at it -- the badge says where the row
 * came from, and that is still history.
 *
 * AND ITS COUNT STAYS. "Camera counts stay on every row."
 *
 * THE FILTER IS LOCAL AND THE FILTER IS EVERYTHING. Saved places, recents and
 * the cameras on this phone are all matched here, on the device, with no call
 * of any kind. `places` is the only part that ever came off the network and it
 * is null until somebody presses for it.
 */
export function typingRows({
  book,
  query,
  places,
  cameras,
  counts = NO_COUNTS,
  estimates = NO_ESTIMATES,
}: TypingInput): readonly SearchRow[] {
  const typed = words(query);

  const history: SearchRow[] = [
    ...orderedSaved(book)
      .filter((place) => matchesPlace(place, typed))
      .map((place) => savedRow(place, counts, 'history', estimates)),
    ...orderedRecents(book)
      .filter((place) => matchesPlace({ name: place.name, detail: place.detail }, typed))
      .map((place) => recentRow(place, counts, 'history', estimates)),
  ];

  /*
   * A GEOCODER ANSWER THAT IS ALREADY IN HISTORY IS NOT A SECOND ROW. The two
   * lists come from different places and describe the same corner, and drawing
   * both would put "119th & Antioch" above "W 119th St & Antioch Rd" and ask a
   * driver at speed to tell them apart.
   */
  const seen = new Set(history.map((row) => row.name.trim().toLowerCase()));
  const found = (places ?? [])
    .filter((place) => !seen.has(place.name.trim().toLowerCase()))
    .map((place) => placeRow(place, counts, estimates));

  return [...history, ...found, ...cameras.map(cameraRow)];
}

/* ========================================================================== *
 * 3 · PICKED -- the route options
 * ========================================================================== */

/**
 * THE THREE OPTIONS, AND THE ORDER IS THE PRODUCT.
 *
 * "Route options rank by exposure first, not duration. Any other navigation app
 * defaults to fastest; this one is why the user installed it." The order is
 * FIXED and stated -- fewest cameras, then fastest, then avoid abuse areas --
 * rather than sorted by the counts that come back, so a run where the fastest
 * route happens to tie on cameras still puts the exposure answer first and
 * still labels it as the one this app chose.
 */
export type RouteOptionKind = 'fewest-cameras' | 'fastest' | 'avoid-abuse';

export const ROUTE_OPTION_ORDER: readonly RouteOptionKind[] = [
  'fewest-cameras',
  'fastest',
  'avoid-abuse',
];

/** The spec's own three titles, character for character. */
export const ROUTE_OPTION_TITLE: Readonly<Record<RouteOptionKind, string>> = {
  'fewest-cameras': 'Fewest cameras',
  fastest: 'Fastest',
  'avoid-abuse': 'Avoid abuse areas',
};

export interface RouteOption {
  readonly kind: RouteOptionKind;
  /** "8 min · 2.9 mi". The router's own arithmetic, formatted by the caller. */
  readonly detail: string;
  readonly count: CameraCount;
}

/**
 * 3 · PICKED. Up to three routes as rows, fewest-cameras FIRST and filled.
 *
 * NUMBERED 1, 2, 3 IN THE BADGE, which is what the spec draws -- and the number
 * is the row's POSITION rather than a property of the option, so a run that
 * came back with only two options numbers them 1 and 2 and does not leave a
 * gap where the third would have been.
 *
 * NOTHING IS WRITTEN TO HISTORY HERE. This function returns rows; the write
 * happens on the ROUTING transition, once. A destination looked at and
 * abandoned leaves no trace.
 */
export function routeRows(options: readonly RouteOption[]): readonly SearchRow[] {
  const ranked = [...options].sort(
    (a, b) => ROUTE_OPTION_ORDER.indexOf(a.kind) - ROUTE_OPTION_ORDER.indexOf(b.kind),
  );
  return ranked.slice(0, ROUTE_OPTION_ORDER.length).map((option, index) => ({
    id: `route:${option.kind}`,
    group: 'destinations' as const,
    glyph: String(index + 1),
    tone: index === 0 ? ('keep' as const) : ('muted' as const),
    name: ROUTE_OPTION_TITLE[option.kind],
    sub: option.detail,
    trailing: { kind: 'count' as const, count: option.count },
    /* THE FIRST ROW IS THE DEFAULT, and it is filled to say so. */
    emphasis: index === 0 ? ('default' as const) : ('none' as const),
    action: { kind: 'start' as const, optionId: option.kind },
  }));
}

/* ========================================================================== *
 * GROUPING
 * ========================================================================== */

export interface RowSection {
  readonly group: RowGroup;
  /** Drawn only when the list holds more than one group. */
  readonly headed: boolean;
  readonly rows: readonly SearchRow[];
}

/**
 * The list, split into the groups section D headers.
 *
 * A HEADER THAT EXPLAINS ITSELF IS NOISE. Sections A and B draw no headers at
 * all, because everything in those lists is a destination; section D draws them
 * on the mixed query, where a row that routes and a row that only reveals a
 * marker sit six pixels apart and the verb is the difference. So the header
 * appears exactly when there is something to distinguish FROM.
 */
export function sections(rows: readonly SearchRow[]): readonly RowSection[] {
  const order: readonly RowGroup[] = ['destinations', 'cameras'];
  const present = order
    .map((group) => ({ group, rows: rows.filter((row) => row.group === group) }))
    .filter((entry) => entry.rows.length > 0);
  return present.map((entry) => ({ ...entry, headed: present.length > 1 }));
}
