# STALENESS - how to decode an old DarkRoute document

Written 2026-08-30. This file exists so that a document written against the v0
app can be read without reaching a wrong conclusion about the v1 app that
shipped.

## Why this file exists

Twice in one week a stale document produced a wrong answer, and neither time
was the document obviously wrong - it was specific, well cited, and describing
something real that had since moved.

- A watch-design note (`gaps-inbox/wear-os-dash.md`) was nearly treated as a
  head start on a Wear OS build. Its twelve panels, W1 through W12, describe
  v0 screens; four of them describe screens that no longer exist in any form.
  Designing against it would have built the wrong watch carefully.
- A pre-release comparison table claimed the app had no haptic, no notification
  and no camera persistence. All three had shipped. A release auditor read the row,
  found the README disagreed, correctly flagged a contradiction - and then
  guessed which side was false, picking the dangerous one. In a product whose
  job is to warn a driver, a stale comparison table does not merely mislead; it
  inverts the reviewer's conclusion.

The rule that follows from both: **a document that describes a screen must say
which design it describes, or it will be read as describing the shipped one.**

## The one fact that makes documents stale

`apps/pwa/src/app/design.ts:61`:

```ts
export const DEFAULT_DESIGN: FwmDesign = 'v1';
```

v0 is not deleted, but it is retired from the public product. An explicit
`?design=1` preview opt-in exposes the `V0 · ORIGINAL` / `V1 · CURRENT`
row in SETTINGS for that tab; without it, stored and requested values resolve
to v1 (`app/design.ts`). Every v0 component still renders when it is selected
under that deliberate preview. So a v0 document is not describing nothing. It
is describing a regression surface an ordinary user never sees.

The substitution is a registry merge, not a branch. `apps/pwa/src/main.tsx:266`:

```tsx
screens={designAtBoot === 'v1' ? { ...SCREENS, ...V1_SCREENS } : SCREENS}
```

An id absent from `V1_SCREENS` falls through to its v0 component. That is why
some v0 documents are still completely accurate and others are not: it depends
entirely on whether the id was claimed.

## The v0-to-v1 screen map

`v0` column cites `apps/pwa/src/main.tsx`; `v1` column cites
`apps/pwa/src/app/registry.v1.tsx`.

| screen id | v0 renders | v1 renders | kind of change |
|---|---|---|---|
| `radar` | `RadarWithIntel` / `RadarScreen` (`main.tsx:101`) | **`DriveScreen`** (`registry.v1.tsx:62`) | **replaced.** Instrument dial to a map with controls on it |
| `log` | `LogScreen` (`main.tsx:103`) | **`ExposureScreen`** (`registry.v1.tsx:65`) | **replaced.** Led by the count, not the table |
| `node` | `NodeScreen` / CONNECT (`main.tsx:122`) | **`MeshScreen`** (`registry.v1.tsx:68`) | **replaced.** Three tabs: Radios, Chat, Config |
| `offline` | `OfflineScreen` (`main.tsx:106`) | **`OfflineV1Screen`** (`registry.v1.tsx:71`) | **replaced** |
| `admin` | `AdminScreen` (`main.tsx:131`) | **`AdminV1Screen`** (`registry.v1.tsx:74`) | **replaced** |
| `lookup` | `LookupScreen` (`main.tsx:109`) | **`LookupV1Screen`** (`registry.v1.tsx:101`) | **replaced, and the question changed.** v0 asks whether an operator searched your plate; v1 asks where the cameras are, with the plate hand-off behind a row (`features/lookup/PlateHandoffV1.tsx`) |
| `help` | `HelpScreen` (`main.tsx:110`) | **`HelpV1Screen`** (`registry.v1.tsx:94`) | **replaced.** Both read the same `answers.ts` |
| `settings` | `SettingsScreen` (`main.tsx:108`) | `SettingsV1Screen` (`registry.v1.tsx:88`) | **container reuse** - v0 container, `view={SettingsViewV1}` |
| `triage` | `TriageScreen` (`main.tsx:123`) | `TriageV1Screen` (`registry.v1.tsx:91`) | **container reuse** - `view={TriageViewV1}` |
| `intel` | `IntelScreen` (`main.tsx:105`) | `IntelV1Screen` (`registry.v1.tsx:104`) | **container reuse** - `view={IntelViewV1}` |
| `report` | `ReportScreen` (`main.tsx:104`) | `ReportV1Screen` (`registry.v1.tsx:107`) | **container reuse** - `view={ReportViewV1}` |
| `ask` | `AskScreen` (`main.tsx:102`) | `AskV1Screen` (`registry.v1.tsx:110`) | **container reuse** - `view={AskViewV1}` |
| `onboarding` | `OnboardingScreen` (`main.tsx:107`) | `OnboardingV1Screen` (`registry.v1.tsx:117`) | **container reuse** - `view={OnboardingViewV1}` |
| `more` | *unbuilt placeholder* | **`MoreScreen`** (`registry.v1.tsx:81`) | **v1 only.** The hub for what v1's dock dropped |
| `misuse` | *unbuilt placeholder* | **`MisuseScreen`** (`registry.v1.tsx:125`) | **v1 only** |
| `docs` | *unbuilt placeholder* | **`DocsScreen`** (`registry.v1.tsx:126`) | **v1 only** |
| `dead-drop` | `DeadDropScreen` (`main.tsx:124`) | falls through to v0 | **unreachable** - see below |
| `zone-audit` | `ZoneAuditScreen` (`main.tsx:125`) | falls through to v0 | **unreachable under v1** - see below |
| `heat-map` | `HeatMapScreen` (`main.tsx:126`) | falls through to v0 | **unreachable under v1** - see below |
| `sweep` | *never registered* | *never registered* | **merged into `radar`** - see below |

