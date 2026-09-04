# gap inbox -- SETTINGS

> **STALENESS WARNING, added 2026-08-30.** The drawn surface here is v0's. The behaviour is
> still live.
>
> `apps/pwa/src/app/registry.v1.tsx:88` maps `settings: SettingsV1Screen`, and
> v1 is the default (`apps/pwa/src/app/design.ts:61`).
> `features/settings/SettingsV1Screen.tsx:15` renders
> `<SettingsScreen view={SettingsViewV1} />` - the v0 CONTAINER, unedited, with
> a v1 view. The registry says so at `registry.v1.tsx:84-88`: "the one v1 entry
> that is not a new screen at all".
>
> Entries about `threshold.ts`, `modes.ts`, `storage.ts`, `removal.ts` and the
> hydration gate still bind. Entries about rows, cards, toggles and the drawn
> layout describe `components/SettingsView.tsx`, not the shipped
> `components/SettingsViewV1.tsx`.
>
> SETTINGS also contains the DESIGN axis this whole staleness problem hangs
> off, `V0 · ORIGINAL` / `V1 · CURRENT`, but only after an explicit per-tab
> `?design=1` preview opt-in. Ordinary SETTINGS does not offer the retired
> design. The row did not exist when this was written.
>
> Read instead: `features/settings/components/SettingsViewV1.tsx`,
> `docs/STALENESS.md`.

Files: `apps/pwa/src/features/settings/**` (`SettingsScreen.tsx`, `components/*.tsx`,
`settings.css`, `threshold.ts`, `modes.ts`, `storage.ts`, `removal.ts`).

Sources read: `Flockys Design System.dc.html` section 04 (`BUTTONS · h48 · radius 2`,
`TOGGLE · SLIDER · CHIPS`, `CARD · LIST ROW`), section 05 (`Theme modes`, all six
cards), section 06 (`PLATFORM BEHAVIOUR`, `SURFACE DETECTION`), section 07
(`WATCH RULES`), section 08 (tokens).

From `Flockys Screens II.dc.html`: `A1 · ONBOARDING - PERMISSIONS`, `A3 · CONNECT - NODE PAIRING`, `B4 · ALERT TRIAGE`, `B5 · PLATE WATCHLIST`, `B10 · CROSSING IN`.

From `Flockys App Screens.dc.html`: `01 · RADAR - IN RANGE` (the `SET` key) and `03 · LOOKUP - PLATE HISTORY` (the local-only footer).

From `Flockys Watch.dc.html`: `W10 · THRESHOLD - ROTARY BEZEL` and `W12` (the `STAYS ON THE PHONE - SAID OUT LOUD, NOT HIDDEN` card).

Also read for the storage contract: `docs/plate-data-handling.md`,
`apps/pwa/src/services/privacy/forget.ts`, `apps/pwa/src/services/db/index.ts`,
`apps/pwa/src/stores/settings.ts`, `apps/pwa/src/app/mode.ts`.

**The headline: SETTINGS IS NOT DRAWN ANYWHERE.** `DESIGN-GAPS.md#no-settings-screen-exists`
already records that, and lists three options. This build takes option (1) --
"compose it from the existing row/toggle/slider components and the ALERT AT slider
already drawn in section 04". Everything below is either a string that had to be
written because no panel says it, or a decision the sources do not answer.

**Every item the brief lists for screen 6, and where it went.** The same
`DESIGN-GAPS.md` entry records the brief as "alert distance slider, audio on/off

- volume, vibration toggle, WiFi sync status + manual trigger, database
freshness, screen wake lock toggle". Six items, one line each:

| brief item | here? | entry |
| --- | --- | --- |
| alert distance slider | BUILT | `ALERT AT`, section 04's slider |
| audio on/off | BUILT | the `Audio` switch -- label derived, see below |
| audio volume | ABSENT | `#audio-volume-has-nowhere-to-write` |
| vibration toggle | BUILT | the `Vibration` switch, quoted from section 04 |
| WiFi sync status + manual trigger | ELSEWHERE | `#wifi-sync-status-and-manual-trigger-live-on-dead-drop` |
| database freshness | ELSEWHERE | `#database-freshness-lives-on-offline` |
| screen wake lock toggle | ABSENT | `#four-stored-preferences-have-no-consumer` |

