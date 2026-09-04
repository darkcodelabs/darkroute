# gap inbox -- RADAR, v2 redesign

> **STALENESS WARNING, added 2026-08-30.** A v2 delta against v0's RADAR, which the default
> design does not render.
>
> `apps/pwa/src/app/registry.v1.tsx:62` maps `radar: DriveScreen`, and v1 is the
> default (`apps/pwa/src/app/design.ts:61`). The v2 screen file this was
> measured against is also not the current design source - v1's is
> `.design-src-v1/FlockysWatchingMe.dc.html`, the `isDrive` block
> (`features/drive/DriveScreen.tsx:4-5`).
>
> The measurements remain a true record of the v2 design file. They do not
> describe a shipped screen.
>
> Read instead: `features/drive/DriveScreen.tsx`, `v1-redesign.md`,
> `docs/STALENESS.md`.

Files: `apps/pwa/src/features/radar/**` (`RadarScreen.tsx`, `components/*.tsx`,
`radar.css`, `radarState.ts`, `scanRate.ts`, `format.ts`).

Source read: `.design-src-v2/Flockys App Screens v2.dc.html` -- screen
`01 · RADAR - IN RANGE` (lines 34-118) and the four-card `RADAR state matrix`
(lines 485-542). Compared line by line against
`.design-src/Flockys App Screens.dc.html` (same two sections) and, for the
telemetry rung and the 4 Hz figure, `.design-src/Flockys Screens II.dc.html`
`A3 · CONNECT` (lines 138-160) and v2's `02 · SWEEP` (lines 120-140).

`docs/gaps-inbox/radar-screen.md` holds the v1 entries. Every one of them is
still open unless it is listed as closed below; this file only carries what v2
changed.

---

## What v2 changed on this screen, in full

Text deltas (2):

- the scope caption `ALERT AT` became `THRESHOLD`;
- three readouts appeared that v1 had no equivalent for -- `LOCK 041°` under
  the threshold numeral, `1000FT` down the scope's left edge, `SCAN 4HZ` down
  its right.

Everything else is a colour, a radius, a fill or a size, which no text diff can
see:

| element | v1 | v2 |
|---|---|---|
| screen title | `17px / .1em` | `19px / .06em`, `white-space:nowrap` |
| `REP` / `SET` keys | `1px #23262F`, radius 2, no fill | no border, `#1B1E25`, radius 8 |
| `VOL` key | `1px #FF2D5E`, radius 2 | `1px #FF2D5E`, radius 8 |
| "3 in range" bar | `1px #FF2D5E`, radius 2, fill `rgba(255,45,94,.08)` | `1px rgba(255,45,94,.55)`, radius 8, fill `rgba(255,45,94,.14)` |
| its mark | an 18x12 rounded block | a 24x24 mask of `assets/darkroute-mark.png` in the hue |
| the ring | 172px, `3px` hue stroke, `box-shadow 0 0 30px`, two 1px inner rings at inset 30 / 60, `fwmRing 1.1s` expanding copy, 16px glowing marker | 250px dot lattice: a 5px grey dot field under a radial vignette, three hue dot-rings at 18% / 32.5% / 47.5% (opacity .34 / .5 / 1), a `.6deg`-per-`15deg` conic tick comb at 50% masked to the rim, two 1px crosshairs at 13% fading in at 32% and out at 68%, `fwmPulse 1.15s` on the rim, a 32x12 bearing pip (9px dot + two 6x1 wings) on the top edge, and no shadow anywhere |
| ring centre | `ALERT AT` 10px / `500` 34px / `FT` 10px, stacked | `THRESHOLD` 9px/.28em / `500` 44px/-.02em beside `FT` 13px on one baseline / `LOCK 041°` 9px/.18em in the hue |
| stat tiles | `1px #23262F`, `#0E0F13`, radius 2 | no border, `#12141A`, radius 6 |
| `REPORT CAMERA / 2 QUEUED` bar | present, above the nav | gone -- absorbed into the shared dock |
| the 5-key nav | a 5-column grid of word keys | one 58px shared dock bar |
| `RETRY LOCK` (matrix card 3) | `1px #3A3F4B`, radius 2, no fill | no border, `#1B1E25`, radius 8 |

The state matrix is otherwise **byte-identical to v1**: the four 140px rings,
their strokes, their glows, their animations and every string in them are
unchanged. `RETRY LOCK` is the only thing in that section the v2 pass touched,
which is what makes "flat borderless controls" a global reading rather than a
screen-01 one.

---

## Closed by the v2 token pass

