# gap inbox -- ALERT (v1 takeover)

Files: `apps/pwa/src/features/alert/{AlertV1.tsx,alertV1.css,AlertV1.test.tsx}`.

Source read: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isAlert` block
(lines 654-670) in full. Backing code read before writing anything:
`stores/alert.ts` (`AlertTakeover`, `muteAll`, `useIsClosing`),
`stores/cameras.ts` (`useCameraAssessments`, `CameraAssessment`),
`packages/core/src/alert.ts`, `features/drive/eta.ts`,
`features/radar/components/RadarView.tsx` (v0's takeover),
`app/App.tsx` (the `alertLayer` slot and the presentation ladder).

## what shipped, and why v0 has nothing like it

v0 has no alert LAYER at all. Its takeover is an attribute on `RadarView` --
`[data-fwm-radar-takeover="true"]`, painted by `radar.css` -- so a driver on
LOG, CONNECT or SETTINGS when a camera comes into range is shown nothing. That
was tolerable while all five dock keys were one tap from RADAR. v1's dock has
four destinations with a hub behind one of them, and SETTINGS, TRIAGE, HELP,
LOOKUP, ASK, OFFLINE and ADMIN all sit under it, so the number of places a
driver can be standing when an alert fires went up sharply.

`AlertV1` is registered as `App`'s `alertLayer`, which the shell already paints
over the screen AND over any open sheet. v0 keeps its RADAR-local takeover,
unedited.

## reroute is drawn and is not implemented

The design's first key is `Reroute`. What it means is: hand the closest camera
to the phone's maps app as a waypoint to AVOID.

No maps app accepts an avoid-this waypoint through a URL. `navigateTo` can only
route somebody TO a point, which on this screen is the exact opposite of the
key's promise -- a driver who taps `Reroute` and gets turn-by-turn directions
INTO the camera has been actively harmed by the feature.

So the key is not drawn. `SILENCE` ships and is real. Closing the gap needs a
routing engine with an avoid-set, not a link, and that is a service decision
rather than a screen one.

### update: DRIVE now ships a detour, and this key still does not

The last paragraph asked for a routing engine with an avoid-set. That is still
the only thing that would make an AVOID waypoint work, and there is still no
such engine here -- but it turned out not to be the only way to route somebody
around a camera.

`packages/core/src/avoidance.ts` plans the detour as an ordered list of points
to travel VIA, each pushed a clearance off the far side of the readers beside
the route, and a maps link carries those as intermediate stops. DRIVE's
`Route around all N` key does exactly that
(`apps/pwa/src/features/drive/detour.ts`). It is a suggestion and says so: no
road graph, so a stop can land in a field and the maps app will route to the
nearest driveable point instead.

Two reasons this does NOT simply move onto the alert takeover.

The handoff is an HTTPS directions URL -- no OS-chooser scheme carries
waypoints -- so it discloses roughly where the car is and which way it is
pointing. DRIVE asks first, every time, in `DetourOffer.tsx`. A camera alert is
the one surface in the product that must not put a paragraph of small print in
front of a driver at the moment a reader comes into range.

And by the time the takeover is up, the camera is inside the alert radius,
which is the `unavoidable` case: both sides of it are within the berth, so no
stop clears it. The honest key on that screen would refuse on almost every
press. `SILENCE` remains what ships there.

## the design's numbers, and what replaced them

```text
  design                          shipped
  --------------------------------------------------------------------
  `0.2` / `miles`                 `assessment.distanceFt`, rendered in
                                  miles at 1000 ft and over, feet below
  `ahead, right side`             `assessment.relativeDirection`, and
                                  `NO_SIDE` when the platform gave no
                                  heading -- see below
  `Police agency camera on        the record's `street`, when the archive
   Peachtree`                     has one. The owner class is NOT read:
                                  `CameraAssessment` does not carry it and
                                  looking it up would be a second source
                                  for a fact the alert engine already has
                                  an opinion about
  `About 18 seconds`              `describeEta(etaSeconds(...))`, the same
                                  pair DRIVE uses, with the engine's own
                                  `isClosing` rather than a re-derivation
  `MIRRORED TO YOUR WATCH`        not said. Nothing mirrors to a watch in
                                  this build, and a line claiming it would
                                  be the product describing a feature it
                                  does not have at the moment a driver is
                                  least able to check
```

## the side is withheld rather than guessed

`relativeDirection` is null whenever the platform reported no heading, which is
every stationary fix and every device with no compass. `NO_SIDE` ("ahead on your
route") is said then. "on your right", told to a driver whose camera is on the
left, is worse than no side at all -- it points a head at the wrong window at
the moment the plate is being read. `AlertV1.test.tsx` drives the real engine
with `headingDeg: null` and asserts no side label appears.

## dismissing is silencing, deliberately

Tapping anywhere calls `muteAll`. A takeover that merely closes is re-raised by
the next tick, which at 60 mph is the same screen every two seconds until the
camera is behind you. The whole surface is the target, behind the key rather
than over it, so a thumb that lands anywhere works and a thumb that lands on
the key does the same thing on purpose.

## still open

- REROUTE, above. Needs a routing engine.
- The watch mirror. `services/adapters/notifications.ts` has the channel; no
  watch surface consumes it.
- v0's RADAR-local takeover and this layer are two implementations of one
  rule. They agree today because both read `takeover.state`, and nothing
  enforces that they keep agreeing. Retiring v0 collapses it.
