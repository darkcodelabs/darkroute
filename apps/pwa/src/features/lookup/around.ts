/**
 * AROUND YOU -- the one card LOOK UP draws above its rows, and what is on it.
 *
 * =============================================================================
 * WHY THE SCREEN GAINED A CARD
 * =============================================================================
 * "Let's change the lookup screen to something much much better since we now
 * have all this new data to use" -- owner, 2026-09-09. The new data is the
 * release context: a street, a cross street, a distance to the road and a town
 * on every record, a Census place and a county on most, and the EFF Atlas of
 * Surveillance already on the phone keyed by that county. The rows carry the
 * per-camera half of it. What no row could carry is the reading a driver takes
 * BEFORE the rows: where am I, how thick is it here, whose hardware is it, and
 * who around here is on record as running it. That is this card, computed from
 * the same ranked hits the rows are drawn from, so it can never describe a
 * different set of cameras than the list under it.
 *
 * =============================================================================
 * THE ATLAS LINE, AND WHAT IT IS NOT
 * =============================================================================
 * 83.4% of the archive's cameras carry no `operator` tag, and the app says
 * OPERATOR NOT RECORDED for them rather than guessing. The Atlas is the closest
 * honest neighbour to that gap: it records which agencies in a county are
 * documented -- procurement, council minutes, FOIA -- as operating ALPR. It is
 * NOT a claim that any camera on this screen is theirs, and the sentence is
 * written so it cannot be read that way: it names the county, not the camera.
 * `services/records/atlasCounties.ts` explains why an Atlas row is not an
 * allegation either; the wording here keeps to that.
 *
 * Its three absences render three ways, as that service requires. `unknown`
 * (nothing loaded, or no county on the record) prints nothing at all; `none`
 * prints a sentence that says the Atlas is not a census; `recorded` prints the
 * count and the first three names.
 *
 * Pure functions over plain inputs, so the card is testable without a store,
 * a fix or a fetch -- which also keeps `LookupV1Screen.source.test.ts`'s
 * "searches offline" rule honest: nothing here reaches the network.
 */

import type { AtlasCounty, AtlasCoverage } from '../../services/records/atlasCounties.ts';

import { formatDistance } from './search.ts';
import type { SearchHit } from './search.ts';
import { shortMaker } from './streetGroups.ts';

/** The radius the drive dock counts in, so the two figures agree. */
export const TWO_MILES_M = 3_218.69;

/** How many agencies are named before the line says `+N`. */
export const ATLAS_NAMES_SHOWN = 3;

export const ATLAS_NONE =
  'the EFF Atlas lists no agency running ALPR in this county. it is compiled from public records, not a census.';

/** What the caller knows about the Atlas for one county. */
export interface AtlasAnswer {
  readonly coverage: AtlasCoverage;
  readonly county: AtlasCounty | null;
}

export interface AroundInput {
  /** The ranked hits the rows are drawn from. Nearest first when there is a fix. */
  readonly hits: readonly SearchHit[];
  readonly hasFix: boolean;
  /** "JOHNSON CO, KS" for a FIPS, or null when the gazetteer cannot say yet. */
  readonly countyLabel: (fips: string | undefined) => string | null;
  /** The Atlas's answer for a FIPS, or null when nothing should be asked. */
  readonly atlas: ((fips: string | undefined) => AtlasAnswer) | null;
}

export interface MakerShare {
  readonly name: string;
  readonly count: number;
}

export interface AroundSummary {
  /** The town the nearest camera stands in, from the release context. */
  readonly place: string | null;
  /** The county, as the gazetteer labels it. */
  readonly county: string | null;
  /** "1.5 mi NE" to the nearest hit; null without a fix. */
  readonly nearest: string | null;
  /** How many of the hits are inside the dock's two-mile radius; null without a fix. */
  readonly withinTwoMiles: number | null;
  /** The makers on the hits, most common first, at most three. */
  readonly makers: readonly MakerShare[];
  /** The Atlas sentence, or null when there is nothing honest to say. */
  readonly atlasLine: string | null;
}

