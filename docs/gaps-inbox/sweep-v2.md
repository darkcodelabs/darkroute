# gap inbox -- SWEEP, v2 redesign

> **STALENESS WARNING, added 2026-08-30.** Same defect as `sweep.md`, one generation later:
> this is a delta against a screen that no longer exists.
>
> SWEEP was merged into RADAR on 2026-08-20. `SweepScreen.tsx` is gone, `sweep`
> is in neither registry (`apps/pwa/src/main.tsx:100-132`,
> `apps/pwa/src/app/registry.v1.tsx:55-127`), and
> `apps/pwa/src/app/screenState.ts:157-159` redirects the id to `radar`. The
> header above also names `glyph.ts`, which does not exist in
> `features/sweep/` either.
>
> The v2 measurements are still a true record of what the v2 design file draws.
> They are not a description of a shipped screen, and the default design is not
> v2 - it is v1 (`apps/pwa/src/app/design.ts:61`).
>
> Read instead: `radar-sweep-merge.md`, then `docs/STALENESS.md`.

Historical file set: `apps/pwa/src/features/sweep/**`. `SweepScreen.tsx` and
`glyph.ts` named by the original record are deleted; the surviving implementation
lives in `components/*.tsx`, `sweep.css`, `geometry.ts`, `telemetry.ts`,
`sweepState.ts`, `zoom.ts` and `pinch.ts`.

Source read: `.design-src-v2/Flockys App Screens v2.dc.html` -- screen
`02 · SWEEP` (lines 120-202). Compared line by line against
`.design-src/Flockys App Screens.dc.html` (same screen, lines 119-180),
`.design-src/Flockys Design System.dc.html` `SWEEP PRIMITIVES`, and
`.design-src/Flockys Screens II.dc.html` `B4` / `B9`.

`docs/gaps-inbox/sweep.md` holds the v1 entries. Every one of them is still
open unless it is listed as closed below; this file only carries what v2
changed.

---

## What v2 changed on this screen, in full

Text deltas (2 groups):

- two camera CALLOUTS appeared that v1 had no equivalent for --
  `FWM-0442` over `425FT`, and `FWM-0118` over `610FT`, hung outward from the
  two crimson markers;
- a six-line TELEMETRY block appeared in the scope's two bottom corners --
  `SCAN 2.4s` / `RES 12PX` / `SRC MESH+DB` on the left, `HDG 041°` /
  `LAT 39.0997` / `LON -84.5786` on the right.

Everything else is a colour, a radius, a fill, a mask or a size, which no text
diff can see:

| element | v1 | v2 |
|---|---|---|
| screen title | `17px / .1em` | `19px / .06em`, `white-space:nowrap` |
| `ROUTE` / `MESH` keys | `1px #23262F`, radius 2 | `1px #23262F`, radius 8 -- the edge KEPT |
| the scope | 311px, `1px #23262F` edge, three `1px #16181E` inner circles at inset 34 / 78 / 118 | 343px, no edge: a 5px `#232731` dot lattice under a radial vignette, four `#22C8E0` dot rings masked at 10% / 21% / 34% / 48.5% (opacity .3 / .34 / .4 / .6, the rim on a fatter dot), a `.4deg`-per-`5deg` tick comb at 42% and a `1deg`-per-`30deg` one at 70%, and two 1px crosshairs at 12% fading in at 28% and out at 72% |
| the scan wedge | `74deg`, `rgba(34,200,224,.3)` | `66deg`, `rgba(34,200,224,.2)` |
| ring labels | 9px `#3A3F4B`, no tracking, on their rings | 9px `#5C6472` at `.08em`, at `top:6/46/92/132` -- on none of its own rings |
| the ego marker | a 16x18 arrow at `margin:-9px 0 0 -8px` | an 18x20 arrow at `margin:-11px 0 0 -9px`, inside a 44px `rgba(247,249,252,.18)` ring |
| in-range camera | an 11px dot + `box-shadow:0 0 12px`, and a 29px 3px facing ring | an 8px dot inside a 34x34 RETICLE -- four 9x9 corners at 1.5px. No glow. No facing arc |
| known camera | an 11px `#FFC02E` dot | a 7px dot inside a 20x20 `rgba(255,192,46,.35)` ring |
| flocky ghost | an 11px `#8A6BFF` dot at 60% | an 11px `1.5px dashed #8A6BFF` circle at 65%, no fill |
| the intel card | radius 2 | radius 6 -- drawn by the INTEL CARD screen, not by SWEEP |
| `REPORT CAMERA / 2 QUEUED` bar | present, above the nav | gone -- absorbed into the shared dock |
| the 5-key nav | a 5-column grid of word keys | one 58px shared dock bar |

