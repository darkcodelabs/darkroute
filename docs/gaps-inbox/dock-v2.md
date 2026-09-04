# gap inbox -- the one-bar dock (v2)

> **STALENESS WARNING, added 2026-08-30.** This describes v0's dock, which the default design
> does not render.
>
> v1 is the default (`apps/pwa/src/app/design.ts:61`) and
> `apps/pwa/src/main.tsx:272` passes `DockV1` to the shell, so the six-key
> one-bar dock measured here is only on screen after an explicit per-tab
> `?design=1` preview opt-in and selection of `V0 · ORIGINAL`; ordinary SETTINGS
> does not offer it. v1's dock is five keys and a separate REPORT circle
> (`components/dock/DockV1.tsx:66-76`).
>
> This file is the RECORD OF THE `ReportBar` -> `ReportKey` RENAME (lines
> 321-335), which four other documents in this directory still get wrong. That
> part is accurate and worth keeping.
>
> Read instead: `components/dock/DockV1.tsx`, `docs/STALENESS.md`.

Files: `apps/pwa/src/components/dock/{Dock,DockKey,ReportKey,icons}.tsx`,
`apps/pwa/src/components/dock/dock.css`, `apps/pwa/src/app/App.tsx`.

Source read: `.design-src-v2/Flockys App Screens v2.dc.html` -- the five
rendered docks (lines 113, 195, 267, 330, 404, byte-identical to each other
except for which key is active) and the panel "DOCK -- REPLACES THE ICON ROW"
at line 475 -- diffed against the same two places in
`.design-src/Flockys App Screens.dc.html`.

v2 is the later screen file, so it wins wherever it disagrees with v1 or with
`Flockys Design System.dc.html`. Where v2 is silent, v1 still stands and
nothing was deleted for being undrawn.

## what changed, measured

| | v1 | v2 |
|---|---|---|
| dock shape | 52px REPORT bar **above** a `repeat(5,1fr)` word-key row | one 58px bar, six keys in it |
| dock total | "130px + safe area" (drawn ~148) | "84px + safe area" (drawn 73) |
| destination key | 58px cell, 11px mono word, 1px left rule | 42px cell, 24x24 stroke mark, no rule |
| the word | on all five keys, always | on the ACTIVE key only, at 14px |
| active treatment | `#16181E` fill + 2px top rule in the hue | 18% wash of the hue, radius 10px, no rule |
| inactive ink | `#6B7381` (`--fwm-text-muted`) | `#8B93A1` (`--fwm-text-icon`) |
| hues in play | 2, shared across 5 screens | 5, one per destination |
| REPORT | a bar, hue-following, "REPORT CAMERA" + "2 QUEUED" | a 42x42 key, always crimson, eye mark + badge |
| icons | none, by explicit design | five, `stroke-width="1.6"`, inline in the file |

Nothing v2 left undrawn was removed with the bar: the tap/1s-hold gesture pair,
the abort-on-drag, `data-fwm-pin-drop="unavailable"`, the queue count, the inert
LOOKUP key, the no-hover rule and the alert-proof placement are all intact and
all still asserted.

## three-screens-changed-hue

- **Not a gap. Recorded because it is a behavioural change with no visible
  diff in the code.** `dockHueFor()` returns different values than it did.
- v1's five rendered docks painted RADAR, LOOKUP and LOG `#FF2D5E` and SWEEP
  and ASK `#22C8E0` -- five screens sharing two hues.
- v2's five rendered docks paint RADAR `#FF2D5E`, SWEEP `#22C8E0`, LOOKUP
  `#FFC02E`, ASK `#8A6BFF`, LOG `#3DE08A`. Every destination has its own, and
  the 18% chip wash under it is that same hue.
- `DockHue` grew from `'in-range' | 'accent-scan'` to a five-member union
  rather than being re-pointed, so nothing that already reads the type silently
  changes meaning. `Dock.test.tsx` asserts all five are distinct, which is what
  catches a future edit collapsing them back.
- **Watch out:** `--fwm-alert-approaching` and `--fwm-alert-clear` now appear in
  dock chrome, where before they only ever meant "a camera is at this distance".
  A driver reading hue as alert state now sees amber and green on the dock at
  all times. v2 drew it that way deliberately (the panel's whole argument is
  "the eye finds position by fill"), but it is worth a design confirmation.

