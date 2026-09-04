# gap inbox -- SWEEP

> **STALENESS WARNING, added 2026-08-30.** This file describes a screen that does not exist in any
> form. It was written when `02 · SWEEP` was its own destination with its own
> component.
>
> SWEEP was merged into RADAR by product decision on 2026-08-20. There is no
> `SweepScreen.tsx` anywhere in the repo - the header line above naming it is
> the first thing that is wrong. `sweep` is registered in NEITHER registry
> (`apps/pwa/src/main.tsx:100-132`, `apps/pwa/src/app/registry.v1.tsx:55-127`),
> and `apps/pwa/src/app/screenState.ts:157-159` freezes
> `MERGED_SCREENS = { sweep: 'radar' }` so `?screen=sweep` resolves to RADAR
> before anything renders. No dock in either design has a SWEEP key.
>
> What survives is the CODE, not the screen: `features/sweep/**` is now a
> component library RADAR draws with - see the imports at
> `features/radar/RadarScreen.tsx:50-71` and
> `features/radar/components/RadarView.tsx:57-65`. Entries below about the
> dial, rings and dot classes therefore still bind, but they bind to RADAR. The
> former emoji glyph has since become a drawn circular contact in
> `components/SweepDial.tsx`. Entries about SWEEP's header, its two 36px keys, its
> navigation and its place in the dock describe nothing.
>
> Read instead: `radar-sweep-merge.md` for the decision and the list of what
> was lost, then `radar-screen.md`'s own banner. Full v0-to-v1 map:
> `docs/STALENESS.md`.

Files: `apps/pwa/src/features/sweep/**` (`SweepScreen.tsx`, `components/*.tsx`,
`sweep.css`, `sweepState.ts`, `geometry.ts`).

