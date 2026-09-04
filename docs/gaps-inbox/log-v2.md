# gap inbox -- LOG / EXPOSURE, v2 redesign

> **STALENESS WARNING, added 2026-08-30.** A v2 delta against v0's LOG, which the default design
> does not render.
>
> `apps/pwa/src/app/registry.v1.tsx:65` maps `log: ExposureScreen`; v1 is the
> default (`apps/pwa/src/app/design.ts:61`). This file's own summary - "v2
> changed no copy and no behaviour on this screen" - is a statement about a
> screen that has since been replaced outright.
>
> Read instead: `features/exposure/ExposureScreen.tsx`, `log.md`'s banner,
> `docs/STALENESS.md`.

Files: `apps/pwa/src/features/log/**` (`LogScreen.tsx`, `components/*.tsx`,
`log.css`, `exposure.ts`, `allTimeExposure.ts`).

Source read: `.design-src-v2/Flockys App Screens v2.dc.html` -- panel
`05 · LOG - EXPOSURE` (lines 337-408) in full, including its `FLOCKED TODAY`
and `TIMELINE` sub-panels, compared style by style against
`.design-src/Flockys App Screens.dc.html` (lines 323-390). The `DOCK` panel at
the foot of the v2 screen was read only to confirm it is still shell chrome.

`docs/gaps-inbox/log.md` holds the v1 entries. **Every one of them is still
open unless it is listed as closed below**; this file carries only what v2
changed. v2 changed no copy and no behaviour on this screen.

---

## What v2 changed on this screen, in full

Text delta: **none**. Every string on the v2 panel -- `EXPOSURE`, `TRIP`,
`ALL TIME`, `FLOCKED TODAY`, `12`, `CAMERAS · 4 UNIQUE`, `SUN`..`SAT`,
`HOTTEST SEGMENT` / `Reading Rd` / `5 CAMS / 1.2 MI`, `ALL TIME` / `1,284` /
`SINCE MAR 2026`, `TIMELINE`, all three row triples, `CONF`, `DISM`,
`HEAT MAP`, `ZONE AUDIT` -- is byte-identical to v1. The delta is entirely
visual, which is exactly the case a text diff cannot see.

