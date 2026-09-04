# gap inbox -- OFFLINE (A2)

> **STALENESS WARNING, added 2026-08-30.** The OFFLINE screen this describes is v0's.
>
> `apps/pwa/src/app/registry.v1.tsx:71` maps `offline: OfflineV1Screen`, and v1
> is the default (`apps/pwa/src/app/design.ts:61`). The registry's own note
> calls it "OFFLINE, as a list of what still works rather than an apology" -
> a different structure from the A2 panel transcribed below.
>
> The "backing code read" list at the top compounds it: it names
> `features/radar/components/{RadarStrip,RadarView,DistanceReadout,RadarAction}`
> and `features/radar/{format,radarState}`, all of which belong to v0's RADAR,
> which `registry.v1.tsx:62` replaces with `DriveScreen`.
>
> The cache and capability entries still bind - `capabilities.ts` and `cache.ts`
> are shared and unedited. The drawn entries do not.
>
> Read instead: `features/offline/OfflineV1Screen.tsx`, `docs/STALENESS.md`.

Files: `apps/pwa/src/features/offline/**` (`OfflineScreen.tsx`,
`components/{OfflineView,CapabilityList,CacheCounters,CacheNotice}.tsx`,
`capabilities.ts`, `cache.ts`, `format.ts`, `hero.ts`, `offline.css`).

Source read: `Flockys Screens II.dc.html` -- `A2 · OFFLINE - DEGRADED`,
lines 80-126, in full. Backing code read before writing anything:
`stores/network.ts`, `stores/presence.ts`,
`services/db/repositories/{cameraTiles,tileMeta}.ts`, `services/db/index.ts`,
`features/radar/components/{RadarStrip,RadarView,DistanceReadout,RadarAction}.tsx`,
`features/radar/{format,radarState}.ts`, `features/radar/radar.css`.

Everything A2 draws is a literal read from it: `RADAR`, `OFFLINE`,
`NO NETWORK · RUNNING ON CACHE`, `610` / `FT`, `CACHED CAMERA · AHEAD`,
`WHAT STILL WORKS`, `OK` / `NO`, `alerts from cached cameras`,
`sweep, lookup, exposure log`, `reporting - queues locally`,
`mesh feed, other darkroute`, `ask - needs the model`, `CACHED CAMS`,
`MAP TILES`, `4,182`, `318`, `DB last updated 2 days ago. Cameras added since
then are invisible - treat clear as probably clear.`, `RETRY SYNC`.

Four elements are RADAR's, imported rather than rebuilt: `OfflineStrip`
(the amber strip), `DistanceReadout` (the hero), `RadarMessage` (the sentence
that replaces the hero when there is no distance to draw) and `RadarAction`
(the 48px button). The hero is gated by RADAR's own `hasLiveDistance`, so the
two screens degrade together - see `hero-with-no-camera-is-undrawn` and
`degraded-hero-copy-is-duplicated`. `.fwm-offline` re-declares the four `--fwm-radar-*` locals those
rules read, with the same derivations `radar.css` uses, instead of adopting
`.fwm-radar`'s layout.

## Cross-references, not new entries

The decision is already filed; OFFLINE is another instance of it.

- `DESIGN-GAPS.md#radar-hero-96-vs-token-80` -- A2 renders the hero at 88px
  where screen 01 renders 96px. The shared `.fwm-radar-digits` uses
  `var(--fwm-text-hero)` (80px) for both, so the two screens now agree with each
  other and are both smaller than their references.
- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- A2's sites: the `OFFLINE`
  word (10px), the `WHAT STILL WORKS` caption (10px), the capability rows
  (12px), the counter captions (9px) and the DB-age sentence (11px). All render
  at `var(--fwm-text-micro)` (11px).
- `DESIGN-GAPS.md#token-set-does-not-cover-rendered-hero-sizes` -- the 28px
  counter value takes `--fwm-text-title` (24px), exactly as RADAR's stat tiles
  take it for their 26px value.
- `DESIGN-GAPS.md#animations-are-not-tokens` -- the strip's `fwmPulse 1.6s` is
  `calc(var(--fwm-dur-alert) * 4)`, the same derivation `radar.css` uses.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- see
  `no-cache-and-no-check-are-undrawn` below for the OFFLINE-specific half.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- the 1px
  hairline (`--fwm-space-1 / 4`) and the 2px rule down the left of the DB-age
  warning (`--fwm-space-1 / 2`), both component-scoped locals.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.1em`,
  `.18em` and `.2em` on this screen, expressed as `calc(var(--fwm-text-*) * n)`.
- `docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30` -- the
  14px body gap, the 14px counter padding and the 10px capability-row gap all
  take the nearest step below (12, 12, 8).
- `docs/gaps-inbox/radar-screen.md#status-dot-size-has-no-token` -- the strip's
  6px pulse dot.

