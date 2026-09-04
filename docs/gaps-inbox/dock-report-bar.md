# gap inbox -- the dock and the REPORT bar

> **STALENESS WARNING, added 2026-08-30.** Both files in the header above are wrong for
> the shipped app, and one of them does not exist.
>
> `apps/pwa/src/components/dock/ReportBar.tsx` and `ReportBar.test.tsx` DO NOT
> EXIST. v2 folded the standalone 52px REPORT bar into the dock and renamed the
> component to `ReportKey.tsx` / `ReportKey.test.tsx` - recorded at
> `dock-v2.md:321-322`. Every `ReportBar` citation below, including
> `ReportBar.test.tsx` at line 194, points at nothing.
>
> The dock itself is also not the shipped one. v1 is the default
> (`apps/pwa/src/app/design.ts:61`) and `apps/pwa/src/main.tsx:272` passes
> `DockV1` to the shell. `DockV1` is five keys - Drive, Log, Mesh, More, Search -
> a floating pill rather than a pinned panel, with REPORT lifted out into its
> own circle (`components/dock/DockV1.tsx:66-75`, and the reasoning at
> `app/App.tsx:131-141`). The five-key `repeat(5,1fr)` grid, the 1px/2px rules
> and the -1px pull below are v0's `Dock.tsx`. It renders only after an explicit
> per-tab `?design=1` preview opt-in and selection of `V0 · ORIGINAL`; ordinary
> SETTINGS does not offer the retired design.
>
> Read instead: `components/dock/DockV1.tsx`, `components/dock/ReportKey.tsx`,
> `docs/STALENESS.md`.

Files: `apps/pwa/src/components/dock/{Dock,DockKey,ReportBar}.tsx` + `dock.css`.

Everything the dock draws is sourced from the five rendered docks in
`Flockys App Screens.dc.html` (lines 102-115, 168-181, 248-261, 306-319,
388-401) and the "DOCK -- REPLACES THE ICON ROW" panel at line 469. The five
labels, the order, the 1px/2px rules, the `repeat(5,1fr)` grid, the -1px pull,
the 52px bar, the 18x12 block, "REPORT CAMERA", "2 QUEUED" and the two hues are
all literal reads, not choices.

Cross-references rather than new entries, because the decision is already
filed and the dock is just another instance of it:

- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- the
  1px hairline and the 2px active rule. `dock.css` derives both from
  `--fwm-space-1` (`/4` and `/2`) as component-scoped custom properties rather
  than hardcoding a length. See `dock-active-rule-2px` below for why that is a
  stand-in and not a fix.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- the `.1em`
  and `.12em` tracking. Expressed as `calc(var(--fwm-text-*) / 10)` etc., which
  is exactly `.1em` of the element's own token size with no raw length in it.
- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- the queue count renders at
  10px in the design; it uses `--fwm-text-micro` (11px) here.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- the bar renders
  no count at all when nothing is queued. The design never draws that state.
- `docs/gaps-inbox/platform-adapters.md#non-camera-haptics-on-the-watch` -- the
  same haptics ruling, reached from the phone instead of the watch. See
  `pin-drop-haptic-vs-camera-only` below.

## dock-key-height-58

- need: a dock key height token, and a dock total-height token to go with it.
- screen: all five dock screens, every screen in the product.
- source: every rendered key is `height:58px`. `--fwm-nav-h` is 64px. The dock
  panel says "Dock total 130px + safe area" while the render measures ~148px
  (52 bar + 12 + 14 padding + 58 keys + 12 bottom). Three numbers, no two of
  which agree.
- stand-in: `var(--fwm-nav-h)` on `.fwm-dock-key`, which lands the keys at 64px
  and the dock total at ~152px. This merges into the existing
  `DESIGN-GAPS.md#dock-key-height-58`, which already carries the same stand-in;
  the new information is that the shell's `.fwm-safe-dock-gutter` reserves only
  `--fwm-nav-h`, so content currently scrolls under the REPORT bar.
- options:
  1. add `--fwm-dock-key-h: 58px` and `--fwm-dock-h`, leaving `--fwm-nav-h` for
     other surfaces -- the only option that also fixes the content gutter.
  2. retune `--fwm-nav-h` to 58px and derive the dock total from it.
  3. accept 64px keys and let the dock total land at ~152px, and retune the
     gutter to match.

## report-bar-tint

- need: the translucent state tint the REPORT bar is filled with.
- screen: the REPORT bar, on all five dock screens.
- source: every rendered bar fills with `rgba(255,45,94,.09)` -- including the
  two screens whose border, block and label are `#22C8E0`. So the design either
  intends a hue-independent crimson wash behind a cyan border, or the two cyan
  docks were never re-tinted. The border/block/label hue is unambiguous and is
  implemented; the fill is not.
- stand-in: `var(--fwm-surface-1)`, matching the stand-in already recorded in
  `DESIGN-GAPS.md#report-bar-tint-and-alert-tints`, with the hue carried by the
  1px border, the block and the label. `color-mix()` is not reachable:
  `scripts/check-design-values.mjs` rejects every colour function outside
  tokens.css.
- options:
  1. add a derived tint ramp in tokens.css (`--fwm-tint-in-range: color-mix(in
srgb, var(--fwm-alert-in-range) 9%, transparent)`), so the tint follows
     the hue and a mode swap carries it -- and decide whether the bar's tint
     follows the active hue or stays crimson.
  2. keep border-only, which is what ships today and is the most consistent
     with "depth = 1px hairline + surface step".
  3. hand-author the eight alpha fills the design uses and accept eight
     untokenized colours.

## dock-divider-colour

- need: a rule for what colour a divider between two touch targets is.
- screen: the five keys. Each carries `border-left:1px solid #16181E`,
  including the first, whose rule sits on the screen edge.
