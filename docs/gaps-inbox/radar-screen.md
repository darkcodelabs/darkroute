# gap inbox -- RADAR

> **STALENESS WARNING, added 2026-08-30.** The screen this describes is no longer the one a
> driver sees. It documents v0's RADAR - the instrument panel: dial, corridor
> ladder, compass, strip.
>
> v1 is the default design (`apps/pwa/src/app/design.ts:61`), and
> `apps/pwa/src/app/registry.v1.tsx:62` maps `radar: DriveScreen`. That is a
> different component, not a re-skin: `features/drive/DriveScreen.tsx:10-13`
> states the reason - "v0 RADAR is an instrument ... v1 DRIVE is a map with
> things floating on it." DRIVE has no 311px dial, no `REP`/`SET`/`VOL` key
> row, and no focus mode (`DriveScreen.tsx:27-31`).
>
> `RadarScreen.tsx` is not deleted and still renders after an explicit per-tab
> `?design=1` preview opt-in and selection of `V0 · ORIGINAL` in SETTINGS.
> Ordinary SETTINGS does not offer the retired design, so every entry below is
> still true OF v0 but none of it describes the shipped default.
>
> Read instead: `features/drive/DriveScreen.tsx` and `v1-redesign.md`. Full
> v0-to-v1 map: `docs/STALENESS.md`.

Files: `apps/pwa/src/features/radar/**` (`RadarScreen.tsx`, `components/*.tsx`,
`radar.css`, `radarState.ts`, `format.ts`).

Sources read: `Flockys App Screens.dc.html` -- screen `01 · RADAR - IN RANGE`
(lines 35-115) and the four-card `RADAR state matrix` (lines 478-538);
`Flockys Screens II.dc.html` -- `A2 · OFFLINE - DEGRADED` (lines 81-127),
`A1 · ONBOARDING - PERMISSIONS` (lines 34-77) and the persistent county strip
(lines 810-830).

Everything RADAR draws is a literal read from those: the 52px header, the three
`REP` / `SET` / `VOL` keys, `GPS LOCK` / `NO FIX`, `39.0997 N, 84.5786 W`,
`7 SATS`, `425` / `FT`, `AHEAD · SLIGHT LEFT`, `AHEAD · CLOSING`,
`CLEAR · NEAREST AHEAD`, `STILL TRACKING`, `3 in range`, `ALERT AT` / `500` /
`FT`, `CLEAR`, `NO GPS`, `last fix 40s ago.`, `showing cached cameras only.`,
`RETRY LOCK`, `MUTED 8:12`, `NO NETWORK · RUNNING ON CACHE`,
`CACHED CAMERA · AHEAD`, `RETRY SYNC`, `SPEED` / `MPH`, `HEADING` / `041°`,
`TODAY` / `PASSED`.

## Cross-references, not new entries

The decision is already filed; RADAR is another instance of it.

- `DESIGN-GAPS.md#radar-hero-96-vs-token-80` -- the hero renders at 96px with
  `line-height:.82; letter-spacing:-.04em`. `.fwm-radar-digits` uses
  `var(--fwm-text-hero)` (80px) and carries the rendered line-height and
  tracking, expressed as a ratio of the token rather than as a raw length. This
  is the screen the "survives a glance" principle was written about, so if only
  one screen ever gets a bespoke hero step, it is this one.
- `DESIGN-GAPS.md#micro-type-below-floor` -- filed under the task's slug and the
  same gap as the existing `micro-type-below-stated-floor`. RADAR's sites: the
  stat-tile labels and unit captions (9px), the GPS row, the strip labels, the
  ring caption, the header keys and the mute countdown (10px). All render at
  `var(--fwm-text-micro)` (11px), so RADAR is currently *more* legible than the
  reference and marginally looser in the fixed-height rows. No new decision is
  needed here beyond the one already open.
- `DESIGN-GAPS.md#multiple-state-never-rendered` -- implemented as the entry
  says: the in_range layout, the multiple hue, the count emphasised by exactly
  one type step (`--fwm-text-body` -> `--fwm-text-subtitle` on
  `.fwm-radar-inrange-label`). No structure was invented. RADAR needs option (1)
  confirmed or option (2) drawn; it cannot ship indefinitely on a swatch.