Only the wake-lock row is a *preference with no consumer*. The other three are a
missing field, a readout another screen owns and an action another screen owns,
so they get their own entries rather than being folded into that one --
"the product cannot honour it" is not an argument that applies to a readout.

## Cross-references, not new entries

- `DESIGN-GAPS.md#no-settings-screen-exists` -- this feature is that entry's
  option (1), now implemented. The entry can move from OPEN to STANDING IN.
- `DESIGN-GAPS.md#micro-type-below-stated-floor` -- SETTINGS' sites: the header
  strapline, every section eyebrow, every mode badge, every stored-item detail,
  the removal report and the two notices. All render at `var(--fwm-text-micro)`.
- `DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn` -- SETTINGS' half is
  `settings-are-not-durable-in-this-build` and the pre-hydration state below.
- `docs/gaps-inbox/design-value-enforcement.md#no-border-width-token` -- every
  1px hairline, the 2px slider ring and the 3px left rule, derived as
  `calc(var(--fwm-space-1) / 4 | / 2 | * 3 / 4)` in component-scoped locals.
- `docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized` -- every `.04em`,
  `.08em`, `.1em`, `.12em`, `.16em` and `.2em` on this screen, expressed as a
  `calc()` over the font size it applies to.
- `docs/gaps-inbox/radar-screen.md#spacing-scale-misses-10-14-and-30` -- the
  14px stack gaps in section 04 and B5 take `--fwm-space-3` (12px).

## the-whole-screen-is-composed

- **Status:** STANDING IN.
- **Need:** a SETTINGS layout.
- **Source:** none. `01 · RADAR - IN RANGE` draws a `SET` key with nowhere to go.
- **Stand-in:** header + four sections, in this order: `ALERT AT` (section 04's
  slider), `ALERTS` (section 04's toggles), `THEME MODES` (section 05's six),
  `STAYS ON THE PHONE - SAID OUT LOUD, NOT HIDDEN` (what is stored + the one
  removal control). The order runs most-used to most-destructive.
- **Options:** (1) keep it; (2) fold the threshold into RADAR's `VOL`/`SET`
  header keys and leave SETTINGS as privacy only; (3) draw a real panel.

## header-strapline-is-not-drawn

- **Status:** OPEN -- invented copy.
- **Need:** the right-hand strapline every Screens II header carries.
- **Source:** the pattern is drawn six times (`ON-DEVICE MATCHING`,
  `ALERT FATIGUE CONTROL`, `2 MI RADIUS`, ...). SETTINGS has no panel, so no string.
- **Stand-in:** `ON THIS DEVICE`.
- **Options:** (1) keep it -- it is the claim the rest of the screen has to keep;
  (2) `NO ACCOUNT · NO ANALYTICS`, which is quotable from A1 but reads as a boast;
  (3) no strapline, breaking the header pattern.

## alerts-section-caption-is-not-drawn

- **Status:** OPEN -- invented copy.
- **Need:** an eyebrow and a caption for the toggle group.
- **Source:** section 04 labels the panel `TOGGLE · SLIDER · CHIPS`, which is a
  spec label for a design system page and not UI copy.
- **Stand-in:** eyebrow `ALERTS`; caption `these narrow what alerts you. nothing
  widens it.` -- which is what `stores/alert.ts` already documents about the gate.
- **Options:** (1) keep; (2) drop the caption and let the two labels stand alone,
  as section 04 does; (3) quote B10's `SPOKEN ALOUD IF AUDIO IS ON` under the
  audio row and leave the group uncaptioned.

## four-stored-preferences-have-no-consumer

- **Status:** OPEN -- the reason four designed-looking switches are absent.
- **Need:** whether SETTINGS should render a switch for a preference the
  settings slice persists but no code reads.
