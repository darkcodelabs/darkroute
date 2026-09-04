# gap inbox -- REPORT, v2 redesign

> **STALENESS WARNING, added 2026-08-30.** A v2 delta against a sheet the default design
> replaces, and it points at a deleted file.
>
> `apps/pwa/src/app/registry.v1.tsx:107` maps `report: ReportV1Screen`; v1 is
> the default (`apps/pwa/src/app/design.ts:61`). The v0 container still runs
> underneath (`ReportV1Screen.tsx:11`), so behaviour entries bind and drawn
> entries do not.
>
> This file already flags three stale references at line 270. A fourth: it
> names `components/dock/ReportBar.tsx`, which does not exist - it is
> `ReportKey.tsx` now (`dock-v2.md:321-322`).
>
> Read instead: `report.md`'s banner, `features/report/components/ReportViewV1.tsx`,
> `docs/STALENESS.md`.

Files: `apps/pwa/src/features/report/**` (`ReportScreen.tsx`,
`components/*.tsx`, `report.css`, `reportDraft.ts`, `facing.ts`,
`reportQueue.ts`).

Source read: `.design-src-v2/Flockys App Screens v2.dc.html` -- panel
`06 · REPORT - SHEET FROM THE DOCK KEY` (lines 413-470), plus the
`DOCK - REPLACES THE ICON ROW` note at line 475 that says what raises it.
Compared line by line against `.design-src/Flockys App Screens.dc.html`, panel
`06 · REPORT - SHEET FROM ANY SCREEN` (lines 407-464).

`docs/gaps-inbox/report.md` holds the v1 entries. Every one of them is still
open unless it is listed as closed below; this file only carries what v2
changed.

---

## The title changed, and the title is the behaviour

    v1:  06 · REPORT - SHEET FROM ANY SCREEN
    v2:  06 · REPORT - SHEET FROM THE DOCK KEY

v1 raised this sheet from a persistent 52px crimson `REPORT CAMERA / 2 QUEUED`
bar that sat above the keys on **every** screen. v2 deleted that bar and folded
it into the dock as the sixth key:

> REPORT is the last key in the bar, always far right: 42px eye mark on a
> tinted chip, split from the destinations by a hairline. Tap opens the sheet,
> 1s hold drops a pin. Amber badge = queued reports.

What that costs this feature: **nothing, and that is the finding.** The sheet
never knew how it was raised.

- `openReportSheet()` was already the one way in and still is. It opens the
  reserved `report` / `sheet` overlay OVER the current screen, which is exactly
  right for a dock key, because the dock is not a destination and there is
  nothing to navigate away from.
- `closeReport()` has three branches -- close the overlay, else pop history,
  else `openScreen(DEFAULT_SCREEN, { replace: true })` -- and **not one of them
  names an entry point**. A back-target aimed at the deleted bar would have
  broken here; a function that only unwinds cannot.
- The sheet draws no "from any screen" affordance: no persistent bar, no docked
  action, no hue that follows the screen behind it.

The heading itself is the one string v2 reworded: `REPORT CAMERA` -> `REPORT`.
The word `CAMERA` was the bar's, and the bar is gone. `REPORT_TITLE` in
`components/ReportView.tsx` is the value; `aria-label` on the sheet root moved
from `report camera` to `report` with it.

`HOLD REPORT BUTTON 1s TO ONE-TAP DROP A PIN` is **kept verbatim** under the
submit button. It describes the dock key's hold gesture, not this button, and
v2 did not reword it when the bar became a key -- so neither did we.

---

## What v2 changed on this panel, in full

**Copy deltas: exactly one.** The heading. Every other string on the sheet is
byte-identical to v1 -- `NEW CAMERA`, `CONFIRM EXISTING`, `POSITION · AUTO`,
`39.0997 N · 84.5786 W`, `±4 M · 9 SATS · Reading Rd`, `FACING · FROM COMPASS`,
`SW`, `223° · covering the northbound lane`, `TAP ARC TO ADJUST`, `PHOTO`,
`MAKE / MODEL`, `POLE MOUNT`, `SOLAR`, `TRAILER`, `UNSURE`,
`2 REPORTS QUEUED · SYNC ON WIFI`, `SUBMIT REPORT`, the hold hint, and `✕`.