- source: `#16181E` is `--fwm-surface-2` -- a _surface_ token used as a _line_
  colour, while `--fwm-line` (`#23262F`) and `--fwm-line-strong` exist and are
  used for the two horizontal rules in the same dock. So the dock draws its
  horizontal rules in the line colour and its vertical rules in a fill colour.
- stand-in: `var(--fwm-surface-2)`, faithful to the render. The consequence is
  that the divider is _darker_ than the dock's own top rule, and that an active
  key's `--fwm-surface-2` fill makes its own left divider disappear -- which is
  visible in the design renders too, so it may well be deliberate.
- options:
  1. keep `--fwm-surface-2`, and document that a divider inside a filled row is
     a surface step rather than a line.
  2. switch to `--fwm-line`, matching every other divider in the system, at the
     cost of a visibly stronger dock than the render.
  3. add `--fwm-divider` as its own token so the two cases stop borrowing from
     each other.

## dock-active-rule-2px

- need: the 2px active-key top rule, and the 1px hairline under it.
- screen: every dock key (`border-top:2px solid <hue|transparent>`), the two
  horizontal dock rules, and the REPORT bar border.
- source: the design draws exactly three stroke widths across all four files --
  1px hairline, 2px active/selected, 3px alert -- and section 08 exports none
  of them.
- stand-in: `--fwm-dock-rule-w: calc(var(--fwm-space-1) / 4)` and
  `--fwm-dock-rule-active-w: calc(var(--fwm-space-1) / 2)`, component-scoped
  custom properties in `dock.css`, NOT new tokens. They resolve to exactly 1px
  and 2px today. `--fwm-radius-1` is also exactly 2px and was rejected: a
  radius is not a stroke, and `cartridge-96` already remaps radii.
- options:
  1. add `--fwm-line-w`, `--fwm-line-w-2`, `--fwm-line-w-3` to section 08 and
     delete the two locals -- recommended, and it is what
     `design-value-enforcement.md#no-border-width-token` already asks for.
  2. keep deriving from the space scale, and accept that a mode which rescales
     `--fwm-space-1` silently rescales every border in the dock.
  3. allowlist `^[123]px$` inside `border*` declarations repo-wide, which puts
     the value back outside tokens.css.

## report-bar-confirm-dwell

- need: how long the bar shows "PIN DROPPED" before it reads "REPORT CAMERA"
  again.
- screen: the REPORT bar after a 1s hold. The confirmation copy is real --
  `Flockys Watch.dc.html` W8 renders "PIN DROPPED" -- but W8 is a full watch
  face that stays until dismissed, and the phone bar has no drawn confirm state
  at all.
- source: nothing. No timing anywhere in the four design files covers a
  transient confirmation.
- stand-in: `PIN_CONFIRM_DWELL_MS = HOLD_TO_DROP_MS` (1000 ms) -- the one
  published dock timing, reused rather than a second number invented next to
  it. The duration scale tops out at `--fwm-dur-alert` (400 ms), which is a
  transition length and far too short to read.
- options:
  1. keep 1s. One number in the dock, used twice: hold 1s, confirm 1s.
  2. a longer toast-style dwell (~3s), which is easier to read at speed but is
     a value nobody chose.
  3. hold the confirmation until the next interaction with the bar. No timing
     invented at all, but the REPORT affordance's own label stays gone until
     the driver touches it again.

## report-hold-move-slop

- need: how far a pointer may drift during the 1s hold before it stops being a
  hold.
- screen: the REPORT bar. This is the difference between a pin dropped on a
  bumpy road and a scroll gesture that drops a pin by accident.
- source: nothing. The design specifies the gesture ("1s hold ... no dialog")
  and never its tolerance.
- stand-in: `HOLD_MOVE_SLOP_PX = 10`, roughly a finger-width of jitter at
  typical DPR, and well under the 44px touch minimum so a deliberate drag off
  the bar always aborts.
- options:
  1. keep a fixed 10px.
  2. scale it with `--fwm-touch-min`, so the `dash` surface (68px touch floor,
     a head unit in a moving vehicle) gets a proportionally larger tolerance.
  3. drop the slop rule and cancel only on `pointercancel` / `pointerleave`,
     letting the platform's own gesture arbitration decide.

## pin-drop-haptic-vs-camera-only

- need: a ruling on the confirmation haptic the pin drop asks for. This is the
  same conflict already filed as
  `platform-adapters.md#non-camera-haptics-on-the-watch`, reached from the
  phone dock instead of the watch, and it now blocks a shipped surface rather
  than an unbuilt one.
- screen: the REPORT bar's 1s hold. `Flockys Watch.dc.html` states it plainly:
  "anywhere = drop a camera pin with GPS + heading. 1s, one haptic, no dialog."
- source: that line asks for a haptic. Screens II B10 says the opposite for
  everything that is not a camera: "Silent, no vibration -- alert haptics stay
  reserved for cameras." `services/adapters/vibration.ts` enforces the second
  reading with `assertCameraAlertOnly`, which throws for a `ui-feedback` source.
- stand-in: `ReportBar` never calls `navigator.vibrate`, directly or through
  the adapter. It exposes `onHaptic`, fired exactly once and only on a drop
  (asserted in `ReportBar.test.tsx`), and the owner passes nothing today. The
  drop is confirmed visually instead. Unimplemented, not quietly allowed.
- options:
  1. keep haptics camera-only; the pin drop confirms visually. Shipping
     behaviour today.
  2. add a UI-feedback channel with a deliberately different feel (one very
     short tick, never two pulses) so a confirmation cannot be read as a
     camera, and widen the guard's allowlist to exactly two sources.
  3. allow it only for deliberate long-presses, on the argument that the driver
     initiated it and cannot mistake it for an unsolicited alert.
