/**
 * Storage policy: how much this app is allowed to keep, and what it does when
 * it hits the ceiling.
 *
 * Every cap in this file is a decision, not a default nobody made. The design
 * files specify what the screens render, not how many megabytes the cache may
 * grow to, so each number below carries the reasoning that produced it and an
 * entry in `docs/gaps-inbox/db-storage.md` where a different number is a
 * one-line change here.
 *
 * THE ONE RULE THAT IS NOT A NUMBER: signed evidence is never evicted. Neither
 * `pendingReports` nor `reportChain` appears in any eviction path in this
 * codebase. If storage runs out with reports queued, the app refuses the new
 * write and says so - it does not quietly delete the thing the user filed
 * precisely because they expected to still have it in a month.
 */

import type { StoreName } from './schema.ts';

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

/**
 * Cached camera tiles.
 *
 * The OFFLINE screen renders a real cache in a real state: "CACHED CAMS 4,182
 * / MAP TILES 318" (`Flockys Screens II.dc.html` A2). 512 is the next power of
 * two above the number the design shows a healthy install holding, so a driver
 * on their usual routes never evicts, and a driver crossing three states does.
 *
 * GAP: see DESIGN-GAPS.md#tile-cache-ceiling
 */
export const MAX_CAMERA_TILES = 512;

/**
 * How long a tile body is worth keeping at all, regardless of freshness.
 *
 * The OFFLINE screen is willing to run on a two-day-old database while telling
 * the user exactly that. Thirty days is the point where "cameras added since
 * then are invisible" stops being a caveat and starts being a lie.
 *
 * GAP: see DESIGN-GAPS.md#tile-hard-expiry
 */
export const TILE_HARD_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Default staleness window written into `tileMeta.staleAfterMs`.
 *
 * GAP: see DESIGN-GAPS.md#tile-staleness-window
 */
export const DEFAULT_TILE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Alert history.
 *
 * LOG renders a timeline and a trend, and EXPOSURE compares this trip against
 * all time, so history has to outlive the trip that produced it. At the ~19
 * alerts per drive the TRIAGE screen calls the unfiltered case, 5,000 rows is
 * roughly nine months of daily driving.
 *
 * GAP: see DESIGN-GAPS.md#alert-history-ceiling
 */
export const MAX_ALERTS = 5_000;

/**
 * Trips, oldest-first trim. Two years of daily driving.
 *
 * GAP: see DESIGN-GAPS.md#secondary-store-ceilings
 */
export const MAX_TRIPS = 750;

/**
 * Queued confirmations and disputes.
 *
 * Small on purpose: these are cheap replayable actions, and a queue this long
 * means the network has been gone for days, which is a state the user should
 * see rather than a state the app should absorb silently. Overflow does not
 * delete - the oldest queued action moves to `dead_letter` with a reason.
 *
 * GAP: see DESIGN-GAPS.md#pending-action-queue-ceiling
 */
export const MAX_PENDING_ACTIONS = 200;

/**
 * Local plate-match rows behind WATCHLIST's read counts.
 *
 * GAP: see DESIGN-GAPS.md#secondary-store-ceilings
 */
export const MAX_PLATE_MATCHES = 5_000;

/**
 * Watched plates. The design renders three; nobody watches five hundred.
 *
 * GAP: see DESIGN-GAPS.md#secondary-store-ceilings
 */
export const MAX_PLATE_VAULT_ENTRIES = 200;

/**
 * Photographs attached to reports, at one per report.
 *
 * This is the only store measured in hundreds of kilobytes per row -
 * `MAX_BYTES` in `features/report/preparePhoto.ts` is 600 KB - so 50 rows is a
 * 30 MB worst case. A driver holding fifty unsynced photo reports is already an
 * extreme state, and per this file's one rule the app surfaces that rather than
 * absorbing it: the ATTACH path refuses at the cap and the report still files
 * without the photograph. Nothing is deleted to make room.
 *
 * GAP: see docs/gaps-inbox/db-storage.md#report-photo-ceiling
 */
export const MAX_REPORT_PHOTOS = 50;

/**
 * Per-store caps, as data, so `estimateUsage()` can report headroom without
 * every repository exporting its own number.
 *
 * `null` means "never evicted by this layer".
 */
export const STORE_CAPS: Readonly<Record<StoreName, number | null>> = {
  cameraTiles: MAX_CAMERA_TILES,
  // One DB-wide CAS sentinel; evicting it would make every tile untrustworthy.
  cameraCacheState: null,
  tileMeta: MAX_CAMERA_TILES,
  alerts: MAX_ALERTS,
  trips: MAX_TRIPS,
  pendingReports: null,
  reportChain: null,
  // Preferences. One row per persisted slice, so it does not grow with use and
  // nothing here may be evicted - dropping it would silently reset the driver's
  // settings, which is the bug this store was added to fix.
  storeBlobs: null,
  pendingActions: MAX_PENDING_ACTIONS,
  settings: null,
  session: null,
  plateVault: MAX_PLATE_VAULT_ENTRIES,
  plateMatches: MAX_PLATE_MATCHES,
  // Capped AND exempt, which is a deliberate combination rather than a
  // contradiction - see the note on EVICTION_EXEMPT_STORES below.
  reportPhotos: MAX_REPORT_PHOTOS,
};

/**
 * Stores holding signed evidence, and the bytes a signed payload commits to.
 * Nothing here is ever evicted.
 *
 * WHY `reportPhotos` IS EXEMPT DESPITE BEING THE BIGGEST STORE. It is the
 * obvious eviction candidate on size alone, and evicting it is exactly the harm
 * this file's one rule forbids, arrived at sideways: the payload's `photo` field
 * is the digest of those bytes, so dropping them would leave a signed record
 * citing a photograph the app itself deleted without being asked. The ceiling is
 * enforced at the WRITE end instead - the attach path refuses at
 * `MAX_REPORT_PHOTOS` and says so - which is what "the app refuses the new write
 * and says so" means for a store whose rows are pictures.
 *
 * A store that is both capped and exempt reports `over > 0, evictable: false`
 * from `estimateUsage()`, which reads as "overdue, and deliberately nobody's to
 * fix silently". That is the intended readout, not a bug in the accounting.
 */
export const EVICTION_EXEMPT_STORES = [
  'pendingReports',
  'reportChain',
  'reportPhotos',
] as const satisfies readonly StoreName[];

/**
 * Fraction of the browser's reported quota above which the app stops writing
 * new cache and starts telling the user. Reports still write: evidence beats
 * cache every time.
 *
 * GAP: see DESIGN-GAPS.md#storage-pressure-threshold
 */
export const STORAGE_PRESSURE_RATIO = 0.9;
