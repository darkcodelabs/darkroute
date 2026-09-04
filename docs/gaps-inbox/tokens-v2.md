# gap inbox -- the v2 token delta

> **STALENESS WARNING, added 2026-08-30.** This measures the v2 token layer as though it were
> the end state. It is not - a whole v1 layer sits on top of it.
>
> `apps/pwa/src/styles/tokens.css:996` opens `[data-fwm-design="v1"]`, which
> remaps the palette for the shipped default
> (`apps/pwa/src/app/design.ts:61`). Below it are seven per-mode blocks
> (`tokens.css:1177` night-watch through `:1393` paper) and the glass, tone and
> clear families (`:1439`-`:1517`), none of which existed when this was
> written. `:root` is deliberately still the v0 palette
> (`app/design.ts:36-42`), so the values tabulated here are the ones v0 uses,
> not the ones a driver sees.
>
> The v1 layer also introduced two tokens this file cannot know about,
> `--fwm-rule-w` and `--fwm-mark-w`, promoted to `:root` after five v1 screens
> were found referencing a `.fwm-settings`-scoped local that resolved to
> nothing (`v1-redesign.md`, "bugs this work found").
>
> The measured v1-vs-v2 diff below is still a true record of the two design
> files. Read instead: `apps/pwa/src/styles/tokens.css` from line 960,
> `docs/STALENESS.md`.

Files: `apps/pwa/src/styles/tokens.css`, `apps/pwa/src/styles/tokens.json`,
`scripts/design-values-allowlist.json`.

Source read: `.design-src-v2/Flockys App Screens v2.dc.html` in full (544
lines), diffed value-by-value against `.design-src/Flockys App Screens.dc.html`,
`.design-src/Flockys Design System.dc.html` section 08, and the `:root` block
that shipped before this pass.

The v2 file's own subtitle is the brief: **"v2 - flat borderless controls, 8px
radius, fill-based depth"**. Measured, that is 148 border declarations down to
72, zero `radial-gradient` up to 43, zero mask declarations up to 56, and a
radius scale that no longer contains a single one of the values section 08
declares as the whole scale.

## What actually changed, measured

| dimension | v1 screens | v2 screens | token action |
|---|---|---|---|
| border declarations | 148 | 72 | none -- fills carry depth now |
| distinct radii | `2px` x41, `999px` x43 | `8px` x30, `999px` x28, `6px` x12, `14px` x5, `10px` x5, `3px` x1 | 4 new radius tokens |
| distinct hex | 15 | 28 | 13 new colour tokens |
| distinct `rgba()` | 8 | 22 | 16 derived tint tokens + 2 glows |
| `radial-gradient` | 0 | 43 | 3 grid-dot tokens + 3 mask ramps |
| mask declarations | 0 | 56 | `--fwm-mask-*` |
| drawn type steps | 22 | 24 (adds `8px`, `44px`) | none -- existing convention |
| drawn spacing steps | 22 | 23 (adds `7px`) | none -- existing convention |

`#0E0F13` -- `--fwm-surface-1` -- is drawn **zero** times in v2. `#FF3DBE` --
`--fwm-alert-multiple` -- is also drawn zero times, consistent with
`DESIGN-GAPS.md#multiple-state-never-rendered`.

## radius-scale-contradicts-section-08

**This is the contradiction the pass was asked to record.**

- **Section 08 says:** the radius scale is `--fwm-radius-0: 0`,
  `--fwm-radius-1: 2px`, `--fwm-radius-2: 6px`, `--fwm-radius-full: 999px`.
  Four steps. The design system draws nothing else and offers nothing else.
- **v2 draws:** `8px` x30, `999px` x28, `6px` x12, `14px` x5, `10px` x5,
  `3px` x1 -- and **never draws `2px` at all**, the one non-zero step v1's
  screens used 41 times.
- So section 08 declares four radii; v2 uses six, of which four are undeclared,
  and drops one of the two the previous screens used.
- The designer's own precedence rule settles it: "if the brief and a screen
  file disagree, the screen file wins". v2 is the later screen file, so the
  token set deliberately diverges from section 08 here.

**What I did.** Added `--fwm-radius-3: 8px`, `--fwm-radius-4: 10px`,
`--fwm-radius-5: 14px` and `--fwm-radius-glyph: 3px`. `--fwm-radius-0`, `-1`,
`-2` and `-full` keep their section 08 values and meanings, untouched.