- **Evidence:** `grep -rn 'wakeLock\|wifiOnlySync\|notifyWhenParked\|showHandle'
  apps/pwa/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v
  'stores/settings.ts'` returns no consumer for any of the four:
  - `wakeLock` -- `App.tsx` holds the lock off its own `holdWakeLock` prop
    (default `true`), never off the setting. Section 04 DRAWS this toggle
    (`Wake lock`) and section 06 states the behaviour
    ("wake lock while RADAR is foreground"), so it is the one whose absence is
    visible against the design.
  - `wifiOnlySync` -- `stores/sync.ts` declares the `'wifi-only'` hold reason and
    nothing ever sets it. `05 · LOG` draws `2 REPORTS QUEUED · SYNC ON WIFI`.
  - `notifyWhenParked` -- `B5` draws the row; nothing reads the field.
  - `showHandle` -- `session.ts#displayName(handle, showHandle)` takes it as a
    parameter and no caller supplies one; `FEATURES.presence` is off anyway.
  `vibration` and `audio` DO have consumers -- `useShouldVibrate` and
  `useShouldSpeak` in `stores/alert.ts` -- so those two are rendered, and
  `SettingsScreen.test.tsx` asserts a toggle actually shuts each gate.
- **Stand-in:** render only the two that are honoured. The task brief for this
  screen is explicit: "Do not add a setting the product cannot honour."
- **Options:** (1) keep them absent until a consumer exists -- each is a one-line
  change at the consumer, listed above; (2) render them disabled, the way
  `RadarAction` renders an unwired button, so the design's `Wake lock` row is at
  least present; (3) render them live and accept that three of them do nothing.
- **Leaning:** (1) now, (2) never -- a disabled row in a settings list reads as a
  broken app rather than as an honest one.
- **Scope note:** this entry covers FOUR PREFERENCES ONLY. It is not the reason
  audio volume, the WiFi sync readout or the database-freshness readout are
  absent -- see the three entries below. Folding those into this one would be
  reframing a readout as a preference to borrow an argument that does not fit.

## audio-volume-has-nowhere-to-write

- **Status:** OPEN -- brief item with no field behind it.
- **Need:** the brief's "audio on/off + VOLUME" for screen 6.
- **Evidence:** `stores/settings.ts` persists `audio` as a boolean and no slice
  anywhere carries a level -- `grep -rn 'volume' apps/pwa/src --include='*.ts'
  --include='*.tsx'` finds no preference, no selector and no consumer. The
  spoken channel is a GATE, not an attenuator: `stores/alert.ts#useShouldSpeak`
  returns `shouldAlertUser && audio`, a boolean, and there is no speech
  implementation for a level to be applied in -- `grep -rn
  'speechSynthesis\|SpeechSynthesis\|utterance' apps/pwa/src` returns nothing.
  No design file draws a volume control either; `01 · RADAR` draws a `VOL`
  header key whose behaviour is itself unspecified
  (`DESIGN-GAPS.md#vol-key-unspecified`).
- **Related, and worth being straight about:** `useShouldSpeak` currently has no
  non-test caller either. The `Audio` switch is rendered because it NARROWS a
  gate that exists in code and is tested end to end
  (`SettingsScreen.test.tsx`), not because a speaking adapter honours it today.
  That is a weaker claim than the one made for `Vibration`, whose gate feeds
  `useHapticPulses` and the vibration adapter, and it is stated here rather than
  left implied.
- **Stand-in:** none. A slider that moves nothing is the control the brief for
  this screen forbids, and `components/SettingsView.test.tsx` asserts SETTINGS
  renders exactly one slider so one cannot appear by accident.
- **Options:** (1) leave it out until a level exists end to end -- a `volumePct`
  in the settings slice AND an attenuation in the speech path; (2) add both in
  one change and render the slider; (3) render the slider disabled, which reads
  as a broken app.

## wifi-sync-status-and-manual-trigger-live-on-dead-drop

- **Status:** OPEN -- brief item, already built on another screen.
- **Need:** the brief's "WiFi sync status + manual trigger" for screen 6.
  `05 · LOG` draws the string it would render: `2 REPORTS QUEUED · SYNC ON WIFI`.
- **Evidence:** the data is real and the screen exists. `stores/sync.ts` publishes
  `useSyncStatus`, `useSyncHold` (`'offline' | 'wifi-only' | 'backing-off'`),
  `usePendingSyncCount`, `useHeldReportCount` and `useLastSyncAtMs`;
  `B2 · DEAD DROP` (`features/dead-drop`) renders the queue, the counts and the
  `SYNC NOW` key off exactly those. The trigger itself is an injected handler
  there and `DeadDropScreen.tsx`'s own comment records that no upload path
  exists in this build.
