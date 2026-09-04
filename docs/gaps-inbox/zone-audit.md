# gap inbox -- ZONE AUDIT + HEAT MAP

> **STALENESS WARNING, added 2026-08-30.** These two screens still exist and still work. What
> is stale is how you get to them - which is worse than it sounds.
>
> `ZoneAuditScreen` and `HeatMapScreen` are registered only in the v0 registry
> (`apps/pwa/src/main.tsx:125-126`). They are absent from
> `apps/pwa/src/app/registry.v1.tsx`, which is fine on its own - an absent id
> falls through to its v0 component.
>
> The navigation does not fall through. The only two calls that reach them are
> `features/log/LogScreen.tsx:206` (`openScreen('heat-map')`) and `:210`
> (`openScreen('zone-audit')`), and under the default design LOG is not
> `LogScreen` - `registry.v1.tsx:65` maps `log: ExposureScreen`, which contains
> no `openScreen` call at all. Neither screen is a tile on MORE
> (`features/more/MoreScreen.tsx:185-263`).
>
> Net: under the shipped default, ZONE AUDIT and HEAT MAP are reachable only by
> typing `?screen=zone-audit` or `?screen=heat-map`. The entries below describe
> real, working code. Do not read them as evidence a driver can get there.
>
> Read instead: `docs/STALENESS.md`.

Files: `apps/pwa/src/features/zone-audit/**` (`ZoneAuditScreen.tsx`,
`HeatMapScreen.tsx`, `components/*.tsx`, `zone.ts`, `zoneCsv.ts`,
`shareCard.ts`, `zone-audit.css`).

Sources read: `Flockys Screens II.dc.html` -- panel `B6 · ZONE AUDIT -
SHAREABLE CARD + HEAT LAYER` (lines 593-635) in full, plus `B4 · ALERT TRIAGE`
for the owner vocabulary and the muting rule and `B5 · PLATE WATCHLIST` for the
header shape; `Flockys App Screens.dc.html` `05 · LOG - EXPOSURE` (lines
323-390) for the two footer keys that navigate here and for the pass-counting
vocabulary the heat layer divides; `Flockys Design System.dc.html` section 08
for the token set.

Everything the panel draws is a literal read from B6: `ZONE AUDIT`,
`2 MI RADIUS`, `HEAT LAYER · READS PER MILE DRIVEN`, `LOW`, `MEDIUM`, `HEAVY`,
`TRIP OVERLAY ON`, `SHARE CARD - RENDERS AS AN IMAGE`, `DarkRoute`/`WatchingMe`,
`47`, `license plate readers within 2 miles of Hartwell Elementary.`,
`POLICE-OWNED`, `HOA / PRIVATE`, `SHARED TO OUTSIDE AGENCIES`,
`FACING INBOUND TRAFFIC`, `COMMUNITY-REPORTED · AUG 19 2026`,
`darkroute.app`, `SHARE CARD`, `EXPORT CSV`.

The REPORT bar and the dock word-keys are NOT reproduced here: they are shell
chrome (`app/App.tsx` + `components/dock`), and B6 draws neither.

## Cross-references, not new entries

The decision is already filed; ZONE AUDIT is another instance of it.

- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- this screen's sites: the
  header radius readout (10px), the heat caption (9px), the legend row (10px),
  the `SHARE CARD - RENDERS AS AN IMAGE` eyebrow (10px), the card's four stat
  rows (11px) and its footer (9px). All render at `var(--fwm-text-micro)`.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- B6 draws one
  populated state and nothing else. See `heat-layer-has-no-drawn-empty-state`
  below.
