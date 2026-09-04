# gap inbox -- INTEL CARD

> **STALENESS WARNING, added 2026-08-30.** The drawn card here is v0's, and the sentence "MODAL
> FROM SWEEP" in the source line above names a screen that no longer exists.
>
> `apps/pwa/src/app/registry.v1.tsx:104` maps `intel: IntelV1Screen` and `:139`
> substitutes it as the OVERLAY too; v1 is the default
> (`apps/pwa/src/app/design.ts:61`). `features/intel/IntelV1Screen.tsx:11`
> renders `<IntelScreen view={IntelViewV1} />` - the v0 CONTAINER, unedited,
> with a v1 view. So `intelState.ts` / `intelActions.ts` entries still bind;
> the drawn ones describe `components/IntelView.tsx`, not the shipped
> `components/IntelViewV1.tsx`.
>
> There is no SWEEP to be a modal from. SWEEP merged into RADAR on 2026-08-20
> (`apps/pwa/src/app/screenState.ts:157-159`), so the dot that raises this card
> is on RADAR's dial in v0 and on DRIVE's map in v1.
>
> Read instead: `features/intel/components/IntelViewV1.tsx`,
> `radar-sweep-merge.md`, `docs/STALENESS.md`.

Files: `apps/pwa/src/features/intel/**` (`IntelScreen.tsx`, `components/*.tsx`,
`intel.css`, `intelState.ts`, `intelActions.ts`).

Sources read: `Flockys Screens II.dc.html` -- `A4 · INTEL CARD - MODAL FROM
SWEEP` (lines 190-234) and `B9 · RECORD FLAGS - WHERE IT SURFACES` (lines
743-782); `Flockys App Screens.dc.html` -- `02 · SWEEP`'s bottom card (lines
156-163, the same camera drawn shorter) and `B4 · ALERT TRIAGE`'s owner
vocabulary; `Flockys Design System.dc.html` -- the `CARD · LIST ROW` block
(lines 379-386, the same camera again).

Every string, size and order the card draws is a literal read from those: the
44x4 grabber, `FALCON`, `425 FT · SW`, `FWM-0442 · READING & TENNESSEE`,
`OWNER` / `MOUNT` / `FACING` over `HOA` / `SOLAR POLE` / `223°`, the five fact
rows, `DROP PHOTO OF CAMERA`, `CONFIRM STILL THERE`, `DISPUTE`,
`MUTE THIS ONE`, `SHARE`, and B9's `OPERATOR HAS A RECORD` /
`SEE THE 3 SOURCES`.

WHAT THE SHIPPED CARD ACTUALLY PUTS IN THEM IS NOT ALL OF THAT, and the entries
below are the difference. In particular this build never draws `FALCON`,
`READING & TENNESSEE`, `SOLAR POLE`, `CROSS-REFERENCED`, `YES · 412 AGENCIES`
or `MAR 2026` -- four of those render an em dash and the other two are replaced
by the promoted camera id plus an authored note. The layout is the panel's; six
of its twelve values are not.

## Cross-references, not new entries

The decision is already filed; the intel card is another instance of it.

- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- this card's sites: the tile
  labels (9px), the fact rows (11.5px), the photo label (10px), the secondary
  action keys (12px) and B9's label and sources link (10px). All render at
  `var(--fwm-text-micro)` (11px).
- `DESIGN-GAPS.md#token-set-does-not-cover-rendered-hero-sizes` -- the 22px
  title renders at `--fwm-text-title` (24px) and the 13px mono readout and the
  13px primary keys render at `--fwm-text-body` (15px). The scale steps
  15 -> 11 with nothing between.