## capability-rows-are-a-picture-not-a-check

- need: confirmation that the five `WHAT STILL WORKS` verdicts are meant to be
  live, and a ruling on the three rows the design draws `OK`.
- screen: `A2 · OFFLINE - DEGRADED`, the `WHAT STILL WORKS` card.
- source: A2 draws five fixed rows -- three `OK`, two `NO`. It is a picture of
  one particular device: full tile cache, working IndexedDB, no network.
- stand-in: `capabilities.ts` resolves all five from live facts. `mesh` reads
  the presence slice's own `availability` (only `live` is `OK`); `ask` needs a
  network the OS claims AND that has not just failed a request; the three local
  rows go `NO` when IndexedDB is missing, and `cached-alerts` additionally goes
  `NO` when the tile cache is genuinely empty -- "running on cache" with no
  cache is the worst false negative this product can produce. The design's own
  device still renders exactly the five verdicts it draws, and there is a test
  that says so.
- options: (1) keep the resolved verdicts; (2) treat the row set as static copy
  and move the real capability reporting to a diagnostics screen, which would
  mean this screen can tell a driver reporting works when it cannot.

## rows-name-the-resource-not-the-screen

(Was `lookup-row-names-a-flagged-off-feature`. Widened after review: the same
question applies to three of the five rows, not one.)

- need: a ruling on rows whose wording names a feature the shipped build may not
  be able to open - `sweep, lookup, exposure log` while `FEATURES.plateLookup`
  is `false`, `ask - needs the model`, and `reporting - queues locally`.
- screen: `A2`, capability rows 2, 3 and 5.
- source: A2 draws five fixed rows. `config/features.ts` has LOOKUP switched off
  pending permission, and `Dock.visibleDockKeys()` filters its dock key out, so
  the shipped build has no LOOKUP screen at all - online or offline. ASK, REPORT
  and LOG are registered in `main.tsx` today, but a registry is a shell fact and
  it can change without this feature being touched.
- stand-in: every row resolves the RESOURCE it names and nothing else - storage
  for the three local rows, the presence slice for the mesh, a network that the
  OS claims AND that has not just failed a request for `ask`. No row consults the
  screen registry. A flagged-off or unregistered feature is not something the
  offline screen took away and not something restoring the network would bring
  back, so it does not flip a verdict. The consequence is stated plainly: the
  screen can print the word `lookup` in a build that has no LOOKUP.
- options: (1) leave the wording and the resolution alone, which is the smallest
  change and keeps the design's copy intact; (2) resolve each row per named tool
  and render `NO` while any of them is absent, which would report SWEEP and the
  exposure log as broken when they work, and would make this screen depend on
  the shell's registry; (3) redraw the rows without the absent tools for as long
  as they are absent, which means the design file and the build disagree on a
  string.

## map-tiles-counts-camera-tiles

- need: confirmation of what `MAP TILES 318` counts.
- screen: `A2`, the right-hand counter.
- source: A2 draws `CACHED CAMS 4,182` beside `MAP TILES 318`. The repository
  comment on `cameraTiles.cameraCount()` names the left counter explicitly
  ("The OFFLINE screen's `CACHED CAMS 4,182`"). Nothing names the right one,
  and there are two candidates: cached CAMERA tiles (`cameraTiles.count()`) and
  cached BASEMAP raster tiles, which live in the service worker's Cache Storage
  and are not in IndexedDB at all.
- stand-in: `cameraTiles.count()`. It is the tile count this feature can read
  honestly, it moves with the counter beside it, and the ratio it produces
  (4,182 cameras over 318 tiles) is the ratio the design draws.
- options: (1) keep it and rename nothing; (2) count basemap tiles out of Cache
  Storage instead, which needs a service-worker query this screen does not have
  and would make the two counters describe unrelated caches; (3) draw both.

## db-age-is-the-oldest-check

