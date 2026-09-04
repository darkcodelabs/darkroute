/**
 * WHAT THE INTEL CARD SAYS, DECIDED AS A TABLE.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A4 · INTEL CARD - MODAL FROM SWEEP`
 * (the title row, the id line, the three tiles, the five fact rows, the photo
 * drop and the four actions) and `B9 · RECORD FLAGS - WHERE IT SURFACES`
 * ("ON THE INTEL CARD").
 *
 * Pure. No React, no store, no browser global, and -- like `radarState.ts` and
 * `sweepState.ts` -- no arithmetic on a coordinate. Distance, bearing and
 * facing arrive already measured by `@fwm/core`; this module turns them into
 * the exact glyphs the panel draws and decides which rows this build can
 * honestly fill in.
 *
 * =============================================================================
 * THE CARD DRAWS TWELVE FIELDS AND THIS BUILD HOLDS SIX
 * =============================================================================
 * A4 draws twelve values: the hardware name, the distance readout, the camera
 * id, the cross street, OWNER, MOUNT, FACING, EFF ATLAS, INTER-AGENCY SHARING,
 * FIRST REPORTED, CONFIRMED BY and YOUR READS.
 *
 * SIX HAVE A SOURCE. `CameraRecord` (`services/db/schema.ts`) is `id`, `lat`,
 * `lon`, `directionDeg`, `ownerType?`, `confirmations?`, `updatedAt?` -- which
 * covers the id, OWNER, FACING and CONFIRMED BY. The readout comes from the
 * engine's `CameraAssessment` and YOUR READS from this device's own alert log.
 *
 * SIX DO NOT: the hardware name the title reads ("FALCON"), the cross street,
 * MOUNT, the EFF Atlas cross-reference, the inter-agency sharing count and a
 * first-reported date.
 *
 * FOUR OF THOSE SIX RENDER {@link NO_VALUE} -- MOUNT and the three fact rows.
 * THE OTHER TWO DO NOT, and that is the one place this card departs from the
 * em-dash rule: an em dash in the 22px title slot is honest and unreadable, so
 * the id is promoted into the title (it is the only identifier the build always
 * holds) and the line under it carries an authored note. See
 * {@link intelIdentity} and {@link IDENTITY_UNKNOWN_NOTE} -- nothing is filled
 * from a plausible-looking stand-in either way.
 *
 * The fuller record does exist in `src/test/fixtures/cameras.ts` as
 * `FixtureCameraRecord` ("the fuller record the API is expected to serve"),
 * and `toCameraRecord()` narrows it away before anything the app runs on can
 * see it -- so importing it here to fill the card would be dressing a test
 * fixture up as a camera the driver is looking at.
 * GAP: docs/gaps-inbox/intel.md#camerarecord-carries-six-of-the-cards-twelve-fields
 *
 * =============================================================================
 * A FLAG COLOURS THE OPERATOR, NOT THE CAMERA
 * =============================================================================
 *   "The flag colors the operator, not the camera, so a flagged agency's cams
 *    still alert normally."  -- Screens II, B9
 *
 * The card's hue is `IntelViewModel.state` and nothing else -- resolved by the
 * caller from `resolveRadarState()`, turned into a colour once, in `intel.css`.
 * The operator record cannot reach it. The banner is the only destructive-hued
 * thing on the card, and `IntelView.test.tsx` asserts a flagged card keeps its
 * alert state.
 */

import { catalogue } from '../../services/cameras/catalogue.ts';
import { FEATURES } from '../../config/features.ts';
import type { CameraAssessment, CameraOwnerType, CameraRecord } from '../../stores';
import { addDays, isCameraPass, localDayStart } from '../log';
import type { AlertLogEntry } from '../../stores';
// PURE GEOMETRY, not a map. `miniMap.ts` imports nothing and touches no
// browser API, so the card's model can turn tags into drawn spans without
// breaking its own rule against holding a renderer. See its header.
import { facingSpans } from '../map/miniMap.ts';
import type { FacingSpan } from '../map/miniMap.ts';
import {
  NO_VALUE,
  distanceUnit,
  formatCount,
  formatDistanceValue,
  formatHeadingCardinal,
  formatHeadingDegrees,
  formatMuteCountdown,
} from '../radar';
import type { DistanceUnit, RadarState } from '../radar';

// ---------------------------------------------------------------------------
// Identity -- the title row and the line under it
// ---------------------------------------------------------------------------

/**
 * The line under the title when nothing is left to put there.
 *
 * The panel renders `FWM-0442 · READING & TENNESSEE`: an id and a cross
 * street. This build has the id and has no street -- there is no place field
 * on `CameraRecord`, and the only way to produce one would be to reverse
 * geocode a camera's coordinates against somebody's server, which is a network
 * request keyed to a location this product exists to keep local.
 *
 * When the id has already been promoted into the title (because no hardware
 * name exists to put there) there is nothing left for this line but the truth
 * about it, said in the product's existing notice idiom -- the same shape as
 * `PHOTO_OFF_NOTE` in `features/report`. (Quoting it here would date: that
 * sentence has already been rewritten once, when the photo path shipped.)
 * GAP: docs/gaps-inbox/intel.md#identity-line-copy-is-authored
 */
export const IDENTITY_UNKNOWN_NOTE = 'NO HARDWARE OR PLACE NAME ON THIS RECORD';

export interface IntelIdentity {
  /** The 22px title. The hardware name, or the id when there is none. */
  readonly title: string;
  /** The mono line under it. Never empty -- the panel always draws it. */
  readonly subline: string;
  /** True when {@link subline} is the note rather than a rendered fact. */
  readonly sublineIsNote: boolean;
  /**
   * True when the camera id is the title rather than the line below it.
   *
   * The header uses this to decide WHICH element is the copy target: the id is
   * rendered exactly once and the copy affordance follows it, so the one thing
   * `clipboard.ts` exists for does not quietly disappear on the records this
   * build actually holds.
   */
  readonly idInTitle: boolean;
}

/**
 * Where the camera stands, as a line: `METCALF AVE @ W 95TH ST`.
 *
 * The `@` is only printed when there really is a cross street within range of
 * an intersection. The deleted `scripts/fetch-street-names.mjs` pipeline made
 * that distinction; these names now survive only as carried-forward archive
 * fields. Most cameras are mid-block and get the street alone, and naming a
 * road half a mile away as a cross street would be inventing a junction.
 *
 * Null when the record has no street, which is the honest answer for a camera
 * that snapped to nothing: the card then falls back to what it printed before.
 */
