# gap inbox -- LOG / EXPOSURE

> **STALENESS WARNING, added 2026-08-30.** The LOG screen this describes is v0's. It is also the
> source of a navigation claim that is now false.
>
> `apps/pwa/src/app/registry.v1.tsx:65` maps `log: ExposureScreen`, and v1 is
> the default (`apps/pwa/src/app/design.ts:61`). EXPOSURE leads with the count
> rather than the table, and it is a new component - not a re-skin of
> `LogScreen.tsx`.
>
> The `HEAT MAP` and `ZONE AUDIT` footer keys documented here are v0-only.
> `features/log/LogScreen.tsx:206` and `:210` hold the only
> `openScreen('heat-map')` / `openScreen('zone-audit')` calls in the app, and
> `features/exposure/ExposureScreen.tsx` contains no `openScreen` call at all.
> Under the shipped default those two screens have NO navigation path - they
> are reachable only by typing `?screen=`. Do not read this file as evidence
> that they are reachable.
>
> Read instead: `features/exposure/ExposureScreen.tsx`, and `zone-audit.md`'s
> own banner. Full v0-to-v1 map: `docs/STALENESS.md`.

Files: `apps/pwa/src/features/log/**` (`LogScreen.tsx`, `components/*.tsx`,
`log.css`, `exposure.ts`, `allTimeExposure.ts`).

Sources read: `Flockys App Screens.dc.html` -- panel `05 · LOG - EXPOSURE`
(lines 323-390) in full, plus the `DOCK - REPLACES THE ICON ROW` panel for what
belongs to the shell rather than to this screen; `Flockys Watch.dc.html` --
`W5 · TODAY - EXPOSURE GLANCE` (lines 122-146), which draws the same seven-bar
trend and names it `7 DAY TREND`; `Flockys Screens II.dc.html` -- `B4 · ALERT
TRIAGE` (line 536, the muting rule) and `B6 · ZONE AUDIT` (line 594, the
destination of the second footer key).

Everything the panel draws is a literal read from those: `EXPOSURE`, `TRIP`,
`ALL TIME`, `FLOCKED TODAY`, `12`, `CAMERAS · 4 UNIQUE`, the seven bars and the
`SUN`..`SAT` axis, `HOTTEST SEGMENT` / `Reading Rd` / `5 CAMS / 1.2 MI`,
`ALL TIME` / `1,284` / `SINCE MAR 2026`, `TIMELINE`, `Vine St & 7th` /
`14:22:08 · 47 MPH · 380 FT` / `CONF`, `Reading Rd` /
`14:09:51 · 38 MPH · 760 FT` / `DISM`, `I-71 N Exit 3` /
`13:58:12 · 62 MPH · 210 FT` / `CONF`, `HEAT MAP`, `ZONE AUDIT`.

The `REPORT CAMERA` bar and the five dock word-keys that the panel also draws
are NOT reproduced here: they are shell chrome (`app/App.tsx` +
`components/dock`), rendered on every screen, and a second copy would put two
docks on the page. `LogView.test.tsx` asserts this screen draws neither.

## Cross-references, not new entries

The decision is already filed; LOG is another instance of it.

- `DESIGN-GAPS.md#token-set-does-not-cover-rendered-hero-sizes` -- the
  `FLOCKED TODAY` numeral renders 72px with `line-height:.9;
  letter-spacing:-.03em`. `.fwm-log-hero` uses `var(--fwm-text-hero)` (80px) and
  carries the rendered line-height and tracking as ratios of the token rather
  than as raw lengths.
- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- LOG's sites: the two scope
  keys and `FLOCKED TODAY` / `TIMELINE` (10px), the two stat-card eyebrows
  (9px), the `SUN`..`SAT` axis (9px), the row meta line and the stat detail
  lines (11px, on the floor). All render at `var(--fwm-text-micro)`.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- see
  `timeline-empty-state-not-drawn` below for the LOG-specific half.