- `DESIGN-GAPS.md#report-bar-tint-and-alert-tints` -- the "N in range" bar is
  filled `rgba(255,45,94,.08)` in the design and `var(--fwm-surface-1)` here.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- see
  `radar-loading-state-not-drawn` below for the RADAR-specific half.
- `DESIGN-GAPS.md#animations-are-not-tokens` -- see
  `ring-durations-derived-from-dur-alert` below.
- `DESIGN-GAPS.md#vol-key-unspecified` and `DESIGN-GAPS.md#no-settings-screen-exists`
  -- `VOL` and `SET` are drawn exactly as designed and wired to nothing. Both
  render disabled unless a handler is passed, so the header keeps its shape
  without claiming a destination it does not have.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- the 1px
  hairline, the 2px expanding ring and the 3px ring stroke, all derived from
  `--fwm-space-1` (`/4`, `/2`, `*0.75`) as component-scoped locals.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.1em`,
  `.14em`, `.18em`, `.2em` and `-.04em` on this screen, expressed as
  `calc(var(--fwm-text-*) * n)`.

## radar-header-key-44x36

- need: a header-key size, or a ruling on what the 44px touch floor applies to.
- screen: `01 · RADAR - IN RANGE`, header right -- `REP`, `SET`, `VOL`.
- source: each key renders `width:44px; height:36px; border:1px; border-radius:2px`
  with a 10px mono label. 44px is exactly `--fwm-touch-min`; 36px is 8px below
  the product's own stated touch floor, in a 52px header that has room for 44.
- stand-in: `width: var(--fwm-touch-min); height: var(--fwm-touch-min)` -- the
  key is square. It is the nearest token in both axes and the only reading that
  keeps the target legal in a car mount, at the cost of a taller key than the
  reference draws.
- options: (1) keep the square 44px key and accept the header looks slightly
  heavier than the render; (2) add `--fwm-control-h: 36px` and exempt header
  keys from the touch floor, which weakens the floor everywhere; (3) redraw the
  header at 44px keys and re-check the 52px height.

## county-record-strip-34px

- need: a strip-height token, and a ruling on whether a tappable strip is a
  touch target.
- screen: the persistent county strip ("HAMILTON CO · 6 ON RECORD ... VIEW"),
  drawn on every screen after the county takeover is dismissed.
- source: `height:34px` in the render, with "Tapping it opens RECORD scoped to
  this county". The offline strip beside it renders 32px, which *is*
  `--fwm-space-8` exactly. Nothing in the scale is 34.
- stand-in: `min-height: var(--fwm-touch-min)` (44px) on the county strip
  because it is tappable, and `min-height: var(--fwm-space-8)` (32px) on the
  offline strip because it is not. The two strips therefore differ by 12px
  rather than by 2px as drawn.
- options: (1) add `--fwm-strip-h: 34px` and accept a sub-44px tap target on a
  full-width row (a full-width 34px strip is a forgiving target in practice);
  (2) keep the touch floor and redraw both strips at 44px; (3) make the strip
  non-tappable and move `VIEW` into a button inside it.

## ring-diameter-172px

- need: a component-size family. The token set has spacing and type, and nothing
  that sizes a circle.
- screen: `01 · RADAR` (172px ring), the four state-matrix cards (140px), SWEEP's
  range rings, the watch faces.
- source: `width:172px; height:172px` on screen 01; `width:140px; height:140px`
  in the matrix. Neither is on the 4/8/12/16/24/32/48 scale.
- stand-in: `width: min(100%, calc(var(--fwm-space-12) * 3.5))` -- 168px, the
  closest a derived value gets, clamped so a narrow surface cannot be overflowed
  by it. The inner rings sit at `--fwm-space-8` (32px, drawn 30) and twice that
  (64px, drawn 60).
- options: (1) add a size family (`--fwm-size-ring`, `--fwm-size-ring-compact`)
  and let the watch surface remap it, which is what the surface blocks are for;
  (2) make the ring fluid against its container and drop the fixed diameters
  entirely; (3) accept the derived multiple and document 168 as the real number.

## ring-durations-derived-from-dur-alert

- need: durations above 400ms in the token set, or an animation family.
- screen: RADAR's ring (`fwmRing 1.1s`, `fwmPulse 1.4s`), the offline strip dot
  (`fwmPulse 1.6s`), the no-fix dot (`fwmPulse 1s`), and every other animated
  element in the four design files.
- source: `--fwm-dur-alert` (400ms) is the longest duration the system exports,
  and every published animation duration exceeds it.
- stand-in: exact multiples of the token, as component-scoped locals:
  `*3.5` = 1400ms, `*2.75` = 1100ms, `*4` = 1600ms, `*2.5` = 1000ms. No literal
  duration appears in `radar.css`, and a mode that retimes `--fwm-dur-alert`
  retimes the ring with it -- which may or may not be desirable, and is the
  reason this needs a decision rather than a shrug.
- options: (1) export the five animations as system CSS with their own duration
  tokens (`--fwm-dur-ring`, `--fwm-dur-breathe`); (2) extend the duration ramp
  past `alert` and let the animations name steps on it; (3) keep the derived
  multiples and document that alert timing scales as one family.

## glow-token-is-crimson-only

- need: a glow that follows the state hue.
- screen: RADAR's ring and marker, in all four alert states. The design draws
  `box-shadow:0 0 26px rgba(61,224,138,.2)` for clear, `rgba(255,192,46,.22)`
  for approaching and `0 0 30px rgba(255,45,94,.32)` for in_range -- one glow per
  hue, each at its own radius and alpha.
- source: `--fwm-glow-alert: 0 0 28px rgb(255 45 94 / .28)` is the only glow the
  token set exports, and its colour is baked in.
- stand-in: the glow is applied only to `in_range` and `multiple`, where the
  crimson is either correct or close. `clear` and `approaching` render with no
  glow at all rather than with the wrong-coloured one; `multiple` reads slightly
  warmer than its own `#FF3DBE`.