## active-key-panel-says-16181e-render-says-a-hue-wash

- **need:** which of v2's own two statements about the active key is the spec.
- **source:** the panel says *"Active key: filled #16181E + 2px top rule + hue +
  bold. Inactive #6B7381."* -- word for word what v1's panel said. The five
  rendered docks say something else entirely: `background:rgba(<hue>,.18)`,
  `border-radius:10px`, **no top rule at all**, and inactive marks in `#8B93A1`,
  not `#6B7381`.
- So the panel prose was carried over from v1 unedited while the screens were
  redrawn. The subtitle of the whole file -- "flat borderless controls, 8px
  radius, fill-based depth" -- is on the render's side, and a 2px top rule is
  exactly the border v2 says it removed.
- **stand-in:** the render. `--fwm-dock-tint` (an 18% `color-mix` of the key's
  hue, shipped by the token pass) on `--fwm-radius-4`, no rule, and
  `--fwm-text-icon` for the inactive mark.
- **options:** (1) render wins (shipped); (2) panel wins, which would put a
  border back on the one control v2 borderless-ified; (3) correct the panel
  text so the file stops contradicting itself.

## report-chip-tint-panel-vs-render

- **need:** whether REPORT's 42px cell is filled.
- **source:** the panel says *"42px eye mark on a **tinted chip**"*. The rendered
  markup is `flex:none; height:42px; width:42px; display:flex; position:relative`
  -- no `background` property at all, on any of the five docks.
- **stand-in:** the panel. `background: var(--fwm-tint-in-range)` on
  `--fwm-radius-4`, which is exactly the treatment the active destination chip
  gets, so the two read as the same kind of object.
- **why the panel here and the render above:** the two conflicts point opposite
  ways on purpose. Above, the panel is stale v1 text and the render is new v2
  drawing. Here the panel describes something the render *omits* rather than
  contradicts, and the omission has no v1 ancestor to have been carried over
  from -- v1 had no REPORT chip at all. Adding a fill is also the reading that
  keeps the sixth key from looking like an afterthought floating outside the
  bar's own rhythm.
- **options:** (1) tinted, as the panel says (shipped); (2) unfilled, as drawn;
  (3) tinted only while `queuedCount > 0`, which nothing in either file supports.

## queue-badge-amber-vs-crimson

- **need:** the colour and the shape of the queued-reports count.
- **source:** the panel says *"**Amber badge** = queued reports"*. The rendered
  markup is `position:absolute; top:-2px; right:-1px; font-size:10px;
  font-weight:700; color:#FF2D5E` -- crimson bare type, no badge shape, no fill.
- **stand-in:** the panel. `--fwm-alert-approaching` fill, `--fwm-radius-full`,
  `--fwm-text-on-alert` ink, the drawn offsets derived from `--fwm-space-1`.
  Amber is corroborated elsewhere in v2: the REPORT sheet writes the same fact
  out in full as *"2 REPORTS QUEUED · SYNC ON WIFI"* in `#FFC02E`, next to a 6px
  `#FFC02E` dot. The dock is the abbreviation of that line, so it should not
  change colour on the way.
- **note:** crimson-on-crimson is also just hard to read -- the drawn numeral is
  `#FF2D5E` sitting 2px from a `#FF2D5E` eye.
- **options:** (1) amber badge (shipped); (2) crimson numeral as drawn; (3) amber
  numeral, no badge shape -- splits the difference and is what the render would
  look like if only the colour were corrected.

## report-no-longer-follows-the-screen-hue

- **Not a gap. Recorded because it deletes a v1 behaviour and a v1 test.**
- v1's REPORT bar took the active key's hue: border, block and label all turned
  cyan on SWEEP and ASK. `ReportBar.test.tsx` asserted it
  (*"takes the hue of the screen the dock is lighting when given none"*).
- All five v2 docks draw the eye in `#FF2D5E`, including the ones whose active
  key is cyan, amber, violet or green. That is not an un-retinted screen -- v2
  *did* retint the five destination chips, individually, and left REPORT alone
  on every one.
