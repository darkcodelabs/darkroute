# API and network surface

Every HTTP endpoint DarkRoute serves, every request the client makes, every
external service the build tooling talks to, and exactly what the service
worker caches.

This document is written to be **checked against the code**. Every claim carries
a `path:line`. If a line number has drifted, the symbol name next to it has not
— search for that. If a claim here disagrees with the code, the code is right and
this file is a bug; please open an issue.

## What this document covers

The **wire**: every URL this project serves, every request the client makes to
anything, every external service the build tooling talks to, and what the
service worker stores. If it crosses a network boundary, it is here.

## What it deliberately does not cover

Each of these is a real subject with a real document; none of them is omitted
because it is inconvenient.

| Not here                                                                                               | Why, and where it is                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Field-level record shapes** — the camera record, the signed report, the Meshtastic protobuf messages | Those are _contracts_, not endpoints, and they change on a different schedule. [`DATA-CONTRACTS.md`](./DATA-CONTRACTS.md). This file names the handful of fields the _network layer_ itself reads, in §3.3, and nothing more                                                                                                                                                             |
| **Where the camera data comes from, and how to rebuild it**                                            | [`DATA-PROVENANCE.md`](./DATA-PROVENANCE.md). §4.1 and §4.2 document the _calls_ the ingest scripts make; the licence, the exact OSM query semantics, and the reproduction steps live there                                                                                                                                                                                              |
| **What we call things, and how to convert this data into yours**                                       | [`TAXONOMY.md`](./TAXONOMY.md)                                                                                                                                                                                                                                                                                                                                                           |
| **What this app protects you from and what it does not**                                               | [`THREAT-MODEL.md`](./THREAT-MODEL.md). This document states _what is sent_; that one states _what an adversary can do with it_                                                                                                                                                                                                                                                          |
| **The commands to verify these claims end to end**                                                     | [`AUDITING.md`](./AUDITING.md). §8 here is a short starter set, not the full battery                                                                                                                                                                                                                                                                                                     |
| **The Meshtastic wire protocol**                                                                       | Upstream, in the `@meshtastic/js` and `meshtastic/protobufs` projects. §2.5 documents that the link exists, what may travel over it, and what may not                                                                                                                                                                                                                                    |
| **The IndexedDB schema**                                                                               | `apps/pwa/src/services/db/schema.ts`. It never crosses a network boundary, which is the entire point of it                                                                                                                                                                                                                                                                               |
| **UI behaviour, screens, and copy**                                                                    | Not a network surface                                                                                                                                                                                                                                                                                                                                                                    |
| **The Android wrapper**                                                                                | `apps/android/` is a TWA around this same PWA. It makes no requests of its own                                                                                                                                                                                                                                                                                                           |
| **The undeployed submission gateway and curation platform**                                            | A tested Pages-compatible report handler exists as operator code, but no route under `functions/` exposes it and the PWA has no caller. The curation tooling operates a separately deployed platform. Neither is distributed here and neither is a live app endpoint |

---

## 0. The one-paragraph summary

The deployed app is a static bundle plus three Cloudflare Pages Functions: one
serves camera tiles out of R2 and two manage the Cloudflare Access tester
allowlist on the private dev host. None accepts a report or driver position.
Tile addresses are computed on the device and a z11 tile is roughly 15 km
across. Reports, plates, watchlists and alert history never leave the shipped
client because it has no report transport and no deployed upload route. A
a tested future handler exists as operator code; it is not a Function.

There is no `wrangler.toml`, `_routes.json` or `_redirects` in this repo.
`apps/pwa/public/_headers` defines the static-response security policy and is
copied into the build. Routing otherwise uses Cloudflare Pages' default: files
under `apps/pwa/public/` are static assets, and anything under `functions/`
shadows the matching asset path.

The operator tooling contains curation declarations and Node scripts, plus the
undeployed TypeScript gateway described above. `packages/api-client` remains a
deliberate placeholder that exports one boolean
(`packages/api-client/src/index.ts`) and is imported by nothing.

---

## 1. Cloudflare Functions

Source of truth: everything under `functions/`. There are exactly three route
files and one shared module.

| Route                | Methods                 | File                             | Auth                                                      |
| -------------------- | ----------------------- | -------------------------------- | --------------------------------------------------------- |
| `/cameras/*`         | `GET`                   | `functions/cameras/[[path]].ts`  | Public on production; no in-function identity check       |

A method not exported by a handler file is answered `405` by the Cloudflare Pages
Functions runtime. That is **platform behaviour, not code in this repo** —
`grep -rn 405 functions/` returns nothing outside this sentence's description of
it. Verify it against a deployment, not against the source.

### 1.1 `GET /cameras/*` — camera tile and sidecar proxy

**File:** `functions/cameras/[[path]].ts`
**Handler:** `onRequestGet`

Serves the published camera archive out of an R2 bucket bound to the Pages
project as `CAMERA_TILES`.

**Why it exists at all.** The archive used to be committed to the repo, and a
push to `main` triggers a Pages build — hourly that is ~720 builds a month
against a free-tier ceiling of 500. It also could not simply point at
`tiles.darkroute.ai`, because that would put the tile id — which _is_ the 15 km
square the driver is in — in front of an unauthenticated host on every drive.
Reading through a Function keeps the request on the public app's origin, so a
separate tile operator does not receive that stream of rough locations. This is
a same-origin privacy boundary, not an Access gate. The argument is written out
in full at the top of `functions/cameras/[[path]].ts`.

#### Request

```
GET /cameras/{z}/{x}/{y}.json          the tiles
GET /cameras/index.json                the build manifest
GET /cameras/overview.json             every camera, as a flat coordinate array
GET /cameras/counties.json             county gazetteer
GET /cameras/places.json               place gazetteer
GET /cameras/tombstones.json           the deletion ledger
GET /cameras/continuity.json            independently replayable generation proof
```

The handler does not use a request body, query parameters, or custom request
headers. The logical key is taken from `url.pathname`, not assembled from
`params.path`. Only the six named sidecars above and canonical
`11/{x}/{y}.json` paths with integer coordinates from 0 through 2047 are
accepted. Other zooms, out-of-range coordinates, extra files, traversal syntax,
and noncanonical integer spellings return `400` before R2 data is read.

**Generation selection.** The Function reads `__camera/current.json` on every
request. A valid `darkroute-camera-pointer/v1` object names slot `a`, `b`, or
`c`, a 64-hex generation id, the SHA-256 of that slot's manifest, a nullable
previous generation reference, and a canonical `updatedAt`. Logical key `K`
then reads from `__camera/slots/{slot}/data/K`. Reading the pointer per request
is deliberate: one isolate must not keep serving a slot after the pointer has
changed and that slot later becomes recyclable.

The Function does not fetch the manifest on the read path. Publication and
hydration bind and verify it; the serving path strictly validates the pointer
shape and follows only its slot.

#### Responses

| Status           | Body                            | Headers                                                                                                                                                                 | When                                                                                                   |
| ---------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `200`            | The stored object, verbatim     | `content-type: application/json; charset=utf-8`, `cache-control: public, max-age=3600, must-revalidate`, `etag: <object.httpEtag>`, and `x-darkroute-camera-generation` | Object found                                                                                           |
| `400`            | `bad tile` (text)               | none set                                                                                                                                                                | Path is not one of the six sidecars or a canonical in-range z11 tile                                   |
| `404`            | `null` (four bytes, valid JSON) | `cache-control: public, max-age=3600, must-revalidate`, plus `x-darkroute-camera-generation`                                                                            | A selected z11 tile is absent                                                                          |
| `503`            | `camera archive unavailable`    | `cache-control: no-store`                                                                                                                                               | The pointer is absent, malformed, or unreadable; an object read fails; or a required sidecar is absent |
| _(pass-through)_ | Whatever the static asset is    | Pages' own                                                                                                                                                              | `CAMERA_TILES` is not bound, so `context.next()` preserves rollback to an older static deployment      |

`CACHE_CONTROL` is defined once in `functions/cameras/[[path]].ts`.

**The five behaviours worth understanding, because they are not obvious:**

1. **No binding means get out of the way.** `context.next()` at
   `onRequestGet` hands the request to Pages' static layer. That made the first
   R2 migration compatible with older deployments that still contained camera
   files. Current builds deliberately remove `dist/cameras`, so fall-through is
   not a current availability guarantee; production requires the binding.

2. **A bound bucket is generation-only.** An absent, malformed, or unreadable
   `__camera/current.json` returns `503`. The Function never reads logical key
   `K` from the legacy bucket root, so a broken control plane cannot silently
   select an old archive.

3. **A tile miss is not a pass-through.** A bound-bucket tile miss returns `404` rather
   than falling through, because falling through would
   quietly re-read a stale deployed copy. `404` is also a **cached, normal**
   answer: most of the country is a square with no ALPR in it, and
   `apps/pwa/src/services/cameras/sync.ts:168` reads it as "no cameras here"
   rather than as an error.

4. **The generation is observable, and headers are allowlisted.** Both a hit and
   a tile miss carry `x-darkroute-camera-generation`. The Function emits only
   the JSON content type, cache policy, R2 object ETag, and generation header on
   a hit; arbitrary R2 HTTP metadata does not cross the response boundary.

5. **All six sidecars are required for an approved generation.** A missing z11 tile is an ordinary cached
   `404`; a missing `index.json`, `overview.json`, `tombstones.json`,
   `places.json`, `counties.json`, or `continuity.json` means the selected
   generation is damaged and returns `503` with `no-store`.

**Failure modes.** Missing/invalid pointer state, archive-object R2 failures,
and required-sidecar misses are explicit `503` responses with `no-store`. The
client treats any non-`404` non-`ok` as a tile failure, writes no empty tile,
and retries on the next fix (`apps/pwa/src/services/cameras/sync.ts:169`,
`:221`).