**Why extend rather than renumber.** `3px` sits *between* `--fwm-radius-1`
(2px) and `--fwm-radius-2` (6px). Slotting it in as an ordinal would have
renumbered every step above it, silently changing what `--fwm-radius-2` means
in `cartridge-96` and `dash-cast`, which both override it by name. So the
ordinal ladder only grows upward and the one sub-scale value gets a role name,
matching how `--fwm-radius-full` is already named by role rather than index.
`--fwm-radius-glyph`'s single site is the 16x12 camera body drawn inside
REPORT's `PHOTO` key -- a drawn glyph, not a control.

**Options.**

1. Keep the extension (shipped). Section 08 is stale on radius; v2 is the
   scale.
2. Rewrite section 08's scale to `0 / 3 / 6 / 8 / 10 / 14 / full` and reissue
   the design system, so the two files stop disagreeing. Needs a design call.
3. Snap `10px` and `14px` down to `8px` and drop `3px`, holding a three-step
   scale. Cheapest system, visibly flattens the dock -- the bar and its active
   chip would share one corner radius, which is the one place v2 uses a radius
   *difference* to separate two nested surfaces.

## new-radii-have-no-cartridge-96-or-dash-cast-value

- **need:** per-mode values for `--fwm-radius-3/4/5/glyph`.
- **source:** `cartridge-96` collapses the radius scale -- it sets
  `--fwm-radius-1: 2px` and `--fwm-radius-2: 2px`, i.e. every finite radius the
  system had becomes 2px, which is the whole point of a mode named after a
  cartridge bezel. `dash-cast` goes the other way and raises
  `--fwm-radius-2: 8px`. Neither block mentions the four new tokens, because
  neither block knew about them.
- **consequence today:** in `cartridge-96` the v2 dock bar keeps its 14px
  corners and every control keeps 8px, while cards go square at 2px -- the mode
  reads broken, not stylised. In `dash-cast` the new radii simply don't scale
  with the rest.
- **stand-in:** none. The four tokens resolve to their `:root` values in all six
  modes. I did **not** hardcode a mode value, because no design source supplies
  one and the brief is explicit that a new token needing a per-mode value gets
  reported rather than guessed.
- **the derivation, if someone wants to land it:** `cartridge-96` uses exactly
  one radius value, `2px`, for every token it touches, so extending that block
  with `--fwm-radius-3: 2px; --fwm-radius-4: 2px; --fwm-radius-5: 2px;
  --fwm-radius-glyph: 2px;` introduces no number that is not already in the
  block. That is a one-line change and needs only a yes.
- **`dash-cast` has no such derivation** -- it raises `6px` to `8px`, and any
  matching value for 8/10/14 would be a number invented from nothing.
- **options:** (1) land the `cartridge-96` extension above and leave `dash-cast`
  open; (2) get both blocks authored in section 08; (3) declare the new radii
  mode-invariant, which contradicts "a mode may change ... radius".

## in-range-text-needs-five-mode-values

- **need:** a per-mode value for `--fwm-alert-in-range-text` (`#FF8DA5`).
- **source:** v2 draws it twice, both times as the label of a chip whose fill is
  the in-range tint -- LOOKUP's active plate chip and REPORT's selected
  `POLE MOUNT` tag. It is a lighter tint of `#FF2D5E`, so it is hue-locked.
- **consequence:** the four-state hue logic says a mode remaps the in-range hue.
  `neon-grid` makes in-range `#FF2BC2`, `pursuit` `#FF1E2D`, `cluster`
  `#FF7A18`, `cartridge-96` `#FF6B4A`. A pink `#FF8DA5` label on a magenta or
  orange tint is the wrong hue in four of the six modes.
- **stand-in:** the `:root` value only -- and `:root` **is** night-watch by
  construction (`DESIGN-GAPS.md#night-watch-has-no-block`), so this is the
  night-watch value standing in for the other five, which is exactly what the
  brief said not to silently do. Recording it here instead.
