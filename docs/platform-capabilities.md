# Platform capabilities

What the web platform can and cannot do for DarkRoute on Android, stated plainly, with
the file that implements each claim. This document exists because the product's core promise -
"you will know before you pass the camera" - is a promise about *when the app is running*, and the
web has hard limits on that. Anything below that says "cannot" is not a TODO. It is the platform.

Every claim here was checked against the code in `apps/pwa/src/services/adapters/`, not against
intent. The adapter contract itself is in `apps/pwa/src/services/adapters/types.ts` and states three
rules that this document is downstream of: capability-detect and never throw; prompts come only from
a user gesture; nothing is faked.

## The five hard limits

### 1. A foreground PWA can use `watchPosition()` while the page is visible

This works, and it is what RADAR runs on. `navigator.geolocation.watchPosition` delivers fixes with
`latitude`, `longitude`, `accuracy`, `speed`, `heading` and a platform-stamped `timestamp` for as
long as the document is visible and the permission is granted. `services/adapters/geolocation.ts`
requests high accuracy with a 15s timeout and a 2s maximum age, and exposes `fixAgeMs()` so the
`NO GPS · last fix 40s ago` state can be drawn from the platform's own timestamp rather than from
when we happened to handle the callback.

### 2. A normal PWA CANNOT guarantee continuous background GPS on Android

When the screen locks, the app is backgrounded, or Chrome decides to reclaim the tab, geolocation
callbacks stop. There is no permission to ask for, no flag to set, and no combination of APIs that
changes this for a page running in a browser. Android will also freeze or discard a hidden tab
outright. A driver who locks their phone and puts it in a cupholder is a driver the web version
stops warning.

This is not mitigated anywhere in the codebase, because it cannot be. It is *surfaced*: see
`services/adapters/twaLocationBridge.ts`, whose `capability()` returns the exact sentence
`"no native bridge; foreground web geolocation only"` on every platform that is not the Android
shell. `twaLocationBridge.test.ts` asserts both `capability().reason` and `error().message` against
that exported constant, so the two cannot drift apart - though changing the constant itself would
still change the sentence, which is a deliberate one-place decision.

### 3. Page Visibility does not create background geolocation

`document.visibilityState` tells you the page went away. It does not let you keep working after it
did. `services/adapters/visibility.ts` is the adapter every other adapter defers to for exactly this
reason: a hidden document loses the wake lock, loses geolocation callbacks, and loses speech
recognition. Visibility is used to *stop* things honestly and to *re-acquire* them on return - it is
never used as evidence that something is still running.

Its one positive use is routing: the design sends a county-entry event to a heads-up notification
only in the "SCREEN OFF" state, and mirrors alerts to a watch "only when the phone screen is off -
no duplicate buzz on both wrists and dash". Visibility is what decides that.

### 4. A service worker cannot continuously read browser geolocation

Service workers have no access to `navigator.geolocation`. They are event-driven and are terminated
by the browser between events; there is no long-lived context in which to hold a position watch.
Periodic Background Sync exists in Chromium but fires at the browser's discretion (typically no more
often than roughly daily, and only for installed, frequently-engaged apps), which is useless for a
camera 400 feet ahead.

What the service worker *is* for here is offline. The sole Workbox configuration is the inline
`workbox` block in `apps/pwa/vite.config.ts`: it precaches the shell, serves navigations
`NetworkFirst`, and serves same-origin `/cameras/` data `StaleWhileRevalidate` from
`fwm-camera-tiles-v2`. It defines no POST route or background-sync queue; signed reports are held by
the app in IndexedDB. Registration is application-owned (`injectRegister: null`) through
`services/pwa/registerSW.ts`. The generated worker uses `skipWaiting: true` and
`clientsClaim: true`, so it activates and claims clients automatically, but that does not reload an
already loaded document. The separately gated browser installation invitation lives in
`services/pwa/installPrompt.ts`.

### 5. The Android TWA extends the screen-off case, not the killed-app case

`apps/android/` is a buildable Trusted Web Activity using Android Browser
Helper's location delegation. The page continues to call ordinary
`navigator.geolocation`; Android supplies the location permission and fused
provider while the TWA remains running, including when the screen turns off.
The shell is not on Google Play, has no `ACCESS_BACKGROUND_LOCATION`
permission, and has no notification delegation, so it does not promise alerts
after the app is fully backgrounded or killed.

`services/adapters/twaLocationBridge.ts` describes a separate injected-bridge
design. The current Android shell does not inject that interface, so the
adapter remains inert and must not be cited as the implementation of the TWA's
location delegation.

