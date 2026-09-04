# gap inbox -- TRIAGE / ALERT TRIAGE

> **STALENESS WARNING, added 2026-08-30.** The drawn surface here is v0's. The projection logic
> is still live.
>
> `apps/pwa/src/app/registry.v1.tsx:91` maps `triage: TriageV1Screen`, and v1 is
> the default (`apps/pwa/src/app/design.ts:61`).
> `features/triage/TriageV1Screen.tsx:11` renders
> `<TriageScreen view={TriageViewV1} />` - the v0 CONTAINER, unedited, with a v1
> view. `triage.ts` is shared and unedited, so every entry about owner types,
> muting and the re-alert rule still binds.
>
> The B4 layout entries below - the header, the row treatment, the
> `ALERTS PER DRIVE - PROJECTED` block as drawn - describe
> `components/TriageView.tsx`, not the shipped `components/TriageViewV1.tsx`.
> The panel's own `4` and "down from 19" were never transcribed: v1 renders
> `AlertProjection.projected`, null until there are drives to divide by
> (`v1-redesign.md`).
>
> TRIAGE is also no longer a screen you arrive at the same way - under v1 it is
> a MORE tile (`features/more/MoreScreen.tsx:194-196`).
>
> Read instead: `features/triage/components/TriageViewV1.tsx`,
> `docs/STALENESS.md`.

Files: `apps/pwa/src/features/triage/**` (`TriageScreen.tsx`, `components/*.tsx`,
`triage.css`, `triage.ts`).

Sources read: `Flockys Screens II.dc.html` -- panel `B4 · ALERT TRIAGE - BY
OWNER TYPE` (lines 497-546) in full, plus `B3 · PRE-DRIVE` and `B5 · PLATE
WATCHLIST` either side of it for the header and row vocabulary they share;
`Flockys Design System.dc.html` section 08 for the token set;
`Flockys App Screens.dc.html` `05 · LOG - EXPOSURE` for the pass-counting
vocabulary this screen projects from.

Everything the panel draws is a literal read from B4: `TRIAGE`, `ALERT FATIGUE
CONTROL`, `ALERTS PER DRIVE - PROJECTED`, `4`, `down from 19`, `with current
filters`, `POLICE / AGENCY` / `shared to 412 agencies`, `INTER-AGENCY SHARED` /
`any owner, shared feed`, `HOA / NEIGHBORHOOD` / `11 on your usual routes`,
`PRIVATE / BUSINESS` / `retail lots, storage`, `UNVERIFIED REPORTS` /
`1 confirmation only`, `MUTED CAMERAS DON'T DISAPPEAR`, `They still draw on
SWEEP in grey, still count in EXPOSURE, still log to LOOKUP. Muting only removes
the alert - never the record.`, `RE-ALERT ON MUTED IF`, `closer than 150 ft`.

The REPORT bar and the dock word-keys are NOT reproduced here: they are shell
chrome (`app/App.tsx` + `components/dock`), and B4 draws neither.
`TriageView.test.tsx` asserts this screen draws neither.

## Cross-references, not new entries

The decision is already filed; TRIAGE is another instance of it.

- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- TRIAGE's sites: the header
  strapline and both card eyebrows (10px), the five row captions and the
  projection caption (11px, on the floor), the muting card body (11.5px). All
  render at `var(--fwm-text-micro)`.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- B4 draws one
  populated state and nothing else. See `projection-caption-when-nothing-is-filtered`
  and `drive-count-is-not-in-the-store` below for TRIAGE's half.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- every
  1px hairline on this screen, derived as `calc(var(--fwm-space-1) / 4)` in a
  component-scoped local (`--fwm-triage-rule-w`).
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.1em`,
  `.18em` and `.2em` on this screen, expressed as `calc(var(--fwm-text-*) * n)`.

## drive-count-is-not-in-the-store

- **Status:** STANDING IN
- **Need:** what "per drive" divides by.
- **Screens:** `B4` prints `4` under `ALERTS PER DRIVE - PROJECTED` and `down
  from 19`, which is a rate over some number of drives. The design never says
  how many drives, or over what window.
- **Problem:** `stores/history.ts` holds ONE trip -- the drive in progress, or
  the last one it was told about. Past trips exist in IndexedDB
  (`services/db/repositories/trips.ts`) and are not loaded into the slice, and
  the alert log carries no trip id, so a multi-drive denominator cannot be
  counted in memory. Segmenting the log by an idle gap would mean inventing a
  gap constant that no design file states.
- **Stand-in:** the drive unit is the recorded trip. One open trip means one
  drive; no trip means no drive, and the hero prints ` - ` with `no drives on
  record` / `nothing to project yet` rather than a number. This is the same
  call `features/log/exposure.ts#scopedEntries` already made for the `TRIP`
  scope, so LOG and TRIAGE agree about what a drive is.
  The ROW captions use the whole log rather than the trip -- `11 on your usual
  routes` is a claim about roads, not about this morning.
