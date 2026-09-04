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

import { metresBetween } from '../../services/cameras/sync.ts';
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
  const hay = [camera.street, camera.cross, camera.id].filter(Boolean).join(' ').toLowerCase();
  return words.every((word) => hay.includes(word));
}

export function searchCameras({ cameras, query, ownerType, at }: SearchInput): readonly SearchHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const hits: SearchHit[] = [];
  for (const camera of cameras) {
    if (ownerType !== null && camera.ownerType !== ownerType) continue;
    if (!matches(camera, words)) continue;
    hits.push({ camera, metres: at === null ? null : metresBetween(at, camera) });
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