- **options:**
  1. derive it -- `color-mix(in srgb, var(--fwm-alert-in-range) 62%, var(--fwm-text))`
     lands within a point or two of `#FF8DA5` on night-watch and follows every
     mode automatically. The mix percentage would be reverse-engineered from
     the drawn colour, i.e. a value the design never stated.
  2. author five mode values in section 08 -- most faithful, needs design.
  3. use `var(--fwm-alert-in-range)` for the label and let the chip rely on its
     border for separation -- loses the readability the lighter tint buys on a
     13%-alpha fill.

## surface-1-is-drawn-nowhere-in-v2

- **need:** a decision on whether `--fwm-surface-1` is superseded.
- **source:** `#0E0F13` appears 53 times in the design system and 11 times in
  the v1 screens. It appears **zero** times in v2. The role it filled -- a data
  card sitting on `--fwm-bg` -- is drawn in v2 as `#12141A`, eleven times.
- **what I did.** Added `--fwm-surface-card: #12141A` and left
  `--fwm-surface-1` at `#0E0F13`. I did not redefine it.
- **why.** The brief's own test: "a mode override or a screen using a value is
  not the same as the system changing". Six screens using `#12141A` is six
  screens. `--fwm-surface-1` is still referenced by `cluster` (which overrides
  it) and still drawn by every screen v2 did not redraw -- Screens II, the watch
  faces. Redefining it would have moved those screens without anyone asking.
- **consequence:** the two values coexist, four points of luminance apart, and a
  reader has to know which screens are v2 to know which to use.
- **options:** (1) keep both, as shipped; (2) retune `--fwm-surface-1` to
  `#12141A` and delete `--fwm-surface-card`, accepting that every non-v2 screen
  lightens by four points; (3) redraw the non-v2 screens in v2's language, which
  makes this moot and is presumably where this is going.

## dock-divider-is-one-unit-off-line

- **need:** confirmation that `#22262F` is deliberate.
- **source:** the dock's vertical divider -- `width:1px; height:22px;
  background:#22262F` -- x5, once per dock screen. `--fwm-line` is `#23262F`.
  The two differ by one unit in the red channel and nothing else. That is
  either a considered choice about how a hairline reads against the dock's
  `#14161B` fill instead of against `#000`, or a typo.
- **what I did.** Added `--fwm-line-dock: #22262F`. I did not merge it into
  `--fwm-line`, because the design file distinguishes them and merging a value
  the source separates is exactly the invention the contract forbids.
- **note:** this supersedes `docs/gaps-inbox/dock-report-bar.md#dock-divider-colour`,
  which recorded v1 drawing that divider in `#16181E` -- a *surface* token used
  as a line. v2 moves it into the line ramp, which resolves that gap's option 3
  ("add `--fwm-divider` as its own token") in favour of doing exactly that.
- **options:** (1) keep `--fwm-line-dock` (shipped); (2) confirm the typo and
  fold it into `--fwm-line`, deleting one token; (3) keep both and use
  `--fwm-line-dock` for any hairline drawn on a raised fill, not just the dock.

## dock-total-84-vs-drawn-73

- **need:** the real dock height.
- **source:** v2's dock panel says "Dock total 84px + safe area -- one bar, six
  keys." The drawn markup is a 1px top rule, then `padding:0 12px 14px` around a
  `height:58px` bar. 1 + 58 + 14 = **73px**. The stated 84 and the drawn 73 do
  not agree, and neither is 64 (`--fwm-nav-h`).
- **what I did.** Shipped `--fwm-dock-h: 84px` -- the *stated* number, because a
  spec sentence is a statement of intent and a padding value is an artefact of
  how the panel was assembled -- alongside `--fwm-dock-bar-h: 58px` and
  `--fwm-dock-key-h: 42px`, which are both drawn and unambiguous.
  `--fwm-nav-h` is untouched at 64px for every surface v2 did not redraw.
- **note:** this supersedes the numbers in
  `DESIGN-GAPS.md#dock-key-height-58` and
  `docs/gaps-inbox/dock-report-bar.md#dock-key-height-58`, which recorded v1's
  "58px keys / stated 130 / drawn ~148". In v2, 58px is the **bar**, not the
  key; the key is 42px; and the total dropped from ~148 to 84 or 73. Those two
  entries should be re-read against v2 before anyone acts on them. Both listed
  "add `--fwm-dock-key-h` and `--fwm-dock-h`, leaving `--fwm-nav-h` alone" as
  option 1; that is what shipped, with v2's numbers.
