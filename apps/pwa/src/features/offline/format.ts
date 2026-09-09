/**
 * OFFLINE's presentation formatting. Pure string work, nothing else.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A2 · OFFLINE - DEGRADED` (lines
 * 80-126). Three of the four strings below are literal reads from it:
 *
 *   "4,182"   the CACHED CAMS counter -- grouped in threes with a comma
 *   "318"     the MAP TILES counter
 *   "DB last updated 2 days ago. Cameras added since then are invisible -
 *    treat clear as probably clear."
 *
 * The fourth -- the age phrase for anything that is not "2 days" -- the design
 * never draws, because the design draws one moment in time.
 * GAP: see docs/gaps-inbox/offline.md#db-age-phrase-only-drawn-for-days
 *
 * =============================================================================
 * NOTHING HERE INVENTS A NUMBER
 * =============================================================================
 * Every function takes `null` and returns {@link NO_VALUE} for it. A cache that
 * has not been read yet is not a cache with zero cameras in it, and an offline
 * screen that renders a confident `0` for a count it never obtained is exactly
 * the "convincing fake" this screen exists to avoid. `0` is only ever printed
 * when the repository genuinely returned zero.
 */

import type { CacheIncoherence } from '../../services/db';

import { NO_VALUE } from '../radar/format.ts';

export { NO_VALUE };

/** Digits per group in the counters. The design renders `4,182`. */
const GROUP = 3;

/**
 * A cache counter: `4,182`, `318`, `0`, or ` - ` when it is not known yet.
 *
 * Grouped with a literal comma rather than through `toLocaleString`, because
 * the design renders a comma and a device set to `de-DE` would render `4.182`
 * -- a number this screen would then be printing differently from the design
 * for reasons that have nothing to do with the cache.
 * GAP: see docs/gaps-inbox/offline.md#counter-grouping-is-not-localised
 */
export function formatCacheCount(count: number | null): string {
  if (count === null || !Number.isFinite(count)) return NO_VALUE;
  const whole = Math.max(0, Math.trunc(count));
  const digits = String(whole);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % GROUP === 0) out += ',';
    out += digits[i];
  }
  return out;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function plural(value: number, unit: string): string {
  return `${String(value)} ${unit}${value === 1 ? '' : 's'}`;
}

/**
 * "2 days" -- the age phrase the warning sentence is built around.
 *
 * Returns null when there is no age, which is a different sentence entirely
 * (see {@link dbAgeWarning}). A negative age means the device clock moved
 * backwards between the tile check and now; that is floored at zero rather
 * than printed, because "updated -3 hours ago" is not a fact about the cache.
 */
export function formatDbAge(ageMs: number | null): string | null {
  if (ageMs === null || !Number.isFinite(ageMs)) return null;
  const age = Math.max(0, ageMs);
  if (age < MINUTE_MS) return 'less than a minute';
  if (age < HOUR_MS) return plural(Math.floor(age / MINUTE_MS), 'minute');
  if (age < DAY_MS) return plural(Math.floor(age / HOUR_MS), 'hour');
  return plural(Math.floor(age / DAY_MS), 'day');
}

/** The second half of the warning, verbatim from A2. */
const INVISIBLE_CLAUSE =
  'Cameras added since then are invisible - treat clear as probably clear.';

/**
 * Nothing has ever been checked against the source, AND nothing is cached.
 *
 * The design does not draw it: A2 draws a cache that was filled two days ago.
 * The sentence is written to make the same admission the drawn one makes --
 * that "clear" is not a claim this screen can stand behind -- without
 * borrowing its "since then", which would refer to a moment that never
 * happened.
 *
 * It is used ONLY when the counters beside it read zero. Saying "nothing is
 * cached" above `CACHED CAMS 4,182` would be this screen contradicting itself
 * in the one place it exists to be exact.
 * GAP: see docs/gaps-inbox/offline.md#no-cache-and-no-check-are-undrawn
 */
const NEVER_CHECKED =
  'DB has never been checked against the source on this device. Nothing is ' +
  'cached - treat clear as unknown.';

/**
 * Tiles ARE cached and none of them was ever checked against the source.
 *
 * This is the ordinary state of a cache filled through `cameraTiles.put()`:
 * that method writes the tile body and nothing else, and a `tileMeta` row --
 * the only thing that carries a check time -- exists solely when someone
 * separately calls `markChecked`. So a real device can hold thousands of
 * cameras with no check time at all, and the sentence for it has to admit the
 * freshness is unknown WITHOUT claiming the cache is empty.
 *
 * `fetchedAt` is the honest fallback: it is when the tile was written here,
 * which bounds how old the copy is even though it says nothing about whether
 * the source has changed since.
 * GAP: see docs/gaps-inbox/offline.md#cached-but-never-checked-is-undrawn
 */
function uncheckedText(cachedAgeMs: number | null): string {
  const age = formatDbAge(cachedAgeMs);
  const stored =
    age === null
      ? 'What is cached has never been verified'
      : `What is cached was stored ${age} ago and never verified`;
  return (
    'DB has never been checked against the source on this device. ' +
    `${stored} - treat clear as unknown.`
  );
}

/**
 * Local storage is not there at all: a private-mode webview, or a browser with
 * IndexedDB switched off. Undrawn for the same reason.
 * GAP: see docs/gaps-inbox/offline.md#no-cache-and-no-check-are-undrawn
 */