The legend (`IN RANGE 3 · KNOWN 11 · HAKCERS 2`) and the intel card's own copy
are **byte-identical to v1**.

---

## Closed by the v2 token pass

- `docs/gaps-inbox/sweep.md#glow-is-a-box-shadow` -- **closed, by deletion.**
  v2 draws no glow on this screen at all; the halo the entry describes was
  replaced by the reticle, so there is nothing left to express as a box-shadow.
- `DESIGN-GAPS.md` on the eleven `color-mix()` blend steps -- **closed.** The
  token pass moved them into `tokens.css` as `--fwm-blend-0` .. `--fwm-blend-10`
  and `sweep.css` now names the tokens. The feature holds no colour function.
- The ring-label colour -- **closed.** v1's labels stood in with
  `--fwm-text-disabled`; `--fwm-text-scale` now exists and its own comment names
  these four labels.
- The scope's tints -- **closed for this screen.** `--fwm-tint-scan-weak` /
  `-soft` / `-ring` / `-strong` and `--fwm-tint-text` are used as authored, and
  each of their comments names the element it is used on.

---

## ring-scale-moved-with-the-v2-scope

- need: confirmation that the ring RADII are meant to move, and that 10 / 21 /
  34 / 48.5 % are `farthest-corner` percentages.
- screen: v2's `02 · SWEEP` scope, all four rings.
- source: v1 placed the rings with `inset:118/78/34/0` inside a 311px dial --
  radii 37.5 / 77.5 / 121.5 / 155.5, the outer one ON the rim. v2 places them
  with `mask: radial-gradient(circle at center, transparent A, #000 P,
  transparent B)`. A `radial-gradient(circle at center, ...)` sizes itself
  `farthest-corner`, so on a 343px square 100% is 242.54px, and the four rings
  land at 24.25 / 50.93 / 82.46 / 117.63 -- all four TIGHTER than v1's, with an
  empty rim outside the outer ring.
- stand-in: the mask percentages are the scale. `geometry.ts` derives every
  ring radius as `MASK_REACH * pct` with `MASK_REACH = DIAL_UNITS * sqrt(1/2)`,
  and `geometry.test.ts` reads `sweep.css` and asserts the same four stops are
  drawn there, so the two halves cannot drift. A camera at 500 ft lands on the
  ring drawn at 34%.
- why it matters: reading the stops as a fraction of the RADIUS instead -- the
  intuitive reading -- pulls every ring in by 29% and puts every camera on a
  scale nobody drew, silently. RADAR's v2 scope is the same construction at
  18 / 32.5 / 47.5%, which is what makes the wide dark rim a deliberate v2 look
  rather than an artefact of this screen.
- options: (1) confirm the percentages and the reach; (2) state the ring radii
  in pixels in the design file so no one has to know what `farthest-corner`
  means; (3) restore v1's outer-ring-on-the-rim relationship and re-mask.

## scope-diameter-343px

- need: the component-size family `radar-screen.md#ring-diameter-172px` and
  `radar-v2.md#scope-diameter-250px` already ask for. v2 moved the number
  again, it did not remove the need.
- screen: SWEEP's scope. `width:343px; height:343px`.
- source: 343 is the 375px frame less the body's 16px padding on each side. Not
  on the space scale.
- stand-in: `min(100%, calc(var(--fwm-space-12) * 7.15))` = 343.2px, the closest
  a derived value gets, clamped so a narrow surface cannot be overflowed by it.
  0.2px large. The SVG viewBox is 343 to match, so one user unit is one CSS
  pixel at full width.
- options: as filed under `ring-diameter-172px`.

## scope-dot-lattice-has-no-tokens

- need: the same sub-pixel dot family `radar-v2.md#scope-dot-lattice-has-no-tokens`
  asks for. Filed again because SWEEP uses a fifth and sixth weight RADAR does
  not.