Two things about that adapter are deliberate and should survive any refactor:

- `start()` does **not** start background tracking. It attaches the receive path and reads whatever
  fix the native side already holds. Continuous tracking begins only when `startBackgroundTracking()`
  is handed a `BackgroundConsent` object (`{ acknowledged: true, grantedAt }`) - a boolean would be
  too easy to pass by accident. Without it, `BackgroundConsentRequiredError` is thrown. There is no
  code path that turns background tracking on as a side effect of anything else.
- Everything crossing the bridge is a string, because Android's `addJavascriptInterface` can only
  carry primitives. Every payload is validated field by field; a malformed payload is dropped and
  recorded, never coerced into a plausible position.

Until the TWA is distributed and its screen-off behavior is verified on the
release build, browser users must treat DarkRoute as foreground-only and no UI
may imply killed-app background alerts.

## Voice: push-to-talk is the product, wake word is a bonus

Always-on wake-word listening is not reliable across browsers and does not work in the background at
all. `SpeechRecognition` is killed when the document is hidden, when the screen locks, or when the
tab is backgrounded. On Chromium it is the `webkit`-prefixed, **network-backed** implementation:
audio is streamed to a remote service, and the session ends on silence.

`services/adapters/speechRecognition.ts` splits this into two answers on purpose:

- `speechCapability()` - the push-to-talk path. Hold the key, talk, release: one recognition session
  per press, started from the gesture that opened it, ended by the user. This is the interaction ASK
  should treat as dependable, and the only one viable on the watch (`W9 · ASK - VOICE ONLY`).
- `wakeWordCapability()` - a separate, deliberately pessimistic probe. It returns
  `"wake word only runs while darkroute is on screen; it stops when the screen locks"` whenever
  `document.visibilityState === 'hidden'`, and
  `"this browser cannot listen continuously, so there is no wake word"` when the implementation has
  no `continuous` flag. The `WAKE WORD ON` chip drawn in `04 · ASK` must render this reason instead
  of a broken promise.

`sendsAudioOffDevice()` exposes the Chromium fact so a screen can warn **before** the first press
rather than after.

## Notifications and vibration require permission and capability checks

Both are permission- or capability-gated, both are checked, and neither is requested on load.

Notifications (`services/adapters/notifications.ts`) implement section 06's rule literally:
one channel per state carried in `data.channel`, and **one shared tag** for every camera alert so a
replacement replaces rather than stacks. County entry and watchlist get their own tags precisely so
they cannot evict a live camera alert. `clear` and `approaching` post silently; `in_range` and
`multiple` may make noise; county and watchlist are **always** silent.

Vibration (`services/adapters/vibration.ts`) is reserved for cameras and that is enforced in code,
not by review: `assertCameraAlertOnly` throws for any other source and there is no second path to
`navigator.vibrate`. Pulse counts are 0 / 1 / 2 / 2 for clear / approaching / in_range / multiple,
matching `HAPTIC_PULSES_BY_STATE` in `packages/core/src/alert.ts`, with the agreement asserted by
test. `navigator.vibrate` is also a no-op on iOS Safari and is ignored by some Android browsers when
the device is in silent or Do Not Disturb mode - which is why a haptic is never the *only* signal.

One open conflict to resolve before the watch is built: `W10 · THRESHOLD - ROTARY BEZEL` asks for a
"HAPTIC TICK EACH STEP", and a per-step tick is a non-camera haptic that the guard above forbids.

## Battery and Ambient Light are optional and often unavailable

`navigator.getBattery` was removed from Firefox and Safari as a fingerprinting surface and survives
only in Chromium. `AmbientLightSensor` ships in Chromium only, behind
`chrome://flags/#enable-generic-sensor-extra-classes`, and nowhere else at all. "Unsupported" is the
normal case for both, not a failure. Neither adapter estimates a value from anything else, and
nothing about alerting depends on either.

## Permissions this app never asks for on load

No permission is requested on page load, on import, or on mount. `request()` is the only method in
the adapter directory that may raise an OS prompt, and every implementation carries a comment saying
it must be called from a user gesture. `apps/pwa/src/main.tsx` states the same rule for the entry
point, and `features/onboarding/OnboardingScreen.test.tsx` proves it for the one screen that exists
by counting `request()` calls after a render and asserting zero.

