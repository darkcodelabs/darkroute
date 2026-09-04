# gap inbox -- apps/pwa/src/services/db (IndexedDB schema, migrations, repositories)

The design files specify what the screens render. They do not specify how many
megabytes the cache may grow to, how long a queued report keeps trying, or when
a cached tile stops being trustworthy. Those are behavioural bounds rather than
rendered lengths, so no `var(--fwm-*)` token covers them and
`scripts/check-design-values.mjs` cannot see them -- which is exactly why they
need a written decision rather than a default nobody chose.

Every entry below is a single named constant in `apps/pwa/src/services/db/policy.ts`
or `apps/pwa/src/services/db/backoff.ts`, marked with the `GAP:` comment. Changing
one is a one-line change.

Two numbers the design DOES give, and which are therefore not gaps: the OFFLINE
screen's cached-state readout ("CACHED CAMS 4,182 / MAP TILES 318") and its
staleness copy ("DB last updated 2 days ago"). Both are cited in the entries
they informed.

## tile-cache-ceiling

- need: how many camera tiles the device may cache before the oldest are evicted.
- screen: OFFLINE (A2), which renders the cache as a first-class readout, and
  RADAR/SWEEP, which are only usable offline because of what this holds.
- source: `Flockys Screens II.dc.html` A2 renders a real cache in a real state --
  "CACHED CAMS 4,182 / MAP TILES 318". That is the size of a healthy install,
  not a ceiling; the design never states one.
- stand-in: `MAX_CAMERA_TILES = 512` -- the next power of two above the 318 the
  design shows, so a driver on their usual routes never evicts and a driver
  crossing three states does.