- **options:** (1) take 84px as stated (shipped) and let the shell's dock gutter
  reserve it, which leaves 11px of clearance under the bar; (2) take the drawn
  73px and accept content sitting 11px closer to the bar; (3) get the panel
  text corrected.

## dock-key-42-is-under-the-touch-floor

- **need:** nothing -- recorded so nobody "fixes" the token.
- **source:** every inactive dock key is `height:42px`. `--fwm-touch-min` is
  `44px`. The active key is also 42px tall, just wider.
- **what I did.** `--fwm-dock-key-h: 42px` is the drawn size and stays the drawn
  size. The house rule covers the rest: keep the drawn box, extend the hit area
  with a transparent `::before`, as `.fwm-sweep-key` already does. The 58px bar
  gives 8px of slack above and below a 42px key, so a 44px -- or larger -- hit
  area fits inside the bar without overlapping its neighbours.
- **note:** this is the same class of finding as
  `docs/gaps-inbox/*#chips-are-below-the-touch-floor`; it is listed here only
  because the *token* is the thing that looks wrong at a glance.

## mask-stops-are-alpha-not-paint

- **need:** somewhere legal for a mask gradient's colour stops to live.
- **source:** v2 introduces 56 mask declarations (v1 had none). Their stops are
  written as `#000`, `#0000`, `#0008`, `#000c`, `#000d`, `rgba(0,0,0,.55)` and
  `rgba(0,0,0,.12)`. None of those is paint -- a mask stop is an alpha ramp, and
  the black is arbitrary. But `check-design-values.mjs` sees a hex literal and a
  colour function, correctly, and rejects both outside `tokens.css`.
- **what I did.** Tokenised the three composite ramps whole --
  `--fwm-mask-scope-vignette`, `--fwm-mask-voice-field`, `--fwm-mask-voice-bar`
  -- plus `--fwm-mask-solid: #000` for the opaque stop of the ring masks, whose
  stop *percentages* differ per ring and are not design values the checker
  looks at. Precedent for tokenising a whole expression is `--fwm-glow-alert`,
  which is already a complete `box-shadow`.
- **what I deliberately did not do.** I did not add an allowlist entry for mask
  colour stops. A path-scoped `hex-color` exemption would be broad enough to
  wave through real paint in the same file, and the allowlist's existing entries
  are all narrow protocol constants (tile zooms, the 384px watch face, the
  section 06 breakpoints). `scripts/design-values-allowlist.json` is unchanged.
- **zero-alpha stops:** v2 writes `rgba(255,45,94,0)` and `rgba(34,200,224,0)`
  as the transparent ends of its crosshair gradients. Browsers interpolate
  gradients in premultiplied alpha, so the bare keyword `transparent` renders
  identically and is a CSS keyword the checker already ignores. Use
  `transparent`; no token is needed and none was added.
- **options:** (1) keep the ramp tokens (shipped); (2) add a `mask-*` rule
  exemption to the checker so mask declarations are scanned for length but not
  colour -- cleaner long-term, but it is a change to a file this pass does not
  own; (3) draw the vignettes as real elements with `opacity` instead of masks,
  which changes what v2 drew.

## tint-ramp-lands-and-supersedes-two-open-gaps

- Not a gap. Recorded because it closes two.
- `DESIGN-GAPS.md#report-bar-tint-and-alert-tints` and
  `docs/gaps-inbox/dock-report-bar.md#report-bar-tint` both listed three
  options: (1) a derived `color-mix` tint ramp, (2) border-only depth, (3)
  hand-authored alphas. Both shipped stand-in (2), on the reasoning that the
  system's stated depth model was "1px hairline + surface step".
- v2 removes that reasoning. It halves the borders and fills every active dock
  key with an 18% wash of that key's hue. Depth **is** fill now. Option 2 is no
  longer available and option 1 is what shipped: sixteen `--fwm-tint-*` tokens,
  every one a `color-mix` over an existing hue token at the alpha v2 draws, so
  a mode swap carries the tint and the four-state hue logic is untouched.