- options: (1) rebuild the glow as `0 0 28px color-mix(in srgb, var(hue) 28%, transparent)`
  so it follows the hue automatically -- one token, correct in every mode;
  (2) export four glow tokens, one per state; (3) drop the glow from the system
  and let the ring carry the state on stroke alone.

## status-dot-size-has-no-token

- need: a token for the small status dots.
- screen: the GPS row (7px), the county strip (6px), the offline strip (6px),
  the county takeover card (8px), the mesh dots elsewhere (9px, 10px).
- source: five different diameters across the design files, none on the scale.
- stand-in: one derived `calc(var(--fwm-space-1) * 1.5)` = 6px for every dot on
  RADAR, so the GPS dot is 1px smaller than drawn and the strip dots are exact.
- options: (1) add `--fwm-dot: 6px` and standardise every status dot on it;
  (2) add a two-step dot scale (6/9) for "status" vs "entity"; (3) keep deriving
  from `--fwm-space-1` and accept the 1px difference.

## unit-and-readout-steps-missing

- need: type steps between `--fwm-text-title` (24px) and `--fwm-text-hero` (80px).
- screen: RADAR's hero unit (`FT`, 28px), the ring's threshold numeral (34px),
  the stat-tile values (26px), the state matrix's in-ring distance (38px), the
  offline hero (88px) and its unit (26px).
- source: the type ramp jumps 24 -> 40 -> 80. Five rendered sizes fall in the two
  gaps.
- stand-in: `--fwm-text-title` for the hero unit and the tile values,
  `--fwm-text-readout` for the ring numeral. The unit reads 4px small beside the
  hero and the ring numeral 6px large inside the ring.
- options: (1) add `--fwm-text-readout-sm` (~28px) and `--fwm-text-display` (~34px)
  and close both gaps; (2) express the unit as a ratio of the hero
  (`calc(var(--fwm-text-hero) * 0.35)`) so it tracks whatever the hero becomes --
  cheap, and arguably how it should have been specified; (3) accept the current
  steps and re-tune the two rows.

## spacing-scale-misses-10-14-and-30

- need: 10px and 14px steps, or a ruling that the scale is authoritative.
- screen: the strip gaps (10px), the RADAR body stack gap (14px), the direction
  line's top margin (14px), the ring's inner insets (30px and 60px), the REPORT
  bar's bottom padding (14px, already noted in the dock record).