/**
 * The card's content, or null when there is nothing to draw it over.
 *
 * Everything is read off the FIRST hit for place and county: it is the nearest
 * camera when there is a fix, and the list's own anchor when there is not, and
 * a card that named a town from the twentieth row would be describing somewhere
 * the driver is not.
 */
export function aroundSummary(input: AroundInput): AroundSummary | null {
  const first = input.hits[0];
  if (first === undefined) return null;

  const place = nonEmpty(first.camera.locality);
  const county = input.countyLabel(first.camera.countyFips);

  let nearest: string | null = null;
  let withinTwoMiles: number | null = null;
  if (input.hasFix) {
    const far = formatDistance(first.metres);
    const bearing = first.bearing ?? null;
    nearest = far === null ? null : bearing === null ? far : `${far} ${bearing}`;
    withinTwoMiles = input.hits.filter((hit) => hit.metres !== null && hit.metres <= TWO_MILES_M).length;
  }

  const atlasLine = input.atlas === null ? null : atlasLineOf(input.atlas(first.camera.countyFips));

  return { place, county, nearest, withinTwoMiles, makers: makerShares(input.hits), atlasLine };
}

/** "Flock 30 · Genetec 8 · Axon 2" as data: most common first, ties by name. */
export function makerShares(hits: readonly SearchHit[]): readonly MakerShare[] {
  const tally = new Map<string, number>();
  for (const hit of hits) {
    const maker = hit.camera.tags?.['manufacturer'];
    if (typeof maker !== 'string' || maker === '') continue;
    const name = shortMaker(maker);
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, ATLAS_NAMES_SHOWN);
}

/** Said in the head's first slot when the nearest record names no town. */
export const NO_PLACE = 'nearest cameras';

/**
 * "Overland Park · nearest 1.5 mi NE · 12 within 2 mi" -- the head line, with
 * each clause present only when its fact is.
 */
export function headLineOf(summary: AroundSummary): string {
  const parts = [summary.place ?? NO_PLACE];
  if (summary.nearest !== null) parts.push(`nearest ${summary.nearest}`);
  if (summary.withinTwoMiles !== null) parts.push(`${String(summary.withinTwoMiles)} within 2 mi`);
  return parts.join(' · ');
}

/** The maker line as the card prints it, or null when no hit names a maker. */
export function makerLineOf(makers: readonly MakerShare[]): string | null {
  if (makers.length === 0) return null;
  return makers.map((share) => `${share.name} ${String(share.count)}`).join(' · ');
}

/**
 * The Atlas sentence for one county. See the header for the three absences.
 *
 * Counts AGENCIES, never rows: an Atlas row is one recorded deployment and the
 * service forbids rendering it as a camera count, so the figure here is the
 * length of the de-duplicated agency list and the sentence says "agencies".
 */
export function atlasLineOf(answer: AtlasAnswer): string | null {
  if (answer.coverage === 'unknown') return null;
  if (answer.coverage === 'none' || answer.county === null) return ATLAS_NONE;
  const agencies = answer.county.agencies;
  if (agencies.length === 0) return ATLAS_NONE;
  const shown = agencies.slice(0, ATLAS_NAMES_SHOWN).map(shortAgency);
  const more = agencies.length - shown.length;
  const noun = agencies.length === 1 ? 'agency' : 'agencies';
  const tail = more > 0 ? ` +${String(more)}` : '';
  return `EFF Atlas: ${String(agencies.length)} ${noun} on record running ALPR in this county: ${shown.join(', ')}${tail}`;
}

/**
 * "Overland Park Police Department" -> "Overland Park PD". The abbreviations
 * an officer would write, applied so three names fit one line; the full name is
 * on the MISUSE screen's Atlas block.
 */
export function shortAgency(name: string): string {
  return name
    .replace(/\bPolice Department\b/gi, 'PD')
    .replace(/\bSheriff[\u2019']?s? (?:Office|Department)\b/gi, 'Sheriff')
    .replace(/\bDepartment of Public Safety\b/gi, 'DPS')
    .replace(/\bDepartment\b/gi, 'Dept')
    .trim();
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}