- **Consequence, stated plainly:** with a denominator of one open trip, the
  figure under `ALERTS PER DRIVE - PROJECTED` is `passes so far on this drive`,
  not a rate over drives. It reads `0` at the kerb and climbs as the drive
  happens, and the `down from N` beside it is the SAME partial window with the
  switches taken off -- a filtered-versus-unfiltered comparison of one drive in
  progress, never this-drive-versus-past-drives. Nothing on the screen is a
  forecast. Because the eyebrow is the design's and says PROJECTED, the second
  caption line carries the window: `this drive so far` while the trip is open,
  reverting to the design's `with current filters` once `trip.endedAtMs` is set
  and the figure covers a whole drive. `no cameras yet this drive` is the
  open-drive form of the empty case, so a zero at the start of a drive is not
  read as a finished drive with no cameras on it.
  Asserted in `triage.test.ts` ("the window the figures are counted over") and
  end-to-end in `TriageScreen.test.tsx`.
- **Options:** (1) confirm the stand-in; (2) hydrate recent trips into the
  history slice (a shared-file change, not this screen's to make) and average
  over the last N drives; (3) add a trip id to `AlertLogEntry` so any window can
  be sliced by drive.

## no-agency-sharing-count-exists

- **Status:** STANDING IN
- **Need:** the number under `POLICE / AGENCY`.
- **Screens:** `B4` prints `shared to 412 agencies`.
- **Problem:** nothing in this product's data model has an agency-sharing
  count. `CameraRecord` carries an id, a position, a facing, an owner class,
  a confirmation count and a server timestamp -- and no sharing information at
  all. There is no source for a `412`.
- **Stand-in:** `shared to - agencies`, the same em-dash convention
  `features/log/exposure.ts#formatSegmentDetail` uses for the hottest segment's
  unmeasured `1.2 MI`. A plausible invented number on a screen whose whole job
  is to be believed is worse than a visible absence.
- **Options:** (1) add a sharing count to the camera record and a source that
  can populate it; (2) replace the caption with prose, like the other three
  descriptive rows; (3) keep the em dash until (1) exists.

## usual-routes-is-the-recorded-log

- **Status:** STANDING IN
- **Need:** what "your usual routes" is a count over.
- **Screens:** `B4` prints `11 on your usual routes` under `HOA /
  NEIGHBORHOOD`.
- **Problem:** this product has no route model. `B3 · PRE-DRIVE` scores a route
  the driver is about to take, but nothing stores a set of habitual ones.
- **Stand-in:** distinct cameras of that owner class in the recorded alert log
  -- the roads this driver has actually been down. Distinct cameras, not
  passes: driving the same street twice does not put another camera on it.
  A count prints ` - ` rather than `0` whenever this device cannot stand behind
  the zero, because a zero there would be a statement about the eviction policy
  dressed up as a statement about the road. The guard is PER ROW, not per log,
  since partial eviction (one tile still held, the rest gone) is the ordinary
  case and total eviction the rare one:
  `triage.ts#ownerCountIsResolvable` prints the number when the class resolved
  at least one camera -- a floor, but every camera in it was really driven past
  -- and when NO pass went unattributed, which makes a zero a real zero. A zero
  with unattributed passes beside it is unknowable (the missing records could
  be exactly this class) and prints the em dash.
  `ownersAreResolvable` remains the whole-log question and is subsumed by the
  per-row one.
- **Options:** (1) confirm the stand-in; (2) count cached cameras in the tiles
  instead, which measures the cache rather than the driver; (3) build a route
  model and count over it.

## projection-caption-when-nothing-is-filtered

- **Status:** STANDING IN
- **Need:** what the caption says when the switches remove nothing.
- **Screens:** `B4` draws exactly one state -- two classes on, three off, and a
  real reduction: `down from 19`.
- **Stand-in:** three undrawn cases each say what they are instead of comparing
  a number with itself. `nothing filtered out` / `with current filters` when
  the projection equals the baseline; `no cameras this drive` / `nothing to
  filter yet` when the drive had no passes; `no drives on record` / `nothing to
  project yet` when there is no drive. `down from N` / `with current filters`
  is printed verbatim in the case the design draws.
- **Options:** (1) confirm; (2) always print `down from N`, which reads as a
  bug when N equals the figure above it; (3) draw the three missing states.

## re-alert-is-a-switch-over-a-distance

- **Status:** STANDING IN
- **Need:** what the `RE-ALERT ON MUTED IF` switch writes.
- **Screens:** `B4` draws a switch, ON, with `closer than 150 ft` stated under
  the label -- but no control for changing the distance and no OFF state.
- **Problem:** the model stores a distance (`settings.reAlertWhenCloserThanFt`),
  not a boolean, and `stores/alert.ts#mutePierces` is
  `nearestDistanceFt < threshold`.
- **Stand-in:** OFF is stored as `0`, which `mutePierces` can never satisfy, and
  the caption becomes `muted stays muted`. The distance the driver had chosen is
  remembered for the session so an off/on round trip does not silently move them
  to the 150 ft default; it is a UI convenience held in a ref, not a preference,
  because preferences belong to the settings slice.
- **Options:** (1) confirm; (2) draw a distance control on this row (a stepper,
  or a link into SETTINGS); (3) add an explicit `reAlertOnMuted` boolean to the
  settings slice so off does not have to be encoded as a distance.

## unverified-row-drawn-off-but-undimmed

- **Status:** RESOLVED IN FAVOUR OF CONSISTENCY (design is internally inconsistent)
- **Need:** whether a switched-off row dims its headline.
- **Screens:** `B4` draws `HOA / NEIGHBORHOOD` and `PRIVATE / BUSINESS` with
  their switches off AND their headlines in `--fwm-text-muted`, and
  `UNVERIFIED REPORTS` with its switch off and its headline in full
  `--fwm-text`. Three off rows, two treatments.
- **Stand-in:** the rule is "off dims the headline", applied to all five rows.
  Two of the three off rows are drawn that way, a per-row exception would be
  unexplainable to a driver, and dimming is the only cue an off switch has
  besides its own colour.
- **Options:** (1) confirm; (2) the unverified row is deliberately never dimmed
  because it is the one class the product wants kept visible; (3) drop the
  dimming everywhere and let the switch carry the state alone.

## triage-switches-are-stored-but-not-yet-enforced

- **Status:** OPEN -- wiring gap, not a design gap
- **Need:** the alert gate to consult `settings.ownerTypesEnabled`.
- **Problem:** `grep -rn "ownerTypesEnabled" apps/pwa/src packages/core/src`
  returns the settings slice, its tests and this screen -- and nothing else.
  `stores/alert.ts` and `packages/core/src/alert.ts` never read it, so a class
  switched off here is a durable preference that currently silences nothing.
- **Consequence for this screen:** the figure is called PROJECTED, and it is --
  it answers "how many of your recorded alerts match your current filters", off
  real history. It does not claim the engine is already filtering. The claim
  becomes true the moment the gate reads the setting.
- **Not fixed here:** `stores/alert.ts` is outside this feature's file boundary.
- **Options:** (1) apply the filter in the delivery gate (`shouldAlertUser`),
  which keeps detection and the record complete and only removes the alert --
  the reading B4's own card demands; (2) apply it in the engine's camera
  selection, which WOULD remove the camera from counts and from SWEEP and
  therefore contradicts `MUTED CAMERAS DON'T DISAPPEAR`; (1) is the only option
  consistent with the panel.

## two-models-for-the-unverified-row

- **Status:** STANDING IN
- **Need:** which stored field the `UNVERIFIED REPORTS` switch writes.
- **Problem:** `stores/settings.ts` carries BOTH `ownerTypesEnabled.unverified`
  and a separate `hideUnverified` boolean whose comment says it is
  "`UNVERIFIED REPORTS · 1 confirmation only` collapsed to one switch". The
  schema mirrors both (`triage.enabledOwnerTypes`, `triage.hideUnverified`).
  B4 draws one switch, in a row identical to the other four.
- **Stand-in:** the row writes `ownerTypesEnabled.unverified`. All five rows are
  drawn the same and the panel is titled BY OWNER TYPE; giving one row a
  different mechanism would make it behave differently for no reason a driver
  could see. `hideUnverified` is left untouched by this screen.
- **Consequence of the stand-in, stated:** `hideUnverified` now has ZERO
  consumers. `grep -rn hideUnverified apps/pwa/src` returns the settings slice
  (declaration, default, hydrate, persist, action), its own store test, the
  published selector `useHideUnverified`, the schema key
  `triage.hideUnverified` and its repository validator -- and no screen.
  `features/settings/` binds neither field, so there is no live contradiction
  today; there is an orphaned durable field, a published selector nobody calls,
  and a second name for a switch this screen already owns. Whichever way it is
  decided, the resolution edits `stores/settings.ts` and
  `services/db/schema.ts`, which are outside this feature's boundary.
- **Options:** (1) confirm and retire `hideUnverified` (delete the field, the
  selector and the schema key, or leave the key reserved so old records still
  validate); (2) the two mean different things (`hideUnverified` removes the
  records from SWEEP/LOOKUP, which would contradict the muting card) and both
  need a control; (3) point the row at `hideUnverified` and drop `unverified`
  from `OWNER_TYPES`.

## notice-names-a-flagged-off-screen

- **Status:** NOTED, rendering verbatim
- **Need:** none, unless LOOKUP stays off.
- **Problem:** the muting card says muted cameras "still log to LOOKUP", and
  `config/features.ts` has `plateLookup: false` pending permission.
- **Stand-in:** the sentence renders verbatim. The claim is about the RECORD,
  not about a screen: nothing was deleted to turn the flag off, the plate vault
  and `plateMatches` repository are intact, and the sentence becomes literally
  true again the moment the flag flips. Re-wording design copy to match a
  temporary flag would leave the app quietly disagreeing with its own spec.
- **Options:** (1) leave verbatim; (2) render the sentence conditionally on the
  flag, which puts two versions of a load-bearing promise in the codebase.

## no-selector-for-re-alert-distance

- **Status:** WORKED AROUND
- **Need:** a `useReAlertWhenCloserThanFt()` selector on the settings slice.
- **Problem:** the slice publishes a selector for every other field this screen
  reads, but not for `reAlertWhenCloserThanFt`.
- **Stand-in:** `useSettingsStore((state) => state.reAlertWhenCloserThanFt)`,
  read inline. Adding the selector would mean editing a shared file that other
  screens are being built against right now. Same call `LogScreen.tsx` made for
  `allTimeSinceMs`.
- **Options:** (1) add the selector next to the others; (2) leave it.

## spacing-scale-misses-10-and-14

- **Status:** STANDING IN (same family as `docs/gaps-inbox/log.md#spacing-scale-misses-5-14-and-18`)
- **Need:** 10px and 14px steps.
- **Screens:** B4's body stack is 14px and the gap between the projection
  numeral and its caption is 10px. The scale runs 4, 8, 12, 16, 24, 32, 48.
- **Stand-in:** `var(--fwm-space-3)` (12px) for the 14px stack and
  `var(--fwm-space-2)` (8px) for the 10px gap -- the nearest tokens. 10px is
  equidistant between two steps; the tighter one was taken so the caption stays
  visually attached to the numeral it qualifies.
- **Options:** (1) add the steps; (2) re-tune the panel to the existing scale;
  (3) keep the nearest-token stand-in.

## projection-numeral-is-56px

- **Status:** STANDING IN (same family as `DESIGN-GAPS.md#token-set-does-not-cover-rendered-hero-sizes`)
- **Need:** a 56px type step.
- **Screens:** the `ALERTS PER DRIVE` numeral renders 56px/700 with
  `line-height:.9`. The scale offers `--fwm-text-readout` (40px) and
  `--fwm-text-hero` (80px).
- **Stand-in:** `var(--fwm-text-readout)`, the nearer of the two, with the
  rendered line-height carried as a ratio rather than as a raw length. The
  numeral does not animate and no rule in `triage.css` may ever give it a
  transition: a counter that rolls is a counter a driver cannot read.
- **What that costs, plainly:** the focal figure of the card renders 40px where
  the panel draws 56px -- 16px, 29% short, and the single largest visual
  divergence on this screen. It is NOT reproduced as drawn. The same rule is
  applied on every other hero in the repo (RADAR draws 96 and renders 80, LOG
  draws 72 and renders 80, ZONE AUDIT draws 70 and renders 80), because a
  `calc()` that manufactures 56px would put a size in the product that the
  token set never declared. TRIAGE is the worst case of the family only because
  56px falls in the widest hole in the scale.
- **Fix is not in this feature:** the step has to be added to
  `apps/pwa/src/styles/tokens.css`, which no screen owns. Escalated with the
  build, not applied here.
- **Options:** (1) add a step between readout and hero; (2) keep the readout
  step; (3) rescale the card.

## notice-body-is-11-5px

- **Status:** STANDING IN
- **Need:** an 11.5px step, or a decision that 11px is the floor and means it.
- **Screens:** the muting card's body renders 11.5px/1.9 -- half a pixel above
  the stated 11px phone floor, and the only 11.5px value in any design file.
- **Stand-in:** `var(--fwm-text-micro)` (11px). The half pixel is almost
  certainly an artefact of the design document rather than an intent.
- **Options:** (1) confirm 11px; (2) treat 11.5px as intentional and add a step.

## switch-is-below-the-touch-floor

- **Status:** STANDING IN (same family as `docs/gaps-inbox/log.md#toggle-key-height-34`)
- **Need:** a switch that clears the product's own 44px touch floor.
- **Screens:** B4 draws the switch track 56x30. The design system states a 44px
  minimum touch target, and this screen is used in a parked car, not a lab.
- **Stand-in:** the BUTTON is `var(--fwm-touch-min)` tall and
  `calc(var(--fwm-space-6) + var(--fwm-space-8))` (56px) wide; the drawn 56x30
  track sits inside it. The panel looks drawn and the target is reachable. The
  track height is `calc(var(--fwm-space-8) - var(--fwm-space-1) / 2)` and the
  knob's 3px inset is derived from the track and knob rather than stated, so it
  stays centred if either moves.
- **Options:** (1) confirm; (2) redraw the switch at 44px; (3) accept the 30px
  target on phone and enlarge it only on the `dash` surface.

## knob-position-is-an-aria-attribute

- **Status:** DECISION, filed for review
- **Need:** none; recording why the switch is built the way it is.
- **Decision:** the knob's side is flex alignment keyed off `aria-checked`, not
  a computed offset. No inline style exists anywhere in this feature -- an
  inline `style` is the one way a raw length reaches the DOM without passing
  `scripts/check-design-values.mjs` -- and keying the picture off the same
  attribute assistive technology reads means the two cannot drift apart.
- **Held by a test, not only by this note:** `TriageView.test.tsx`, "the knob
  moves because aria-checked moved", reads `triage.css` off disk and asserts
  BOTH alignments (`flex-start` on the track, `flex-end` under
  `[aria-checked="true"]`), and asserts there is no second mechanism that could
  hide their loss -- no `transform`, no `margin-left: auto`, no
  `position: absolute`, no inline style, and identical markup either side of
  the attribute. Dropping `justify-content: flex-end` used to leave the knob
  parked on the left while the announcement kept flipping, and every existing
  assertion (track colour, `aria-checked`, no `[style]`) still passed.
- **Not held by anything, and repo-wide:** `triage.css` declares no
  `:focus-visible` rule for the switch button, which sets `border: none` and
  `appearance: none`. RADAR, LOG and ONBOARDING are in the same position and
  only `sweep.css` has one, so this is a system decision (a focus token and one
  rule applied everywhere) rather than a TRIAGE regression, and adding a ring
  here alone would make this the only screen in the app with one.