Everything else is a fill, an edge, a radius or a metric, which no text diff
can see:

| element | v1 | v2 |
|---|---|---|
| panel title | `SHEET FROM ANY SCREEN` | `SHEET FROM THE DOCK KEY` |
| sheet heading | `REPORT CAMERA`, 17px/700/.1em | `REPORT`, 19px/700/.06em |
| header rule | `1px #FF2D5E` | **unchanged** -- one of the two edges v2 kept here |
| `✕` key | 44x36, `1px #23262F`, radius 2, transparent | 44x36, **no edge**, radius 8, `#1B1E25` fill |
| mode toggle track | one `1px #23262F` box, radius 2, no fill, no inset | `#15171D` trough, radius 8, `padding:3px`, `gap:3px`, no edge |
| mode toggle halves | 46px, radius 0 (clipped by the box) | 40px, radius 6 |
| pressed half | `#FF2D5E` fill, `color:#000`, both halves 700 | `#FF2D5E` fill, `color:#0A0A0C`, 700 pressed / 400 unpressed |
| `POSITION · AUTO` card | `1px #23262F` on `#0E0F13`, radius 2 | **no edge**, `#12141A` fill, radius 6 |
| compass dial | `1px #23262F` ring, no fill | **no stroke**, `#12141A` filled disc |
| dial cardinals | 9px `#3A3F4B` | 10px `#6B7381` |
| facing arc | `rgba(255,45,94,.35)` | **unchanged** |
| `PHOTO` / `MAKE / MODEL` keys | `1px #3A3F4B`, radius 2, transparent | **no edge**, radius 8, `#1B1E25` fill |
| their labels | 13px/600 **UI** at .08em | 12px/500 **mono** at .1em |
| camera glyph inside `PHOTO` | `2px #A7AFBD`, radius 2 | `2px #A7AFBD`, radius **3** -- the only 3px corner in all of v2 |
| mount chips | `1px #3A3F4B` **999px pills**, 12px UI | **no edge**, radius 8, `#1B1E25` fill, 11px mono at .06em |
| selected mount chip | `1px #FF2D5E`, no fill, `color:#FF2D5E` | `1px rgba(255,45,94,.5)`, `rgba(255,45,94,.13)` fill, `color:#FF8DA5` |
| queue line + dot | 10px `#FFC02E`, 6px dot | **unchanged** |
| `SUBMIT REPORT` | 56px `#FF2D5E`, `color:#000`, radius 2 | 56px `#FF2D5E`, `color:#000`, radius **8** |
| hold hint | 10px `#6B7381` centred at .1em | **unchanged** |

Border census for this panel alone: **11 -> 3.** The three survivors are the
crimson header rule, the selected chip's tinted edge, and the 2px camera glyph
outline (which is a drawing, not a control edge).

---

## Closed by v2 / by the v2 token pass

- `DESIGN-GAPS.md#report-bar-tint-and-alert-tints` -- **closed.** It asked
  whether an alert tint should be a fill or border-only. v2 draws the tinted
  fill on the selected chip (`rgba(255,45,94,.13)` **plus** a
  `rgba(255,45,94,.5)` edge), so "border-only" is no longer an open option.
  The tokens phase landed both mixes as `--fwm-tint-in-range-weak` and
  `--fwm-tint-in-range-line`, and `report.css` names them.
- `report.md`'s note that the facing wedge had to be `fill` + `opacity` because
  the set carried no alpha ramp -- **closed.** `--fwm-tint-in-range-arc` is
  v2's exact 35% mix, named for this arc. `report.css` now declares **no
  `opacity` at all**, and the component-scoped `--fwm-report-wedge-alpha` local
  is deleted.