### 1.2 The administrative Functions — not in this distribution

An identity check, a tester allowlist manager and the shared assertion verifier
they both use. They are operator code: they run only on a separate
identity-gated host, they read credentials this deployment does not carry, and
they fail closed without a valid assertion.

They are deliberately not published and not documented here. Nothing a driver
installs calls them, no route in this tree exposes them, and describing which
credential reaches which endpoint would be a map of an administrative surface
for the benefit of nobody who is building or auditing the app.

## 2. Every outbound request the client makes

Grouped by origin. "SW" is the service worker route that handles it — see
[§5](#5-service-worker).

### 2.1 Same origin — the app's own host

| #   | Request                                                      | Made by                                                                         | When                                                                     | SW                                                                                                          | Offline                                                                                                   |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | `GET /cameras/{z}/{x}/{y}.json` (z=11)                       | `apps/pwa/src/services/cameras/sync.ts:155`                                     | On every position fix that moves ≥250 m _or_ crosses a tile boundary     | `StaleWhileRevalidate`, `fwm-camera-tiles-v2`                                                               | IndexedDB is hydrated **first**, so cameras render before the network is tried                            |
| 2   | `GET /cameras/index.json`                                    | `apps/pwa/src/services/cameras/catalogue.ts:59`                                 | Lazily, first time a screen asks for the global camera count             | `StaleWhileRevalidate`, `fwm-camera-tiles-v2`                                                               | Count renders as unknown; nothing breaks                                                                  |
| 3   | `GET /cameras/counties.json`, `GET /cameras/places.json`     | `apps/pwa/src/services/cameras/gazetteer.ts:81`, `:91-94`                       | Lazily, first time a screen needs to name a county or place              | `StaleWhileRevalidate`, `fwm-camera-tiles-v2`                                                               | Names render as absent                                                                                    |
| 4   | `GET /cameras/overview.json`                                 | `apps/pwa/src/features/map/MapCanvas.tsx:387`                                   | Once, when the map zooms out far enough to want the national point cloud | `StaleWhileRevalidate`, `fwm-camera-tiles-v2`                                                               | Throws; the promise is reset so a later zoom retries, and the near-field tiles are untouched (`:403-407`) |
| 5   | `GET /records/counties.json`                                 | `apps/pwa/src/services/records/countyRecords.ts:165`                            | Lazily, first time RADAR or MISUSE needs the documented-misuse index     | **Nothing.** `.json` is not in `globPatterns` and no runtime route matches `/records/` — see the note below | Empty index; the UI renders "nothing documented"                                                          |
| 6   | `GET /api/admin/me`                                          | `apps/pwa/src/features/admin/useAdmin.ts:66`                                    | Once per session, from the app shell                                     | **Nothing.** No runtime route matches, and the navigation fallback is denied every path                     | Rejects; `admin: false, known: true` is published (`:81-85`)                                              |
| 7   | `GET/POST/DELETE /api/admin/testers`                         | `apps/pwa/src/features/admin/AdminScreen.tsx:84`, `:105`, `:121`                | Only from the ADMIN screen, only for an admin                            | none                                                                                                        | "could not reach the server"                                                                              |
| 8   | `GET /basemap-assets/fonts/{fontstack}/{range}.pbf`          | MapLibre, from `GLYPHS_PATH` at `apps/pwa/src/features/map/basemap.ts:155`      | While rendering labels                                                   | `CacheFirst`, `fwm-basemap-assets-v1`; all 256 possible ranges exist for each stack                         | A requested range works offline after its first successful load                                           |
| 9   | `GET /basemap-assets/sprites/{flavor}.json`, `.png`, `@2x.*` | MapLibre, from `spritePath()` at `apps/pwa/src/features/map/basemap.ts:167`     | Style load                                                               | `.png` is precached; `.json` uses `CacheFirst`, `fwm-basemap-assets-v1`                                     | Works after the first successful style load                                                               |
| 10  | `GET /fonts/*.woff2`                                         | `@font-face` in `apps/pwa/src/styles/tokens.css:11+`                            | First paint                                                              | **Precached** (`woff2` in `globPatterns`)                                                                   | Works                                                                                                     |
| 11  | `GET /manifest.webmanifest`                                  | `<link rel="manifest" crossorigin="use-credentials">`, `apps/pwa/index.html:74` | Install / TWA verification                                               | Not matched (`webmanifest` is absent from the shipped `globPatterns`)                                       | n/a                                                                                                       |
| 12  | Navigations (`/`, `/?src=pwa`, …)                            | The browser                                                                     | Every load                                                               | `NetworkFirst`, `fwm-documents`, 3 s timeout                                                                | The last document that loaded is served                                                                   |

> **Note on (5) and the `.json` gap.** The shipped `globPatterns`
> (`workbox.globPatterns` in `apps/pwa/vite.config.ts`) is
> `**/*.{js,css,html,woff2,png,svg}` — no
> `json`. So `/records/counties.json` is neither precached nor runtime-cached.
> The camera JSON is covered by the `/cameras/` route, and same-origin basemap
> glyph/index assets are covered by `/basemap-assets/`. This is stated here
> because the difference matters offline.

**Two requests use the redirect guard; the rest do not.** `guardedFetch`
(`apps/pwa/src/services/access/session.ts:89`) issues the request with
`redirect: 'manual'`, so an unexpected redirect arrives as an
`opaqueredirect` (`type === 'opaqueredirect'`, status 0) rather than being
mistaken for a valid empty tile. On the public production camera route this is
not an authentication step. It also preserves the older private-development
behavior, where an expired Access session redirects. It is used by:

- camera tiles — `apps/pwa/src/services/cameras/sync.ts:156`
- `index.json` — `apps/pwa/src/services/cameras/catalogue.ts:59`

and `isAccessBounce` is applied directly to the `/api/admin/me` response at
`apps/pwa/src/features/admin/useAdmin.ts:71`.

The gazetteer (`gazetteer.ts:81`), the misuse records
(`countyRecords.ts:165`) and `overview.json` (`MapCanvas.tsx:387`) use a plain
`fetch`. On an Access-gated development host, an expired session can therefore
degrade those three silently rather than raising the sign-in banner. That is
not the production camera-data contract.

Detection **never navigates**. It raises a flag; `SignedOutBanner` offers the
door; `goToSignIn()` (`apps/pwa/src/services/access/session.ts:123`) is a plain
`location.reload()`, because the edge already knows where its login lives and
hand-building an Access login URL would be guessing at somebody else's protocol.

**No coordinate is ever sent.** The tile _address_ is computed on the device
(`apps/pwa/src/services/cameras/sync.ts:175`, via `surroundingTiles`) and a z11
tile is ~15 km across. The ring widens with the scope's range —
`ringsForRangeFt` (`apps/pwa/src/services/cameras/sync.ts:136`) — capped at
`MAX_SURROUNDING_RADIUS` = 8, i.e. 17×17 = 289 tiles, ~255 km. It only ever
widens within a session (`:277`).

### 2.2 `https://tiles.darkroute.ai` — the self-hosted map archives

Cross-origin, but an origin the project controls. This is the _only_ third-party
network shape the design permits, and the reasoning is at
`apps/pwa/src/features/map/basemap.ts:1-42`: a third-party tile server sees a
stream of tile coordinates, which _are_ a position, at a resolution that
improves as the driver zooms in. The rule is **self-hosted, or no basemap**.

> **A boundary an auditor should know about.**
>
> Camera tiles are deliberately requested from `/cameras/*` on the app origin.
> The Function's header explains why: serving them from a separate tile origin
> would give that other operator the driver's rough position — the roughly
> 15 km square encoded by the tile id — on every drive. Same-origin does not
> make the request invisible to DarkRoute's own edge and is not an Access gate;
> it avoids adding another observer.
>
> The basemap and speeds archives are read from the separate public
> `tiles.darkroute.ai` host. A PMTiles range request is a byte offset rather than a `z/x/y` path, so
> it is less legible than a tile URL — but it still resolves to specific tiles,
> and the speeds archive is **z14-only**
> (`apps/pwa/src/features/map/speedSource.ts:41`), which is a far finer
> resolution than the 15 km square the camera argument is about. Whoever is in
> front of that origin sees a stream of range reads with an IP and a timestamp.
>
> The host is project-controlled but cross-origin, so this remains a disclosed
> network observation point. It is not evidence that camera requests need an
> authentication gate; those use the app origin to avoid the additional host.

| Request                                                   | Made by                                                                                     | When                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /basemap.json` (`cache: 'no-cache'`)                 | `apps/pwa/src/features/map/manifest.ts:263-267`                                             | Once per map build, with a 2.5 s `AbortController` timeout (`MANIFEST_TIMEOUT_MS`, `:82`) |
| `GET /basemap-us-<date>.pmtiles` with `Range: bytes=0-15` | `archiveExists()`, `apps/pwa/src/features/map/manifest.ts:235-238`                          | Only when the manifest names an archive different from the remembered one                 |
| `GET /basemap-us-<date>.pmtiles`, HTTP range reads        | the `pmtiles` protocol handler, registered at `apps/pwa/src/features/map/MapCanvas.tsx:269` | Continuously, while the map is drawn                                                      |
| `GET /speeds-us-<date>.pmtiles`, HTTP range reads         | `apps/pwa/src/features/map/speedSource.ts` (`new PMTiles(url)`, `waysNear`)                 | One z14 tile per tile crossed, memoised, max 8 cached (`MAX_CACHED_TILES`)                |

Compiled-in defaults, overridable per build:

- `DEFAULT_BASEMAP_URL = 'https://tiles.darkroute.ai/basemap-us-20260820.pmtiles'` — `apps/pwa/src/features/map/basemap.ts:58`
- `DEFAULT_SPEEDS_URL  = 'https://tiles.darkroute.ai/speeds-us-20260820.pmtiles'` — `apps/pwa/src/features/map/basemap.ts:72`
- `basemapUrl(env)` reads `VITE_FWM_BASEMAP_URL`; an explicit **empty** value means "no ground at all" and must not fall through to the default — `apps/pwa/src/features/map/basemap.ts:74-83`

**Why a manifest instead of a fixed filename.** A PMTiles archive is read by
byte offset. Overwrite the file at a URL and every client holding a cached
directory now has offsets into a file that no longer exists — the map does not
error, it draws garbage. So archives are date-stamped and immutable, and a tiny
`basemap.json` at a stable URL says which one is current
(`apps/pwa/src/features/map/manifest.ts:1-46`).

**A manifest may say WHICH archive, never WHOSE.** `isPermittedArchive`
(`apps/pwa/src/features/map/manifest.ts:110`) requires the archive URL to resolve
to the same origin as the manifest. Without it, a manifest naming
`https://someone-else.example/x.pmtiles` would be obeyed and every driver's tile
requests would silently go to a third party.

**Resolution order** (`resolveArchiveUrl`, `apps/pwa/src/features/map/manifest.ts:177`):

1. the manifest, when it answers in time, parses, is same-origin, **and** the
   archive it names answers a 16-byte range read (`:203-207`)
2. the last archive this device used, from `localStorage['fwm.basemap.archive']`
   (`LAST_ARCHIVE_KEY`, `:85`)
3. the URL compiled into the build

(2) outranks (3) because a device that has been running for months has a cached
archive that (3) may no longer name, and switching discards every cached byte —
offline, that is the difference between a map and a black rectangle.

`parseManifest` (`:134`) refuses anything whose `url` does not end in
`.pmtiles`, case-sensitively, because a resolved URL is _remembered_ and one
junk pointer would persistently replace a working fallback.

**Offline:** every one of these fetches can fail freely. The manifest falls back;
the archive reads come out of the browser's HTTP cache; with no archive at all
the map renders `bareStyle` — a painted background and the app's own layers
(`apps/pwa/src/features/map/basemap.ts:250`).

**Service worker:** none of these are matched by any Workbox route. The shipped
`runtimeCaching` in `apps/pwa/vite.config.ts` covers navigations and same-origin
`/cameras/`. PMTiles range requests are left to the browser's own HTTP cache,
which is correct — Workbox would have to cache `Range` responses to help, and
it does not.

### 2.3 Google Fonts — **no longer requested**

`apps/pwa/index.html:84-99` documents the removal: the `<link>` and
`preconnect` to `fonts.googleapis.com` were deleted, both bundled faces are
served from this origin, and the default system face needs no fetch
(`apps/pwa/src/styles/tokens.css:11+`, files in `apps/pwa/public/fonts/`).

No Workbox route admits either Google Fonts origin. The CSP also limits
`font-src` to `'self'`, so both the document and the generated worker agree with
the self-hosting rule.

### 2.4 Outbound _navigations_ — links the driver chooses to follow

These are not fetches. The HTTPS entries use
`window.open(url, '_blank', 'noopener,noreferrer')` or
`<a target="_blank" rel="noopener noreferrer">`, so the destination cannot reach
back through `window.opener` and no referrer records which screen sent them. The
`geo:` entry is a local handoff to the OS-registered map handler.

| Destination                                                        | Built by                                                                                         | Carries                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://haveibeenflocked.com/`                                    | `HIBF_URL`, `apps/pwa/src/features/lookup/handoff.ts:39`; opened at `:94`                        | **Nothing.** The plate goes on the clipboard and the driver pastes it. There is no URL parameter carrying it — a plate in a URL is a plate in a browser history, a referrer header and a server log (`:20-27`)                                                                                           |
| `geo:<lat>,<lon>?q=…`                                              | `geoUrl` / `navigateTo`, `apps/pwa/src/services/adapters/navigateTo.ts:82-127`                   | The destination is handed locally to the OS-registered map handler on supported non-iOS platforms. DarkRoute makes no HTTPS request. On iOS, `navigateTo` returns `unavailable` without opening anything, and the shipped v1 Drive and Intel screens hide their map controls. There is no HTTPS fallback |
| `https://www.openstreetmap.org/edit?editor=id#map=<z>/<lat>/<lon>` | `editorUrl`, `apps/pwa/src/features/report/osmTags.ts:247`                                       | Position only. iD has no supported way to pre-fill tags from a URL, and the paste-a-block workaround is what got DeFlock's preset pulled                                                                                                                                                                 |
| `https://github.com/darkcodelabs/darkroute/...`                    | `REPO_URL` / `docUrl()` / `commitUrl()`, `apps/pwa/src/features/docs/docs.ts:44`, `:120`, `:131` | Nothing                                                                                                                                                                                                                                                                                                  |
| Each misuse record's `sourceUrl`                                   | `apps/pwa/src/features/misuse/MisuseScreen.tsx:248`                                              | Nothing                                                                                                                                                                                                                                                                                                  |

### 2.5 Web Bluetooth — the Meshtastic link

Not HTTP, but it is a network surface and belongs in an audit.

`connectMesh()` (`apps/pwa/src/features/node/mesh.ts:463`) lazily imports
`@meshtastic/js` and `@bufbuild/protobuf` (`:491-492`) and opens a
`BleConnection` (`:493`) to a Meshtastic node the user picks from the OS
chooser. `requestDevice` requires a user gesture (`:384`).

- **Lazy on purpose:** the alert path must never wait on a chunk, and a protobuf
  runtime is of no use to a driver being warned about a camera (`:23-27`).
- **This file is why the project is GPL-3.0.** `@meshtastic/js` is GPL-3.0-only;
  linking it makes the combined work GPL-3.0 (`:1-12`, and `NOTICE.md`).
- **What may travel:** a _camera's_ position may — it is public, already in
  OpenStreetMap, and not about anybody. **The driver's position never does**
  (`apps/pwa/src/features/node/mesh.ts:29-35`). Enforced by a test,
  `apps/pwa/src/features/node/mesh.privacy.test.ts`.
- `reconnectSupport()` (`:418`) and `grantedNodeCount()` (`:449`) call
  `navigator.bluetooth.getDevices()`, which lists devices this origin has
  already been granted. Both swallow failures.
- Web Serial is **not** used for the mesh link.
  `apps/pwa/src/features/node/transport.ts` exists to report honestly which
  transports a browser exposes, and `NodeScreen.tsx:114` says installing
  firmware needs a computer.
- **The app cannot flash firmware.** `mesh.ts` now states the boundary plainly:
  its former cable flasher was deleted and this module manages only compatible
  firmware that is already running. There is no `flash.ts`, no `esptool`
  dependency, and no call to `navigator.serial.requestPort()`. What ships is
  `apps/pwa/src/features/mesh/MeshRadios.tsx`: "it needs firmware on it already —
  flash it with meshtastic's own installer, we do not build any."

### 2.6 What the client never sends

The shipped client has no upload path. The submission gateway is a future handler,
not a route, and nothing below calls it. Specifically:

- **Reports.** `apps/pwa/src/features/report/reportQueue.ts` contains no
  `fetch`; submitting signs the payload, chains it, and writes it to IndexedDB.
  The queue transport methods have no production caller.
- **Plates.** See §2.4 — clipboard, never a request.
- **Settings.** `apps/pwa/src/features/settings/SettingsScreen.tsx:25` — "sends
  nothing anywhere. No fetch, no beacon, no analytics, no URL write."
- **Sweep telemetry.** `apps/pwa/src/features/sweep/telemetry.ts:41` — asserted
  by test.
- **Zone CSV export.** `apps/pwa/src/features/zone-audit/zoneCsv.ts:54` — "No
  `fetch`, no clipboard, no share, no download. It returns a string."
- **Analytics, crash reporting, tag managers, ad SDKs.** None. `rg 'fetch\('`
  over `apps/pwa/src` (excluding tests) returns exactly five matches: four real
  calls — `MapCanvas.tsx:387` and the three `AdminScreen.tsx` lines, which are
  one endpoint — and one occurrence inside a comment
  (`LookupV1Screen.tsx:22`, describing a test that fails the file if `fetch(`
  ever appears in it). Every other request in §2.1 goes through an injected
  `fetchImpl` whose default is `globalThis.fetch`, so it is testable; the second
  command in §8 finds those.

---

## 3. The static data endpoints

Everything below is a file on disk in `apps/pwa/public/`. Vite normally copies
that tree into `apps/pwa/dist/`, but the `fwm-archive-not-in-deploy` plugin
removes `dist/cameras` after the copy. Production `/cameras/*` is therefore
served only by the Function in §1.1 from the pointer-selected R2 generation.
The checked-in camera tree is a reproducible source archive and possible
reviewed bootstrap; it can be older than the live generation because scheduled
freshness never commits generated camera state to Git. A publish validates the
local directory it is given and binds those exact bytes into the new generation
manifest.

### 3.1 File layout

```
apps/pwa/public/
├─ cameras/                       ← source/bootstrap only; omitted from dist, served from R2 in production
│  ├─ 11/                         ← 339 x-directories, 8,605 tile files
│  │  └─ {x}/{y}.json
│  ├─ index.json
│  ├─ overview.json
│  ├─ counties.json
│  ├─ places.json
│  └─ tombstones.json
├─ records/
│  └─ counties.json               ← documented ALPR misuse; candidates.json appears only in a patrol PR
├─ basemap-assets/                ← vendored from protomaps/basemaps-assets, pinned
│  ├─ fonts/
│  │  ├─ Noto Sans Regular/{0-255,…,65280-65535}.pbf (256 ranges)
│  │  ├─ Noto Sans Medium/…
│  │  ├─ Noto Sans Italic/…
│  │  └─ OFL.txt
│  └─ sprites/
│     ├─ LICENSE.txt
│     ├─ black.json      black.png      black@2x.json      black@2x.png
│     ├─ dark.json       dark.png       dark@2x.json       dark@2x.png
│     ├─ grayscale.json  grayscale.png  grayscale@2x.json  grayscale@2x.png
│     ├─ light.json      light.png      light@2x.json      light@2x.png
│     └─ white.json      white.png      white@2x.json      white@2x.png
├─ fonts/                         ← 7 woff2: chakra-petch 400/500/600/700, jetbrains-mono 400/500/700
├─ icons/                         ← icon-192, icon-512, maskable-384, maskable-512, monochrome-96, monochrome-512, camera-mask
├─ assets/                        ← darkroute-icon.png, darkroute-mark.png, node-mesh-eye.png
├─ manifest.webmanifest
└─ .well-known/assetlinks.json    ← TWA Digital Asset Links for ai.darkroute.app
```

> **There are two different files called `counties.json`, and they are
> unrelated.** `/cameras/counties.json` is the **gazetteer** — FIPS codes to
> county names, so a camera can be labelled (read by
> `apps/pwa/src/services/cameras/gazetteer.ts:81`, keyed on `fips`).
> `/records/counties.json` is the **documented-misuse index** — published
> allegations of ALPR abuse by named agencies (read by
> `apps/pwa/src/services/records/countyRecords.ts:165`, keyed on the same
> `fips`). They share a filename and a key and nothing else. Confusing them
> would mean reading a name table as an accusation table; the paths are the
> only thing that distinguishes them, so quote the whole path.

### 3.2 URL patterns

| Pattern                                                    | Served by              | Content type                                                                     |
| ---------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| `/cameras/11/{x}/{y}.json`                                 | R2 via Function (§1.1) | `application/json; charset=utf-8`                                                |
| `/cameras/index.json`                                      | same                   | same                                                                             |
| `/cameras/overview.json`                                   | same                   | same                                                                             |
| `/cameras/counties.json`                                   | same                   | same                                                                             |
| `/cameras/places.json`                                     | same                   | same                                                                             |
| `/cameras/tombstones.json`                                 | same                   | same — **published, not read by the app**                                        |
| `/records/counties.json`                                   | Pages static           | `application/json`                                                               |
| `/basemap-assets/fonts/{fontstack}/{range}.pbf`            | Pages static           | `application/octet-stream`                                                       |
| `/basemap-assets/sprites/{flavor}[@2x].{json,png}`         | Pages static           | JSON / PNG                                                                       |
| `/fonts/{face}.woff2`                                      | Pages static           | `font/woff2`                                                                     |
| `/icons/*.png`, `/assets/*.png`                            | Pages static           | `image/png`                                                                      |
| `/manifest.webmanifest`                                    | Pages static           | `application/manifest+json`                                                      |
| `/.well-known/assetlinks.json`                             | Pages static           | `application/json`                                                               |
| `https://tiles.darkroute.ai/basemap.json`                  | R2 public bucket       | `application/json`, `Cache-Control: public, max-age=60`                          |
| `https://tiles.darkroute.ai/basemap-us-<YYYYMMDD>.pmtiles` | R2 public bucket       | `application/octet-stream`, `Cache-Control: public, max-age=31536000, immutable` |
| `https://tiles.darkroute.ai/speeds-us-<YYYYMMDD>.pmtiles`  | R2 public bucket       | same                                                                             |

**Where these content types come from.** `/cameras/*` is set explicitly by the
Function, and R2 uploads carry explicit content metadata. Everything else in
the table uses Cloudflare Pages' default for the extension;
`apps/pwa/public/_headers` adds security and cache policy but no `Content-Type`
override. If a content type matters to you, check it against a response, not
against this table.

The two `CacheControl` values are set by `scripts/publish-basemap.mjs`. The
bucket must also satisfy the five-origin CORS/range contract in §4.4, including
`Accept-Ranges: bytes` and exposing `etag`, `content-range`, `accept-ranges`,
and `content-length`; the publisher refuses to move the pointer otherwise.

### 3.3 Body shapes

Full field-level contracts are in [`DATA-CONTRACTS.md`](./DATA-CONTRACTS.md).
The shapes the _network_ layer depends on:

**A tile** — `/cameras/11/{x}/{y}.json`. Written by
`scripts/fetch-cameras.mjs:905-921`.

```json
{
  "z": 11,
  "x": 606,
  "y": 765,
  "attribution": "Map data © OpenStreetMap contributors",
  "licence": "ODbL-1.0",
  "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
  "cameras": [
    {
      "id": "osm:13398047427",
      "lat": 41.32554,
      "lon": -73.47414,
      "directionDeg": 175,
      "ownerType": "police",
      "confirmations": 1,
      "countyFips": "09001",
      "placeGeoid": "0965685",
      "tags": { "manufacturer": "Flock Safety", "…": "…" }
    }
  ]
}
```

The client reads `body.cameras` and nothing else
(`apps/pwa/src/services/cameras/sync.ts`). **Attribution and the ODbL identifier
and URI travel in the body** so they cannot be separated from the data — a
licensing condition, not decoration.

**`index.json`** — first written by `scripts/fetch-cameras.mjs:974-990`, then
**rewritten every hour** by `scripts/sync-cameras.mjs:766-788`, which is what
advances `upstream` and refreshes `generatedAt`, `cameras`, `tiles` and `bbox`.
It preserves `source` and `baseUpstream`. (For
a while it did not, and the file claimed 130,684 cameras across 8,508 tiles while
the disk held 131,054 across 8,575, drifting further every hour.)

```json
{
  "zoom": 11,
  "generatedAt": "2026-08-26T20:00:10.314Z",
  "source": "OpenStreetMap (ODbL), direct retained-response capture using DeFlock-derived queries",
  "attribution": "Map data © OpenStreetMap contributors",
  "licence": "ODbL-1.0",
  "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
  "cameras": 132068,
  "tiles": 8605,
  "bbox": { "south": 17.5, "west": -180, "north": 72, "east": 180 },
  "upstream": "2026-08-26T19:00:00Z"
}
```

The client reads `body.cameras` (a **count**) — `catalogue.ts:62-64`.

`upstream` is the exact replication timestamp applied to the operational
archive. `baseUpstream` is separately the minimum actual
`osm3s.timestamp_osm_base` reparsed from every retained constituent response in
the reviewed direct capture. A runner start, capture completion, or build time
is not an OSM watermark. Advancing replication does not rewrite it. `source`
and the retained `cameraSource` receipt bind the baseline.

**`overview.json`** — `writeOverview()`, `scripts/sync-cameras.mjs:378-426`
(the write itself at `:416-425`). Rewritten only on a run that actually applies a
diff, so it can lag an up-to-date patrol by an hour:

```json
{ "schema": "fwm-overview/v1",
  "attribution": "Map data © OpenStreetMap contributors", "licence": "ODbL-1.0",
  "licenceUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
  "count": 132068,
  "coords": [22.2211, -159.57868, 21.64384, -157.92282, …] }
```

Flat `[lat, lon, lat, lon, …]`. `MapCanvas.tsx:390-399` reads `coords` and
ignores the rest, which is why added keys do not break it and why the schema
version did not need bumping when attribution was added.

**`counties.json` / `places.json`** — `{ generatedAt, source, attribution,
licence, licenceUrl, counties|places, located|inPlace,
unlocated|unincorporated, rows: [...] }`.
`gazetteer.ts:84` reads `body.rows` and indexes on `fips` / `geoid`.

**`tombstones.json`** — written by `scripts/fetch-cameras.mjs` and advanced by
`scripts/sync-cameras.mjs`. It carries `{ attribution, licence, licenceUrl,
generatedAt, upstream, tombstones: [ { id, reason, seq, osmVersion } ] }`.
`reason` is `osm_delete`, `osm_untag`, `osm_out_of_scope`, or the tightly
validated one-time `cutover_reconciliation`. Routine replication merges ordered
entries. During the one-time predecessor cutover only, an exact-current
reconciliation entry may replace an inherited historical tombstone for the same
predecessor-live id; this prevents an old deletion from hiding a later restored
camera. A client that only ever takes additions never forgets anything, so
removals are published explicitly.
**Published but not read by the app** — no client code fetches it.

**`/records/counties.json`** — `{ generatedAt, note, counties, records: [...] }`.
`countyRecords.ts:168-174` reads `body.records`. `parseRecord`
(`countyRecords.ts:122`) **drops** any row missing `fips`, `agency`, `summary`,
`sourceUrl` or `sourceName`, or whose `sourceUrl` is not `http(s)` — rather than
render an unsourced allegation about a named law-enforcement agency.

**`basemap.json`** — `{ url, built, osm? }`, written by
`scripts/publish-basemap.mjs:295-308`.

---

## 4. Build-time and operator scripts that talk to anything external

None of these run in the browser. None run automatically except where a workflow
is named.

**The network mechanisms are explicit.** Direct `fetch` calls cover the OSM,
Cloudflare, Neon, and operator-facing scripts below. `hydrate-cameras.mjs`,
`publish-cameras.mjs`, and `publish-basemap.mjs` also speak S3 through
`@aws-sdk/client-s3` (§4.3, §4.4), while `vendor-basemap-assets.mjs` shells out
to `git` (§4.6). Scripts in `scripts/` not listed here make **no** network calls:
`counties.mjs` (reads a local GeoJSON), `enrich-cameras.mjs`, `generate-assets.mjs`,
`generate-android-assets.mjs`, `generate-camera-mask.mjs`, `check-basemap-assets.mjs`,
`check-design-values.mjs`, `check-help-citations.mjs`, `check-record-citations.mjs`.
`check-map-render.mjs`, `check-text-fits.mjs` and `design-system.mjs` drive a
local Playwright browser against `localhost` only.

### 4.1 `scripts/fetch-cameras-deflock.mjs` + `fetch-cameras.mjs` — release bootstrap

|                     |                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calls**           | `capture-deflock-source.mjs` posts the pinned adaptive plan to allowlisted Overpass endpoints; cutover reconciliation and the reviewed adapter read fixed official OSM current-node and numbered replication URLs with redirects forbidden. `fetch-cameras.mjs` is local-only |
| **Input**           | A human-approved v3 receipt over the retained response ledger/bundle, attributed raw GeoJSON, exact capture code, strict geofence, predecessor evidence, and reconciled tombstone ledger; never a remote PMTiles build                                                        |
| **User-Agent**      | Capture: `DarkRoute-source-capture/1.0 (+https://darkroute.ai; contact cory@darkcode.ai)`; cutover reconciliation has its own identifying agent                                                                                                                               |
| **Direct Overpass** | **Disabled.** A no-input invocation fails before network access because the former `US_BBOX` sweep admitted Canada and Mexico                                                                                                                                                 |
| **Cadence**         | Release rebuild only; hourly freshness comes from §4.2                                                                                                                                                                                                                        |
| **Target**          | Operational and rebuild commands pass `--target=DIR`; the script rejects a repository root, filesystem root, symlink, or populated non-camera directory                                                                                                                       |

The capture retains the full case-insensitive ALPR/ANPR seed-root union and
hash-bound Canada/Mexico neighboring-area audit responses. Those audit
responses do not subtract ids: the pinned Census 50-states/DC/PR polygons are
the sole territorial admission authority. The adapter validates every retained
record's OSM version and timestamp, applies the exact tombstone-version floor,
and rejects obsolete local carry. DeFlock contributes pinned MIT-licensed query
implementation, not a camera-data transport or second factual source.

**Circuit breakers** — this script will refuse to write rather than publish a
hole:

| Guard            | Line                                           | Rule                                                                                                             |
| ---------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Capture topology | exact roots/splits/leaves/zero proofs          | Missing plan nodes, false zeroes, count/data mismatch, same-endpoint leaves, or out-of-leaf nodes abort          |
| Stable source    | response/artifact/code SHA-256 identities      | Retained bodies, original transport hashes, raw dataset, code bytes, and minimum actual OSM watermark must agree |
| Population       | `RAW_MIN_TOTAL` + territorial release floor    | Both the seed-root union and final strict-territory/tombstone result must contain at least 120,000 nodes         |
| Transition       | predecessor ancestry + complete reconciliation | Every predecessor-live id must remain live or receive a source-bound, exact-current-version tombstone            |

The source/decode guards are not overridable. The fetcher's replacement floors
require a human `--force`, which is not used for a clean staged release build.

Release input provenance and topology cannot be overridden on the command line.
The adapter accepts only the approved direct-capture v3 receipt and rejects
legacy remote-PMTiles and local-carry shapes. `baseUpstream` is the minimum
actual `osm3s.timestamp_osm_base` reparsed from all accepted response bodies,
not a runner/build/local-file time. The replay floor is the last official hourly
state at or before that minimum.

The release adapter requires a fresh tombstone-only staging directory and a new
handoff path. `fetch-cameras.mjs` preserves only that bound deletion ledger
while rebuilding every tile and sidecar. No old live `street`, `cross`, or
other annotation can leak into the reviewed release transformation.

### 4.2 `scripts/sync-cameras.mjs` — the hourly freshness patrol

|                   |                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calls**         | `GET https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/state.txt` (`:75-76`, `:246`) and `GET .../hour/{aaa}/{bbb}/{ccc}.osc.gz` (`diffUrl`, `:261`; fetched at `:279`) |
| **User-Agent**    | `DarkRoute/patrol (+https://darkroute.ai)` — `scripts/sync-cameras.mjs:247`, `:280`                                                                                                         |
| **Volume**        | ~2.52 MB/hour compressed, streamed through `zlib.createGunzip()` into a `sax` parser (`:294-325`) — never buffered, because an hourly diff is >100 MB expanded                              |
| **Cadence**       | Hourly, `cron: '10 * * * *'` — the private operational camera-sync workflow; scheduled runs require repository variable `FWM_CAMERA_SYNC_ENABLED=true`                                      |
| **Per-run bound** | `MAX_DIFFS_PER_RUN = 24` (`:141`)                                                                                                                                                           |
| **Target**        | The workflow passes `--target=apps/pwa/public/cameras`; the same guarded target parser is used by fetch                                                                                     |

**Why this is allowed to run in CI when §4.1 is not.** OSM replication diffs are
published on OSMF-operated infrastructure precisely for automated consumption:
no robots restrictions, no terms to negotiate, no volunteer CPU consumed.

**Rule 5, verbatim from the OSM wiki:** watermarks come from `state.txt`, never
from arithmetic — "you cannot rely on simple arithmetic" and must not "just
fetch diffs by incrementing the sequence number" (`:238-244`).

**Rule 0: absence is never evidence of deletion.** An OsmChange `<delete>`
carries no tags, so a deleted camera is indistinguishable from a deleted park
bench; and a mapper removing `surveillance:type=ALPR` arrives as a `<modify>`
that a tag filter drops. So everything is driven from _our own id set_
(`:19-43`).

**Circuit breakers** (`:91-122`): `MAX_TOMBSTONE_FRACTION` 1%,
`MAX_TOMBSTONE_ABSOLUTE` 500, `MAX_UPSERT_ABSOLUTE` 5,000, `MAX_MOVE_M` 2,000 m,
`MAX_MOVED_CAMERAS` 250. A trip halts the run **without advancing the runtime
state** and exits `2`, so the next run reconsiders the same diffs.

**Geographic filter:** `US_BBOX` is a latitude prefilter with the full longitude
range so it retains Alaska on both sides of the antimeridian. Every qualifying
new or known upsert must also land inside the bundled Census
county/county-equivalent polygons in `scripts/data/us-counties.geojson`. The
same strict 50-states/DC/PR rule filters the baseline. The filter was once
absent, and the patrol ingested every ALPR camera on earth—288 upserts in six
hours, the first in Vancouver.

**State:** the script requires an explicit `--state-file=PATH` in scheduled
operation. Hydration restores that runtime file from the selected generation;
beside the four replication fields it contains the complete hydrated pointer
as `basePointer`. Sync advances only through the last completely parsed diff
and preserves `basePointer`. Publication puts only the applied sequence,
timestamp, stream, and `versionsKnown` in the R2 manifest; `basePointer` stays
outside replication and proves which remote base the run extended. The workflow
commits neither that runtime state nor generated camera files to Git.

The normal 24-diff bound may publish a coherent intermediate generation and
converge over later hourly runs. The one-shot bootstrap instead invokes
`--max 1000 --require-caught-up`; if that bound cannot reach the observed head,
sync fails before publication rather than seeding a knowingly behind pointer.

### 4.3 Camera generations — hydrate from and publish to R2

|                |                                                                                                                                                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Programs**   | `scripts/hydrate-cameras.mjs`, `scripts/publish-cameras.mjs`; shared validation in `scripts/camera-generation.mjs`                                                                                                                                                                                          |
| **Calls**      | R2's S3 API at `https://{account}.r2.cloudflarestorage.com` via `@aws-sdk/client-s3` — conditional `GetObject`/`PutObject`, `ListObjectsV2`, and candidate-slot `DeleteObject`. Plus `GET https://api.cloudflare.com/client/v4/user/tokens/verify` when deriving S3 credentials from a Cloudflare API token |
| **User-Agent** | The AWS SDK's default; not overridden                                                                                                                                                                                                                                                                       |
| **Env**        | `R2_CAMERA_BUCKET`, and `R2_ACCOUNT_ID` or `CLOUDFLARE_ACCOUNT_ID`, and either `R2_ACCESS_KEY_ID`+`R2_SECRET_ACCESS_KEY` or `CLOUDFLARE_API_TOKEN`                                                                                                                                                          |
| **Cadence**    | Hourly in one workflow: hydrate before §4.2, publish after it                                                                                                                                                                                                                                               |

Credential derivation from a plain Cloudflare token: access key = the token's
**id** from `/user/tokens/verify`; secret = `sha256(token value)`
(`s3Credentials` in `camera-generation.mjs`).

**Control objects.** `__camera/current.json` has schema
`darkroute-camera-pointer/v1`. It names the current slot (`a`, `b`, or `c`), its
generation, its manifest SHA-256, a nullable previous reference with the same
three identity fields, and `updatedAt`. Each
`__camera/slots/{slot}/manifest.json` has schema
`darkroute-camera-generation/v1` and contains:

- the generation and `createdAt`;
- `replication`: exact `stream`, `lastAppliedSeq`, `lastAppliedTimestamp`, and
  `versionsKnown`;
- archive metadata: zoom, tile/camera/tombstone counts, source, upstream, and
  `baseUpstream` when mixed or carried source records require an older bound; and
- a strictly sorted `files` inventory with logical key, byte length, MD5, and
  SHA-256 for every sidecar and tile.

Logical archive key `K` is stored at
`__camera/slots/{slot}/data/K`. The generation id hashes replication, archive,
and inventory; `createdAt` is deliberately outside identity.

**Hydration pins one complete snapshot.** It reads the pointer and named
manifest, verifies the pointer's manifest hash and generation, downloads only
the exact sorted inventory, verifies every byte length and SHA-256, validates
the archive's cross-file counts and invariants, then installs the staged archive
and writes the manifest's replication fields plus the full pinned pointer as
`basePointer` to the explicit `--state-file`. `basePointer` is runtime control
state, not part of the manifest's replication object. All six sidecars are
mandatory; missing, extra, malformed, or altered data fails the operation
without installing either output.

**Publication changes visibility once.** The publisher conditionally acquires a
180-minute `darkroute-camera-publish-lease/v1` object at
`__camera/publish-lease.json` and installs a 110-minute hard write fence. For a
normal run it then requires the remote pointer to equal the runtime state's
exact hydrated `basePointer` before it may mutate a candidate. Bootstrap has no
`basePointer` and instead requires the remote pointer to be absent.

The publisher revalidates the exact lease object and ETag immediately before
candidate reconciliation, manifest write, and pointer write. Within the
candidate it compares size and MD5, uploads changed or missing data, deletes
stale candidate keys, and exact-relists. It writes and verifies the manifest
last within the slot, then conditionally replaces `__camera/current.json` last.
A pointer race, lease takeover, or expired write fence fails without activating
the candidate.

**It refuses to publish a catastrophe.** `MIN_TILES = 4000`,
`MIN_CAMERAS = 120_000`; local validation happens before the candidate is
eligible for activation.

**Current and previous are immutable while protected.** Only the third slot is
recyclable. An interrupted upload remains unreachable, and rollback is a
conditional pointer change to the exact previous generation. Normal publication
requires an existing pointer; the explicit `--bootstrap` mode instead requires
that `__camera/current.json` be absent. The manifest selected by the pointer is
the canonical operational watermark.

### 4.4 `scripts/publish-basemap.mjs` — a basemap archive to R2

|             |                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calls**   | Same R2 S3 endpoint — `HeadObject`, `ListObjectsV2`, multipart `Upload`, `PutObject`. Plus `/user/tokens/verify`, plus 16-byte range `GET`s against `R2_PUBLIC_BASE` for each origin in `BROWSER_ORIGINS` before upload and against the new object before the pointer moves |
| **Env**     | `R2_BUCKET`, `R2_ACCOUNT_ID`/`CLOUDFLARE_ACCOUNT_ID`, credentials as above, optional `R2_PUBLIC_BASE` (default `https://tiles.darkroute.ai`, `:67`)                                                                                                                         |
| **Cadence** | Manual. `node scripts/publish-basemap.mjs <archive.pmtiles> [--dry-run]`                                                                                                                                                                                                    |

**Immutability is enforced, not conventional.** `HeadObject` on the target key;
if it exists, the script throws rather than overwrite (`:233-243`).

**The bucket is probed before upload and the new object is probed before the
pointer moves.** For each of `https://darkroute.ai`,
`https://www.darkroute.ai`, `https://dev.darkroute.ai`,
`https://darkroute.ai`, and `https://www.darkroute.ai`, the script requires a
non-redirecting exact 16-byte `206`, the exact reflected
`Access-Control-Allow-Origin`, `Vary: Origin`, `Accept-Ranges: bytes`, a
readable ETag, matching `Content-Range` and `Content-Length`, and all four
response headers exposed to browser JavaScript. One missing production origin
blocks publication; this is the gate that keeps a server-readable archive from
becoming browser-unreadable at cutover.

**The pointer goes last** (`:295-310`). Until `basemap.json` moves, every client
keeps reading the previous archive — complete, consistent, a day older.

### 4.5 `scripts/places.mjs` — US Census place boundaries

|                   |                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calls**         | `GET https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_place_500k.zip` — `PLACE_URL`, `:37-38`; fetched at `:139`                    |
| **User-Agent**    | `DarkRoute/0.1 (ALPR transparency; cory@darkcode.ai) census-boundary-client` — `:40-41`                                                      |
| **Rate limiting** | None needed: **the file is cached to `.cache/census/places.zip` and re-downloaded only if absent** (`:137`). One request, ever, per checkout |
| **Cadence**       | Historical/manual only. Approved v3 release builds reject `--places=` and emit the canonical empty place sidecar.                            |
| **Shells out**    | `unzip -o -q` (`:143`)                                                                                                                       |

`scripts/counties.mjs` makes **no** network call — it reads a local Census county
GeoJSON handed to it by path (`:10`).

### 4.6 `scripts/vendor-basemap-assets.mjs` — glyphs and sprites

|               |                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calls**     | `git clone --depth 1 https://github.com/protomaps/basemaps-assets.git`, then `git fetch --depth 1 origin <sha>`, then `git checkout <sha>` — `:120-129` |
| **Pinned to** | `ASSETS_SHA = '028c18f713baecad011301ff7a69acc39bcc2ae7'` (`:56`). The repo publishes no releases, so the SHA _is_ the version                          |
| **Writes**    | `apps/pwa/public/basemap-assets/` (`OUT`, `:104`) — 3 font stacks × 256 ranges, 5 selectable sprite flavours × 4 files                                  |
| **Cadence**   | Manual. `scripts/check-basemap-assets.mjs` (run by `pnpm lint`) fails the build if the shipped assets drift from what the built style asks for          |

### 4.7 `scripts/misuse-patrol.mjs` — new documented ALPR abuse

|                     |                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calls**           | Six sequential credential-free `GET https://api.gdeltproject.org/api/v2/doc/doc` requests using the fixed standing query set, `mode=artlist`, `format=json`, `maxrecords=100`, `timespan={1..90}d`, and `sort=datedesc`. GDELT's primary [DOC 2.0 documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) defines those parameters and Article List JSON output |
| **Auth**            | None. The workflow intentionally receives no news-provider secret                                                                                                                                                                                                                                                                                                               |
| **User-Agent**      | `DarkRoute-misuse-patrol/1.0 (+https://darkroute.ai)`                                                                                                                                                                                                                                                                                                                           |
| **Network guards**  | Exact HTTPS host/path, redirects forbidden, 45-second timeout, 1 MiB decoded-body ceiling, required JSON media type, fatal UTF-8 decoding, and strict Article List field/date/source-URL validation                                                                                                                                                                             |
| **Politeness**      | Queries run serially with a two-second pause. There is no retry storm: any failed query fails the patrol, and the next scheduled attempt is the following day                                                                                                                                                                                                                   |
| **Failure policy**  | Any provider, HTTP, timeout, size, JSON, or schema failure exits nonzero. Only a successful search with zero matches is a quiet success                                                                                                                                                                                                                                         |
| **Normalization**   | Tracking parameters and fragments are removed, remaining query parameters sorted, duplicates resolved independent of provider order, and the queue sorted by publication time then canonical URL                                                                                                                                                                                |
| **Cadence / scope** | Daily, `cron: '20 7 * * *'`; schedules additionally require `FWM_MISUSE_PATROL_ENABLED=true`. Both schedules and dispatches are skipped unless the protected private operational repository is at `refs/heads/main`                                                                                                                                                             |

**It never writes a record.** It writes `apps/pwa/public/records/candidates.json`
with `fips`, `agency`, `summary`, `incidents` and `year` left **empty**, and opens
a pull request. A human opens each `sourceUrl`, reads it, and fills those in.
Six candidates have been rejected by exactly that pass — one claimed a guilty
plea where the article said the officer pleaded _not_ guilty. The automation does
the watching; it does not do the vouching.

### 4.8 `scripts/cost-patrol.mjs` — the budget circuit breaker

|             |                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calls**   | `https://api.cloudflare.com/client/v4` REST for zone security level and `POST /graphql` for usage; `https://console.neon.tech/api/v2/projects/{id}/endpoints` and `.../endpoints/{id}/suspend` when Neon credentials are configured |
| **Auth**    | Bearer tokens supplied by the operator's environment                                                                                                                                                               |
| **Cadence** | `cron: '*/30 * * * *'` — the private operational cost-patrol workflow; scheduled runs require repository variable `FWM_COST_PATROL_ENABLED=true`                                                                                    |
| **Env**     | Operator credentials, plus the USD thresholds `FWM_WARN_USD` 25 / `FWM_DEGRADE_USD` 75 / `FWM_KILL_USD` 125 / `FWM_CEILING_USD` 200 |

Escalation: `warn` → report; `degrade` → `PATCH /zones/{zone}/settings/security_level`
to `under_attack`; `critical` (configured by the legacy `FWM_KILL_USD` name) →
retain that challenge, suspend Neon compute when configured, print that Pages
Functions and R2 remain live, and fail the workflow for manual response.

The patrol does **not** delete zone Worker routes. A live-account check on
2026-09-01 found no such route for the Pages Functions, so that action could not
stop this product and could delete unrelated Workers on a shared zone. R2
operations are also absent from its price estimate. This is an alarm and a
partial edge response, not a hard spend cap.

It runs in GitHub Actions rather than as a Worker Cron Trigger on purpose: a
watchdog for runaway Workers must not share a failure domain with the thing it
watches.

The workflow is allowed to receive the production Cloudflare/Neon credentials
only in the protected private operational repository and when the ref is
exactly `refs/heads/main`. Scheduled runs additionally require
`FWM_COST_PATROL_ENABLED=true`; a manual dispatch from a tag, feature branch,
fork, or public mirror is skipped. A manual `execute=false` run still performs
the authenticated read and prints the full report, but makes no mutation.
Warnings return success; an actual degrade/critical tier (or a critical
month-end projection) returns nonzero even in report-only mode so the alert is
not silently converted into a green run.

### 4.9 Access protection — operator script, not distributed

Puts the identity gate in front of a host. Operator tooling; not part of
the app and not published.


### 4.10 `scripts/deploy.mjs` and `scripts/preflight.mjs`

`deploy.mjs`: invokes the repository-pinned Wrangler with
`pnpm exec wrangler pages deploy` against project `flockyswatchingme` (`:68` —
the Pages project name is _not_ the product name, and renaming it changes its
`*.pages.dev` hostname). Then verifies against
`https://dev.darkroute.ai` (`:72`): the document (`:178`) and each hashed asset
(`:131`), up to 10 attempts 4 s apart (`:74-75`). It can also ask Cloudflare
directly — `GET /accounts/{a}/pages/projects/{p}/deployments?per_page=5` (`:296`).

Behind Access the HTTP checks are blind, and the script says so explicitly rather
than reporting a false failure (`:183-195`); a service token restores sight
(`:166-171`).

The private operational `deploy-dev.yml` workflow is the only automated Direct
Upload path. It is deliberately excluded from the curated public seed. It has
no push, pull-request, tag, or schedule trigger; an operator must dispatch
the private operational repository's exact `main` ref through the protected
`dev-pages` environment. Before upload it runs the full source gates, hydrates
and validates the active camera generation, builds once without production
credentials, and reads the Pages project back. Its credentialed step invokes
`deploy.mjs --prebuilt`: that path executes no build or package lifecycle
script and rechecks the existing dist basemap inventory and bytes, glyphs,
sprites, `_headers`, and exact Wrangler pin before Direct Upload.
It requires Direct Upload, production branch `main`, the `dev.darkroute.ai`
domain, and `CAMERA_TILES` in both deployment configurations.

The workflow patches only production/preview `fail_open=false`, then fetches
the project again and byte-compares a canonical copy of every deployment-config
field except `fail_open`. That proves the compatibility dates, R2 bindings, and
other settings survived. Cloudflare's primary
[Pages project API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/)
defines this flag as whether to fail open when deployment configuration cannot
be applied; leaving it true could publish the static build while silently
dropping the Function configuration. After
upload, the workflow hydrates the then-current R2 generation and
`verify-camera-deployment.mjs` requires dev's `index.json` and
`continuity.json` bodies and generation headers to match it exactly. The
Access service-token pair is required before the configuration patch or upload,
so an unobservable deployment never starts.

`preflight.mjs`: drives headless Chromium against `https://dev.darkroute.ai`
(`:63`) or a URL you pass. It tests the _deployed artefact_ — the built bundle,
the service worker, the real headers, the CDN — because a local dev server tests
the code instead.

---

## 5. Service worker

**Generated by** `vite-plugin-pwa` (`generateSW`). The sole Workbox source of
truth is the inline `workbox` object in `apps/pwa/vite.config.ts`. Output:
`apps/pwa/dist/sw.js` + `workbox-*.js`.

### 5.1 Registration

`injectRegister: null`, `registerType: 'prompt'`. Registration is application
code — `App.tsx` calls the controller in
`apps/pwa/src/services/pwa/registerSW.ts` on mount. The browser's app-install
invitation is separate and is gated by `installPrompt.ts` ("after 2nd session,
never on first alert"). `devOptions.enabled: false`: never a service worker in
dev, because a stale precache during a live alert is a correctness bug.

`skipWaiting: true`, `clientsClaim: true` in the live `workbox` object.
These were previously off, which deadlocked: the _old_ page decides to take an
update, the old page is served by the old worker, and the old page has no update
code in it. Every deploy after a driver's first visit was invisible. The new
worker now activates and claims open clients automatically. Claiming changes the
controller but does not reload a loaded document, so a running page keeps its JS
and picks up the new document on its next navigation. `registerSW.ts` reloads on
a `controlling` event only when its explicitly gated waiting-worker path first
requested the update.

### 5.2 Precache

```
globPatterns: ['**/*.{js,css,html,woff2,png,svg}']
```

— the live `workbox.globPatterns` value in `apps/pwa/vite.config.ts`.

Precached: the JS/CSS bundles, `index.html`, all seven `/fonts/*.woff2`, every
PNG in `/icons/` and `/assets/`, the sprite **PNG**s, any SVG.

**Not** precached: `.json` (the camera archive is 8,605 files — precaching the
United States on first load is not a thing to do to somebody's phone or their
data plan), `.pbf` glyphs, `.webmanifest`, `.pmtiles`. Requested same-origin
glyph PBFs and basemap sprite JSON indexes are instead cached on demand by
`fwm-basemap-assets-v1`.

`navigateFallbackDenylist: [/./]` — the live `workbox` object in
`apps/pwa/vite.config.ts`.

This is how the SPA fallback is **turned off**, and it needs explaining because
deleting the key does nothing: vite-plugin-pwa injects `index.html` as a default
`navigateFallback` for a SPA, so the `NavigationRoute` is installed either way,
and Workbox matches routes in _registration order_ with that one registered
before `runtimeCaching`. The `navigateFallbackDenylist` comment in
`apps/pwa/vite.config.ts` records the measurement — "verified in the built
`sw.js`, fallback at byte 1480 and the documents route at 1602". Those byte offsets are that author's note
about one build, not a property of every build: to check it yourself, build and
read your own `sw.js` (§8). A denylist matching every path makes the
fallback decline every navigation so the request reaches the route that actually
asks the network. Offline is not lost: the `NetworkFirst` route below caches
every document it serves.

### 5.3 Runtime caching

Registered in the order shown by `workbox.runtimeCaching` in
`apps/pwa/vite.config.ts`. Workbox matches in registration order; the first
match wins.

#### 1. Navigations — `NetworkFirst`

|                 |                                                |
| --------------- | ---------------------------------------------- |
| Match           | `({ request }) => request.mode === 'navigate'` |
| Cache           | `fwm-documents`                                |
| Network timeout | 3 s (`networkTimeoutSeconds: 3`)               |
| Expiry          | `maxEntries: 4`                                |
| Cacheable       | **`statuses: [200]` only**                     |

**Why network-first.** A cached document names the asset hashes of the build it
came from, so a device that has one keeps loading that build — through refreshes,
through new deploys — while the server has been serving something else for hours.
A fix that lives in a newer bundle cannot reach a client that will never fetch it.

**Why `200` only.** `0` would admit an opaque response, which is right for a
cross-origin tile and wrong for a document: behind Cloudflare Access an expired
session answers a navigation with a `302`, and a navigation request carries
`redirect: 'manual'`, so that arrives as an `opaqueredirect` with status 0.
Admitting it means storing "you are logged out" as the app's document.

#### 2. Camera data — `StaleWhileRevalidate`

|           |                                                                                            |
| --------- | ------------------------------------------------------------------------------------------ |
| Match     | `({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/cameras/')` |
| Cache     | `fwm-camera-tiles-v2`                                                                      |
| Expiry    | `maxEntries: 1200`, `maxAgeSeconds: 604800` (7 days), `purgeOnQuotaError: true`            |
| Cacheable | **`statuses: [200]` only**                                                                 |

Covers all seven `/cameras/*` shapes — the tiles and the six sidecars.

**Why stale-while-revalidate.** Camera data is published to R2 hourly without an
app deploy. A cached response is returned immediately, then refreshed in the
background so the next request sees the current archive. The `-v2` cache name
prevents entries written by the former seven-day `CacheFirst` route from being
read by this route. The IndexedDB copy in
`apps/pwa/src/services/db/repositories/cameraTiles.ts` is the durable layer
underneath the service-worker cache.

**Why 1200 entries.** A ring of 17×17 is 289 tiles; this holds several cities'
worth of driving without letting a long trip evict home.

**Why `200` only, twice over.** A `404` is the normal answer for a rural square
and `apps/pwa/src/services/cameras/sync.ts:168` reads it as "no cameras here" — a cached `404` would keep
saying that after the tile existed. And status `0` would store an unexpected
opaque redirect — including an Access redirect on a gated development host — as
a tile: an empty square over a real road, the one failure this product must not
have.

### 5.4 What the service worker does _not_ handle

- **PMTiles range reads** to `tiles.darkroute.ai` — left to the browser's HTTP
  cache. No Workbox route matches them.
- **`/records/counties.json`** — same gap.
- **`/api/*`** — no route matches, and the navigation fallback is denied
  everything, so a failed API fetch can never be answered with the HTML shell.
- **`POST`** of any kind — Workbox runtime caches are GET-only here, so report
  submission would be network-only if it existed. It does not: the queue is
  IndexedDB (`apps/pwa/src/features/report/reportQueue.ts`), deliberately, so
  there is one answer to "did my report go through" instead of two.

### 5.5 Cache names, in one place

| Name                    | Contents                                                                       | Written by                                 |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| `fwm-documents`         | Up to 4 navigation documents                                                   | `vite.config.ts`, navigation runtime route |
| `fwm-basemap-assets-v1` | Up to 800 requested glyph PBFs and sprite JSON indexes, expired after one year | `vite.config.ts`, basemap runtime route    |
| `fwm-camera-tiles-v2`   | Up to 1200 `/cameras/*` responses, revalidated on use and expired after 7 days | `vite.config.ts`, camera runtime route     |
| `workbox-precache-*`    | The `globPatterns` set                                                         | Workbox                                    |

---

## 6. Environment and bindings

**Client (public, compiled into the bundle — never a secret):**

| Name                                     | Read at                                   | Effect                                                            |
| ---------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| `VITE_FWM_BASEMAP_URL`                   | `apps/pwa/src/features/map/basemap.ts:75` | Overrides the basemap archive. Explicit empty string = no basemap |
| `VITE_API_BASE_URL`, `VITE_MAP_TILE_URL` | Not read by `apps/pwa`                    | No effect on the shipped build                                    |

Build stamps, injected by Vite `define` (`apps/pwa/vite.config.ts:103-107`):
`__FWM_VERSION__`, `__FWM_COMMIT__` (`git describe --always --dirty --abbrev=8`),
`__FWM_BUILT__` (UTC date). The commit is what makes "the source is public"
falsifiable — see `apps/pwa/src/features/docs/docs.ts:123-134`.

**Pages Functions (server-side, set in the Pages project):**

| Name           | Kind              | Used by                            |
| -------------- | ----------------- | ---------------------------------- |
| `CAMERA_TILES` | R2 bucket binding | `functions/cameras/[[path]].ts:46` |

The administrative Functions take several more, including one secret. They are
operator-only, are not distributed with this tree, and their configuration is
deliberately not enumerated here - a list of which credential reaches which
endpoint is useful to an attacker and to nobody who is building or auditing
this app.

**CI secrets** are likewise not listed. Each workflow declares what it needs at
the point it uses it.

the environment template is committed and must never contain a real value. Its own header
states the rule: anything named `VITE_*` is compiled into the bundle and is
public, forever.

---

## 7. Versioning and stability

This project is **0.1.0** (`package.json:3`, `CITATION.cff`). Nothing below is a
1.0 promise. What follows separates the guarantees the _code already enforces_
from the ones that are merely current practice, because a stranger integrating
against this needs to know which is which.

### 7.1 Public data surface, private administration

The production app, its static files, `/cameras/*`, and the
`tiles.darkroute.ai` basemap archive are public. Camera requests remain on the
app origin for the privacy reason in §1.1; that same-origin routing is not
authentication. The `/api/admin/*` routes belong to the private development and
tester-management surface and verify Cloudflare Access identity in their own
handlers.

This is still a pre-1.0 interface. Public reachability is not a promise that URL
or body schemas will never change; the construction guarantees below are the
narrow properties the current code actually enforces.

### 7.2 What is guaranteed by construction

These are enforced by code that refuses, not by intention:

| Guarantee                                                                                                                                                                            | Enforced by                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **A published PMTiles archive is never overwritten.** A new build is a new date-stamped filename                                                                                     | `HeadObject` before upload; the script throws if the key exists — `scripts/publish-basemap.mjs:233-243`                                |
| **A reader cannot see a partially published camera generation.** Current and previous slots remain immutable; candidate data and its manifest finish before the pointer changes last | `publishGeneration` / `reconcileCandidate` in `scripts/publish-cameras.mjs`, with shared validation in `scripts/camera-generation.mjs` |
| **A tile is never published as empty because a fetch failed.** Four independent floors abort the run instead                                                                         | `scripts/fetch-cameras.mjs:379`, `:654`, `:732`, `:763`; `scripts/sync-cameras.mjs:91-122`                                             |
| **A `404` is never cached as data**                                                                                                                                                  | `cacheableResponse: { statuses: [200] }` on both live runtime routes in `apps/pwa/vite.config.ts`                                      |
| **Attribution cannot be separated from the data.** Every tile carries `attribution` and `licence` in its own body                                                                    | `scripts/fetch-cameras.mjs:905-921`. An ODbL condition, not decoration                                                                 |
| **The manifest can say which archive, never whose**                                                                                                                                  | `isPermittedArchive` — `apps/pwa/src/features/map/manifest.ts:110`                                                                     |

### 7.3 What a consumer may rely on

**Additive change is safe, and that is a property of the readers, not a policy.**
Every client reader takes one key and ignores the rest:

| File                                        | The only key read       | Reader                                                       |
| ------------------------------------------- | ----------------------- | ------------------------------------------------------------ |
| tile `{z}/{x}/{y}.json`                     | `cameras`               | `apps/pwa/src/services/cameras/sync.ts:170-171`              |
| `index.json`                                | `cameras` (a count)     | `apps/pwa/src/services/cameras/catalogue.ts:62-64`           |
| `overview.json`                             | `coords`                | `apps/pwa/src/features/map/MapCanvas.tsx:390`                |
| `counties.json` / `places.json` (gazetteer) | `rows`                  | `apps/pwa/src/services/cameras/gazetteer.ts:84`              |
| `/records/counties.json`                    | `records`               | `apps/pwa/src/services/records/countyRecords.ts:168-174`     |
| `basemap.json`                              | `url`, `built?`, `osm?` | `parseManifest`, `apps/pwa/src/features/map/manifest.ts:134` |

So a new key can be added to any of these without breaking a client, and one was:
`attribution` and `licence` were added to `overview.json` **without** bumping
`schema`, and the code comment says exactly why — "added keys do not break the
reader in `MapCanvas.tsx`, which reads `coords` and ignores the rest, and bumping
the version would strand caches over a change that removes no field"
(`scripts/sync-cameras.mjs:412-414`). If you write a reader, write it the same
way: take your key, ignore the rest, and you inherit the same tolerance.

**Removing or retyping a key is a breaking change** and there is currently no
deprecation window, because there are no external consumers to give one to. If
you become one, say so in an issue and that changes.

### 7.4 The one versioned artefact, and the many unversioned ones

`overview.json` carries `"schema": "fwm-overview/v1"`
(`scripts/sync-cameras.mjs:419`). It is the **only** version string on any
published body. Tiles, `index.json`, the gazetteers, `tombstones.json` and
`/records/counties.json` carry none — they are identified by their path and
their shape. Do not look for a version field that is not there; pin the path and
validate the keys you use.

### 7.5 What changes, and how often

| Thing                                        | Cadence                                                           | Consequence for a consumer                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tile bodies, `index.json`, `tombstones.json` | **Hourly** (§4.2, `cron: '10 * * * *'`)                           | Expect an immediate cached response followed by service-worker revalidation; cached entries expire after 7 days                                                     |
| `overview.json`                              | On every run that applies a diff (`scripts/sync-cameras.mjs:764`) | Publication requires its count to agree exactly with `index.json` and the tiles. A bounded generation may trail the replication head, but it is internally coherent |
| `basemap.json` → a new `.pmtiles` filename   | Manual publishes                                                  | The old archive keeps working. That is the whole design (§2.2)                                                                                                      |
| `ASSETS_SHA` for glyphs and sprites          | Manual, deliberate                                                | `scripts/vendor-basemap-assets.mjs:56`                                                                                                                              |
| The repo's own URL structure                 | Whenever the app changes                                          | Nothing here is a committed URL contract yet                                                                                                                        |

### 7.6 What you must not rely on

Stated plainly, because each of these looks more solid than it is:

- **`/api/admin/*`.** Private-beta operations for one person's Access policy.
  They will be removed or rewritten without notice and are of no use to anybody
  outside this deployment.
- **`tombstones.json`.** Published every hour and read by **no client code in
  this repository**. Nothing tests its shape from the consuming side, so it is
  the field most likely to drift silently. Use it — it is the only honest record
  of removals — but validate it yourself.
- **`VITE_API_BASE_URL` and `VITE_MAP_TILE_URL`.** No PWA source reads either
  name. Setting them does nothing to the shipped build.
- **`packages/api-client`.** A placeholder, not an API. The separately
  documented operator tooling and gateway are not deployed app routes.
- **The byte offsets in the `sw.js` note** (§5.2). One author's measurement of
  one build.
- **The Pages project name `flockyswatchingme`** (`scripts/deploy.mjs:68`). It is
  the old product name, kept because renaming it changes its `*.pages.dev`
  hostname. It is not a URL anybody should depend on.

### 7.7 Licence obligations if you re-use any of this

- **The code** is **GPL-3.0-only** (`LICENSE`, `NOTICE.md`, `CITATION.cff`). It
  was relicensed from MIT because `@meshtastic/js` is GPL-3.0-only and linking
  it makes the combined work GPL-3.0 — the reasoning is in `NOTICE.md` and at
  `apps/pwa/src/features/node/mesh.ts:1-12`.
- **The camera data** is OpenStreetMap under **ODbL-1.0**. Every tile body
  carries `attribution: "Map data © OpenStreetMap contributors"` and
  `licence: "ODbL-1.0"` so the two cannot be separated. If you render these
  points, you must show that attribution. See
  [`DATA-PROVENANCE.md`](./DATA-PROVENANCE.md) and
  [`TAXONOMY.md`](./TAXONOMY.md).
- **The misuse records** in `/records/counties.json` are summaries of
  third-party reporting, each carrying `sourceUrl` and `sourceName`. Cite the
  source, not us.

---

## 8. How to check all of this yourself

```bash
# Every literal fetch in the client. Five matches, one of which is a comment.
rg -n 'fetch\(' apps/pwa/src --glob '!*.test.*'

# The other call sites go through an injected `fetchImpl` so they can be
# tested. This finds them and their default, which is always globalThis.fetch.
rg -n 'fetchImpl|guardedFetch|doFetch\(' apps/pwa/src --glob '!*.test.*'

# Every absolute URL literal in the client.
rg -n 'https?://[^"'"'"'`) ]*' apps/pwa/src --glob '!*.test.*'

# Every route the site serves from code.
find functions -name '*.ts' -not -name '*.test.ts'

# Every external call the tooling makes.
rg -n "fetch\(|execFileSync\('git'|api\.cloudflare|r2\.cloudflarestorage" scripts/*.mjs

# What the built worker actually precaches and routes.
pnpm --filter @fwm/pwa build
rg -o 'urlPattern|cacheName:"[^"]+"|revision' apps/pwa/dist/sw.js | sort | uniq -c

# Watch the app run with the radio off. DevTools → Network, offline,
# then reload: you should see the document from fwm-documents and the
# cameras from fwm-camera-tiles-v2, and nothing to any other origin.
```

See [`AUDITING.md`](./AUDITING.md) for the full set, including how to verify that
no coordinate leaves the device.