- `DESIGN-GAPS.md#no-heat-map-screen-exists` -- the `HEAT MAP` key is wired to
  the already-declared `heat-map` screen id, which the shell renders as its
  honest "screen not built" state. Nothing was invented for it and the key was
  not dropped.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- every
  1px hairline on this screen, derived as `calc(var(--fwm-space-1) / 4)` in a
  component-scoped local (`--fwm-log-rule-w`).
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.1em`,
  `.08em`, `.18em`, `.2em` and `-.03em` on this screen, expressed as
  `calc(var(--fwm-text-*) * n)`.

## what-the-trip-all-time-toggle-scopes

- **Status:** STANDING IN
- **Need:** what changes when the header toggle moves.
- **Screens:** `05 · LOG - EXPOSURE` draws the toggle with `TRIP` filled and
  draws the screen ONLY in that state. Nothing anywhere shows the `ALL TIME`
  state, so the design never says which surfaces the toggle governs.
- **Stand-in:** the toggle scopes the two surfaces that carry no scope label of
  their own -- `HOTTEST SEGMENT` and `TIMELINE`. `FLOCKED TODAY` and the
  `ALL TIME` card name their own windows in their own eyebrows and do not move.
  `TRIP` means the current trip's window (`trip.startedAtMs` to `endedAtMs`, or
  to now while it is open); with no trip started, `TRIP` is genuinely empty
  rather than silently falling back to everything.
- **Options:** (1) confirm the stand-in; (2) the toggle also swaps the hero from
  today's count to the all-time count, which would make the `ALL TIME` card
  redundant in one of the two states; (3) draw the `ALL TIME` state.

## seven-day-window-is-rolling

- **Status:** STANDING IN
- **Need:** whether the seven bars are a calendar week or a rolling window.
- **Screens:** `05 · LOG` labels the axis `SUN MON TUE WED THU FRI SAT`, which
  reads as a fixed calendar week. `W5 · TODAY - EXPOSURE GLANCE` draws the same
  seven bars and captions them `4 UNIQUE · 7 DAY TREND`, which reads as rolling.
- **Stand-in:** rolling -- seven local days ending on today, oldest first, each
  bar labelled with its own weekday. When today is a Saturday this prints
  exactly the drawn `SUN`..`SAT` axis, so the rolling reading reproduces the
  reference panel and still means something on a Tuesday. A calendar week would
  draw up to six empty future bars for most of the week.
- **Options:** (1) confirm rolling; (2) calendar week with future days blank;
  (3) calendar week with the axis anchored on the driver's locale first-day.

## bar-hue-rule-is-inferred

- **Status:** STANDING IN
- **Need:** what makes a bar crimson and what makes it amber.
- **Screens:** both renderings fill the TALLEST of the seven bars with
  `--fwm-alert-in-range` and the SECOND tallest with `--fwm-alert-approaching`,
  and leave the other five on `--fwm-line`. Neither says so in words, and
  neither is "today" (in both, the highlighted bars are the sixth and fourth of
  seven, and the seventh is the last day).
- **Stand-in:** peak = every day holding the top count; second = every day
  holding the next distinct count below it. Ties are not broken by position,
  because picking one of two equally bad days would be arbitrary; the
  reference's seven values are all distinct, so it renders identically.
- **Options:** (1) confirm; (2) highlight today instead of the peak; (3)
  threshold-based hues (e.g. amber over N, crimson over M) -- needs the numbers.

## bar-heights-are-quantised

- **Status:** STANDING IN
- **Need:** a way to express a data-driven bar height without an inline style.
- **Screens:** the design's bars are `height:22%` .. `height:100%`, i.e. an
  arbitrary percentage per bar, which in a real build is a per-render value.
- **Stand-in:** twenty 5% steps, one CSS rule each, selected by
  `data-fwm-log-bar-level`. Heights are normalised so the peak day is 100%. The
  worst-case error against a true percentage is 2.5% of the plot height (1.6px
  at the rendered 64px), which is under the hairline. `LogView.test.tsx`
  asserts no element in the panel carries a `style` attribute.
- **Options:** (1) keep the quantised steps; (2) allow ONE audited custom
  property to be set from the component (`--fwm-log-bar-level`) and have CSS do
  the arithmetic -- still an inline style, so it needs a checker exemption; (3)
  render the trend as an inline SVG with token-driven geometry.

## empty-day-draws-a-baseline

- **Status:** STANDING IN
- **Need:** what a day with no camera passes looks like.
- **Screens:** the design's seven bars are all non-zero, so it never draws one.
- **Stand-in:** level 0 renders at the 1px hairline rather than at zero height,
  so the week always reads as seven days and an empty day is visibly empty
  rather than missing. A zero day is a GOOD day and it should be legible as one.
- **Options:** (1) keep the baseline tick; (2) draw nothing and let the axis
  label carry the day; (3) draw an outlined bar.

## hottest-segment-length-is-not-measured

- **Status:** OPEN -- the only place this screen prints an em dash where the
  design prints a number.
- **Need:** the `1.2 MI` in `5 CAMS / 1.2 MI`.
- **Screens:** `05 · LOG`, the `HOTTEST SEGMENT` card.
- **Source:** nothing in this build measures the length of a road segment. An
  `AlertLogEntry` deliberately carries no coordinates ("a coordinate history IS
  a movement history" -- `stores/history.ts`), the trip odometer is a whole-trip
  figure, and `@fwm/core` measures point-to-point distance, not street extent.
- **Stand-in:** the camera count is real and the length prints ` - `, so the card
  keeps the shape the design draws without asserting a distance nobody measured.
- **Options:** (1) carry a per-pass odometer reading on the log row and take the
  span between the first and last pass on a segment -- cheapest, and adds no
  coordinate to the record; (2) get segment geometry from the camera tiles and
  measure it in the engine; (3) drop the length from the card.

## nothing-rolls-the-day-over

- **Status:** OPEN -- a missing owner in a shared slice, filed here because LOG
  is the screen that shows the damage.
- **Need:** something that calls `historyActions.rollDay(localDayStart(now))`.
- **Screens:** `05 · LOG` -- `FLOCKED TODAY`; `W5 · TODAY - EXPOSURE GLANCE`,
  the same counter on the watch.
- **Source:** `stores/history.ts` keeps `today.passes` / `today.uniqueCameraIds`
  and zeroes them in exactly one place, `rollDay` (history.ts:245).
  `grep -rn rollDay apps/pwa/src` finds the store, its actions object and its
  tests -- no product code. `notePass` (history.ts:216) increments with no day
  comparison, `clear()` (history.ts:255) wipes `entries` and leaves `today`
  standing, and `hydrate()` replaces `entries` and never touches `today`. So
  the slice's `today.passes` is "passes since this store was constructed".
- **Stand-in:** LOG does not read that counter. `exposure.ts#todayExposure`
  counts today's PASSES off the recorded rows, bucketed by the same
  `localDayStart` the seven bars use, so the hero and the last bar of the week
  are the same number by construction -- across midnight, after `clear()`,
  after a `hydrate()`, in every case where the counter and the rows disagree.
  `LogScreen.test.tsx` drives a two-day drive and asserts the slice says 5
  while the hero says 3.
