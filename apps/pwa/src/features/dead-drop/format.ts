/**
 * DEAD DROP's presentation formatting. Strings only.
 *
 * SOURCE: `Flockys Screens II.dc.html`, panel `B2 · DEAD DROP - QUEUE +
 * EVIDENCE CHAIN`. Every string this module produces is one the panel literally
 * renders, or - where the panel renders something the signed record cannot
 * supply - an em dash. Nothing here rounds a fact into existence.
 *
 * =============================================================================
 * ONE CLOCK, AND IT IS UTC
 * =============================================================================
 * The panel's own detail card is explicit: `14:22:08.412 UTC`. So every time on
 * this screen is UTC, read off the signed `capturedAt` string, which
 * `chain.ts` guarantees is `YYYY-MM-DDTHH:MM:SS.mmmZ` - fixed width, so the
 * clock time is a slice and not a parse. Rendering the row times in the
 * device's local zone would put two clocks on one panel, and signed evidence
 * has exactly one.
 * GAP: see docs/gaps-inbox/dead-drop.md#every-timestamp-is-utc
 *
 * =============================================================================
 * NOTHING HERE READS A PLATE, AND NOTHING HERE COULD
 * =============================================================================
 * The report payload has no plate field (`features/report/reportDraft.ts`), the
 * plate vault is a different store behind a different key, and every reader
 * below is a named field lookup rather than a walk over the payload. There is
 * no path from this module to a plate, an analytics call, a URL or a log.
 */

import { isPlainObject } from '../../services/crypto/canonicalize.ts';
import type { CanonicalObject, CanonicalValue } from '../../services/crypto/canonicalize.ts';
import { NO_VALUE } from '../radar/format.ts';

export { NO_VALUE };

/** Milliseconds in a minute, an hour and a UTC day. Not design values. */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `DROP 03`, `DROP 02`, `DROP 00` - the drop's position in the chain, counted
 * from the first report this install ever filed and zero-padded to two digits
 * exactly as the panel draws it. It is a position, not an id: `reportId` is a
 * UUID and the panel never shows one.
 */
export function dropNumber(sequence: number): string {
  const index = Math.max(0, Math.trunc(sequence));
  return `DROP ${String(index).padStart(2, '0')}`;
}

/**
 * `14:22:08.412 UTC` - the CAPTURED row.
 *
 * A slice, not a parse: `CAPTURED_AT_RE` in `chain.ts` fixes the format at 24
 * characters, and the milliseconds are part of what was signed, so they are
 * shown rather than rounded away.
 */
export function capturedClock(capturedAt: string): string {
  if (capturedAt.length < 24) return NO_VALUE;
  return `${capturedAt.slice(11, 23)} UTC`;
}

/**
 * The row time: `13:58` today, `yesterday` the UTC day before, and the ISO date
 * for anything older.
 *
 * The panel draws only the first two. A queue can be held "offline for weeks"
 * by its own description, so the third has to say something, and a date is the
 * only thing it can say without a second clock.
 * GAP: see docs/gaps-inbox/dead-drop.md#every-timestamp-is-utc
 */
export function capturedShort(capturedAt: string, nowMs: number): string {
  const at = Date.parse(capturedAt);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return NO_VALUE;
  const dayGap = Math.floor(nowMs / DAY) - Math.floor(at / DAY);
  if (dayGap <= 0) return capturedAt.slice(11, 16);
  if (dayGap === 1) return 'yesterday';
  return capturedAt.slice(0, 10);
}

/**
 * `41 MIN` - how long this drop has been on the device, beside its state.
 *
 * Truncated, never rounded up: a drop held 59 minutes has not been held an
 * hour. A clock that has gone backwards since the drop was signed clamps to
 * `0 MIN` rather than rendering a negative age.
 */
export function heldFor(capturedAt: string, nowMs: number): string {
  const at = Date.parse(capturedAt);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return NO_VALUE;
  const elapsed = Math.max(0, nowMs - at);
  if (elapsed < HOUR) return `${String(Math.floor(elapsed / MINUTE))} MIN`;
  if (elapsed < DAY) return `${String(Math.floor(elapsed / HOUR))} HR`;
  const days = Math.floor(elapsed / DAY);
  return `${String(days)} ${days === 1 ? 'DAY' : 'DAYS'}`;
}