- `DESIGN-GAPS.md#token-set-does-not-cover-rendered-hero-sizes` -- the card's
  70px numeral renders at `var(--fwm-text-hero)` (80px) with the drawn
  line-height (.95) and tracking (-.03em) carried as ratios of the token.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- every
  1px hairline on this screen, derived as `calc(var(--fwm-space-1) / 4)` in the
  component-scoped local `--fwm-zone-rule-w`.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.1em`,
  `.14em`, `.16em` and `.2em` on this screen, expressed as
  `calc(var(--fwm-text-*) * n)`.
- `docs/gaps-inbox/log.md#spacing-scale-misses-5-14-and-18` -- B6's 14px body
  stack and 18px card padding take `var(--fwm-space-3)` and
  `var(--fwm-space-4)`.
- `docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner` -- **THE LOAD-BEARING
  ONE FOR THIS SCREEN.** No product code calls `historyActions.startTrip()`, so
  `useCurrentTrip()` is null in every shipped build, `trip.distanceMi` never
  exists and `trip.cameraIdsPassed` is always empty. Two things on B6 depend on
  it: the heat layer's DRAWN caption (`READS PER MILE DRIVEN`) and the
  `TRIP OVERLAY` outline. See `heat-scope-falls-back-when-no-trip-is-open` and
  the amendment to `trip-overlay-cannot-draw-a-route` below for what this
  screen draws instead of nothing.

## radius-selector-is-named-but-never-drawn

- **Status:** STANDING IN
- **Need:** what the radius control is, and which radii it offers.
- **Screens:** B6's header draws one static readout, `2 MI RADIUS`. No picker,
  no chips, no stepper, no second value appears anywhere in any design file --
  `grep -in 'radius' *.dc.html` outside `border-radius` returns exactly that one
  line plus section 08's `--fwm-radius-*` block.
- **Problem:** the screen is specified as having a radius selector, but the
  panel gives one value and no affordance, so both the control's shape and its
  option set are unstated.
- **Stand-in:** the readout itself is the control. It is a button carrying the
  panel's exact string; pressing it advances to the next radius and wraps.
  `ZONE_RADII_MI = [1, 2, 5]`, opening on `2` because that is the value B6
  draws. The element count, the copy and the position are the panel's; only the
  press behaviour is added.
- **Cost if wrong:** a designed picker replaces one button. `nextZoneRadius()`
  and `ZONE_RADII_MI` are the whole contract.

## heat-layer-metric-is-not-in-any-store-spatially

- **Status:** STANDING IN
- **Need:** where "READS PER MILE DRIVEN" is measured, per place.
- **Screens:** B6 captions the layer `HEAT LAYER · READS PER MILE DRIVEN` and
  draws three soft blobs at fixed positions.
- **Problem:** an `AlertLogEntry` deliberately carries no latitude and no
  longitude (`stores/history.ts`, and the same rule in `services/db/schema.ts`),
  and no repository holds a trip path -- `TripRecord` is
  `{startedAt, endedAt, distanceMi, cameraIdsPassed, exposureCount}`. There is
  therefore no located record of a read anywhere on the device. The only
  spatially located data is the camera cache, which is public infrastructure.
- **Stand-in:** a read is located by the CAMERA it happened at. The audited disc
  is divided into an 8x6 grid; each cell counts the cameras inside it and the
  passes the alert log recorded at those cameras, and its metric is
  `reads / trip.distanceMi` -- reads per mile driven, exactly as captioned. The
  engine (`@fwm/core`) supplies the distance and the bearing from the zone
  centre to each camera; this feature only projects that polar pair onto the
  grid, and does no geodesy of its own.
- **Cost if wrong:** `heatCells()` in `zone.ts` is the only site.

## heat-bands-low-medium-heavy-have-no-cut-points

- **Status:** STANDING IN
- **Need:** what separates LOW from MEDIUM from HEAVY.
- **Screens:** B6's legend names three bands and colours them
  `--fwm-alert-clear` / `--fwm-alert-approaching` / `--fwm-alert-in-range`. It
  never says what a band means numerically.
- **Problem:** a three-band legend with no cut points is unimplementable without
  choosing them, and choosing them relative to the busiest cell would make every
  zone look identically hot.