- **Known limit of the stand-in:** the row log is capped at
  `DEFAULT_MAX_HISTORY_ENTRIES` (500), so a day past 500 recorded transitions
  would under-count where an unbroken counter would not. That is a ceiling this
  screen shares with the seven bars, the TIMELINE and HOTTEST SEGMENT -- every
  surface stays consistent with every other, which is the property worth
  keeping. Option (1) removes the ceiling for the hero only.
- **Options:** (1) call `rollDay` from the driving loop (or a midnight timer)
  and read the counter again, which survives the row cap; (2) keep counting
  rows and delete the `today` slice as dead weight; (3) have `notePass` compare
  the day itself and roll implicitly -- a store edit, and it needs a clock the
  store does not currently own.

## nothing-hydrates-the-durable-counters

- **Status:** OPEN -- LOG loads its own half; the rest of the seam is unowned.
- **Need:** an owner for `historyActions.hydrate()`, which loads the durable
  alert log and the all-time counters back into the session slice.
- **Screens:** `05 · LOG` -- `ALL TIME` / `1,284` / `SINCE MAR 2026`.
- **Source:** `allTimePasses` starts `null`; `notePass` refuses to increment a
  null (history.ts:228); and `grep -rn 'hydrate(' apps/pwa/src` outside tests
  finds only the store's own definition. Left alone, the card renders ` - `
  permanently -- not "until the durable count lands", but for ever.
