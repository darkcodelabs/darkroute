# Performance audit, 2026-09-06

Ten findings raised across three lenses, each one then handed to an independent
agent whose job was to refute it. Nine were refuted with numbers. One
survived and is fixed.

Everything below is measured. Where a measurement came from headless Chromium
running SwiftShader, software rasterisation on the CPU, that is stated,
because it is the single biggest way to get a wrong answer about a phone.

## The one that survived

### The pixel sweep never idled

`apps/pwa/src/features/map/pixelSweep.ts` rescheduled its `requestAnimationFrame`
unconditionally at the end of every frame. It had four guards and none of them
was a stopped-car guard: `visibilitychange` cancels the loop when the page is
hidden (real, works, irrelevant to a phone on a windscreen mount with the screen
on), teardown fires only when the fix goes null or the map unmounts, and
`MAX_FRAME_S` only clamps a resumed tab.

`steady.ts` deliberately holds the last confident heading below 3 mph, so
`data-fwm-heading` stays `live` at a red light and the sweep stays visible.
Confirmed in the running app: after driving then setting speed 0,
`data-fwm-heading="live"`, `display: block`.

Measured, parked, DRIVE up, 4x CPU throttle:

| | sweep running | sweep asleep |
|---|---|---|
| whole app, one core | 15.2% | 8.0% |
| main thread | 9.51% | 0.27% |

It was the only thing keeping the compositor's Commit and PrePaint alive.

Measured while driving (position stepped at 13 m/s, past the 6 m
`STEADY_METRES` deadband every tick, so the map eases constantly):

| | CPU |
|---|---|
| sweep on | 275.2% of a core |
| sweep off | 291.9% of a core |

The difference is noise. While the car moves, MapLibre's own repaint dominates
by roughly ten to one and the sweep is free. **The entire cost is the red
light.**

Honest severity: MEDIUM, not HIGH. Against a car-mounted phone's screen-on
budget of roughly a watt, a small always-animating canvas is tens of milliwatts, low single-digit percent of a battery-hour, and only during the fraction of a
drive spent stopped. It is not the "phone hot in the hand" failure mode. What it
actually does is deny the display pipeline, the GPU and one core any deep-idle
residency for as long as the car is stationary, for a decoration nobody is
looking at while they wait for a light.

Fixed. Emission stops after `IDLE_AFTER_S` (4s) with no movement; the
particles already in the air run out so the trail fades instead of freezing;
then a final `clearRect` and the frame callback is dropped. `syncVehicle` calls
`moved()` on every position update, which re-arms it through the same path
`visibility()` uses. Four seconds because a fix arrives about once a second and
a stopped car still reports jitter, under three would flicker the sweep back on
at the kerb.

## Refuted, with the numbers that killed them

### "10 backdrop-filter elements turn every frame into 11 GPU render passes"

Refuted. The 11 passes were a SwiftShader artifact. Re-measured on real GPU
hardware (ANGLE/Vulkan on AMD RADV, verified not SwiftShader), read from
Chrome's own compositor trace, 4 interleaved reps of ~240 frames:

- The measured pass count is 2 at every non-off glass level, not 11.
- Compositor-thread wall time: 2.773 ms vs 0.564 ms: 2.2 ms per frame, on a
  thread that is not the main thread, inside a 16.67 ms budget it never comes
  close to exhausting. 13.9 ms of headroom remains; 60.0 fps in every
  configuration.
- Whole browser: 9.9% of one core with glass off, 10.8% at the default. A 0.9
  percentage-point delta.

The main thread is 90.1% idle while driving with glass on at 60 fps, and
every non-idle sample is MapLibre's own camera math driven by a 60 Hz `jumpTo`  -
roughly 60x more aggressive than a real 1 Hz GPS fix. **No application code
appears in the profile at all.**

### "The glass setting scales blur radius but never the render-pass count"

Refuted. The light-vs-medium difference is 0.016 ms per frame, 0.1% of
a frame, below run-to-run noise. Over a one-hour drive that is 3.5 seconds of
GPU-busy time. The claim that only `off` removes the cost is wrong: heavy →
medium alone returns 0.473 ms/frame, and `off` itself is worth 2.100 ms/frame,
about 7.6 minutes of GPU-busy time per battery-hour, one tap away on a
radiogroup.