- need: a ruling on what "last updated" means across many tiles.
- screen: `A2`, the DB-age warning.
- source: "DB last updated 2 days ago. Cameras added since then are invisible."
  The phrase reads like the most recent update; the sentence after it is a
  claim about what might be MISSING, which is bounded by the least recent one.
  `tileMeta` exposes `oldestCheckedAt()` and nothing else, and its own comment
  says that method is "for 'last updated'".
- stand-in: the oldest `lastCheckedAt` across every cached tile. A tile checked
  two days ago can be missing cameras added since, whatever its neighbours say,
  so the conservative bound is the honest one for a sentence whose job is to
  stop a driver trusting "clear".
- options: (1) keep the oldest check; (2) print the newest check and add a
  second line for the stalest tile, which is two numbers on a driving screen;
  (3) print the age of the tile the vehicle is currently in, which is the most
  relevant number and the one this screen has no position-to-tile mapping for.

## db-age-phrase-only-drawn-for-days

- need: the wording for every age that is not "2 days".
- screen: `A2`, the DB-age warning.
- source: the design renders one moment: `2 days ago`.
- stand-in: `formatDbAge()` -- `less than a minute`, `N minute(s)`, `N hour(s)`,
  `N day(s)`, floored at zero so a device clock that moved backwards cannot
  print a negative age. Nothing coarser than days, because
  `TILE_HARD_EXPIRY_MS` drops a tile at 30 days and there is no "3 months ago"
  state to name.
- options: (1) keep the four bands; (2) drop below-a-day entirely and say
  `updated today`, which hides a six-hour-old cache behind reassuring copy.

## no-cache-and-no-check-are-undrawn

- need: copy for two states A2 does not draw -- nothing cached, and no local
  storage at all.
- screen: `A2`, the DB-age warning and the counters.
- source: A2 draws a full cache on a working device. `openFwmDb()` throws
  `DatabaseUnavailableError` in a private-mode webview, and a first run has an
  empty `cameraTiles` store with no `tileMeta` rows to age.
  CORRECTION (review): "no cache" and "no check" do NOT travel together. A tile
  write leaves no `tileMeta` row, so a FILLED cache normally has no check time
  either - the sentence below is now reachable only when the counters read zero,
  and the filled-but-unchecked case has its own entry,
  `cached-but-never-checked-is-undrawn`.
- stand-in: two replacement sentences, both keeping A2's "treat clear as ..."
  shape so the caveat reads the same way:
  - never checked: "DB has never been checked against the source on this
    device. Nothing is cached - treat clear as unknown."
  - no storage: "Local storage is unavailable, so no cameras are cached and
    nothing can be queued - treat clear as unknown."
  Both keep the amber left rule, because inventing a second colour for the
  states the design does not draw would make them look like a different kind of
  warning. While the read is still in flight the whole line is absent and the
  counters read ` - `, rather than a `0` the screen has not earned.
- options: (1) accept both sentences as written; (2) draw them; (3) route the
  no-storage case to a dedicated "this browser cannot store anything" screen,
  since it degrades far more than OFFLINE does.

## no-online-variant-of-a2

- need: what A2's header and hue do when the network comes back while the
  screen is open.
- screen: `A2`, the header word and the direction line.
- source: A2 draws `OFFLINE` in amber and the direction line in the same amber,
  because A2 is a phone with no network. `offline` is a registered screen id in
  its own right, so it can be on screen when connectivity returns.
- stand-in: the header word is read from the network slice -- `OFFLINE` when
  offline, `ONLINE` when not -- and `--fwm-radar-hue` follows it, amber to
  `--fwm-alert-clear`. `ONLINE` is the only word on this screen the design does
  not draw. The amber strip removes itself already, via RADAR's `OfflineStrip`.
- options: (1) keep the two-word header; (2) leave the slot empty when online,
  which reads as a rendering bug; (3) navigate away from `offline`
  automatically when connectivity returns, which yanks the screen out from
  under a driver who opened it deliberately.

## counter-grouping-is-not-localised

- need: a ruling on number formatting for the counters.
- screen: `A2`, `CACHED CAMS 4,182`.
- source: the design renders a comma.
- stand-in: a literal comma every three digits, written out rather than taken
  from `toLocaleString`, so a device set to `de-DE` cannot render `4.182` and
  disagree with the design for reasons that have nothing to do with the cache.
- options: (1) keep it; (2) localise every number in the product at once,
  including the distance readout, which is a product-wide decision and not
  this screen's.

## retry-sync-has-nothing-to-call

