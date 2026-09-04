# gap inbox -- LOOKUP and ASK, v2 redesign

> **STALENESS WARNING, added 2026-08-30.** The central claim in the header above is false,
> and has been since LOOKUP shipped.
>
> Line 27 says "LOOKUP has no implementation and this pass did not start one".
> There are now two: `features/lookup/LookupScreen.tsx` (158 lines), registered
> at `apps/pwa/src/main.tsx:109`, and `features/lookup/LookupV1Screen.tsx` (215
> lines), registered at `apps/pwa/src/app/registry.v1.tsx:101` and rendered by
> default (`apps/pwa/src/app/design.ts:61`). The section headed
> "The LOOKUP spec (not built)" at line 286 is a spec for a screen that was
> built.
>
> v1 also changed LOOKUP's QUESTION: v0 asks whether an operator searched your
> plate, v1 asks where the cameras are, with the plate hand-off behind a row
> (`registry.v1.tsx:97-101`,
> `features/lookup/PlateHandoffV1.tsx:5-9`). And the same
> dock correction as `ask.md`: LOOKUP and ASK are both v0 dock keys
> (`app/screenState.ts:56`). v1 keeps LOOKUP as the far-right Search key, while
> ASK remains behind More (`components/dock/DockV1.tsx:66-76`).
>
> This is the file most likely to make a reader conclude a shipped feature is
> missing. Read instead: `features/lookup/LookupV1Screen.tsx`,
> `features/lookup/PlateHandoffV1.tsx`, `docs/STALENESS.md`.