- screen: SWEEP's 343px scope -- the grey field and the four hue rings.
- source: `radial-gradient(circle at center, <colour> 0.7px, transparent 1.2px)
  0 0/5px 5px` for the field, `0.75/1.25` on the three inner rings and
  `0.8/1.3` on the rim. Seven lengths, none on the 4/8/12/16/24/32/48 scale,
  five of them sub-pixel.
- stand-in: seven component-scoped locals, each an exact multiple of
  `--fwm-space-1` (4px): `*1.25` = 5, `*0.175` = 0.7, `*0.3` = 1.2,
  `*0.1875` = 0.75, `*0.3125` = 1.25, `*0.2` = 0.8, `*0.325` = 1.3. Exact at the
  drawn size, and the same derivation RADAR's v2 pass reached independently.
- options: as filed under `radar-v2.md#scope-dot-lattice-has-no-tokens`. Note
  that RADAR's rim is `0.85/1.35` and SWEEP's is `0.8/1.3`; a shared
  `--fwm-grid-*` family would have to carry both or pick one.

## v2-ring-labels-do-not-sit-on-v2-rings

- need: a ruling on where the four scale labels belong.
- screen: SWEEP's scope. `1000` / `500` / `300` / `100` at `top:6/46/92/132`.
- source: v1 put each label 8px under its own ring and the four lined up
  exactly. v2's four rings are at 53.9 / 89.1 / 120.6 / 147.3 from the top of
  the scope and its four labels are at 6 / 46 / 92 / 132 -- the labels are
  evenly spaced down the axis and the rings are not, so no label sits on the
  ring it names. The `1000` label is 48px above the ring it labels.
- stand-in: **v1's relationship is kept.** `ringLabelY()` puts each label 15
  units inside its own ring wherever that ring is, so the label rides the scale.
  A scale label that is not on its scale line is not a scale, and this screen's
  whole job is letting a driver read a distance at a glance.
- options: (1) confirm that the labels follow the rings; (2) reposition the v2
  rings so the drawn label positions are correct and re-derive the ring scale
  from them, which would move every camera; (3) drop the ring labels and state
  the range once, as RADAR does with `1000FT` down its edge.

## in-range-glow-replaced-by-a-reticle

- need: confirmation that the in-range camera loses its halo.
- screen: the two crimson markers in v2's scope.
- source: v1 drew `width:11px; background:#FF2D5E; box-shadow:0 0 12px #FF2D5E`
  plus a 29px 3px clipped ring. v2 draws a 34x34 box holding an 8px dot and four
  9x9 corners at `1.5px`, and no shadow anywhere on the screen.
- stand-in: the reticle is built, the glow is deleted. Same element, two
  treatments, later file wins. A PIERCED mute still gets the whole in-range
  treatment -- the reticle now, rather than the glow -- because it resolves back
  to `in_range` and a crimson marker with the alert furniture stripped off would
  say alarming and muted at once.
- options: (1) confirm; (2) keep both -- a reticle over a halo -- which is what
  `--fwm-glow-alert` still exists for; (3) reserve the reticle for the NEAREST
  in-range camera and leave the rest as plain dots, which is closer to what v2
  actually drew (two crimson markers, two labels, one intel card).

## facing-arc-not-redrawn-in-v2