- **Stand-in:** `features/log/allTimeExposure.ts` reads the figure itself, from
  `services/db/repositories/trips.ts` -- `totalExposure()`, which that file's
  own comment names "All-time exposure, for the EXPOSURE comparison", and the
  oldest recorded `startedAt` for `SINCE`. One read-only open per mount, closed
  in a `finally`, injected as a port so no test touches a database, exactly as
  `features/offline/cache.ts` does it. `resolveAllTime()` still prefers the
  history slice whenever something HAS hydrated it, so this is a fallback and
  not a second source of truth.
- **Known limits of the stand-in:** (a) the durable figure is a snapshot of
  FINISHED trips, so it does not tick up during the drive that is happening --
  and nothing finishes a trip in this build either
  (`#trip-lifecycle-has-no-owner`); (b) `SINCE` is the oldest trip STILL ON THE
  DEVICE, and trips are capped at `MAX_TRIPS`; (c) a device with no trips at
  all reads `unavailable` and prints ` - ` rather than `0`, because no
  measurement is not a measurement of zero.
- **Options:** (1) hydrate once at app start (`main.tsx` / a bootstrap module)
  from `alerts` + `trips`, which fixes the timeline, the counters and this card
  in one place and makes the fallback here dead code worth deleting; (2) have
  this screen call `hydrate()` with the entries it already holds, which keeps
  the number live for the session but makes a screen mutate a shared slice by
  being looked at; (3) leave the read-only fallback.

## timeline-draws-encounters-hero-counts-passes

- **Status:** STANDING IN
- **Need:** which recorded rows the `TIMELINE` draws.
- **Screens:** `05 · LOG` draws three rows, and the middle one --
  `Reading Rd` / `14:09:51 · 38 MPH · 760 FT`, dot `#FFC02E`
  (`--fwm-alert-approaching`) -- is at 760 FT against the 500 FT threshold the
  panel set draws elsewhere. That row is an APPROACHING row. The other two are
  in-range rows, and no camera appears twice.
- **Source:** `stores/alert.ts#isAlertingState` is `in_range || multiple` --
  `approaching` is deliberately excluded, because approaching never takes the
  screen. A timeline built on the pass edge alone therefore cannot draw the
  amber row the design draws, and the `[data-fwm-log-row-state="approaching"]`
  rule in `log.css` would be dead on the production path.
- **Stand-in:** two named counts, off the same rows.
  - A PASS is the edge `stores/alert.ts` counts in EXPOSURE: a camera that put
    the driver in range. `FLOCKED TODAY` and the seven bars count passes.
  - An ENCOUNTER is a run of recorded transitions between `clear` states, drawn
    at the WORST state it reached -- so a camera first seen at 760 FT and then
    passed at 380 FT is one row, at 380 FT and in the in-range hue, and a camera
    that only ever approached is one amber row at its closest point. A second
    pass inside one unbroken run (an alert that sags to `approaching` and closes
    again) starts a second row, so the rows are a superset of the passes: one
    per pass, plus one per encounter that never became one.
  - `TIMELINE` and `HOTTEST SEGMENT` draw encounters. The card's `5 CAMS` is
    therefore countable off the rows underneath it.
- **Consequence, stated plainly:** the TIMELINE can hold more rows than
  `FLOCKED TODAY` counts, and the extra rows are the amber ones. That is the
  design's own arrangement (an amber row is drawn, and being near a camera is
  not being read by one), but nothing in the design says it in words.