const NO_STORAGE =
  'Local storage is unavailable, so no cameras are cached and nothing can be ' +
  'queued - treat clear as unknown.';

/**
 * The cache is there and cannot be used as it stands.
 *
 * TWO SENTENCES, because the two states are different promises about the next
 * drive. Expired rows are gone the moment anything reads them; a mixed cache is
 * refused whole and refills from the network. Neither may be presented as
 * cached cameras, and neither may be silently rendered as an empty cache -- a
 * driver who sees `CACHED CAMS 0` with no explanation reasonably concludes the
 * app never cached anything, which is a different problem with a different fix.
 *
 * The counters beside these read zero, which is what makes them the honest
 * sentences rather than {@link NEVER_CHECKED}: there is something on disk, and
 * the reason it is not being counted is stated.
 */
const EXPIRED_CACHE =
  'The cached cameras are past the age this app will trust and are not being ' +
  'used - treat clear as unknown until this device syncs.';

const MIXED_CACHE =
  'The cache holds rows from more than one published snapshot, so none of it ' +
  'is being used - treat clear as unknown until this device syncs.';

/**
 * Memory and disk are on different snapshots, and both are internally sound.
 *
 * This is the state `sync.ts` deliberately produces when a complete verified
 * network generation is admitted to memory but its durable replacement
 * conflicted: warnings are current, the disk copy a restart would load is the
 * older one. Saying so is the point -- the alternative is a screen that reports
 * an offline capability the next cold start will not have.
 */
const BEHIND_CACHE =
  'What is on disk is an older published snapshot than the warnings running ' +
  'now. Alerts are current; a restart with no signal would fall back to the ' +
  'older set.';

/** Which sentence the warning strip is showing. Drives nothing but the copy. */
export type DbWarningKind =
  | 'aged'
  | 'unchecked'
  | 'never-checked'
  | 'no-storage'
  | 'expired'
  | 'mixed'
  | 'behind';

export interface DbAgeWarning {
  readonly kind: DbWarningKind;
  readonly text: string;
  /**
   * The database layer's own account of why there is no storage, rendered as a
   * second, quieter line. Null for every other kind.
   * GAP: see docs/gaps-inbox/offline.md#no-storage-reason-is-undrawn
   */
  readonly detail: string | null;
}

export interface DbAgeWarningInput {
  /** Age of the oldest tile CHECK, or null when nothing was checked. */
  readonly ageMs: number | null;
  /** False when IndexedDB itself is missing or the open failed. */
  readonly storageAvailable: boolean;
  /**
   * Distinct cameras actually on disk. Required, because the sentence for "no
   * check" depends on whether there is a cache to be unsure about, and the two
   * do NOT travel together -- see {@link uncheckedText}.
   */
  readonly cachedCameras: number | null;
  /** Age of the oldest tile FETCH. Only used when there is no check time. */
  readonly cachedAgeMs: number | null;
  /** Verbatim from the database layer. Never carries user data. */
  readonly storageReason: string | null;
  /**
   * Why the rows on disk are not being counted, from `cache.ts`.
   *
   * `'none'` for a healthy cache and for a device with nothing on disk at all:
   * an empty cache is not incoherent, it is empty.
   */
  readonly incoherence?: CacheIncoherence;
  /**
   * True when the durable snapshot is a different generation from the live one.
   *
   * Resolved by the screen, which is the only place that can see both: the
   * database's sentinel comes from this read and the working generation comes
   * from the camera store.
   */
  readonly behindLiveGeneration?: boolean;
}

/**
 * The bordered warning line under the counters.
 *
 * "DB last updated 2 days ago. Cameras added since then are invisible - treat
 *  clear as probably clear."
 *   -- Flockys Screens II.dc.html, A2 · OFFLINE - DEGRADED
 *
 * Four sentences, one of them drawn. The choice between the other three is made
 * from the counts THIS SAME RENDER is printing: the screen may not say "Nothing
 * is cached" beside a counter that reads 4,182.
 */
export function dbAgeWarning(input: DbAgeWarningInput): DbAgeWarning {
  if (!input.storageAvailable) {
    return { kind: 'no-storage', text: NO_STORAGE, detail: input.storageReason };
  }
  // BEFORE THE AGE SENTENCE, because an age computed over rows that are not
  // being used describes a cache the driver does not have. "DB last updated 2
  // days ago" over a refused cache is the reassuring half of the truth.
  if (input.incoherence === 'mixed') {
    return { kind: 'mixed', text: MIXED_CACHE, detail: null };
  }
  if (input.incoherence === 'expired' && (input.cachedCameras ?? 0) <= 0) {
    return { kind: 'expired', text: EXPIRED_CACHE, detail: null };
  }
  if (input.behindLiveGeneration === true) {
    return { kind: 'behind', text: BEHIND_CACHE, detail: null };
  }
  const age = formatDbAge(input.ageMs);
  if (age !== null) {
    return { kind: 'aged', text: `DB last updated ${age} ago. ${INVISIBLE_CLAUSE}`, detail: null };
  }
  // Only the counted-and-empty cache may be called empty. A count that has not
  // arrived is not a zero, and a cache with cameras in it is not "nothing".
  if (input.cachedCameras !== null && input.cachedCameras <= 0) {
    return { kind: 'never-checked', text: NEVER_CHECKED, detail: null };
  }
  return { kind: 'unchecked', text: uncheckedText(input.cachedAgeMs), detail: null };
}
