# gap inbox -- apps/pwa/src/stores (the zustand state model)

No file in `src/stores` contains a colour, a length, a radius, a duration or an
easing curve, so `scripts/check-design-values.mjs` has nothing to say about this
directory and no `var(--fwm-*)` stand-in was needed anywhere. The two numeric
constants that ARE here are design-sourced and cited in place:
`PRESENCE_DISTANCE_PRECISION_MI = 0.1` and `PRESENCE_EVENT_DELAY_MS = 60_000`,
both from `Flockys Screens II.dc.html` A5 ("rounded to 0.1 mi and delayed 60s").

The entries below follow the precedent set by `core-engine.md`: they are
BEHAVIOURAL decisions the design files do not contain, made in code because a
store had to do something, and worth a written decision rather than a default
nobody chose. Each is a named export or a named field in the file cited.

## alert-takeover-across-notification-cooldown

- need: whether a live camera takeover stays on screen across the engine's own
  re-notification cooldown, or comes off between buzzes.
- screen: RADAR 01 · IN RANGE, and the B10 escalation ladder ("a live camera
  alert always wins the screen").
- source: nothing. The design specifies the takeover and specifies that alerts
  never stack ("one channel per state, tag replaces"), but the cooldown is an
  engine behaviour with no rendered state. Left unresolved, the naive reading -
  one gate driven straight off `AlertTick.shouldAlertUser` - makes the takeover
  flicker off on the very next tick, which the design plainly does not intend.
- stand-in: no token involved. `apps/pwa/src/stores/alert.ts` splits the
  decision in two: `shouldAlertUser` (the gate, true for the whole episode while
  a camera is in range, unmuted and undismissed) and `engineFiring` (the
  transient edge that drives haptics and notifications, cooldown-aware).
  `blocksDelivery()` names the suppressions that DO shut the gate - `accuracy`
  and `stationary` - and deliberately excludes `cooldown`.
- options: (a) keep the split as built; (b) drive the takeover off the alert
  STATE alone and leave `shouldAlertUser` purely transient, which would put a
  second mute check in every component that renders the takeover; (c) give the
  takeover its own dwell in the design.

## re-alert-through-mute-takes-the-screen

- need: whether the "RE-ALERT ON MUTED IF closer than 150 ft" exception is a
  buzz only, or a full screen takeover like any other in-range alert.
- screen: Screens II B4 · ALERT TRIAGE (the re-alert row) and RADAR's MUTED
  state ("MUTED 8:12 · 425 FT · STILL TRACKING · hue desaturates, data stays
  live").
- source: B4 gives the distance and the words "RE-ALERT", and the RADAR MUTED
  panel shows a muted screen that is still tracking - but nothing renders a
  takeover over a muted screen, so the escalation is unspecified.
- stand-in: no token involved. `alert.ts` treats the pierce as a full alert:
  the gate opens, the takeover mounts, and `mutePierced` is exposed so the
  screen can say WHY it just buzzed after the driver muted it. Being quieter
  than the design inside 150 ft is the dangerous direction.
- options: (a) full takeover plus an explanatory line, as built; (b) haptic and
  hue only, no takeover, while muted; (c) a distinct "pierced" treatment in the
  design so the driver can tell the two apart at a glance.

## plate-guard-exemption-for-structured-ids

- need: a rule for values that are structurally identical to a licence plate but
  are not one. A camera id (`FWM-0442`) and an anonymous session UUID
  (`7c9e6679-7425-40de-...`) both satisfy `looksLikePlate()` - correctly, since
  five to eight mixed alphanumerics IS a plate's shape.
- screen: not a screen. It is the persistence boundary that keeps plates out of
  `settings` and `session` (`apps/pwa/src/stores/persist.ts`), which has to
  store `mutedCameras` keyed by camera id and a `sessionId`.
- source: the design supplies both shapes and they genuinely collide -
  "FWM-0442 · HOA · SHARED" (03 · LOOKUP) against "HVK 8842" (B5 · WATCHLIST).
- stand-in: no token involved. The exemption is POSITIONAL, never textual: only
  the keys of `mutedCameras` (which must match `CAMERA_ID_RE`) and the value of
  `sessionId` (which must match `UUID_RE`) skip the plate check, and a value in
  either position that does not match its format is refused outright. Everywhere
  else a plate-shaped string still throws, so adding a persisted field that
  carries an id has to be a deliberate conversation.
- options: (a) keep the positional allowlist and extend it per field, as built;
  (b) require the backend to issue camera ids in a shape no plate can take
  (a prefix plus a longer digit run, say), which would let the check be textual;
  (c) namespace persisted ids on the way in (`camera:FWM-0442`) so the raw shape
  never reaches storage.

## presence-disabled-has-no-designed-state

- need: what MESH and the SWEEP ghost dots show when the presence feature is
  switched OFF in the build, as distinct from switched on with nobody nearby and
  from offline.
- screen: Screens II A5 · MESH FEED, and the SWEEP legend's "HAKCERS 2" chip.
- source: A2 · OFFLINE has a designed row for losing the feed to the network
  ("NO · mesh feed, other darkroute"), and A5 has a populated feed. There is no
  rendered state for "this build does not have presence", which is the state the
  product is actually in - `FEATURES.presence` is false because the Durable
  Objects backend does not exist.
- stand-in: no token involved. `apps/pwa/src/stores/presence.ts` reports
  `availability: 'disabled'` with a sentence, and refuses to accept peers at all
  while the flag is off, so no screen can render "0 HAKCERS NEARBY" and imply it
  looked.
- options: (a) reuse the OFFLINE treatment with different copy; (b) hide the
  MESH entry point and the HAKCERS chip entirely while the flag is off;
  (c) a designed "not built yet" panel, which is the honest one and the only one
  that does not quietly imply the feature works.