- need: a ruling. This is the one place v2's silence and v2's redraw overlap.
- screen: the in-range marker. v1 drew a 29px ring with a 3px stroke clipped to
  the top 40%, which is the FACING ARC from SWEEP PRIMITIVES ("facing arc:
  60 deg stroke 3px, hue of dot"). v2's marker has corner brackets and no arc --
  on the same camera, whose intel card still says `FACING: SW`.
- stand-in: **the arc is kept**, at v1's radius 13, inside v2's 34-unit reticle
  box. It is the only mark on this screen that says which way a lens points,
  which is the difference between a camera that can see the driver and one that
  cannot; the reticle carries no such information and is not a substitute for
  it. Read as "v2 redrew the marker's ALERT furniture and did not redraw its
  DATA furniture", which is the reading that does not delete a capability.
- options: (1) confirm the arc stays; (2) confirm v2 meant to drop it and delete
  it, which also deletes `facingDeg` from this screen; (3) restate the arc in
  v2's vocabulary -- e.g. brighten the two reticle corners on the facing side --
  so the mark is v2's and the information survives.

## marker-tints-are-hue-locked

- need: hue-following tints, or a ruling that the known-camera ring is amber
  only.
- screen: the two amber markers. `border:1px solid rgba(255,192,46,.35)`.
- source: `--fwm-tint-approaching-ring` is exactly that 35%, and its comment
  names this ring. But it is a `color-mix` over `--fwm-alert-approaching` and
  cannot follow `--fwm-sweep-hue`, and this ring has to: a muted or aged-out
  camera must not keep an amber ring under a grey face. `color-mix()` is legal
  only inside `tokens.css`, so a component cannot derive its own.
- stand-in: **the token is not used.** The ring paints `var(--fwm-sweep-hue)` at
  full strength and the 35% is carried by `opacity` -- identical rendering in
  `approaching`, and correct in the other five states, which a fixed amber tint
  would not be. Same resolution `radar-v2.md#scope-tints-are-hue-locked` reached.
- options: (1) accept `opacity` as the way alpha is expressed on hue-following
  marks, and delete the unused token; (2) generate the tint family per hue; (3)
  add a `--fwm-sweep-hue-alpha` indirection a mode can override.

## route-mesh-kept-its-border

- need: confirmation, because it contradicts v2's own subtitle.
- screen: SWEEP's header pair. `height:36px; padding:0 12px; border:1px solid
  #23262F; border-radius:8px`.
- source: v2 is titled "flat borderless controls, 8px radius, fill-based depth",
  and it did strip RADAR's `REP` / `SET` down to a `#1B1E25` fill with no edge.
  SWEEP's pair took the 8px radius and kept the 1px `#23262F`.
- stand-in: the border stays and the radius moves to `--fwm-radius-3`. The panel
  is the authority for the panel.
- options: (1) confirm the two screens differ; (2) make SWEEP's pair match
  RADAR's -- `--fwm-surface-control`, no edge -- which is a one-line change here;
  (3) state a global control spec so no screen has to be read individually.

## instrument-type-8px-has-no-step

- need: a type step below `--fwm-text-micro` (11px). RADAR's v2 pass filed the
  same shortfall for the same rung.
- screen: v2's telemetry corners (8px, `.14em`), the camera callouts (8px,
  `.06em`), and the ring labels (9px, `.08em`).
- source: the ramp is 11 / 15 / 17 / 24 / 40 / 80. There is nothing at 8 or 9,
  and `--fwm-text-micro` is already flagged as below the design system's own
  stated type floor (`DESIGN-GAPS.md#micro-type-below-stated-floor`).
- stand-in: `--fwm-text-micro` for all three, 2-3px large. The callout and the
  telemetry therefore render larger relative to the scope than v2 draws them,
  and the telemetry block is wider than the corner v2 reserved for it.
- options: (1) add `--fwm-text-instrument-size: .5rem` (8px) and use it for
  every 8px instrument string across RADAR and SWEEP -- it is drawn 10+ times;
  (2) rule that 8px is below the legibility floor for a driving screen and that
  11px is the correct override, and record it as an intentional divergence;
  (3) scale the whole scope's type with the scope, in SVG units.

## res-12px-is-not-sourced-by-anything

- need: a ruling on what `RES 12PX` reads on a device.
- screen: SWEEP's scope, bottom left, third line.
- source: v2 writes it as chrome. Nothing in this build measures a raster
  resolution: there is no basemap, no tile, no camera feed, and the scope is
  vector. Printing a fixed `12PX` is the same category of claim as `SCAN 4HZ`
  on RADAR, which `radar-v2.md#scan-rate-is-measured-not-declared` refused, and
  as the satellite count `stores/position.ts` refuses.
- stand-in: **drawn as written**, in `telemetry.ts` with the reason recorded
  next to it. It describes the INSTRUMENT rather than the world, so unlike a
  satellite count it cannot mislead a driver about a camera -- but it is the one
  number in either block that is not measured, and the other two lines beside it
  are (`SCAN` is the animation that actually runs; `SRC` follows the feed).
- options: (1) confirm it is nameplate text and leave it; (2) give it a meaning
  the app can measure -- feet per scope pixel at the current range is the
  obvious one, and would change with the range control; (3) drop the line and
  leave the corner two lines deep.

## conic-wedge-70-vs-66

