# gap inbox -- the map's owner filter

Files: `apps/pwa/src/features/map/ownerFilter.ts` (new),
`apps/pwa/src/features/drive/DriveScreen.tsx` (the `drawn` memo and the
`cameras` prop on `MapCanvas`), `apps/pwa/src/features/map/MapCanvas.tsx`
(unchanged, but it is where both gaps below actually happen).

Source read this session: `MapCanvas.tsx` (`swapForZoom` and the overview
loader), `layers.ts` (`toFeatureCollection`, `cameraLayer`), `engineLoop.ts`,
`stores/cameras.ts`.

---

## 1. The national overview cannot be filtered, and fails open

`MapCanvas` swaps the camera source's data for `/cameras/overview.json` below
zoom 11, and the features in that file carry `properties: {}` -- no `id`, no
`ownerType`, nothing. It is a pre-baked heat field, not the archive.

So when a driver picks an owner class and then zooms out past street level, the
map draws the whole country's field again regardless of the filter. The owner
data is not there to filter on.

This fails OPEN: it draws MORE than the filter promises, never less, so it
cannot cause the failure the filter is otherwise guarded against (a hidden
camera the driver thinks is not there). It is still an inconsistency a driver
can see, and the panel says so in one line rather than leaving it to be
discovered.

Fixing it properly means either shipping an owner byte per overview feature --
which grows a file whose whole purpose is being small -- or generating one
overview per owner class, which multiplies it by five. Neither is worth doing
before somebody asks; the honest line in the panel is.

## 2. `data-fwm-map-state` now reports what is DRAWN, not what is HELD

`MapCanvas.publish()` writes `cameras: <count>` onto the map element from the
`cameras` prop, and that prop is now the filtered array. With a filter active
the attribute under-reports: it is the count of dots on the map, not the count
of records on the phone.

Nothing in the app reads it -- it is a diagnostic for preflight and harnesses --
and every preflight run starts at "all owners", because the filter is
deliberately not persisted. So no current reader is wrong today. The trap is a
future one: anybody quoting that attribute as "cameras loaded" will be quoting
the wrong number the first time a filter is on when the screenshot is taken.

The fix, when somebody needs it, is to widen the diagnostic to carry both
figures rather than to unfilter the prop.

## 3. Look up and the map disagree about what colour an owner is

Not caused by this change, found by it. `cameraLayer` colours
`inter_agency` with `--fwm-alert-multiple` and `private` with `--fwm-plasma-6`;
`lookupV1.css` collapses `police` + `inter_agency` into `--fwm-alert-in-range`
and `hoa` + `private` into `--fwm-alert-approaching`. Two screens, five classes,
two different legends.

The map control panel has to use the map's palette or its swatches are a legend
for a picture that is not on screen. Reconciling Look up's dots is a separate
decision and is not made here.

## 4. An active filter is not said anywhere while the drive card is absent or shrunk

Opened by the rail slice, mostly CLOSED by the card slice, with a remainder.

The panel carries the display-only sentence permanently, which is right, but
choosing an owner class SHUTS the panel -- so the moment the filter starts
hiding cameras, the sentence explaining it left the screen with it. That is now
answered: the drive card's full state carries a `MAP DRAWS` row naming the
current selection, and whenever a class is hidden the row also carries
`drawing only. every camera is still being watched.` It is on the surface the
driver is already reading, because that surface is the warning.

What is left, and it is deliberate rather than forgotten:

- **No nearest camera, no row.** The card only exists when the engine has
  something to report; with nothing in range DRIVE draws its empty line instead,
  and the filter is then said only by the rail key's accessible name and its
  scan hue. Nothing is being warned about either way in that state, so the
  forgetting this feature guards against cannot bite there -- but a driver who
  filters, sees an empty road, and puts the phone down has no visible reminder
  when the first camera does arrive. It arrives with the card, and the card
  brings the row.
- **Shrunk card, no row.** The mini state keeps the distance and the owner and
  drops every control; the row goes with the queue and the two keys. Same
  fallback: the rail key.

Fixing either properly means putting the sentence somewhere that is always on
screen, and the only such place is over the map -- which DRIVE's own governing
rule forbids ("nothing covers the map that is not a control"). Not worth doing
before somebody meets it.

The two sentences saying this fact -- `DRIVE_DRAWS_STILL` on the card and
`driveDrawingOnly` on the rail key -- are one claim in two wordings, because the
key has no visible text and must name the class itself while the card's row
already prints it. Both are in `DriveScreen.tsx` beside a comment saying that
rewording one means rewording both.

## 5. There are now THREE owner filters spelled with the same five words

Nothing is broken; this is the standing invitation to break it, written down so
the next reviewer meets it before they act on it.

| Control | Verb | Where the state lives | Persisted? |
|---|---|---|---|
| `settings.ownerTypesEnabled` | ALERTS on a class | settings store | yes |
| `settings.mapOwnerFilter` | DRAWS a class | settings store, runtime only | no |
| LOOK UP's chips | SEARCHES within a class | `useState` in `LookupV1Screen` | no |

They read identically on screen -- all three are the five `OWNER_LABELS`
strings -- and every pair of them looks, at a glance, like duplication worth
folding. Each fold is a different defect:

- alerting + drawing: the one the whole feature was written to prevent. A driver
  narrows the map to see who owns what and stops being warned about everything
  else.
- drawing + searching: a driver who narrowed a SEARCH on Tuesday drives on
  Friday with a class missing from the map, having never touched DRIVE. The
  reverse is worse: LOOK UP's count line prints its own denominator
  ("N matching, searched against the M cameras on this phone"), and that
  sentence stays literally true while its meaning silently changes, because the
  chip that produced it now also governs the driving screen.
- alerting + searching: a search that quietly refuses to find the classes the
  driver muted, from the screen whose badge says `LOCAL` and whose claim is that
  it searched everything on the phone.

What holds them apart, in code rather than in this file:
`features/lookup/LookupV1Screen.ownerFilter.test.tsx` mounts LOOK UP with
`mapOwnerFilter` already set and asserts the screen is byte-identical, asserts a
chip press leaves `mapOwnerFilter` null, and greps the source for the shared
symbols; `stores/settings.test.ts` asserts the two store fields do not move each
other; `features/map/ownerFilter.engine.test.ts` and
`features/drive/DriveScreen.ownerFilter.test.tsx` hold the alerting line.

The LOOK UP file was checked against a merge introduced deliberately in both
directions -- the map filter read into `searchCameras`, and a chip press writing
`setMapOwnerFilter` -- and goes red on each. The three older files carry the
same claim from the slices that wrote them.

`OWNER_LABELS` in `features/triage/triage.ts` is the ONE thing all three share,
and that is the right amount: they agree on what an owner is called and on
nothing else.