- **Stand-in:** absolute bands, named as constants:
  `HEAVY_READS_PER_MI = 1`, `MEDIUM_READS_PER_MI = 0.4`, anything above zero is
  LOW, and zero is no band at all and draws nothing. Absolute so that two zones
  can be compared, which is the point of an audit.
- **Amendment (audit round 2):** the layer has a second scope that bands a
  COUNT rather than a rate (`heat-scope-falls-back-when-no-trip-is-open`), and a
  count is a different unit, so the per-mile cut points may not be reused for
  it. `HEAVY_READS = 5`, `MEDIUM_READS = 2`, same shape and the same reason for
  being absolute. `heatRank(value, scope)` takes the scope so neither pair can
  be applied to the other's quantity by accident; `zone.test.ts` asserts that
  one read is HEAVY as a rate and LOW as a count.
- **Cost if wrong:** four constants in `zone.ts`.

## heat-layer-has-no-drawn-empty-state

- **Status:** STANDING IN
- **Need:** what the layer draws before there is anything to draw.
- **Problem:** "reads per mile driven" has no value when no miles have been
  driven, the zone has no location before the first GPS fix, and a device that
  has cached no tiles has no cameras to place. B6 draws none of those.
- **Stand-in:** the layer says which of the three it is, in the panel's own
  mono/micro voice, and draws no blobs: `NO FIX · ZONE NOT LOCATED`,
  `NO CAMERAS CACHED FOR THIS ZONE`, `NO CAMERAS IN THIS ZONE`. The hatch, the
  caption and the legend stay, so the layer is recognisably the same surface.
  A fake blob would be a lie about surveillance density, which is the one thing
  this screen exists to state accurately.
- **Amendment (audit round 2):** `NO MILES DRIVEN YET` IS GONE, and its removal
  is the point. It was the reason the layer returned for every build in
  existence -- no trip owner means no odometer means that string, for ever --
  so B6's largest element was an empty box in the shipped app and only the
  tests, which call `startTrip()` directly, ever saw a blob. The fourth reason
  is now `NO READS RECORDED IN THIS ZONE YET`, which is about a MEASUREMENT
  this device could have taken and has not, rather than about a lifecycle
  nothing runs. `heatUnavailableReason()` no longer reads the odometer at all.

## trip-overlay-cannot-draw-a-route

- **Status:** STANDING IN
- **Need:** what the trip overlay overlays.
- **Screens:** B6's legend row ends with `TRIP OVERLAY ON`.
- **Problem:** no trip path exists on the device (see
  `heat-layer-metric-is-not-in-any-store-spatially`). There is no polyline to
  draw, and reconstructing one from fixes would mean storing a coordinate
  history of the driver, which this product deliberately does not keep.
- **Stand-in:** the overlay marks the cells the OPEN TRIP actually reached --
  a cell holding a camera whose id is in `trip.cameraIdsPassed` is outlined.
  That is the drive's real footprint through the zone at the resolution the
  device can honestly claim, and it needs no new stored coordinate. The control
  is a toggle carrying the panel's string -- `TRIP OVERLAY ON`, or
  `TRIP OVERLAY OFF` -- and opens ON because that is what B6 draws.
- **Amendment (audit round 2):** `trip.cameraIdsPassed` is EMPTY in every
  shipped build for the same reason the odometer is
  (`docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner`), so the toggle outlines
  nothing until something opens a trip. The toggle is left drawn and live
  rather than hidden: it is B6's own control, it changes real state, and the
  outline appears the moment a trip exists. No stand-in outline is drawn in the
  meantime -- an invented footprint is exactly the lie the entry above refuses.

## share-card-does-not-render-as-an-image

- **Status:** STANDING IN
- **Need:** a rasteriser.
- **Screens:** B6 labels the preview `SHARE CARD - RENDERS AS AN IMAGE`.
- **Problem:** nothing in this app can turn a DOM subtree into a PNG. The only
  paths are a canvas re-implementation of the card (a second copy of the same
  design, in a second language, that will drift) or a DOM-to-canvas dependency,
  and neither is this screen's call to add.