- `docs/gaps-inbox/report.md#the-report-bar-navigates-instead-of-opening-the-sheet`
  -- **half closed.** The bar it named no longer exists; v2 settles the
  question of intent ("Tap opens the sheet"). What remains is a one-line change
  in a file this pass does not own -- see **shared-file work** below.

---

## Still open, unchanged by v2

Everything in `docs/gaps-inbox/report.md` that v2 did not redraw:
`#report-type-steps-missing`, `#unitless-ratios-have-no-token` (minus the
opacity half, now closed), `#status-dot-size-has-no-token`,
`#tile-and-button-heights-have-no-token`, `#photo-refusal-copy-is-authored`,
`#make-model-opens-an-undrawn-field`, `#submit-has-no-drawn-confirmation`,
`#no-blocked-or-failed-state-is-drawn`,
`#arc-adjust-is-touch-only-in-the-design`, `#chips-are-below-the-touch-floor`,
`#close-target-is-below-the-touch-floor` (v2 kept 44x36 -- see below),
`DESIGN-GAPS.md#micro-type-below-stated-floor`,
`docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30`,
`docs/gaps-inbox/design-value-enforcement.md#no-border-width-token`.

---

## New v2 gaps

### segment-track-inset-is-3px

- **need**: v2 insets the segmented toggle track by `padding:3px` and gaps its
  two halves by `gap:3px`. The space scale is `4 / 8 / 12 / 16 / 24 / 32 / 48`.
  There is no 3.
- **drawn**: `<div style="... padding:3px; gap:3px">` at v2 line 421.
- **stand-in**: a component-scoped local,
  `--fwm-report-track-pad: calc(var(--fwm-space-1) * 0.75)`, which is exactly
  3px and rescales with the space scale. NOT a new token -- one panel draws it.
- **note**: this is the same shape as the 14px stack gap and the 10px/30px
  values already filed under
  `radar-screen.md#spacing-scale-misses-10-14-and-30`. If the scale ever gains
  a sub-4 step, this local should collapse into it.
- **blocked?** no.

### toggle-half-40px-and-close-key-36px

- **need**: v2 draws the toggle halves 40px tall and the `✕` key 44 **x 36**.
  Both are under the product's own 44px touch floor, and the toggle actually
  got *smaller* than v1's 46px.
- **drawn**: `height:40px` at v2 line 422-423, `width:44px; height:36px` at
  v2 line 417.