- **Stand-in:** none here. The argument is TRIAGE's, not the no-consumer one: a
  second copy of a readout is a second place to change it, and a second
  `SYNC NOW` would be a second inert button rather than one. What IS missing is
  a route from SETTINGS to DEAD DROP, which needs `main.tsx`
  (see `#set-key-is-still-inert`).
- **Options:** (1) leave the readout on DEAD DROP and add a link once the screen
  registry is wired; (2) render a read-only status line here off the sync slice,
  accepting that it reads `0 QUEUED` until some other screen has read the
  durable queue back -- an unread count printed as a measured one; (3) move the
  whole queue readout into SETTINGS and reduce DEAD DROP to the list.
- **Note:** `wifiOnlySync` -- the PREFERENCE behind "sync on wifi" -- is a
  separate matter and is covered by `#four-stored-preferences-have-no-consumer`:
  nothing sets the `'wifi-only'` hold reason, so the toggle would not be honoured.

## database-freshness-lives-on-offline

- **Status:** OPEN -- brief item, already built on another screen.
- **Need:** the brief's "database freshness" for screen 6.
- **Evidence:** real and rendered. `services/db/schema.ts#TileMetaRecord` carries
  `freshness: 'fresh' | 'stale' | 'unknown'` and `lastCheckedAt`;
  `services/db/index.ts#estimateUsage()` reports row counts and quota;
  `A2 · OFFLINE - DEGRADED` (`features/offline`) reads them and renders
  `components/CacheNotice.tsx` plus the cached-camera counters.
- **Stand-in:** none here, for two reasons. Same one as above -- a second copy is
  a second place to change it -- and one specific to this screen: SETTINGS never
  opens the database except through the removal port, and `CacheNotice`'s own
  comment says a sentence that guesses at the freshness of a database it has not
  opened is the exact failure that warning exists to prevent.
- **Options:** (1) leave it on OFFLINE and link once the registry is wired;
  (2) read the cache from SETTINGS too and render the same notice, at the cost
  of a second reader and a second pending state; (3) render `estimateUsage()`'s
  row counts in the `STAYS ON THE PHONE` list instead of prose -- which is
  option (3) of `#stored-item-copy-is-written-not-quoted`, and truer but much
  less readable.

## audio-toggle-label-is-not-drawn

- **Status:** OPEN -- invented copy. Previously mis-attributed.
- **Need:** the label on the switch that gates the spoken channel.
- **Source:** NOT section 04. Its `TOGGLE · SLIDER · CHIPS` panel draws exactly
  two toggle rows (`Flockys Design System.dc.html` lines 307-313) and they are
  `Vibration` and `Wake lock`. `Vibration` is quoted verbatim; `Wake lock` is
  the row this build cannot honour (`#four-stored-preferences-have-no-consumer`).
  No design file draws a toggle labelled `Audio` -- the nearest drawn string for
  the channel is `B10 · CROSSING IN`'s `SPOKEN ALOUD IF AUDIO IS ON`
  (`Flockys Screens II.dc.html` line 805).
- **Stand-in:** `Audio`, derived from B10 and set in section 04's sentence casing
  so the two rows match. `components/SettingsView.tsx` now says so at the
  constant rather than claiming section 04 as the source.
- **Options:** (1) keep `Audio`; (2) `Spoken alerts`, which describes what the
  gate does and matches B10's verb; (3) quote B10 under the row as a caption and
  leave the label bare, which is option (3) of
  `#alerts-section-caption-is-not-drawn`.

## mode-lock-is-read-off-the-surface-not-off-the-reason

- **Status:** RESOLVED IN CODE, recorded because it is a trap the next reader
  will walk into.