- need: the sync trigger.
- screen: `A2`, the 48px `RETRY SYNC` button.
- source: A2 draws the button. `stores/sync.ts` publishes status, hold reason,
  queue counts and dead letters, and exposes no "drain now" action; nothing in
  the repo owns a network transport for the queue yet.
- stand-in: `onRetrySync` is a prop, and `RadarAction` renders the button
  disabled when it is absent -- the same contract RADAR's `RETRY LOCK` and
  `ALLOW` already use. The shipped build therefore draws the control the design
  draws and admits it is not wired, rather than offering a live-looking button
  that silently does nothing.
- options: (1) leave it a prop and wire it from the driving loop when the sync
  transport lands; (2) give `syncActions` a `requestDrain()` the screen can
  call, which puts a network trigger behind a store method.

## cached-cams-counts-distinct-cameras

- need: confirmation of what `CACHED CAMS 4,182` counts when tiles overlap.
- screen: `A2`, the left-hand counter.
- source: A2 draws one number. `cameraTiles` exposes two ways to get it:
  `cameraCount()`, which sums `cameras.length` across tiles with no
  de-duplication, and `camerasIn(keys)`, which de-duplicates by id under an
  explicit rule - "tiles overlap at their edges, and a camera that appears in
  two tiles is one camera, not two alerts".
- stand-in: `camerasIn(everyKey).length`. The counter reports DISTINCT cameras,
  so it agrees with the alerting path about how many cameras exist; the summed
  figure overstates a cache by however many cameras sit on a tile edge, on the
  one screen whose purpose is to be exact about what is cached. The cost is
  loading the tile bodies, which the summed count already did.
- options: (1) keep the distinct count; (2) take `cameraCount()` back and label
  the counter as an upper bound, which needs a second word A2 does not draw;
  (3) have the repository store a distinct total on write, which moves the
  question into the sync layer.

## cached-but-never-checked-is-undrawn

- need: copy for a cache that HAS tiles and has never been checked against the
  source.
- screen: `A2`, the DB-age warning.
- source: A2 draws a cache checked two days ago. In this repo `cameraTiles.put()`
  and `putMany()` write the tile body and nothing else; a `tileMeta` row - the
  only thing carrying a check time - exists solely when someone separately calls
  `markChecked`, and nothing outside a test does. So the ordinary filled cache
  has `cachedCameras > 0` and `oldestCheckedAtMs === null`, and the previous
  "Nothing is cached" sentence rendered directly under `CACHED CAMS 4,182`.
- stand-in: a fourth sentence, chosen from the counts the same render is
  printing, and keeping A2's "treat clear as …" shape: "DB has never been
  checked against the source on this device. What is cached was stored 2 days
  ago and never verified - treat clear as unknown." The age in it is the oldest
  tile's `fetchedAt`, which is never presented as a check against the source,
  because it is not one. "Nothing is cached" is now reachable only when the
  counter beside it reads zero.
- options: (1) accept the fourth sentence; (2) draw it; (3) have the sync layer
  call `markChecked` on every tile write so the two facts travel together, which
  is the real fix and belongs to the sync layer, not to this screen.

## hero-with-no-camera-is-undrawn

- need: what the hero shows with a fix, a cache, and no nearest camera.
- screen: `A2`, the `610` / `FT` / `CACHED CAMERA · AHEAD` block.
- source: A2 draws a camera 610 ft ahead. With `nearest === null`, RADAR's
  `directionLine()` takes the offline branch with no coarse direction and
  returns the bare string `CACHED CAMERA`, while `formatDistanceValue(null)`
  returns ` - `. Ungated, the hero read " - FT / CACHED CAMERA" - a provenance
  label for a distance that does not exist - and it could do so directly above
  `CACHED CAMS 0`.