| element | v1 | v2 |
|---|---|---|
| screen title | `17px / .1em` | `19px / .06em` |
| scope track | `1px #23262F`, radius 2, `overflow:hidden`, no fill, no padding, no gap | no border, `#15171D`, radius 8, `padding:3px`, `gap:3px` |
| scope key, selected | `34px`, `#FF2D5E` fill, ink `#000`, no radius (flush, clipped by the track) | `30px`, `#FF2D5E` fill, ink `#0A0A0C`, **radius 6** |
| scope key, unselected | `34px`, `#6B7381` | `34px`, `#6B7381` -- unchanged |
| `FLOCKED TODAY` card | `1px #23262F`, `#0E0F13`, radius 2, pad 18 | no border, `#12141A`, radius 6, pad 18 |
| both stat cards | `1px #23262F`, `#0E0F13`, radius 2, pad 14 | no border, `#12141A`, radius 6, pad 14 |
| timeline row rule | `1px #23262F` | `1px #191C22` |
| `HEAT MAP` / `ZONE AUDIT` | `1px #3A3F4B`, radius 2 | `1px #3A3F4B`, **radius 8** -- the edge survived |
| `REPORT CAMERA / 2 QUEUED` bar | drawn above the nav | gone -- absorbed into the dock (not this screen's; `LogView` never drew it) |
| the 5-key nav | a grid of word keys | one 58px dock bar (not this screen's) |

**Byte-identical to v1 and therefore untouched in code:**

- the 52px header and its `1px #23262F` bottom rule -- v2 kept `--fwm-line`
  here. It is screen chrome, not a control, which is the line v2 draws through
  the whole file: chrome keeps `--fwm-line`, list separators drop to
  `--fwm-line-soft`, controls lose their edge entirely unless they navigate
  somewhere.
- **the seven-day chart, completely.** Same 64px plot, same 5px gaps, same
  seven percentages, same `#23262F` base bar, same `#FFC02E` second and
  `#FF2D5E` peak, same 9px `#3A3F4B` axis at `margin-top:8px`. v2 rebuilt the
  card the chart sits in and did not touch the chart.
- the hero numeral (`72px / .9 / -.03em / #FF2D5E`) and its 13px caption.
- every eyebrow: `FLOCKED TODAY` and `TIMELINE` at 10px/.2em, the two stat
  eyebrows at 9px/.18em, all `#6B7381`.
- both stat-card interiors: 16px/600 value, 11px detail, `#FF2D5E` on the
  segment card and `#A7AFBD` on the all-time card.
- the timeline row itself apart from its rule: 56px, 14px gap, the 8px
  `border-radius:999px` dot in the recorded alert hue, 15px/600 name, 11px
  `#6B7381` mono meta.
- **`CONF` and `DISM`.** No fill, no radius, no edge, no size change --
  11px mono, `#3DE08A` and `#6B7381`. The only control on the screen v2 left
  completely alone, in both v1 and v2 drawn as a bare word.

---

## Product invariant, restated because a redesign is exactly when it gets lost

**A muted camera still counts and still draws a row.** v2 draws no muted state,
adds no dim, no strike, no reordering and no filter, and it moved the row's rule
colour and nothing else. `log.css` still contains no selector matching
`data-fwm-log-muted` (asserted in `LogView.test.tsx`, twice), `Timeline.tsx`
still filters nothing, and `LogScreen.test.tsx#muted cameras still count` still
renders the design's own drive twice -- audible and silenced -- and requires a
byte-identical panel. "Muting only removes the alert - never the record."
(`Flockys Screens II.dc.html`, B4.) Nothing in this pass touched that path.

---

## Closed by the v2 pass

- `docs/gaps-inbox/log.md#toggle-key-height-34` -- **superseded, see
  `#scope-key-30-34-and-a-3px-inset` below.** The v1 entry's stand-in was
  "hold 44px". v2 redraws the track with a 3px inset, which makes a 44px key a
  52px track inside a 52px header, so the stand-in no longer fits the drawing
  it was standing in for. The key now takes its drawn height and extends its
  hit area, which is the standing
  [`touch-target floor`](./README.md#touch-target-floor) decision and the
  pattern `.fwm-sweep-key` already uses.
- `DESIGN-GAPS.md#report-bar-tint-and-alert-tints` -- **not applicable to this
  screen.** LOG never drew a tinted alert surface; it does not draw one now.
- the `--fwm-surface-1` card fill and the `--fwm-radius-1` corner are no longer
  named anywhere in `log.css`. v2 draws neither on this screen.

---

## scope-key-30-34-and-a-3px-inset

- **Status:** STANDING IN
- **Need:** the 30px key, the 34px key and the 3px track inset v2 draws in the
  header segmented control.
- **Screens:** v2 `05 · LOG` header -- a `#15171D` track at radius 8 with
  `padding:3px; gap:3px`, holding a **30px** selected key and a **34px**
  unselected key. v2 draws this control exactly once more, in `06 · REPORT`
  (`NEW CAMERA` / `CONFIRM EXISTING`, v2 line 421): the same `#15171D` track,
  the same radius 8, the same `padding:3px; gap:3px`, the same radius-6 pill on
  the selected key with `#0A0A0C` ink -- and **both of its keys are 40px**. So
  the track is a pattern, and the equal-height reading below is v2's own in the
  one other place it drew this control; only LOG's 30-vs-34 is inconsistent
  with it.
- **Source:** three problems in one control.
  1. **The two keys are drawn at different heights.** A segmented control whose
     selected key is 4px shorter than its sibling is a mock artifact; nothing
     in the design system describes a segmented control that changes height
     when you press it.
  2. **Both are under the 44px touch floor** the design system states for the
     phone surface (`--fwm-touch-min`), and this is a control a driver uses in
     a car mount.
  3. **3px is not on the spacing scale**, which starts at `--fwm-space-1` (4px).
- **Stand-in:** one height for both keys, `--fwm-log-key-h: var(--fwm-space-8)`
  (32px) -- the nearest token to the drawn 30/34 and between them. The inset
  and the gap both take `--fwm-space-1` (4px), the nearest token. That lands
  the track at **40px, which is exactly the height v2 draws it** (34 + 3 + 3),
  inside the 52px header with 6px clear top and bottom. The **hit area** is
  taken to `--fwm-touch-min` by a transparent `::before` with
  `inset-block: calc((var(--fwm-touch-min) - var(--fwm-log-key-h)) / -2)`, so
  the drawn box is v2's and the target is the product's.
- **Consequence worth stating:** v2's `overflow:hidden` on the track is NOT
  carried. In v1 the clip was load-bearing -- it rounded the flush-mounted
  `TRIP` fill to the track's own 2px corner. In v2 the selected key carries its
  own 6px radius and is inset on all four sides, so nothing reaches the corner
  and the clip draws nothing; the only thing it could still do is cut the
  transparent hit-area overhang back under the touch floor.
- **Options:** (1) confirm 32px for both keys with the extended hit area;
  (2) add a `--fwm-touch-compact` (or a `--fwm-space-*` step at 3px) for
  in-header segmented controls and draw the track at v2's exact 40px with
  34px keys; (3) redraw the header control at the touch floor, which makes the
  track 52px and forces the header taller than `--fwm-header-h`; (4) take
  REPORT's 40px key as the canonical size for this control on both screens,
  which needs the header to grow and is therefore option (3) in disguise.
- **Whoever owns REPORT is drawing the same control.** Decide the segmented
  track once, for LOG and REPORT together.

## screen-title-19px-has-no-step

- **Status:** STANDING IN
- **Need:** the 19px screen title v2 draws.
- **Screens:** v2 `05 · LOG` -- `EXPOSURE` at `19px / 700 / .06em`, up from
  v1's `17px / .1em`. v2 does the same on `01 · RADAR`, `02 · SWEEP`,
  `03 · LOOKUP` and `06 · REPORT`, so 19px is v2's screen-title size.
- **Source:** the type scale steps `--fwm-text-subtitle` (17px) ->
  `--fwm-text-title` (24px). 19 falls between, nearer 17.
- **Stand-in:** `--fwm-text-subtitle`, so the title reads 2px small; the
  tracking IS expressible and is carried exactly, as
  `calc(var(--fwm-text-subtitle) * 0.06)`. Identical in kind and in value to
  `docs/gaps-inbox/radar-v2.md#screen-title-19px-has-no-step` -- **decide it
  once, for all five screens, not five times.**
- **Options:** (1) accept 17px on every v2 screen; (2) add a
  `--fwm-text-screen-title` (19px) and switch all five call sites; (3) restate
  the scale so `--fwm-text-subtitle` becomes 19px, which moves the two LOG
  stat-card values (`Reading Rd`, `1,284`) with it -- they render at 16px and
  already borrow this token.

## stat-cards-lost-their-edge-but-kept-their-padding-difference

- **Status:** STANDING IN -- carried forward, not introduced by v2.
- **Need:** v2 still pads the `FLOCKED TODAY` card 18px and the two stat cards
  14px, exactly as v1 did, while now giving all three the identical fill and
  radius.
- **Source:** with the border gone, the three cards are otherwise the same
  object drawn at two padding values, and neither value is on the scale.
- **Stand-in:** unchanged from v1 -- all three take `--fwm-space-4` (16px), one
  card rule for every card on the screen. Filed against
  `docs/gaps-inbox/log.md#spacing-scale-misses-5-14-and-18`, which is still the
  live entry; noted here only because v2 removing the border makes the two
  cards look more alike, which makes the 4px padding difference harder to
  justify rather than easier.
- **Options:** (1) leave it merged with the v1 entry; (2) draw all three cards
  at one padding in a v3.

## which-borders-v2-actually-kept-here

- **Status:** RESOLVED BY READING, recorded so it is not re-litigated.
- **Need:** "flat borderless controls" is a slogan; this screen still draws
  three borders and the code has to say which and why.
- **What v2 draws:** the header's bottom rule (`--fwm-line`), each timeline
  row's bottom rule (`--fwm-line-soft`), and the 1px `--fwm-line-strong` edge on
  `HEAT MAP` and `ZONE AUDIT`. Nothing else on the panel has an edge.
- **The reading in code:** chrome that divides the screen keeps `--fwm-line`;
  a separator inside a list drops to `--fwm-line-soft`; a control loses its
  edge unless it navigates off the screen, in which case the outline is what
  says so. The third clause is v2's own, not an invention here -- v2 made the
  identical call on SWEEP's `ROUTE` / `MESH` pair, on RADAR's `VOL` key and on
  RADAR's `RETRY LOCK`, while stripping the edge from RADAR's `REP` / `SET`.
- **No action needed.** Recorded because a future "finish the borderless pass"
  would otherwise strip these three and be wrong.
