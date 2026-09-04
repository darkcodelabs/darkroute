# gap inbox -- packages/core (proximity + alert engine)

Every distance the engine reasons about is design-sourced and cited in
`packages/core/src/alert.ts`: rings 100/300/500/1000 ft, default threshold
500 ft, slider range 100-1000 ft, bezel step 50 ft, approaching band 500-1000 ft
closing, re-alert on muted inside 150 ft, mute 10 min, drive mode above 5 mph,
haptics 0/1/2/2, camera cone 60 deg (the `conic-gradient(from 200deg, ... 0 60deg)`
on the REPORT facing dial).

The entries below are the values the design files do NOT contain. They are
behavioural timings and tolerances rather than rendered lengths, so no
`var(--fwm-*)` token covers them and `scripts/check-design-values.mjs` cannot
see them -- which is exactly why they need a written decision rather than a
default nobody chose. Each one is a named export with the `GAP:` marker in
`packages/core/src/alert.ts`; changing a value is a one-line change there.

## alert-hysteresis-band

- need: how many feet past the threshold a camera must travel before the state
  relaxes, so a camera parked at 500.0 ft with GPS jitter does not repaint the
  whole screen several times a second.
- screen: RADAR (01 · IN RANGE / APPROACHING), and the watch faces W1/W3, which
  swap hue on every transition.
- source: nothing. The design specifies the threshold (500 ft) and the band
  edges (500-1000 ft) but never the exit condition. The design does render the
  problem, though: the RADAR state matrix shows four distinct hues, and the
  transitions between them are the flicker.
- stand-in: `DEFAULT_HYSTERESIS_FT = ALERT_THRESHOLD_STEP_FT` (50 ft) -- one
  rotary-bezel step, so the invisible band is never wider than the smallest
  adjustment a driver can make.
- options:
  1. Keep 50 ft (one bezel step). Scales with the design's own increment.
  2. Make it proportional, e.g. 10% of the threshold, so a 100 ft threshold gets
     a 10 ft band and a 1000 ft threshold gets 100 ft.
  3. Make it a time band instead of a distance band: hold the state for N ms
     after the distance leaves. Cheaper to reason about at speed, harder to
     explain in a settings screen.

## alert-cooldown-window