- stand-in: the readout is replaced by a sentence, the way RADAR replaces it.
  Two leads, neither drawn: "nothing is cached on this device." (with "there is
  no camera here to measure against.") when the count is zero or storage is
  gone, and "no cached camera nearby." when the cache is full and the engine
  found none. The two are separate facts and are not merged.
- options: (1) accept the two leads; (2) draw them; (3) keep the readout and
  print ` - ` with no line, which is the state the review called a screen that has
  stopped explaining itself.

## degraded-hero-copy-is-duplicated

- need: one home for the three degraded lead sentences and the privacy note.
- screen: `A2` and the RADAR state matrix.
- source: `RadarView.tsx` keeps `degradedCopy()` module-private. OFFLINE needs
  the same three sentences, because it renders the same `DistanceReadout` from
  the same `directionLine` and must degrade identically in `no_gps` - otherwise
  the two screens describe one device two ways.
- stand-in: `hero.ts` repeats the strings verbatim, and `OfflineScreen.test.tsx`
  renders RADAR and OFFLINE side by side against the same stores in each of the
  four conditions and asserts the rendered sentences are identical, so the
  duplication cannot drift silently.
- options: (1) keep the guarded duplicate; (2) export `degradedCopy` from
  `features/radar` (or move it to `radar/format.ts`) and import it here, which
  is one line in another feature's file and is the right home - SHARED-FILE
  WORK, see the shared-shell note below; (3) move both screens onto a shared
  `DegradedReadout` component, which is a larger refactor of RADAR.

## no-storage-reason-is-undrawn

- need: whether the driver is told WHY there is no local storage.
- screen: `A2`, the DB-age warning.
- source: A2 draws a working device. `cache.ts` builds a reason for every
  failure - "this browser exposes no IndexedDB, so nothing is cached on this
  device", or the database layer's own `Error.message` - and nothing rendered
  it, so the specific cause never reached the driver.
- stand-in: the reason is rendered as a second, quieter line under the
  no-storage sentence, in `--fwm-text-muted`. It can only ever carry this
  module's own strings or a database-layer message, never a plate, a coordinate
  or a camera id, and it is rendered and nothing else - never logged, never
  sent, never in the URL.
- options: (1) keep the second line; (2) draw it; (3) drop `reason` from the
  read entirely, which throws away the only account of the failure the app has.

## mark-column-width-has-no-token

- need: a width for the `OK` / `NO` column that survives a third verdict.
- screen: `A2`, the `WHAT STILL WORKS` rows (`display:flex; gap:10px`).
- source: A2 draws two-character marks in every row and relies on the flex gap
  to line the labels up. The undrawn `unknown` verdict is a one-character em
  dash, which pulled the labels on those rows one character left while the cache
  read was in flight.
- stand-in: `min-width: 2ch` on `.fwm-offline-cap-mark`. `ch` is one character
  of the row's own monospace face, so the slot tracks the type rather than a
  hardcoded length; the token set carries no character-width unit and
  `--fwm-space-*` would only approximate it at one font size.
- options: (1) keep `2ch`; (2) add a character-width token, which is a
  token-set decision and not this screen's; (3) render a two-character mark for
  `unknown`, which means inventing a glyph pair the design never drew.

## shell-banner-would-stack-on-the-offline-strip

- need: a ruling for whoever wires `offline` into the shell.
- screen: `A2`, the 32px amber strip, and `App.tsx`'s `banners` slot.
- source: `App.tsx` renders a shell-level `banners` slot above the screen
  content, documented as "Offline banner, county strip, node strip". `main.tsx`
  passes none today, so nothing is wrong right now - but this screen renders
  RADAR's `OfflineStrip` itself, exactly as A2 draws it, so the moment an
  offline banner is supplied the driver sees two amber no-network bars stacked,
  and a screen reader hears both.
- stand-in: none available from inside this feature. The strip stays, because
  A2 draws it inside the screen.
- options: (1) the shell suppresses its offline banner while the active screen
  is `offline` - SHARED-FILE WORK, `apps/pwa/src/main.tsx` (or `App.tsx`), see
  the shared-shell note below; (2) this screen drops its own strip and relies on
  the shell's, which makes A2 render incorrectly in any build that passes no
  banners; (3) accept the stack, which is the one thing A2 rules out by drawing
  a single strip.

## shared-shell follow-up

Two fixes cannot live in this feature. Both are named above; they are collected
here so whoever wires the registry sees them in one place.

1. `apps/pwa/src/main.tsx` (or `apps/pwa/src/app/App.tsx`) - do not pass an
   offline banner into the shell's `banners` slot while the active screen is
   `offline`. This screen renders A2's own 32px amber strip; a shell banner on
   top of it is two no-network bars and two announcements.
   See `shell-banner-would-stack-on-the-offline-strip`.
2. `apps/pwa/src/features/radar/components/RadarView.tsx` - export
   `degradedCopy` (or move it to `features/radar/format.ts`) so OFFLINE can
   import the three degraded lead sentences instead of repeating them.
   `hero.ts` repeats them today under a test that renders both screens and
   compares the rendered words, which catches drift but does not prevent it.
   See `degraded-hero-copy-is-duplicated`.