- `DESIGN-GAPS.md#report-bar-tint-and-alert-tints` -- B9's banner fill
  `rgba(255,90,31,.07)` is one of the eight tints that entry lists. Stand-in:
  `var(--fwm-surface-1)` with the hue carried by the 1px border. The A4 scrim
  `rgba(0,0,0,.72)` is a ninth site and is handled differently -- see
  `scrim-alpha-carried-as-opacity` below.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- the
  1px hairline, derived from `--fwm-space-1` (`/4`) as a component-scoped
  local, exactly as `radar.css` and `sweep.css` do it.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.06em`,
  `.08em`, `.1em`, `.12em`, `.14em`, `.16em` and `.18em` on this card,
  expressed as `calc(var(--fwm-text-*) * n)`.
- `docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30` -- the
  rendered `margin-top:10px` (four sites), `padding:14px 16px` (two sites),
  `margin-bottom:18px` (the grabber) and `margin-top:5px` (tile values). Each
  takes the nearest step.
- `docs/gaps-inbox/platform-adapters.md#photo-exif-is-not-stripped` -- the
  `DROP PHOTO OF CAMERA` tile is drawn, disabled, and carries the reason. Same
  decision the REPORT sheet's `PHOTO` tile made (option 3).
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- see
  `no-camera-selected-state-not-drawn` below.

---

## camerarecord-carries-six-of-the-cards-twelve-fields

- need: a camera record shape that can fill the card the design draws.
- screen: `A4 · INTEL CARD`, every field; `02 · SWEEP`'s bottom card draws the
  same ones shorter, and `CARD · LIST ROW` in the design system a third time.
- source: `services/db/schema.ts` defines `CameraRecord` as `id`, `lat`, `lon`,
  `directionDeg`, `ownerType?`, `confirmations?`, `updatedAt?`. A4 draws TWELVE
  values. SIX have a source:
  - the id -> `id`
  - the readout (`425 FT · SW`) -> the engine's `CameraAssessment`
  - `OWNER` -> `ownerType`
  - `FACING` -> `directionDeg`
  - `CONFIRMED BY` -> `confirmations`
  - `YOUR READS` -> this device's own alert log
  and SIX have none: the hardware name the title reads (`FALCON`), the cross
  street (`READING & TENNESSEE`), `MOUNT`, `EFF ATLAS`,
  `INTER-AGENCY SHARING` and `FIRST REPORTED`.
- note: the fuller record already exists as `FixtureCameraRecord` in
  `src/test/fixtures/cameras.ts` -- "the fuller record the API is expected to
  serve" -- carrying `manufacturer`, `effAtlasId`, `sharingFlags`,
  `confirmedCount`, `disputedCount`, `source` and `label`. `toCameraRecord()`
  narrows all of it away before anything the app runs on can see it.
- stand-in: FOUR of the six unsourced values -- `MOUNT`, `EFF ATLAS`,
  `INTER-AGENCY SHARING`, `FIRST REPORTED` -- render `NO_VALUE` (an em dash)
  and are marked `data-fwm-intel-known="false"`. Rows are never dropped:
  silently hiding `INTER-AGENCY SHARING` reads as "this camera does not share",
  which is a claim rather than an absence, and it is the most consequential
  fact on the card.
  THE OTHER TWO DO NOT RENDER AN EM DASH. The hardware name and the cross
  street share a two-line identity block with the id, and the id is promoted
  into the title slot instead -- see `identity-line-copy-is-authored` below,
  which is the only place on this card the em-dash rule does not apply.
  Nothing imports the fixture into product code.
- colours: the panel's own tones for the three unfillable fact rows are
  recorded in `FACT_TONE` (`intelState.ts`) even though nothing can fill them
  today, so the rows come out green / alert-red the moment a source lands
  rather than defaulting to grey and having to be rediscovered.
- options:
  1. widen `CameraRecord` towards `FixtureCameraRecord` and have the tile API
     serve it -- the fixture is already the documented target shape.
  2. add a second `cameraDetail` store/repository fetched on demand when a card
     opens, so the tile payload stays small for the driving loop.
  3. leave the card as five honest rows and four em dashes, which is what ships
     today.

## header-cardinal-is-ambiguous

