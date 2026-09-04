# gap inbox -- the v1 redesign

> **STALENESS WARNING, added 2026-08-30.** Mostly current - this is the v1 record - but three
> statements in "what the design draws that this build does not" have since been
> overtaken.
>
> MISUSE: "Left out at the owner's explicit instruction ... No screen id was
> added for it." It shipped. `apps/pwa/src/app/registry.v1.tsx:125` maps
> `misuse: MisuseScreen`, `misuse` is in `SECONDARY_SCREENS`
> (`app/screenState.ts`), and it is the first tile on MORE
> (`features/more/MoreScreen.tsx:185-189`), gated by
> `scripts/check-record-citations.mjs`.
>
> MESH SETUP: "already reachable inside MESH, which wraps `NodeScreen`". MESH
> no longer wraps `NodeScreen` - `features/mesh/MeshRadios.tsx:7` records the
> RADIOS tab dropping `<NodeScreen />` because it put a v0 surface inside a v1
> tab. MESH is three tabs now: Radios, Chat, Config
> (`features/mesh/MeshScreen.tsx:27-29`).
>
> DOCS is not mentioned at all and now ships as a screen
> (`registry.v1.tsx:126`) and a MORE tile (`MoreScreen.tsx:230-232`).
>
> Everything else here - the two seams, the container-plus-view list, the
> withheld numbers, the two bugs found - is still accurate and is the best
> single description of how v1 is built.
>
> Read instead alongside: `docs/STALENESS.md`.

Files: `apps/pwa/src/app/{design.ts,registry.v1.tsx,mirror.ts}`,
`apps/pwa/src/components/dock/{DockV1.tsx,dockV1.css}`,
`apps/pwa/src/features/{drive,exposure,mesh,more,alert}/**`, and the eight v1
VIEWS under `features/*/components/*V1.tsx`.

Source read: `.design-src-v1/FlockysWatchingMe.dc.html` in full, all fifteen
`sc-if` blocks plus the `renderVals()` data at the bottom.

## the shape of the redesign in this repo

Two seams, and neither one branches a v0 component.

  1. `registry.v1.tsx` maps an EXISTING screen id to a NEW component, and
     `main.tsx` merges it over the v0 registry. An id absent from it falls
     through to v0, which is what let the redesign land one screen at a time.
  2. A container that already had a view took a `view` PROP. SETTINGS, TRIAGE,
     INTEL, REPORT, ASK and ONBOARDING are all v0 containers - unedited logic -
     with a v1 view passed in. Nothing about the hydration gate, the watch
     rule, the queue writes, the speech adapter or the refusal trap has a
     second copy.

`ONBOARDING` needed its markup extracted into `components/OnboardingView.tsx`
first. That extraction is a MOVE - every element, class, testId and string is
what the screen rendered before it - which is why its 26 tests were untouched
by it.

## what the design draws that this build does not

  MISUSE (`isMisuse`)      the documented-abuse feed. Left out at the owner's
                           explicit instruction ("that's the news thing, leave
                           it"). No screen id was added for it.
  REROUTE                  see `alert-v1.md`. Needs a routing engine with an
                           avoid-set, not a link.
  LIQUID GLASS control     an on/off switch and a Light/Medium/Heavy level in
                           SETTINGS. `--fwm-surface-glass` and
                           `--fwm-glass-blur` are fixed tokens in the v1 layer,
                           so the control would move nothing. The tokens are
                           the seam it attaches to.
  WAKE WORD switch         in SETTINGS. ASK owns that decision and reads the
                           capability itself; SETTINGS has no state to write.
  INSTALL SHEET            (`isInstall`) and HOME SHORTCUTS (`isShortcuts`),
                           both bottom sheets. The install AFFORDANCE ships, as
                           a row on MORE wired to the real
                           `InstallPromptController` in all three of its states
                           - installable, installed, and a browser with no
                           `beforeinstallprompt` at all. The sheet around it is
                           chrome the affordance does not need.
  MESH SETUP tab           (`isMeshSetup`) as a separate screen. The flashing
                           flow it draws is already reachable inside MESH,
                           which wraps `NodeScreen`.

## the design's numbers, and what shipped instead

Every figure in `renderVals()` is a design-file invention. None was
transcribed. Where the product can measure the same thing it measures it, and
where it cannot the value is withheld rather than borrowed:

  ADMIN's 142/23/8/5 queue depths      em dashes. No moderation backend exists,
                                       and a moderator acting on a queue depth
                                       from a design file would be deciding
                                       about other people's reports on fiction.
  INTEL's CONFIRMED x3, 14 passes,     the model's own values, em-dashed where
  42 days known                        it reports `known: false`.
  MORE's "41 cases", "6 radios"        live counts or nothing. The mesh row
                                       reads presence, which is flagged OFF, so
                                       it describes the feature rather than
                                       reporting a sweep that never ran.
  TRIAGE's alert count                 `AlertProjection.projected`, null until
                                       there are drives to divide by.
  ONBOARDING's "132,068 cameras"       not shipped. First run is exactly when
                                       nothing has been cached, so the figure
                                       would describe a download that has not
                                       happened, on the one screen a driver has
                                       no way to check.
  ASK's five spoken commands           `TRY_CHIPS`, the questions the resolver
                                       actually answers. Three of the design's
                                       five cannot be done by this build.

## bugs this work found in already-shipped v1 screens

- DRIVE, EXPOSURE, MESH, OFFLINE and ADMIN all referenced
  `--fwm-settings-rule-w`, a local scoped to `.fwm-settings`. Every border
  and two heights resolved to nothing. Promoted to `--fwm-rule-w` and
  `--fwm-mark-w` on `:root`.
- `drive.css` used `--fwm-space-5`, which has never existed.

Both are the failure the preflight header describes: an unresolved custom
property is not an error, it is an empty string, and the declaration is
silently dropped.

## still open

- The `--fwm-swatch-*` triples in `tokens.css` are transcribed from the mode
  blocks above them by hand. Nothing compares the two, so a palette change
  can leave a swatch wrong. A test should read both.
- v0 and v1 now have two implementations of the alert takeover rule. See
  `alert-v1.md`.
- `more` renders the unbuilt placeholder under v0. Nothing navigates there
  under v0, so it is unreachable rather than broken - but it is the one id in
  `SCREEN_IDS` with no v0 component at all.