- **Need:** the picker locked whenever the always-on watch rule applies.
- **Evidence:** `app/mode.ts#resolveMode` returns
  `reason: requested === DEFAULT_MODE ? 'requested' : 'forced-watch'` on a watch
  surface. `DEFAULT_MODE` is `night-watch` and `stores/settings.ts` defaults
  `mode` to it, so on the COMMON case -- a watch that has never had a mode
  picked -- the reason is `'requested'`. Locking the picker off
  `reason === 'forced-watch'` therefore left all six rows live in exactly the
  default state, swallowed the first press, and still persisted the picked mode
  into the settings blob from a wrist before the row went inert.
- **Stand-in:** `SettingsScreen` asks `isWatchSurface(onSurface)` instead, and
  `onModePick` refuses the write as well as the paint. `ModePicker` renders all
  six rows inert when locked rather than five. `SettingsScreen.test.tsx` covers
  the default-mode watch, both watch shapes and the attempted press.
- **Options:** (1) keep the surface test in the feature; (2) add a
  `locked: boolean` to `ResolvedMode` in `app/mode.ts` so every caller gets the
  same answer without re-deriving it -- a shared-file change, and the better
  long-term home; (3) change `resolveMode` to report `'forced-watch'` whenever
  the surface is a watch, which loses the distinction between "we overrode you"
  and "you happened to agree".

## section-04-toggle-hue-differs-from-b4

- **Status:** RESOLVED IN CODE, recorded because it produced a second component.
- **Need:** which hue a pill switch takes.
- **Source:** section 04 draws the component toggle ON in `#3DE08A`
  (`--fwm-alert-clear`). `B4` and `B5` draw their switches ON in `#FF2D5E`
  (`--fwm-alert-in-range`). Both are correct: B4/B5's switches decide whether a
  camera alerts you and are part of the alert language; section 04's decide how
  the app behaves and carry no alert meaning.
- **Stand-in:** `features/settings/components/SettingsSwitch.tsx`, geometrically
  identical to `TriageSwitch` (same tokens, same derivations) and green when on.
  `TriageSwitch`'s `tone` union is `'alert' | 'pierce'`; adding a third would
  mean editing a file this feature does not own.
- **Options:** (1) keep two components; (2) widen `TriageSwitch`'s tone union to
  `'alert' | 'pierce' | 'neutral'` and delete `SettingsSwitch`; (3) promote the
  pill to a shared `components/` primitive, which is where it probably belongs
  now that three screens draw it.

## stored-mode-is-not-applied-at-boot

- **Status:** OPEN -- engineering, not design.
- **Need:** the persisted theme mode applied before the first paint.
- **Evidence:** `main.tsx` calls `applyMode(DEFAULT_MODE, surface)` synchronously
  and its own comment says "A persisted mode preference, when SETTINGS gains one,
  replaces this argument and nothing else". SETTINGS now has one, but `main.tsx`
  is the shell's file and not this feature's to edit.
- **Stand-in:** `SettingsScreen` reconciles the stored mode onto `<html>` through
  `applyMode()` while it is open, so a pick takes effect on the press and a
  re-open restores it. A reload lands on Night Watch until SETTINGS is opened.
- **Options:** (1) `main.tsx` reads the persisted blob before render -- it is
  async, so this needs either a synchronous mirror or one frame of the default;
  (2) write the mode into a cookie/`localStorage` mirror and read it in the
  inline surface snippet, which is what section 06 already does for the surface;
  (3) leave it -- the mode is cosmetic and the wrong skin for one frame is not a
  safety problem.

## forced-watch-copy-is-not-drawn

