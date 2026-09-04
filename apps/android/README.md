# DarkRoute — Android (Trusted Web Activity)

The app *is* the PWA. This project gives it a launcher icon, a standalone window
with no address bar, and — the reason it exists — **Android's location
permission instead of Chrome's**, so the alert survives the screen locking.

Modelled on [`android-browser-helper`](https://github.com/GoogleChrome/android-browser-helper)
`demos/twa-basic`, with the `ExtraFeaturesService` from `demos/twa-location-delegation`.

## Why not just "Add to home screen"

An installed PWA gets the icon and the window. It does **not** get background
location:

> `watchPosition` stops when the screen locks. There is no service worker trick
> and no wake-lock trick that changes it.
> — `apps/pwa/src/services/adapters/twaLocationBridge.ts`

For an app whose entire job is telling a driver about a camera before they pass
it, that is not a limitation — it is the product not working. The
`locationdelegation` library routes the page's ordinary `navigator.geolocation`
calls through the native fused provider under Android's own permission. **No web
code changes**; the page keeps calling the standard API.

## Layout

| Path | What it is |
|------|-----------|
| `app/src/main/AndroidManifest.xml` | The whole configuration. Every `${fwm*}` is filled from `gradle.properties`. |
| `app/src/main/java/ai/darkroute/app/ExtraFeaturesService.java` | The only native class: registers the location handler. |
| `app/src/main/res/values/colors.xml` | The one permitted copy of the design tokens Android can't read from CSS. |
| `app/src/main/res/mipmap-*`, `drawable-*` | Generated — do not hand-edit. See below. |
| `../pwa/public/.well-known/assetlinks.json` | The other half of the trust relationship. Served by the site. |

There is deliberately no other native code. Every rule about what the app may
store, show or send lives in the web app, where it is testable — duplicating any
of it here would create a second place for the answer to be different.

## Icons and splash

Generated from the same master raster as the web icons, by the same
decode/scale/encode code, so the home-screen icon and the browser install prompt
show the same mark at the same proportions:

```bash
node scripts/generate-android-assets.mjs          # write
node scripts/generate-android-assets.mjs --check  # CI: fail if stale
```

The adaptive foreground is fitted to the **66dp safe circle**, not a 66dp box: a
rectangle inscribed in a box of width D has corners up to 41% outside the circle
of diameter D, which is how a logo gets its edges clipped on a round launcher.

## Building

Requires JDK 17 and the Android SDK (platform 36, build-tools 36.0.0). Neither
is a system package here; this repo was built against a user-local toolchain:

```bash
export JAVA_HOME=~/.local/android-toolchain/jdk-17.0.20+8
export ANDROID_HOME=~/Android/Sdk
cd apps/android

./gradlew :app:assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease    # signed APK, for sideloading and testing
./gradlew :app:bundleRelease      # .aab, the only format Play accepts
```

`local.properties` (gitignored) must point at the SDK: `sdk.dir=/path/to/Sdk`.

## Signing

The upload key lives at `~/.darkroute-android/upload-keystore.jks`, referenced by
`apps/android/keystore.properties`. **Both are gitignored and neither may ever be
committed.**

> Losing this key means never being able to update the app on Play under the same
> listing again. There is no recovery and no appeal. Back it up somewhere that
> is not this machine.

Current certificate fingerprint (SHA-256):

```
E4:3B:38:50:9A:F9:6E:2E:1F:83:96:14:A1:A3:2D:28:80:30:0D:AF:18:AA:E0:3D:49:76:69:D8:B9:A8:B1:47
```

That value appears in exactly one other place — `assetlinks.json` — and the two
must match or the app opens with an address bar.

## Digital Asset Links — the step that silently half-works

`assetlinks.json` must be served at `https://<host>/.well-known/assetlinks.json`
with `Content-Type: application/json`. It lives in `apps/pwa/public/.well-known/`
so it deploys with the site.

If it does not resolve, **the app still launches** — with a Chrome address bar
across the top. It looks like it worked. That is why hosting the file is part of
shipping, not a follow-up. Verify with:

```bash
curl -s https://darkroute.ai/.well-known/assetlinks.json
adb shell pm get-app-links ai.darkroute.app     # want: darkroute.ai: verified
```

## Production host

The release build trusts `darkroute.ai`. That host must serve
`/.well-known/assetlinks.json` before an APK is distributed. The manifest,
asset statement, and deep-link filter all follow `fwm.host` in
`gradle.properties`; changing it requires a rebuild, a `versionCode` bump, and
another `pm get-app-links` verification.

An app distributed before its asset link resolves still launches, but with a
Chrome address bar. Treat the asset link as a release gate, not a follow-up.

## What is not done

- **Not on Play.** No listing, no store assets, no data-safety form. The `.aab`
  is built and signed and that is as far as it goes.
- **No `ACCESS_BACKGROUND_LOCATION`.** Delegation covers the screen being off
  while the app is running, which is the case that matters in a car. True
  background location is a separate Play review with a filmed justification.
- **No notification delegation.** `demos/twa-notification-delegation` is the
  path when the alert needs to fire with the app fully backgrounded.
