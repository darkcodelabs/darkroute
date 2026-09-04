# gap inbox -- apps/pwa/src/services/adapters (sensor + platform adapters)

Every capability sentence, permission rule and haptic count in this directory
is design-sourced and cited at the top of the file that uses it: notifications
from section 06 ("silent below threshold, one channel per state, tag replaces
so alerts never stack"), the wake lock from "wake lock while RADAR is
foreground", the haptic counts from the RADAR state matrix / Screens II B7 /
the hue table (0 / 1 / 2 / 2, matching `HAPTIC_PULSES_BY_STATE` in
`packages/core/src/alert.ts`), and the county-entry silence rule from
"Silent, no vibration -- alert haptics stay reserved for cameras."

The entries below are the ones the design files do not answer. Three are missing
values, three are places where following a screen literally would break a
privacy invariant or promise a capability the web does not have. Each is marked
`GAP:` at the line that stands in for it.

## haptic-pulse-duration

- need: how long a single haptic pulse lasts, and how long the silence between
  the two pulses of an alert lasts. `navigator.vibrate` takes milliseconds; the
  design gives pulse COUNTS but never a pulse LENGTH.
- screen: RADAR alert states (App Screens, RADAR state matrix) and the watch
  alert face (Screens II B7 · WEAR, "ALERT · 2 PULSES").
- source: nothing renders a haptic duration anywhere. The closest the design
  comes is the animation scale in section 08: `--fwm-dur-instant: 90ms`,
  `--fwm-dur-fast: 160ms`, `--fwm-dur-base: 240ms`, `--fwm-dur-alert: 400ms`.
- stand-in: `tokens.duration.instant` (90) for both the pulse and the gap,
  imported from `apps/pwa/src/styles/tokens.json` rather than copied, so the
  value cannot drift from the token scale. A 2-pulse alert is therefore
  `[90, 90, 90]`.
- options:
  1. keep instant/instant -- a crisp double tick, cheapest on battery, and the
     shortest thing a driver can still feel through a steering wheel.
  2. instant pulse with a `fast` gap (90/160/90) -- reads as two clearly
     separate taps rather than one stutter, at the cost of 70ms more latency
     before the alert is fully delivered.
  3. author real haptic tokens (`--fwm-haptic-pulse`, `--fwm-haptic-gap`) in
     tokens.css and tokens.json, which is the only option that lets a mode
     ("pursuit" is louder than "night watch") remap the feel the way it remaps
     the hue.

## watchlist-notification-omits-plate

- need: a decision on what a watchlist notification may say on a lock screen.
- screen: B5 · PLATE WATCHLIST and the watch W11 watchlist hit.
- source: B5 renders "NEW READ · 6 MIN AGO / HVK 8842 was read by a camera
  you've never passed before -- Colerain & Galbraith"; W11 renders
  "NEW READ · HVK 8842 / Colerain & Galbraith". Both put a plate AND a cross
  street in a glanceable surface. The onboarding promise is the opposite:
  "Plate never leaves this device", "stores nothing off-device".
- stand-in: the notification adapter takes a structured payload with no field a
  plate could travel through (`{ kind: 'watchlist', newReadCount }`) and
  composes "new read on a watched plate / open darkroute to see which one." The
  plate and the cross street stay behind the lock screen, in the app, where B5
  renders them in full.
- options:
  1. keep the notification contentless (current) -- a lock screen is readable by
     anyone holding the phone and is mirrored to a watch and a car head unit.
  2. show the plate only when the device reports itself unlocked, which no web
     API can tell us, so this needs the TWA bridge to answer it.
  3. let the user opt in per plate in settings, with the copy saying plainly
     that the plate will appear on the lock screen.

## county-notification-title-and-body-split

- need: which line of the county heads-up is the notification TITLE and which is
  the BODY. Android renders them at different sizes and truncates the title
  hard; the design draws two lines of equal weight.
- screen: B10 · CROSSING IN, state 3 "SCREEN OFF -- HEADS-UP NOTIFICATION".
- source: the design renders "DARKROUTE · NOW" (which is the OS-drawn app row,
  not our text), then "Hamilton Co: 6 documented misuse incidents, 88 cameras."
  then "Worst: repeated plate searches on an ex-partner, Jun 2026."
- stand-in: line 1 becomes the title, line 2 the body. The title is long enough
  that Android will ellipsize it on a narrow device.
- options:
  1. keep the 1:1 mapping and accept truncation on small screens.
  2. title "hamilton co · 6 on record" (the strip copy from state 2), body the
     full sentence -- shorter title, and it matches what the in-app strip says.
  3. title the county alone, body both sentences joined; loses the count from
     the glance.

## wake-word-is-not-always-on

- need: an honest state for the "WAKE WORD ON" chip, and a decision about
  whether the chip should exist on the web build at all.
- screen: 04 · ASK -- LISTENING, chip "WAKE WORD ON".
- source: the screen draws the chip as a settled on/off state next to
  "LISTENING...". Nothing in the design acknowledges that a browser cannot
  listen while the app is off screen.
- stand-in: `speechRecognition.wakeWordCapability()` is a separate, pessimistic
  probe that returns `{ supported: false, reason: 'wake word only runs while
  darkroute is on screen; it stops when the screen locks' }` whenever the document
  is hidden or the browser cannot listen continuously, and the adapter stops
  wake-word mode on `visibilitychange`. Push-to-talk is the dependable path.
- options:
  1. render the chip with a third state ("WAKE WORD · ON SCREEN ONLY") so the
     limitation is visible before the driver relies on it.
  2. hide the chip entirely on the web build and show it only when the TWA
     bridge reports a native always-on listener.
  3. drop wake word and make the ASK key a press-and-hold, which is what the
     watch already does ("W9 · ASK -- VOICE ONLY").

## non-camera-haptics-on-the-watch

- need: a ruling on whether the watch's confirmation haptics are allowed, given
  that alert haptics are reserved for cameras.
- screen: W10 · THRESHOLD ("TURN BEZEL · 50 FT STEPS / HAPTIC TICK EACH STEP")
  and the watch navigation model ("LONG PRESS ... 1s, one haptic, no dialog").
- source: those two lines ask for haptics that are not camera alerts. Screens II
  B10 says the opposite for notifications: "Silent, no vibration -- alert
  haptics stay reserved for cameras", and the watch rules say
  "alert = 2 haptic pulses ... no duplicate buzz on both wrists and dash".
- stand-in: `vibration.assertCameraAlertOnly` throws for every source that is
  not `camera-alert`, so the bezel tick and the long-press confirmation have no
  way to reach the motor through this adapter. They are unimplemented rather
  than quietly allowed.
- options:
  1. keep haptics camera-only; the bezel and long-press confirm visually.
  2. add a separate, clearly named UI-feedback channel with a distinctly
     different feel (one very short tick, never two pulses) so a confirmation
     can never be mistaken for a camera; the guard would then take an allowlist
     of two sources instead of one.
  3. allow the bezel tick only, since it happens while the user is deliberately
     turning the bezel and cannot be mistaken for an unsolicited alert.

## photo-exif-is-not-stripped

- **Status:** CLOSED 2026-08-31 by option 1. `features/report/preparePhoto.ts`
  bakes EXIF orientation into the pixels, resizes to 1600 px on the long edge and
  re-encodes as JPEG down a quality ladder to a 600 KB ceiling; the output is
  built from pixels alone, so nothing is *stripped* and therefore nothing can be
  missed - not the GPS block, not the timestamp, not the IFD1 thumbnail that
  carries its own copy of both. `ReportScreen.tsx` is the production caller and
  only prepared bytes ever reach the `reportPhotos` store.
  `e2e/preparePhoto.spec.ts` proves it in a real browser, which is the only place
  it can be proved: `createImageBitmap` does not exist in this repo's jsdom.
- **What did not change, and correctly so:** the stand-in below. `cameraCapture`
  still returns `metadataStripped: false`, because the *adapter* still strips
  nothing. The guarantee lives one layer up, in `PreparedPhoto.metadataStripped`,
  which is the literal type `true`. Option 2 was not taken for the reason given
  below - it re-encodes twice.
- The original entry follows.

- need: an owner and a place for stripping EXIF (including GPS) from a reported
  camera photo before it is queued or uploaded.
- screen: 06 · REPORT (PHOTO tile), A5 intel card ("DROP PHOTO OF CAMERA"),
  W8 ("HELD FOR SYNC · ADD PHOTO / ON PHONE LATER").
- source: the design shows the photo attaching and syncing and says nothing
  about metadata. A phone photo normally carries the exact coordinates the rest
  of this product refuses to transmit.
- stand-in: `cameraCapture` returns `CapturedPhoto.metadataStripped: false`,
  always, and the file's header states that any upload path must treat that as
  unsendable. The adapter does not strip metadata itself -- stripping means a
  canvas re-encode, which belongs with the compression and signing step, not
  with the picker.
- options:
  1. strip in the report pipeline during the existing re-encode/compress step.
  2. strip in the adapter via `createImageBitmap` + canvas, which makes the
     guarantee local to capture but re-encodes twice.
  3. refuse photo attachment entirely until one of the above ships, which is the
     only option that is safe today.