- need: a ruling on what `SW` means in `425 FT · SW`.
- screen: `A4`, the alert-hued line beside the title.
- source: the panel prints `SW` in the header and `223°` in the `FACING` tile,
  and 223 degrees IS south-west -- so both available readings (the bearing from
  the vehicle to the camera, and the camera's own facing) render `SW` for the
  values drawn. Nothing else in the design disambiguates: the watch face pairs
  a distance with a RELATIVE direction (`FT · AHEAD`), which is a third
  vocabulary and not this one.
- decision: the bearing to the camera, from `CameraAssessment.bearingDeg`,
  through `formatHeadingCardinal` -- the same eight-point vocabulary the product
  already speaks.
- why: the facing already has a tile of its own three lines down. A 375px card
  that prints one fact twice while "which way do I look" goes unanswered is the
  weaker reading, and this is the only reading under which the header answers
  something the tiles do not.
- consequence: the cardinal disappears (and the readout shows an em dash) when
  the engine has not assessed the camera, because a bearing needs a fix. Under
  the other reading it would survive a lost fix, since a facing is a property of
  the camera.
- options: (1) keep the bearing; (2) switch to the facing and drop the `FACING`
  tile to `MOUNT`-style absence; (3) the design says which.

## identity-line-copy-is-authored

- need: what the second line says when there is neither a hardware name nor a
  place -- which is every record in this build.
- screen: `A4`, `FWM-0442 · READING & TENNESSEE`.
- source: the panel draws an id and a cross street. There is no place field on
  `CameraRecord`, and producing one would mean reverse-geocoding a camera's
  coordinates against somebody's server -- a network request keyed to a
  location, which is the thing this product exists not to make.
- stand-in: the id is promoted into the title (it is the only identifier the
  build always holds) and the line below carries the authored note
  `NO HARDWARE OR PLACE NAME ON THIS RECORD`, in the product's existing micro
  notice idiom. The id is rendered exactly once, and the copy affordance
  (`clipboard.ts` exists for "copying a camera id") follows it into the title.
- options: (1) approve the note; (2) ship the hardware name (see the entry
  above) and the question disappears; (3) render an em dash as the title, which
  is honest and unreadable.

## owner-tile-has-one-drawn-value

- need: the `OWNER` tile's word for each of the five owner types.
- screen: `A4` draws exactly one -- `HOA`. `B4 · ALERT TRIAGE` names all five in
  full: `POLICE / AGENCY`, `INTER-AGENCY SHARED`, `HOA / NEIGHBORHOOD`,
  `PRIVATE / BUSINESS`, `UNVERIFIED REPORTS`.
- stand-in: `HOA` is B4's third row cut at the slash, so the other four are cut
  the same way: `POLICE`, `INTER-AGENCY`, `HOA`, `PRIVATE`, `UNVERIFIED`. The
  tile is one of three across a 375px card and the full B4 strings do not fit.
- options: (1) approve the cut; (2) author five short labels; (3) let the tile
  wrap to two lines and use B4's strings verbatim.

## mount-has-no-field-and-no-matching-chip

- need: where `MOUNT` comes from, and what its vocabulary is.
- screen: `A4` renders `SOLAR POLE`.
- source: the REPORT sheet (`06 · REPORT`) collects a mount as four chips --
  `POLE MOUNT`, `SOLAR`, `TRAILER`, `UNSURE` -- and `SOLAR POLE` is not one of
  them; it is two of them. There is no mount field on `CameraRecord` for a
  submitted report to land in either, so nothing that reaches this card has ever
  seen one.
- stand-in: the tile always renders an em dash and is marked unknown. It is
  still drawn.
- options: (1) add `mount` to the record shape and reconcile the vocabulary with
  the REPORT chips (probably `solar` + `pole` as two orthogonal facts);
  (2) drop the tile from the card and make it two tiles wide.

## your-reads-tone-at-zero-not-drawn

- need: how `YOUR READS` looks when the count is zero.
- screen: `A4` draws it at `21 IN 30 DAYS` in alert red, and never at zero.
- decision: the row renders `0 IN 30 DAYS` and takes the block's default colour;
  alert red is used only when the count is above zero.
- why: `0 IN 30 DAYS` in alert red is an alarm about nothing, and hue in this
  system means state.
- note: the count itself is honest and needs no permission -- it is this
  device's own alert log, read with the same `isCameraPass()` predicate LOG's
  bars and timeline use, and it is NOT a plate lookup. It is capped by
  `DEFAULT_MAX_HISTORY_ENTRIES`, so a very heavy 30 days could undercount.
- options: (1) keep the tone rule; (2) always alert-red, as drawn; (3) hide the
  row at zero, which loses "this camera has not read you".

## record-banner-placement-not-drawn

- need: where on the intel card B9's banner goes.
- screen: `B9` panel 1 is captioned `ON THE INTEL CARD` and draws the banner on
  its own, out of context. `A4` does not draw it at all.
- decision: directly under the id line, above the three tiles.
- why: it qualifies the `OWNER` tile immediately beneath it, and a warning
  placed below three hundred pixels of record is a warning the driver scrolls
  past.
- options: (1) keep it above the tiles; (2) put it under the fact block, beside
  the evidence it summarises; (3) the design says.

## modal-has-no-drawn-dismiss

- need: how the card closes.
- screen: `A4` draws a scrim and a 44x4 grabber and no close control of any
  kind.
- decision: both drawn affordances dismiss -- the grabber is a button and the
  scrim is a button. No X is added.
- why: those are the two things the panel draws, and a modal with no way out is
  not shippable. Inventing a close control would be adding a control the design
  does not show.
- note: a drag-to-dismiss gesture on the grabber is what a real bottom sheet
  would do and is NOT implemented; a tap is.
- note: Escape also dismisses. It adds no drawn control -- it is the keyboard's
  version of the scrim tap. See `modal-focus-order-and-trap` below.
- options: (1) approve tap-to-dismiss on both; (2) add the drag gesture;
  (3) the design draws a close control.

## grabber-is-below-the-touch-floor

- need: a 4px-tall control that meets the product's 44px touch floor.
- screen: `A4`, the 44x4 pill.
- stand-in: the drawn pixels are unchanged and the tap target is an absolutely
  positioned `::after` overlay exactly `var(--fwm-touch-min)` tall, centred on
  the pill. The same treatment gives the id-copy affordance a real target.
  Nothing underneath either is interactive.
- related: `docs/gaps-inbox/sweep.md#layer-key-36px-below-touch-floor` made the
  opposite call (grow the control), which works there because the key has no
  drawn height the layout depends on.
- options: (1) keep the overlay; (2) grow the pill's box and reduce the 18px gap
  to compensate.

## mute-key-has-no-drawn-on-state

- need: what `MUTE THIS ONE` looks like when this camera is already muted.
- screen: `A4` draws one state.
- stand-in: the copy does not change (there is no drawn `UNMUTE` string to use);
  the key carries `aria-pressed` and takes the system's own "this key is on"
  treatment -- a `--fwm-surface-2` fill, exactly as the dock's active word-key.
  It is deliberately NOT given an alert hue: a lit-up mute key reads as an
  alarm.
- note: the key toggles the PER-CAMERA mute list only. A driver who muted
  everything must not find this key already pressed, press it, and silently
  un-mute a camera they never muted -- so the card distinguishes "silenced" (the
  hue) from "muted here" (the key). The prop is named `mutedHere` for that
  reason.
- note: the on state is also a COUNTDOWN, because the mute expires. See
  `mute-this-one-is-a-ten-minute-timer` below.
- options: (1) keep the drawn copy; (2) author a second label; (3) the design
  draws the on state.

## no-action-feedback-is-drawn

- need: what the card says after an action.
- screen: `A4` draws four buttons and no feedback of any kind.
- source: three of the four do something the driver cannot otherwise see -- a
  confirmation goes into a queue and sends later, a share sheet may not exist on
  this platform, a clipboard write is refused outside a secure context.
- stand-in: one micro line under the actions, in the product's existing notice
  idiom, from a fixed set of NINE sentences. Never an interpolated error message
  (an error string is written for a developer and can quote a payload field) --
  the same rule as `describeQueueFailure()` in `features/report/reportQueue.ts`.
  A dismissed share sheet produces no line at all: that is the user saying no.
- note: muting produces no outcome sentence. It has a STANDING line instead --
  `MUTED 9:41 · STILL DRAWN, STILL COUNTED` -- which says everything the one-shot
  sentence said and also says when the silence stops. See
  `mute-this-one-is-a-ten-minute-timer`. Un-muting keeps its one-shot sentence,
  because there is nothing left to stand.
- related: `docs/gaps-inbox/report.md#no-blocked-or-failed-state-is-drawn` is the
  same question for the REPORT sheet.
- options: (1) approve the nine sentences; (2) a toast/inline pattern authored
  once for the whole product; (3) no feedback, as drawn.

## no-camera-selected-state-not-drawn

- need: what `?screen=intel` renders when nothing has been selected.
- screen: the card only exists as the result of tapping a SWEEP dot, so the
  design never draws it empty. `intel` is a reserved screen id and a deep link
  can ask for it directly.
- stand-in: `NO CAMERA SELECTED · TAP A DOT ON SWEEP`, authored, in the same
  micro notice idiom.
- options: (1) approve the copy; (2) redirect a bare `?screen=intel` to SWEEP.

## scrim-alpha-carried-as-opacity

- need: `rgba(0,0,0,.72)`, the A4 scrim.
- source: section 08 exports no alpha ramp, and the checker forbids `rgba()`
  outside `tokens.css`.
- stand-in: `background: var(--fwm-bg)` (which IS `#000000`) with the drawn
  alpha carried by the layer's own `opacity`, so the colour stays a token and
  the wash stays exactly as dark as drawn. This is a different treatment from
  the eight tints in `DESIGN-GAPS.md#report-bar-tint-and-alert-tints`, which are
  fills behind content and cannot use `opacity` without fading the content too.
- options: (1) keep it; (2) add a `--fwm-scrim` token, since a modal wash is a
  real product surface and every future sheet will want the same one.

## share-carries-no-link

- decided, and worth recording: the `SHARE` key sends a `camera-intel` payload
  with a title and a text body and NO `url`.
- source: `services/adapters/share.ts` states it outright -- "`url` is supplied
  by the caller from the app's environment config and this adapter never
  constructs, defaults or guesses one. A share with no configured origin goes
  out without a link rather than with the wrong one." There is no configured
  public app origin in this build. The generated service-worker policy is now
  encoded directly in `apps/pwa/vite.config.ts`; its camera route matches
  `self.location.origin`, which is a cache boundary, not a share URL.
  `VITE_API_BASE_URL` and `VITE_MAP_TILE_URL` have no PWA reader.
- consequence: a shared card is text, not a link. Also deliberate: the body
  drops `YOUR READS` and the distance, because both are facts about where the
  phone is and has been rather than about public infrastructure.
- options: (1) add a `VITE_PUBLIC_ORIGIN` and a per-camera public URL when one
  exists; (2) keep text-only shares.

## photo-refusal-copy-reused-from-report

- decided: `IntelPhoto.tsx` imports `PHOTO_OFF_NOTE` from `features/report`
  rather than authoring a second sentence for the same refusal. Two screens
  explaining the same rule in two different sentences is the worse outcome.
- consequence: a cross-feature import, through REPORT's barrel
  (`features/report/index.ts` exports `PHOTO_OFF_NOTE`), exactly as this
  feature reaches RADAR (`../radar`) and LOG (`../log`).
- correction: an earlier version of this entry said the import had to be a deep
  path into `components/DetailTiles.tsx` "because `features/report/` has no
  `index.ts` to export it from". That was wrong -- the barrel existed and
  exported it. The deep path is gone and `IntelView.test.tsx` fails if it comes
  back.
- since the photo path shipped: the two screens are no longer dark for the same
  reason. REPORT's v0 tile is dark because the build routes to `ReportViewV1`
  and nothing is wired behind v0's tile; INTEL's is dark because a photograph is
  owned by a report and an intel card has no report to hang one on. The shared
  string survives because it no longer states a reason at all -- it points at
  where a photo IS attached (`PHOTO OFF · A PHOTO IS ADDED WHILE YOU FILE A
  REPORT`), which is true on both screens.
- open question, unchanged: a sentence shared by two features is really neither
  feature's copy.
- options: (1) leave it exported from REPORT, which authored it; (2) move the
  shared refusal strings somewhere neutral both features import.

## mute-this-one-is-a-ten-minute-timer

- need: what the card says about a mute that expires on its own.
- screen: `A4` draws `MUTE THIS ONE` in one state and draws no timer anywhere.
- source: the key writes `alertActions.muteCamera()`, whose duration defaults to
  `DEFAULT_MUTE_DURATION_MS` -- 600_000 ms. That number is the design's own:
  `Flockys Design System.dc.html` watch rules say "long-press = mute 10 min" and
  `Screens II` B7 says "Swipe left on the tile = mute 10 min". Ten minutes after
  the press the mute lapses and the camera alerts again.
- the bug this replaces: the card drew a plain `aria-pressed` toggle and a
  one-shot `MUTED · STILL DRAWN, STILL COUNTED` line, so a lapsing timer was
  presented as a latch -- the key un-pressed itself later with no explanation,
  and a driver reading the card had no way to know the silence had an end.
- decision: the duration stays as drawn (ten minutes, from the store's default;
  the card passes no duration of its own, so there is no second copy of the
  number to drift). The card DRAWS THE TIMER: one line under the four keys,
  `MUTED 9:41 · STILL DRAWN, STILL COUNTED`, for as long as the mute runs.
  `MUTED 9:41` uses `formatMuteCountdown`, which is the same `m:ss` glyph the
  design draws as `MUTED 8:12` on the status strip (`DarkRoute App Screens`, the
  GPS LOCK row) and on the watch's W11, in the same amber.
- decision: the card reads the mute's EXPIRY TIMESTAMP out of the settings slice
  and subtracts its own clock, rather than asking the alert slice whether the id
  is in `mutedCameraIds`. That list is recomputed on an engine tick, so between
  ticks it can outlive the timer it describes; the timestamp cannot.
- consequence: the countdown advances when the card re-renders -- which, while
  driving, is every position fix. Parked, with no ticks arriving, it holds its
  last value until something else re-renders the card. That is the same
  refresh behaviour RADAR's own `MUTED 8:12` strip has, and it is a floor, not
  a ceiling: the number shown is never LESS true than the alert slice's.
- options: (1) keep the countdown; (2) run a 1s interval while a mute is live so
  the clock ticks even parked; (3) the design says a mute on this card is
  indefinite, in which case the card should pass an explicit duration and the
  key really is a latch.

## confirm-key-fill-is-fixed-not-hued

- need: what colour `CONFIRM STILL THERE` is in the five states A4 does not draw.
- screen: `A4` draws the card in `in_range` only: the top edge, the readout and
  the primary key are all `#FF2D5E` in the one frame that exists.
- decision: the top edge and the readout follow `--fwm-intel-hue`; the primary
  key does NOT -- it is `--fwm-alert-in-range` in every state.
- why: hue-driven, the key would be GREEN (`--fwm-alert-clear`) on a clear
  camera, in a system whose whole rule is "hue means state" and where green
  means "nothing near you" -- a green primary key reads as a verdict about the
  camera rather than as a button. It would also put the key's black label on
  `--fwm-line-strong` under `no_gps`, which is under 2:1 contrast and simply
  unreadable. The drawn value is the one that survives all six states.
- was: the key took `--fwm-intel-hue`, on the precedent of `radar.css`'s
  hue-filled blocks. Those are unlabelled decorations; this one carries copy.
- options: (1) keep the fixed fill; (2) the design draws the other five states
  and says.

## modal-focus-order-and-trap

- need: what `role="dialog" aria-modal="true"` actually promises, and whether
  this card keeps it.
- screen: `A4` draws a scrim and a card and says nothing about focus.
- the bug this replaces: the scrim is a full-bleed dismiss button and it was
  rendered FIRST, so the first tab stop -- and the first thing announced inside
  the dialog -- was "dismiss intel card". `aria-modal="true"` was also declared
  with no focus move and no trap, which tells assistive tech the rest of the
  screen is inert when it is not.
- decision: the scrim is rendered LAST and held under the card by `z-index`
  rather than by source order, so a keyboard and a screen reader reach the
  camera first and the dismiss last. Focus moves to the card on open (not to
  `CONFIRM STILL THERE`: the driver's question is "what is this camera"). Tab
  and Shift-Tab cycle inside the dialog. Escape dismisses.
- why Escape: it adds no drawn control -- it is the keyboard's version of the
  scrim tap the design already draws, and a trapped dialog with no keyboard exit
  is a trap.
- options: (1) keep it; (2) move initial focus to the first control instead;
  (3) the design specifies an opening focus.

## card-registration-lives-in-the-shell

- recorded, and now closed: this feature exports `IntelScreen`, `INTEL_OVERLAY`
  and `openIntelCard` and wires none of them to anything. Registering a screen
  is the shell's call.
- state: `main.tsx` registers `IntelScreen` under the `intel` screen id and
  under `INTEL_OVERLAY.id`, and raises the card from a SWEEP dot with
  `<SweepScreen onSelectCamera={openIntelCard} />`. The card is reachable.
- still open, deliberately: `IntelScreen`'s two optional props are unwired by
  that registration. `operatorRecord` stays `null` -- there is no aggregation
  service behind `FEATURES.record`, so B9's banner does not draw
  (`OperatorRecordBanner.test.tsx` covers it for when there is). `onSeeSources`
  stays absent, because `SEE THE 3 SOURCES` opens RECORD (B8) and that screen
  is another feature's; inventing a destination for it here would be inventing
  navigation.
- options: (1) leave both unwired until RECORD and the aggregation contract
  land; (2) wire `onSeeSources` the moment B8 exposes an opener.

## card-scrolls-when-the-panel-would-overflow

- decided: `.fwm-intel-card` carries `max-height: 100%` and `overflow-y: auto`,
  which the panel does not draw.
- source: the panel is a fixed 375x830 frame. A real phone in landscape, a
  `dash-cast` type scale or a `watch` surface would push the four actions off
  the bottom of a modal whose only dismiss affordances are at the top.
- options: (1) keep it; (2) the design specifies the card's behaviour below its
  drawn height.

## hero-carries-a-map-the-panel-never-drew

- decided: the v1 hero draws a 112px picture of the camera's position to the
  right of the distance readout - the ground under the camera at zoom 16, the
  camera marked at its centre, and a cone for every direction the mapper wrote.
  `features/map/MiniMap.tsx`, placed by `components/IntelViewV1.tsx`.
- source: nothing. `A4` and v1's `isIntel` block both draw the readout alone,
  with the right-hand half of the hero empty, and neither draws a map anywhere
  on this card.
- why anyway: the card's whole job is "which camera is this, and where". The
  readout answers it as `3.7 MI NE` and leaves the reader to picture the rest,
  which is a lot to ask of a driver deciding whether this is the pole they just
  passed. It also costs nothing that could be tracked: MapLibre and the archive
  are already on the phone for the scope, the coordinates are already in the
  record, and no request leaves the device that was not already leaving it.
- what it is careful about: it is NOT interactive (a map that eats a drag inside
  a scrolling card has broken the card); it says which ground it is drawing in
  its own caption, including "no map cached here" when the tiles for that area
  are not on the phone; it follows the driver's `mapView` cartography rather
  than a hardcoded flavour; and it draws no cone at all for the 60%-odd of
  records with no `direction` tag, rather than pointing the lens somewhere
  nobody wrote down.
- the facing mark is SWEEP's 60-degree primitive, which the v2 dial dropped
  because a scope full of contacts drew overlapping arcs that "read as damage".
  There is one camera in this picture and nothing for it to overlap.
- options: (1) keep it; (2) the design draws the hero's right-hand half as
  something else, in which case this moves or goes.