Files: `apps/pwa/src/features/ask/**` (`AskScreen.tsx`, `askAnswer.ts`,
`ask.css`, `components/*.tsx`). LOOKUP has no implementation and this pass did
not start one -- see [The LOOKUP spec](#the-lookup-spec-not-built) below.

Sources read: `.design-src-v2/Flockys App Screens v2.dc.html` -- screens
`03 · LOOKUP - PLATE HISTORY` (lines 202-272) and `04 · ASK - LISTENING`
(lines 274-336), compared declaration by declaration against the same two
panels in `.design-src/Flockys App Screens.dc.html` (lines 186-264 and
265-322); `apps/pwa/src/styles/tokens.css` for the v2 token additions.

`docs/gaps-inbox/ask.md` holds ASK's v1 entries. Every one of them is still
open unless it is listed as closed below; this file only carries what v2
changed.

---

## The one-line summary

**Neither panel changed a single string.** Not a label, not a caption, not a
chip, not a unit, not an ellipsis. A `diff` of the text content of v1 and v2
across both screens is empty.

Everything v2 did here is a **fill, a radius, a stroke that came off, or a
length** -- which is exactly the redesign the file's own subtitle claims:

> v1: `night watch mode · built on the tokens`
> v2: `v2 · flat borderless controls, 8px radius, fill-based depth`

The mechanism is consistent across both panels and worth stating once, because
it explains every row of both tables below:

1. a control loses its `1px` stroke;
2. its fill is **raised one rung** so it still separates from `#000`
   (`#0E0F13` -> `#12141A` for a card, transparent -> `#1B1E25` for a key);
3. its corner goes to `8px` if it is a control, `6px` if it is a card.

Step 2 is the part that is easy to miss and impossible to skip. v2 does not
simply delete borders -- deleting the border off a `#0E0F13` card on a `#000`
body leaves a card you cannot see. The fill ladder
(`--fwm-surface-card`, `--fwm-surface-control`, `--fwm-surface-dock`,
`--fwm-surface-track`) exists to carry the separation the strokes used to
carry, which is why the token phase added four fills and not one.

---

## ASK -- what v2 changed, in full

Text deltas: **none**.

| element | v1 | v2 | shipped as |
|---|---|---|---|
| screen title | `17px / .1em` | `19px / .06em`, `white-space:nowrap` | `--fwm-text-subtitle` + `calc(… * .06)`, see [no-19px-type-step](#no-19px-type-step) |
| `WAKE WORD ON` chip | `10px` mono `.1em` `#3DE08A` | identical | unchanged |
| header rule | `1px #23262F` | identical | one of the 30 borders v2 kept |
| voice meter | 7 solid `6px` bars, `4px` apart, vertically centred, flat `#22C8E0` | 9 dot-matrix columns `11px` wide, `3px` apart, bottom-aligned, over a masked `5px` dot field | see [the-voice-meter-is-a-dot-matrix-now](#the-voice-meter-is-a-dot-matrix-now) |
| bar periods | `.8 1.1 .7 1.3 .9 1.05 .75` | same seven **plus** `1.18` and `.86` | `--fwm-ask-dur-1..9` |
| `LISTENING…` caption | `11px` mono `.2em` `#22C8E0` | identical | unchanged |
| `YOU` block | `2px #3A3F4B` left rule, `14px` indent | identical | unchanged |
| `DARKROUTE` card | `1px #23262F`, fill `#0E0F13`, radius `2` | **no border**, fill `#12141A`, radius `6` | `--fwm-surface-card` + `--fwm-radius-2` |
| `TAKE DETOUR` | fill `#FF2D5E`, radius `2`, ink `#000` | fill `#FF2D5E`, radius `8`, ink `#0A0A0C` | `--fwm-radius-3` + `--fwm-text-on-alert` |
| `ON SWEEP` | `1px #3A3F4B`, radius `2` | `1px #3A3F4B`, radius `8` | `--fwm-line-strong` + `--fwm-radius-3` |
| `TRY` chips | `1px #3A3F4B`, radius `999px`, no fill | **no border**, fill `#1B1E25`, radius `8` | `--fwm-surface-control` + `--fwm-radius-3` |
| `REPORT CAMERA / 2 QUEUED` bar | present, above the nav | gone -- absorbed into the dock | shared dock |
| the 5-key nav | 5-column grid of word keys | one `58px` dock bar | shared dock |

Two of those deserve a sentence rather than a table row.

**`ON SWEEP` is the only stroked control left on this screen**, and that is the
point of it. v2 halved the border count but did not reach zero: a stroke now
means "the quiet half of a two-key row", and it survives here precisely because
the key beside it is filled. Removing it to be consistent with the chips would
have made `TAKE DETOUR` and `ON SWEEP` read as the same weight of choice.

**`TAKE DETOUR`'s ink moved off `--fwm-bg`.** v1 wrote `color:#000`, which the
implementation read as `var(--fwm-bg)` -- correct at the time and quietly
wrong: a mode that remaps the background repaints the label. v2 authored
`--fwm-text-on-alert` (`#0A0A0C`) as a named role for the three labels that sit
on a saturated fill, so this is now a role and not a coincidence.
`AskView.test.tsx` asserts the primary action does **not** use `--fwm-bg`.

### What did NOT change, and was not touched

- Every string, every phase, every handler, `askAnswer.ts` in its entirety.
- The rule that nothing requests the microphone on mount.
- `WakeWordChip` still reads the pessimistic `wakeWordCapability()`, not the
  general speech-recognition check. v2 draws the armed state, as v1 did, and
  the chip still starts `WAKE WORD OFF` for the reason in
  `ask.md#wake-word-chip-is-drawn-as-a-label`.
- `AskNotice` -- v2 draws no notice strip, so the strip keeps the treatment
  `ask.md#no-drawn-surface-for-the-wake-word-reason` gave it. See
  [notice-strip-fill-is-now-out-of-step](#notice-strip-fill-is-now-out-of-step).

---

## the-voice-meter-is-a-dot-matrix-now

**What v2 draws.** An `84px` band, `position:relative`, `align-items:flex-end`,
`gap:3px`, containing:

- one field, `position:absolute; inset:0`, painted
  `radial-gradient(circle at center, #1C2029 .7px, transparent 1.2px) 0 100%/5px 5px`
  and masked `linear-gradient(#0000, #0008 55%, #000d)`;
- then nine columns, each `width:11px; height:100%; position:relative;
  overflow:hidden`, each containing one fill at
  `position:absolute; left:0; right:0; bottom:0; height:<n>%`, painted
  `radial-gradient(circle at center, #22C8E0 .75px, transparent 1.25px) 0 100%/5px 5px`,
  masked `linear-gradient(#0000 0%, #000c 34%, #000 100%)`, with
  `transform-origin:bottom` and `animation:fwmVoice <period> ease-in-out infinite`.

Heights, in order: `70 100 55 85 65 95 50 78 60`.
Periods, in order: `.8 1.1 .7 1.3 .9 1.05 .75 1.18 .86`.

**What I did.** Built it exactly, as `.fwm-ask-field` + nine `.fwm-ask-bar`
clip boxes each wrapping a `.fwm-ask-bar-fill`. `VoiceBars.tsx` renders the
field first and the columns after, which is v2's DOM order and the reason no
`z-index` appears anywhere: both are positioned, so they paint in tree order.
Columns are addressed by `[data-fwm-ask-bar="n"]`, not `:nth-child`, because
the field occupies the button's first child slot and an ordinal selector would
silently address the wrong column.

**Two decisions inside this that are mine, not v2's:**

1. **The field never takes the hue.** v2 only draws the listening state, so it
   has nothing to say about what the field does when the microphone is shut.
   `--fwm-line-grid-1` is fixed here in every phase and only the columns follow
   `--fwm-ask-hue`. An instrument face has lit and unlit cells; the field is the
   unlit ones. If it followed the hue, an idle screen would glow.
2. **The columns still are the press target**, still drawn when idle, still
   inert when the platform cannot listen. v2 changed how the meter looks, not
   what it is, and `ask.md#no-drawn-control-starts-listening` is unchanged.

**Why nine and not seven.** Because v2 draws nine. There is no stated reason in
the file, and the two extra periods (`1.18`, `.86`) are distinct from all seven
old ones, so the meter's beat pattern is longer rather than doubled.

---

## dot-grid-geometry-has-no-token

**What v2 draws.** A `5px` lattice cell, with dot stops at `.7px / 1.2px` on
the field and `.75px / 1.25px` inside a column.

**What the token phase landed.** The three grid **colours**
(`--fwm-line-grid-1/2/3`) and the two **masks** (`--fwm-mask-voice-field`,
`--fwm-mask-voice-bar`). Nothing for the cell size or the dot radii.

**What I did.** Component-scoped locals derived from `--fwm-space-1`, in
`.fwm-ask`, following the pattern `ask.css` already uses for its `1px` and
`2px` rules:

| local | expression | renders |
|---|---|---|
| `--fwm-ask-grid-cell` | `calc(var(--fwm-space-1) * 1.25)` | `5px` |
| `--fwm-ask-field-dot` | `calc(var(--fwm-space-1) * 0.175)` | `.7px` |
| `--fwm-ask-field-dot-end` | `calc(var(--fwm-space-1) * 0.3)` | `1.2px` |
| `--fwm-ask-bar-dot` | `calc(var(--fwm-space-1) * 0.1875)` | `.75px` |
| `--fwm-ask-bar-dot-end` | `calc(var(--fwm-space-1) * 0.3125)` | `1.25px` |
| `--fwm-ask-bar-w` | `calc(var(--fwm-space-1) * 2.75)` | `11px` |
| `--fwm-ask-bar-gap` | `calc(var(--fwm-space-1) * 0.75)` | `3px` |

**Why locals and not tokens.** A sub-pixel dot radius is not a spacing step and
does not belong on the public scale; and RADAR and SWEEP draw the same lattice
at their own brightnesses (`--fwm-line-grid-2/3`) and their own scope sizes, so
whether the cell size is shared is a decision for whoever reconciles all three.

**What is still open.** If RADAR and SWEEP land the same `5px / .7px / 1.2px`
numbers as their own locals, three screens will carry three private copies of
one lattice and it should become `--fwm-grid-cell` + `--fwm-grid-dot` in
`tokens.css`. **That is a tokens-file change and this pass did not make it.**
Flagged for the tokens owner.

---

## no-19px-type-step

**What v2 draws.** Every screen title at `19px / .06em`. v1 drew `17px / .1em`.

**What the scale has.** `--fwm-text-subtitle` is `17px`, `--fwm-text-title` is
`24px`. Nothing between them, and the v2 token pass did not add one.

**What I did.** Kept `--fwm-text-subtitle` for the size and moved the tracking
to `calc(var(--fwm-text-subtitle) * 0.06)`, so half the delta ships and the
half that needs a new type step does not get invented.

**Consequence.** ASK's title renders 2px smaller than the reference and the
tracking is computed off that smaller size, so it is proportionally correct but
absolutely tighter. Every v2 screen has this, identically. **Filed for the
tokens owner:** a `19px` rung (`--fwm-text-heading`?) between subtitle and
title would close it for all five screens at once.

---

## no-disabled-state-for-a-filled-control

**What v2 draws.** Nothing. v2 draws no disabled chip, no disabled key and no
disabled action anywhere in either panel.

**Why it matters more than it did in v1.** In v1 an inert `TRY` chip dimmed its
border and its label, and the border carried most of the difference. v2 took
the border off, so the fill is now the entire affordance -- and a disabled chip
that keeps `--fwm-surface-control` looks exactly as pressable as a live one.

**What I did.** An inert chip drops one rung, to `--fwm-surface-1` (`#0E0F13`),
and sinks toward the body instead of standing off it. The label still goes to
`--fwm-text-disabled`. No new value: `--fwm-surface-1` is the rung immediately
below `--fwm-surface-control` in the ladder v2 itself authored.

**Why not just dim the label.** `ask.md` and RADAR both settled that an action
with nothing behind it renders *drawn, dimmed, inert* rather than live-looking.
Dimming a label while leaving a raised fill is live-looking.

**Still open.** The same question applies to every filled v2 control on every
screen -- dock keys, `RUN`, `REPORT`, the plate chips. One answer should serve
all of them, and it should come from the design rather than from five features
each picking a rung. Flagged.

---

## notice-strip-fill-is-now-out-of-step

**Context.** `ask.md#no-drawn-surface-for-the-wake-word-reason` gave ASK's
notice strip `--fwm-surface-2` (`#16181E`), borrowed from RADAR's `OFFLINE`
strip, because the design draws no surface for either sentence.

**What changed.** v2 introduced `--fwm-surface-card` (`#12141A`) and draws it
eleven times, and its own comment in `tokens.css` says `--fwm-surface-2` is
still drawn in v2 (SWEEP intel card, RADAR county strip, LOOKUP sparkline base,
the dock's active key). So `--fwm-surface-2` is not stale -- but it now means
"a filled *base* under something", not "a card".

**What I did.** Nothing. v2 is silent on this strip, the strip's treatment is
borrowed from RADAR, and RADAR's v2 pass is maintained separately. Changing it here
would fork an idiom that is supposed to be shared.

**Open question for whoever reconciles the two:** if RADAR's `OFFLINE` strip
moves to `--fwm-surface-card`, this must move with it, in the same commit.

---

## Cross-references, not new entries

- `docs/gaps-inbox/ask.md` -- all v1 ASK entries remain open:
  `no-drawn-control-starts-listening`, `wake-word-chip-is-drawn-as-a-label`,
  `no-drawn-surface-for-the-wake-word-reason`, `try-chips-are-below-the-touch-floor`,
  `only-the-listening-caption-is-drawn`, `route-answers-cannot-be-computed`,
  `voice-bar-periods-derived-from-dur-alert`,
  `voice-band-and-bar-widths-have-no-token`, `fwm-0442-is-a-camera-id-not-a-plate`,
  `transcript-and-answer-type-steps-missing`.
- `docs/gaps-inbox/tokens-v2.md#radius-scale-contradicts-section-08` -- ASK now
  draws `--fwm-radius-3` and `--fwm-radius-2` and no longer draws
  `--fwm-radius-1` or `--fwm-radius-full` at all.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- the `.06em`
  title tracking, expressed as `calc(var(--fwm-text-subtitle) * 0.06)`.
- `DESIGN-GAPS.md#animations-are-not-tokens` -- two more periods on the same
  `--fwm-dur-alert` multiples.
- `docs/gaps-inbox/dock-v2.md` -- the `REPORT CAMERA` bar's disappearance and
  the `58px` dock bar. ASK renders neither; `src/app/App.tsx` does.

---

## The LOOKUP spec (not built)

**LOOKUP is not implemented and this pass did not implement it.** It is gated
behind `FEATURES.plateLookup`, which is `false` in `apps/pwa/src/config/features.ts`
pending permission from haveibeenflocked. `Dock.tsx` already renders the LOOKUP
key inert for exactly that reason (`Dock.tsx:174`).

What follows is a transcription of `03 · LOOKUP - PLATE HISTORY` from
`.design-src-v2/Flockys App Screens v2.dc.html` (lines 202-272), precise enough
to build from without reopening the design file, with the token for every value
and the v1 value it replaced. **No code was written from it.**

### LOOKUP -- what v2 changed from v1

Text deltas: **none**. Same table shape as ASK's above.

| element | v1 | v2 |
|---|---|---|
| screen title | `17px / .1em` | `19px / .06em`, `white-space:nowrap` |
| `LOCAL ONLY · NEVER UPLOADED` | `10px` mono `.1em` `#6B7381` | identical |
| plate field | fill `#0E0F13`, `1px #3A3F4B`, radius `2` | **no border**, fill `#1B1E25`, radius `8` |
| `RUN` key | fill `#FF2D5E`, radius `2`, ink `#000` | fill `#FF2D5E`, radius `8`, ink **still `#000`** |
| selected plate chip | `1px #FF2D5E`, radius `999px`, no fill, label `#FF2D5E` | `1px rgba(255,45,94,.5)`, fill `rgba(255,45,94,.13)`, radius `8`, label `#FF8DA5` |
| other plate chip | `1px #3A3F4B`, radius `999px`, no fill | **no border**, fill `#1B1E25`, radius `8` |
| `+` key | `1px #3A3F4B`, radius `999px`, `36x36` | **no border**, fill `#1B1E25`, radius `8`, `36x36` |
| stat card | `1px #23262F`, fill `#0E0F13`, radius `2` | **no border**, fill `#12141A`, radius `6` |
| sparkline | 8 bars, `3px` gap, `30px` tall | **identical, byte for byte** |
| read-row rule | `1px #23262F` | `1px #191C22` |
| the three read rows | `60px`, counts `21 / 14 / 9` | **identical apart from the rule** |
| disclosure quote | `2px #FFC02E` left rule, `10px` mono `#A7AFBD` | **identical** |
| `REPORT CAMERA` bar | present | gone -- into the dock |
| the 5-key nav | grid of word keys | one `58px` dock bar |

Note the two anomalies, because a build will otherwise "fix" them:

- **`RUN` keeps `#000` ink, not `#0A0A0C`.** v2 uses `--fwm-text-on-alert`'s
  `#0A0A0C` on `TAKE DETOUR`, `TRIP` and `NEW CAMERA`, and leaves `RUN` at pure
  black. Draw it with `--fwm-bg` and file the inconsistency; do not "correct" it.
- **The selected plate chip is the only place `#FF8DA5` appears besides
  REPORT's selected tag.** It is `--fwm-alert-in-range-text`, and
  `tokens-v2.md#in-range-text-needs-five-mode-values` says it still needs a
  value in all five non-default modes. LOOKUP cannot ship correctly in
  `neon-grid`, `pursuit` or `cluster` until that is closed.

### LOOKUP -- element by element

**Screen root** -- column, `background: var(--fwm-bg)`, own scroll on the body,
the same `overflow-y:auto` decision `ask.css` documents (`App.tsx`'s `<main>`
does not scroll).

**Header** -- `height: var(--fwm-header-h)` (52px), `padding: 0 var(--fwm-space-4)`,
`justify-content: space-between`, `border-bottom: 1px var(--fwm-line)`.

- title `LOOKUP` -- `--fwm-text-subtitle`, `700`, tracking `calc(size * .06)`,
  `white-space: nowrap`. Same [no-19px-type-step](#no-19px-type-step) gap.
- right `LOCAL ONLY · NEVER UPLOADED` -- `--fwm-font-data`, `--fwm-text-micro`,
  tracking `calc(size / 10)`, `--fwm-text-muted`, nowrap.
  **This string is a promise the code must keep**, not a caption: see
  [What LOOKUP must never do](#what-lookup-must-never-do).

**Body** -- `flex: 1; min-height: 0; padding: var(--fwm-space-4)`, column,
drawn gap `14px` -> `--fwm-space-3` (12px), the standing
`radar-screen.md#spacing-scale-misses-10-14-and-30` gap.

**1. `YOUR PLATE` group** (`flex: none`)

- label `YOUR PLATE` -- `--fwm-font-data`, `--fwm-text-micro`, tracking
  `calc(size * .18)`, `--fwm-text-muted`, drawn `margin-bottom:10px` ->
  `--fwm-space-2`.
- row -- `display:flex; gap: var(--fwm-space-2)`
  - **plate field** -- `flex:1`, drawn `height:64px`
    (`calc(var(--fwm-space-4) * 4)`), `background: var(--fwm-surface-control)`,
    `border: 0`, `border-radius: var(--fwm-radius-3)`,
    `padding: 0 var(--fwm-space-4)`, `--fwm-font-data`, drawn `30px` / `700` /
    tracking `.14em`. **No token at `30px`**: `--fwm-text-title` is `24px`,
    `--fwm-text-readout` is `40px`. File it; take `--fwm-text-title`.
    It is a text input, not a div -- `inputMode="text"`, `autoComplete="off"`,
    `autoCorrect="off"`, `spellCheck={false}`, and **never** `type="search"`
    (search inputs get history UI).
  - **`RUN` key** -- `64x64`, `background: var(--fwm-alert-in-range)`,
    `border-radius: var(--fwm-radius-3)`, `--fwm-font-data`, `--fwm-text-micro`,
    `700`, tracking `calc(size * .06)`, `color: var(--fwm-bg)` (see the anomaly
    above). Already over `--fwm-touch-min`.
- chip row -- `display:flex; gap: var(--fwm-space-2)`, drawn `margin-top:10px`
  -> `--fwm-space-2`. Drawn `height:36px`, which is **under the 44px floor**:
  keep the drawn height and extend the hit area with the transparent `::before`
  that `.fwm-sweep-key` uses (`inset-block: calc((var(--fwm-touch-min) - 36px) / -2)`).
  Do not grow the drawn box.
  - selected chip (`OH · HVK 8842`) -- `padding: 0 var(--fwm-space-3)`,
    `border: 1px solid var(--fwm-tint-in-range-line)`,
    `background: var(--fwm-tint-in-range-weak)`,
    `border-radius: var(--fwm-radius-3)`, `--fwm-font-data`,
    `--fwm-text-micro`, `color: var(--fwm-alert-in-range-text)`, nowrap.
    It is a radio group, one selected; `aria-pressed` or `role="radio"`.
  - unselected chip (`KY · 471 TRB`) -- same box, `border: 0`,
    `background: var(--fwm-surface-control)`, `color: var(--fwm-text-2)`.
  - `+` key -- `36x36`, `background: var(--fwm-surface-control)`,
    `border-radius: var(--fwm-radius-3)`, `--fwm-font-data`, drawn `15px` ->
    `--fwm-text-body`, `color: var(--fwm-text-2)`. Needs a real accessible name
    (`aria-label="add a plate"`); `+` alone is not one.

**2. Stat card** (`flex: none`) -- `background: var(--fwm-surface-card)`,
`border: 0`, `border-radius: var(--fwm-radius-2)`, drawn `padding:14px 16px` ->
`var(--fwm-space-3) var(--fwm-space-4)`.

- label `READS ON THIS PLATE · 30 DAYS` -- `--fwm-font-data`,
  `--fwm-text-micro`, tracking `calc(size / 5)`, `--fwm-text-muted`.
- readout row -- `align-items: baseline; gap: var(--fwm-space-2)` (drawn 10px),
  drawn `margin-top:6px` -> `--fwm-space-1`.
  - numeral `73` -- `--fwm-font-data`, drawn `68px` / `700` / `line-height:.9` /
    tracking `-.03em` / `color: var(--fwm-alert-in-range)`. **No `68px` token**:
    `--fwm-text-hero` is `80px`, `--fwm-text-readout` is `40px`. File it; take
    `--fwm-text-hero` and accept the overshoot, or derive
    `calc(var(--fwm-text-hero) * .85)` and file that instead. Decide once --
    LOG's `FLOCKED TODAY` numeral has the same problem.
  - caption `CAPTURES` / `19 DISTINCT CAMERAS` -- `--fwm-font-data`, drawn
    `12px` -> `--fwm-text-micro`, `--fwm-text-2`, `line-height: 1.6`, two lines.
- sparkline -- `display:flex; gap:3px`
  (`calc(var(--fwm-space-1) * .75)`), drawn `height:30px`, drawn
  `margin-top:12px` -> `--fwm-space-3`. Eight bars, `flex:1`,
  `align-self: flex-end`, heights `30 55 75 40 100 62 48 22`%,
  `background: var(--fwm-surface-2)` except bar 3
  (`--fwm-alert-approaching`) and bar 5 (`--fwm-alert-in-range`).
  **This is byte-identical to v1** -- v2 did not touch it. It is real data, so
  the two hues must be computed (the peak day and the worst day), not hardcoded
  at index 3 and 5.
- footer `JUL 21 → AUG 19` -- `--fwm-font-data`, drawn `9px` ->
  `--fwm-text-micro`, `--fwm-text-disabled`, tracking `calc(size * .14)`,
  drawn `margin-top:8px` -> `--fwm-space-2`.

**3. `WHERE IT GOT READ` label** (`flex: none`) -- same treatment as the stat
card's label.

**4. The read list** -- `flex:1; min-height:0; overflow-y:auto`. Each row:
`display:flex; align-items:center; gap: var(--fwm-space-3)` (drawn 14px),
drawn `height:60px`, `border-bottom: 1px solid var(--fwm-line-soft)`.
`--fwm-line-soft` (`#191C22`) is a **v2 token authored for exactly this rule**
and for LOG's timeline -- v1 drew `--fwm-line` (`#23262F`) here.

- count -- drawn `width:38px`, centred, `--fwm-font-data`, drawn `19px` ->
  `--fwm-text-subtitle`, `700`, `flex:none`. Hue is the four-state ladder, not
  decoration: `21` `--fwm-alert-in-range`, `14` `--fwm-alert-approaching`,
  `9` `--fwm-text-2`. Thresholds must be computed.
- middle -- `flex:1; min-width:0`. Name at drawn `15px` -> `--fwm-text-body`,
  `600`, nowrap. Sub-line `--fwm-font-data`, `--fwm-text-micro`,
  `--fwm-text-muted`, nowrap: `FWM-0442 · HOA · SHARED`, `FWM-0118 · PD · SHARED`,
  `FWM-0873 · PRIVATE`.
- right -- `--fwm-font-data`, `--fwm-text-micro`, `--fwm-text-muted`,
  `flex:none`, nowrap: `DAILY`, `WEEKDAYS`, `NIGHTS`.
- The rows are `60px` and the design draws them as static divs. If they become
  navigable (to the camera on SWEEP), they are buttons and already clear the
  touch floor.

**5. Disclosure quote** (`flex: none`) -- `border-left: 2px solid
var(--fwm-alert-approaching)`, drawn `padding:2px 0 2px 12px` ->
`0 0 0 var(--fwm-space-3)` plus `--fwm-space-1` block padding,
`--fwm-font-data`, `--fwm-text-micro`, `--fwm-text-2`, `line-height: 1.6`.
Copy, verbatim, em dash included:

> `Plate never leaves this device. Matched against your own trip log - no Flock system is queried.`

**6. Dock** -- not this screen's. LOOKUP's active key is amber:
fill `--fwm-tint-approaching`, radius `--fwm-radius-4`, icon and label
`--fwm-alert-approaching`, icon
`<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.6 15.6 20.5 20.5"/>` at
`stroke-width="1.6"`.

### What LOOKUP must never do

These are not style notes. They are the reason the screen is gated, and they
outrank the panel.

1. **The plate never leaves the device.** No request carries it, in any form --
   not a body, not a query string, not a header, not a hash of it. The
   header says `LOCAL ONLY · NEVER UPLOADED` and the disclosure says
   `no Flock system is queried`. Both are load-bearing claims.
2. **No plate in a URL.** Not a route param, not a search param, not a fragment.
   URLs reach history, referrers, share sheets and crash reports.
3. **No plate in a notification, a log line, or an analytics event.** Same rule
   ASK's `Transcript.tsx` already documents for spoken questions, and for the
   same reason: a plate identifies a person.
4. **`RUN` matches against the device's own trip log.** It is a local join, not
   a lookup service. The count and the read rows are derived from data the
   phone already holds.
5. **Muted cameras still count.** A camera the user silenced still produced a
   read and still appears in `WHERE IT GOT READ` and in the `73`.
6. **The screen stays behind `FEATURES.plateLookup`** until permission from
   haveibeenflocked exists. Building the UI does not lift the gate.
