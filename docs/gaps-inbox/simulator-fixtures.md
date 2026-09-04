# gap inbox -- development fixtures + drive simulator

Scope: `apps/pwa/src/test/fixtures/**` and `apps/pwa/src/services/simulator/**`.

Almost nothing in this lane needed a value the design does not state. The
scenario speeds are the LOG timeline's own ("47 MPH", "62 MPH", App Screens 05);
the reported GPS accuracy is the REPORT sheet's "±4 M · 9 SATS"; the threshold,
the hysteresis band, the approaching band, the dwell timings and the 150 ft
mute-pierce all come from `@fwm/core`, where they are already cited or already
gapped in `core-engine.md`. The fixture camera ids, owner types, facing and
confirmation count are lifted verbatim from the LOOKUP rows and the INTEL CARD.

Two values had no source at all. Both are about slippy tiles, and neither is a
rendered length, so `scripts/check-design-values.mjs` cannot see them -- which is
exactly why they need a written decision rather than a default nobody chose.
Each is a named export carrying the `GAP:` marker in
`apps/pwa/src/test/fixtures/tiles.ts`; changing one is a one-line edit there.

## fixture-tile-working-zoom

- need: the slippy-map zoom the app fetches, caches and packs camera tiles at.
  The fixture has to pack at *some* zoom for the tile repository to be fed
  without a backend, and whatever it picks becomes the de facto working zoom for
  every test written against it.
- screen: OFFLINE (`Flockys Screens II.dc.html` A2), which renders a real cache
  in a real state -- "CACHED CAMS 4,182 / MAP TILES 318" -- and SWEEP
  (`Flockys App Screens.dc.html` 02), whose rings are 100/300/500/1000 ft.
- source: nothing. No design file names a zoom, a tile size, or a fetch radius.
  The only quantities the design gives are the tile COUNT a healthy install
  holds (318) and the camera count inside it (4,182), which together imply about
  13 cameras a tile but say nothing about how big a tile is.
- stand-in: `FIXTURE_TILE_ZOOM = 16`. At 39.14 deg N a z16 tile is about 474 m
  (~1,556 ft) across, so the 3x3 fetch ring covers the 1,000 ft outer edge of the
  APPROACHING band from anywhere in the centre tile -- including from a corner.
  With `MAX_CAMERA_TILES = 512` that is roughly 115 square km of cache, the right
  order of magnitude for the 318 tiles the OFFLINE screen shows.
- options:
  1. Keep z16. One tile is a few city blocks; a driver at 60 mph crosses one
     every ~18 s, which is a comfortable prefetch cadence.
  2. z15 (~949 m, ~3,114 ft a tile). A quarter as many tiles for the same area,
     so the cache reaches much further, but per-tile freshness gets coarse: one
     stale tile now means a kilometre of city is unverified, and the OFFLINE
     screen's honesty depends on that number meaning something.
  3. z17 (~237 m). Fine-grained freshness and small payloads, but four times the
     tile count for the same area and a tile boundary crossed every ~9 s at
     highway speed -- more requests than a phone running GPS should be making.

## fixture-tile-fetch-ring-radius

- need: how many tiles beyond the current one the app reads ahead, so a camera
  never appears out of nowhere at a tile seam.
- screen: SWEEP (`Flockys App Screens.dc.html` 02), which draws cameras out to
  its 1000 ft ring and must not have a hole in that ring at a tile boundary; and
  OFFLINE, whose cached-tile count is a direct consequence of this number.
- source: nothing. The design shows the outcome (a populated sweep, a cache with
  318 tiles) and never the fetch policy that produces it.
- stand-in: `FIXTURE_TILE_RING_RADIUS = 1` -- a 3x3 block, about 1.4 km square at
  z16. That is the smallest radius that keeps the whole 1,000 ft band inside the
  fetched set from a tile corner, which is the worst case.
- options:
  1. Keep radius 1 (9 tiles). Minimum that satisfies the corner case at z16.
     Tightly coupled to the zoom -- a zoom change must revisit this.
  2. Radius 2 (25 tiles). Real headroom at speed: a driver crossing a seam at
     62 mph has the next ring already cached rather than fetching at the edge.
     Nearly three times the requests and the storage.
  3. Make it a function of speed rather than a constant -- read one ring parked,
     two or three above the design's 5 mph drive-mode threshold. Matches what
     the product actually needs, but it is a policy with state, and it belongs in
     the tile service rather than in a constant.

## note, not a gap: simulator tick rate

`DEFAULT_TICK_HZ = 1` is a property of the SIMULATOR, not of the product -- the
real app takes whatever cadence `watchPosition` gives it -- so it is recorded
here rather than filed. It did surface one product-shaped fact worth writing
down: at 1 Hz and 47 mph a tick covers 69 ft, which is more than the 60 ft
between the two cameras in the `multiple-cameras` fixture pair. Sampled at 1 Hz
they cross the threshold in the SAME tick and the state goes approaching ->
multiple, skipping in_range entirely. The scenario samples at 2 Hz to force the
in_range -> multiple transition it exists to prove. Whether a real driver ever
sees `in_range` for a tightly-spaced pair therefore depends on the platform's
fix cadence, which the product does not control.