- options:
  1. Keep 512 tiles (~1.6x the design's rendered cache).
  2. Bound by bytes rather than rows, using `navigator.storage.estimate()` and a
     share of the origin quota. Truer to the real constraint, unavailable on the
     platforms that need it most (private mode returns nothing).
  3. Bound by geography -- keep tiles within N miles of home plus the current
     route corridor. Best user outcome, most machinery, needs a "home" concept
     that does not exist yet.

## tile-hard-expiry

- need: the age at which a cached tile is discarded no matter how empty the cache is.
- screen: OFFLINE (A2) -- "Cameras added since then are invisible -- treat clear
  as probably clear."
- source: the design shows two-day-old data being used with that warning. It
  never says where the data stops being usable at all.
- stand-in: `TILE_HARD_EXPIRY_MS = 30 days`.
- options:
  1. 30 days. Past a month, "treat clear as probably clear" is closer to a lie
     than a caveat.
  2. 7 days, matching a typical municipal deployment cadence. Safer, evicts far
     more aggressively, hurts rural drivers who sync rarely.
  3. No hard expiry; rely on the staleness label alone and let the user decide.
     Honest, but leaves a year-old tile silently answering "clear".

## tile-staleness-window

- need: the age at which a tile is labelled stale (not discarded -- labelled).
- screen: OFFLINE (A2) and every screen that renders a freshness state.
- source: nothing. The design demonstrates the *output* ("DB last updated 2 days
  ago") without stating the threshold that produces it.
- stand-in: `DEFAULT_TILE_STALE_AFTER_MS = 24 hours`, written into each
  `tileMeta` row so it can vary per tile later without a migration.
- options:
  1. 24 hours flat.
  2. Vary by zoom or by density -- a dense urban tile changes faster than a rural one.
  3. Server-driven: let the tiles endpoint return its own `staleAfterMs`. The
     schema already stores it per row, so this is the cheapest to adopt later.

## tile-eviction-order

- need: which tile to drop first when the cache is over its ceiling.
- screen: none directly; it decides what is missing the next time RADAR runs offline.
- source: nothing. The design specifies the cache exists, not how it ages.
- stand-in: oldest `fetchedAt` first, through the `by-fetchedAt` index, which
  never loads a tile body to decide what to drop.
- options:
  1. Oldest-fetched first (current). One index read, no write on the read path.
  2. True LRU. Needs a `lastAccessedAt` write on every read, which turns the hot
     read path into a write path on a device already running GPS.
  3. Distance-weighted: keep tiles near the current position and the usual
     routes regardless of age. Best outcome, needs a route model.

## alert-history-ceiling

- need: how many alert rows to keep before trimming oldest-first.
- screen: LOG / EXPOSURE -- the timeline, the trend, and "trip vs all-time".
- source: `Flockys Screens II.dc.html` B4 · TRIAGE gives the rate ("ALERTS PER
  DRIVE -- PROJECTED 4, down from 19"), not a retention period.
- stand-in: `MAX_ALERTS = 5,000` -- at the unfiltered 19 per drive, roughly nine
  months of daily driving.
- options:
  1. 5,000 rows.
  2. A time window (keep 12 months) instead of a row count. Matches how a user
     thinks about history; unbounded for a heavy driver.
  3. Full history, with roll-ups: keep every row for 90 days, then keep daily
     aggregates forever. Best for the trend line, needs an aggregation job.

## pending-action-queue-ceiling

- need: how many un-sent confirmations/disputes to hold before the oldest stop
  being retried.
- screen: the dock REPORT bar's queue count ("2 QUEUED").
- source: nothing. The design shows small numbers (2, 3) and never a limit.
- stand-in: `MAX_PENDING_ACTIONS = 200`, and overflow moves the oldest to
  `dead_letter` with the reason written into the row -- it is never deleted.
- options:
  1. 200 actions.
  2. Bound by age instead of count -- stop retrying anything older than a week.
  3. No ceiling. Actions are tiny; the real argument for a ceiling is that a
     four-figure queue is a state the user should see, not one the app absorbs.

## secondary-store-ceilings

- need: ceilings for trips, local plate-match rows, and watched plates.
- screen: LOG (trips), WATCHLIST (B5: "73 reads", three watched plates).
- source: the design renders three watched plates and a per-plate read count. It
  states no limit for any of the three stores.
- stand-in: `MAX_TRIPS = 750`, `MAX_PLATE_MATCHES = 5,000`,
  `MAX_PLATE_VAULT_ENTRIES = 200`.
- options:
  1. Keep as-is; all three are far above any plausible real use.
  2. Make the watchlist limit a product decision rather than a storage one -- a
     user with 200 watched plates is a different product than the one designed.
  3. Tie match retention to alert retention so LOG and WATCHLIST never disagree
     about how far back "history" goes.

## report-photo-ceiling

- need: how many attached photographs the device may hold before a new report
  can no longer carry one.
- screen: REPORT (the attach tile and its refusal sentence) and DEAD DROP, which
  is where those photographs are waiting.
- source: nothing. The design shows a report sheet and a held queue. It never
  states how many photographs may be queued at once, and no rendered string
  carries a number.
- stand-in: `MAX_REPORT_PHOTOS = 50`. At `MAX_BYTES` (600 KB) per prepared JPEG
  that is a 30 MB worst case, and fifty unsynced photo reports is already a state
  the driver should be told about rather than one the app absorbs.
- enforcement, which is the unusual part: `reportPhotos` is in
  `EVICTION_EXEMPT_STORES`, so hitting the cap never deletes anything. Evicting a
  photograph would leave a signed report citing a digest whose bytes the app
  itself removed unasked. The attach path refuses instead, and the report still
  files without the photograph.
- options:
  1. Keep 50 rows.
  2. Bound by bytes rather than rows -- truer to the real constraint, since the
     prepared sizes vary by roughly 6x, and it is the megabytes that hurt.
  3. Tie it to `navigator.storage.estimate()` and a share of the quota, with a
     row cap as the fallback for the platforms that report nothing.

## storage-pressure-threshold

- need: the share of the origin quota at which the app stops writing new cache
  and starts telling the user.
- screen: none exists. There is no storage or settings screen in the design --
  see also `DESIGN-GAPS.md#no-settings-screen-exists`.
- source: nothing.
- stand-in: `STORAGE_PRESSURE_RATIO = 0.9`. Evidence still writes at any
  pressure; only cache stops.
- options:
  1. 90%.
  2. 80%, giving more headroom on devices where the browser's estimate is coarse.
  3. Drive it off eviction success instead of a ratio: keep writing until a
     quota error, then evict and retry once. No magic number, worse diagnostics.

## queued-write-retry-schedule

- need: first retry delay, growth factor, ceiling, jitter and the attempt count
  after which a queued write is dead-lettered.
- screen: DEAD DROP (B2) -- "HELD · 41 MIN", "SYNC NOW" -- and the dock's
  "2 REPORTS QUEUED · SYNC ON WIFI".
- source: the design shows a report held for 41 minutes and a manual sync
  affordance. It specifies no automatic retry cadence at all.
- stand-in: `DEFAULT_BACKOFF_POLICY` -- 30 s base, factor 2, 1 h ceiling, 50%
  bounded jitter, 8 attempts (~4 h of trying) before `dead_letter`.
- options:
  1. Keep it. 30 s means a red light does not burn an attempt; 8 attempts means
     a driver who regains signal within four hours never sees a dead letter.
  2. Never dead-letter on transient failures at all -- retry at the ceiling
     forever, and reserve `dead_letter` for explicit server rejections. Safest
     for evidence, worst for a queue the user can never clear.
  3. Make it connectivity-driven rather than time-driven: retry on the
     `online` event and on unmetered-network transitions, with time-based
     backoff only as a fallback. Best behaviour, needs Network Information API
     capability detection, which is not universally available.