- source: the scale is 4/8/12/16/24/32/48. The design renders 10, 14, 18 and 30
  repeatedly.
- stand-in: 10 -> `--fwm-space-2` (8), 14 -> `--fwm-space-3` (12), 30 ->
  `--fwm-space-8` (32), 60 -> `calc(var(--fwm-space-8) * 2)`. The screen is
  slightly tighter vertically than the reference.
- options: (1) add 10 and 14 to the scale, which makes it a 9-step scale and
  weakens it; (2) hold the scale and accept a few px of drift per row -- the
  cumulative difference on RADAR is about 10px over the whole column;
  (3) re-draw the reference screens on the scale and treat the renders as
  exploratory.

## radar-loading-state-not-drawn

- need: a loading state and a permission-denied state for RADAR, in the design's
  own voice.
- screen: RADAR before the first fix, and RADAR after location is refused. The
  design draws the no-GPS, muted and offline degradations and neither of these.
- source: nothing. `A1 · ONBOARDING - PERMISSIONS` is the closest thing, and it
  is a first-run screen, not a degraded RADAR.
- stand-in: the no-GPS structure with different copy. Two lead sentences are the
  only strings on this screen the design never wrote -- `waiting for the first
  fix.` and `location is off.` (or `this device has no location service.` when
  the platform has no geolocation at all). Both are lowercase and blunt, and the
  denied state's second line is verbatim from onboarding: "Required. Distance to
  cameras is computed on-device. Coordinates never leave the phone unless you
  file a report." The ring shows `NO GPS` in both, and the denied state's action
  is `ALLOW` (onboarding's word) rather than `RETRY LOCK`.
- options: (1) approve the two sentences as written; (2) write them properly as
  part of a pass over every screen's undrawn states, which is the larger open
  entry; (3) route a first run with no permission to onboarding instead of to a
  degraded RADAR, which leaves only the loading state to write.

## sat-count-unavailable-on-the-web

- need: what the GPS row's right-hand slot shows on a platform with no satellite
  count.
- screen: RADAR's GPS row -- `7 SATS`, `9 SATS`, and `0 SATS` in the no-fix card.
- source: a browser `GeolocationPosition` carries no satellite count and never
  has; only the TWA hardware bridge supplies one. The design assumes it is
  always there.
- stand-in: `±4 M`, the accuracy figure, which is the same fact the design
  prints beside the sat count on the REPORT sheet ("±4 M · 9 SATS · Reading Rd").
  Printing `0 SATS` beside a live lock would report a working fix as a broken
  one.
- options: (1) accept the accuracy fallback and specify it; (2) show both when
  both exist and the accuracy alone when only that does; (3) hide the slot
  entirely on platforms that cannot fill it, which makes the row's shape depend
  on the platform.

## slight-left-cut-point-undefined

- need: the angle at which `AHEAD` becomes `AHEAD · SLIGHT LEFT`.
- screen: `01 · RADAR - IN RANGE` renders `AHEAD · SLIGHT LEFT`; `B1 · PASSENGER
  MODE` renders `AHEAD · LEFT`. Nothing says at what relative bearing either
  starts, or what the difference between them is.
- source: the engine's `RelativeDirection` is four 90° sectors, and its own doc
  comment says the finer label is presentation, derived from the raw relative
  angle.
- stand-in: half of `AHEAD_HALF_ANGLE_DEG` (22.5°) -- the midpoint of the sector
  being subdivided, which is the only cut point available that is not invented.
  Under 22.5° off the heading reads `AHEAD`; 22.5-45° reads `AHEAD · SLIGHT
  LEFT` or `· SLIGHT RIGHT`. `approaching` deliberately stays coarse so the line
  reads exactly `AHEAD · CLOSING` as drawn.
- options: (1) confirm 22.5°; (2) specify a three-band ahead sector
  (`AHEAD` / `SLIGHT` / `HARD`) and give `B1`'s `AHEAD · LEFT` a defined meaning;
  (3) drop the refinement and render the four coarse sectors everywhere, which
  loses a string the design clearly wanted.