// ---------------------------------------------------------------------------
// Payload readers
//
// The payload is signed canonical JSON, which means it is `CanonicalObject` and
// nothing stronger: a record filed by an older build, or one restored from an
// export, can be missing a field this build expects. Every reader below returns
// null rather than throwing, and every caller renders an em dash for null.
// ---------------------------------------------------------------------------

function readNumber(value: CanonicalValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(value: CanonicalValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * `39.0997 N 84.5786 W ±4M` - the POSITION row.
 *
 * Four decimals is ~11 m, which is the precision the panel draws and roughly
 * the precision a phone GPS actually has. The accuracy figure is appended only
 * when the record carries one; `± - M` would be worse than nothing.
 *
 * This is the most sensitive value in the product and it is rendered here
 * because the driver deliberately filed it and is entitled to see what they
 * signed. It is not logged, not shared, not put in the URL, and not
 * reverse-geocoded - see the gap note on the missing street names.
 */
export function dropPosition(payload: CanonicalObject | null): string {
  if (payload === null) return NO_VALUE;
  // BOTH SCHEMAS. `fwm-report/v2` renamed this to `observer_position` once it
  // became clear the field was the phone rather than the camera; v1 records are
  // still on the device and still verify, so they are still read.
  const v2: CanonicalValue | undefined = payload['observer_position'];
  const position: CanonicalValue | undefined = v2 ?? payload['position'];
  if (!isPlainObject(position)) return NO_VALUE;
  const lat = readNumber(position['lat']);
  const lon = readNumber(position['lon']);
  if (lat === null || lon === null) return NO_VALUE;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const fix = `${Math.abs(lat).toFixed(4)} ${ns} ${Math.abs(lon).toFixed(4)} ${ew}`;
  const accuracy = readNumber(payload['gps_accuracy_m']);
  return accuracy === null ? fix : `${fix} ±${String(Math.round(accuracy))}M`;
}

/**
 * `223°` - the HEADING row.
 *
 * The panel draws `223° · 47 MPH`. The degrees are `facing_deg`, which REPORT
 * seeds from the vehicle's compass. The speed is in no signed field, so it is
 * not rendered: a number beside a signature has to be a number the signature
 * covers.
 * GAP: see docs/gaps-inbox/dead-drop.md#heading-row-has-no-speed
 */
export function dropHeading(payload: CanonicalObject | null): string {
  if (payload === null) return NO_VALUE;
  const facing = readNumber(payload['facing_deg']);
  if (facing === null) return NO_VALUE;
  return `${String(Math.round(facing))}°`;
}

/**
 * The PHOTO row. The panel draws `1 · 2.1 MB`; this renders `1` or `NONE`.
 *
 * THE OLD COMMENT HERE WAS WRONG AS OF THE PHOTO PATH. It said "this build
 * attaches no photos at all", quoting `reportDraft.ts`, and that stopped being
 * true the moment the report sheet started signing a digest into `photo`. The
 * count below has always been correct - {@link hasPhoto} reads the payload -
 * so nothing changed except a sentence that had become false.
 *
 * The SIZE half is still missing, and that is deliberate rather than pending:
 * the size lives on the `reportPhotos` row, and that store has no `all()` by
 * design - nothing may enumerate a driver's photographs - so a list screen
 * cannot total them without reading each report's bytes back off disk.
 * GAP: see docs/gaps-inbox/dead-drop.md#photo-row-has-nothing-to-count
 */
export function dropPhoto(payload: CanonicalObject | null): string {
  return hasPhoto(payload) ? '1' : 'NONE';
}

/** The list meta's middle term: `photo` / `no photo`, both drawn by the panel. */
export function photoWord(payload: CanonicalObject | null): string {
  return hasPhoto(payload) ? 'photo' : 'no photo';
}

export function hasPhoto(payload: CanonicalObject | null): boolean {
  if (payload === null) return false;
  const photo: CanonicalValue | undefined = payload['photo'];
  return photo !== null && photo !== undefined;
}

/**
 * The camera a confirmation is about - `FWM-0442`, a public infrastructure id.
 *
 * This is what the row title carries where the panel draws a street name. There
 * is no street name on this device and producing one would mean sending the
 * driver's exact position to a geocoder.
 * GAP: see docs/gaps-inbox/dead-drop.md#place-names-cannot-be-produced-without-a-geocoder
 */
export function dropCameraId(payload: CanonicalObject | null): string | null {
  if (payload === null) return null;
  return readString(payload['camera_id']);
}