- **Stand-in:** the card is rendered as the design draws it and SHARE CARD
  shares its TEXT through `services/adapters/share.ts` under the payload kind
  the adapter already reserves for it, `zone-audit-card`. The text carries the
  same statistics as the preview and, like the preview, no plate and no
  coordinate. `share()` is called only from the press.
- **Cost if wrong:** `shareCard.ts` gains a `files` member; the adapter already
  supports one and already refuses to share files a browser will not take.

## no-configured-origin-so-the-card-carries-no-domain

- **Status:** OMITTED, DELIBERATELY
- **Screens:** B6's card footer reads `COMMUNITY-REPORTED · AUG 19 2026` over
  `darkroute.app`.
- **Problem:** `ShareCard` receives no configured public origin, and
  `services/adapters/share.ts` states the rule this feature has to keep: "NO
  DOMAIN LIVES IN THIS FILE ... a share with no configured origin goes out
  without a link rather than with the wrong one." the environment template declares no
  public-origin variable, and adding one edits a shared file.
- **Stand-in:** the date line renders; the domain line does not, and the share
  payload carries no `url`. `ShareCard` takes an `origin` prop -- absent by
  default -- so the line appears the moment a configured origin is passed in,
  with no change to this component.
- **Amendment (audit round 2):** to be exact about what a driver sees: the prop
  is not passed anywhere, because the screen is used zero-prop, so the line
  renders in NO build today -- not just in builds without an origin. It becomes
  a one-word change at the registration site
  (`screens-are-not-registered-in-the-shell`) once a public-origin variable
  exists in the environment template.

## card-place-name-needs-a-geocoder

- **Status:** TRUNCATED, DELIBERATELY
- **Screens:** B6's card reads `license plate readers within 2 miles of Hartwell
Elementary.`
- **Problem:** naming the centre of the disc means reverse-geocoding the
  driver's current position, which is a network call carrying their exact
  coordinates -- the one thing this product will not do. There is no place-name
  source on the device; `services/db/schema.ts` gives a camera an id, a
  position, a facing, an owner and a confirmation count, and no label.
- **Stand-in:** the sentence renders without the trailing place clause --
  `license plate readers within 2 miles.` -- rather than inventing a name or
  printing a coordinate. `ShareCard` takes a `place` prop, absent by default, so
  a future picker that lets the user NAME their own zone restores the drawn
  sentence exactly.
- **Amendment (audit round 2):** same exactness as the entry above -- the prop
  is passed by nothing, so the clause renders in no build today. Nothing on the
  device can name a zone yet, so there is no value to pass; the prop is the
  seam, not the feature.

## zone-centre-is-the-current-fix

- **Status:** STANDING IN
- **Need:** what the zone is centred on.
- **Problem:** B6 audits a named place, and B6 draws no map, no search field and
  no pin, so nothing on the screen chooses one.
- **Stand-in:** the centre is the current GPS fix, which is the only location
  the app holds. Nothing derived from it leaves the device: the centre is never
  rendered, never written to the URL (`app/screenState.ts` carries a screen id
  and nothing else), never put in the CSV and never put in the share text.

## owner-buckets-in-b6-overlap-and-ours-cannot

- **Status:** STANDING IN
- **Screens:** B6's card reads `POLICE-OWNED 19`, `HOA / PRIVATE 28`,
  `SHARED TO OUTSIDE AGENCIES 31`, `FACING INBOUND TRAFFIC 22` over a total of
  `47`. 19 + 28 = 47, so the third row is a CROSS-CUT of the first two -- a
  police camera can also be shared to outside agencies.
- **Problem:** `CameraOwnerType` is a five-way exclusive enum
  (`police | inter_agency | hoa | private | unverified`), so a camera is shared
  OR police, never both, and no field records inter-agency sharing separately.
  Changing that enum edits `services/db/schema.ts`, a shared file.
- **Stand-in:** the three owner rows read the exclusive enum --
  `POLICE-OWNED` = `police`, `HOA / PRIVATE` = `hoa` + `private`,
  `SHARED TO OUTSIDE AGENCIES` = `inter_agency`. `unverified` cameras count in
  the total and appear in no row, which is why the rows can sum to less than the
  hero. No fourth row is added: B6 draws four rows and this screen draws four.
- **Cost if wrong:** `zoneStats()` in `zone.ts`, plus a `sharedOutside` boolean
  on the camera record.

## facing-inbound-traffic-is-interpreted-as-facing-the-zone-centre

- **Status:** STANDING IN
- **Need:** what "inbound" is inbound to.
- **Problem:** a camera record carries `directionDeg` -- where the lens looks --
  and nothing about the road it watches or which way traffic runs on it.
- **Stand-in:** inbound means toward the audited place. A camera counts when
  `isFacingVehicle(camera.directionDeg, bearing(centre -> camera))` is true, the
  engine's own 60-degree cone -- the lens is pointed back at the middle of the
  zone. A camera with no recorded facing counts in neither direction and is not
  guessed at: `isFacingVehicle` returns `null`, and `null` is not `false`.

## export-csv-has-no-sink-on-this-device

- **Status:** BLOCKED, KEY RENDERS DISABLED
- **Screens:** B6's second footer key, `EXPORT CSV`.
- **Problem:** there is nowhere sanctioned to put the bytes. The clipboard
  adapter's `ClipboardKind` union is a deliberately short reviewable list
  (`camera-id | report-hash | export-json | public-link`) with no CSV member,
  and adding one edits a shared adapter. `share.ts`'s payload kinds do not cover
  a data file either. A download needs an anchor and an object URL, which is a
  browser API this screen may not reach for.
- **Stand-in:** the same call `B2 · DEAD DROP` made for `EXPORT JSON`
  (`docs/gaps-inbox/dead-drop.md#export-json-has-no-sink-on-this-device`): the
  bundle is built by `buildZoneCsv()` and handed to an injected `onExportCsv`
  handler; a build with none renders the key disabled rather than live-looking
  and inert. The bytes are serialised on the press and only when a handler
  exists, so a build with no sink never produces them at all.