- **Options:** (1) confirm; (2) draw only passes and drop the amber row from
  the design; (3) draw every recorded transition, which would put two rows on
  most encounters and a row on every drop back to `clear`.

## conf-dism-are-controls-not-a-recorded-word

- **Status:** STANDING IN
- **Need:** how a driver sets a row's outcome.
- **Screens:** each timeline row draws exactly ONE word -- `CONF` in
  `--fwm-alert-clear` or `DISM` in `--fwm-text-muted`. Every row in the
  reference is already ruled on, and nothing anywhere draws an un-ruled row or
  the affordance that would rule one.
- **Stand-in:** both keys render on every row. The recorded outcome is the
  pressed key and takes the colour the design draws it in; the other stays
  reachable at `--fwm-text-disabled`. A row nobody has ruled on shows both keys
  unpressed. This is the one place the screen renders more than the panel draws,
  and it is deliberate: `historyActions.setOutcome` has no other caller, so a
  single-word row would be a status nothing in the product could ever set.
- **Options:** (1) confirm two keys; (2) draw the affordance somewhere else (a
  swipe, or the row opening an intel card) and let the row print one word; (3)
  make the outcome automatic -- but "the driver confirmed this camera exists" is
  a human judgement and is the input the REPORT flow depends on.

## timeline-empty-state-not-drawn

- **Status:** STANDING IN
- **Need:** what an empty `TIMELINE` says. The LOG half of
  `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn`.
- **Stand-in:** one mono micro line in `--fwm-text-muted`, naming the window
  that came up empty: `NO TRIP IN PROGRESS` (TRIP, nothing started),
  `NO CAMERAS THIS TRIP` (TRIP, started, nothing yet), `NO CAMERAS RECORDED`
  (ALL TIME). The all-time total renders ` - ` rather than `0` when no durable
  count is available, because "nothing recorded" is not "measured zero" -- a
  device that HAS recorded trips and was never read by a camera prints a real
  `0`. The loader is `allTimeExposure.ts`; see
  `#nothing-hydrates-the-durable-counters` for what it can and cannot see.
- **Options:** (1) confirm the copy; (2) derive one uniform empty-state pattern
  for every screen, per the parent entry; (3) draw them.

## toggle-key-height-34

- **Status:** STANDING IN
- **Need:** a token for the 34px scope key.
- **Screens:** `05 · LOG` header -- two 34px keys inside a single outlined block.
- **Source:** 34px is below this product's own 44px touch floor
  (`--fwm-touch-min`), which the design system states for the phone surface.
- **Stand-in:** `var(--fwm-touch-min)`, the nearest token and the only reading
  that keeps a scope switch reachable in a car mount. It still fits inside the
  52px header. Identical in kind to
  `docs/gaps-inbox/radar-screen.md#radar-header-key-44x36`.
- **Options:** (1) hold 44px; (2) add a `--fwm-touch-compact` for in-header
  segmented controls; (3) redraw the header at the touch floor.

## timeline-row-height-56

- **Status:** STANDING IN
- **Need:** a token for the 56px timeline row.
- **Screens:** `05 · LOG`, each `TIMELINE` row: 56px tall, 14px gap, 1px rule.
- **Stand-in:** `min-height: var(--fwm-space-12)` (48px) -- the nearest token,
  and still clear of the 44px `CONF` / `DISM` keys inside it. Rows read slightly
  tighter than the reference.
- **Options:** (1) accept 48px; (2) add a `--fwm-row-h`; (3) let the row size to
  its content, which drifts with the type scale.

## spacing-scale-misses-5-14-and-18

- **Status:** STANDING IN
- **Need:** the 5px, 14px and 18px steps this panel draws.
- **Screens:** `05 · LOG` -- 5px between trend bars, 14px between body sections
  and between a row's dot and its text, 18px padding inside the today card
  (against 14px inside the two stat cards).
