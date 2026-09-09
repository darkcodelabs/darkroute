/**
 * CAMERA SEARCH, over the copy of the archive on this phone.
 *
 * =============================================================================
 * WHY THIS IS PURE AND SEPARATE FROM THE SCREEN
 * =============================================================================
 * It is the one part of v1's LOOKUP with an answer that can be wrong. A screen
 * is checked by rendering it; a ranking is checked by feeding it records and
 * asserting the order, which needs it to be a function.
 *
 * =============================================================================
 * IT NEVER ASKS ANYTHING
 * =============================================================================
 * No fetch, no geocoder, no index service. The archive is already on the
 * device - that is the product - so a search over it is a scan of an array,
 * and a scan of an array is the only implementation that still works with no
 * signal. 132k records is small enough that this is not worth an index; it is
 * measured in single-digit milliseconds and it runs on a keystroke.
 */

import { landmarkFor } from '../../services/records/landmarks.ts';
import { metresBetween } from '../../services/cameras/sync.ts';
import { shortOperator } from '../intel/intelState.ts';
import type { CameraOwnerType, CameraRecord } from '../../services/db/schema.ts';

/** Metres in a foot, for reporting a distance the way the rest of the app does. */
const FT_PER_M = 3.280_839_895;

/** Metres in a mile. Distances over this read in miles, under it in feet. */
const M_PER_MILE = 1609.344;

/** How many results are worth showing. Beyond this a list is a scroll, not an answer. */
export const MAX_RESULTS = 40;

export interface SearchHit {
  readonly camera: CameraRecord;
  /** Metres from the fix, or null when there is no fix to measure from. */
  readonly metres: number | null;
  /** Compass point from the fix to the camera; null with no fix, absent on an older hit. */
  readonly bearing?: string | null;
}

export interface SearchInput {
  readonly cameras: readonly CameraRecord[];
  /** What was typed. Empty means "everything, nearest first". */
  readonly query: string;
  /** Null when the owner filter is off. */
  readonly ownerType: CameraOwnerType | null;
  /** Where to measure from. Null before the first fix. */
  readonly at: { readonly lat: number; readonly lon: number } | null;
}

/**
 * True when a record matches the typed words.
 *
 * EVERY word must appear somewhere, in any field, in any order - so "peachtree
 * 10th" finds the camera on Peachtree at 10th without the driver having to
 * guess which of the two the archive calls the street and which the cross.
 * A single-field prefix match would fail on exactly that case, which is the
 * case the design uses as its example.
 */
export function matches(camera: CameraRecord, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  /*
   * THE LANDMARK IS IN THE HAYSTACK, which is what makes "home depot" a query
   * this app can answer at all. Streets and ids cannot: nobody remembers that
   * the reader they mean is on Metcalf, they remember it is by the hardware
   * store.
   *
   * Unlike the chip on DRIVE, the search is NOT filtered to landmarks that
   * distinguish. Somebody typing a chain name wants every camera around it -
   * "show me the ones near Home Depot" is a question about a place, and
   * hiding six of the seven because they share it would answer a different
   * one.
   *
   * Absent for most cameras, and absent entirely until the index loads, which
   * costs a query nothing: it simply matches on the fields it always had.
   */
  const landmark = landmarkFor(camera.id)?.name;
  /*
   * THE OPERATOR IS IN THE HAYSTACK BECAUSE IT IS WHAT THE ROW IS CALLED.
   *
   * `titleOf` leads every result with the operator where there is one, so a
   * list of readers reads "Overland Park Police", "JCPRD", "KDOT" - and typing
   * any of those found nothing, because the search looked only at streets, the
   * id and the landmark. A list that shows a name it cannot then be searched
   * by is a list that appears broken to the one person using it correctly.
   *
   * The RAW tag, not `shortOperator`: the short form is what gets drawn, and
   * matching only that would refuse the full name somebody read off a sign.
   * Both forms are substrings of the raw value in every case, so including it
   * matches either.
   */
  const operator = camera.tags?.['operator'];
  const hay = [
    camera.street,
    camera.cross,
    camera.id,
    landmark,
    typeof operator === 'string' ? operator : undefined,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((word) => hay.includes(word));
}

export function searchCameras({ cameras, query, ownerType, at }: SearchInput): readonly SearchHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const hits: SearchHit[] = [];
  for (const camera of cameras) {
    if (ownerType !== null && camera.ownerType !== ownerType) continue;
    if (!matches(camera, words)) continue;
    hits.push({
      camera,
      metres: at === null ? null : metresBetween(at, camera),
      bearing: at === null ? null : compassPointFrom(at, camera),
    });
  }

  // NEAREST FIRST when there is a fix. With no fix there is no meaningful
  // order, and the id is at least STABLE - a list that reshuffles between
  // renders is a list a driver cannot tap.
  hits.sort((a, b) => {
    if (a.metres === null || b.metres === null) return a.camera.id.localeCompare(b.camera.id);
    return a.metres - b.metres;
  });

  return hits.slice(0, MAX_RESULTS);
}

/** "0.4 mi", "320 ft", or null when there is nothing to measure from. */
export function formatDistance(metres: number | null): string | null {
  if (metres === null) return null;
  if (metres >= M_PER_MILE) return `${(metres / M_PER_MILE).toFixed(1)} mi`;
  return `${String(Math.round(metres * FT_PER_M))} ft`;
}

/** "Peachtree St NE at 10th", or the id when the archive has no street for it. */
export function placeOf(camera: CameraRecord): string {
  if (camera.street === undefined) return camera.id;
  if (camera.cross === undefined) return camera.street;
  return `${camera.street} at ${camera.cross}`;
}

/**
 * WHAT A RESULT ROW IS CALLED.
 *
 * The list led with `placeOf`, which is a STREET - and where no street was
 * recorded, with the raw `osm:13639701701`. Both are the wrong answer to the
 * question a result list is answering. A street name is not distinguishing when
 * three rows in a row say ACCESS RD, and a database key answers nothing at all.
 *
 * The OPERATOR is the name: `JCPRD` says whose camera this is, which is the
 * thing a person is scanning the list for. It is on roughly 17.7% of records,
 * so the fallbacks matter as much as the preference - street, then cross
 * street, then the id, which is still better than nothing and is what a person
 * quotes when reporting a bad record.
 *
 * `shortOperator` rather than the raw tag, so a row and the card it opens
 * cannot render the same operator two different ways.
 */
export function titleOf(camera: CameraRecord): string {
  const operator = camera.tags?.['operator'];
  const named = shortOperator(typeof operator === 'string' ? operator : null);
  return named ?? placeOf(camera);
}

/**
 * The line under the title.
 *
 * When the title is an operator the street is the useful second line - it is
 * how a person tells two of that agency's cameras apart. When the title is
 * ALREADY the street, repeating it would waste the row, so the owner class
 * goes there instead, which is what the list showed before.
 */
export function subtitleOf(camera: CameraRecord, ownerLabel: string): string {
  const operator = camera.tags?.['operator'];
  const named = shortOperator(typeof operator === 'string' ? operator : null);
  if (named === null) return ownerLabel;
  const place = placeOf(camera);
  return place === camera.id ? ownerLabel : place;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** "NE": which way the camera lies from here, to the nearest eighth. */
export function compassPointFrom(
  from: { readonly lat: number; readonly lon: number },
  to: { readonly lat: number; readonly lon: number },
): string {
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const la = (from.lat * Math.PI) / 180;
  const lb = (to.lat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLon);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return POINTS[Math.round(deg / 45) % POINTS.length] ?? 'N';
}