### Container reuse is the distinction that matters most

Six v1 screens are not new components. `SettingsV1Screen`, `TriageV1Screen`,
`IntelV1Screen`, `ReportV1Screen`, `AskV1Screen` and `OnboardingV1Screen` each
render the **v0 container, unedited**, with a v1 view passed in - for example
`features/settings/SettingsV1Screen.tsx:15`:

```tsx
return <SettingsScreen view={SettingsViewV1} />;
```

So in a v0 document about one of those six:

- entries about **behaviour** - the hydration gate, the queue write, the
  permission flow, the refusal trap, the threshold maths - **still bind**,
  because the code that enforces them is the code still running.
- entries about **what is drawn** - sizes, rows, copy, layout - describe the v0
  view, which a driver on the default design does not see.

A banner that does not make this distinction is worse than none: it invites a
reader to discard a live gap entry as historical.

## SWEEP: the screen that is gone

SWEEP is the single largest source of stale text in `docs/`. It was merged into
RADAR by product decision on 2026-08-20 (`gaps-inbox/radar-sweep-merge.md`).

Proof, three ways:

1. There is no `SweepScreen.tsx` anywhere in the repository.
2. `sweep` is registered in **neither** registry (`main.tsx:100-132`,
   `registry.v1.tsx:55-127`).
3. `apps/pwa/src/app/screenState.ts:157-159` freezes
   `MERGED_SCREENS = { sweep: 'radar' }`, and `screenFromSearch` runs
   `redirectLegacyScreen` before anything renders, so `?screen=sweep` opens
   RADAR. The id survives only so old links and shortcuts do not 404.

What survives is the **code**, not the screen. `features/sweep/**` is a
component library RADAR draws with - see `features/radar/RadarScreen.tsx:50-71`
and `features/radar/components/RadarView.tsx:57-65`. The directory was
deliberately not renamed (`radar-sweep-merge.md`, "Open"), which is why a
document naming `features/sweep/` can still be pointing at live code while its
screen is fiction.

## Ids that render "screen not built"

`mesh`, `board`, `route`, `watchlist` and `record` are in `SCREEN_IDS`
(`app/screenState.ts`) and have **no component in either registry**. They render
`UnbuiltScreen` - the honest placeholder in `app/App.tsx`. A document
describing any of them is describing a design panel, never a shipped screen.

Note the `mesh` / `node` collision: `mesh` is the unbuilt A5 MESH FEED, while
v1's MESH surface is registered under `node` (`registry.v1.tsx:68`). Two
different things called MESH.

## Screens that ship but cannot be reached

This is the failure mode a banner is most needed for, because the code is real
and the tests pass.