- `DESIGN-GAPS.md#report-bar-tint-and-alert-tints` -- **closed for this bar.**
  v2 draws the "N in range" fill and its edge, and the two alphas are exactly
  `--fwm-tint-in-range-soft` (14%) and `--fwm-tint-in-range-strong` (55%). The
  bar no longer stands in with `--fwm-surface-1`.
- `docs/gaps-inbox/radar-screen.md#glow-token-is-crimson-only` -- **half
  closed.** `--fwm-glow-clear` and `--fwm-glow-approaching` now exist, so
  `clear` and `approaching` carry their own glows instead of none. `multiple`
  still borrows the crimson one and reads warmer than its own `#FF3DBE`.

---

## scope-dot-lattice-has-no-tokens

- need: a sub-pixel dot family, or a ruling that the space scale is the only
  length source.
- screen: RADAR's 250px scope (v2 `01`), SWEEP's 343px scope, ASK's voice-meter
  field -- every instrument in v2 is built from the same lattice.
- source: `radial-gradient(circle at center, <colour> 0.7px, transparent 1.2px)
  0 0/5px 5px`, with the dot fattened to `0.75/1.25` on the two inner hue rings
  and `0.85/1.35` on the rim. Six lengths, none of them on the 4/8/12/16/24/32/48
  scale, all of them sub-pixel.
- stand-in: six component-scoped locals, each an exact multiple of
  `--fwm-space-1` (4px): `*1.25` = 5, `*0.175` = 0.7, `*0.3` = 1.2,
  `*0.1875` = 0.75, `*0.3125` = 1.25, `*0.2125` = 0.85, `*0.3375` = 1.35. Exact
  at the drawn size, and a mode that rescales space rescales the lattice with
  it -- which is probably wrong: a `dash-cast` head unit wants a *coarser*
  lattice, not a proportionally bigger one.
- options: (1) add a `--fwm-grid-*` family (pitch, dot, feather) and let the
  surface blocks remap it, which is what a 466px watch face and a 1280px head
  unit both need; (2) keep the derivation and accept that the lattice scales
  with spacing; (3) express the lattice in the SVG-style way SWEEP's dial does
  and keep it out of CSS entirely.

## scope-diameter-250px

- need: the component-size family `radar-screen.md#ring-diameter-172px` already
  asks for. v2 moved the number, it did not remove the need.
- screen: RADAR's scope (250px), the four state-matrix cards (140px), SWEEP's
  scope (343px).
- source: `width:250px; height:250px`. Not on the scale, as 172 was not.
- stand-in: `min(100%, calc(var(--fwm-space-12) * 5.2))` = 249.6px, the closest
  a derived value gets, clamped so a narrow surface cannot be overflowed by it.
  0.4px small.
- options: as filed under `ring-diameter-172px`; the new number does not change
  the options, only the multiplier.

## scope-tints-are-hue-locked

- need: hue-following tints, or a ruling that the scope is crimson-only.
- screen: RADAR's scope in all six states. v2 draws it once, in `in_range`
  crimson; the state matrix says the same instrument is green, amber, grey and
  dashed grey in the other four.
- source: the token set carries v2's exact alphas as
  `--fwm-tint-in-range-weak` (13%, commented "RADAR crosshair stops") and
  `--fwm-tint-in-range-line` (50%, commented "RADAR conic ring ticks"). Both
  are `color-mix` over `--fwm-alert-in-range` and cannot follow the state hue.
  `color-mix()` is legal only inside `tokens.css`, so a component cannot derive
  its own.
- stand-in: **neither token is used.** Every scope layer paints
  `var(--fwm-radar-hue)` at full strength and is faded with `opacity` -- .34,
  .5, 1 on the three lattice rings, .5 on the tick comb, .13 on the crosshairs.
  Identical rendering in `in_range`, and correct in the other five states,
  which a fixed crimson tint would not be.
- options: (1) accept `opacity` as the way alpha is expressed on hue-following
  instruments, and delete the two unused tokens; (2) generate the tint family
  per hue (`--fwm-tint-<hue>-weak` x5) so a component can name one; (3) add a
  `--fwm-radar-hue-alpha` indirection that a mode can override.

## in-range-bar-tint-is-hue-locked

- need: the same ruling as above, for the one place the tint tokens ARE used.
- screen: the "N in range" bar. It renders whenever the engine counted
  something inside the threshold, which includes `multiple` and `muted`.
- source: `--fwm-tint-in-range-soft` / `-strong` are crimson. A border and a
  fill cannot both be faded by one `opacity` without a second element, so the
  tokens are used as authored.
