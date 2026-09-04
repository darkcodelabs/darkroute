# Gaps - the sensor runtime and the first-run gate

Filed while wiring `apps/pwa/src/app/sensors.ts` and `apps/pwa/src/app/firstRun.ts`.

## the-bug-this-fixes

Every sensor adapter in `services/adapters` was built, tested and documented, and
nothing ever called `start()` on any of them. `stores/position.ts` was built to
receive fixes and nothing ever handed it one. `OnboardingScreen` - the only place
allowed to request location, because it owns the user gesture - was registered but
never navigated to.

The net effect on a real phone: the driver installs the app, lands on RADAR, is
never asked for permission, and reads `NO FIX · waiting for the first fix`
forever. Every downstream count (`IN RANGE 0`, `FLOCKED TODAY 0`,
`ZONE NOT LOCATED`) was an honest report of a runtime that was never started.

Not a screen bug. There was no loop.

## stale-fix-is-never-marked

`positionActions.markStale()` exists and its own comment says it is "driven by the
loop, not a timer". The runtime does not call it, deliberately: the loop that
should is the engine tick, and putting a timer in `sensors.ts` would create a
second, invisible clock alongside the engine's.

Consequence today: a fix that ages out stays presented as current. `RadarStrip`'s
"last fix 40s ago. showing cached cameras only." is therefore unreachable in the
shipped app.

Needs: the engine tick to compare `fixAtMs` against its tolerance and call
`markStale()`. `geolocation.fixAgeMs()` already exists for exactly this.

## post-start-errors-are-sampled-not-pushed

The `Adapter` contract exposes `error()` as a getter and `subscribe()` for values
only. There is no error subscription. So an error raised *after* the watch is open

- a timeout in a tunnel - is picked up on the next fix, not at the moment it
happens.

That shape is right for recovery (a fix arriving clears a stale error, and the
runtime syncs it on every emission so the screen cannot show a live distance next
to an old timeout) and wrong for a driver who gets no further fix at all. That
second case is what `#stale-fix-is-never-marked` above is meant to cover, so the
two should be resolved together rather than by adding an error channel here.

## motion-permission-is-never-requested-anywhere

`startMotion()` reads the permission passively and gives up on `denied`, and it
must: iOS gates `DeviceMotionEvent.requestPermission()` behind a user gesture.
Onboarding requests `motion` and calls it optional, so on iOS the parked/moving
distinction is available only to drivers who accepted it there. Nothing re-offers
it later. SETTINGS is the natural place for a "turn on motion" row.

## the-gate-decides-once-per-load

`useFirstRunGate` redirects when the settings store has hydrated and
`onboardingCompletedAtMs` is null, and skips entirely when the URL carried an
explicit `?screen=`. A driver who arrives on a launcher shortcut and has never
onboarded therefore reaches the shortcut's screen with no location permission -
correct for not losing the camera they stopped to report, but it means the
shortcut screens must keep their own honest empty states rather than assuming a
fix exists. They currently do.