- So the `hue` prop is gone from the component, `ReportKey` carries no
  `data-fwm-dock-hue`, and the test now asserts the opposite. `dockHueFor()` is
  still exported: it is the published mapping, and the destination keys use it.
- The product reading: REPORT is the one key whose position and colour never
  move, so a driver can find it without reading the dock.

## pin-drop-confirmation-is-undrawn-in-v2

- **need:** what the dock does for the second after a 1s hold drops a pin.
- **source:** v2 draws the dock in exactly one state, five times. It has no
  confirming state, no pressed state and no queue-just-changed state.
  "PIN DROPPED" survives only in `Flockys Watch.dc.html`, W8, on a surface that
  has no dock at all. v1 had a 52px bar to swap the words in; there is nowhere
  to paint them now.
- **stand-in:** the tint goes solid (`--fwm-alert-in-range`) and the eye mask
  flips to `--fwm-text-on-alert` -- the token the system already names for
  "label on a saturated alert fill". No new value, and it reads at arm's length
  in a car, which a word at 10px would not. The words themselves stay in the
  accessible name under `aria-live="polite"`, so the receipt is not lost for a
  driver who is not looking at the screen.
- **options:** (1) invert the chip (shipped); (2) draw nothing and let the
  haptic be the only receipt, which is unavailable until the haptics ruling in
  `docs/gaps-inbox/dock-report-bar.md#pin-drop-haptic-vs-camera-only` moves;
  (3) design a confirmation for the one-bar dock.
- Timing is unchanged and still stands in at `HOLD_TO_DROP_MS`; see
  `DESIGN-GAPS.md#report-bar-confirm-dwell`.

## the-word-is-clipped-not-removed

- **Not a gap. Recorded because it is the one place the DOM does not match the
  picture, and a future reader will think it is a bug.**
- v2 draws no word on the four inactive keys and none on REPORT. The word is
  still in the DOM on all six, clipped to nothing by `.fwm-dock-word`.
- An icon-only button with no accessible name is unusable with a screen reader,
  and `display:none` would take the name away with the picture. Clipping keeps
  the name, keeps `getByText('SWEEP')` working, and paints nothing.
- The same class carries REPORT's name (`REPORT CAMERA` / `PIN DROPPED`) and
  the queue sentence (`2 QUEUED`), because v2 paints a bare numeral there and a
  bare numeral read aloud says nothing.

## inactive-keys-are-narrower-than-the-touch-floor

- **need:** 44px per key in a bar that cannot give it.
- **source:** v2 draws six keys in a 375px-wide bar. Measured at that width with
  RADAR active: 12px dock padding each side, 8px bar inset each side, a ~104px
  active chip, a 1px divider with 4px margins, a 42px REPORT key and six 2px
  gaps leaves **~42px** for each of the four inactive keys. With LOOKUP active
  -- the longest word -- it drops to **~40px**. `--fwm-touch-min` is 44px.
  Vertically the drawn key is 42px, also under the floor; that half is already
  filed as `docs/gaps-inbox/tokens-v2.md#dock-key-42-is-under-the-touch-floor`.
- **stand-in:** the house pattern -- keep the drawn box, extend the hit area
  with a transparent `::before`, as `.fwm-sweep-key` does. Vertically that is
  `calc((var(--fwm-touch-min) - var(--fwm-dock-key-h)) / -2)`, an exact 44px.
  Laterally it is 1px each side, which closes the drawn 2px gap so the bar has
  no dead strips between keys but does **not** reach 44px on its own.
- So the vertical floor is met and the horizontal floor is met at 375px only
  when the active word is short. On a 320px screen no arrangement of six keys
  in one bar reaches it.
- **options:** (1) accept it and take the extra clearance the `::before` gives
  (shipped); (2) shrink the active chip's padding further, which buys ~8px and
  makes the one readable label tighter; (3) drop the active chip's word below a
  screen-width threshold, which would defeat the point of the redesign; (4) get
  a 320px dock drawn.

## chip-padding-14

- **need:** a 14px step on the space scale.
- **source:** the active chip is `padding:0 14px` on all five docks.
  `--fwm-space-3` is 12px, `--fwm-space-4` is 16px.
- **stand-in:** `--fwm-space-3` (12px), the smaller of the two neighbours,
  chosen because it is the 8px that keeps LOOKUP inside a 320px bar. See the
  entry above.
