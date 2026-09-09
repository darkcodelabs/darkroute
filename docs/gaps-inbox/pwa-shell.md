# Gap inbox - PWA shell (surface, mode, screen state, manifest, service worker)

> **STALENESS WARNING, added 2026-08-30.** Partly stale. The surface, mode and screen-state
> entries hold; the dock and SWEEP ones do not.
>
> Line 107 says `apps/pwa/src/components/dock` exposes `Dock()` and
> `ReportBar()`. `ReportBar` does not exist - it is `ReportKey.tsx` now
> (`dock-v2.md:321-322`) - and the shipped dock is `DockV1`
> (`apps/pwa/src/main.tsx:272`), a five-key pill, so the
> `dash-surface-needs-a-rail-not-a-bottom-dock` entry's "duplicates the five
> word-keys" option is costed against the wrong dock
> (`components/dock/DockV1.tsx:66-76`).
>
> Lines 59, 61, 86 and 97 treat SWEEP as a reachable screen and propose a third
> manifest shortcut for it. SWEEP merged into RADAR on 2026-08-20
> (`apps/pwa/src/app/screenState.ts:157-159`); `public/manifest.webmanifest`
> ships two shortcuts, RADAR and Report camera. A watch gesture layer whose
> "swipe left = SWEEP" cannot be built as drawn.
>
> Everything about `surface.ts`, the four breakpoints, the mode rules and the
> service worker is design-agnostic and still current.
>
> Read instead: `radar-sweep-merge.md`, `docs/STALENESS.md`.

Recorded during the PWA-shell implementation pass. Screen-specific detail stays
here; cross-cutting decisions are indexed in `DESIGN-GAPS.md`.

## surface-breakpoints-are-not-tokens

- need: a token family for the four viewport breakpoints that decide which surface a device is -
  `320px`, `420px`, `300px` and `700px`.
- screen: every screen. This is the one decision that picks the layout for all of them.
- source: "Flockys Design System.dc.html" section 06, panel "SURFACE DETECTION - ONE ENTRY POINT
  PICKS THE LAYOUT", renders them literally inside three media queries:
  `matchMedia('(max-width: 320px) and (max-height: 420px)')`,
  `matchMedia('(display-mode: standalone) and (max-width: 300px)')` and
  `matchMedia('(min-width: 700px) and (orientation: landscape)')`. Section 08 exports no
  `--fwm-breakpoint-*` variable and neither does `tokens.json`.
- stand-in: the literals, kept exactly as the design writes them, because the brief requires that
  snippet verbatim. `scripts/design-values-allowlist.json` carries an entry for
  `apps/pwa/src/app/surface.ts` so the design-value checker accepts them.
- options: (1) leave them as literals and keep the allowlist entry - recommended: a breakpoint is
  not a painted value, and putting it behind a `--fwm-*` custom property would let a theme mode
  change which surface a device resolves to, which is the one thing a mode must never do;
  (2) export `--fwm-bp-watch-w/h`, `--fwm-bp-watch-standalone`, `--fwm-bp-dash` from section 08 and
  read them with `getComputedStyle` before the first render, which costs a synchronous style read
  on the critical path; (3) hold them in a plain TypeScript constants module outside the token
  system, which is honest but splits "values the design decided" across two places.

## manifest-shortcuts-radar-not-sweep

- need: a decision on which two screens the manifest shortcuts open.
- screen: the Android long-press launcher menu.
- source: "Flockys Design System.dc.html" section 06, panel MANIFEST TOKENS renders
  `shortcuts     Report camera · Sweep`.
- stand-in: `scripts/generate-assets.mjs` emits RADAR and REPORT, per the build brief, at
  `/?src=shortcut&screen=radar` and `/?src=shortcut&screen=report`. The REPORT shortcut keeps the
  design's own label, "Report camera"; the RADAR one uses the dock word-key, "RADAR".