- **Stand-in:** the nearest step below in each case (`--fwm-space-1`,
  `--fwm-space-3`, `--fwm-space-4`), so the column reads slightly tighter than
  the reference. The one exception is the STAT cards' own 14px padding, which
  takes the same `--fwm-space-4` (16px) as the today card's 18px rather than a
  second value: 16 is exactly as far from 14 as 12 is, and one card rule for
  every card on the screen is worth more than a 2px lean either way. All three
  cards therefore pad identically, where the design pads the today card 4px
  wider than the two beneath it. Same gap as
  `docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30`; filed
  here with LOG's own values.
- **Options:** (1) merge into the RADAR entry and decide once; (2) add the
  missing steps; (3) re-tune the panel onto the existing scale.

## type-scale-misses-12-13-and-16

- **Status:** STANDING IN
- **Need:** the 12px, 13px and 16px steps this panel draws.
- **Screens:** `05 · LOG` -- `CAMERAS · 4 UNIQUE` at 13px, the two stat-card
  values (`Reading Rd`, `1,284`) at 16px/600, and the `HEAT MAP` / `ZONE AUDIT`
  keys at 12px/600. The scale steps 11 -> 15 -> 17, so all three fall between
  tokens.
- **Stand-in:** `--fwm-text-body` (15px) for the 13px caption,
  `--fwm-text-subtitle` (17px) for the 16px card values -- chosen over body so
  the card value stays one step above the 15px row name, which is the
  hierarchy the design draws -- and `--fwm-text-micro` (11px) for the 12px
  footer keys.
- **Options:** (1) accept the three substitutions; (2) add a `--fwm-text-label`
  (13px) and `--fwm-text-lead` (16px); (3) re-tune the panel onto the scale.

## no-selector-for-all-time-since

- **Status:** STANDING IN -- an implementation gap, not a design one. Recorded
  so a maintainer can close it in one edit.
- **Need:** `stores/history.ts` publishes `useAllTimePasses()` but no selector
  for `allTimeSinceMs`, which the `SINCE MAR 2026` caption needs.
- **Stand-in:** `LogScreen.tsx` reads it with
  `useHistoryStore((state) => state.allTimeSinceMs)`. Adding the selector would
  mean editing a shared file that other screens are being built against in
  parallel, so it was not done here.
- **Options:** (1) add `useAllTimeSinceMs` next to `useAllTimePasses` and switch
  the one call site; (2) leave the direct read.

## trip-lifecycle-has-no-owner

- **Status:** OPEN -- affects what the `TRIP` key can ever show.
- **Need:** something that calls `historyActions.startTrip()` / `endTrip()`.
- **Screens:** the `TRIP` scope, and `B3 · PRE-DRIVE`, which implies a trip
  exists before the driving loop starts.
- **Source:** `grep -rn "startTrip" apps/pwa/src` finds the store, its tests and
  this note -- no product code opens a trip. The driving-state machine that
  `services/db/repositories/trips.ts` says "decides when a drive is over" is not
  wired to the store yet.
- **Stand-in:** LOG renders `NO TRIP IN PROGRESS` honestly, and `ALL TIME` shows
  the whole log. The screen is correct; the trip is simply never started in this
  build.
- **Amendment (audit round 2):** the screen now OPENS on the scope that can
  contain something -- `exposure.ts#openingLogScope`. With a trip running it
  opens on `TRIP`, which is the filled key and the exact state the panel draws.
  With no trip it opens on `ALL TIME`, because opening on a scope that is empty
  by construction meant a real run of this screen showed an empty TIMELINE and
  an em-dashed HOTTEST SEGMENT on a device with a full log -- four of the
  panel's five data surfaces blank for a reason that has nothing to do with the
  driver. `DEFAULT_LOG_SCOPE` is still `trip` and is still what the toggle
  means; only the opening state is conditional. This reverts to "always TRIP"
  in one line the moment option (1) below lands.
- **Options:** (1) open a trip from the driving loop when speed crosses the
  moving threshold and close it after a stationary timeout; (2) open one on
  first fix after launch; (3) make the trip explicit -- a START DRIVE control --
  which no design draws.
