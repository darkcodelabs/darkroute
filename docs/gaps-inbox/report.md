# gap inbox -- REPORT (the sheet)

> **STALENESS WARNING, added 2026-08-30.** Two things here are stale: the drawn sheet, and a file
> path that no longer exists.
>
> `apps/pwa/src/app/registry.v1.tsx:107` maps `report: ReportV1Screen` and
> `:138` substitutes it as the overlay; v1 is the default
> (`apps/pwa/src/app/design.ts:61`).
> `features/report/ReportV1Screen.tsx:11` renders
> `<ReportScreen view={ReportViewV1} />` - the v0 CONTAINER, unedited. So
> `reportDraft.ts`, `facing.ts` and `reportQueue.ts` entries still bind; the
> drawn ones describe `components/ReportView.tsx`, not the shipped
> `components/ReportViewV1.tsx` and `components/FacingDialV1.tsx`.
>
> `components/dock/ReportBar.tsx` DOES NOT EXIST. It was renamed to
> `components/dock/ReportKey.tsx` when v2 folded the standalone bar into the
> dock - recorded at `dock-v2.md:321-322`. Lines 50, 435 and 445 below all
> point at the deleted file, and line 435's `ReportBar.tsx:126` citation cannot
> be checked against anything.
>
> Under v1 the dock has no REPORT bar at all: REPORT is a circle beside a
> five-key pill (`apps/pwa/src/components/dock/DockV1.tsx:66-76`,
> `:189`).
>
> Read instead: `features/report/components/ReportViewV1.tsx`,
> `components/dock/ReportKey.tsx`, `docs/STALENESS.md`.

Files: `apps/pwa/src/features/report/**` (`ReportScreen.tsx`, `components/*.tsx`,
`report.css`, `reportDraft.ts`, `facing.ts`, `reportQueue.ts`).