export function streetLine(record: CameraRecord | null | undefined): string | null {
  const street = record?.street;
  if (typeof street !== 'string' || street.trim() === '') return null;
  const cross = record?.cross;
  if (typeof cross !== 'string' || cross.trim() === '' || cross === street) return street;
  return `${street} @ ${cross}`;
}

/**
 * `FALCON` / `FWM-0442 · READING & TENNESSEE`, as far as the record allows.
 *
 * The id is the only identifier this build always has, so it is what the title
 * falls back to. It is never printed twice: once it is the title, the line
 * below carries the place, or the note.
 */
export function intelIdentity(
  cameraId: string,
  hardware: string | null,
  place: string | null,
  owner: string | null = null,
): IntelIdentity {
  /*
   * THE OWNER IS A NAME. THE ID IS NOT.
   *
   * Only 17.7% of records carry `manufacturer`, so most cards fell straight
   * through to the id and opened with `osm:12648084745` in the largest text on
   * the screen - while `JCPRD`, a name that answers "whose camera is this",
   * sat in a tile underneath it.
   *
   * `operator` is on a different 17.7% of records and the two barely overlap,
   * so trying it second roughly doubles the cards that lead with a word
   * instead of a key. Second and not first: `manufacturer` says what the thing
   * on the pole IS, which is the more specific answer when both exist.
   *
   * `shortOperator` rather than the raw tag, so the title agrees with the
   * OWNER tile exactly. Two different renderings of the same fact on one card
   * reads as two facts.
   */
  const named = hardware ?? shortOperator(owner);
  if (named === null) {
    return place === null
      ? { title: cameraId, subline: IDENTITY_UNKNOWN_NOTE, sublineIsNote: true, idInTitle: true }
      : { title: cameraId, subline: place, sublineIsNote: false, idInTitle: true };
  }
  /*
   * THE PLACE LEADS, AND THE ID TRAILS.
   *
   * This read `osm:13631150001 · I-35 @ US HWY 56`. The most-read line on the
   * card opened with a database key -- fifteen digits of the highest-contrast
   * text in the block, carrying nothing a driver can use, in front of the one
   * string that says where the camera actually is.
   *
   * The id has to stay: it is what a driver quotes to report a bad record, and
   * `mapRegistry` keys on it. It goes last, where it is available without
   * being read first.
   */
  const parts = place === null ? [cameraId] : [place, cameraId];
  return {
    title: named,
    subline: parts.join(' · '),
    sublineIsNote: false,
    idInTitle: false,
  };
}

// ---------------------------------------------------------------------------
// The readout -- `425 FT · SW`
// ---------------------------------------------------------------------------

export interface IntelReadout {
  /** `425`, or `2.4` once it is a mile-scale distance, or an em dash. */
  readonly value: string;
  readonly unit: DistanceUnit;
  /** `SW` -- the compass bearing to the camera. Null when there is no fix. */
  readonly cardinal: string | null;
}

/**
 * The alert-hued line beside the title.
 *
 * WHICH DIRECTION IS `SW`?
 *   The panel prints `425 FT · SW` in the header and `223°` in the FACING
 *   tile, and 223° IS south-west, so the two readings the design allows --
 *   the bearing to the camera, and the camera's own facing -- both render `SW`
 *   for the values drawn. This takes it as the BEARING TO THE CAMERA: the
 *   facing already has a tile of its own three lines down, and a 375px card
 *   that prints one fact twice while the driver's "which way do I look" goes
 *   unanswered is the weaker of the two readings. It is also the only reading
 *   under which the header answers something the tiles do not.
 *   GAP: docs/gaps-inbox/intel.md#header-cardinal-is-ambiguous
 *
 * `bearingDeg` is a compass bearing from the engine, so this is the same
 * eight-point vocabulary `formatHeadingCardinal` already speaks, and no angle
 * is computed here.
 */
export function intelReadout(assessment: CameraAssessment | null): IntelReadout {
  if (assessment === null) {
    return { value: NO_VALUE, unit: 'FT', cardinal: null };
  }
  const cardinal = formatHeadingCardinal(assessment.bearingDeg);
  return {
    value: formatDistanceValue(assessment.distanceFt),
    unit: distanceUnit(assessment.distanceFt),
    cardinal: cardinal === NO_VALUE ? null : cardinal,
  };
}

// ---------------------------------------------------------------------------
// The three tiles -- OWNER / MOUNT / FACING
// ---------------------------------------------------------------------------

/** Exact labels from the panel, in the drawn order. */
export const TILE_LABELS = ['OWNER', 'MOUNT', 'FACING'] as const;

export type IntelTileLabel = (typeof TILE_LABELS)[number];

export interface IntelTile {
  readonly label: IntelTileLabel;
  readonly value: string;
  /** False when the value is {@link NO_VALUE} because nothing supplied it. */
  readonly known: boolean;
}

/**
 * The OWNER tile's words.
 *
 * `A4` draws exactly one owner value -- `HOA` -- and `B4 · ALERT TRIAGE` names
 * all five in full: `POLICE / AGENCY`, `INTER-AGENCY SHARED`,
 * `HOA / NEIGHBORHOOD`, `PRIVATE / BUSINESS`, `UNVERIFIED REPORTS`. `HOA` is
 * B4's third row cut at the slash, so the other four are cut the same way
 * rather than invented: the tile is one of three across a 375px card and the
 * full B4 strings do not fit it.
 * GAP: docs/gaps-inbox/intel.md#owner-tile-has-one-drawn-value
 */