Sources read: `Flockys App Screens.dc.html` -- screen `02 · SWEEP`
(lines 119-185); `Flockys Design System.dc.html` -- the `SWEEP PRIMITIVES` card
(lines 357-375) and the accent-scan swatch note "#22C8E0 · sweep, links, map";
`Flockys Screens II.dc.html` -- `A4 · INTEL CARD - MODAL FROM SWEEP`
(lines 189-234), `A5 · MESH FEED` (lines 236-260), `B4` ("They still draw on
SWEEP in grey", line 536) and `B9 · ON SWEEP · DOT TREATMENT` (lines 757-770).

Everything SWEEP draws is a literal read from those: the 52px header, `SWEEP`,
`ROUTE`, `MESH`, the 311px dial, the 1000 / 500 / 300 / 100 ring labels, the
70 deg conic wedge at 2.4s, the ego marker, the three dot classes,
`IN RANGE 3` / `KNOWN 11` / `HAKCERS 2`, and `TAP DOT → INTEL CARD`.

Of what those sources draw, three things are NOT drawn here and each has its own
entry below: the panel-02 camera card (`panel-02-bottom-card-is-the-intel-card`),
B9's FLAGGED OPERATOR ring (`flagged-operator-dot-not-drawn`), and the
`REPORT CAMERA` bar and five-key dock, which are the shell's.

## Cross-references, not new entries

The decision is already filed; SWEEP is another instance of it.

- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- SWEEP's sites: the ring
  scale labels (9px), the legend row (10px), the `ROUTE` / `MESH` keys (10px)
  and the tap hint (10px). All render at `var(--fwm-text-micro)` (11px).
- `DESIGN-GAPS.md#animations-are-not-tokens` -- see
  `sweep-duration-derived-from-dur-alert` and `no-constant-rate-easing-token`.
- `DESIGN-GAPS.md#untokenized-utility-colours` -- the entry lists a map well
  `#04060A` for SWEEP. There is no map well in this implementation: the dial's
  ground is `--fwm-bg`, exactly as `02 · SWEEP` draws it (`background:#000`).
  The `#04060A` value belongs to CONVOY and ZONE AUDIT, not to this screen.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- see
  `empty-dial-copy-not-drawn` below for SWEEP's half.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- the 1px
  hairline and the 3px facing-arc stroke, derived from `--fwm-space-1` (`/4`,
  `*0.75`) as component-scoped locals, exactly as `radar.css` does it.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.1em`
  and `.16em` on this screen, expressed as `calc(var(--fwm-text-*) * n)`.
- `docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30` -- the
  body's rendered `gap:18px` is `var(--fwm-space-4)` (16px) here.

## sweep-is-not-a-map

- decided, and worth confirming: `leaflet` and `react-leaflet` are installed and
  imported by nothing. SWEEP does not change that.
- need: a ruling on whether the two packages are for SWEEP at all.
- source: all three files draw SWEEP as a polar dial -- four concentric distance
  rings, a rotating scan line, an ego marker pinned at the centre, and dots
  placed by distance and bearing. There is no basemap, no street grid, no north
  arrow and no tile in any render of this screen. The design system's own
  accent-scan note ("sweep, links, map") is the only place the word "map"
  appears next to SWEEP, and the screens it describes are CONVOY (B1) and ZONE
  AUDIT (B6), which do draw map wells.
- decision: the dial is an inline SVG whose user space is the dial itself. No
  tile layer, therefore no network request keyed to the driver's position --
  which is the promise the whole product is built on, and the one a basemap
  would quietly break.
- consequence: `leaflet` and `react-leaflet` remain unused. If they are for
  CONVOY / ZONE AUDIT / HEAT MAP, they should stay; if they were added for
  SWEEP, they are dead weight in the bundle and should be dropped.
- options: (1) keep them for the map-well screens; (2) drop both and render the
  other two surfaces the same way SWEEP does; (3) confirm a basemap was intended
  here after all, which needs a privacy ruling first (self-hosted tiles, or
  pre-cached tiles only).

## panel-02-bottom-card-is-the-intel-card

- need: confirmation that the card at the bottom of `02 · SWEEP` is `A4`, not a
  second component.
- source: panel 02 ends with a `CARD · LIST ROW` showing `FALCON`, `425 FT`,
  `OWNER: HOA · FACING: SW`, `ID FWM-0442 · EFF ATLAS OK`,
  `INTER-AGENCY SHARING: YES`, captioned `TAP DOT → INTEL CARD`. `A4 · INTEL
  CARD - MODAL FROM SWEEP` draws the same camera with the same numbers, in full,
  as a modal. `screenState.ts` reserves the `intel` id and the `modal` overlay
  kind for it.
- stand-in: SWEEP does not draw the card. It calls an injected
  `onSelectCamera(cameraId)` and renders the `TAP DOT → INTEL CARD` line, and
  only when a handler is actually wired. Two further reasons beyond ownership:
  `CameraRecord` has no field for the hardware name (`FALCON`), the EFF Atlas
  cross-reference or the inter-agency sharing flag -- only the test fixtures do
  -- so drawing that card from production data would mean drawing a plausible
  fiction; and a summary card that duplicates half of `A4` is a second place for
  the two to disagree.
- options: (1) confirm the panel card is `A4` previewed in situ (the reading
  taken here); (2) if it is a distinct always-on "nearest camera" card, it needs
  the missing fields added to `CameraRecord` before it can be built honestly.

## route-mesh-toggle-undefined

- need: what `ROUTE` and `MESH` do, and which one is on by default.
- source: `02 · SWEEP` draws two 36px keys, identical treatment, both `#A7AFBD`
  on a `#23262F` edge, neither marked as selected -- and exactly one dial, with
  all three dot classes visible at once. Nothing anywhere says what changes when
  the other key is pressed. Both words are also reserved screen ids
  (`route` -> `B3 · PRE-DRIVE`, `mesh` -> `A5 · MESH FEED`), so a second reading
  is that they are navigation keys in RADAR's `REP` / `SET` / `VOL` pattern.
- stand-in: implemented as a toggle, because that is what the task specifies.
  Exactly one key is pressed, `aria-pressed` says which, `ROUTE` starts pressed,
  and the selection is reported through `onLayerChange` and mirrored on the root
  as `data-fwm-sweep-layer`. **What the dial shows does not change between the
  two.** The design draws one dial, and hiding cameras behind a mode on the
  screen whose job is warning a driver about cameras is not a guess worth
  making. The pressed treatment is borrowed from the one selected-key state the
  design does draw -- the dock's active word-key: `--fwm-surface-2` fill,
  scan-cyan edge and label.
- options: (1) they are layers and MESH adds the ghost dots to a ROUTE dial that
  omits them -- then panel 02 is drawn in MESH and `ROUTE` should start pressed
  or not accordingly; (2) they are sources -- ROUTE is the cached camera DB
  along the route, MESH is what other DarkRoute are reporting live; (3) they are
  navigation and should open `B3` and `A5`; (4) draw the pressed state so the
  answer is legible.

## ghosts-have-no-bearing

- need: how to place a flocky ghost on a dial that is drawn by bearing.
- source: SWEEP PRIMITIVES draws "flocky ghost 9px @60%" as a dot at a position.
  `A5 · MESH FEED` states the constraint that makes that impossible:
  "DISTANCE ONLY · NO COORDINATES SHARED", and `PresencePeer` carries
  `distanceMi` and no coordinate, rounded to 0.1 mi, with
  `assertNoCoordinates()` throwing if one ever arrives.
- stand-in: the radius is measured, the angle is not. `ghostAngleDeg()` derives
  a stable angle from the peer's ephemeral id so the dot does not skitter around
  the dial between renders or when another peer joins or leaves. Every ghost is
  marked `data-fwm-sweep-bearing="unknown"`, is not tappable, carries no camera
  id, and is announced as "another flocky, N ft away" with no direction in the
  label. The design's own ghosts are placed arbitrarily for the same reason.
- risk: a dot at a position reads as a position. This is the one place on the
  screen where the picture says slightly more than the data does.
- options: (1) accept the stable pseudo-angle and keep the `bearingKnown` flag
  as the contract that nothing may read a direction off it; (2) draw ghosts as
  an arc or a full ring at their radius, which is honest and is not what the
  design draws; (3) drop ghost dots from the dial and leave the mesh count in
  the legend only.
- note: moot in this build -- `FEATURES.presence` is `false` and the presence
  slice refuses ingestion while it is, so no ghost renders today. The legend's
  `HAKCERS` tally reads an em dash rather than `0`, because a switched-off feed
  has not looked and "HAKCERS 0" would be a claim that nobody is nearby.

## dial-orientation-unstated

- need: is the dial heading-up or north-up.
- source: `02 · SWEEP` draws an arrow at the centre pointing up the screen and
  never draws a compass rose or a north marker. RADAR states direction relative
  to the vehicle (`AHEAD · SLIGHT LEFT`).
- stand-in: heading-up whenever a heading exists -- a dot at the top of the dial
  is a camera ahead of the vehicle, which is the same frame RADAR speaks in.
  With no heading the dial falls back to north-up and says so on the container
  (`data-fwm-sweep-orientation`) and in the SVG's accessible name.
- options: (1) confirm heading-up; (2) north-up with a rotating ego arrow, which
  would need a north marker drawn; (3) heading-up with the fallback drawn
  explicitly, e.g. an `N` tick, which the design does not have.

## dial-scales-below-full-width

- need: a ruling on what happens to the dial on a surface narrower than it.
- source: `02 · SWEEP` draws the dial 311px wide in a 375px frame. Nothing in
  any of the three files draws SWEEP at another width, and `app/surface.ts`
  resolves surfaces at 300px and 320px.
- stand-in: `width: min(100%, calc(var(--fwm-space-12) * 6.5))`, so the dial
  takes 312px where there is room and shrinks to fit where there is not. The
  SVG scales as one piece, so every ratio the design draws survives.
- consequence, and it is worth stating because two other entries lean on it:
  "one user unit is one CSS pixel" is TRUE ONLY AT FULL WIDTH. Below it,
  `font-size: var(--fwm-text-micro)` inside the SVG is still 11 user units but
  no longer 11 CSS px, and the 44-unit tap target in
  `hit-radius-mirrors-touch-min` is no longer 44 CSS px. Nothing inside the SVG
  is a raw value either way -- the tokens are still tokens -- but the *pixel*
  claim only holds where the dial gets its full width.
- options: (1) accept the uniform scale (as built) and keep the pixel claim
  qualified wherever it is made; (2) give the dial a minimum diameter and let
  the narrow surface scroll, which trades a small dial for a scrolling driver
  screen; (3) draw a watch-specific dial with its own measurements, which is
  what `Flockys Watch.dc.html` would have to say first.

## dial-diameter-311px

- need: a component-size family. Same gap as
  `docs/gaps-inbox/radar-screen.md#ring-diameter-172px`, at a different size.
- source: `width:311px; height:311px` in panel 02; 160px in SWEEP PRIMITIVES.
  Neither is on the 4/8/12/16/24/32/48 scale.
- stand-in: `width: min(100%, calc(var(--fwm-space-12) * 6.5))` = 312px, the
  closest a derived value gets, clamped so a narrow surface cannot be overflowed.
  The SVG's viewBox is 312 units to match, which is what lets every stroke width
  and font size inside the SVG stay a `var(--fwm-*)` token.
- options: as in the RADAR entry -- (1) add a size family; (2) make the dial
  fluid; (3) accept the derived multiple.

## ring-scale-is-not-linear

- need: confirmation that the drawn ring spacing is intentional.
- source: panel 02 insets its rings 0 / 34 / 78 / 118 px inside a 311px dial for
  1000 / 500 / 300 / 100 ft. Those radii (155.5 / 121.5 / 77.5 / 37.5) are
  roughly evenly spaced, so 100 ft gets 24% of the radius where a linear scale
  would give it 10%.
- stand-in: `radiusForDistanceFt()` interpolates piecewise-linearly between the
  drawn rings rather than inventing a curve, so a camera always lands where the
  design's own scale puts it. A camera past 1000 ft is not drawn at all rather
  than pinned to the rim -- a dot on the edge would read as "1000 ft" when it
  might be a mile away.
- options: (1) confirm the compressed near-field is deliberate (it is the
  reading a driver needs); (2) specify the scale as a formula (sqrt fits the
  drawn radii to within ~4 units) so it can be reproduced exactly; (3) go linear
  and accept that 100 ft becomes a 15px circle.

## dot-size-11-vs-9

- need: one dot size.
- source: panel 02 draws every dot `width:11px; height:11px`; SWEEP PRIMITIVES
  and `B9` say 9px and 12px respectively.
- stand-in: 11px, per the public
  [source-authority rule](./README.md#source-authority) -- the
  rendered screen (authority 2) outranks the design-system card (authority 3).
  This is the same rule, in the same direction, as `ego-marker-arrow-vs-dot`;
  `conic-wedge-70-vs-74` reaches the card's value instead and says why, which is
  an explicit instruction (authority 1) and not a re-reading of this rule.
- options: (1) 11px everywhere; (2) 9px, and redraw panel 02.

## ego-marker-arrow-vs-dot

- need: one ego marker.
- source: panel 02 draws a 16x18 white triangle pointing up. SWEEP PRIMITIVES
  says "ego marker 10px white, fixed center" -- a dot.
- stand-in: the arrow. It wins on authority order, and it is the only one of the
  two that says which way the vehicle is pointing, which a heading-up dial needs.
- options: (1) the arrow; (2) the dot, which then needs a separate heading
  indicator; (3) the dot on the watch surface and the arrow on the phone.

## conic-wedge-70-vs-74

- need: one wedge angle and one alpha.
- source: SWEEP PRIMITIVES: "sweep 70 deg conic, 2.4s linear", with
  `rgba(34,200,224,.34)`. Panel 02 renders the same wedge at `74deg` with
  `rgba(34,200,224,.3)`.
- stand-in: 70 deg at `opacity: 0.3` (the screen's alpha). The colour itself is
  `var(--fwm-accent-scan)` fading to `transparent`, with the alpha carried by
  the layer's own opacity so no `rgba()` literal is needed.
- **why 70, stated correctly.** 70 wins because the task spec names 70 deg, and
  an explicit instruction is highest under the public
  [source-authority rule](./README.md#source-authority). It does NOT win because
  SWEEP PRIMITIVES is "the block that defines the primitive" -- that was the
  reasoning first written here and in `sweep.css`, and it is the authority order
  run backwards: the same card is authority 3 and LOSES to panel 02 twice on
  this screen, at `dot-size-11-vs-9` and `ego-marker-arrow-vs-dot`. Left uncited
  by authority 1, the rendered 74 deg would win. Corrected 2026-08-20; the
  current 70-degree declaration is in `sweep.css`.
- options: (1) 70 deg / .3 as built; (2) 74 deg / .3 to match panel 02 exactly;
  (3) 70 deg / .34 to match the primitive exactly.

## no-constant-rate-easing-token

- **blocks a faithful render.**
- need: a constant-rate easing token.
- source: "sweep 70 deg conic, **2.4s linear**" (SWEEP PRIMITIVES) and
  "sweep t=2400ms path **linear**, repeat infinite" (design system, line 843).
  The token set exports `--fwm-ease-out` and `--fwm-ease-mech` and nothing
  constant-rate.
- stand-in: `var(--fwm-ease-linear, var(--fwm-ease-mech))`. The declaration
  names the token this needs and falls back to the nearest one that exists, so
  today `--fwm-ease-mech` runs and the day `--fwm-ease-linear` is added the beam
  is linear with no edit to this feature. `--fwm-ease-linear` does not exist
  yet: the fallback is what runs, and the reference is the request.
- consequence, unchanged until the token lands: the scan line accelerates and
  decelerates once per revolution instead of sweeping evenly. On a full 360 deg
  loop that reads as a stutter at the top of every turn, and it is visible.
- **why this is not fixed here.** Both real fixes are one line in a file this
  feature may not edit: `--fwm-ease-linear: linear;` in section 08 of
  `apps/pwa/src/styles/tokens.css`, or an entry in
  `scripts/design-values-allowlist.json` exempting `linear` for
  `apps/pwa/src/features/sweep/**` under rule `easing`. Writing bare `linear`
  in `sweep.css` without one of those is a raw easing value and
  `scripts/check-design-values.mjs` rejects it (rule `easing`, `RE.easeBare`) --
  and hiding it on a line the rule's `timeContext` guard does not scan would be
  gaming the checker rather than fixing anything.
- preference: the token. A rotation is the one animation that can only honestly
  be linear, so every screen with a spinner needs the same one line; an
  allowlist entry buys SWEEP an exemption and leaves the next screen to
  rediscover the gap.
- options: (1) add the token (preferred, one line, no edit here); (2) allowlist
  `linear` for this feature with a written reason; (3) accept the stutter.

## sweep-duration-derived-from-dur-alert

- need: the animation durations as part of the exported system.
- source: the sweep is 2400ms. `--fwm-dur-alert` (400ms) is the longest duration
  the token set carries.
- stand-in: `--fwm-sweep-dur: calc(var(--fwm-dur-alert) * 6)`, exactly the idiom
  `radar.css` uses for the 1.4s / 1.1s / 1.6s / 1s ring timings.
- options: as in `DESIGN-GAPS.md#animations-are-not-tokens`.

## glow-is-a-box-shadow

- need: a glow that works on an SVG shape.
- source: panel 02 draws the in-range dot with `box-shadow:0 0 12px #FF2D5E`.
  `--fwm-glow-alert` is a `box-shadow` value, and `box-shadow` does not render on
  an SVG shape. `filter: drop-shadow()` would, but it is a raw shadow the token
  set does not model, and the checker rejects it.
- stand-in: a concentric halo circle in the same hue at `opacity: 0.28`, sized
  to the design's 12px spread. Drawn only for an unmuted in-range dot, exactly
  where the design draws the glow.
- options: (1) add an SVG-usable glow token (a `filter` id, or a
  `--fwm-glow-alert-radius` length the halo can read); (2) keep the halo;
  (3) make `--fwm-glow-alert` hue-following so `multiple` and the SWEEP halo can
  share it -- see `docs/gaps-inbox/radar-screen.md#glow-token-is-crimson-only`.

## flagged-operator-dot-not-drawn

- **B9 draws a dot treatment this screen does not draw.**
- need: a field that says whether the OPERATOR of a camera has a record.
- source: `Flockys Screens II.dc.html`, `B9 · ON SWEEP · DOT TREATMENT`
  (lines 757-770), draws two treatments side by side: STANDARD -- a 12px dot
  with its glow -- and FLAGGED OPERATOR -- the same dot centred inside a 20px
  ring with a 2px `#FF5A1F` border and, notably, no glow on the inner dot. The
  rule under it: "The flag colors the operator, not the camera, so a flagged
  agency's cams still alert normally."
- not built. `CameraAssessment` (`packages/core/src/alert.ts:369`) carries id,
  position, distance, bearing, facing, in-range and muted, and nothing about who
  operates the camera or whether that operator has a documented finding. Drawing
  the ring today would mean either inventing the flag or wiring it to a field
  that does not exist, and an orange ring that says "this agency has a record"
  is the last thing on this screen that may be a guess.
- `FEATURES.record` is also `false` -- RECORD is off "until the aggregation
  contract lands and every displayed entry can carry its citation" -- so even
  with a field there would be nothing behind it in this build.
- what it needs, in order: (1) an operator identity on the camera record; (2) a
  RECORD lookup keyed to that operator, with citations, per the product rule
  that nothing appears without a citable published source; (3) then the ring,
  which is a `--fwm-alert-fire`-ish 2px stroke the token set does not carry
  either (`#FF5A1F` is the DESIGN-GAPS.md untokenized-utility-colour set).
- options: (1) file it and draw nothing until the data exists (as built); (2)
  add the operator field and ring now, flagged off behind `FEATURES.record`;
  (3) drop the treatment from B9 if RECORD is never going to reach the dial.

## pierced-mute-dot-treatment-not-drawn

- need: what a re-alerted muted camera looks like on the dial.
- source: `B4` says "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in
  grey" and, in the same block, "RE-ALERT ON MUTED IF closer than 150 ft". The
  design draws the grey dot and never draws the re-alerted one.
- stand-in: it is an in-range dot, with nothing subtracted -- full
  `--fwm-alert-in-range` and the glow. `resolveRadarState()` already resolves a
  pierced mute back to `in_range`, so the dial reads the dot's resolved `hue`
  rather than the mute switch. A dot painted alert crimson with the glow left
  off would say alarming and muted at once, which is the one thing a driver
  cannot act on. The camera's `muted` flag stays true and is still announced.
- options: (1) the in-range treatment exactly (as built); (2) a distinct
  treatment that says "this was muted and we woke it anyway", which would need
  drawing; (3) leave it grey, which contradicts B4's own re-alert rule.

## facing-arc-drawn-for-every-camera

- need: which dots get a facing arc.
- source: SWEEP PRIMITIVES states the arc as a property of a dot ("facing arc:
  60 deg stroke 3px, hue of dot"). Panel 02 draws it on one dot only -- the
  nearest in-range camera -- and leaves the other five bare.
- stand-in: drawn for every dot whose `directionDeg` is known, which in the
  fixtures is most of them. A camera whose facing was never recorded gets no arc
  rather than a guessed one.
- options: (1) every camera with a known facing (as built); (2) in-range
  cameras only, which is what panel 02 literally shows and is quieter; (3) the
  nearest camera only.

## hit-radius-mirrors-touch-min

- need: a tap target for an 11px dot, and a rule for two dots close together.
- source: nothing in the design says how a dot is tapped, only that tapping one
  opens the INTEL CARD. 11px is a quarter of the product's own 44px floor.
- stand-in: an invisible `fill: transparent` circle under each camera dot,
  `DOT_HIT_RADIUS` = 22 dial units across the radius -- 44px, i.e.
  `--fwm-touch-min` -- **clamped by `hitRadiusForDot()` to half the distance to
  the nearest other dot on the dial**. Every point inside a target is then
  closer to its own dot than to any other, so a tap resolves to the dot it was
  aimed at no matter which `<g>` is on top.
- why the clamp is not optional: the target is 4x the width of the dot, it is
  invisible, and SVG has no z-index -- the last group in document order wins a
  hit. `AlertTick.cameras` is nearest first, so without the clamp the FARTHER
  camera's circle sits over the NEARER camera's dot. Two cameras on one bearing
  at 425 ft and 500 ft are 16.5 units apart, well inside 22: tapping the near,
  in-range dot opened the INTEL CARD for the far one. Fixed 2026-08-20;
  `geometry.test.ts` asserts the targets can touch and can never overlap.
- residual: two dots closer than the drawn dots are wide get targets smaller
  than their own cores. The core is inside the button group and still takes the
  tap, so there what is on top is what is tapped -- which is the only honest
  answer when two dots are drawn on top of each other.
- still open, and both are real: (a) 22 units is 44 CSS px only at full dial
  width -- see `dial-scales-below-full-width`; (b) 44px is the PHONE floor.
  `tokens.css` redefines `--fwm-touch-min` to 48px on `watch-round` and 68px on
  `dash-cast`, and an SVG user unit cannot resolve a CSS variable, so those
  surfaces get a target below their own stated floor. `geometry.test.ts` pins
  `DOT_HIT_RADIUS * 2` to the `:root` value so the two cannot drift apart in
  silence, and asserts that the file carries more than one floor so this caveat
  cannot quietly stop being true.
- options: (1) as built -- the constant mirrors the phone floor and the test
  keeps them in step; (2) express the hit circle's `r` as a CSS geometry
  property so it reads the token directly, which links the two names but still
  resolves in user units, so it does not fix the per-surface half; (3) scale the
  dial's viewBox with the surface so a user unit is a CSS pixel everywhere.

## layer-key-36px-below-touch-floor

- same gap as `docs/gaps-inbox/radar-screen.md#radar-header-key-44x36`, for the
  `ROUTE` / `MESH` keys: `02 · SWEEP` draws them `height:36px`, under the
  product's own 44px floor.
- **already settled, and it was settled the other way.**
  [`README.md#touch-target-floor`](./README.md#touch-target-floor)
  names the standing rule for this exact case: "the
  *visual* control keeps the rendered height so the layout matches; the *hit
  area* is expanded to 44px with padding and a transparent extension
  (`::before` inset)."
- built, from 2026-08-20: the key is `height: var(--fwm-sweep-key-h)` (36px,
  `--fwm-space-8 + --fwm-space-1`) and `.fwm-sweep-key::before` extends the hit
  area to `--fwm-touch-min` with `inset-block: calc((var(--fwm-touch-min) -
  var(--fwm-sweep-key-h)) / -2)`. Nothing drawn moves; the target is 44px. The
  earlier `min-height: var(--fwm-touch-min)` also put a 44px key inside a 52px
  header, which conflict 7 exists to avoid.
- **carried to RADAR.** `radar.css` still grows its keys to `--fwm-touch-min`
  (`width` and `height`), which is the resolution conflict 7 rejects, and it is
  another feature's file. It needs the same treatment so the two screens stay in
  step -- reported as shared-file work, not changed from here.
- options: (1) hit-area expansion everywhere, per conflict 7 (built here); (2)
  amend conflict 7 if the intent was really to grow the drawn control, in which
  case RADAR is right and this is wrong -- but the design draws 36px and the
  amendment would have to say so.

## empty-dial-copy-not-drawn

- need: what SWEEP says when there is nothing to draw.
- source: the design draws SWEEP with six dots and never draws it empty,
  denied, loading or stale. The `DESIGN-GAPS.md` entry
  `empty-and-loading-states-mostly-undrawn` covers the general case.
- stand-in: one centred mono line under the legend. Three of the four strings
  are RADAR's, verbatim, because they answer the same question on the same
  device: `location is off.`, `this device has no location service.`,
  `waiting for the first fix.`, `no fix. showing cached cameras only.` The
  fourth is SWEEP's own and is the one that needs a ruling:
  **`nothing within 1000 ft.`** An empty dial with no line on it is a clear road
  as far as the driver can tell, and it might instead be a screen with no data.
- options: (1) approve the line; (2) draw an empty state properly (the design
  system has a card + micro-label vocabulary for it); (3) put the state in the
  dial itself, e.g. the ring labels dimmed and the scan line stopped -- the scan
  line already stops when there is no fix.

## sweep-ring-ft-imported-from-stores-fwmcore

- need: a door for engine constants that screens are allowed to use.
- source: `SWEEP_RING_FT` and `ringForDistanceFt()` live in `packages/core` and
  are documented there as "Convenience for SWEEP". `stores/index.ts` does not
  re-export either, and `stores/fwmCore.ts` is documented as "the one place
  `@fwm/core` is wired into the stores".
- stand-in: `geometry.ts` imports `SWEEP_RING_FT` from `../../stores/fwmCore.ts`
  -- the documented single door -- rather than re-typing the ring list or
  reaching into `packages/core` on a relative path. `ringForDistanceFt()` is not
  used: SWEEP needs a continuous distance-to-radius mapping, not a bucket.
- note: filed rather than fixed because `stores/index.ts` is a shared boundary
  and the change needs a coordinated stores pass.
- options: (1) re-export the engine's design-sourced constants from
  `stores/index.ts`; (2) add `@fwm/core` to `apps/pwa/package.json` so features
  can import the package name; (3) leave the reach as it is.

## known-tally-definition

- need: what `KNOWN 11` counts.
- source: panel 02 shows `IN RANGE 3 · KNOWN 11 · HAKCERS 2` beside a dial with
  six dots on it, so the tally is not "what is drawn".
- stand-in: every camera the engine assessed this tick that is not in range,
  drawn or not (`assessments.length - countInRange`). `IN RANGE` is the engine's
  own `countInRange`, passed straight through and never re-derived, so it counts
  muted cameras exactly as `EXPOSURE` does.
- options: (1) as built; (2) cameras within the dial's 1000 ft only, which would
  make the legend and the dots agree at the cost of a smaller number; (3) every
  cached camera in the loaded tiles, which is the largest reading and the least
  useful.