- need: how long after alerting for one camera the same camera may alert again.
- screen: RADAR, and the foreground notification channel ("notifications: silent
  below threshold, one channel").
- source: nothing. The only time-based interaction constant anywhere in the
  design files is the 10-minute mute.
- stand-in: `DEFAULT_NOTIFICATION_COOLDOWN_MS = DEFAULT_MUTE_DURATION_MS`
  (600000 ms), borrowing the mute duration for lack of anything closer.
- options:
  1. Keep 10 min, matching mute. Simple story: "one buzz per camera per ten
     minutes." Costs a second alert when you loop the same block.
  2. Shorter, ~2 min, so a re-approach on a return trip still fires.
  3. Tie it to leaving instead of to a clock: re-arm a camera when it goes back
     outside the approaching band. No timer, no arbitrary number, and it matches
     what a driver would expect -- but it re-alerts on jitter unless the exit is
     also hysteretic.

## gps-accuracy-gate

- need: the horizontal accuracy above which a fix is too loose to alert on.
- screen: RADAR ("GPS LOCK / 7 SATS" vs "NO FIX / 0 SATS / NO GPS"), REPORT
  ("±4 M · 9 SATS"), watch W1 ("HEADING 223° · ±4 M").
- source: the design shows accuracy as a readout (±4 M is the good case) and
  shows a hard no-GPS state, but never a threshold between them.
- stand-in: `DEFAULT_GPS_ACCURACY_LIMIT_M = 50` -- about 164 ft, roughly a third
  of the default 500 ft threshold, so the measurement is still meaningfully
  better than the decision it feeds.
- options:
  1. Keep a fixed 50 m.
  2. Make it relative to the threshold, e.g. gate when accuracy exceeds 25% of
     the threshold in feet. Self-adjusts when the driver moves the slider to
     100 ft, where a 50 m fix is useless.
  3. Do not gate; degrade instead -- show the alert with a visible confidence
     state ("±120 M") and let the driver judge. Needs a design for that state.

## stationary-dwell

- need: two durations. How long stopped before alerts are suppressed, and how
  long moving before they come back.
- screen: RADAR while parked; Screens II B5 has the related "NOTIFY WHEN PARKED
  / reads while the car isn't moving" toggle, which is about watchlist reads,
  not camera alerts.
- source: nothing. The design's only speed constant is the dash rule
  "while speed > 5 mph", which the engine uses as the stationary boundary.
- stand-in: `DEFAULT_STATIONARY_DWELL_MS = 120000` (2 min, deliberately longer
  than a traffic-light cycle so a red light never suppresses) and
  `DEFAULT_MOVING_DWELL_MS = 5000` (asymmetric on purpose -- being late to alert
  is the dangerous direction, so restoring is fast).
- options:
  1. Keep 120 s / 5 s.
  2. Longer suppress dwell (5 min) so only a genuine park triggers it; costs
     battery and pointless alerts in a long jam.
  3. Drop the timer and use trip state instead: suppress when the trip ends,
     restore when a new trip starts. Cleaner semantics, but it needs a trip
     lifecycle the app does not have yet.

## camera-dedupe-epsilon

- need: how close two cameras with different ids have to be before they are
  treated as one pole.
- screen: SWEEP (two markers on one pole), RADAR (`multiple` firing for what is
  actually one camera), EXPOSURE (double counting).
- source: nothing directly. The tightest thing the design draws is the 100 ft
  SWEEP ring and the 50 ft bezel step.
- stand-in: `DEFAULT_DEDUPE_EPSILON_FT = 50` -- half the tightest ring, so two
  markers that would render on top of each other collapse.
- options:
  1. Keep 50 ft.
  2. Tighter, 25 ft, and let genuine pole pairs at an intersection stay separate
     (a four-way with cameras on opposing corners is real).
  3. Do not merge distinct ids at all; merge only on the server at ingest, and
     have the client trust ids. Correct long-term, but leaves user-submitted
     duplicates visible until the backend dedupes.

## derived-speed-smoothing

- need: the filter coefficient for speed derived from position deltas, used when
  `GeolocationCoordinates.speed` is null.
- screen: RADAR "SPEED / 47", LOG rows "14:22:08 · 47 MPH · 380 FT", dash mode's
  "speed > 5 mph" rule.
- source: nothing. The design shows the number, never how it is filtered.
- stand-in: `SPEED_SMOOTHING_ALPHA = 0.4` with `MIN_SPEED_SAMPLE_MS = 250`.
- options:
  1. Keep the exponential moving average at 0.4.
  2. Median of the last N deltas -- more robust to a single bad fix, more lag.
  3. Weight the sample by reported accuracy, so a ±120 m fix barely moves the
     estimate. Best answer, most code.

## motion-stationary-veto

- need: the device-motion magnitude above which "stationary" is overruled.
- screen: RADAR while stopped with the phone in a cradle.
- source: nothing. Device motion appears nowhere in the design files; it is in
  the documented speed-source order as supporting evidence only.
- stand-in: `MOTION_STATIONARY_VETO_MPS2 = 0.6`, above typical handheld noise.
- options:
  1. Keep 0.6 m/s².
  2. Calibrate at rest on first use and veto on a delta from that baseline.
  3. Drop the veto entirely and rely on speed alone -- fewer moving parts, and
     device motion is the least trustworthy of the three sources.

## closing-detector-epsilon

- need: how much the nearest distance must change before the engine calls it
  closing or receding, rather than noise.
- screen: RADAR "AHEAD · CLOSING" and the approaching band, which the design
  defines as "500-1000 ft, CLOSING" -- so `approaching` is not purely a
  distance band and something has to decide the verb.
- source: the word "closing" is in the design; the tolerance is not.
- stand-in: `CLOSING_EPSILON_FT = 10`, with the verdict sticky between flips. At
  47 mph a 1 Hz fix moves 69 ft, so this is decisive while driving and inert
  while stopped.
- options:
  1. Keep 10 ft, sticky.
  2. Derive it from accuracy: require a change larger than the reported
     horizontal accuracy.
  3. Use heading and camera bearing instead of distance deltas -- closing is
     really "the camera is in the forward half of the compass". More stable at
     low speed, wrong on a curve.