- **Status:** OPEN -- invented copy.
- **Need:** what SETTINGS says when the watch rule has overridden the pick.
- **Source:** section 05 states the rule ("Night Watch is ... the only mode
  allowed on the always-on watch face") and `app/mode.ts` reports it as
  `reason: 'forced-watch'`, with its own comment asking for "night watch · locked
  on this device". No panel renders the sentence.
- **Stand-in:** `night watch is the only mode an always-on watch face may use.`,
  with the other five rows disabled.
- **Options:** (1) keep; (2) use mode.ts's own phrasing verbatim; (3) hide the
  picker entirely on a watch, which hides the rule along with it.

## mode-cards-are-not-reproduced

- **Status:** STANDING IN.
- **Need:** how a mode is previewed.
- **Source:** section 05 draws each mode as a full RADAR mock -- hero digits,
  direction line, tiles, scanner bar, VFD segments.
- **Stand-in:** a row per mode: the card's title and its mono badge, nothing else.
  A shrunken non-live copy of RADAR inside SETTINGS would be placeholder data
  wearing a design's clothes, and picking a mode reskins the screen the user is
  already looking at -- which is a better preview than a thumbnail.
- **Options:** (1) keep rows; (2) build real mini-previews driven by live store
  values; (3) build static thumbnails, which is the placeholder-data option and
  is ruled out by the house rules.

## no-confirmation-pattern-is-drawn

- **Status:** OPEN.
- **Need:** how a destructive action is confirmed.
- **Source:** none. No design file draws a confirmation dialog, an alert sheet or
  a hold-to-confirm. `A3` draws `FORGET NODE` as a plain single-press button and
  section 04 draws `Clear alert log` the same way.
- **Stand-in:** two presses on the same control -- the first arms and shows what
  is about to happen, the second commits, with a `CANCEL` beside it. No modal:
  the design ships none anywhere, and a sheet over a driving screen is worse than
  a second tap on the control already under the thumb.
- **Options:** (1) keep two-press; (2) `openOverlay({kind:'modal'})`, which
  `screenState.ts` already supports, at the cost of inventing a modal design;
  (3) press-and-hold, mirroring the REPORT bar's 1s hold-to-drop-a-pin.

## removal-button-label-is-not-drawn

- **Status:** OPEN -- invented copy.
- **Need:** the label on the removal control.
- **Source:** the closest drawn strings are `FORGET NODE` (A3) and `Clear alert
  log` (section 04). Neither describes what `forgetLocalIdentity()` does, which
  is wider than an alert log and narrower than "everything".
- **Stand-in:** `FORGET ME` / `TAP AGAIN TO CONFIRM` / `Forgetting…` (the last
  mirrors section 04's `Syncing…` disabled state).
- **Options:** (1) keep; (2) `DELETE LOCAL DATA`, plainer and less in-voice;
  (3) `FORGET THIS DEVICE`, which reads as unpairing rather than erasing.

## privacy-heading-borrowed-from-w12

- **Status:** OPEN -- quoted copy used in a new context.
- **Need:** a heading for the privacy section.
- **Source:** `W12`'s card is titled `STAYS ON THE PHONE - SAID OUT LOUD, NOT
  HIDDEN`, but there it means "these features live on the phone, not the watch".
  On the phone it reads as "this data stays on the phone", which is what this
  section is about -- the same sentiment, a different referent.
- **Stand-in:** the string, verbatim.
- **Options:** (1) keep; (2) `WHAT THIS DEVICE STORES`, unambiguous and invented;
  (3) split: keep W12's title on the watch handoff list and write a new one here.

## stored-item-copy-is-written-not-quoted

- **Status:** OPEN -- invented copy, seven rows.
- **Need:** the labels and one-line details in `storage.ts#STORED_ITEMS`.
- **Source:** the dispositions are read off code (`clearLocalData()`,
  `destroyVault()`, `docs/plate-data-handling.md#removal`), so the FACTS are not
  invented. The sentences are, because no panel lists what a device holds.
- **Stand-in:** one row per real object store, each with `REMOVED` / `KEPT` /
  `STAYS`. `SIGNED CAMERA REPORTS` is `KEPT` and says why before the button is
  pressed, rather than only in the report afterwards.
- **Options:** (1) keep; (2) lift the wording from the public privacy page once
  it exists, so the two cannot diverge; (3) render the store names and row counts
  from `estimateUsage()` instead of prose -- truer, much less readable.
- **Note:** the three sentences in `PRIVACY_PROMISES` are quoted verbatim from A1
  and `03` and must not be reworded here; they are also the public claims.

## threshold-detent-rules-are-not-machine-checked

- **Status:** OPEN -- test coverage, not design.
- **Need:** proof that `settings.css` has a rule for every value the slider can
  hold. The fill width and the knob offset are one rule per detent, keyed off
  `data-fwm-threshold-ft`, because the alternative is an inline style and inline
  styles are how raw values get past `scripts/check-design-values.mjs`.
- **Evidence:** `apps/pwa/vitest.config.ts` sets `css: false`, so an imported
  stylesheet is an empty string, and `apps/pwa/tsconfig.json` does not include
  `@types/node`, so a test cannot `readFileSync` the file either.
- **Evidence, corrected:** `./settings.css?raw` is ALSO the empty string under
  `css: false` -- probed, not assumed -- so there is no import form that reaches
  the bytes either.
- **Stand-in:** the stylesheet is NOT generated. `THRESHOLD_STOPS` is derived
  from the engine's three numbers and the nineteen rules are hand-written; an
  earlier version of this entry and of `threshold.ts` claimed both came from
  "the same three numbers", which was false and would have let a bounds change
  ship a knob pinned to the far left under a readout saying `125 FT`. So:
  1. the transcription is written down as data --
     `threshold.ts#THRESHOLD_CSS_STOPS`, one entry per rule -- and
     `threshold.test.tsx` asserts it equals `THRESHOLD_STOPS`. Change
     `ALERT_THRESHOLD_MIN_FT` / `_MAX_FT` / `_STEP_FT` without touching
     `settings.css` and the suite fails and names the drift.
  2. for anything that still slips through, `hasDetentRule()` drives
     `data-fwm-threshold-covered` on the control, and `settings.css` WITHHOLDS
     the drawn fill and knob when it is false. The measured number still shows;
     the position does not get invented.
  Neither catches an edit to `settings.css` alone, which is the residue.
- **Options:** (1) add a node-side check to `scripts/` alongside
  `check-design-values.mjs` -- the only option that closes the residue, and the
  leaning; (2) add `"types": ["node"]` to the pwa tsconfig and read the file in
  the test; (3) set `css: true` for this one file, which slows every suite.

## settings-are-not-durable-in-this-build

- **Status:** OPEN -- engineering, surfaced rather than hidden.
- **Need:** a durable persist port.
- **Evidence:** `stores/persist.ts` defaults to `createMemoryPersistPort()` and
  nothing installs an IndexedDB-backed one, so `useSettingsStore` reports
  `durable: false` with the reason "settings are held in memory for this session
  only; no durable store has been installed".
- **Stand-in:** SETTINGS renders that reason, verbatim, in the amber-ruled
  caveat block Screens II uses for exactly this kind of statement. It is not this
  feature's to fix: `stores/persist.ts` is a shared file.
- **Options:** (1) install an IndexedDB port at boot; (2) leave it and keep the
  notice; (3) hide the notice, which would mean the threshold silently resetting
  on every reload with no explanation.

## slider-thumb-and-drawn-knob-alignment

- **Status:** RESOLVED IN CODE, recorded because it is non-obvious.
- **Need:** the native range thumb and the drawn knob to sit in the same place.
  A native thumb's centre travels from `thumb/2` to `width - thumb/2`; section
  04's knob is positioned at a straight percentage with `margin-left:-18px` and
  overhangs both ends.
- **Stand-in:** the transparent `<input type="range">` is inset by
  `calc(var(--fwm-settings-knob) / -2)` on each side, which makes its thumb
  centre travel the full 0-100% the drawn knob does.
- **Options:** (1) keep; (2) inset the drawn knob instead and diverge from
  section 04's picture; (3) drop the native input and handle pointer maths,
  losing keyboard stepping and the slider role.

## set-key-is-still-inert

- **Status:** OPEN -- needs a one-line change in a file this feature does not own.
- **Need:** `01 · RADAR - IN RANGE`'s `SET` key to open this screen.
- **Evidence:** `features/radar/components/RadarHeader.tsx` already renders
  `<HeaderKey label="SET" onPress={onSettings} />` and renders it disabled when
  no handler is passed; `screenState.ts` already reserves the `settings` id;
  `main.tsx` owns the shared screen registry, outside this feature. So the
  whole wiring is a registry entry plus one `onSettings` prop.
- **Stand-in:** none. The screen is reachable by `?screen=settings` once the
  shared settings shell registers it.
- **Options:** (1) register `settings: SettingsScreen` in `main.tsx` and wire
  `SET` to `openScreen('settings')`; (2) leave `SET` inert, which
  `DESIGN-GAPS.md#no-settings-screen-exists` already calls dishonest.