- **ZONE AUDIT and HEAT MAP.** The only navigation to them is
  `features/log/LogScreen.tsx:206` and `:210`. Under the default design `log`
  is `ExposureScreen` (`registry.v1.tsx:65`), which contains no `openScreen`
  call at all, and neither screen is a MORE tile
  (`features/more/MoreScreen.tsx:185-263`). Reachable only by typing
  `?screen=zone-audit` / `?screen=heat-map`.
- **DEAD DROP.** Registered at `main.tsx:124` and falls through under v1, but
  there is no `openScreen('dead-drop')` anywhere in `apps/pwa/src` in either
  design. URL only.

`gaps-inbox/zone-audit.md` and `gaps-inbox/dead-drop.md` describe working code.
They are not evidence that a driver can get there.

## The dock changed shape, so "the dock key" is design-specific

| | v0 | v1 |
|---|---|---|
| source | `app/screenState.ts:56` | `components/dock/DockV1.tsx:66-75` |
| keys | RADAR · LOOKUP · ASK · LOG · NODE (five word-keys) | Drive · Log · Mesh · More · Search (five) |
| REPORT | a key in the bar (`components/dock/ReportKey.tsx`) | lifted out into its own circle (`DockV1.tsx:189`) |
| form | pinned panel | floating pill |
| picked by | default | `main.tsx:272` passes `DockV1` |

**ASK left the dock; LOOK UP did not.** Both remain MORE tiles under v1
(`features/more/MoreScreen.tsx:206-221`), and LOOK UP also has the far-right
Search key. Any document that reasons from "ASK arrives here from the dock key"
is reasoning about v0.

`components/dock/ReportBar.tsx` **does not exist** - it was renamed
`ReportKey.tsx` when v2 folded the standalone bar into the dock. The rename is
recorded at `gaps-inbox/dock-v2.md:321-322`. Four documents still cite the
deleted path.

## Trap: `.design-src-v1/` is NEWER than `.design-src-v2/` and `-v3/`

The directory names do not describe a sequence.

| directory | holds | is |
|---|---|---|
| `.design-src/` | `Flockys App Screens`, `Design System`, `Screens II`, `Watch` | the original v0 source |
| `.design-src-v2/` | adds `Flockys App Screens v2.dc.html` | a later revision **of v0** |
| `.design-src-v3/` | same family again | a later revision **of v0** |
| `.design-src-v1/` | `FlockysWatchingMe.dc.html` | **the v1 redesign source** - the newest of the four |

So "v2" in a document filename (`radar-v2.md`, `report-v2.md`, `sweep-v2.md`,
`log-v2.md`, `dock-v2.md`, `tokens-v2.md`, `lookup-ask-v2.md`) means *the
second drop of the v0 design files*, and has nothing to do with the `v0`/`v1`
axis in `design.ts`. `FWM_DESIGNS` has exactly two members
(`app/design.ts:49`). There is no v2 design in the product.

Every `*-v2.md` document therefore describes v0, one revision on.

## Files bannered on 2026-08-30

Twenty-two. Each carries a dated banner naming what was true, what changed with
a code citation, and what to read instead. None was deleted; they are the
record of decisions and of gaps that in many cases are still open.