### "Reduced motion still pays a 60 Hz main-thread layout-read loop"

Refuted. Statistically zero in the real app: 13.6 ± 40.5 ms/s of main-thread
task at 4x throttle, 6-rep A/B, 95% CI spans zero, and 2 of 6 reps ran *cheaper*
with the loop. Pessimistic ceiling from an isolated harness: +26 to +36 ms/s =
2.6–3.6% of one throttled core. One `getBoundingClientRect` on a `display:none`
element is 16.5 µs at 4x throttle, 0.10% of a frame budget, and zero extra
layout passes.

### "The alert engine walks the entire camera set on every fix with no spatial prefilter"

Refuted as a cost. The mechanism is real; the price is not. Over a 47-minute
drive through the densest metro in the shipped archive, N growing 1,924 → 4,375:

- 0.84% duty cycle of one core. 23.9 s of CPU total, per-fix p50 8.74 ms,
  p95 11.20 ms.
- About 0.01 Wh: 0.06% of a phone battery-hour.
- Live browser at N≈2,000: 5.5 ms/fix, 0 long tasks over 50 ms in 60 s, the
  entire app bundle 1.15% of wall against 90.78% idle.
- The typical case is far cheaper: the median populated 3x3 ring holds 37
  cameras. Worst shipped case (r=8 widened, LA, N=10,431) is 26.5 ms/fix,
  reachable only by deliberately zooming to a regional view.
- Retained memory at the end of the worst drive: ~2.6 MB.

Not worth touching the alert engine for. If it ever is, the smallest safe change
is recorded below instead of lost.

> Do not truncate the assessments array, `features/sweep/sweepState.ts:275`
> derives its KNOWN count from `input.assessments.length`, and RadarScreen,
> AlertV1, IntelScreen and DriveScreen all read the full list. The safe change
> is a lat-window reject inside the `.map()` at `packages/core/src/alert.ts:790`,
> before any trig: compute `latWindowDeg` once per tick from the widest distance
> any consumer needs (the 5-mile NEARBY list, ~0.073 deg), and for any camera
> outside it emit a cheap equirectangular `distanceFt` with `bearingDeg: 0`,
> `relativeDirection: null`, `facingVehicle: null`, `inRange: false` instead of
> running Vincenty + bearing + relativeDirection + isFacingVehicle +
> isCameraMuted. Measured primitives: the reject is 18 ns against 480 ns for
> Vincenty and 127 ns for bearing, and it skips the per-camera mute Map lookup
> that showed the largest engine self time (180.8 ms) in the live profile. About
> five lines, no eviction, no tile-cache change, no API change.

### "Every tile arrival re-runs the full dedupe as one blocking task"

Refuted. The mechanism is real but the frequency premise, a tile landing
every 250 m of travel, is wrong by roughly 50x, and the frequency *was* the
finding. Real `dedupeCameras` under CDP CPU throttling over the sets that
actually exist in the store during a gate-accurate simulated driving hour:
N=2,134 costs 2.9 ms desktop / 10.8 ms at 4x; N=1,192 less.

### "The camera-sync position subscription has no identity guard"

Refuted. Measured on the real modules in headless Chrome (vite-bundled
`createCameraSync` + `usePositionStore` + `packages/core`, CDP CPU throttling,
median of 7 runs): the marginal cost of the subscription is 440 ns per write
at 1x.

### "GPS watch runs at maximum duty with no low-power mode"

Refuted in substance. Two of the finding's three clauses are false, and the
third has a payoff below the threshold this audit already used to walk away from
something.

"Even when backgrounded" is false, with no app code involved. Blink stops the
provider on page hide through three independent guards  -
`Geolocation::PageVisibilityChanged` → `StopUpdating()` →
`ResetGeolocationConnection()`, an early return in `UpdateGeolocationState()`
described in the source as "the ultimate perimeter safeguard against querying
location from the browser backend while backgrounded", and a drop of any
in-flight result that lands while hidden. `GeolocationProviderImpl` then clears
the cached position so the next observer cannot be handed a stale one. Screen
off, app backgrounded, tab switched → GNSS draw is zero.

