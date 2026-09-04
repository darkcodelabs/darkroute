# Contributing to DarkRoute

DarkRoute warns drivers about ALPR cameras. That makes it a tool people rely on
in situations where being wrong has consequences, and it makes it a project
whose credibility rests entirely on being checkable by strangers who do not
trust it.

Two consequences shape everything below:

- **The privacy rules in §7 are not preferences.** A change that violates one is
  rejected regardless of how good the feature is, and several of them are
  enforced by tests that will fail your PR before a human reads it.
- **The comment standard in §5 is real and it is unusual.** This repository
  writes down *why* — the failure a piece of code prevents, usually a real one
  that happened here. Code that arrives without that reads as foreign, and the
  reason is in §5.

If you are here to audit rather than to contribute, you want
[`AUDITING.md`](./AUDITING.md) instead.

---

## Contents

- [1. Before you write anything](#1-before-you-write-anything)
- [2. Toolchain and setup](#2-toolchain-and-setup)
- [3. The commands](#3-the-commands)
- [4. What a PR must pass](#4-what-a-pr-must-pass)
- [5. The comment standard](#5-the-comment-standard)
- [6. Commit convention](#6-commit-convention)
- [7. Non-negotiable rules](#7-non-negotiable-rules)
- [8. Design tokens](#8-design-tokens)
- [9. Data, licences and OpenStreetMap](#9-data-licences-and-openstreetmap)
- [10. When a change requires a document change](#10-when-a-change-requires-a-document-change)
- [11. Repository map](#11-repository-map)
- [12. Known traps](#12-known-traps)

---

## 1. Before you write anything

Read, in this order:

1. [`THREAT-MODEL.md`](./THREAT-MODEL.md) — what this protects against and what
   it does not. Most of that document is about the limits, and knowing them
   stops you from building something that quietly overstates them.
2. [`ARCHITECTURE.md` §2](./ARCHITECTURE.md#2-what-leaves-the-device) — the
   complete list of what leaves the device. If your change adds an entry to that
   table, say so in the PR description in your own words before anyone asks.
3. The module header of whatever you are about to touch. They are long on
   purpose and they usually contain the reason the obvious approach is wrong.

**Open an issue before a large change.** Not for bureaucracy — because a
surprising amount of this codebase is shaped by a specific failure that is
documented in a comment somewhere, and the fastest way to find out that your
approach was already tried is to say what you are planning.

---

## 2. Toolchain and setup

| Tool | Version | Where it is pinned |
|---|---|---|
| Node | `>= 22.12.0` | `package.json` → `engines` |
| pnpm | `9.15.9` | `package.json` → `packageManager` |
| TypeScript | `5.9.3` | every workspace, strict |

```bash
git clone https://github.com/darkcodelabs/darkroute
cd darkroute
corepack enable
pnpm install --frozen-lockfile
```

That command is the complete dependency setup. The repository has no install
lifecycle hook and no Python application. If you prefer a checked-in wrapper
that verifies the Node floor first, run:

```bash
./installer.sh
```

`installer.sh` is idempotent and runs the same frozen-lockfile install. It does
not create or modify `.env`, a virtual environment, or git state. Read it first
if you would rather not run a shell script from a stranger; that is a reasonable
instinct in this repository of all places.

Environment variables are documented in the environment template. **Nothing in `.env` is
needed to build, test or lint** — only to deploy.

---

## 3. The commands

Every command below exists in `package.json`. Nothing here is aspirational.

### Daily

```bash
pnpm dev              # vite dev server for the PWA
pnpm build            # tsc --noEmit && vite build
pnpm test             # the whole suite: pwa + core + scripts + functions + gateway
pnpm typecheck        # strict tsc over pwa, core and the Cloudflare Functions
pnpm lint             # eslint --max-warnings=0 + four gates (see §4)
pnpm format           # prettier --write .
```

### The gates individually

```bash
pnpm check:design     # scripts/check-design-values.mjs   — the token gate
pnpm check:help       # scripts/check-help-citations.mjs  — HELP citations resolve
pnpm check:records    # scripts/check-record-citations.mjs — misuse records are cited
pnpm check:assets     # scripts/check-basemap-assets.mjs  — offline basemap is complete
```

`pnpm lint` runs all four after ESLint, in that order. Run them individually
when one fails so you get its output without waiting for the rest.

### Narrowing the test run

```bash
pnpm test:unit        # workspace tests + scripts + functions + gateway
pnpm test:scripts     # node --test scripts/*.test.mjs
pnpm test:functions   # vitest run --config functions/vitest.config.ts
pnpm test:gateway     # vitest run --config the submission gatewayvitest.config.ts

# One file, or a directory:
pnpm --filter @fwm/pwa exec vitest run src/services/crypto/chain.test.ts
pnpm --filter @fwm/core exec vitest run

# Watch mode while you work:
pnpm --filter @fwm/pwa exec vitest
```

### Everything else that exists

```bash
pnpm check:fits       # scripts/check-text-fits.mjs — needs a running server
pnpm preflight        # scripts/preflight.mjs — real browser against a URL
pnpm ship             # deploy; refuses without CLOUDFLARE_API_TOKEN
pnpm ship:verify      # deploy verification only
```

`pnpm preflight` opens a real browser and asks questions about **pixels** — does
the dial paint, does the scan beam differ between two captures a beat apart, is
anything hidden behind the dock. It exists because three separate outages
shipped green through the entire unit suite in one day: vitest runs with
`css: false`, so a jsdom test cannot see a missing stylesheet, an unresolved
custom property, or one element covering another. Point it at your own build:

```bash
pnpm build && pnpm --filter @fwm/pwa preview   # port 5173, strictPort
node scripts/preflight.mjs http://localhost:5173
```

`pnpm test:e2e` runs the real-browser photo-metadata regression in
`apps/pwa/e2e/preparePhoto.spec.ts`. It is narrow coverage, not an end-to-end
claim about every user flow.

---

## 4. What a PR must pass

CI is `.github/workflows/ci.yml`. The job that matters is `code`:

```bash
pnpm install --frozen-lockfile
pnpm lint          # eslint + design + help + records + assets
pnpm typecheck
pnpm test
pnpm build
```

Run all five locally first. They are fast and they fail for reasons that are
usually obvious from the message.

Three markdown/YAML jobs run alongside — `markdownlint`, `yamllint`,
`actionlint`. Config is `.markdownlint.json`; `.design-src*/` is excluded from
markdownlint because it is the designer's verbatim export and reformatting it
would make it stop matching what was handed over.

**A note on why the code job exists at all.** This workflow sat as the untouched
project template long after the repo filled with application code, so CI ran
markdownlint and nothing else. Regressions merged to `main` with three green
checkmarks: `pnpm lint` failing, three `scripts/*.test.mjs` files that no command
invoked, and a map that drew no camera markers. If you add a check, add it to
`package.json` **and** confirm a CI job actually calls it.

### What each gate is protecting

| Gate | What it enforces |
|---|---|
| `eslint` | correctness rules, plus two marked `PRIVACY INVARIANT`: `no-console` in all app source, and `localStorage`/`sessionStorage` banned outright. See §7 |
| `check:design` | every colour, length, radius, duration and easing curve in app source is a `var(--fwm-*)`. See §8 |
| `check:help` | every privacy answer on the HELP screen cites files that exist |
| `check:records` | every misuse record carries a resolvable source. See §9 |
| `check:assets` | the offline basemap has every font range and both sprite densities |
| `typecheck` | strict TS. `any` needs an inline disable, which needs a comment |
| `test` | 2,947 assertions, including the enforcement tests in [`AUDITING.md` §6](./AUDITING.md#6-the-enforcement-tests-that-pin-the-privacy-properties) |

### Size and shape

Keep PRs focused and under about 400 lines. Do not refactor code unrelated to
the change — a diff that mixes a fix with a tidy-up is a diff where the fix
cannot be reviewed. Do not commit directly to `main`.

---

## 5. The comment standard

This is the part of the codebase most likely to surprise you, so it is worth
being explicit. Open `apps/pwa/src/services/access/session.ts` or
`apps/pwa/src/features/node/mesh.privacy.test.ts` and read the header before
writing your own.

### 5.1 Every module opens with a block that explains *why it exists*

The shape is consistent: an ALL-CAPS title line stating the module's one job or
its one rule, then named sections separated by full-width `=====` rules, in
prose, in complete sentences.

```typescript
/**
 * THE SIGN-IN THAT EXPIRED - noticed, instead of rendered as missing data.
 *
 * =============================================================================
 * THE BUG THIS EXISTS FOR
 * =============================================================================
 * A tester opened the app and reported "camera data is not loading" [...]
 *
 * =============================================================================
 * HOW IT IS DETECTED, AND WHY NOT BY CATCHING THE ERROR
 * =============================================================================
 * The TypeError from a blocked cross-origin redirect is indistinguishable from
 * the TypeError of being in a tunnel [...]
 */
```

Two sections do most of the work and are worth naming as a template: **the bug
this exists for**, and **why not the obvious approach**.

### 5.2 Comments describe failures, not features

The distinguishing habit: a comment here almost always names *the specific thing
that went wrong*, with the value, the file, or the incident. Not "handles the
edge case where the session expires" — but which tester, what they reported,
what the three screens each did with the answer they could not get, and why the
combination produced a confident picture of an app with no data in it.

Where a rule exists because of a real defect, **say which defect**. Compare:

```typescript
// BAD:  Validate the subject position before publishing.

// AS THIS REPO WRITES IT:
//   1. `fwm-report/v1` stored ONE coordinate, taken from `useCurrentFix()`, and
//      called it `position`. Readers treated it as the camera's location. It is
//      the driver's.
```

The second is longer and it is the one that survives the next person deciding
the check looks redundant.

### 5.3 Write down what is deliberately *not* done

An unexplained absence reads as an oversight and gets "fixed". So:

- Banned calls carry a line each saying **why that one specifically** — see the
  `FORBIDDEN_CALLS` block in `mesh.privacy.test.ts`, where seven Meshtastic
  calls each get their own sentence.
- When a rule is relaxed, the comment states what the old rule was, why it is no
  longer the right line, and what replaced it. `setChannel` moving out of the
  ban list is documented that way at length.
- Deliberately unimplemented paths use a `GAP:` marker pointing at the note that
  discusses them. There are **471** of them across **110** files, measured
  2026-08-29 — recount before quoting, it moves every week:

  ```bash
  rg -o 'GAP:' apps packages scripts functions --glob '!node_modules' | wc -l
  rg -lo 'GAP:' apps packages scripts functions --glob '!node_modules' | wc -l
  ```

  ```text
  GAP: see docs/gaps-inbox/dead-drop.md#an-export-carries-bodies-not-rows
  ```

  A marker must resolve. `services/crypto/plate.ts:204` points at
  `DESIGN-GAPS.md#plate-export-warning-copy-unspecified` and `DESIGN-GAPS.md`
  (repo root) has no such anchor — that is a broken marker, not an example to
  copy. If you add a marker, add the note in the same commit.

  A gap is not a TODO. It is a decision, recorded where somebody will hit it.

### 5.4 Cite the design, by its own reference

The UI was specified in a design document with numbered screens, and code that
implements a screen cites it in that document's own notation:

```
`01 · RADAR`   `A3 · CONNECT`   `B2 · DEAD DROP`   `A1 · ONBOARDING`
"HVK 8842" is the design's own example plate (Screens II, B5).
```

When copy or a measurement comes from the design, quote it and name the screen.
When the code departs from the design, say so and why — that is what
`DESIGN-GAPS.md` is for.

### 5.5 Exported symbols carry their reasoning

Constants especially. A magic number with a JSDoc explaining the trade-off is
the difference between a value somebody can safely change and one they cannot:

```typescript
/**
 * How far the vehicle must move before the tile set is recomputed.
 *
 * A z11 tile is about 15 km across, so recomputing on every GPS tick would be
 * thousands of identical set-comparisons per drive for a result that changes
 * every few minutes. 250 m is far below the tile size and far above GPS noise.
 */
export const RESYNC_DISTANCE_M = 250;
```

### 5.6 Tests carry the same headers, and often are the argument

A test that guards a privacy property opens with an explanation of the mistake
it exists to catch and why a comment would not have been enough. That is not
decoration — for the structural guards it is the only place the reasoning lives,
because the assertion itself is a one-line `not.toContain`.

Test names are behavioural sentences, and refusal tests are named as refusals:

```
it('NEVER falls back to the observer position')
it('writes nothing to the port when the guard refuses')
it('refuses to HYDRATE a tampered blob, drops it, and does not throw')
it('says nothing was ever stored rather than claiming a failed wipe')
it('joins nothing on its own - every channel write needs a press')
```

### 5.7 What not to do

- Do not restate the code. `// increment i` is worse than nothing.
- Do not leave a bare `TODO`. Use a `GAP:` with a link, or an issue.
- Do not write a comment claiming a property that a test could assert instead.
  The repo's own position, from `mesh.privacy.test.ts`: *"A comment saying so is
  not a control."* If the property matters, the comment explains the reasoning
  and a test enforces it.

---

## 6. Commit convention

[Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): description`.

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`
**Scopes** are the feature or subsystem: `mesh`, `map`, `drive`, `report`,
`queue`, `cameras`, `pwa`, `install`, `docs`, `help`.

### The subject line describes the behaviour, not the code

This is the distinctive part, and it is the convention for changes after the
squashed public release root. The subject says what a person gets, or what
stopped being wrong — in plain prose, lowercase, present tense, no full stop.

```
fix(mesh): your own message was coming back as a stranger
fix(report): stop filing the driver's location as the camera's
fix(map): the sweep measured itself while it was still detached
fix(queue): give the privacy hold a field the retry path cannot delete
feat(mesh): a node roster that survives 168 nodes
feat(report): the driver says where the camera was, in two taps
feat(mesh): DMs, an opt-in group join, and the pixel sweep
fix(install): the invite could never render on v0, and now a test says so
```

Not `fix(mesh): correct sender ID comparison in packet handler`. The symptom is
what a reader six months from now is searching for; the implementation is in the
diff.

### The body carries the reasoning

For anything non-trivial, the body is prose — often several hundred words —
using the same section headings as the code comments. It explains the failure,
why the obvious fix was wrong, and what was decided instead. From the public
release forward, `git log` is a design record and is treated as one. The release
root deliberately squashes audited pre-public development, so use the module
headers, tests, and public documents for reasoning that predates it.

Close with the state of the gates when it is a substantial change:

```
175 test files, 2739 tests, eslint clean, design gate clean.
```

### Attribution

Commits are authored by a human, under their own name and address. **Do not add
AI co-author or generated-by trailers.**

---

## 7. Non-negotiable rules

Violating any of these fails a test, a lint rule or review. They are listed with
the enforcement so you can check rather than remember.

### 7.1 A driver's coordinates have no egress path

Not "encrypted before sending". **No send.** The position store
(`apps/pwa/src/stores/position.ts`) is memory-only: never persisted, never
serialised into a URL, never attached to a notification, never logged. The only
sanctioned way a fix becomes text is `redact()`
(`services/adapters/geolocation.ts:140`) — three decimals, altitude dropped.
There is no debug mode that unlocks full precision and you may not add one.

If you believe your feature needs the exact position to leave the device, open
an issue before writing code. The answer is usually that the tile *address*
suffices, which is how camera sync works: the z11 id is computed on-device and
one tile is ~15 km across.

### 7.2 No plate value is persisted, in any shape

`assertPersistSafe` (`apps/pwa/src/stores/persist.ts`) walks every value on its
way into persistence and throws on a plate-shaped string, a plate-shaped **key**,
or a field whose **name** implies plate custody — `watchlist: []` throws even
when empty, because the shape must not exist. Plates live in the AES-GCM vault
under a non-exportable key.

Enforced by `stores/persist.test.ts`. Note the guard's own discipline: the
exception message never echoes the offending value, because an exception message
is a log line, a crash report and a bug ticket waiting to happen.

### 7.3 `localStorage` and `sessionStorage` are banned

`no-restricted-globals` in `eslint.config.js`, applied to `apps/pwa/src/**` and
`packages/*/src/**`. Web Storage is synchronous, unencrypted, readable by any
script on the origin and trivially snapshotted. Persistence goes through a
`PersistPort` the composition root installs; the built-in default is explicitly
**non-durable** and reports itself as such, so a store that was never given a
durable port says so rather than pretending it saved.

### 7.4 `console` is banned in app source

`no-console: error`, marked `PRIVACY INVARIANT`. A log line is the easiest place
for a coordinate or a plate to leak. A deliberate diagnostic needs an inline
disable, which forces you to write down why it is safe. Tests and `scripts/` are
exempt.

### 7.5 The mesh listens; it transmits only when a person presses something

Seven Meshtastic calls are banned outright — `sendPacket`, `sendWaypoint`,
`setModuleConfig`, `traceRoute`, `requestPosition`, `deleteMyNode`,
`factoryReset`. Four are allowed from **exactly one file**, `features/node/mesh.ts`:
`sendText`, `setChannel`, `setOwner`, `setConfig`. No transmit may be reachable
from a timer or a subscription handler.

Enforced by `features/node/mesh.privacy.test.ts`, which scans every source file
in `features/node` **and** `features/mesh`. If you add a directory that can reach
the mesh session, add it to `GUARDED` in that file.

A position must never reach the radio in any form: `latitudeI`, `longitudeI`,
`onPositionPacket` and `onWaypointPacket` are banned tokens.

### 7.6 An OSM write publishes the camera's position, never the driver's

`osmNodePosition()` must never fall back to the observer position, and a report
lacking a camera position must stay unpublishable. A report captured during the
demo drive is blocked by its `synthetic` flag — the demo writes fabricated
Chicago coordinates through the real position store, from a control that ships
in production builds.

Enforced by `features/report/osmEligibility.test.ts` and
`features/report/demoGuard.test.ts`. An OSM write is permanent, public and
attributed to a named human; the gate is deliberately asymmetric and so are the
tests.

### 7.7 No analytics, telemetry, crash reporting or third-party script

None. No beacon, no tag manager, no error sink, no CDN-hosted anything. Fonts
are self-hosted from `/fonts/*.woff2`. A PR adding any of these will be closed.

### 7.8 The publish hold belongs to `publishableAt`, not the transport

`nextAttemptAt` is transport state: `markFailed` overwrites it, `markSyncing`
nulls it, `due()` treats null as "run now". A privacy hold stored there is
destroyed by the first 429 — a jitter measured in days becomes a backoff
measured in seconds, in the error path nobody exercises by hand.
`publishableAt` is deliberately absent from `ReportSyncPatch` so touching it
fails to compile. Enforced by `services/db/publishHold.test.ts`.

### 7.9 Signed evidence is immutable

A finalised record is deep-frozen and has no update operation. A correction is a
**new** record whose `supersedes` names the one it replaces; the superseded
record stays in the chain forever. The one mutable field is `syncState`, which
is transport bookkeeping, is not covered by any hash or signature, and moves only
through `advanceSyncState`.

### 7.10 Dependencies

Check the CVE history and the last commit date before adding one, and pin the
version. Note the licence implication: this project is **GPL-3.0-only** because
`@meshtastic/js` is (see `NOTICE.md`), so a dependency's licence is a real
constraint, not a formality.

---

## 8. Design tokens

Every colour, size, spacing, radius, duration and easing curve in application
source must be `var(--fwm-*)`. The only files allowed to contain raw design
values are `apps/pwa/src/styles/tokens.css` and `tokens.json`.

```bash
pnpm check:design                                # 9,023 files, expect 0 violations
node scripts/check-design-values.mjs --fix-hint  # tells you which token to use
node scripts/check-design-values.mjs --json      # machine-readable
```

Exceptions live in `scripts/design-values-allowlist.json` — currently 20, each
with a written `reason`. They are for values that are **not visual**: slippy-map
zoom levels 0–22 are a tile-protocol constant; the 256/512 tile pixel size is
part of the XYZ scheme; geospatial thresholds in `packages/core` are
physical-world distances that must never be remapped by a display mode.

**Adding an allowlist entry needs a reason a reviewer would accept without you
in the room.** An allowlist is where a gate goes to die, one plausible exception
at a time.

---

## 9. Data, licences and OpenStreetMap

### The camera data is ODbL and the obligation travels

Every camera record originates in OpenStreetMap under **ODbL-1.0**. Every
published tile carries `attribution`, `licence`, and the exact `licenceUrl` in
its own body, and the UI must show "Map data © OpenStreetMap contributors"
wherever the points render. If you add a published artefact derived from this
data, it carries all three fields.
Details: [`DATA-PROVENANCE.md` §5](./DATA-PROVENANCE.md#5-the-odbl-obligation-by-obligation).

### The code is GPL-3.0-only

Not MIT. The relicence happened when `@meshtastic/js` was linked and the
reasoning is in `NOTICE.md`.

### Misuse records need a source

`apps/pwa/public/records/counties.json` makes public allegations about named law
enforcement agencies and shows them to drivers in those jurisdictions. Every
entry needs a county FIPS that resolves against the camera gazetteer, an agency,
a summary, a year, a positive integer incident count, and an `http(s)` source
URL with a name. `check:records` enforces the shape; **fetching the URL and
confirming it supports the claim is your job**, once, when you add the record.
An entry without a source a reader can open is not a record, it is an
accusation.

### The freshness pipeline has safety breakers — do not route around them

`scripts/sync-cameras.mjs` halts **without advancing its watermark** if one run
would tombstone more than 1% of live cameras or more than 500 absolute. CI runs
`scripts/sync-cameras.test.mjs` *before* the sync, because a bot that pushes to
`main` must not do so on a tree whose own rules are broken.

`scripts/fetch-cameras.mjs` refuses to run in a scheduled context on purpose:
Overpass's usage policy names country-scale scheduled polling as prohibited. The
hourly path reads OSMF replication diffs instead, which are published for
exactly that.

---

## 10. When a change requires a document change

The public documents are written to be checked against the code, with `file:line`
citations throughout. They go stale silently. Update them in the **same PR**:

| If you change… | Update |
|---|---|
| anything that crosses a network boundary | [`API.md`](./API.md) and the outbound table in [`ARCHITECTURE.md` §2](./ARCHITECTURE.md#2-what-leaves-the-device) |
| a record shape, a hash, a schema constant, a protobuf message | [`DATA-CONTRACTS.md`](./DATA-CONTRACTS.md) |
| the camera pipeline, a threshold, a breaker | [`DATA-PROVENANCE.md`](./DATA-PROVENANCE.md) |
| a flow, or you connect a dead end | the diagrams and the dead-end index in [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| a privacy property, or the commands that check one | [`AUDITING.md`](./AUDITING.md) |
| what the app can or cannot protect against | [`THREAT-MODEL.md`](./THREAT-MODEL.md) |
| a privacy answer on the HELP screen | its `checkIn:` citations — `check:help` will fail otherwise |
| the in-app documentation index | `apps/pwa/src/features/docs/docs.ts` |

Two standing rules for those files:

- **Cite `path:line`.** If a line number drifts, the symbol name beside it is the
  fallback. A claim without a citation is not checkable and does not belong.
- **Write the gaps down.** Where a path is built, tested and connected to
  nothing, the diagram says `GAP` and the prose says so in words. Those are the
  most useful entries in those documents, because they are the parts a reader
  would otherwise assume were finished.

If you find a document that disagrees with the code, **the code is right and the
document is a bug**. Report it or fix it; both are welcome.

---

## 11. Repository map

```
apps/pwa/            the product. React 19 + TS strict + Vite + Zustand + IndexedDB
  src/app/           shell, screen state, registry, build stamp
  src/features/      one directory per screen or capability
  src/services/      adapters, crypto, db, cameras, pwa, privacy
  src/stores/        eleven zustand slices; two of them persist
  src/styles/        tokens.css — the ONLY place raw design values live
packages/core/       pure geodesy, slippy tiles, alert state machine.
                     Zero React, zustand, browser or backend dependencies
packages/api-client/ empty placeholder; no OpenAPI contract is generated today
functions/           Cloudflare Pages Functions — camera reads and two admin routes
scripts/             the camera pipeline, the gates, deploy, preflight
the operator tooling             Node curation tools plus a tested, currently undeployed TS gateway
docs/public/         the documents this file belongs to. Written for strangers
transparency/        legal demands received, published in full
```

Tests live beside the code they test, as `*.test.ts` / `*.test.tsx`.
`scripts/*.test.mjs` uses `node --test`, not vitest.

---

## 12. Known traps

**Old virtual environments are ignored.** The current installer is Node-only,
but `.gitignore` and ESLint both use the broad `.venv*/` pattern so an artifact
from the pre-rename Python scaffold cannot enter a commit or lint run.

**vitest runs with `css: false`.** A stylesheet import is the empty string, so a
jsdom test cannot see a missing rule, an unresolved custom property, or one
element covering another. Tests that need to reason about CSS read the
stylesheet off disk with `readFileSync` — see
`features/radar/topblock.css.test.ts` for the pattern. For anything about
pixels, use `pnpm preflight`.

**`@fwm/core` is not in `apps/pwa/package.json`.** The app reaches it through
`src/stores/fwmCore.ts`, deliberately, and the comment at the top of
`services/cameras/sync.ts` explains why. Import through the bridge, not the
package name.

**Type-aware ESLint rules are off.** Not an oversight — they need a project
service covering the root config files, and `@types/node` is not an approved
dependency. `pnpm typecheck` runs the strict compiler over the same files, so
nothing goes unchecked; only the type-aware *lint* rules are deferred.

**The design gate scans `apps/pwa/public` too.** A raw hex colour in a
`.webmanifest` or an inline `<style>` in `index.html` fails it.

**Do not run `pnpm build` and then assume the deployed bundle matches.** The
commit stamp (`__FWM_COMMIT__`) is what ties a running build to a source tree,
and it is read at build time from git. A dirty tree stamps something you cannot
check out.

---

## Reporting a vulnerability

Privacy leaks count as vulnerabilities in this project — see
[`SECURITY.md`](./SECURITY.md). Do not open a public issue for one.

Community guidelines: [`../CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md).