- Cross-references `docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30`,
  which is the same missing step reached from another screen.

## bar-gap-2-and-inset-7

- **need:** 2px and 7px steps, or a ruling that they are derived.
- **source:** the bar is `gap:2px; padding:0 7px`. 7px is the one spacing value
  v2 draws that v1 never did -- see
  `docs/gaps-inbox/tokens-v2.md#type-and-spacing-are-not-a-v2-delta`, which
  decided not to add a token for it.
- **stand-in:** the gap is `calc(var(--fwm-space-1) / 2)`, exactly 2px and
  derived so a mode that rescales space rescales it. The inset uses
  `--fwm-space-2` (8px), 1px wider than drawn.
- **options:** (1) as shipped; (2) derive the inset too, as
  `calc(var(--fwm-space-2) - var(--fwm-space-1) / 4)`, which is exactly 7px but
  reads as arithmetic for its own sake; (3) add a 7px step.

## divider-22-and-eye-22

- **need:** a 22px step, used twice in the same 42px cell.
- **source:** the hairline splitting REPORT from the destinations is
  `width:1px; height:22px`; the eye mask inside REPORT is `width:22px;
  height:22px`. `--fwm-space-6` is 24px and `--fwm-icon-size` is 24px.
- **stand-in:** `--fwm-space-6` for the divider's height, `--fwm-icon-size` for
  the eye -- which also makes the eye exactly the size of the five destination
  marks beside it, which is very likely the intent.
- **note:** 22 is 24 minus the 2px the drawn mask leaves as optical padding. If
  the eye reads 9% too large next to the stroke marks, that is this entry.

## divider-margin-5

- **need:** a 5px step.
- **source:** the divider is `margin:0 5px`. `--fwm-space-1` is 4px.
- **stand-in:** `--fwm-space-1`. Costs 2px of bar width in total, which goes to
  the inactive keys, which need it.

## active-word-14

- **need:** a 14px type step.
- **source:** the active key's word is `font-size:14px; font-weight:700;
  letter-spacing:.04em`. `--fwm-text-body` is `.9375rem` = 15px and is the
  nearest step; `--fwm-text-micro` is 11px.
- **stand-in:** `--fwm-text-body`, and `.04em` expressed as
  `calc(var(--fwm-text-body) * 0.04)` so no raw length appears.
- Cross-references `DESIGN-GAPS.md#micro-type-below-stated-floor` and
  `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized`. **No type
  tokens were added**, per
  `docs/gaps-inbox/tokens-v2.md#type-and-spacing-are-not-a-v2-delta`.

## icon-stroke-width-and-colour-are-not-verbatim

- **Not a gap. Recorded because "extract the icons verbatim" was the
  instruction and two attributes were deliberately not copied.**
- Copied character for character into `icons.tsx`: every `viewBox`, every
  `cx/cy/r/x/y/width/height/rx`, and every `d` string. Nothing was redrawn,
  simplified, substituted or recalled from an icon set.
- **Not copied:** `stroke="#8B93A1"` / `stroke="#FF2D5E"` and
  `fill="#8B93A1"` / `fill="#3DE08A"`, which are the key's *state* and change
  per screen and per inert -- they became `currentColor`, driven by `color` in
  `dock.css`. A hex literal in a `.tsx` file also fails
  `scripts/check-design-values.mjs` on sight.
- **Also not copied as attributes:** `stroke-width="1.6"`,
  `stroke-linecap="round"`, `stroke-linejoin="round"`, declared once on
  `.fwm-dock-icon` in `dock.css` instead of 30 times inline. That follows the
  existing convention in `features/sweep/components/SweepDial.tsx`, which puts
  all stroke geometry in CSS and keeps only coordinates in the component.
- `1.6` is a unitless SVG user unit, not a CSS length, and the token pass ruled
  that it needs no token
  (`docs/gaps-inbox/tokens-v2.md#type-and-spacing-are-not-a-v2-delta`).
  `--fwm-icon-size` (24px) sizes the slot.
- The rendered result is pixel-identical to the design file.

## the-content-gutter-still-reserves-nav-h