- need: a ruling on which of three numbers the wedge is.
- screen: the rotating scan line.
- source: three sources, three answers. `SWEEP PRIMITIVES` says
  "sweep 70 deg conic, 2.4s linear". v1's `02 · SWEEP` renders `74deg`. v2's
  renders `66deg`. The build instruction this feature was written to names
  70 deg.
- stand-in: **70 deg.** The explicit instruction is highest under the public
  [source-authority rule](./README.md#source-authority) and outranks a design file;
  v2 outranks v1 and the design system, but not authority 1. The ALPHA is
  taken from v2 (`--fwm-tint-scan-soft`, 20%, whose comment names this element).
- options: (1) confirm 70; (2) rule that v2 supersedes the build instruction too
  and move to 66; (3) put the wedge angle in the token set so all three screens
  that draw a sweep agree.

## marker-face-is-the-glyph-not-v2s-dot

- need: confirmation that the camera GLYPH override survives the v2 redesign.
- screen: every camera marker.
- source: v1 and v2 both draw a plain filled dot -- 11px in v1, 8px inside the
  reticle in v2. A later build briefly drew an emoji camera glyph; the current
  `SweepDial.tsx` draws a plasma-weighted circular contact instead.
- stand-in: superseded. The glyph, reticle and ring were removed because the
  emoji ignored theme colour and overlapping furniture obscured dense roads.
- options: (1) confirm; (2) size v2's reticle to the glyph, which grows to 26
  units at the centre and can reach the 34-unit bracket box; (3) drop the glyph
  and take v2's 8px and 7px dots.

## callout-labels-only-the-in-range-cameras

- need: a rule for when a marker gets a callout.
- screen: v2 labels its two crimson markers and neither of its two amber ones.
- source: `FWM-0442 / 425FT` and `FWM-0118 / 610FT`. Note that `610FT` is
  outside the drawn 500 ft ring and the marker for it is crimson -- so "in
  range" in v2's mock is not the same cut as the ring scale.
- stand-in: labelled when `hue === 'in-range'`, which is the engine's answer and
  not a distance the screen re-derives. The label hangs OUTWARD from the scope's
  centre, which is what v2 does with its two (`right:38px` on the left marker,
  `left:38px` on the right one).
- options: (1) confirm "in range only"; (2) cap the number of callouts -- eight
  in-range cameras would fill the scope with type at the moment a driver has
  least attention; (3) label the nearest camera only, and let the intel card
  carry the rest.

## range-control-not-drawn-by-v2

- need: nothing new. Recorded so the next pass does not read the range slider as
  a v2 element.
- screen: the control under the scope.
- source: neither v1 nor v2 draws a range control of any kind; the scope is
  fixed at 1000 ft in both. The slider and the pinch gesture are a product
  addition (`zoom.ts`, `pinch.ts`).
- stand-in: the slider uses v2's own control vocabulary --
  `--fwm-surface-control` at `--fwm-radius-3` -- rather than a second visual
  language. It changes what the ring LABELS say; the ring RADII are v2's mask
  stops and do not move for it, so v2's scope is drawn identically at every
  range.
- options: (1) confirm; (2) draw the control in a future design file so it stops
  being derived; (3) show the current range in the telemetry corner, where v2
  already prints instrument state, instead of above the slider.

## checker-masks-comments-wrongly-after-a-template-literal

- need: a fix in `scripts/check-design-values.mjs`. **Not this feature's file --
  reported, not changed.**
- what: `maskComments()` leaves template-literal mode at `${` and never
  re-enters it at the matching `}`, so the literal's CLOSING backtick is read as
  an OPENING one. After an odd number of `${`-bearing template literals the
  masker is stuck in string mode and stops blanking `/* */` comments -- so a
  doc comment that mentions `9px` or `2.4s` is reported as a violation, and,
  worse, a real raw value inside a template literal after the desync is NOT
  reported.
- evidence: `geometry.ts` reported 14 `length` violations, every one of them
  inside a JSDoc block, all of them downstream of four adjacent template
  literals in `reticlePath()`. Rewriting that function to join an array made all
  14 disappear with no change to any comment.
- stand-in in this feature: no `${}` template literal is used where an array
  join will do, which is also how `facingArcPath()` was already written.
- fix: track a brace depth on entering `${` and return to template mode when it
  returns to zero.
