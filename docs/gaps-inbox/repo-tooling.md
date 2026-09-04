# Gap inbox - repository tooling and build foundation

Recorded during the repository-tooling pass. Tooling-specific detail stays here;
cross-cutting decisions are indexed in `DESIGN-GAPS.md`.

## pwa-icon-set-not-generated

- need: PWA manifest icons at 192x192, 512x512 and a 512x512 maskable variant with 20% safe padding.
- screen: install / home-screen icon and splash on Android; the manifest emitted by vite-plugin-pwa.
- source: "Flockys Design System.dc.html" section 06, panel MANIFEST TOKENS renders `icons  192 · 512 · 512 maskable (eye mark, 20% safe padding)`, and the panel beside it renders "icon: white mark on pure black, no rounded box baked in. maskable variant adds 20% padding."
- stand-in: the manifest declares the one raster that exists in the repo, `apps/pwa/public/assets/darkroute-mark.png`, at its real dimensions (1273x1236). No icon is claimed that does not exist. Consequence: Android has no maskable icon, so the launcher letterboxes the mark instead of filling the adaptive shape.
- options: (1) generate all three from the existing 1273x1236 master in `scripts/generate-assets.mjs` and commit them - recommended, the source raster is large enough; (2) add `@vite-pwa/assets-generator` and generate at build time, which needs a new dependency approval; (3) ship the single icon and accept a letterboxed launcher icon.

## type-metrics-not-tokenized

- need: line-height and letter-spacing tokens to pair with the six `--fwm-text-*` sizes.
- screen: every screen. RADAR's hero readout is the sharpest case - a hero digit at the default line-height sits visibly lower in its box than the reference render.
- source: "Flockys Design System.dc.html" section 02 documents them as part of the type scale in prose - `text-hero  80px / 5rem · 700 · lh .82 · ls -.03em` - but section 08 exports no `--fwm-leading-*` or `--fwm-tracking-*` variable, and neither does tokens.json.
- stand-in: `apps/pwa/tailwind.config.ts` maps `fontSize` to the size variable only and declares no `lineHeight` or `letterSpacing` family, so components inherit the body line-height. Nothing was invented.
- options: (1) export `--fwm-leading-hero/.../micro` and `--fwm-tracking-*` from section 02's prose values and map both families in Tailwind - recommended, the values already exist in the design, they were just never exported; (2) attach line-height and letter-spacing to each `fontSize` entry as a Tailwind tuple, which hides them from the mode system where a mode can currently only resize type; (3) leave them unset and accept type that does not match the reference renders.

## keyframe-definitions-diverge-across-design-files

- need: one authoritative body for `fwmPulse`, `fwmRing` and `fwmVoice`.
- screen: approaching pulse (RADAR, watch W3), in-range ring expand (RADAR, watch W1), voice bars (ASK).
- source: the four design files render three different definitions. `fwmPulse` dims to `.25` in "Flockys Design System.dc.html":20 but to `.3` in App Screens:19, Screens II:18 and Watch:18. `fwmRing` is `scale(.7)->scale(1.6)` at opacity `.9->0` in the design system file:21, `scale(.72)->scale(1.55)` at `.85->0` in App Screens:20, and `scale(.74)->scale(1.5)` at `.85->0` in Watch:19. `fwmVoice` is `scaleY(.3)` in the design system file:24 and `scaleY(.25)` in App Screens:21 and Watch:21.
- stand-in: `apps/pwa/src/styles/global.css` applies the public
  [source-authority rule](./README.md#source-authority): rendered screens beat
  the design-system primitives. It ships the phone-screen body for all three,
  with comments naming the variants it beat. `fwmRing` therefore uses the
  phone value and the watch's slightly tighter `.74->1.5` is not reproduced.
- options: (1) declare the App Screens bodies canonical and correct the other three files - recommended, it matches the authority order already agreed; (2) keep a separate watch-surface `fwmRing` under `[data-fwm-surface="watch-round"]`, which is defensible since the watch ring is drawn at a different radius; (3) export all five keyframes from the token layer so there is exactly one definition, which is option 1 of DESIGN-GAPS.md#animations-are-not-tokens.

## sixth-keyframe-fwmblink

- need: a decision on whether `fwmBlink` is part of the system.
- screen: unknown - nothing in the four files applies it.
- source: "Flockys Design System.dc.html":22 defines `@keyframes fwmBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: .15; } }`. It is declared and never used, and DESIGN-GAPS.md#animations-are-not-tokens enumerates only five keyframes.
- stand-in: not reproduced in `global.css`. Only the five documented keyframes ship.
- options: (1) drop it as dead design CSS - recommended unless a screen turns up that needs it; (2) add it as the sixth system keyframe if it is meant for the no-fix / stale-data indicator, which is the only behaviour in the brief that reads like a hard blink rather than a pulse.

## no-zero-length-token-for-env-fallbacks

- need: a zero-length value the token rule accepts, for `env(safe-area-inset-*, 0px)` fallbacks.
- screen: header and dock on every screen - the safe-area helpers in `global.css`.
- source: "Flockys Design System.dc.html" section 06 requires `env(safe-area-inset-*) on nav + header` and `bottom nav 64px + env(safe-area-inset-bottom)`. A bare `env(safe-area-inset-top)` with no fallback makes the whole declaration invalid on engines without safe-area support, which would drop the base padding entirely, so the fallback argument is not optional.
- stand-in: literal `0px` inside the `env()` fallback slot, 13 occurrences in `apps/pwa/src/styles/global.css`, each inside a block comment that explains it is a zero fallback rather than a design value. NOTE FOR THE CHECKER AUTHOR: `scripts/check-design-values.mjs` needs `env(<name>, 0px)` on its allowlist or it will flag all 13.
- options: (1) allowlist the `env(..., 0px)` pattern in the checker - recommended, it is the narrowest rule and zero is not a design decision; (2) export `--fwm-space-0: 0px` and use `env(safe-area-inset-top, var(--fwm-space-0))`, which satisfies the rule literally but adds a token that means nothing; (3) allow bare `0` / `0px` anywhere, which is too broad - it would also permit `border-radius: 0` in place of `var(--fwm-radius-0)`.