- options: (1) keep RADAR + REPORT - recommended: RADAR is the product and a shortcut that opens it
  directly is the fastest path from a locked phone to a warning, whereas SWEEP is reachable in one
  tap once the app is open; (2) restore the design's Report camera + Sweep; (3) ship three
  shortcuts (RADAR, SWEEP, REPORT), which Android allows and which costs nothing but a longer menu.

## maskable-safe-zone-is-a-box-in-the-design-and-a-circle-on-the-platform

- need: agreement on what "20% safe padding" measures against.
- screen: the Android home-screen icon and the round watch face.
- source: "Flockys Design System.dc.html" section 06, panel SPLASH · HOME ICON renders
  `icon: white mark on pure black, no rounded box baked in. maskable variant adds 20% padding.`
  Section 07, WATCH RULES renders `circular safe zone: inner 70% of diameter`. A maskable icon's
  safe zone is a circle covering 80% of the icon; a rectangle that is 60% of the icon's width is
  not automatically inside it, because its corners sit up to 41% further from the centre.
- stand-in: `scripts/generate-assets.mjs` fits the mark's DIAGONAL inside the safe circle rather
  than fitting its width inside a box. That lands the mark at 58.6% of the 512 icon's width - within
  1.4% of the 60% the design's wording implies - and at 51.0% of the 384 watch icon's width. Both
  are asserted by a test that recomputes the worst-corner radius from the committed PNGs.
- options: (1) keep the circular fit and restate the design as "fits the 80% safe circle" -
  recommended, it is the constraint the platform actually enforces; (2) take "20% padding" literally
  as a box and accept that a wider mark can clip on a circular mask; (3) commission a second,
  squarer lockup of the mark specifically for maskable use, which would make box and circle agree.

## watch-navigation-has-no-implementation

- need: the gesture layer that replaces the dock on a watch.
- screen: every watch screen.
- source: "Flockys Design System.dc.html" section 07, WATCH RULES renders
  `no bottom nav: swipe left = SWEEP, right = dismiss, long-press = mute 10 min,`
  `rotary bezel = threshold`, plus `touch target 48px, min 24px between targets`.
- stand-in: `apps/pwa/src/app/App.tsx` renders NO dock and NO report bar when
  `data-fwm-surface` is `watch-round` or `watch-square`, because a 44px-minimum dock inside a 384px
  round face eats the circular safe zone. Nothing replaces it yet, so a watch build can currently
  reach only the screen it opens on. The screen-state adapter already supports the destinations -
  `openScreen('sweep')`, `closeOverlay()` and the alert interrupt - so the gesture layer is a
  binding, not new navigation.
- options: (1) build a `WatchGestures` component that binds swipe/long-press/rotary to the existing
  `openScreen` / `closeOverlay` / mute calls - recommended; (2) render a reduced two-key dock on the
  watch, which the design explicitly rules out; (3) ship the watch as a single always-on RADAR face
  with no navigation at all, which matches "one hero number, one hue, one word" but drops SWEEP.

## dash-surface-needs-a-rail-not-a-bottom-dock

- need: a rail form of the dock for the dash surface.
- screen: the dash / head-unit layout.
- source: "Flockys Design System.dc.html" section 08 declares `--fwm-nav-w: 88px` inside
  `[data-fwm-mode="dash-cast"]` with the comment `/* rail replaces bottom nav */`, and the same
  block raises `--fwm-touch-min` to `68px`.
- stand-in: `apps/pwa/src/app/App.tsx` renders the same fixed bottom chrome on `dash` as on `phone`,
  because `apps/pwa/src/components/dock` exposes `Dock()` and `ReportBar()` with no orientation
  prop and `.fwm-dock` is a horizontal row. `--fwm-nav-w` is therefore declared and unused.
- options: (1) give `Dock` an `orientation: 'bottom' | 'rail'` prop and have the shell pass `rail`
  on the dash surface - recommended, it keeps one component and one active-key rule;
  (2) add a separate `DockRail` component, which duplicates the five word-keys and the active-key
  logic; (3) leave the bottom dock on dash and delete `--fwm-nav-w`, accepting that a head unit
  loses vertical space it has plenty of and horizontal space it does not.