- **Amendment (audit round 2):** the screen is used zero-prop, so
  `onExportCsv` is `undefined` in the running app and B6's second key is
  disabled in every build. That is a real hole and it cannot close inside this
  feature: the fix is one member on a shared union.
  **The exact change:** add `'export-csv'` to `ClipboardKind` in
  `apps/pwa/src/services/adapters/clipboard.ts`, then wire `onExportCsv` where
  the screen is registered. `ZoneCsvBundle` already carries `text` and
  `filename`, the builder is fully tested, and nothing else moves. The disabled
  key is now drawn as a filled block rather than erased (see
  `the-disabled-key-was-not-drawn-at-all` below), so a driver reading the panel
  sees the key the design draws and finds it inert, instead of seeing nothing
  where B6 draws a key.

## what-the-csv-may-contain

- **Status:** DECIDED
- **Problem:** B6 names the format and nothing else, and a zone export is the
  one artefact on this screen that leaves as a file.
- **Decision:** `camera_id, owner_type, facing_inbound, confirmations, reads`
  and nothing else. NO plate (there is none in reach: the vault is a different
  store and no plate value exists in any type this feature imports). NO camera
  latitude or longitude, NO zone centre, NO fix, NO bearing and NO distance --
  a list of coordinates whose centroid is the driver is a location disclosure
  wearing a spreadsheet. NO timestamps: when a read happened is a movement
  trace, so only the aggregate count per camera goes out. The file name is
  `fwm-zone-audit-<UTC yyyymmdd>.csv`, which says nothing about the driver.
  `zoneCsv.test.ts` asserts each of these against a populated zone rather than
  documenting them.

## heat-grid-resolution-is-chosen-not-drawn

