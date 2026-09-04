# Wear OS as a dash display

**Status:** investigation, not started. **Raised:** 2026-08-29.
**Hardware on hand:** Samsung Galaxy Watch Ultra, otherwise unused, to be
3D-printed into a dash mount.

The ask: run DarkRoute on a wrist-sized screen mounted on the dash, doing the
driving job at a smaller scale - alerts that inform AND can be acted on, not a
mirror of the phone.

---

## What already exists, and what of it is dead

Two of the three things here are still good. The third is not, and it is the
one that looked most valuable at first glance.

**DEAD: the twelve-panel watch design.** `.design-src*/Flockys Watch.dc.html`
draws W1 through W12 and it is all v0. It does not describe this app any more:

  W1-W3  RADAR in three alert states   -> v1 renders `radar: DriveScreen`
                                         (`app/registry.v1.tsx:62`). A whole
                                         different screen with a different
                                         instrument and a different ramp.
  W4     SWEEP as the whole face       -> merged into radar
                                         (`screenState.ts:82`). Not a screen.
  W6     NODE hardware health          -> v1 renders `node: MeshScreen`, which
                                         is now three tabs: a filterable
                                         roster, threaded conversations, and
                                         config panels.
  W8     one-tap REPORT then confirm   -> the report sheet has since grown the
                                         camera-placement control, which has no
                                         one-tap form.

So the interaction model is not "already thought through". It was thought
through for an app that no longer exists, and treating it as a starting point
would build the wrong watch carefully. The v1 watch surface has to be derived
from v1 - DRIVE, the plasma proximity ramp, the glass material - not adapted
from these panels.

Keep the file as history. Do not design against it.

**LIVE: surface detection.** `apps/pwa/src/app/surface.ts` defines
`FWM_SURFACES = ['phone', 'watch-round', 'watch-square', 'dash']`, detects
which one it is on, writes `data-fwm-surface` to the root, and re-runs on
resize and orientation change. This is design-agnostic and survives.

**LIVE: the surface tokens.** `tokens.css:820` raises the type and touch floors
for `watch-round`, with `watch-square` and `dash` beside it. These are bare
attribute selectors rather than `[data-fwm-design="v1"]`-scoped ones, so they
apply under both designs and did not go stale with v0.

The net: the plumbing that decides "this is a watch" is real and reusable. The
picture of what to draw on it is not.

---

## The actual blocker: Wear OS has no PWA

DarkRoute is a progressive web app. Wear OS has no install path for one - no
add-to-home-screen, no standalone display mode, no persistent web app model.
The Galaxy Watch Ultra runs Wear OS 5 under One UI Watch, not Tizen, so the old
Tizen web-widget route does not apply either.

Opening the site in a watch browser is technically possible and practically
useless: no background execution, no wake lock, no install, a viewport the
layout would fight, and a browser chrome that eats the screen. It is not the
answer.

That leaves three real options.

### A. Notification mirroring - works today, costs nothing

Wear OS mirrors phone notifications by default, and notification ACTIONS are
interactive on the watch. If the phone posts an alert with actions, the watch
shows it and the actions work.

This delivers a surprising amount of the ask - informative and interactive -
for zero new code, and it should be tested FIRST, before any of the below,
because it may be most of what is wanted. The limits are real though: it is a
notification, not a display. No persistent glance, no radar face, no rotary
threshold, and the alert only appears when it fires rather than being on the
dash continuously.

Worth checking what the notification path actually posts today and whether the
actions are useful on a wrist. `docs/platform-capabilities.md` describes the
notification design (one channel per alert state, one shared tag so alerts
replace rather than stack) - that replace-don't-stack behaviour is exactly
right for a wrist and is already built.

### B. A native Wear OS module, driven by the phone

The proper version. A `:wear` Gradle module beside `apps/android`, written in
Kotlin/Compose for Wear OS, talking to the phone over the Wearable Data Layer
(`MessageClient` / `DataClient`).

The seam already exists on the phone side, and this is the important finding:
the TWA already runs a native service (`ExtraFeaturesService extends
DelegationService`) and already has an established JS-to-native bridge pattern
via `addJavascriptInterface`, documented in
`apps/pwa/src/services/adapters/twaLocationBridge.ts`. A Wear module would hang
off that same seam - the web app pushes alert state to native, native forwards
it to the watch, the watch sends actions back.

Effort is real, and larger than it first looked: a new Gradle module, a message
protocol, a second thing to keep in sync with the web app, AND the watch design
itself, which has to be done from scratch against v1. The bridge existing
removes one hard part. It does not remove the design.

### C. Standalone watch app holding its own data

Rejected on inspection. The app is offline-first because the whole camera
database is on the device - roughly 132,000 points plus basemap tiles. A watch
should not hold that, and would render a map badly if it did.

The v0 design reached the same conclusion - W12 was headed "what stays on the
phone" - and that one judgement survives the rest of those panels going stale,
because it was about the hardware rather than about the screens. The watch is a
glance-and-act surface driven by the phone, not a second copy of the app.

---

## The cheaper alternative worth naming

A dash-mounted old phone does all of this today with no new code, a bigger
screen, real GPS, and a real map. It is worse in exactly one way - it is
another phone on the dash rather than a neat watch-sized instrument - and
better in every other. If the goal is the driving experience, that is the
fastest route. If the goal is the watch specifically, B is the answer.

---

## What to check before committing to anything

1. Does the current notification path already surface usefully on the watch?
   Pair the Ultra, drive, see what arrives. This is one evening and may end the
   investigation.
2. Do notification actions work from the wrist for confirm/dismiss, and does
   the replace-don't-stack tag behave on Wear?
3. Battery cost of the Data Layer link during a long drive, on both devices.
4. Whether a dash-mounted watch stays awake usefully - Wear OS ambient mode,
   always-on display, and whether an ongoing activity keeps the face up.
5. What the v1 watch surface should actually BE. This is design work, not a
   port. DRIVE is the product now, so the question is what one glanceable
   instrument plus one or two actions look like at 45mm - probably the closest
   camera, its distance, the plasma band, and confirm/mute. Nothing about that
   comes from the v0 panels.

## Open questions

- Does the watch need its own alert threshold, or does it inherit the phone's?
  Inheriting is simpler and matches "the phone is the app". A separate one
  means two sources of truth for the number the whole product is built on,
  which is worth avoiding unless there is a reason.
- What happens when the phone is not present? A watch alone has no camera data.
  The honest answer is probably "it says so and does nothing", matching how the
  rest of the app treats absent data.
- Is REPORT from the wrist wise at all? The position
  fix would be the phone's, and the camera-placement control added in the
  report sheet has no wrist equivalent. A wrist report may only be able to
  produce an unpublishable record, which may still be worth it locally.