Camera is deliberately not a permission this app holds at all: photo capture uses
`<input type="file" accept="image/*" capture="environment">`, which hands the job to the OS camera
app. Onboarding therefore lists three permissions (location, notifications, motion), not four.

---

## Adapter table

Every adapter in `apps/pwa/src/services/adapters/`. "State" describes the
adapter itself, not every native capability in `apps/android/`:

- **Implemented** - real platform code, exercised by tests in this repo.
- **Mocked** - a driveable stand-in also exists in `adapters/testing/mocks.ts` (all fifteen have one;
  the mocks run the real guards, so a test that drives a mock tests the same decisions).
- **Unavailable** - this adapter reports unsupported on the platforms we actually target.

"UI" says what a screen or adapter surface shows today. Some table entries are
capability-level notes rather than a complete screen-reachability inventory.

| Adapter | Capability | Permission model | When unavailable | What the UI shows | State |
|---------|-----------|------------------|------------------|-------------------|-------|
| `geolocation.ts` | `watchPosition` fixes: lat/lon, accuracy, speed, heading, platform timestamp; `fixAgeMs()` | `permission()` via Permissions API (`geolocation`); `request()` prompts, user gesture only | `no navigator` / `navigator.geolocation is not available` / `needs a secure context (https or localhost)`. `start()` is a no-op that records the error and never throws | RADAR `NO FIX · 0 SATS`, "last fix 40s ago. showing cached cameras only.", `RETRY LOCK`; on denial the `ALLOW` action plus the on-device promise from A1; a separate copy when the platform has no geolocation API at all | Implemented + Mocked |
| `twaLocationBridge.ts` | Contract for a possible injected native bridge; `bridgeInfo()`, `startBackgroundTracking(consent)` | `permission()` polls an injected interface; background tracking additionally requires an explicit `BackgroundConsent` or it throws | Returns `"no native bridge; foreground web geolocation only"` when that interface is absent | No screen uses this bridge. The current Android TWA uses Android Browser Helper location delegation through ordinary web geolocation instead | Implemented contract + Mocked; **not wired to the current TWA** |
| `orientation.ts` | Compass heading for `FACING · FROM COMPASS · 223°` | Android/desktop: none (`granted`). iOS 13+: `DeviceOrientationEvent.requestPermission()`, user gesture only; `permission()` answers `prompt` because iOS offers no passive read | `DeviceOrientationEvent is not available` / `no window to receive orientation events`. If events arrive without usable absolute heading it records `no-heading-data` rather than emitting a fake bearing | Onboarding `MOTION SENSORS · OPTIONAL`; the report sheet's facing arc falls back to `TAP ARC TO ADJUST` | Implemented + Mocked |
| `motion.ts` | Accelerometer/gyroscope; moving vs parked (B5 `NOTIFY WHEN PARKED`), compass steadying | Same iOS 13+ model as orientation | `DeviceMotionEvent is not available` | Onboarding `MOTION SENSORS · OPTIONAL`. Never used to derive position - dead reckoning would be a location trace built without a location permission | Implemented + Mocked |
| `notifications.ts` | One channel per alert state, one shared tag for camera alerts, separate silent tags for county and watchlist | `permission()` reads `Notification.permission`; `request()` prompts, user gesture only | `the Notification API is not available` / `notifications need a secure context`. Posting returns an outcome instead of throwing | Onboarding `NOTIFICATIONS · ALLOW` with "One channel, replaces itself, never stacks" | Implemented + Mocked. **Gap:** `BADGE_URL` is `/assets/darkroute-mark.png` (the 1273×1236 master) where `public/icons/monochrome-96.png` belongs |
| `vibration.ts` | Camera-alert haptics only: 0/1/2/2 pulses | None - `navigator.vibrate` has no permission | `no navigator` / vibration API absent. Also silently ignored by the OS in silent/DND mode, which is why a buzz is never the only signal | No dedicated UI. A non-camera caller gets a thrown `SilentChannelError`, not a buzz | Implemented + Mocked |
| `screenWakeLock.ts` | Hold the display awake while RADAR is foreground **and** the document is visible | None - no prompt exists, so `permission()`/`request()` are **absent** rather than faked | `the Screen Wake Lock API is not available`. The platform also releases the lock on every hide; the adapter re-acquires on visible, which is the only supported way to survive a lock-screen round trip | No dedicated UI yet; `services/pwa/wakeLock.ts` drives it from screen state | Implemented + Mocked |
| `speechRecognition.ts` | Push-to-talk (dependable) and wake word (visible-only, best effort); `sendsAudioOffDevice()` | `permission()` via Permissions API (`microphone`); `request()` prompts, user gesture only | `speech recognition is not available in this browser` / `the microphone needs a secure context`. `wakeWordCapability()` answers separately and pessimistically | ASK is not built. The `WAKE WORD ON` chip must render `wakeWordCapability().reason` when unsupported | Implemented + Mocked |
| `cameraCapture.ts` | One still photo via the OS camera app (`<input capture="environment">`) | **None** - the OS camera app owns the decision, so `permission()`/`request()` are absent | `no document` / `this browser does not support file inputs`. Browsers without the `cancel` event never resolve on back-out; the promise stays pending until `abort()` - stated rather than guessed | Report sheet `ADD A PHOTO` tile (`ReportViewV1`), **live since 2026-08-31** - `ReportScreen` calls `capture({ facing: 'environment' })` and hands the result straight to `preparePhoto()`. The intel-card `DROP PHOTO OF CAMERA` key is still inert: a photograph is owned by a report id, and an intel card has no report to hang one on | Implemented + Mocked. **`CapturedPhoto.metadataStripped` is always `false`** - EXIF GPS is not removed here, so any upload path must treat such a photo as unsendable. Still true and still the right contract: the stripping is `features/report/preparePhoto.ts`, one layer up, which re-encodes through a canvas and returns a `PreparedPhoto` with `metadataStripped: true`. Only prepared bytes are ever stored |
| `share.ts` | Web Share for the zone-audit card and camera intel; `fileShareCapability()` probed separately | None | `the Web Share API is not available` / `this browser cannot share files (navigator.canShare is missing)` | B6 `SHARE CARD` and the intel card's `SHARE`; neither exists yet | Implemented + Mocked. Constructs no URL - the production origin comes from env config or the share goes out without a link |
| `clipboard.ts` | Write-only: camera ids and user-requested export blobs | `permission()` queries `clipboard-write`; most browsers do not answer, which reports `unavailable`, not `denied`. No `request()` - a copy is always a user action | `the clipboard needs a secure context` / `navigator.clipboard.writeText is not available` | Copy affordances on the intel card; not built | Implemented + Mocked. No read path (`readText` prompts and there is nothing to paste). Refuses anything outside the `ClipboardKind` union, so a plate or a coordinate is not expressible |
| `network.ts` | `navigator.onLine` plus Network Information (`effectiveType`, `downlink`, `rtt`, `saveData`, `type`) when offered | None | `navigator.onLine is not available` for the base; `the Network Information API is not available in this browser` for the detail fields, which are then null | RADAR offline strip `NO NETWORK · RUNNING ON CACHE`, and the `SYNC ON WIFI` queue rule | Implemented + Mocked. `onLine` only means "the OS thinks an interface is up" - it is famously true on a captive portal, and is reported as exactly that claim |
| `visibility.ts` | `visibilityState`, focus, `freeze`/`resume`, `pagehide`/`pageshow` persisted | None | `document.visibilityState is not available in this runtime` | No direct UI; it decides screen-vs-notification routing and watch mirroring | Implemented + Mocked |
| `battery.ts` | Level, charging, charging/discharging time | None | `navigator.getBattery` absent - **the normal case** outside Chromium | W6 `BATT 100` (watch, not built). Any screen showing a battery figure needs a no-figure state | Implemented + **usually Unavailable** + Mocked |
| `ambientLight.ts` | Lux, for auto-dim in tunnels and after dark | `permission()` queries `ambient-light-sensor`; `request()` is honest that sensors have no explicit request call - starting one *is* the request - and reports `unavailable` rather than claiming a decision | `AmbientLightSensor is not available in this browser (chromium-only, behind a flag)` / `sensors need a secure context` - **the normal case everywhere** | Nothing depends on it. Dimming must key off the clock or an explicit setting, never wait for a lux reading that will not arrive | Implemented + **usually Unavailable** + Mocked |

## Rules of thumb for anyone adding a screen

1. Read `capability()` before you render an affordance. If it is unsupported, render the `reason`
   sentence - it is written for a human - not a disabled control with no explanation.
2. Call `request()` only from a handler attached to a real user gesture, and only when the action the
   user just took obviously needs it.
3. Never present a value the adapter did not receive. There is no "reasonable default" for a
   position, a heading, a battery level or a lux reading.
4. Browser PWA copy must remain foreground-only. TWA-specific screen-off copy
   must distinguish "screen off while the app remains running" from "fully
   backgrounded or killed"; the current shell promises only the first.