- **stand-in**: the standing
  [`touch-target floor`](./README.md#touch-target-floor) decision, and the
  pattern `.fwm-sweep-key` already ships: the VISUAL control keeps the drawn height so
  the layout matches v2, and a transparent `::before` extends the hit area to
  `--fwm-touch-min`. `--fwm-report-mode-h` (40px) and `--fwm-report-close-h`
  (36px) are derived from the SPACE scale, not from `--fwm-touch-min`, so a
  surface that raises the floor (dash: 68px) grows the overhang rather than the
  drawn control -- identical to `--fwm-sweep-key-h`.
- **note**: the toggle's 2px overhang lands inside the trough's own 3px inset,
  so the two halves never steal from each other and nothing outside the trough
  is captured. The `✕`'s 4px overhang fits inside the 52px header.
- **blocked?** no.

### wrapping-chips-cannot-use-the-before-hit-extension

- **need**: the mount chips render ~34px tall (`padding:9px 13px` on 11px
  type), also under the floor -- but unlike the toggle they **wrap**, on a
  `gap:8px` row.
- **why the `::before` pattern does not apply**: a 5px overhang from each of
  two adjacent rows would overlap by 2px, so a tap in that band would land on
  whichever chip won the paint order. Two chips sharing a hit band is worse
  than one chip being taller than drawn.
- **stand-in**: unchanged from v1 -- `min-height: var(--fwm-touch-min)` raises
  the drawn chip to 44px.
- **need from design**: either a taller drawn chip, or a bigger row gap that
  leaves room for a non-overlapping overhang. This is a real visual divergence
  from v2 (a 44px chip where v2 draws ~34px) and it should be settled rather
  than left implicit.
- **blocked?** no, but it is the one place this screen does not match v2.

### screen-title-19px-has-no-step

- **need**: v2 sets every screen title, this sheet's included, at 19px/.06em.
  The type ramp goes `--fwm-text-subtitle` 17px -> `--fwm-text-title` 24px.
- **stand-in**: `--fwm-text-subtitle` with
  `letter-spacing: calc(var(--fwm-text-subtitle) * 0.06)`.
- **note**: identical to `docs/gaps-inbox/sweep-v2.md#screen-title-19px-has-no-step`
  and to whatever RADAR / LOG / LOOKUP filed. **This wants one shared decision,
  not five** -- a `--fwm-text-heading` step at 19px would close all of them.
- **blocked?** no.

### tile-label-12px-mono-has-no-step

- **need**: v2's `PHOTO` and `MAKE / MODEL` labels are 12px mono at 500 weight.
  The ramp carries 11px (`--fwm-text-micro`) and 15px (`--fwm-text-body`), and
  nothing between.
- **stand-in**: `--fwm-text-micro` (11px), the nearest step.
- **note**: the weight is the other half. `report.css` now names three literal
  weights -- 400, 500, 700 -- and v2 introduced the 500. Same entry as
  `report.md#unitless-ratios-have-no-token`, which already covers 400/600/700.
  A weight ramp (`--fwm-weight-regular` / `-medium` / `-bold`) would close it.
- **blocked?** no.

### disabled-has-no-vocabulary-in-a-borderless-world

- **need**: v1 drew every disabled control by fading its EDGE to `--fwm-line`.
  v2 deleted the edges, so there is nothing left to fade, and v2 draws no
  disabled state anywhere on this panel.
- **affected**: the refused `PHOTO` key, an unwired mount chip, an unwired `✕`.
- **stand-in**: drop the control one rung DOWN the fill ladder --
  `--fwm-surface-control` (#1B1E25) to `--fwm-surface-1` (#0E0F13) -- with the
  label at `--fwm-text-disabled`. That is the same "recessed, not raised"
  reading the missing border used to carry, and it uses only fills v2 itself
  draws.
- **need from design**: v2's own disabled treatment for a flat filled control.
  This affects every screen, not just REPORT.
- **blocked?** no.

### invalid-state-needs-an-edge-in-a-borderless-design

- **need**: the `MAKE / MODEL` field refuses a plate-shaped entry
  (`reportDraft.ts`), and v1 said so with a `--fwm-destructive` edge. v2 has no
  edge to turn red -- and the field itself is undrawn in both versions
  (`report.md#make-model-opens-an-undrawn-field`).
- **stand-in**: the base rule declares
  `border: var(--fwm-report-rule-w) solid transparent` and the invalid state
  sets `border-color`. Borderless in every state that is not an error, no
  layout shift when it becomes one. This is v2's own idiom -- the selected
  mount chip is the same trick, an edge that appears only when the control has
  something to shout.
- **blocked?** no.

---

## Shared-file work this pass could not do

- `apps/pwa/src/components/dock/ReportKey.tsx` (shared dock) -- `onReport`
  defaults to `openScreen('report')`, which NAVIGATES to the sheet instead of
  raising it over the current screen. v2's dock note is explicit ("Tap opens
  the sheet") and the panel title is now literally
  `SHEET FROM THE DOCK KEY`, so the default should be
  `openReportSheet()` from `features/report`. Already tracked as still-open in
  `dock-v2.md#renamed-dock-files-that-other-notes-point-at`; v2 turns it from a
  preference into the drawn behaviour.
- `apps/pwa/src/app/screenState.ts` line 53 -- the registry comment still reads
  `report      App Screens 06 · REPORT - SHEET FROM ANY SCREEN`. Should read
  `SHEET FROM THE DOCK KEY`.