/**
 * THE AGENCY, SHORT ENOUGH TO FIT IN A TILE.
 *
 * =============================================================================
 * MEASURED, NOT GUESSED
 * =============================================================================
 * All 8,605 shipped z11 tiles, deduped by id - 132,068 records, of which 23,357
 * (17.6856%) carry `operator`. Median length 25 characters, p90 33, longest
 * 108, and 61.8% are over 20. The OWNER tile is about 55px of inner column on a
 * 320px screen. Nothing about that fits.
 *
 * Three phrases account for roughly half of them:
 *   POLICE DEPARTMENT              9,416   40.31%
 *   SHERIFF (all forms)            1,323    5.66%
 *   DEPARTMENT OF TRANSPORTATION     659    2.82%
 *
 * =============================================================================
 * THE MAPPERS ALREADY DO THIS
 * =============================================================================
 * `ST. CHARLES COUNTY PD` (159 records) and `ST. LOUIS CITY PD` (122) are what
 * OSM contributors wrote themselves. This is not a new abbreviation scheme, it
 * is the one already in the data, applied evenly - and it makes those records
 * agree with the ones written out in full instead of reading as two agencies.
 *
 * ORDER IS LOAD-BEARING. "DEPARTMENT OF TRANSPORTATION" has to go before
 * "DEPARTMENT", or "NYC DEPARTMENT OF TRANSPORTATION" (560 records) becomes
 * "NYC D OF TRANSPORTATION". Only a TRAILING phrase is replaced, so an agency
 * that merely contains one of these words in the middle of its name is left
 * alone.
 *
 * Nothing is invented and nothing is dropped: every replacement is a shorter
 * spelling of the same words. The full string is still on the record, and the
 * intel card is not the only place it can be shown.
 */
