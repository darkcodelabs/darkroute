# RADAR and SWEEP merged into one screen

Decision by the product owner, 2026-08-20. Recorded because it overrides the
design system, which draws `01 · RADAR` and `02 · SWEEP` as separate panels in
v1, v2 and the Screens II state matrix.

## Why

Two screens drew the same cameras with different geometry, and a driver had to
learn which was which. RADAR's ring was never a map - it was a threshold
wearing a circle - while the cameras lived on a second screen. One screen is
also one fewer tap at 45 mph, which is the whole argument.

## What the merged screen is

- SWEEP's dial, on RADAR: camera glyphs placed by distance and bearing, pinch
  to change range, tap a dot for the intel card.
- RADAR's hero readout is KEPT above it. `1.5 MI` at 80px with
  `CLEAR · NEAREST AHEAD` under it is the number a driver reads without
  focusing; the dial is a thing you study. Losing it would have traded the
  driving surface for the exploring one.
- The alert threshold is now one of the dial's rings, lit in the state hue,
  labelled `THRESHOLD 500 FT` on the line itself. "Clear" is the picture rather
  than a word inside a circle.
- The live zone card sits below it.
- SWEEP is gone from the dock. `?screen=sweep` still resolves so anything
  already linked lands somewhere real.

## What was LOST, and it is real

`AlertRing.tsx` was v2's RADAR scope and carried instrument detail the dial
does not have:

- the lattice, the ticks and both crosshairs
- the centre stack `THRESHOLD / 500 / FT / LOCK 041°`
- the vertical `1000FT` rail on the left and `SCAN 4HZ` on the right
- the state matrix's collapsed "matrix circle" treatment

The threshold and the heading lock survive - the threshold as a ring plus its
own label, the heading as the dial being heading-up. The lattice, ticks,
crosshairs and the scan-rate rail do not. SweepDial has its own telemetry
corners (`SCAN 2.4s / RES 12PX / SRC MESH+DB`, `HDG / LAT / LON`) which cover
the same ground differently.

The component and its tests were deleted rather than left dead. If any of that
instrument detail is wanted back, it belongs ON the dial rather than as a
second circle, and this file is the list of what to port.

## Open

- The design files still show two panels. Whoever reads them next will find
  a SWEEP screen that the product no longer has a key for.
- `features/sweep` still exists and is still where the dial, the glyph, the
  pinch and the zoom live. It is now a component library for RADAR rather than
  a screen. Renaming it would be honest and is not done here, because a rename
  that large during a merge is how a merge stops being reviewable.