| file | why it went stale |
|---|---|
| `sweep.md` | subject deleted; `SweepScreen.tsx` does not exist, `sweep` in neither registry |
| `sweep-v2.md` | same, plus names `glyph.ts`, which does not exist |
| `radar-screen.md` | `radar: DriveScreen` (`registry.v1.tsx:62`) |
| `radar-v2.md` | same; v2 delta against a screen the default replaces |
| `log.md` | `log: ExposureScreen`; its HEAT MAP / ZONE AUDIT footer keys are v0-only |
| `log-v2.md` | same |
| `offline.md` | `offline: OfflineV1Screen`; its "backing code" list is all v0 RADAR |
| `onboarding.md` | `onboarding: OnboardingV1Screen`; container reuse, drawn entries stale |
| `settings.md` | `settings: SettingsV1Screen`; container reuse; predates the DESIGN row itself |
| `triage.md` | `triage: TriageV1Screen`; container reuse; TRIAGE is now a MORE tile |
| `intel.md` | `intel: IntelV1Screen`; container reuse; "MODAL FROM SWEEP" names a dead screen |
| `report.md` | `report: ReportV1Screen`; container reuse; three citations point at deleted `ReportBar.tsx` |
| `report-v2.md` | same; already self-flagged three stale refs, missed a fourth |
| `ask.md` | `ask: AskV1Screen`; container reuse; ASK left the dock |
| `lookup-ask-v2.md` | **asserts a shipped feature does not exist** - see exclusions |
| `dock-report-bar.md` | both named files wrong; `ReportBar.tsx` deleted; wrong dock |
| `dock-v2.md` | measures v0's dock; the default renders `DockV1` |
| `zone-audit.md` | code live, navigation gone under v1 |
| `dead-drop.md` | code live, unreachable in either design |
| `tokens-v2.md` | measures v2 tokens as the end state; a whole v1 layer sits above (`tokens.css:996`) |
| `pwa-shell.md` | partial - `ReportBar()` gone, SWEEP treated as reachable, third manifest shortcut impossible |
| `v1-redesign.md` | partial - MISUSE shipped, MESH no longer wraps `NodeScreen`, DOCS unmentioned |

## Files verified still accurate

Thirteen. Each was checked against the code, not assumed.

| file | why it survived |
|---|---|
| `README.md` | describes the inbox process, not a screen |
| `alert-v1.md` | describes v1's own takeover; `features/alert/AlertV1.tsx` exists and is wired at `main.tsx:282` |
| `radar-sweep-merge.md` | the merge decision record itself; self-aware, and correctly notes `AlertRing.tsx` was deleted |
| `wear-os-dash.md` | already carries its own staleness reasoning about the W1-W12 panels; correct about `MeshScreen`'s three tabs |
| `core-engine.md` | `packages/core`; `HAPTIC_PULSES_BY_STATE` and the ring distances still exported |
| `crypto-evidence.md` | `services/crypto/plate.ts`; `exportPlatesWithWarning` still exists |
| `db-storage.md` | `services/db/policy.ts` + `backoff.ts` both present |
| `stores.md` | `PRESENCE_DISTANCE_PRECISION_MI` / `PRESENCE_EVENT_DELAY_MS` still in `stores/presence.ts` |
| `platform-adapters.md` | `services/adapters`; design-agnostic capability and permission rules |
| `sensor-runtime.md` | `app/sensors.ts` + `app/firstRun.ts`; `DEFAULT_SCREEN` is still `radar` |
| `simulator-fixtures.md` | `test/fixtures/tiles.ts` present; values are behavioural, not drawn |
| `design-value-enforcement.md` | about `scripts/check-design-values.mjs`, which still gates `pnpm lint` |
| `repo-tooling.md` | build and manifest tooling; design-agnostic |

The pattern: **a document goes stale when it describes a surface. A document
about an engine, a store, a policy or a script does not.** That is a useful
filter for the next sweep.

## How to check a document before trusting it

1. Find the screen id it is about. Look it up in the table above.
2. If the id is claimed in `registry.v1.tsx`, the drawn content is v0's.
3. Check whether it is container reuse. If it is, the behaviour entries still
   bind and only the drawn ones are stale.
4. Confirm every file path it names still exists. Four of these documents
   pointed at `ReportBar.tsx` and two at `SweepScreen.tsx`; a missing path is
   the cheapest possible staleness signal.
5. Confirm the screen can actually be reached, not merely that it renders.
   Registration is not navigation.

## Fixes this sweep found but did not make

These belong to files owned elsewhere and are reported rather than edited.

- `app/registry.v1.tsx:97-101` says v1's LOOKUP renders "v0's whole screen
  inside v1's, behind a row". That is no longer true:
  `features/lookup/PlateHandoffV1.tsx:5-9` records replacing the nested v0
  screen with v1 chrome. The registry comment is itself stale.
- `app/screenState.ts` still documents `intel` as
  "`A4 · INTEL CARD - MODAL FROM SWEEP`" and `mesh` as `A5 · MESH FEED` in the
  `SECONDARY_SCREENS` comment block. SWEEP is not a screen.
- ZONE AUDIT, HEAT MAP and DEAD DROP have no v1 entry point. Either add MORE
  tiles (`features/more/MoreScreen.tsx`) or record the decision that they are
  v0-only.