const OPERATOR_SHORT: readonly (readonly [RegExp, string])[] = Object.freeze([
  // Both apostrophes: OSM carries 102 records with the typographic one.
  [/\bSHERIFF['’]?S? (?:OFFICE|DEPARTMENT|DEPT\.?)$/, "SHERIFF'S OFFICE"],
  [/\bDEPARTMENT OF TRANSPORTATION$/, 'DOT'],
  [/\bPOLICE (?:DEPARTMENT|DEPT\.?|DIVISION)$/, 'PD'],
  [/\bFIRE (?:DEPARTMENT|DEPT\.?)$/, 'FD'],
  [/\bDEPARTMENT OF PUBLIC SAFETY$/, 'DPS'],
]);

/** The sheriff pass normalises the spelling, then this shortens the result. */
const SHERIFF_SHORT = Object.freeze([/\bSHERIFF['’]?S? OFFICE$/, 'SO'] as const);

export function shortOperator(value: string | null): string | null {
  if (value === null) return null;
  let out = value.trim();
  if (out === '') return null;
  for (const [pattern, replacement] of OPERATOR_SHORT) {
    if (pattern.test(out)) {
      out = out.replace(pattern, replacement);
      break;
    }
  }
  out = out.replace(SHERIFF_SHORT[0], SHERIFF_SHORT[1]);
  return out;
}

/**
 * EVERY APPROACH THE MAPPER RECORDED, not just the first one.
 *
 * =============================================================================
 * ONE BEARING WAS NEVER THE WHOLE ANSWER
 * =============================================================================
 * `CameraRecord.directionDeg` holds a single number, so a node tagged
 * `direction=305;175;240` -- a camera covering three approaches -- ships as
 * "305" and the other two are gone. That is 7,861 records, 5.9522% of the
 * archive, told they face one way when the mapper said three.
 *
 * The full string survives on `tags.direction`, so this is a rendering fix and
 * not a refetch: the data has been on the device the whole time.
 *
 * TWO FORMS, and the second is why this returns a discriminated list rather
 * than `number[]`:
 *   `305`      a bearing
 *   `338-23`   an ARC the camera covers, clockwise from north
 * 4,445 records (3.3657%) use the arc form, and `Number("338-23")` is NaN --
 * a plain number list turns those into holes silently.
 */
export type CoveredDirection =
  | { readonly kind: 'bearing'; readonly deg: number }
  | { readonly kind: 'arc'; readonly fromDeg: number; readonly toDeg: number };

const CARDINAL_DEG: Readonly<Record<string, number>> = Object.freeze({
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
});

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The covered directions, in the order the mapper wrote them.
 *
 * Returns an empty list rather than undefined when the tag is absent, so no
 * caller has to think about `exactOptionalPropertyTypes`.
 */
export function coveredDirections(record: CameraRecord | null): readonly CoveredDirection[] {
  const raw = record?.tags?.['direction'] ?? record?.tags?.['camera:direction'];
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  const out: CoveredDirection[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(';')) {
    const value = part.trim().toUpperCase();
    if (value === '') continue;

    const arc = /^(\d{1,3}(?:\.\d+)?)-(\d{1,3}(?:\.\d+)?)$/.exec(value);
    if (arc !== null) {
      const fromDeg = Number(arc[1]);
      const toDeg = Number(arc[2]);
      if (fromDeg > 360 || toDeg > 360) continue;
      const key = `a${fromDeg}-${toDeg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: 'arc', fromDeg: wrap360(fromDeg), toDeg: wrap360(toDeg) });
      continue;
    }

    const cardinal = CARDINAL_DEG[value];
    const deg = cardinal ?? Number(value);
    if (!Number.isFinite(deg)) continue;
    const key = `b${wrap360(deg)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: 'bearing', deg: wrap360(deg) });
  }
  return out;
}

/** "305° · 175° · 240°", or "338°-23°" for an arc. Empty list reads as null. */
export function formatCoveredDirections(covered: readonly CoveredDirection[]): string | null {
  if (covered.length === 0) return null;
  return covered
    .map((d) =>
      d.kind === 'arc'
        ? `${Math.round(d.fromDeg)}\u00B0-${Math.round(d.toDeg)}\u00B0`
        : `${Math.round(d.deg)}\u00B0`,
    )
    .join(' \u00B7 ');
}

export const OWNER_LABEL: Readonly<Record<CameraOwnerType, string>> = Object.freeze({
  police: 'POLICE',
  inter_agency: 'INTER-AGENCY',
  hoa: 'HOA',
  private: 'PRIVATE',
  unverified: 'UNVERIFIED',
});

function tile(label: IntelTileLabel, value: string | null): IntelTile {
  return value === null || value === NO_VALUE
    ? { label, value: NO_VALUE, known: false }
    : { label, value, known: true };
}

/**
 * A tag off the record, upper-cased, or null when the mapper did not write one.
 *
 * Upper-cased because every value on this card is set in the data face and OSM
 * values arrive in whatever case the mapper typed -- `pole`, `Pole`, `POLE`
 * are one answer and must not read as three.
 */
export function tagValue(record: CameraRecord | null, key: string): string | null {
  const raw = record?.tags?.[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // A semicolon list is OSM's way of saying "both", and the card has room for
  // one. The first is the mapper's own primary; averaging or joining them
  // would invent a value nobody wrote.
  const first = trimmed.split(';')[0]?.trim() ?? '';
  return first === '' ? null : first.toUpperCase();
}

/**
 * OWNER, MOUNT and FACING -- all three from the record now.
 *
 * MOUNT USED TO BE HARDCODED NULL, with a comment explaining that nothing on
 * `CameraRecord` could supply it. That was true of the record and never true of
 * the source: OSM carries `camera:mount` on 30.55% of these nodes, measured
 * across the whole archive after `scripts/enrich-cameras.mjs` merged the tags
 * in. Forty thousand cameras were printing a dash for a value the mapper had
 * written down.
 *
 * It is still a dash for the other 69%, and that is the correct answer rather
 * than a gap -- most ALPR nodes simply have no mount tagged.
 *
 * OWNER prefers the mapper's actual `operator` string over the four-way bucket.
 * "OVERLAND PARK POLICE DEPARTMENT" is a fact; `POLICE` is that fact with the
 * useful part removed. The bucket stays as the fallback, because it is derived
 * for every record and the operator is on 17.63%.
 */
/**
 * The FACING tile's value: the derived bearing, plus how many more were written.
 *
 * The suffix appears only when there is genuinely more than one, so the 94% of
 * records with a single bearing read exactly as they always have.
 */
function facingTileValue(record: CameraRecord): string | null {
  const base = formatHeadingDegrees(record.directionDeg);
  if (base === null) return null;
  const extra = coveredDirections(record).length - 1;
  return extra > 0 ? `${base} +${String(extra)}` : base;
}

export function intelTiles(record: CameraRecord | null): readonly IntelTile[] {
  const owner = record?.ownerType;
  const operator = tagValue(record, 'operator');
  return [
    // SHORTENED. Median operator is 25 characters and 61.8% are over 20, into
    // a tile about 55px wide - see `shortOperator`, which applies the same
    // abbreviations OSM mappers already write by hand.
    tile('OWNER', shortOperator(operator) ?? (owner === undefined ? null : OWNER_LABEL[owner])),
    // READABLE, not the raw tag. OSM values are lower_snake_case machine
    // strings and this printed them verbatim in caps: "TRAFFIC_SIGNALS".
    tile(
      'MOUNT',
      (tagValue(record, 'camera:mount') ?? tagValue(record, 'support'))?.replace(/[_-]+/g, ' ') ??
        null,
    ),
    /*
     * "305° +2" -- the derived facing, and an honest note that the mapper
     * recorded more than one. The full set goes in the COVERS row below, which
     * is full-card width; this tile is a nowrap ellipsis box about a third of a
     * 375px card, so joining three bearings into it would silently clip them.
     */
    tile('FACING', record === null ? null : facingTileValue(record)),
  ];
}

// ---------------------------------------------------------------------------
// The five fact rows
// ---------------------------------------------------------------------------

/** Exact labels from the panel, in the drawn order. */
export const FACT_LABELS = [
  'EFF ATLAS',
  'INTER-AGENCY SHARING',
  'FIRST REPORTED',
  /**
   * WHERE THIS CAMERA SITS IN ITS COUNTY, and how many it has company from.
   *
   * The three rows above have no data source in this build and the panel had
   * nothing else in it, so the biggest block on the card was mostly em dashes.
   * This is the one fact of that kind the archive can actually answer:
   * `countyFips` is on 99.07% of all 131,083 records, and `counties.json`
   * already carries a per-county camera count -- 3,845 in Harris County, TX.
   *
   * It reframes the card from "here is a camera" to "here is one of 3,845",
   * which is the difference between a pin and a picture. Neither number costs
   * a request: both ship with the app.
   */
  'IN THIS COUNTY',
  'CONFIRMED BY',
  /**
   * EVERY APPROACH, spelled out.
   *
   * The FACING tile can only hold one bearing and a count -- it is a nowrap
   * box a third of a card wide. This row is full-card width, so it is where
   * the mapper's whole answer fits. Absent on the 94% that recorded one
   * direction, which is the point: a row that repeats the tile is noise.
   */
  'COVERS',
  'YOUR READS',
  /**
   * HOW OLD THIS RECORD IS, which is the question every other row begs.
   *
   * The card states an owner, a mount, a bearing and a confirmation count as
   * though they were current. None of them is observed live - they are a
   * snapshot of OpenStreetMap taken when the archive was built, and a camera
   * removed the week after that build still prints here in full confidence.
   *
   * The stamp is the UPSTREAM time, not when this phone downloaded the tile.
   * Those are different facts and only one of them is about the camera: a
   * device that synced an hour ago still holds whatever OSM knew on the build
   * date, and reporting the download would make a stale record look fresh.
   */
  'DATA AS OF',
] as const;

export type IntelFactLabel = (typeof FACT_LABELS)[number];

/**
 * How the value is coloured. The panel draws three: green for the Atlas
 * cross-reference, alert red for the sharing count and for YOUR READS, and the
 * block's own `--fwm-text-2` for the rest.
 */
export type IntelFactTone = 'default' | 'clear' | 'alert';

/**
 * The colour the panel draws each row's value in, read straight off A4.
 *
 *   EFF ATLAS              CROSS-REFERENCED     #3DE08A  --fwm-alert-clear
 *   INTER-AGENCY SHARING   YES · 412 AGENCIES   #FF2D5E  --fwm-alert-in-range
 *   FIRST REPORTED         MAR 2026             the block's own --fwm-text-2
 *   CONFIRMED BY           28 HAKCERS           the block's own --fwm-text-2
 *   YOUR READS             21 IN 30 DAYS        #FF2D5E  --fwm-alert-in-range
 *
 * It is a table rather than three arguments at three call sites BECAUSE three
 * of these rows have no data source in this build. If the tone travelled with
 * the value, the two coloured rows nothing can fill today would carry no
 * colour anywhere in the codebase, and whoever lands the data source would
 * have to rediscover the design's colouring to get it back. `intelFact()`
 * reads this table, so the row is already the right colour the moment it has a
 * value -- and `intel.css`'s `[data-fwm-intel-tone="clear"]` rule is reachable
 * code rather than a rule no input can produce.
 */
export const FACT_TONE: Readonly<Record<IntelFactLabel, IntelFactTone>> = Object.freeze({
  'EFF ATLAS': 'clear',
  'INTER-AGENCY SHARING': 'alert',
  'FIRST REPORTED': 'default',
  'IN THIS COUNTY': 'default',
  'CONFIRMED BY': 'default',
  COVERS: 'default',
  'YOUR READS': 'alert',
  'DATA AS OF': 'default',
});

export interface IntelFact {
  readonly label: IntelFactLabel;
  readonly value: string;
  readonly tone: IntelFactTone;
  readonly known: boolean;
}

/**
 * The window `intelReads` filters over.
 *
 * Kept, and currently unreachable: the log it filters lives only in memory and
 * cannot hold anything older than this session. See the `YOUR READS` row for
 * why the CARD no longer says "in 30 days" while this stays 30.
 */
export const READ_WINDOW_DAYS = 30;

/**
 * How many times THIS device passed THIS camera inside the window.
 *
 * Counted off the alert log with `isCameraPass()` -- the same predicate LOG's
 * bars, hottest segment and timeline use -- so this card and EXPOSURE can
 * never disagree about the same drive. It does not read `entry.muted`: a muted
 * camera still read the plate.
 *
 * This is the device's own history and nothing else. It is not a plate lookup,
 * it asks no server, and it is the reason the row can be filled honestly while
 * `FEATURES.plateLookup` is off.
 */
export function intelReads(
  entries: readonly AlertLogEntry[],
  cameraId: string,
  nowMs: number,
  windowDays: number = READ_WINDOW_DAYS,
): number {
  const fromMs = addDays(localDayStart(nowMs), -(windowDays - 1));
  let reads = 0;
  for (const entry of entries) {
    if (entry.cameraId !== cameraId) continue;
    if (entry.atMs < fromMs) continue;
    if (!isCameraPass(entry)) continue;
    reads += 1;
  }
  return reads;
}

/**
 * One row, coloured the way the panel colours it.
 *
 * An absent value is always `default`: an em dash in alert red is a colour
 * about nothing. `tone` overrides {@link FACT_TONE} for the one row whose
 * colour depends on its value -- see `YOUR READS` in {@link intelFacts}.
 */
export function intelFact(
  label: IntelFactLabel,
  value: string | null,
  tone: IntelFactTone = FACT_TONE[label],
): IntelFact {
  return value === null
    ? { label, value: NO_VALUE, tone: 'default', known: false }
    : { label, value, tone, known: true };
}

export interface IntelFactsInput {
  readonly record: CameraRecord | null;
  readonly reads: number;
  readonly windowDays: number;
  /** Resolved by the caller from `countyFips`. See `IntelInput.county`. */
  readonly county?: { readonly label: string; readonly cameras: number } | null | undefined;
  /**
   * The archive's UPSTREAM timestamp - `index.json.upstream`, the moment the
   * OpenStreetMap snapshot behind this record was taken. ISO-8601.
   *
   * Not `generatedAt` (when the archive was built from that snapshot) and not
   * `fetchedAtMs` (when this phone copied it). Only one of the three is a fact
   * about the camera.
   */
  readonly upstreamIso?: string | null | undefined;
}

/**
 * The five rows, always all five, in the drawn order.
 *
 * Three of them have no field behind them in this build and render an em dash.
 * They are still drawn: a card that quietly dropped `INTER-AGENCY SHARING`
 * would read as "this camera does not share", which is the opposite of unknown
 * and is the single most consequential fact on the card.
 *
 * `YOUR READS` is coloured alert only when there is something to be alarmed
 * about. `0 IN 30 DAYS` in alert red is an alarm about nothing; the panel
 * draws the row at 21 and never at zero.
 * GAP: docs/gaps-inbox/intel.md#your-reads-tone-at-zero-not-drawn
 */
/** The COVERS row's value, or null when the record recorded a single facing. */
function coversValue(record: CameraRecord | null): string | null {
  const covered = coveredDirections(record);
  return covered.length > 1 ? formatCoveredDirections(covered) : null;
}

/**
 * `26 AUG 2026 · 5 DAYS AGO`, or a dash.
 *
 * BOTH HALVES, and the relative one is why the row exists. A date alone makes a
 * reader do arithmetic to learn the thing they actually want to know, and at
 * the roadside they will not - so the card would carry a freshness stamp that
 * nobody reads as freshness. The absolute date stays because "5 days ago" is
 * meaningless in a screenshot pasted into a bug report a month later.
 *
 * An unparseable or future stamp returns null rather than a guess: a clock skew
 * that printed "IN 3 DAYS" would undermine the row's whole point.
 */
export function dataAsOf(iso: string | null, nowMs: number = Date.now()): string | null {
  if (iso === null || iso === '') return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const days = Math.floor((nowMs - at) / 86_400_000);
  if (days < 0) return null;
  const when = new Date(at)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase();
  const ago = days === 0 ? 'TODAY' : days === 1 ? '1 DAY AGO' : `${String(days)} DAYS AGO`;
  return `${when} · ${ago}`;
}

export function intelFacts(input: IntelFactsInput): readonly IntelFact[] {
  const confirmations = input.record?.confirmations;
  return [
    intelFact('EFF ATLAS', null),
    intelFact('INTER-AGENCY SHARING', null),
    intelFact('FIRST REPORTED', null),
    /*
     * "JOHNSON CO, KS - 3,845 CAMERAS". The label carries the state, so the
     * row answers where AND how dense in one line, and the count is what turns
     * a pin into a picture: this camera is one of thousands, not a curiosity.
     *
     * A dash when `countyFips` is absent -- 0.93% of records, offshore nodes
     * and coastline gaps -- rather than the nearest county, which would be a
     * confident wrong answer about jurisdiction.
     */
    intelFact(
      'IN THIS COUNTY',
      input.county == null
        ? null
        : `${input.county.label} · ${formatCount(input.county.cameras)} CAMERAS`,
    ),
    intelFact(
      'CONFIRMED BY',
      confirmations === undefined ? null : `${formatCount(confirmations)} HAKCERS`,
    ),
    /*
     * Only when there is more than one. A single bearing is already the FACING
     * tile, and printing it twice is a row that says nothing new.
     */
    intelFact('COVERS', coversValue(input.record ?? null)),
    /*
     * "THIS SESSION", NOT "IN 30 DAYS", BECAUSE THERE IS NO 30 DAYS.
     *
     * `intelReads` counts off the alert log, and that log is NOT PERSISTED.
     * `repos.alerts.record()` -- the durable write -- has no production caller
     * anywhere; the only references to it are a docstring, a count for the
     * removal report, and a clear. `historyActions.hydrate()` is never called
     * at boot either. What LOG and this row read is the in-RAM zustand slice
     * in `stores/history.ts`, capped at 500 entries and gone on reload.
     *
     * So the window was decorative: `READ_WINDOW_DAYS` filtered a list that
     * cannot contain anything older than the current session, and the card
     * asserted a thirty-day history the device does not keep. Reading "0 IN 30
     * DAYS" as "no camera has read me in a month" is exactly the wrong
     * conclusion to hand somebody, and it is the conclusion the words invite.
     *
     * The window filter STAYS -- it costs nothing and is correct the day the
     * log becomes durable. Only the claim changes.
     */
    intelFact(
      'YOUR READS',
      `${formatCount(input.reads)} THIS SESSION`,
      input.reads > 0 ? FACT_TONE['YOUR READS'] : 'default',
    ),
    /*
     * LAST, because it is a caveat on every row above it rather than another
     * fact beside them. Owner, mount, bearing and confirmation count are all
     * stated as though current; this is the line that says as of when. A
     * caveat reads after the claim it qualifies.
     */
    intelFact('DATA AS OF', dataAsOf(input.upstreamIso ?? null)),
  ];
}

// ---------------------------------------------------------------------------
// B9 -- the flagged operator
// ---------------------------------------------------------------------------

/**
 * What the banner states, and where it came from.
 *
 *   "RECORD only ever states what a citable source states, and always names
 *    the agency -- never an individual."  -- Screens II, B9
 *
 * The panel renders one sentence -- "County sheriff -- 1 documented stalking
 * case, 1 unaudited-access finding." -- and this holds it as TWO fields on
 * purpose. `agency` is the agency it is about and `findings` is what the
 * sources found; {@link operatorSentence} is the only way to get the rendered
 * string, so a finding can never be displayed without an agency attached to
 * it. `sources` is how many citations stand behind it, which is what
 * `SEE THE 3 SOURCES` counts.
 *
 * There is no field here for a person's name, and there must never be one.
 */
export interface OperatorRecord {
  /** A named agency. Never an individual. */
  readonly agency: string;
  /** What the citable sources found, without the agency. */
  readonly findings: string;
  /** Citations behind the findings. The banner refuses to draw below one. */
  readonly sources: number;
}

/** `OPERATOR HAS A RECORD`, exactly as drawn. */
export const OPERATOR_RECORD_LABEL = 'OPERATOR HAS A RECORD';

/**
 * `County sheriff - 1 documented stalking case, 1 unaudited-access finding.`
 *
 * The em dash and the order are the panel's. The agency comes first because
 * B9's rule is that the record "always names the agency", and a sentence that
 * leads with the finding can be quoted with the agency cut off.
 */
export function operatorSentence(record: OperatorRecord): string {
  return `${record.agency} - ${record.findings}`;
}

/** `SEE THE 3 SOURCES`, with the real count. */
export function operatorSourcesLabel(sources: number): string {
  return `SEE THE ${formatCount(sources)} SOURCES`;
}

/**
 * Will the banner actually draw?
 *
 * Mirrors `countyStripVisible()` in `RadarStrip.tsx`, for the same reason:
 * `FEATURES.record` is off until "every displayed entry can carry its
 * citation", so a record with no citations behind it is not shown at all
 * rather than shown unsourced.
 */
export function operatorRecordVisible(record: OperatorRecord | null): record is OperatorRecord {
  return FEATURES.record && record !== null && record.sources >= 1;
}

// ---------------------------------------------------------------------------
// The whole model
// ---------------------------------------------------------------------------

export interface IntelInput {
  readonly cameraId: string;
  /** The cached tile record, when one is cached. */
  readonly record: CameraRecord | null;
  /**
   * A street name read off the BASEMAP, for records that carry none.
   *
   * 77.6% of records have a baked-in street, snapped at build time from TIGER
   * road data by a pipeline that no longer exists -- OSM replaced it everywhere
   * else, and two road datasets meant two answers to "what road is this camera
   * on" in an app whose whole value is answering that. Cameras discovered from
   * here on therefore arrive with no street at all.
   *
   * The caller supplies this from `features/map/streetAt.ts`, which asks the
   * map the driver is already looking at. Passed IN rather than looked up here
   * so this module stays free of MapLibre and remains testable without a GPU.
   */
  readonly streetFallback?: string | null | undefined;
  /**
   * The county this camera is in, ALREADY RESOLVED, with its camera count.
   *
   * Passed in rather than looked up, for the same reason as `streetFallback`:
   * this module does no I/O and holds no store. `services/cameras/gazetteer.ts`
   * turns the record's `countyFips` into a label and a count, and the caller
   * hands over the answer.
   */
  readonly county?: { readonly label: string; readonly cameras: number } | null | undefined;
  /**
   * The town this camera is in, ALREADY RESOLVED. See `county` for why it is
   * passed rather than looked up.
   *
   * On 79.61% of records. The other 20% are on unincorporated land, and there
   * the line simply ends at the street -- "near Overland Park" and "in Overland
   * Park" are different claims and only one of them is in the data.
   */
  readonly place?: string | null | undefined;
  /** The engine's last word on this camera. Null when it is not in the sweep. */
  readonly assessment: CameraAssessment | null;
  /**
   * RADAR's screen-level state, resolved by the caller.
   *
   * It is the only thing that colours the card: `intel.css` reads it off
   * `data-fwm-intel-state` and sets `--fwm-intel-hue` from it. The model does
   * NOT carry a second, derived copy of the hue -- one state, one place it is
   * turned into a colour.
   */
  readonly state: RadarState;
  /**
   * This camera specifically is on the per-camera mute list.
   *
   * Deliberately NOT "this camera is silenced": `MUTE THIS ONE` toggles the
   * per-camera list and nothing else, so a driver who muted EVERYTHING must
   * not find that key already pressed, press it, and silently un-mute a camera
   * they never muted. A global mute reaches the card as {@link IntelInput.state}
   * and never as this flag.
   */
  readonly mutedCamera: boolean;
  /**
   * Milliseconds left on THIS camera's own mute. `0` when it is not muted here.
   *
   * `MUTE THIS ONE` writes a TIMED mute -- `DEFAULT_MUTE_DURATION_MS`, ten
   * minutes, which is the design's own rule ("long-press = mute 10 min") --
   * and the card has to say so, or it presents a lapsing timer as a latch.
   * The caller reads the mute's own expiry timestamp out of the settings slice
   * and subtracts its clock, so the number printed can never disagree with the
   * timer that is actually running.
   * GAP: docs/gaps-inbox/intel.md#mute-this-one-is-a-ten-minute-timer
   */
  readonly muteRemainingMs: number;
  /** Passes of this camera inside the window, from {@link intelReads}. */
  readonly reads: number;
  readonly windowDays: number;
  /** Supplied only when `FEATURES.record` is on and a citation exists. */
  readonly operatorRecord: OperatorRecord | null;
  /** False in this build. See `IntelPhoto.tsx`. */
  readonly photoAvailable: boolean;
}

/**
 * WHERE THE CAMERA STANDS, for the one thing on the card that draws it.
 *
 * =============================================================================
 * A COORDINATE IN THE MODEL, AFTER THE MODEL SPENT ITS LIFE WITHOUT ONE
 * =============================================================================
 * `IntelScreen` reads the record's position at render scope for NAVIGATE, and
 * its comment says why it did not widen the model to do it: "the card
 * deliberately draws no coordinate ... cheaper than widening the view model
 * with a position no pixel uses". That was true until the card grew a map. A
 * pixel uses it now, and the alternative -- passing coordinates round the view
 * beside the model -- would give the card two sources for one camera.
 *
 * =============================================================================
 * IT IS THE CAMERA'S POSITION AND NEVER THE DRIVER'S
 * =============================================================================
 * A camera is public infrastructure standing on a public road, and where it is
 * is the fact this whole screen exists to publish. The driver's position is not
 * in this model and is not in the share -- `shareText` drops the distance and
 * the read count for exactly that reason, and it does not print this either.
 * Nothing about this field reaches the network: the picture it feeds is drawn
 * from an archive that is already on the phone.
 */
export interface IntelSite {
  readonly lat: number;
  readonly lon: number;
  /**
   * Which way the lens looks, as spans to draw. Empty when the mapper wrote no
   * direction, which is the majority: the picture then marks the position and
   * claims nothing about the facing.
   */
  readonly facings: readonly FacingSpan[];
}

export interface IntelViewModel {
  readonly cameraId: string;
  readonly identity: IntelIdentity;
  readonly readout: IntelReadout;
  /** The camera's own position, or null when no record is cached for it. */
  readonly site: IntelSite | null;
  /** The card's one hue input. See {@link IntelInput.state}. */
  readonly state: RadarState;
  /**
   * THE OWNER CLASS, verbatim, or `undefined` when the record asserts none.
   *
   * Not the OWNER tile's words. That tile prints the operator's NAME whenever
   * the record carries one, so `MOTOROLA SOLUTIONS` and `POLICE / AGENCY` are
   * both values of it and neither is the class `features/map/layers.ts`
   * colours its dots by. The card is drawn from this instead, against that
   * same match expression, so a card opened from a dot is the colour of the
   * dot that was tapped.
   *
   * ABSENT IS NOT `unverified`. `unverified` is a class somebody asserted;
   * absence is the absence of an assertion, and it is the common case -- OSM's
   * ALPR nodes usually carry no owner at all. `features/map/ownerFilter.ts`
   * refuses the same conflation, and the card draws absence in a neutral hue
   * rather than one that means something specific about who is watching.
   */
  readonly ownerType: CameraOwnerType | undefined;
  /** Drives the `MUTE THIS ONE` key. See {@link IntelInput.mutedCamera}. */
  readonly mutedCamera: boolean;
  /**
   * `9:41` -- what is left of this camera's own mute, or null when it has none.
   *
   * The same `m:ss` glyph the design draws as `MUTED 8:12`, through the same
   * `formatMuteCountdown` RADAR's status strip uses.
   */
  readonly muteCountdown: string | null;
  readonly tiles: readonly IntelTile[];
  readonly facts: readonly IntelFact[];
  readonly operatorRecord: OperatorRecord | null;
  readonly photoAvailable: boolean;
}

/**
 * Everything the card renders, from what the stores actually hold.
 *
 * The hardware name is still hard-coded `null`: there is no field for it, and
 * a parameter would invite a caller to supply one from somewhere that is not a
 * camera record.
 *
 * THE PLACE IS NO LONGER NULL. It was, on the same reasoning -- and the
 * reasoning expired the moment the records gained a street. The card used to
 * identify a camera by an OSM id and nothing else, which is not an answer to
 * "which one is this?" for anybody who is not reading the database.
 */
export function intelModel(input: IntelInput): IntelViewModel {
  return {
    cameraId: input.cameraId,
    // The baked name wins when there is one -- it carries a cross street, which
    // a nearest-road lookup cannot supply. See `streetFallback`.
    /*
     * THE HARDWARE NAME, which used to be hardcoded `null`.
     *
     * The card was built to print a name like FALCON in the title and fell back
     * to the raw id -- `osm:13472226901` as the headline, under a note saying
     * there was no hardware name on the record. There was: OSM carries
     * `manufacturer` on 91.66% of these nodes, measured across the whole
     * archive. The record simply had not been carrying it.
     *
     * `brand` is the documented alternative for the same fact and is on a
     * further 4%, so it is tried second. `model` is deliberately NOT used: it
     * is the part number, not the thing on the pole.
     */
    identity: intelIdentity(
      input.cameraId,
      tagValue(input.record, 'manufacturer') ?? tagValue(input.record, 'brand'),
      // "NALL AVE @ W 124TH TER · OVERLAND PARK". The street answers "which
      // road", the town answers "which of the forty roads by that name", and
      // either half stands alone when the other is missing.
      [streetLine(input.record) ?? input.streetFallback ?? null, input.place ?? null]
        .filter((part): part is string => typeof part === 'string' && part !== '')
        .join(' · ') || null,
      tagValue(input.record, 'operator'),
    ),
    readout: intelReadout(input.assessment),
    // NO RECORD, NO PICTURE. A camera the tile cache has never held has no
    // coordinate anywhere in this app, and a map centred on a guess is worse
    // than no map: see `IntelSite`.
    site:
      input.record === null
        ? null
        : {
            lat: input.record.lat,
            lon: input.record.lon,
            // Every direction the mapper wrote, from the same parse the FACING
            // tile counts its "+2" with. Two readings of one tag is how a
            // picture ends up contradicting the tile above it.
            facings: facingSpans(coveredDirections(input.record), input.record.directionDeg),
          },
    state: input.state,
    // Straight off the record, never inferred from the operator string: an
    // agency called "... POLICE DEPARTMENT" that nobody classified is still
    // an unclassified record, and guessing here would colour the card on the
    // strength of a substring.
    ownerType: input.record?.ownerType,
    mutedCamera: input.mutedCamera,
    muteCountdown:
      input.mutedCamera && input.muteRemainingMs > 0
        ? formatMuteCountdown(input.muteRemainingMs)
        : null,
    tiles: intelTiles(input.record),
    facts: intelFacts({
      record: input.record,
      reads: input.reads,
      windowDays: input.windowDays,
      county: input.county,
      /*
       * WHAT IS SERVED, OR UNKNOWN.
       *
       * R2 moves hourly without an app build and the bundle contains no camera
       * archive. A build-time timestamp is therefore not a fallback: offline,
       * the device may hold any mix of previously cached tiles. If index.json
       * is unavailable, a dash is the only honest archive-level answer.
       */
      upstreamIso: catalogue.upstream(),
    }),
    operatorRecord: operatorRecordVisible(input.operatorRecord) ? input.operatorRecord : null,
    photoAvailable: input.photoAvailable,
  };
}

// ---------------------------------------------------------------------------
// SHARE
// ---------------------------------------------------------------------------

/**
 * The first line of a share -- every identifier the card holds, each once.
 *
 * NOT `title · cameraId`. {@link intelIdentity} promotes the id INTO the title
 * when there is no hardware name, which is every record in this build, so that
 * shape printed `FWM-0442 · FWM-0442` on every share the product could
 * produce. The identity already knows where the id went; this reads it off
 * there instead of assuming.
 *
 *   FALCON / FWM-0442 · READING & TENNESSEE  ->  FALCON · FWM-0442 · READING …
 *   FWM-0442 / READING & TENNESSEE           ->  FWM-0442 · READING & TENNESSEE
 *   FWM-0442 / <the authored note>           ->  FWM-0442
 *
 * The note never travels: it explains an absence to the driver looking at the
 * card, and it is not a fact about the camera.
 */
export function shareHeadline(identity: IntelIdentity): string {
  return identity.sublineIsNote ? identity.title : `${identity.title} · ${identity.subline}`;
}

/**
 * The body of a `camera-intel` share.
 *
 * PRIVACY. A camera is public infrastructure and its id, owner and facing are
 * facts about it. The driver is not: `YOUR READS` is this device's own
 * movement history and it is deliberately NOT in the share, and neither is the
 * distance, which is a statement about where the phone is standing right now.
 * There is no coordinate here and there is no plate anywhere on this screen to
 * leak.
 *
 * Unknown rows are dropped rather than shared as em dashes -- a share is read
 * by somebody who never saw the card.
 */
export function shareText(model: IntelViewModel): string {
  const lines: string[] = [shareHeadline(model.identity)];
  for (const item of model.tiles) {
    if (!item.known) continue;
    lines.push(`${item.label}: ${item.value}`);
  }
  for (const item of model.facts) {
    if (!item.known) continue;
    if (item.label === 'YOUR READS') continue;
    lines.push(`${item.label}: ${item.value}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Action feedback
// ---------------------------------------------------------------------------

/**
 * What one action outcome says, in one micro line under the buttons.
 *
 * The panel draws four buttons and no feedback of any kind, and three of the
 * four do something the driver cannot otherwise see: a confirmation goes into
 * a queue, a share sheet may not exist on this platform, a copy may be refused
 * by a browser outside a secure context. A button that silently does nothing
 * is how a driver presses `CONFIRM STILL THERE` four times.
 *
 * Fixed sentences, chosen by outcome -- never an interpolated error message,
 * which is written for a developer and could quote a payload field. Same rule
 * as `describeQueueFailure()` in `features/report/reportQueue.ts`.
 *
 * MUTING IS NOT IN HERE. A mute is not a one-shot event with a sentence about
 * it, it is a ten-minute timer that keeps running after the line would have
 * faded, so it gets a standing line instead -- {@link muteClockLabel} plus
 * {@link MUTE_STILL_COUNTED}, drawn for as long as the mute lasts. Un-muting
 * IS one-shot and keeps its sentence.
 * GAP: docs/gaps-inbox/intel.md#mute-this-one-is-a-ten-minute-timer
 * GAP: docs/gaps-inbox/intel.md#no-action-feedback-is-drawn
 */
export type IntelActionOutcome =
  | 'confirm-queued'
  | 'dispute-queued'
  | 'queue-failed'
  | 'unmuted'
  | 'id-copied'
  | 'copy-failed'
  | 'shared'
  | 'share-unavailable'
  | 'share-failed';

const OUTCOME_MESSAGE: Readonly<Record<IntelActionOutcome, string>> = Object.freeze({
  'confirm-queued': 'CONFIRMATION QUEUED · SENDS ON WIFI',
  'dispute-queued': 'DISPUTE QUEUED · SENDS ON WIFI',
  'queue-failed': 'NOT QUEUED · NO LOCAL STORAGE ON THIS DEVICE',
  unmuted: 'UNMUTED · ALERTS ON AGAIN',
  'id-copied': 'CAMERA ID COPIED',
  'copy-failed': 'COPY REFUSED BY THIS BROWSER',
  shared: 'SHARED',
  'share-unavailable': 'SHARING IS NOT AVAILABLE ON THIS DEVICE',
  'share-failed': 'THE SHARE SHEET FAILED',
});

export function actionMessage(outcome: IntelActionOutcome): string {
  return OUTCOME_MESSAGE[outcome];
}

// ---------------------------------------------------------------------------
// The mute state line
// ---------------------------------------------------------------------------

/**
 * The half of the mute line that is not a clock.
 *
 *   "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 *    count in EXPOSURE."  -- Screens II, B4
 */
export const MUTE_STILL_COUNTED = 'STILL DRAWN, STILL COUNTED';

/**
 * `MUTED 9:41` -- the design's own mute glyph, with the real time left.
 *
 * `Flockys App Screens.dc.html` draws `MUTED 8:12` on the status strip and
 * `Flockys Watch.dc.html` draws it again on W11. A4 draws neither, because A4
 * draws the mute key in its off state only -- but `MUTE THIS ONE` writes a ten
 * minute timer, and a key that latches on screen while a timer runs underneath
 * it is the card telling the driver something that is not true.
 * GAP: docs/gaps-inbox/intel.md#mute-this-one-is-a-ten-minute-timer
 */
export function muteClockLabel(countdown: string): string {
  return `MUTED ${countdown}`;
}

/** Which outcomes are a refusal rather than a success. Drives the tone only. */
export function isActionFailure(outcome: IntelActionOutcome): boolean {
  return outcome === 'queue-failed' || outcome === 'copy-failed' || outcome === 'share-failed';
}