- **Status:** STANDING IN
- **Problem:** B6 draws three free-floating blobs at percentage positions. Free
  positions are data, and data-driven positions can only reach the DOM through
  an inline `style`, which is banned here for exactly the reason it would be
  used -- it is the one way a raw length gets past
  `scripts/check-design-values.mjs`.
- **Stand-in:** the same call `log.css` made for its bar heights
  (`docs/gaps-inbox/log.md#bar-heights-are-quantised`): the layer is a fixed
  8x6 CSS grid and a cell's band is a `data-fwm-zone-heat-rank` attribute with a
  rule per band. Each cell's blob is a radial gradient bled 50% past the cell on
  every side, so neighbouring cells merge into the soft shapes B6 draws instead
  of reading as tiles. `HEAT_GRID_COLS` / `HEAT_GRID_ROWS` are asserted against
  the `repeat()` in the stylesheet by `components/ZoneAuditView.test.tsx`, so the
  two cannot drift.

## heat-panel-height-210

- **Status:** NEAREST TOKEN
- **Problem:** B6's heat panel is 210px tall. The space scale is
  4/8/12/16/24/32/48 and cannot express 210.
- **Stand-in:** `calc(var(--fwm-space-8) * 6 + var(--fwm-space-4))` = 208px, the
  closest exact combination, in the component-scoped local
  `--fwm-zone-heat-h`. On `HEAT MAP` the layer takes the whole body instead and
  the height is not used.

## heat-panel-ground-and-hatch-are-nearest-tokens

- **Status:** NEAREST TOKEN
- **Problem:** B6's heat panel grounds on `#04060A` and hatches
  `#0A0D12` / `#070A0E` at 115deg with 12px/24px stops. The palette has
  `--fwm-bg` `#000000`, `--fwm-bg-sunken` `#07080B` and `--fwm-surface-1`
  `#0E0F13`; none of the three drawn values is a token.
- **Stand-in:** ground `var(--fwm-bg-sunken)`, hatch alternating
  `var(--fwm-surface-1)` and `var(--fwm-bg-sunken)`, stops
  `var(--fwm-space-3)` / `var(--fwm-space-6)` (12px / 24px, exact). The blob
  alphas B6 draws (.55 / .42 / .3) are carried as `opacity` on the blob, which
  is a ratio rather than a colour and so needs no colour token.

## heat-scope-falls-back-when-no-trip-is-open

- **Status:** STANDING IN (audit round 2)
- **Need:** a denominator for `READS PER MILE DRIVEN` that exists in a build.
- **Screens:** B6 captions the layer `HEAT LAYER · READS PER MILE DRIVEN`.
- **Problem:** the caption names a RATE, and a rate needs both of its numbers
  taken over the same stretch of road. The only odometer on the device belongs
  to the open trip and `startTrip()` resets it to zero at the top of every
  drive -- and nothing in the product opens a trip
  (`docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner`). Two failures came out
  of that: with no trip the layer had NO denominator and drew nothing at all,
  for ever; and with a trip it divided a numerator taken from the whole retained
  history (`readCounts` over every entry the slice holds -- capped at
  `DEFAULT_MAX_HISTORY_ENTRIES`, refilled from IndexedDB across sessions and
  days) by ONE drive's miles. That second one is not a rate, it is two
  measurements of different things divided by each other, and because the bands
  are absolute it pins any cell holding a camera with lifetime reads to HEAVY
  inside the first mile of every drive.
- **Stand-in:** the layer has a named SCOPE and the caption states which one.
  - `trip` -- a trip is open and its odometer has moved. Numerator is
    `readCounts(entries, {fromMs: trip.startedAtMs, toMs: trip.endedAtMs})`,
    the reads that happened inside that drive; denominator is that drive's
    miles. Caption is B6's own string, verbatim, and the bands are the per-mile
    cut points. This is exactly the panel as drawn.
  - `recorded` -- no trip, or the odometer is still zero. The layer counts the
    passes it retains at each cell and the caption reads
    `HEAT LAYER · READS RECORDED`, because printing a denominator over a number
    nobody divided is the same lie in words that a fake blob is in pixels.
    Bands are the count cut points.
  `ZoneCamera` carries the two counts separately (`reads` / `tripReads`) so the
  two windows cannot be mixed by accident, and `heatCells()` picks one.