Sources read: `Flockys App Screens.dc.html` -- panel
`06 · REPORT - SHEET FROM ANY SCREEN` (lines 407-464) and the
`DOCK - REPLACES THE ICON ROW` spec below it; `Flockys Screens II.dc.html` --
`A1 · ONBOARDING` ("Coordinates never leave the phone unless you file a
report", "Compass auto-fills which way a camera faces when you report one"),
`A2 · OFFLINE` ("reporting - queues locally"), `A4 · INTEL CARD`
(`CONFIRM STILL THERE`), `A6 · CONTRIBUTION BOARD`, `B2 · DEAD DROP`
("Reports are signed the moment you file them and held until you're on WiFi");
`Flockys Design System.dc.html` -- section 08 tokens and the `Report camera`
button primitive.

Everything the sheet draws is a literal read from that panel: the 52px header,
`REPORT CAMERA`, `✕`, `NEW CAMERA` / `CONFIRM EXISTING`, `POSITION · AUTO`,
`39.0997 N · 84.5786 W`, `±4 M · 9 SATS · Reading Rd`, `FACING · FROM COMPASS`,
`SW`, `223° · covering the northbound lane`, `TAP ARC TO ADJUST`, `PHOTO`,
`MAKE / MODEL`, `POLE MOUNT` `SOLAR` `TRAILER` `UNSURE`,
`2 REPORTS QUEUED · SYNC ON WIFI`, `SUBMIT REPORT` and
`HOLD REPORT BUTTON 1s TO ONE-TAP DROP A PIN`.

The 52px REPORT *bar* is `components/dock/ReportBar.tsx` and was not touched.

## Cross-references, not new entries

The decision is already filed; REPORT is another instance of it.

- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- REPORT's sites: the compass
  cardinals (9px), the section labels (10px), the mode keys (11px), the queue
  line (10px) and the hold hint (10px). All render at `var(--fwm-text-micro)`
  (11px).
- `DESIGN-GAPS.md#report-bar-tint-and-alert-tints` -- the facing wedge is drawn
  `rgba(255,45,94,.35)`. The token set exports no alpha ramp, so the wedge is
  `fill: var(--fwm-alert-in-range)` with `opacity: .35`: the hue stays a token
  and follows a mode swap, and the transparency is not a colour.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- the queue line at
  zero draws nothing, matching the REPORT bar's own `0 QUEUED` rule.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- the 1px
  hairline and the 2px camera-glyph outline, derived from `--fwm-space-1` (`/4`,
  `/2`) as component-scoped locals, exactly as `radar.css` does it.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.1em`,
  `.08em`, `.12em`, `.14em` and `.18em` on this sheet, expressed as
  `calc(var(--fwm-text-*) * n)`.
- `docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30` -- the
  body's rendered `gap:14px` and the card's `padding:14px 16px` take the nearest
  step below (12px).
- `docs/gaps-inbox/radar-screen.md#sat-count-unavailable-on-the-web` -- the panel
  renders `9 SATS` beside `±4 M`. A browser `GeolocationPosition` has no
  satellite count, so on the web the line is just `±4 M`. Both strings come from
  RADAR's `formatSatellites`, called once per fact.
- `docs/gaps-inbox/platform-adapters.md#photo-exif-is-not-stripped` -- the whole
  reason `PHOTO` ships disabled. See `photo-refusal-copy-is-authored` below for
  the half that is new.

## confirm-existing-is-never-drawn

- need: what the sheet shows when `CONFIRM EXISTING` is the pressed half.
- source: the panel draws the toggle and then draws exactly one state behind it
  -- `NEW CAMERA`. No screen in any of the four files renders the sheet in
  confirm mode. `A4 · INTEL CARD` has a `CONFIRM STILL THERE` button, which is
  the same act reached from a different surface, and it names one camera.
- decision: confirm mode keeps the same form and changes its SUBJECT. The
  subject is `useNearestCamera()` -- the engine's nearest camera, muted or not
  -- because `screenState.Overlay` is deliberately payload-free and cannot
  carry "which camera" into a sheet. The camera's id is rendered in the third
  segment of the instrument line, which is the slot the panel gives to
  `Reading Rd`; the facing arc is seeded from the camera's `directionDeg`
  instead of the compass; `SUBMIT REPORT` keeps its drawn label.
- consequence: with nothing nearby, confirm mode blocks the submit and says
  `NO KNOWN CAMERA NEARBY TO CONFIRM` rather than filing against a guess.
- options: (1) keep the nearest-camera subject; (2) let SWEEP / the intel card
  open the sheet with a camera id, which needs an overlay that can carry a
  payload -- and the payload-free rule exists to keep plates out of the URL, so
  it would need a second, non-URL channel; (3) draw a camera picker inside the
  sheet, which is a new screen nobody designed.

## confirmations-go-into-the-signed-chain-not-pending-actions

- need: which queue a `CONFIRM EXISTING` submission belongs in.
- source: `services/db/schema.ts` says `PendingActionKind = 'confirm_camera' |
  'dispute_camera' | 'claim_handle'` are "cheap, idempotent and replayable,
  which is why they retry. Reports are not in here: a report is signed evidence
  and lives in `pendingReports`." The sheet's own button says `SUBMIT REPORT`
  for both halves of the toggle, and its queue line counts REPORTS.
- decision: both halves file a signed, chained report. A confirmation from this
  sheet carries a position, a timestamp, a facing and a mount -- it is an
  observation, not a tap-to-acknowledge -- and the line the sheet renders
  (`2 REPORTS QUEUED`) is the report count.
- consequence: `pendingActions` stays for the one-tap `CONFIRM STILL THERE` on
  the intel card, if that lands as a bare acknowledgement.
- options: (1) as built; (2) file confirmations as pending actions and change
  the sheet's queue line to the combined total; (3) file both, which would
  double-count.

## facing-label-has-one-drawn-provenance

- need: what the `FACING · …` label says when the bearing did not come from a
  compass.
- source: the panel draws `FACING · FROM COMPASS`, once. `A1` promises "Compass
  auto-fills which way a camera faces when you report one" and lists motion
  sensors as OPTIONAL, so the no-compass case is a designed-for case with no
  drawn label.
- decision: three authored labels in the panel's own `LABEL · SOURCE` idiom --
  `FACING · ON RECORD` (confirm mode, bearing from the camera record),
  `FACING · SET BY HAND` (the driver tapped the arc), `FACING · NO COMPASS`
  (nothing supplied one; the readout shows the em dash and no wedge is drawn).
- consequence: the sheet never claims a compass reading it does not have.
- LANDMINE, found in review and fixed: this promise is only kept if the draft is
  RE-SEEDED whenever it is reset. The seeding effect keys on the bearing VALUE,
  so it does not fire again while the heading holds still; resetting the draft
  after a successful submit therefore left `facingSource: 'none'` with a live
  compass, and the sheet read `FACING · NO COMPASS` while the compass was
  reading -- the exact inversion of this decision -- and signed the NEXT report
  with `facing_deg: null`. Worst for the stationary driver parked beside the
  camera, whose heading is precisely the one that never changes. Any future
  code that calls `emptyDraft()` outside the initial mount must pass the result
  through `seedFacing()` with the current seed, as `ReportScreen.submit` does.
- options: (1) keep the four labels; (2) draw the label once as
  `FACING` and put the provenance somewhere else; (3) hide the section when
  there is no bearing -- rejected, the arc is how you set one.

## lane-sentence-derived-from-one-example

- need: the rule behind `223° · covering the northbound lane`.
- source: one instance, on this panel. Nothing states how the sentence is
  computed.
- decision: a camera reads the traffic coming at it, so the lane runs along the
  RECIPROCAL of the lens bearing, named on a FOUR-point compass:
  223 + 180 = 43, and 43 rounds to north below 45. That reproduces the drawn
  string exactly. Four points and not eight because "northeastbound lane" is
  not a phrase.
- consequence: a bearing near a 45 degree boundary flips between two words with
  a small nudge of the arc.
- options: (1) keep the four-point rule; (2) eight points and accept
  "northeastbound"; (3) drop the sentence and render the degrees alone.

## wedge-start-angle-vs-readout

- need: whether the drawn wedge is centred on the readout.
- source: the panel paints `conic-gradient(from 200deg, … 0 60deg)` -- a wedge
  spanning 200-260 degrees, so centred on 230 -- beside a readout of 223.
- decision: centre the wedge ON the bearing (193-253 for 223). It is the only
  reading under which the picture and the number cannot disagree, and the 60
  degree span matches the facing arc SWEEP already draws.
- consequence: the rendered wedge sits 7 degrees off the reference image. This
  is a real, measurable divergence from the panel and no summary of this screen
  should call the dial a pixel-for-pixel transcription.
- STILL OPEN, AND HELD, after review. The panel is internally inconsistent:
  `from 200deg` and a readout of `223°` cannot both be honoured by one arc. The
  panel is a static mock with a hand-placed gradient at one frozen bearing; the
  shipped dial is a CONTROL whose bearing the driver moves. Reproducing the
  offset means applying a constant -7 degree fudge to every bearing, so the arc
  would disagree with the number at 223 and at every other value too -- which
  turns a one-frame mock discrepancy into a permanent one, on the field that is
  signed into the evidence. There is no choice here that matches the panel at
  more than a single bearing. Centring is pinned by `facing.test.ts` ("is a 60
  degree slice centred on the bearing, so arc and readout agree").
- options: (1) centre on the bearing; (2) reproduce the 7 degree offset, which
  would have to be explained to anyone who measures it; (3) treat 200 as a
  leading edge, which puts the wedge 30 degrees off the readout; (4) ask the
  designer which of the panel's own two numbers is authoritative -- the only
  route to a dial that is both correct and faithful.

## arc-adjust-is-touch-only-in-the-design

- need: how the arc is adjusted without a touchscreen.
- source: `TAP ARC TO ADJUST`, and nothing else.
- decision: the dial is a tap target AND an ARIA slider -- arrow keys step one
  degree, PageUp/PageDown fifteen -- the same accommodation `SweepDial` makes
  for camera dots. A tap the geometry cannot read (nothing laid out, or dead
  centre) leaves the bearing untouched rather than snapping to north.
- consequence: one keyboard affordance the design does not draw; no visual
  difference.
- options: (1) keep it; (2) add a visible stepper, which the panel does not
  have; (3) touch only, which makes the field unusable from a keyboard.

## no-street-name-without-a-reverse-geocode

- need: where `Reading Rd` in `±4 M · 9 SATS · Reading Rd` comes from.
- source: the panel renders a street name in the instrument line. Nothing in
  the product ever fetches one, and a reverse geocode is a network request keyed
  to the driver's exact position -- the one request this product refuses to
  make.
- decision: the segment is dropped in new-camera mode. Confirm mode puts the
  camera id in the slot, which is the same "which place is this" answer from
  data already on the device.
- READ THIS AS A SUBSTITUTION, NOT A SUBTRACTION. Confirm mode does not leave
  the slot empty -- it renders an element the design does not draw, in a
  position the design gives to a street name: `±4 M · FWM-0442` where the panel
  reads `±4 M · 9 SATS · Reading Rd`. Anyone summarising this screen must say
  "the street name is replaced by the camera id in confirm mode", never "the
  street name was not built", which describes only the new-camera half. The
  substitution is pinned by `reportDraft.test.ts` ("SUBSTITUTES the camera id
  into the street-name slot") and asserted end to end at
  `ReportScreen.test.tsx` / `ReportView.test.tsx`. The subject decision itself
  is `confirm-existing-is-never-drawn` above.
- consequence: the instrument line reads `±4 M` on a browser filing a new
  camera, and `±4 M · FWM-0442` when confirming one, against
  `±4 M · 9 SATS · Reading Rd` in the reference.
- options: (1) leave it out; (2) ship an offline street index in the tile cache
  and name the street locally; (3) reverse geocode -- which breaks the promise.

## photo-refusal-copy-is-authored

**The premise is superseded. The entry stands because the copy is still
authored and `DetailTiles.tsx` still cites this anchor.**

- was: `platform-adapters.md#photo-exif-is-not-stripped` option 3 -- "refuse
  photo attachment entirely until one of the above ships" -- plus the fact that
  `services/db/schema.ts` had no photo store, so a captured photo had nowhere to
  live. The line read
  `PHOTO OFF · A PHOTO'S LOCATION TAG CANNOT BE STRIPPED YET`.
- what changed: `features/report/preparePhoto.ts` re-encodes through a canvas,
  which drops the EXIF and is proven in a real browser by
  `e2e/preparePhoto.spec.ts`; `reportPhotos` is a real store with a migration;
  and `ReportViewV1` -- the sheet the build actually routes to -- attaches one
  photograph, signs its SHA-256 into the payload's `photo` field and holds the
  bytes locally. Both halves of the old premise are gone.
- need: what v0's `DetailTiles` PHOTO tile says now that it is dark for a
  different reason.
- decision: the tile stays drawn and disabled, and the micro line reads
  `PHOTO OFF · A PHOTO IS ADDED WHILE YOU FILE A REPORT`. `DetailTiles` is v0's
  layout and `app/registry.v1.tsx` routes the report screen to `ReportViewV1`,
  so nothing is wired behind this tile and pressing it would do nothing. The
  note points at where the control actually is rather than restating a refusal
  that no longer exists. `IntelPhoto` imports the same string, so both screens
  changed together.
- consequence: one authored sentence, on two screens, and a control that is
  visible and inert instead of missing.
- options: (1) as built; (2) wire v0's tile to the same attach path, which means
  maintaining two photo affordances for a view the build does not ship;
  (3) delete the tile, which loses the pointer to where photos are attached.

## make-model-opens-an-undrawn-field

- need: what `MAKE / MODEL` opens.
- source: the panel draws the tile and never the thing behind it.
- decision: the tile discloses one text input, in the tile's own idiom (same
  height, edge and radius). `aria-expanded` says whether it is open, and it
  starts open whenever the draft already holds a value.
- consequence: one control the design does not draw, and the stack is taller
  than the reference when it is open -- which is why the body scrolls.
- options: (1) the disclosed field; (2) a picker of known makes, which needs a
  list nobody has; (3) leave the tile inert, which makes it a dead control.

## make-model-plate-guard-false-positives

- need: whether the one free-text field on the sheet is plate-guarded.
- source: no design file says. `stores/persist.ts` exports `assertPersistSafe`
  "so a future writer (an export path, a share payload) can reuse the same
  judgement instead of writing a second, weaker one", and the whole product is
  built on plates never leaving the device.
- decision: `looksLikePlate` gates the field. A plate-shaped value blocks the
  submit and marks the input, rather than being silently dropped -- a value
  quietly discarded is one the driver thinks they filed.
- consequence: KNOWN AND ACCEPTED false positives. `looksLikePlate` is five to
  eight mixed alphanumerics, so a real model name with a number in it
  ("Falcon 2") is refused and has to be rephrased. `assertPersistSafe` is NOT
  run over the whole payload, because a camera id ("FWM-0442") is plate-shaped
  by construction and the walker's exemption for those is positional, keyed to
  field names that do not exist in a report payload.
- options: (1) as built; (2) a report-specific exemption for `camera_id` so the
  whole payload can be walked; (3) no guard, and accept that a driver can type
  a plate into a submission bound for a community server.

## queue-line-plural-and-tail-derived

- need: the queue line at one report, and when wifi-only sync is off.
- source: `2 REPORTS QUEUED · SYNC ON WIFI`, drawn once, plural, with the tail
  that matches `DEFAULT_SETTINGS.wifiOnlySync === true`.
- decision: `1 REPORT QUEUED · SYNC ON WIFI` for the singular, and
  `… · SYNC WHEN ONLINE` when the driver has turned wifi-only off. At zero the
  line is not drawn at all.
- consequence: two strings the design does not contain, both statements about
  the queue's real policy.
- options: (1) as built; (2) keep the drawn string verbatim in both cases and
  let it lie when wifi-only is off; (3) drop the tail entirely.

## no-blocked-or-failed-state-is-drawn

- need: what the sheet shows when the report cannot be filed, and when filing
  fails.
- source: the panel draws one state of the button and one state of the queue
  line. Nothing draws "no fix", "nothing to confirm", "signing unavailable" or
  "storage unavailable", all of which are reachable.
- decision: the queue line is the single status slot, in priority order --
  failure, then blocker, then count. Blocked reads
  `NO POSITION FIX · A REPORT NEEDS ONE`, `NO KNOWN CAMERA NEARBY TO CONFIRM`,
  `MAKE / MODEL LOOKS LIKE A PLATE · NOT QUEUED`; failures read
  `THIS DEVICE CANNOT SIGN A REPORT · NOT QUEUED`,
  `NO LOCAL STORAGE · NOTHING CAN BE QUEUED HERE`,
  `QUEUE MOVED WHILE FILING · TRY AGAIN`, `REPORT NOT QUEUED · TRY AGAIN`. The
  button takes the system's disabled vocabulary (`--fwm-surface-2` on
  `--fwm-text-disabled`). Failure text is chosen by the error's TYPE and never
  interpolates the thrown message, which could quote a payload field.
- consequence: seven authored strings, all in the sheet's existing idiom.
- options: (1) as built; (2) a separate error surface, which is a new component;
  (3) leave the button live and fail silently -- rejected outright.

## submit-has-no-drawn-confirmation

- need: what happens on screen after `SUBMIT REPORT` succeeds.
- source: nothing. The panel draws the sheet before the press, and the dock spec
  gives the BAR a confirmation (`PIN DROPPED`) but says nothing about the sheet.
- decision: the queue line is the receipt. It is the live region
  (`role="status"`), the count it shows is re-read from IndexedDB after the
  write rather than incremented in memory, and the draft resets so the next
  report is not a copy of the last. The sheet stays open.
- consequence: no new copy, and a receipt that is a measured fact.
- THE REGION IS NEVER HIDDEN AND NEVER UNMOUNTED. It shipped first with
  `display:none` at the empty tone, which is the state on an empty queue: a live
  region that transitions OUT of `display:none` is announced unreliably across
  assistive technology, so the very first `1 REPORT QUEUED` -- the ONLY feedback
  a non-visual user gets that the submit worked -- could be silent. Fixed by
  hiding it through being EMPTY instead: `SubmitBlock` renders the `<p>` on
  every state with its children dropped, and `report.css` zeroes only the bottom
  margin at that tone. An empty flex container has no line box and no height, so
  the drawn result is identical and the region stays in the accessibility tree
  from first paint. Pinned by `ReportView.test.tsx` ("keeps the receipt live
  region mounted and unhidden while it is empty"), which reads the rule off disk
  and fails on `display:none`, `visibility:hidden` or `content-visibility`.
- options: (1) as built; (2) close the sheet on success, which hides the receipt
  the moment it appears; (3) a `REPORT QUEUED` dwell on the button, mirroring
  the bar's `PIN DROPPED`.

## close-target-is-below-the-touch-floor

- need: the `✕` box's height.
- source: drawn `width:44px; height:36px`. The system's own touch floor is
  `--fwm-touch-min: 44px`, and section 06 states it.
- decision: 44x44. This is a control pressed in a moving car.
- consequence: the header's right-hand box is 8px taller than the reference.
- options: (1) hold the floor; (2) reproduce 36px and break the product's own
  rule; (3) 36px visual box with a padded 44px hit area, which needs a
  hit-slop idiom the codebase does not have yet.

## chips-are-below-the-touch-floor

- need: the mount pills' height.
- source: drawn `padding:9px 13px` at 12px type, which lands around 34px tall.
- decision: `min-height: var(--fwm-touch-min)` with the drawn horizontal
  padding, the same accommodation `ask.css` makes for the wake-word chip.
- consequence: taller pills than the reference; the row still wraps.
- options: (1) hold the floor; (2) reproduce 34px; (3) a chip-specific touch
  token.

## tile-and-button-heights-have-no-token

- need: tokens for the 56px tiles and the 56px submit button, and the 46px
  toggle halves.
- source: the panel renders 56px twice and 46px twice. Section 08 exports
  `--fwm-touch-min: 44px`, `--fwm-header-h: 52px` and `--fwm-nav-h: 64px`, and
  nothing between.
- stand-in: `calc(var(--fwm-touch-min) + var(--fwm-space-3))` = 56px for the
  tiles and the button, and `var(--fwm-touch-min)` for the 46px halves. Derived
  from the touch floor on purpose, so the `dash` surface (68px floor) scales
  them instead of leaving 56px controls on a head unit.
- options: (1) keep the derivation; (2) add `--fwm-control-h: 56px`; (3) retune
  the button primitive in section 08, which already disagrees with this panel
  (48px there, 56px here).

## report-type-steps-missing

- need: type steps for 26px, 16px, 13px and 12px.
- source: the panel renders the facing cardinal at 26px/700, the submit label at
  16px/700, the tile labels and the `✕` at 13px, and the chips at 12px. The type
  scale carries 24px (`--fwm-text-title`), 17px (`--fwm-text-subtitle`), 15px
  (`--fwm-text-body`) and 11px (`--fwm-text-micro`).
- stand-in: title for the cardinal, body for the submit label (which is also the
  step the design system's own `Report camera` button primitive uses), body for
  the tiles and the `✕`, micro for the chips.
- options: (1) accept the nearest steps; (2) extend the scale; (3) retune the
  panel to the scale.

## status-dot-size-has-no-token

- need: a 6px status dot.
- source: the queue line's dot renders 6px, the same dot RADAR's strips draw.
- stand-in: `calc(var(--fwm-space-1) * 1.5)`, the derivation `radar.css`
  already uses. Component-scoped local, not a new token.
- options: as `docs/gaps-inbox/radar-screen.md#status-dot-size-has-no-token`.

## unitless-ratios-have-no-token

- need: tokens for the two unitless ratios this sheet renders -- the wedge's
  `.35` alpha and the `1.7` / `1.5` line-heights the panel sets.
- source: `06 · REPORT` paints `rgba(255,45,94,.35)` and sets the facing readout
  at `line-height:1.7`; the other prose blocks render 1.5.
- caught by nobody: `scripts/check-design-values.mjs` matches values by UNIT,
  and a hex/`rgb()` grep matches colours. A bare `0.35` or `1.7` carries neither,
  so both tools miss it and `report.css` was able to claim "nothing here is a
  literal" while carrying five of them.
- stand-in: component-scoped locals on `.fwm-report`
  (`--fwm-report-wedge-alpha`, `--fwm-report-leading`,
  `--fwm-report-leading-readout`), the pattern `intel.css` already uses for
  `--fwm-intel-scrim-alpha`. Declared once, referenced by name everywhere else,
  NOT new tokens. Pinned by `ReportView.test.tsx` ("names its unitless ratios
  instead of hand-carrying them"), which fails on any `opacity` or `line-height`
  that is not a `var()`.
- STILL A LITERAL, deliberately: `font-weight: 400 / 600 / 700`. The token set
  carries no weight ramp either, and CSS itself names two of the three
  (400 = `normal`, 700 = `bold`), so they read as keywords rather than as a
  scale this repo owns. 600 does not, and is the one to revisit.
- NOT A REPORT PROBLEM. Eight other stylesheets carry raw unitless
  line-heights (`ask`, `dead-drop`, `log`, `offline`, `settings`, `sweep`,
  `triage`, `zone-audit`), and `sweep.css` and `zone-audit.css` carry raw
  opacities. Fixing it inside one feature only moves the hole.
- options: (1) as built, locals per feature; (2) add `--fwm-leading-*` and
  `--fwm-alpha-*` ramps to `apps/pwa/src/styles/tokens.css` and teach
  `scripts/check-design-values.mjs` to flag bare `opacity` / `line-height` /
  `font-weight` declarations, which is the only version that stops the next
  stylesheet doing the same thing; (3) leave them, and stop claiming otherwise.

## the-sheet-is-reachable-as-a-screen-but-never-as-a-sheet

- state, checked against the tree and not against memory: `main.tsx` registers
  `ReportScreen` TWICE -- in the screen registry under `report` (line 80) and in
  the overlay registry under `REPORT_OVERLAY.id` (line 100) -- and
  `components/dock/ReportBar.tsx:126` presses through to `openScreen('report')`.
  So the feature IS mounted and IS reachable in the running app. An audit
  finding that says otherwise predates that wiring.
- need: something that opens it AS A SHEET. The panel is titled "SHEET FROM ANY
  SCREEN" and the overlay registration exists for exactly that, but nothing
  outside this feature calls `openReportSheet()`: the dock bar NAVIGATES, which
  replaces the screen the driver was on instead of raising the sheet over it.
- consequence: reporting a camera from RADAR loses RADAR. The one drawn
  behaviour of the overlay form -- file without leaving what you were watching
  -- is the one nothing triggers.
- not fixable from inside this feature: `ReportBar.tsx` is the dock's, and
  `openReportSheet()` is already exported and already correct.
- options: (1) point `ReportBar`'s press at `openReportSheet()` and keep
  `openScreen('report')` for the deep link, which is what the panel draws;
  (2) leave it navigating, and drop "SHEET FROM ANY SCREEN" from the copy;
  (3) let the bar choose by context -- sheet over a dock screen, navigate from
  a deep link -- which needs a rule nobody has written.

## nothing-drains-this-queue-yet

- decided, and worth confirming: the sheet writes a signed, chained, held
  report and there is no sync service anywhere in the app to send it. The queue
  line says `SYNC ON WIFI`, which is the queue's policy, not a promise this
  build keeps.
- need: whoever builds the sync path must read `services/db/repositories/
  reportChain.ts` (`due()`, `markSyncing()`, `markFailed()` with backoff and
  dead-lettering) rather than inventing a second retry model, and must treat a
  photo whose `metadataStripped` is false as unsendable.
- consequence: `DEAD DROP` (B2) is where a driver would see the queue standing
  still. It is not built either.