- stand-in: the tokens for every state except `muted`, which drops to
  `--fwm-surface-card` and `--fwm-line`. "MUTED · hue desaturates, data stays
  live" is the design's own rule and a crimson wash under a grey label reads as
  an alarm the driver silenced. `multiple` keeps the crimson tint under a
  magenta label, the same mismatch the glow gap describes.
- options: (1) confirm the muted override; (2) draw the fill on a pseudo-element
  so `opacity` can carry it and the bar follows the hue like the scope does;
  (3) tint per hue, as option (2) of the entry above.

## scan-rate-is-measured-not-declared

- need: a ruling on what `SCAN 4HZ` reads on a device with no glovebox node.
- screen: RADAR's scope, right edge. `SCAN 4HZ` at 8px in `#4E5563`.
- source: 4 Hz is the hardware's. "ESP32-S3 · glovebox node · firmware 1.4.2 ·
  streaming at 4 Hz over its own AP" and "±3 M · 4 HZ" -- `DarkRoute Screens
  II.dc.html`, `A3 · CONNECT`. Nothing in this build is paired to a node, and a
  browser's `watchPosition` runs at whatever cadence the platform likes.
  Printing `4HZ` regardless is fabricating instrument data, the same offence
  the SATELLITE COUNT note in `stores/position.ts` refuses.
- stand-in: the rate is measured from the `fixAtMs` timestamps the position
  slice already publishes, averaged over the last 8 (`scanRate.ts`), and reads
  `SCAN -` until there are two. A browser will typically show `SCAN 1HZ`.
- options: (1) confirm the measurement and specify the window; (2) publish a
  `fixRateHz` from the position slice so RADAR does not have to keep its own
  ring buffer -- the right home for it, but a separate stores change; (3) show
  the node's advertised rate when paired and the measured one
  otherwise, which is two readings in one slot.

## scope-range-does-not-follow-the-threshold

- need: confirmation that the scope's outer ring is fixed.
- screen: RADAR's scope, left edge. `1000FT` at 8px in `#4E5563`.
- source: 1000 ft is `APPROACHING_OUTER_FT` -- the outer edge of the band the
  state matrix labels "APPROACHING · 1 pulse @ 1000ft", and the distance at
  which the hero readout switches to miles. The threshold in the scope's centre
  is the driver's and defaults to 500.
- stand-in: `SCOPE_RANGE_FT = APPROACHING_OUTER_FT`, fixed. A scope whose outer
  ring moved every time the alert distance changed would make the three rings
  unreadable as a scale, and `ALERT_THRESHOLD_MAX_FT` is 1000, so the threshold
  can never fall outside it.
- options: (1) confirm; (2) label the three rings individually (SWEEP labels
  four: 1000 / 500 / 300 / 100) so the scale is explicit rather than implied by
  one edge label; (3) make the scope zoom with the threshold and re-label.

## screen-title-19px-has-no-step

- need: a type step between `--fwm-text-subtitle` (17px) and `--fwm-text-title`
  (24px).
- screen: every v2 screen header -- `RADAR`, `SWEEP`, `LOOKUP`, `ASK`, `LOG`,
  `REPORT`. All six render 19px.
- source: v2 grew the screen title from 17px to 19px and dropped the tracking
  from `.1em` to `.06em`. The ramp has nothing at 19.
- stand-in: `--fwm-text-subtitle`, 2px small, with v2's `.06em` tracking.
- options: (1) add `--fwm-text-screen: 1.1875rem` (19px) -- it is used six
  times, which is more than some existing steps; (2) move
  `--fwm-text-subtitle` to 19px and check the four other places it is used;
  (3) accept 17px everywhere.

## scope-unit-13px-has-no-step

- need: the type steps `radar-screen.md#unit-and-readout-steps-missing` already
  asks for; v2 added two more sizes to the same gap.
- screen: the scope's centre -- `500` at 44px (v1: 34px) and `FT` at 13px
  (v1: a 10px cap under the numeral).
- source: the ramp is 11 / 15 / 17 / 24 / 40 / 80. 13 and 44 both fall in gaps.
- stand-in: `--fwm-text-readout` (40px) for the numeral, 4px small; and
  `--fwm-text-body` (15px) for the unit, 2px large. `--fwm-text-micro` (11px)
  is equally close to 13 but would flatten it into the same rung as the
  `THRESHOLD` caption above it, and v2 draws two distinct rungs there.
- options: as filed under `unit-and-readout-steps-missing`.

## instrument-type-8px-has-no-step

- need: a rung below `--fwm-text-micro` for scope telemetry, or a ruling that
  11px is the floor and telemetry gets it.