- **need:** a change to a file this pass does not own.
- `apps/pwa/src/styles/global.css` defines
  `.fwm-safe-dock-gutter { padding-bottom: calc(var(--fwm-nav-h) + env(safe-area-inset-bottom, 0px)); }`.
  `src/app/App.tsx` puts that class on `<main>` so screen content does not
  scroll under the fixed dock.
- v1's dock was ~148px tall against a 64px reservation, so content scrolled
  under the REPORT bar. v2's dock is `--fwm-dock-h` (84px) and that token now
  exists, so the fix is one token swap -- but `global.css` belongs to the shell
  pass, so it is reported rather than made.
- **asked for:** `.fwm-safe-dock-gutter` and `.fwm-safe-dock` should reserve
  `var(--fwm-dock-h)` instead of `var(--fwm-nav-h)`. `--fwm-nav-h` stays 64px
  for every surface v2 did not redraw, exactly as the token pass left it.
- Until then the dock over-hangs the last 20px of scrollable content.

## superseded-entries

These describe v1's dock and no longer describe anything that exists. Re-read
them against v2 before acting on any of them:

- `DESIGN-GAPS.md#dock-key-height-58` and
  `docs/gaps-inbox/dock-report-bar.md#dock-key-height-58` -- in v2, 58px is the
  **bar**; the key is 42px; the total is 84 stated / 73 drawn, not 130 / ~148.
  Superseded by `docs/gaps-inbox/tokens-v2.md#dock-total-84-vs-drawn-73`.
- `docs/gaps-inbox/dock-report-bar.md#report-bar-tint` -- v2 tints every active
  chip with an 18% wash of *its own* hue, which answers the question that entry
  could not. Superseded by
  `docs/gaps-inbox/tokens-v2.md#tint-ramp-lands-and-supersedes-two-open-gaps`.
- `docs/gaps-inbox/dock-report-bar.md#dock-divider-colour` -- v2's divider is
  `#22262F` and has its own token. Superseded by
  `docs/gaps-inbox/tokens-v2.md#dock-divider-is-one-unit-off-line`.
- The 2px active-rule half of
  `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- v2's
  dock draws no 2px rule anywhere. The 1px hairline half still applies: the
  dock's top rule and the REPORT divider both need it, and both derive it from
  `--fwm-space-1`.

## renamed dock files that other notes point at

Not a design gap; a pointer, so nobody chases a deleted file.

- `components/dock/ReportBar.tsx` is now `components/dock/ReportKey.tsx`, and
  `ReportBar.test.tsx` is `ReportKey.test.tsx`. The `ReportBar` export is gone;
  `ReportKey` and `ReportKeyProps` replace it, minus the `hue` prop (see
  `report-no-longer-follows-the-screen-hue` above). Nothing outside
  `components/dock/` imported it -- `src/app/App.tsx` was the only consumer and
  now renders `<Dock />` alone.
- Files that still name the old path, none of which this pass owns:
  `docs/gaps-inbox/report.md` (lines 25, 410, 420, 422),
  `docs/gaps-inbox/dock-report-bar.md` (line 3, 171, 173),
  `docs/gaps-inbox/pwa-shell.md` (line 85).
- `docs/gaps-inbox/report.md#...` asks for the REPORT press to go through
  `openReportSheet()` rather than `openScreen('report')`. That is unchanged and
  still open: `ReportKey` keeps the identical default, so the request now
  points at `ReportKey.tsx` instead of `ReportBar.tsx:126`.

## still-open, unchanged by v2

- `docs/gaps-inbox/dock-report-bar.md#pin-drop-haptic-vs-camera-only` -- the
  hold still fires `onHaptic` and still never touches `navigator.vibrate`.
- `DESIGN-GAPS.md#report-hold-move-slop` -- 10px, still undrawn.
- `DESIGN-GAPS.md#report-bar-confirm-dwell` -- still stood in at 1000ms.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- a zero queue still
  draws no badge, because the design never draws that state.
- `docs/gaps-inbox/pwa-shell.md#watch-navigation-has-no-implementation` and
  `#dash-surface-needs-a-rail-not-a-bottom-dock` -- v2 redrew the phone dock
  only. The watch still gets no dock and the dash still gets a bottom bar where
  the design asks for an 88px rail.