- v2 also settles the question `report-bar-tint` could not: **the tint follows
  the active hue.** The five dock screens tint their active key crimson, cyan,
  amber, violet and green respectively, matching that key's icon and label.
  v1's uniform `rgba(255,45,94,.09)` under a cyan border was, as suspected, a
  screen that never got re-tinted.
- The alphas are v2's, not mine: 18 (active key, all five hues), 13 (selected
  chip fill and the RADAR crosshair), 14 (the "3 in range" banner), 35 (the
  REPORT facing arc and SWEEP's known-camera ring), 50 (selected chip border
  and RADAR's conic ticks), 55 (banner border), 12/20/42/70 (SWEEP's crosshair,
  wedge, minor and major ring ticks), 18 of `--fwm-text` (SWEEP's ego ring).
- **13 vs 14 is almost certainly noise.** `rgba(255,45,94,.13)` and
  `rgba(255,45,94,.14)` are one point apart and neither is distinguishable on a
  black ground. Both shipped as separate tokens
  (`--fwm-tint-in-range-weak`, `--fwm-tint-in-range-soft`) because the file
  separates them. Collapsing them to one is a free deletion whenever someone
  confirms it.

## two-glows-that-were-never-tokens

- `0 0 26px rgba(61,224,138,.2)` and `0 0 26px rgba(255,192,46,.22)` are drawn
  on the RADAR state matrix's CLEAR and APPROACHING rings. They appear
  identically in v1 and v2, and section 08 exports only `--fwm-glow-alert`
  (`0 0 28px`, in-range, 28% -- a different radius *and* a different alpha).
- Shipped as `--fwm-glow-clear` and `--fwm-glow-approaching`, derived over the
  hue tokens so they follow a mode. `--fwm-glow-alert` is untouched, including
  its `neon-grid` override.
- **Open:** there is no `--fwm-glow-multiple` and no glow for the `NO GPS` or
  `MUTED` rings, which v2 draws with no shadow at all. Whether "muted" means
  "no glow" or "glow desaturated" is undrawn; v2's caption says "hue
  desaturates, data stays live", which reads as no glow. Treating it as no glow.

## type-and-spacing-are-not-a-v2-delta

- Cross-reference, not a new entry.
- v2's drawn type scale is v1's plus exactly two steps: `8px` (the scope
  telemetry -- `1000FT`, `SCAN 4HZ`, `HDG/LAT/LON`) and `44px` (the RADAR scope
  threshold readout). Everything else -- 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  19, 20, 26, 28, 30, 34, 38, 68, 72, 96 -- v1 drew too. The token set still
  ships six steps and components still snap to the nearest, per
  `DESIGN-GAPS.md#micro-type-below-stated-floor`,
  `#token-set-does-not-cover-rendered-hero-sizes` and `#radar-hero-96-vs-token-80`.
  **No type tokens were added.**
- `8px` is the new floor-breaker and it is worth a line in that gap: snapped to
  `--fwm-text-micro` it renders at 11px, 37% larger than drawn, which will make
  the scope annotations crowd the instrument they annotate.
- v2's drawn spacing scale is v1's plus exactly one step, `7px` (the dock bar's
  horizontal inset). Cross-references
  `docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30`.
  **No spacing tokens were added.**
- Likewise the `1.6` SVG `stroke-width` on every dock icon: unitless, so the
  checker's `length` rule does not see it, and `strokeWidth` is not one of the
  React style props it un-disguises. No token needed. `--fwm-icon-size: 24px`
  *was* added, because the dock panel states it as a platform rule ("collapse
  to a 24px stroke icon on the platform 1.6px grid") and CSS will need it to
  size the slot.

## checker-hint-text-is-now-stale

- Not a design gap. `scripts/check-design-values.mjs` is not owned by this pass,
  so this is reported rather than fixed.
- The `radius` rule's message reads "use `var(--fwm-radius-0|1|2|full)`" and the
  `length` rule's reads "use `var(--fwm-space-*|text-*|touch-min|nav-h|header-h)`".
  Both now under-report what exists. A developer following the hint will not
  find `--fwm-radius-3`, and will reach for `--fwm-nav-h` where the dock now has
  its own three tokens.
- Suggested: `use var(--fwm-radius-0|1|2|3|4|5|glyph|full)` and
  `use var(--fwm-space-*|text-*|touch-min|nav-h|header-h|dock-*|icon-size)`.
