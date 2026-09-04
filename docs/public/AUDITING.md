# Auditing DarkRoute

**This document is written for somebody who does not trust this project.**

That is not a rhetorical posture. DarkRoute tells drivers where automatic
licence plate readers are. If it is lying — if it phones home, if it invents
cameras, if its "signed evidence" is decoration — then the people most likely
to be hurt are the people who relied on it. Nobody should take this project's
word for any of that, including yours truly.

So this file does not argue. It gives you commands. Every one of them was
executed against this tree before it was written down, and where a command
produced an uncomfortable answer, the uncomfortable answer is printed here
next to it. Section 8 is a list of things this audit found and this project has
not fixed.

If you follow a command here and it does not do what this file says it does,
that is either a bug in this file or a bug you have just found. Both are worth
reporting — see [`SECURITY.md`](./SECURITY.md).

---

## Contents

- [0. First, pin what you are auditing](#0-first-pin-what-you-are-auditing)
- [1. The fast pass](#1-the-fast-pass)
- [2. "No coordinate leaves the device"](#2-no-coordinate-leaves-the-device)
- [3. "The camera data is OpenStreetMap"](#3-the-camera-data-is-openstreetmap)
- [4. "Evidence records are independently verifiable"](#4-evidence-records-are-independently-verifiable)
- [5. The gates, and what each one actually proves](#5-the-gates-and-what-each-one-actually-proves)
- [6. The enforcement tests that pin the privacy properties](#6-the-enforcement-tests-that-pin-the-privacy-properties)
- [7. Where to look if you think this project is lying](#7-where-to-look-if-you-think-this-project-is-lying)
- [8. What this audit found and has not fixed](#8-what-this-audit-found-and-has-not-fixed)
- [9. Reporting what you find](#9-reporting-what-you-find)

---

## 0. First, pin what you are auditing

**"The source is public" is not a checkable claim on its own.** You have no way
to know that the source you are about to read produced the bundle on the phone.
Fix that before anything else.

The app carries a route to its own documentation — **MORE → How this works**,
which sits *above* Settings on purpose — and the first thing on that screen is
**the commit the running build came from**, with a link straight to it. The
index of documents is below it, because a document about some other version of
the app is worth nothing.

```bash
git clone https://github.com/darkcodelabs/darkroute
cd darkroute
git checkout <the commit the app showed you>
git log -1 --format='%H %ci %s'
```

For release and later builds, that SHA names a commit in this public
repository. Its history deliberately begins at one squashed release root; it
does not expose the private development commits that came before publication.
For code in that root, audit the tree, module headers, tests, and documents
rather than looking for an earlier public commit that does not exist.

If the app shows `dev` instead of a commit, you are on a development build and
it has no published source to point at. That is stated on the screen too
(`COMMIT_DEV_NOTE` in `apps/pwa/src/features/docs/docs.ts`).

The stamp itself is `__FWM_COMMIT__`, injected at build time in
`apps/pwa/vite.config.ts:105` and read in `apps/pwa/src/app/buildInfo.ts:65`.
A build that stamps a commit it was not built from is a lie this file cannot
catch for you; what you *can* do is build the same commit yourself and compare
the output, which is what §5 is for.

### Toolchain

```bash
node --version      # >= 22.12.0
corepack enable && pnpm --version   # 9.15.9, pinned in package.json
pnpm install --frozen-lockfile
```

There is no install lifecycle hook. `pnpm install` performs the frozen-lockfile
workspace install directly. `./installer.sh` is an optional, short wrapper that
checks the Node floor and then runs the same command; it does not touch `.env`,
Python, or git state.

---

## 1. The fast pass

Everything below runs offline against a clone, needs no credentials, and takes
about four minutes on a laptop.

```bash
pnpm install --frozen-lockfile
pnpm typecheck      # strict TS over pwa, core and the Cloudflare Functions
pnpm lint           # eslint + design gate + two citation gates + asset gate
pnpm test           # 2,947 tests across 185 files
pnpm build          # the bundle the app ships
```

Measured on this tree, 2026-08-29:

| Command | Result |
|---|---|
| `pnpm typecheck` | clean, three projects |
| `pnpm lint` | clean (see §8.4 for one local-only trap) |
| `pnpm test` | `packages/core` 114 · `apps/pwa` 2,743 · `scripts` 83 · `functions` 7 |
| `node scripts/check-design-values.mjs` | 9,023 files scanned, 0 violations, 20 allowlisted |
| `node scripts/check-help-citations.mjs` | 24/24 resolve |
| `node scripts/check-record-citations.mjs` | 47/47 records fully cited |
| `node scripts/check-basemap-assets.mjs` | 3 font stacks × 256 ranges + 5 sprite flavours at 1× and 2× |
| `node scripts/check-map-render.mjs` | exits nonzero on HTML fallbacks, missing style images, unloaded style/source, no rendered roads, or off-origin assets; add `--require-cameras` when the deployment must expose the camera source too |

Green there means the code compiles and its own rules hold. It does **not** mean
the privacy claims are true — a test suite only tests what somebody wrote a test
for. §2 onward is where you check the claims themselves.

---

## 2. "No coordinate leaves the device"

This is the load-bearing claim and the one you cannot check from inside the app.
Check it four ways: read the egress points, grep for the ones nobody wrote down,
run the tests that pin them, and then watch the wire.

### 2.1 Read the egress points — there are not many

There is no coordinate-carrying request to audit, because **there is no send**.
The position fix is held in memory by one store, consumed by the alert engine,
and never serialised. Start here:

| File | What to check |
|---|---|
| `apps/pwa/src/stores/position.ts` | Holds `fix.lat` / `fix.lon`. Header states the rule; the file must contain no persist, no fetch, no `JSON.stringify` of the fix. |
| `apps/pwa/src/stores/persist.ts` | The persistence boundary. Only `settings` and `session` may survive a reload; everything else is memory. |
| `apps/pwa/src/services/adapters/geolocation.ts:128-150` | `redact()` — the only sanctioned way a fix becomes text. Three decimals (~110 m), altitude dropped entirely. There is no debug switch that unlocks full precision. |
| `apps/pwa/src/services/cameras/sync.ts` | Camera fetching. Tiles are fetched **by address**: the z11 tile id is computed on the device and one tile is ~15 km across. |
| `apps/pwa/src/services/db/schema.ts:200-227` | `AlertRecord` — distance, heading, speed, camera id, timestamp. **No latitude field exists.** |

The complete outbound table, with `file:line` for all fifteen paths, is
[`ARCHITECTURE.md` §2](./ARCHITECTURE.md#2-what-leaves-the-device). Read that
adversarially; it is written to survive it, and it names the paths that *are*
disclosive rather than only the ones that are not.

### 2.2 The greps

```bash
# Every literal fetch in the client. Expect 5 hits: one comment, one
# overview.json, three admin-console calls.
rg -n 'fetch\(' apps/pwa/src --glob '!*.test.*'

# The injected variants, and their defaults — always globalThis.fetch.
rg -n 'fetchImpl|guardedFetch|doFetch\(' apps/pwa/src --glob '!*.test.*'

# Every absolute HTTPS URL literal in the client. Cross-origin runtime requests
# go to tiles.darkroute.ai (basemap manifest and archives). User-triggered HTTPS
# navigations include haveibeenflocked.com (see §2.5), www.openstreetmap.org
# (the iD editor), github.com (this repo's docs and commits), and each misuse
# record's own sourceUrl. The map handoff is different: `navigateTo` builds only
# a local `geo:` URI on supported non-iOS platforms and is unavailable on iOS.
rg -no 'https?://[^"'"'"'`) ]*' apps/pwa/src --glob '!*.test.*' | sort -u

# Does a coordinate reach any sink? Look for a fix next to a request body,
# a URL, a log or a notification.
rg -n 'lat|lon' apps/pwa/src --glob '!*.test.*' -l | xargs rg -n 'fetch|body:|URLSearchParams|sendBeacon|navigator.send'

# Analytics of any kind. Expect ~81 hits across ~29 files. They are NOT all
# comments, and the difference matters. 38 of them are the SWEEP scope's
# on-screen instrument readout — features/sweep/telemetry.ts,
# features/sweep/components/SweepTelemetry.tsx, features/sweep/sweep.css — a
# display module that renders the driver's own fix to the driver's own screen
# and transmits nothing. Read its header at telemetry.ts:13-40, which states
# that rule and names the four things enforcing it. The remainder are comments
# and UI copy saying there is no analytics. Recount before you trust this
# number; the tree moves.
rg -in 'analytics|telemetry|sentry|gtag|posthog|mixpanel|amplitude|datadog' \
  apps/pwa/src --glob '!*.test.*'

# Every route this site serves from code. Expect FIVE files: four route or
# shared modules, plus functions/vitest.config.ts, which is not a route.
find functions -name '*.ts' -not -name '*.test.ts'
```

The analytics grep is deliberately noisy. A grep that returns nothing proves
nothing — you cannot tell "no analytics" from "wrong search term". A grep that
returns eighty-one hits you can read one by one is checkable, and the file
called `telemetry.ts` is exactly the thing you should open first. It is a
formatter, not a transmitter, and the way to confirm that is `rg -n 'fetch|
sendBeacon|XMLHttpRequest' apps/pwa/src/features/sweep` returning nothing.

### 2.3 Run the tests that pin it

```bash
pnpm --filter @fwm/pwa exec vitest run \
  src/features/node/mesh.privacy.test.ts \
  src/stores/persist.test.ts \
  src/features/settings/removal.test.ts \
  src/services/privacy/forget.test.ts \
  src/features/report/osmEligibility.test.ts \
  src/features/report/demoGuard.test.ts \
  src/features/lookup/LookupScreen.source.test.ts \
  src/features/lookup/LookupV1Screen.source.test.ts \
  src/services/db/publishHold.test.ts
```

What each of those catches is §6. Read that section before deciding the suite is
adequate — several of these tests are structural greps over source files, and
their scope is a deliberate, arguable choice you should disagree with if you
think they are drawn wrong.

### 2.4 Watch the wire

Static reading tells you what the code says. This tells you what it does.

1. Build and serve the real bundle, not the dev server:

   ```bash
   pnpm build
   pnpm --filter @fwm/pwa preview      # port 5173, strictPort
   ```

2. Open Chrome DevTools → **Network**, filter **All**, tick **Preserve log**,
   and check **Disable cache** for the first pass.
3. Grant location. Use DevTools → **Sensors** → *Location* to set a coordinate
   rather than being outdoors, and **change it a few times, across tile
   boundaries**, so you exercise the resync path.
4. What you should see, and nothing else:
   - `GET /cameras/index.json`
   - `GET /cameras/{11}/{x}/{y}.json` — one per ~15 km square entered
   - `GET /cameras/overview.json` when the national map is opened
   - `GET /cameras/counties.json`, `/cameras/places.json`
   - `GET /records/counties.json`
   - `GET /api/admin/me` once per load
   - the app's own JS/CSS/fonts/`manifest.webmanifest`
5. **Sort by Size and look at every request with a body.** There should be no
   `POST` at all in ordinary use. If you find one, you have found something.
6. Check the tile requests against your simulated position. Compute the tile id
   yourself — `x = floor((lon+180)/360 * 2^11)` — and confirm the request path
   matches *that square*, not your point. The path is the disclosure, and it is
   1 part in ~10^6 of a coordinate.
7. Turn the radio off (**Network → Offline**) and reload. The document should
   come from the `fwm-documents` cache and the cameras from `fwm-camera-tiles`,
   with **no request to any other origin**. Confirm what the worker actually
   registered:

   ```bash
   rg -o 'urlPattern|cacheName:"[^"]+"|revision' apps/pwa/dist/sw.js | sort | uniq -c
   ```

Also worth doing: DevTools → **Application → Storage**. Web storage will not
be empty, and a document that told you it would be is one you should stop
trusting. On the default path you will find:

| Key | Storage | Written by |
|---|---|---|
| `fwm.onboarded` | `localStorage` | `app/firstRun.ts:92` |
| `fwm.basemap.archive` | `localStorage` | `features/map/manifest.ts:85`, `:293`, storage handle from `MapCanvas.tsx:413` |
| `fwm.map` | `sessionStorage` | `features/map/flag.ts:21`, `:38` |

What it must **not** hold is a plate, a coordinate, or a report. The ESLint rule
at `eslint.config.js:91-101` (`no-restricted-globals`) bans the bare `localStorage`
and `sessionStorage` identifiers only — `globalThis.localStorage` passes, and
`app/mirror.ts:31-33` says so in as many words and explains what that escape
hatch is limited to. So the lint rule is a speed bump, not the control; the
control is that nothing writing a coordinate goes through it. `API.md` §2.2
documents `fwm.basemap.archive` as the archive fallback.

IndexedDB will hold `fwm` and `fwm-crypto`; open them and look for a coordinate
outside a report you filed yourself.

### 2.5 What *does* leave, stated plainly

An audit that only confirms the flattering claim is not an audit. These are
real, they are in the code, and they are documented rather than patched quietly
because in each case the alternative is a product decision, not a bug fix.

| Leaves | Discloses | Where |
|---|---|---|
| **PMTiles range requests to `tiles.darkroute.ai`** | **the viewport you are looking at**, cross-origin and unauthenticated | `apps/pwa/src/features/map/basemap.ts:58,72` |
| **`geo:` map handoff on supported non-iOS platforms** | the destination is passed locally to the OS-registered map handler; DarkRoute makes no HTTPS request. The selected map app may use its own network after the handoff. On iOS, `navigateTo` returns `unavailable` and the shipped v1 Drive and Intel controls are absent. | `apps/pwa/src/services/adapters/navigateTo.ts:82-127`, `apps/pwa/src/features/drive/DriveScreen.tsx:1023`, `apps/pwa/src/features/intel/IntelScreen.tsx:386` |
| **Speech recognition** | on Chromium, **your audio, to a Google service**. Surfaced by `sendsAudioOffDevice()` and warned about on screen — not hidden, but real. | `apps/pwa/src/services/adapters/speechRecognition.ts:331` |
| **Camera tile requests** | one ~15 km square per square entered, to this project's own origin | `apps/pwa/src/services/cameras/sync.ts:156` |
| **LoRa transmissions** | a broadcast is a statement in the clear on a public key; a DM is sealed but its header is not | `apps/pwa/src/features/node/mesh.ts` |

The iOS map boundary has two layers to audit. `navigateTo` returns `unavailable`
before invoking its opener, even if a caller passes a camera or derived waypoint.
The shipped v1 Drive and Intel screens also call `canUseGeoHandoff()` and omit
their map controls when it is false. The adapter check is the security boundary;
the presentation checks prevent offering a control that cannot work. See
[`ARCHITECTURE.md` §2](./ARCHITECTURE.md#2-what-leaves-the-device).

---

## 3. "The camera data is OpenStreetMap"

Every camera has an OSM node id, so this claim is not merely auditable — it is
auditable *record by record, against the upstream, by a stranger*.

### 3.1 The claim, precisely

The approved contract accepts OSM **nodes** matching
`man_made=surveillance` plus case-insensitive `surveillance:type=ALPR` or
`ANPR`, then requires strict containment in the pinned Census 50-states/DC/PR
geometry. The coarse capture rectangles are completeness prefilters, never a
country test. The checked-in tree used by the dated commands below is a legacy
audit snapshot that predates that approved v3 cutover.

```bash
jq . apps/pwa/public/cameras/index.json
# {"zoom":11,"generatedAt":"2026-08-26T20:00:10.314Z",
#  "source":"OpenStreetMap via Overpass — man_made=surveillance + surveillance:type=ALPR",
#  "attribution":"Map data © OpenStreetMap contributors","licence":"ODbL-1.0",
#  "cameras":132068, ... "upstream":"2026-08-26T19:00:00Z"}

find apps/pwa/public/cameras/11 -name '*.json' | wc -l      # 8605
```

### 3.2 Check one tile against OSM, by hand

Four cameras, one HTTP request, no API key. This is the whole audit in miniature.

```bash
TILE=apps/pwa/public/cameras/11/606/765.json
ids=$(jq -r '.cameras[].id | sub("^osm:";"")' "$TILE" | paste -sd,)
curl -sS "https://api.openstreetmap.org/api/0.6/nodes.json?nodes=$ids" \
  | jq -c '.elements[] | {id, lat, lon, v: .version, type: .tags["surveillance:type"]}'
```

Output, run 2026-08-29:

```
{"id":13398047427,"lat":41.3255393,"lon":-73.4741440,"v":2,"type":"ALPR"}
{"id":13947741562,"lat":41.3678063,"lon":-73.4744692,"v":1,"type":"ALPR"}
{"id":14000399730,"lat":41.2656003,"lon":-73.4409174,"v":1,"type":"ALPR"}
{"id":14092326301,"lat":41.2660926,"lon":-73.4411749,"v":1,"type":"ALPR"}
```

Now diff it against what this repo ships, at the archive's own 5-decimal
precision:

```bash
TILE=apps/pwa/public/cameras/11/606/765.json
ids=$(jq -r '.cameras[].id | sub("^osm:";"")' "$TILE" | paste -sd,)
curl -sS "https://api.openstreetmap.org/api/0.6/nodes.json?nodes=$ids" > /tmp/upstream.json
jq -s -r '
  (.[0].cameras | map({id: (.id|sub("^osm:";"")), lat, lon})) as $ours
  | (.[1].elements | map({id: (.id|tostring),
                          lat: (.lat*100000|round/100000),
                          lon: (.lon*100000|round/100000),
                          alpr: ((.tags["surveillance:type"] // "" | ascii_upcase)
                                 | . == "ALPR" or . == "ANPR")})) as $theirs
  | $ours[] as $o | ($theirs[] | select(.id == $o.id)) as $t
  | "\($o.id)  ours=\($o.lat),\($o.lon)  osm=\($t.lat),\($t.lon)  match=\($o.lat==$t.lat and $o.lon==$t.lon)  alpr=\($t.alpr)"
' "$TILE" /tmp/upstream.json
```

```
13398047427  ours=41.32554,-73.47414  osm=41.32554,-73.47414  match=true  alpr=true
13947741562  ours=41.36781,-73.47447  osm=41.36781,-73.47447  match=true  alpr=true
14000399730  ours=41.2656,-73.44092   osm=41.2656,-73.44092   match=true  alpr=true
14092326301  ours=41.26609,-73.44117  osm=41.26609,-73.44117  match=true  alpr=true
```

### 3.3 Check a random sample of the whole archive

One tile is a convenience sample and proves almost nothing. Draw a real one.

**Two traps before you copy this block.** First, `find | xargs -0 cat` does not
emit records in a stable order — three runs on an unchanged tree give three
different `md5sum`s and the same `sort | md5sum`. `shuf --random-source` draws
off *order*, so a seed alone buys you nothing; you must `sort` the flat file
first or the draw is not reproducible. Second, the OSM node endpoint takes ids
in a URI, and 500 ids is already near the practical limit — batch at **400** and
sum the batches rather than asking for one enormous call.

```bash
# Every record in the archive, flattened and SORTED so the draw is repeatable.
find apps/pwa/public/cameras/11 -name '*.json' -print0 | xargs -0 cat \
  | jq -c '.cameras[] | {id: (.id|sub("^osm:";"")), lat, lon}' \
  | sort > /tmp/all.ndjson
wc -l /tmp/all.ndjson                                    # 132068
md5sum /tmp/all.ndjson                                   # stable across runs

# A genuinely reproducible draw. Drop --random-source for a fresh one.
shuf -n 1400 --random-source=<(yes 42) /tmp/all.ndjson > /tmp/sample.ndjson

# Four batches of 400 (the last is 200), summed.
split -l 400 /tmp/sample.ndjson /tmp/batch.
for b in /tmp/batch.*; do
  ids=$(jq -r .id "$b" | paste -sd,)
  curl -sS "https://api.openstreetmap.org/api/0.6/nodes.json?nodes=$ids" \
    | jq -c '.elements[]' >> /tmp/upstream.ndjson
done

jq -s -r '
  (.[1] | map({key:(.id|tostring), value:{
      visible: (.visible != false),
      lat:(if .lat == null then null else (.lat*100000|round/100000) end),
      lon:(if .lon == null then null else (.lon*100000|round/100000) end),
      alpr:(.tags["surveillance:type"]=="ALPR")}}) | from_entries) as $t
  | [ .[0][] | . as $o | ($t[$o.id] // null) as $u
      | { found: ($u != null),
          deleted: ($u != null and ($u.visible|not)),
          match: ($u != null and $u.visible and $u.lat == $o.lat and $u.lon == $o.lon),
          alpr:  ($u != null and $u.visible and $u.alpr) } ]
  | { n: length,
      not_found_at_all: (map(select(.found|not))|length),
      deleted_upstream: (map(select(.deleted))|length),
      live_upstream:    (map(select(.found and (.deleted|not)))|length),
      coord_match:      (map(select(.match))|length),
      still_alpr:       (map(select(.alpr))|length) }
' <(jq -s . /tmp/sample.ndjson) <(jq -s . /tmp/upstream.ndjson)
```

Result on this tree, seed 42, sorted draw, 2026-08-29:

```json
{ "n": 1400, "not_found_at_all": 0, "deleted_upstream": 17,
  "live_upstream": 1383, "coord_match": 1370, "still_alpr": 1381 }
```

Read that honestly, because it says three different things:

- **Nothing is fabricated.** 1400/1400 ids exist as real OSM nodes. Not one
  invented camera in the sample.
- **Two records were stale in that legacy snapshot, and that is a real
  finding.** 1,381 of the
  1,383 live nodes are still tagged `surveillance:type=ALPR`; **two are not, and
  still ship as ALPR.** A concrete instance: node **`13992730803`** is live
  upstream and now carries `surveillance:type=camera` (with
  `manufacturer=Flock Safety`, `surveillance:zone=traffic`) — a mapper decided it
  is not a plate reader, and that archive had not caught up. The current patrol
  explicitly emits `osm_untag` for a newer known version that stops qualifying;
  the finding remains evidence about the dated legacy tree, not the current
  rule.
- **1.21% of the sample is deleted upstream, and ~0.9% has moved.** 17 nodes have
  been *deleted* upstream and still ship in these tiles. 13 of 1,383 differ in
  coordinate; spot-checking those, most are sub-metre rounding and a minority are
  real mapper repositionings — the two largest seen were **6 m** and **22 m**.

Do not treat any single draw as the number. Re-run it; the archive and upstream
both move. What should be stable is the *shape* of the answer: zero fabricated,
low single-digit percentages stale.

The sample's staleness had a cause, but the old checked-in state was itself
misleading:

```bash
# Historical audit state (not the live operational watermark):
# lastAppliedSeq       122263
# exact state timestamp 2026-08-24T14:00:00.000Z
# versionsKnown        false
```

Sequence 122263's upstream state is **2026-08-24 14:00Z**, five days before this
measurement. The former `2026-08-22` value paired to that sequence was wrong;
an audit must not trust an unverified timestamp merely because it is in a JSON
state file. `versionsKnown: false` means the replay guard was running degraded,
which
[`DATA-PROVENANCE.md` §6.5](./DATA-PROVENANCE.md#65-the-legacy-seed-is-degraded-and-cannot-masquerade-as-an-approved-generation)
already says in those words. A camera the app still shows may have been removed
from OSM several days earlier. **For a driver that failure is conservative** — you are
warned about a camera that is no longer there — but it is a failure, and if you
are using this archive as a *dataset* rather than as a warning, it is the number
you need.

For scheduled operation, neither the checked-in archive nor
`scripts/camera-sync-state.json` is the live watermark. Hydrate the
pointer-selected R2 generation to an explicit state path, then inspect that
state. Its four continuity fields must equal the `replication` object in the
manifest whose bytes and generation are bound by `__camera/current.json`. Its
full `basePointer` must equal that hydrated pointer exactly, and a post-sync
state must preserve the same `basePointer` while advancing only replication and
diagnostic fields.

Rebuilding the whole thing from upstream, and 30-odd more commands that measure
every number in the provenance document, are in
[`DATA-PROVENANCE.md` §7 and §8](./DATA-PROVENANCE.md#7-rebuild-it-from-scratch).

### 3.4 Check for things that should not be in there

```bash
cd apps/pwa/public/cameras

# Every field name that exists anywhere in the archive.
find 11 -name '*.json' -print0 | xargs -0 cat | jq -r '.cameras[]|keys[]' | sort -u
# -> no user, no uid, no changeset, no plate: OSM contributor identity is dropped

# Email addresses in mapper-written tags.
find 11 -name '*.json' -print0 | xargs -0 cat \
  | jq -r '.cameras[].tags // {} | to_entries[] | .value' \
  | grep -Ei '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[a-z]{2,}' | wc -l      # 0

# Historical tiles missing the attribution or licence identifier.
find 11 -name '*.json' -print0 | xargs -0 cat \
  | jq -r 'select(.attribution != "Map data © OpenStreetMap contributors"
                  or .licence != "ODbL-1.0") | "\(.x)/\(.y)"' | wc -l   # 0

# The legacy checked-in tiles predate the now-mandatory in-body URI.
find 11 -name '*.json' -print0 | xargs -0 cat \
  | jq -r 'select(.licenceUrl !=
      "https://opendatacommons.org/licenses/odbl/1-0/") | "\(.x)/\(.y)"' \
  | wc -l                                                        # 8802
```

Historical source snapshots were **not** clean: older `tombstones.json` omitted
the notice, older `counties.json` / `places.json` omitted `licence`, and the
checked-in source snapshot currently lacks the two gazetteers. The R2 generation
validator now requires all six sidecars and their notices, so none of those
deficient shapes can hydrate or publish. This remains item 10 in
[`DATA-PROVENANCE.md` §9](./DATA-PROVENANCE.md#9-known-gaps) until the reviewed
bootstrap source is regenerated.

---

## 4. "Evidence records are independently verifiable"

A report you file is signed on the device and chained to the report before it.
The claim is that **anybody** can verify one — without this app, without the
device, without the signing key, in any language.

Test that claim the only way that means anything: **write your own verifier from
the specification and see whether it agrees.** The specification is
[`DATA-CONTRACTS.md` §1 and §2](./DATA-CONTRACTS.md#1-fwm-canonical-jsonv1--canonicalisation)
— canonical JSON in six rules, two hashes, one signature.

### 4.1 A working independent verifier

The following is a complete verifier in Node's standard library. It imports
**nothing** from this repository. It was written from the prose in
`DATA-CONTRACTS.md` and then run against the worked example in §2.8 of that
document; both the transcript and the tamper cases below are real output.

Save as `verify.mjs`:

```javascript
// Independent DarkRoute evidence verifier. Node >= 18, no dependencies,
// nothing imported from the repo. Written from docs/public/DATA-CONTRACTS.md.
import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const GENESIS = createHash('sha256')
  .update('flockyswatchingme/evidence-chain/v1/genesis', 'utf8')
  .digest('hex');

// ---- fwm-canonical-json/v1 (DATA-CONTRACTS.md §1) -------------------------
const ESC = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\t': '\\t',
              '\n': '\\n', '\f': '\\f', '\r': '\\r' };

function str(s) {
  const n = s.normalize('NFC');
  let out = '"';
  for (const ch of n) {
    const c = ch.codePointAt(0);
    if (c >= 0xd800 && c <= 0xdfff) throw new Error('lone surrogate');
    if (ESC[ch]) out += ESC[ch];
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

function num(v) {
  if (!Number.isFinite(v)) throw new Error('non-finite number');
  if (Object.is(v, -0)) return '0';
  if (Number.isInteger(v)) {
    if (Math.abs(v) > Number.MAX_SAFE_INTEGER) throw new Error('integer too large');
    return String(v);
  }
  if (Math.abs(v) >= 1e15) throw new Error('number out of range');
  return v.toFixed(9);            // EXACTLY 9 fractional digits. Rule 5.
}

function canon(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'string') return str(v);
  if (Array.isArray(v)) return '[' + v.map((e) => {
    if (e === undefined) throw new Error('undefined in array');
    return canon(e);
  }).join(',') + ']';
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error('not a plain object');
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).map((k) => k.normalize('NFC'));
    if (new Set(keys).size !== keys.length) throw new Error('NFC key collision');
    // UTF-8 BYTE order, not JavaScript's UTF-16 default. Rule 3.
    keys.sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
    return '{' + keys.map((k) => str(k) + ':' + canon(v[k])).join(',') + '}';
  }
  throw new Error('unsupported type: ' + typeof v);
}

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');
const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---- verification (DATA-CONTRACTS.md §2.9) --------------------------------
const CAPTURED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function verifyRecord(r, expectedPrev) {
  const fail = (code) => ({ ok: false, code, reportId: r.reportId });
  if (r.schema !== 'fwm-evidence/v1') return fail('wrong-schema');
  if (!CAPTURED_AT.test(r.capturedAt)) return fail('malformed-record');
  if (!REPORT_ID.test(r.reportId)) return fail('malformed-record');
  if (r.previousChainHash !== expectedPrev) {
    return fail(expectedPrev === GENESIS ? 'bad-genesis' : 'broken-link');
  }
  if (sha256hex(Buffer.from(canon(r.payload), 'utf8')) !== r.payloadHash) {
    return fail('payload-hash-mismatch');
  }
  const preimage = Buffer.concat([
    Buffer.from(r.previousChainHash, 'hex'),   // 32
    Buffer.from(r.payloadHash, 'hex'),         // 32
    Buffer.from(r.capturedAt, 'utf8'),         // 24
    Buffer.from(r.reportId, 'utf8'),           // 36
  ]);
  if (preimage.length !== 124) return fail('malformed-record');
  if (sha256hex(preimage) !== r.chainHash) return fail('chain-hash-mismatch');

  const spki = b64url(r.publicKeySpki);
  if (sha256hex(spki) !== r.publicKeyId) return fail('public-key-id-mismatch');
  const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const sig = b64url(r.signature);
  if (sig.length !== 64) return fail('bad-signature');
  const ok = nodeVerify('sha256', Buffer.from(r.chainHash, 'hex'),
                        { key, dsaEncoding: 'ieee-p1363' }, sig);
  return ok ? { ok: true } : fail('bad-signature');
}

function verifyChain(records, startingChainHash = GENESIS) {
  let expected = startingChainHash;
  let previousCapturedAt = null;
  const seen = new Set();
  for (const [i, r] of records.entries()) {
    if (seen.has(r.reportId)) return { ok: false, index: i, code: 'duplicate-report-id' };
    seen.add(r.reportId);
    if (previousCapturedAt !== null && r.capturedAt < previousCapturedAt) {
      return { ok: false, index: i, code: 'out-of-order-timestamp' };
    }
    const res = verifyRecord(r, expected);
    if (!res.ok) return { ok: false, index: i, ...res };
    expected = r.chainHash;
    previousCapturedAt = r.capturedAt;
  }
  return { ok: true, count: records.length, headChainHash: expected };
}

// ---- entry point ----------------------------------------------------------
const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const records = doc.records ?? (Array.isArray(doc) ? doc : [doc]);
const runs = doc.runs ?? [{ first_index: 0, count: records.length,
                            starting_chain_hash: doc.starting_chain_hash ?? GENESIS }];
console.log('genesis  ', GENESIS);
for (const run of runs) {
  const slice = records.slice(run.first_index, run.first_index + run.count);
  console.log(JSON.stringify(verifyChain(slice, run.starting_chain_hash)));
}
```

### 4.2 Run it against the published example

Copy the record in
[`DATA-CONTRACTS.md` §2.8](./DATA-CONTRACTS.md#28-a-complete-real-verifiable-record)
into `rec.json` and run:

```bash
node verify.mjs rec.json
```

```
genesis   066d33d6ca5f6ab67be623a05347a67090727da9298d92261592341685b8e0f0
{"ok":true,"count":1,"headChainHash":"1dc24d48129db40817135c96a3e27f3c84585ba27ee223712a71929f122d1a9b"}
```

That transcript is doing four independent things at once, and each is worth
noticing separately:

1. The genesis constant is reproduced from its published preimage —
   `SHA-256("flockyswatchingme/evidence-chain/v1/genesis")` — not copied.
2. `payloadHash` was recomputed by canonicalising the payload from scratch. If
   the canonical-JSON rules in `DATA-CONTRACTS.md` were wrong or incomplete,
   this step would fail, and it is the step most likely to.
3. `chainHash` was recomputed from the 124-byte preimage.
4. The ECDSA P-256 signature verified against a public key derived from the
   record's own `publicKeySpki`, whose SHA-256 was checked against the claimed
   `publicKeyId` first.

**Note what was not needed: the app, the device, or the private key.** Every
record carries the public key that signed it, so a chain stays checkable after
an install is wiped.

### 4.3 Confirm it actually detects tampering

A verifier that says `ok` is worthless until you have watched it say `not ok`.

```bash
jq '.payload.subject_position.lat = 39.5'  rec.json > t1.json && node verify.mjs t1.json
jq '.chainHash = ("0" * 64)'                rec.json > t2.json && node verify.mjs t2.json
jq '.publicKeySpki |= (.[0:40] + "qqqq" + .[44:])' rec.json > t3.json && node verify.mjs t3.json
```

```
{"ok":false,"index":0,"code":"payload-hash-mismatch", ...}
{"ok":false,"index":0,"code":"chain-hash-mismatch",   ...}
{"ok":false,"index":0,"code":"public-key-id-mismatch",...}
```

### 4.4 Verify a real export from a real device

**DEAD DROP → EXPORT JSON** writes `fwm-evidence-export/v1`: the records
verbatim, each carrying its own public key, serialised as canonical JSON so two
exports of the same queue are byte-identical. Feed the file straight to
`verify.mjs` — it handles the `runs` array, which exists because a purge of
synced bodies can leave a legitimate hole in the middle of a chain.

Then compare against the app's own implementation, which should agree:

```bash
pnpm --filter @fwm/pwa exec vitest run \
  src/services/crypto/chain.test.ts \
  src/services/crypto/canonicalize.test.ts \
  src/features/dead-drop/evidenceExport.test.ts \
  src/features/dead-drop/deadDropQueue.test.ts
```

`deadDropQueue.test.ts` is the one to read: it files drops through the real
repositories with real ECDSA signatures and then *attacks* them the way a
tampered store would, rather than asserting against a hand-written table.

### 4.5 What the signature does and does not prove

State this to yourself before relying on it. A valid chain proves the records
were signed by one key, in that order, and have not been altered since. It does
**not** prove the camera exists, that the coordinate is right, or that the
person filing was where they said. It is an integrity and ordering proof, not a
truth proof. The section that says this at length is
[`THREAT-MODEL.md` §2](./THREAT-MODEL.md).

---

## 5. The gates, and what each one actually proves

Every one of these is invoked by `pnpm lint`, `pnpm test` or CI
(`.github/workflows/ci.yml`). All exist in `package.json` — nothing below is
aspirational.

| Command | What it runs | What it proves | What it does **not** prove |
|---|---|---|---|
| `pnpm test` | `pnpm -r test:unit` + `test:scripts` + `test:functions` | 2,947 assertions hold, including every enforcement test in §6 | that the assertions are the right ones |
| `pnpm test:unit` | vitest in `apps/pwa` and `packages/core`, `node --test scripts/*.test.mjs`, vitest in `functions/` | the pipeline's own safety rules are tested before CI trusts the pipeline | anything about rendering — vitest runs with `css: false` |
| `pnpm typecheck` | `tsc --noEmit` over pwa, core, functions | strict TS, no implicit `any`, no unchecked null | runtime behaviour |
| `pnpm lint` | eslint `--max-warnings=0`, then the four gates below | `no-console` and the `localStorage`/`sessionStorage` ban hold in app source — the two rules that exist for privacy, not style | that a `console.log` behind an inline disable is safe |
| `pnpm check:design` | `scripts/check-design-values.mjs` | **the design-token gate.** 9,023 files scanned; every colour, length, radius, duration and easing curve in app source is a `var(--fwm-*)`. Only `styles/tokens.css` and `tokens.json` may hold a raw value. 20 allowlisted exceptions, each with a written reason in `scripts/design-values-allowlist.json` | that the tokens themselves are right |
| `pnpm check:help` | `scripts/check-help-citations.mjs` | **the citation gate.** Every privacy answer on the in-app HELP screen names the files that make it true, and all 24 citations resolve to files that exist. A renamed file turns the page into decoration; this fails the build instead | that the cited file says what the answer claims |
| `pnpm check:records` | `scripts/check-record-citations.mjs` | **the second citation gate.** All 47 entries in `public/records/counties.json` — public allegations of misconduct against named agencies — carry a FIPS, an agency, a summary, a year, a positive integer incident count, and an `http(s)` source URL with a name. Deliberately does **not** fetch the URLs; a build gate that depends on the live internet fails for reasons unrelated to the change | that the source supports the allegation |
| `pnpm check:assets` | `scripts/check-basemap-assets.mjs` | the offline basemap has all 3 font stacks × 256 ranges and all 5 sprite flavours at 1×/2× — a cold offline install has its typefaces | anything about map rendering |
| `node scripts/check-map-render.mjs` | deployed MapLibre probe | exits nonzero for HTML asset fallbacks, missing style images, unloaded style/source, no rendered roads, or off-origin assets; `--require-cameras` also requires the camera source | camera-data semantic correctness |
| `pnpm build` | `tsc --noEmit && vite build` | the bundle builds from the commit you checked out | that the deployed bundle came from it |

Two commands exist and need something you will not have:

- `pnpm preflight` (`scripts/preflight.mjs`) drives a real browser against a
  **deployed URL** and asserts on pixels — that the dial paints, that the scan
  beam actually moves between two captures a beat apart, that nothing hides
  under the dock. It exists because three outages shipped green through the
  whole suite above. Point it at your own `pnpm preview` if you want:
  `node scripts/preflight.mjs http://localhost:5173`.
- `pnpm ship` / `ship:verify` need `CLOUDFLARE_API_TOKEN` and refuse without it.

And one that currently runs nothing: **`pnpm test:e2e`** invokes Playwright
against `testDir: './e2e'`, and `apps/pwa/e2e/` does not exist in this tree.
The script is real; the suite is not written yet. Do not count it.

---

## 6. The enforcement tests that pin the privacy properties

These are the unusual ones. Most of a test suite checks that a thing works;
these check that a thing **has not been added**. They are written as refusals
because the failure they guard against is not a crash — it is a one-line change
that looks like an improvement, works perfectly, and quietly makes a promise on
a screen false.

Read them. They are also, in practice, the clearest documentation of what this
project thinks the dangerous edges are.

### `apps/pwa/src/features/node/mesh.privacy.test.ts` — the radio never volunteers

263 lines guarding the claim that the NODE screen listens rather than transmits.
It reads **every source file** in `features/node` *and* `features/mesh`, because
guarding one module is not a guard: the connection is built in `mesh.ts` but the
screen holds the session, so a send added in a component would sail past a
check scoped to one file.

| It catches | Because |
|---|---|
| `sendPacket(` anywhere | the raw escape hatch; anything reachable through it bypasses every other gate |
| `sendWaypoint(` | puts a **coordinate** on the air |
| `requestPosition(` | asks another node for **its** coordinates |
| `traceRoute(`, `deleteMyNode(`, `factoryReset(`, `setModuleConfig(` | make every node on a path log the request; wipe a radio's database; destroy the owner's keypair; or enable MQTT/Serial bridges that publish traffic off the mesh entirely |
| `latitudeI`, `longitudeI`, `onPositionPacket`, `onWaypointPacket` | a driver's position must never reach the radio, in any field |
| a **second call site** for `sendText`, `setChannel`, `setOwner`, `setConfig` | these four are allowed, but only from `mesh.ts`. A second caller is how a button-press action becomes something a timer or a retry can do by itself |
| `setChannel` inside `setInterval`/`setTimeout`/`.subscribe(` | it inspects the 600 characters before the call. Joining a group must need a press |
| any `set(Interval\|Timeout)(…send` pattern | every transmission is a person deciding to transmit |
| deleting `MeshConversations.tsx` without moving the check | the scope assertion names current files on purpose, so shrinking what is audited fails loudly |

`sighting.ts` is exempt and says why: it is a pure codec, holds no connection,
and encoding bytes is not transmitting them. **If you disagree with that
exemption, that is a legitimate finding** — the argument is in the file header
and you are entitled to reject it.

### `apps/pwa/src/stores/persist.test.ts` — the persistence boundary refuses

194 lines, and the interesting assertion is always that something did **not**
happen. Two of eleven store slices may survive a reload; the rest are memory by
decision, not oversight.

| It catches | Notes |
|---|---|
| a plate-shaped string anywhere in a persisted value | including nested in arrays and objects |
| a plate-shaped **key**, which a value-only walk would miss | `{ reads: { HVK8842: 73 } }` throws |
| a field whose **name** implies plate custody, however empty | `watchlist: []` throws. The *shape* must not exist, not merely today's contents |
| an exemption used out of position | `mutedCameras` may hold camera-id keys; the identical string anywhere else throws. A camera id and a plate are structurally identical, so the exemption is positional |
| a UUID outside `sessionId` | and `sessionId` still cannot carry free text |
| a `Map` or `Set` reaching the serializer | JSON would silently flatten them to `{}` |
| the error message echoing the secret | the exception carries `$.handle`, never the value. An exception message is a log line waiting to happen |
| a **tampered stored blob** on hydrate | a plate written behind the guard's back by devtools or a profile sync is refused, dropped, and does not throw |
| a store taking zustand's default storage | the default port is explicitly **non-durable** and says so, so a store that was never given a durable port reports that rather than pretending it saved |

### `apps/pwa/src/features/settings/removal.test.ts` — the button empties what it says

274 lines that **do not mock the database**. They seed real rows through the real
repositories, run the real removal, reopen the database and count.

Catches: plate ciphertext or the match index surviving; trips or alerts
surviving; **the vault key surviving the ciphertext** (ciphertext without a key
is not the same as no ciphertext, and the test destroys both); a second press
throwing instead of reporting zeroes; the removal reporting reassurance instead
of counts; the removal deleting things it promised to keep — **signed evidence
stays**, so does the public camera cache and non-secret settings; and a platform
with no IndexedDB claiming a successful wipe rather than saying nothing was ever
stored.

### `apps/pwa/src/services/privacy/forget.test.ts` — and it leaves nothing decryptable

The companion at the crypto layer. Catches ciphertext outliving its key,
anything remaining decryptable afterwards, a key-store failure being reported as
a clean wipe, and — deliberately — confirms that signed evidence is **kept** and
the report says so.

### `apps/pwa/src/features/report/osmEligibility.test.ts` — what may reach OpenStreetMap

135 lines, every one asserting that something is **not** publishable. The
asymmetry is stated in the header and is correct: wrongly refusing a report
leaves a camera unmapped for a while; wrongly accepting one files a false record
under a named human's real account, at a coordinate that says where their car
was, in a database mirrored worldwide within the hour.

Each refusal corresponds to a defect that actually occurred here:

| It catches | The defect behind it |
|---|---|
| the **observer** position being published as the camera's | `fwm-report/v1` stored one coordinate from `useCurrentFix()` and called it `position`. Readers treated it as the camera's. It was the driver's. The test asserts `osmNodePosition` *never* falls back to the observer — "the single most consequential line in this feature", invisible in code review, and it would file every camera in a traffic lane |
| a v1 record reaching the publisher at all | `legacy-schema` |
| a missing camera position being passed quietly | `no-subject-position`; null must stay null |
| coordinates that are not coordinates | lat 91, lon 181, `NaN`, an array, a string |
| **a report filed from inside the demo drive** | `demo-origin`. `demoDrive.ts` writes fabricated Michigan Avenue coordinates through the real position store at `accuracyM: 4`, and its control mounts unconditionally in production Settings. Every other signal says the record is excellent; only the capture-time flag knows |

### The other refusal tests worth reading

| File | What it pins |
|---|---|
| `features/report/demoGuard.test.ts` | the same demo problem from the submit side, so the sheet says *why* rather than just failing |
| `features/lookup/LookupScreen.source.test.ts` | LOOKUP **links**, never queries. haveibeenflocked.com publishes `Allow: /` and `Disallow: /api/`; linking needs nobody's permission and calling their endpoint is refused in machine-readable terms. Also: a plate must never travel in a URL, because that is a plate in a browser history, a referrer header and a server log. The hand-off is the clipboard |
| `features/lookup/LookupV1Screen.source.test.ts` | v1's screen paints a `LOCAL` badge. This is what makes that true. It strips comments before scanning, so a file may *name* the thing it promises not to do |
| `services/db/publishHold.test.ts` | the publish hold lives on `publishableAt`, a field the transport does not own and cannot write. Stored on `nextAttemptAt` it would be destroyed by the first 429 — turning a jitter measured in days into a backoff measured in seconds, silently, in the error path |
| `services/crypto/canonicalize.test.ts`, `chain.test.ts` | the byte-level contract §4 depends on |
| `scripts/sync-cameras.test.mjs` | guarded explicit target/state paths, circuit breakers that do not advance state, exact `basePointer` preservation, coherent bounded intermediates, and bootstrap `--require-caught-up` |
| `scripts/camera-generation.test.mjs` | strict pointer/manifest schemas, all six required sidecars, deterministic identity, sorted inventory, runtime `basePointer`, exact outer/camera/enrichment schemas, and cross-file validation |
| `scripts/camera-integrity.test.mjs`, `scripts/camera-replay.test.mjs`, `scripts/attest-camera-continuity.test.mjs` | canonical semantic core, contiguous official diff identities, receipt-bound baseline input, and independently reproduced final state |
| `scripts/hydrate-cameras.test.mjs`, `scripts/publish-cameras.test.mjs` | pointer-pinned exact restoration; base-pointer admission; the 180-minute lease, 110-minute fence, and three lease checkpoints; candidate → relist → manifest-last → pointer-CAS-last |
| `functions/cameras/[[path]].test.ts` | strict paths, mandatory pointer-selected slots, fixed header allowlist, generation headers, tile-only `404`, and fail-closed `503` for pointer or required-sidecar failure |

---

## 7. Where to look if you think this project is lying

Ranked by leverage. These are the files where a lie would be smallest, most
plausible, and hardest to spot.

1. **`apps/pwa/src/services/cameras/sync.ts`** — the only code that regularly
   contacts a server while you drive. If a coordinate were ever going to be
   exfiltrated, it would be here, as one extra query parameter on a tile URL.
   Read `guardedFetch(url, doFetch)` at `:156` and check what `url` is built
   from. It should be `${TILE_BASE}/${z}/${x}/${y}.json` and nothing else.

2. **`apps/pwa/src/stores/persist.ts`** — the guard *itself*. Every privacy
   claim about storage routes through `assertPersistSafe`. A weakened predicate
   here silently unlocks everything downstream, and the test file would still
   pass if the exemption list grew. Read `FORBIDDEN_FIELDS` and the positional
   exemptions, and ask what a new entry would let through.

3. **`apps/pwa/src/services/adapters/navigateTo.ts:82-127`** — where a coordinate
   legitimately becomes a local `geo:` URI. Confirm that no HTTPS fallback has
   appeared, that iOS returns `unavailable` before the opener runs, and that the
   shipped v1 Drive and Intel controls remain gated by `canUseGeoHandoff()`.

4. **`apps/pwa/src/services/crypto/keys.ts`** — `extractable: false` on the
   generated keys is what makes "the key never leaves" mechanical rather than
   promised. `subtle.generateKey(SIGNING_ALGORITHM, false, [...])` at `:424`;
   the vault and index keys at `:392` and `:396`. A `true` there is a one-word
   change with no visible symptom.

5. **`apps/pwa/vite.config.ts`** — the service-worker `runtimeCaching` rules.
   The worker sees every request. A route added here can cache, and therefore
   observe, things the app never fetches directly. The current list is limited
   to navigations and same-origin `/cameras/`; fonts are self-hosted and have no
   runtime route.

6. **`functions/`** — the whole deployed server surface.
   `functions/_shared/access.ts` verifies the Cloudflare Access JWT against the
   team JWKS with an `aud` check; the two the administrative Functions (not distributed) handlers use it,
   while the public `functions/cameras/[[path]].ts` route has no identity check.
   Confirm that the camera handler still accepts only named sidecars and
   in-range z11 paths, reads `__camera/current.json` on every request, follows
   only the selected slot, returns `503` for an absent/malformed/unreadable
   pointer or a missing required sidecar, and returns `404` only for a missing
   canonical tile. Confirm its successful headers remain limited to JSON type,
   cache policy, ETag, and generation. If anything logs a request path against
   an identity, it would be here.

7. **`eslint.config.js`** — the `no-console` and `no-restricted-globals` blocks
   are labelled `PRIVACY INVARIANT`. Check they still apply to
   `apps/pwa/src/**` and `packages/*/src/**`, and grep for how many inline
   disables have accumulated: `rg -n 'eslint-disable.*no-console' apps/pwa/src`.

8. **`scripts/design-values-allowlist.json`** — 20 entries, each with a written
   reason. This is the file that decays: an allowlist is where a gate goes to
   die, one plausible exception at a time.

9. **`scripts/check-help-citations.mjs` vs `features/help/answers.ts`** — the
   gate proves the cited files *exist*. It cannot prove they *say* what the
   answer claims. Pick three answers on the HELP screen and read their citations
   yourself; that is the check no script performs.

10. **For post-release changes, `git log --follow` on any of the above.** Those
    public commit messages explain the failure a change prevents, in prose, at
    length. The squashed release root has no earlier public history; for code in
    it, the module headers, tests, and documents are the available design
    record. A later change that weakens a guard with a short message is worth
    asking about.

---

## 8. What this audit found and has not fixed

Written down because a transparency document that reports only clean results is
a marketing document.

### 8.1 Historical audit finding: the archive was five days stale and ~1.2% was deleted upstream

Measured in §3.3 over a reproducible 1,400-record draw: **17** records have been
deleted from OSM and still ship, and **2** are live upstream but no longer
tagged `surveillance:type=ALPR` and still ship as ALPR (e.g. node
`13992730803`, now `surveillance:type=camera`). The sampled bootstrap sequence
was 122263, whose exact upstream timestamp is `2026-08-24T14:00:00.000Z`,
against a measurement date of 2026-08-29. The earlier audit's August 22
timestamp was not consistent with that sequence.

Two separate defects produced that measurement. The deletion backlog was the
patrol falling behind. The retagged nodes exposed a missing rule in that legacy
implementation. The current patrol now tombstones a newer known version that is
deleted, stops qualifying, or moves outside the strict territory, and its tests
cover all three. The tracked archive itself is deliberately not rounded up to a
fixed/current result: `versionsKnown: false` in the sampled state means its
replay guard was degraded. Only an approved, caught-up R2 generation can make
the stronger current claim.

### 8.2 Resolved: shipped licence copy now says GPL-3.0-only

```bash
rg -n "MIT licensed" apps/pwa/src   # expect no matches
head -3 LICENSE          # GNU GENERAL PUBLIC LICENSE Version 3
jq -r .license package.json   # GPL-3.0-only
```

The string now reads `no account · no analytics · GPL-3.0-only source` in both
onboarding views and the shared `PRIVACY_PROMISES`. The onboarding regression
test pins that exact copy, while `LICENSE`, package manifests, `NOTICE.md`, the
SBOM and the UI agree on GPL-3.0-only. The grep above stays as the negative
check that catches a stale MIT claim returning.

### 8.3 Resolved in the generation contract: every camera body carries the OSM/ODbL notice and URI

`index.json`, `overview.json`, `tombstones.json`, `counties.json`, and
`places.json` must each carry `Map data © OpenStreetMap contributors` and
`ODbL-1.0` plus
`https://opendatacommons.org/licenses/odbl/1-0/`. Every tile must carry the same
three fields. Deep camera generation validation rejects a missing or changed
notice, and publication forces that strict mode. Historical
`versionsKnown:false` generations may omit only the URI while being hydrated to
capture cutover evidence; they remain audit/predecessor material, not
publishable candidates. Command and expected output are in §3.4.

### 8.4 Resolved: pre-rename virtual environments cannot enter lint or a commit

Both `.gitignore` and `eslint.config.js` now match `.venv*/`, so the old
`.venv-flockys-the operator tooling` artifact and any contributor-created virtual
environment are excluded. The current installer is Node-only and creates none.

### 8.5 The browser suite is deliberately narrow

`pnpm test:e2e` runs `apps/pwa/e2e/preparePhoto.spec.ts` in Chromium. It proves
that a real canvas re-encode strips EXIF/GPS metadata and preserves orientation;
it is not broad end-to-end coverage of the application.

### 8.6 The gaps the project already publishes about itself

None of these were found by this audit; they were already written down, which is
the point of listing them here.

- [`ARCHITECTURE.md` §8](./ARCHITECTURE.md) — an index of dead ends: paths that
  are built, tested and connected to nothing. `buildKml` has no caller.
- [`DATA-PROVENANCE.md` §9](./DATA-PROVENANCE.md#9-known-gaps) — eleven numbered
  gaps, including `ownerType` being a regex guess over free text on 82% of the
  archive *while driving an alert filter*, and 6,194 records showing "facing
  unknown" when their own tags carry a bearing.
- [`DATA-CONTRACTS.md` §9](./DATA-CONTRACTS.md#9-known-gaps-and-divergences) —
  where the implementation and the specification diverge.
- [`THREAT-MODEL.md` §2 and §5](./THREAT-MODEL.md) — what this does not protect
  you from, and the residual risks you accept by using it. Most of that document
  is about what the app cannot do.

---

## 9. Reporting what you find

**A privacy leak is a vulnerability here, not a feature request.** The asset is
the user's movements; anything that causes position, route, viewed cameras or
watchlist contents to leave the device or become inferable counts. The policy,
including the contact address and what to expect, is
[`SECURITY.md`](./SECURITY.md).

If what you found is a **factual error in this document or any other in
`docs/public/`**, that is worth reporting too and can go straight to a public
issue. Every one of these files is written to be checked against the code, and a
claim here that the code contradicts is a bug in the file — the code is right.

If what you received is a **legal demand** about this project, it gets
published: full text, redactions limited to the list in
[`TRANSPARENCY.md` §3](./TRANSPARENCY.md), together with whatever response was
sent, in [`/transparency/`](../../transparency/README.md). Publication is not
conditional on the demand being wrong or on this project winning.

---

## Provenance of this document

Every command in this file was executed against the working tree on
**2026-08-29** before it was written down. The measured numbers in §1, §3.2,
§3.3 and §8 are outputs of the commands printed beside them, not estimates. The
verifier in §4.1 was written from `DATA-CONTRACTS.md` alone and run against the
published example and three tamper cases; the transcripts are its real output.

Where a command's result was unflattering, it is in §8.