- **Cost if wrong:** `heatScope()`, `heatCaption()` and one branch in
  `heatCells()`. If a trip owner lands, `recorded` becomes the state a device
  is in before its first drive and nothing else changes.
- **What would close it properly:** option (1) in
  `docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner` -- open a trip from the
  driving loop. Then the drawn caption is the normal case.

## zone-coverage-is-tested-at-the-centre-tile-only

- **Status:** STANDING IN (audit round 2)
- **Need:** "has this device looked at this disc?", answered about the disc.
- **Problem:** the check was `useCachedTileCount() > 0` -- a GLOBAL count of
  every tile the device holds. One drive through another city on another day
  makes it non-zero for ever, after which every zone on earth reads as looked
  at: a disc nobody fetched fell through to `NO CAMERAS IN THIS ZONE`, `stats`
  became `{total: 0, ...}`, and the card printed a confident `0` hero over
  `0 license plate readers within 2 miles.` with `SHARE CARD` ENABLED to hand
  that claim to somebody who does not have the app. `zone.ts`'s own header says
  an unfilled cache "does not report zero cameras, because 'we have not looked'
  and 'there are none' are different statements" -- the check did not enforce
  it, and the string `NO CAMERAS CACHED FOR THIS ZONE` read as zone-scoped
  while testing a global counter.
- **Stand-in:** `zoneTilesCached(refs, centre)` asks whether the cache holds the
  tile the ZONE CENTRE falls in, using the engine's own `latLonToTile` at
  whichever zooms the cache happens to hold. It gates the heat layer AND
  `stats`, so an unlooked-at zone prints em dashes and both keys stay disabled.
- **Known limit, filed rather than hidden:** it answers for the CENTRE, not for
  the rim. A 2 mi disc is wider than a tile at the zoom the app works at
  (`test/fixtures/tiles.ts` documents z16, ~474 m), so a zone whose centre tile
  is cached can still have unfetched edges and a rim camera can be missing from
  a count that does not say so.
- **What would close it properly:** `@fwm/core` gaining a destination-point or a
  `tilesCoveringRadius(lat, lon, z, radiusMi)`, so the disc's whole tile
  footprint can be required. Bounding a disc in tiles is geodesy and `zone.ts`
  does none of its own, on purpose.

## the-csv-id-set-still-describes-an-area

- **Status:** PARTLY FIXED, REMAINDER DISCLOSED (audit round 2)
- **Problem:** `what-the-csv-may-contain` refuses coordinates, bearings and
  distances, and the export still carried two location signals.
  1. **ROW ORDER.** `camerasInZone()` returns NEAREST FIRST and the rows were
     written in that order, so line number was an ordinal distance ranking from
     the driver's fix -- the `no distance` rule defeated by the shape of the
     file rather than by any column in it.
  2. **THE ID SET.** A `camera_id` is a key into a public dataset that carries a
     position, so a set of ids all drawn from one 2 mi disc describes the area
     that disc covers.
- **Fixed:** (1). `sortForExport()` writes rows in `camera_id` order, always,
  whatever order the zone hands over. `zoneCsv.test.ts` asserts the written
  order is NOT the nearest-first order, on a fixture where the two disagree.
- **Not fixable here:** (2), not while the file is a reviewable list of the
  cameras in a zone, which is what an audit export IS. Hashing the ids would
  remove the inference and also remove the only reason to export the file --
  nobody can check a row against the public record.