- screen: RADAR's `1000FT` / `SCAN 4HZ`; SWEEP's `SCAN 2.4s / RES 12PX /
  SRC MESH+DB` and `HDG 041° / LAT 39.0997 / LON -84.5786`; SWEEP's camera
  callouts. All 8px, all `#4E5563` (`--fwm-text-instrument`, which v2's token
  pass did add).
- source: v2 renders 8px in eleven places. `--fwm-text-micro` is 11px and the
  design system's own stated phone floor is 11px, so the design contradicts
  itself and `DESIGN-GAPS.md#micro-type-below-stated-floor` is already open on
  the 9px and 10px cases.
- stand-in: `--fwm-text-micro` (11px). RADAR's two labels therefore read 3px
  larger than drawn and hang further into the gutter beside the scope; both
  still fit inside the 343px body at the 250px scope width.
- options: (1) rule that 8px telemetry is decoration and may go below the
  floor, and add `--fwm-text-instrument-size`; (2) hold the floor and accept
  the chunkier labels; (3) drop the telemetry labels on phone surfaces and keep
  them for the dash/head-unit surfaces where 8px is comfortably legible.

## no-glow-on-the-scope-vs-glow-in-the-matrix

- need: a ruling on whether the matrix's lit rings survive v2's flat scope.
- screen: RADAR. v2's screen 01 draws **no `box-shadow` at all** -- v1's
  `0 0 30px` on the ring and `0 0 14px` on the marker are both gone. The state
  matrix, which v2 did not redraw, still glows three of its four rings.
- source: two files, one instrument, and the precedence rule says v2 wins where
  they disagree.
- stand-in: the glow survives on the bearing pip alone -- the one solid-hue
  element a masked lattice leaves to carry it -- and now follows the state hue
  through `--fwm-glow-clear` / `--fwm-glow-approaching` / `--fwm-glow-alert`.
  Dropping it entirely would have deleted a piece of the state vocabulary v2
  never re-authored and orphaned two tokens the v2 pass just added.
- options: (1) confirm the pip; (2) redraw the state matrix as four scopes and
  settle what a green, an amber and a grey lattice look like -- the matrix is
  the only place four of the six states are drawn at all; (3) declare the glow
  dead and delete `--fwm-glow-clear` / `--fwm-glow-approaching`.

## no-gps-collapses-the-scope

- need: what a scope looks like with no position behind it.
- screen: RADAR in `no_gps`. v2 draws the scope only for `01 · RADAR - IN
  RANGE`; matrix card 3 is a 140px `3px dashed #3A3F4B` circle with `NO GPS` in
  it and no marker.
- source: v2 is silent. Every lattice layer, the tick comb, both crosshairs,
  the pip and both telemetry labels are measurements against a position.
- stand-in: `no_gps` renders matrix card 3 and nothing else -- the dashed
  circle and the state word. The rest of the scope is not drawn, on the same
  principle as the `clear`-with-no-camera-data branch: an instrument that looks
  live with nothing behind it is a claim the app cannot make.
- options: (1) confirm; (2) draw the lattice greyed and static so the
  instrument keeps its shape while it waits, which risks reading as live;
  (3) draw the last-known lattice frozen, which needs a "frozen" affordance the
  design has never specified.

## the-1px-rule-above-the-dock-belongs-to-nobody

- need: an owner for the hairline between the screen body and the dock.
- screen: every v2 screen. `<div style="flex:none; border-top:1px solid
  #23262F">` sits between the body and the dock's 12px padding block, and in v2
  it is EMPTY -- in v1 it wrapped the `REPORT CAMERA` bar and the 5-key nav.
- source: v2 lines 108-110 (RADAR), and the same empty wrapper on all five dock
  screens.
- stand-in: none. `RadarView` does not draw it: the shell owns everything below
  the screen body, and RADAR has never rendered its own nav.
- options: (1) the dock draws its own top rule; (2) the shell draws it once,
  under whichever screen is mounted; (3) it is a mock artefact of the v1 markup
  and should not ship at all.

---

## Knock-on: the offline screen inherits the flat action

`OfflineView` reuses `RadarAction` for `RETRY SYNC`, so the v2 treatment on
`.fwm-radar-action` (no border, `--fwm-surface-control`, `--fwm-radius-3`)
changes the offline screen too. That is the intended reading of a global "flat
borderless controls" pass and `A2 · OFFLINE` was not redrawn to say otherwise,
but the offline screen's own card and counter rules still carry 1px `--fwm-line`
edges, so that screen is now half-flat. It needs the same pass, and
`offline.css` needs its own coordinated pass.