"The app already knows the vehicle is stationary" is false at the layer named.
`steady.ts` is a map smoother, not a stationarity verdict: `STEADY_METRES = 6`
sits over a jitter cloud the file itself documents as 3–5 m, and
`HEADING_FLOOR_MPH = 3` deliberately *holds* the last heading rather than
reporting stillness. The only real verdict is `AlertEngine.#updateStationary`,
which needs ≤5 mph and a motion veto and 120 s of continuous stillness.
By the time it is true, the engine has *already* suppressed alerting
(`suppressedBy: ['stationary']`), so the only window in which degrading GPS is
safe is the window in which the app has already decided not to warn you.

The cost, and the recoverable share. Continuous GNSS is **0.23%–0.69% of a
battery-hour** (Android's power profile: 10–30 mA tracking, 50 mA acquiring, at
3.85 V, against this audit's own 16.7 Wh battery-hour). Generous recoverable
share at 20% stationary time: 0.05%–0.14%. Honest share, gated on the 120 s
dwell that is the only safe signal, parking, a drive-thru, a rail crossing, so
2–5% of a driving hour: 0.01%–0.03% of a battery-hour, below the 0.06% used
to refute the alert-engine finding. About 12% of even that is eaten back by
reacquisition: 12 stop→go transitions × ~3 s at 50 mA.

And the lever is a trap. `enableHighAccuracy: false` is not a gentler watch.
On Android it is throttled to roughly one fix per fifteen minutes by default;
on iOS it returns `kCLLocationAccuracyHundredMeters`, exactly the fixes
`DEFAULT_GPS_ACCURACY_LIMIT_M = 50` exists to discard. The accuracy hint is OR'd
across every notifier in the page, so one low-accuracy client coarsens the
provider for all of them.

One correction to this codebase's own comment, now applied at
`geolocation.ts`: it claimed Android's `PRIORITY_HIGH_ACCURACY` is a native call
the web cannot make. It is not, `enableHighAccuracy: true` *is* that constant.
Chromium's `LocationProviderGmsCore.java` maps the flag straight onto
`PRIORITY_HIGH_ACCURACY` at a 500 ms interval. What is out of reach is
anything finer than that one boolean.

Correction to this audit's own arithmetic: every per-fix figure here assumes
~1 fix/s. Chrome asks the fused provider for 500 ms. The alert-engine
numbers may therefore be up to 2x what is recorded above, which changes 0.06%
of a battery-hour to 0.12%, and changes nothing about the conclusion.

## The lead worth chasing next, which is not a performance fix

The GPS refutation turned one up that is **two hundred times larger than
anything in this audit**: `services/pwa/wakeLock.ts:107` holds the screen wake
lock on `running && screen === WAKE_LOCK_SCREEN && visible`, with **no
stationary gate at all. The screen is roughly a watt, 6% of a battery-hour**, against the 0.01%–0.03% the GPS finding was arguing about and the tens of
milliwatts the pixel sweep was worth.

It is a product decision, not a defect: a driver parked at a light wants the
screen on, and a phone that blanks every time you stop is worse than one that
drains. But nothing currently distinguishes "stopped at a light" from "parked in
a driveway with DRIVE still open", and `AlertEngine.#updateStationary` already
computes exactly that distinction with a 120 s dwell. Belongs in
`DESIGN-GAPS.md` as a question for the owner, not a patch.

## What the audit checked and found fine

- The alert engine's 60 Hz unguarded-subscription bug, found and fixed earlier,
  has not regressed.
- `perf: the map engine leaves the boot path` and `perf: the map was dead, and
  the admin probe was on the cold-start path` both held.
- No unpaired `addEventListener`. No unbounded cache growth over a driving hour.
- Nothing polls while driving beyond the tile and sync work that is supposed to.

## The lesson worth keeping

Two of the three headline findings were artifacts of the measuring environment,
not of the app. This codebase already had one of those on record, *"ten
read-backs are what makes the phone hot was a guess, and the measurement
said otherwise; the alert engine running 60 Hz off an unguarded store
subscription was the true cost."* The refute-with-numbers pass is what stopped
the same mistake being made twice.