- **What changed instead:** the promise. `ZONE_NOTICES['csv-exported']` said
  `CSV EXPORTED · NO PLATE, NO LOCATION`, which is a guarantee the file cannot
  keep. It now reads
  `CSV EXPORTED · CAMERA IDS ONLY, NO PLATE, NO COORDINATES` -- what is in it,
  so the driver can decide who gets it -- and `zoneCsv.ts`'s header states the
  residual disclosure in a section of its own instead of implying there is
  none.

## the-press-notice-is-an-element-b6-does-not-draw

- **Status:** STANDING IN (audit round 2)
- **Screens:** B6 draws no feedback of any kind after either key.
- **Problem:** the outcome of a press has to be sayable -- a share sheet the
  platform refuses, a CSV that went somewhere -- but the notice row was
  conditional, so it APPEARED between the card and the footer keys on the first
  press and shoved both keys down. An element the panel does not draw is one
  departure; an element that moves the panel's drawn rhythm the moment a driver
  touches it is a worse one.
- **Stand-in:** the row is always rendered and holds its line box
  (`min-height`, derived from the type token), empty until there is something
  to say. Nothing below it moves, ever. It is a `role="status"` live region, so
  the outcome is announced as well as drawn -- the result of a press a driver
  cannot look at is the one they most need told.
- **Cost if wrong:** one element in `ZoneAuditView`, one rule in the stylesheet.

## the-disabled-key-was-not-drawn-at-all

- **Status:** FIXED (audit round 2)
- **Screens:** B6's first footer key is FILLED in the in-range hue; the second
  is outlined.
- **Problem:** `.fwm-zone-action:disabled { background: transparent }` applied
  to both keys, so whenever `stats` was null -- no fix, or an uncached zone --
  the primary key lost its fill entirely and B6's filled block rendered as two
  words on the page ground. The panel's most prominent control was undrawn in
  exactly the state a driver is most likely to meet first.
- **Fixed:** the disabled key keeps its block in `var(--fwm-surface-2)`, the
  neutral surface `B2 · DEAD DROP` already uses for the same state
  (`dead-drop.css` `.fwm-dead-drop-action:disabled`), so the two screens agree
  and the key still reads as inert. Asserted against the stylesheet in
  `components/ZoneAuditView.test.tsx`.

## screens-are-registered-but-take-no-props

- **Status:** CLOSED for the registration half (audit round 2)
- **History:** the audit filed both screens as unregistered -- `main.tsx` is a
  shared file this feature may not edit, and its `ScreenRegistry` held only
  `radar` and `onboarding`, so LOG's `openScreen('zone-audit')` /
  `openScreen('heat-map')` keys landed on the "screen not built" placeholder.
  That was true when filed and is not true now: `apps/pwa/src/main.tsx` imports
  both from `features/zone-audit/index.ts` (line 46) and registers
  `'zone-audit'` and `'heat-map'` (lines 89-90). The build note's word
  "registered" was ahead of the code and is now behind it.
- **Still open:** the registry entries are the components themselves, so both
  render with NO props. That is what makes `onExportCsv`, `origin` and `place`
  unreachable in the running app -- see `export-csv-has-no-sink-on-this-device`,
  `no-configured-origin-so-the-card-carries-no-domain` and
  `card-place-name-needs-a-geocoder`. Each is one argument at this one site the
  moment the thing it needs exists.

## heat-map-is-b6s-layer-with-no-panel-of-its-own

- **Status:** STANDING IN
- **Screens:** `05 · LOG - EXPOSURE` draws a `HEAT MAP` key beside `ZONE AUDIT`,
  and `screenState.ts` reserves the `heat-map` id, but no design file draws a
  HEAT MAP screen. (`DESIGN-GAPS.md#no-heat-map-screen-exists`.)
- **Stand-in:** `HeatMapScreen` is B6's heat layer at full height with B6's own
  header shape, B6's radius readout and B6's legend, and nothing else -- no
  share card, no export, no control B6 does not draw. Every string on it is a
  string B6 draws, except the title `HEAT MAP`, which is the exact label of the
  key that navigates to it.
