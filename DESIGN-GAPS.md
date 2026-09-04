# DESIGN-GAPS

Genuine missing design decisions - things the design sources do not cover, or cover
inconsistently with themselves. Every entry names what was needed, which screen needed it, the
temporary token stand-in in use, and the options worth considering.

**Rules of engagement** (from the design contract):

1. Never guess, never extrapolate, never pull a value from another project.
2. Write the gap down here before shipping the workaround.
3. Use the nearest existing token as the stand-in and mark the line
   `/* GAP: see DESIGN-GAPS.md#slug */`.
4. Surface every gap at the end of the session. Nothing gets buried.

Detailed implementation records live in [`docs/gaps-inbox/`](docs/gaps-inbox/README.md).
That directory name is historical; its files are stable public decision records,
not a private task queue. This file is the concise index of cross-cutting gaps.

Status: `OPEN` (needs a decision) · `STANDING IN` (workaround shipped, decision still wanted) ·
`RESOLVED` (decision made - record it and the date).

---

## token-set-does-not-cover-rendered-hero-sizes

- **Status:** STANDING IN
- **Need:** hero numeral sizes that the screens actually render.
- **Screens:** RADAR in-range renders 96px; OFFLINE renders 88px; LOG/EXPOSURE 72px; LOOKUP 68px;
  watch faces render 104px, 112px and 96px; CONVOY renders 52px.
- **Source:** `--fwm-text-hero` is `5rem` / 80px, and `[data-fwm-surface="watch-round"]` overrides it
  to `3.875rem` / 62px. Neither matches what any screen draws.
- **Stand-in:** `var(--fwm-text-hero)` everywhere, per surface. Screens will read smaller than the
  design renders until this is decided.
- **Options:**
  1. Add a per-screen hero step (`--fwm-text-hero-radar`, `--fwm-text-hero-watch`) - most faithful,
     grows the token set.
  2. Treat the token as canonical and accept the design renders were exploratory - smallest system,
     visibly different from the reference screens.
  3. Make the hero fluid (`clamp()` between the token and the rendered max) - one token, but
     introduces a value the system never declared.

## radar-hero-96-vs-token-80

- **Status:** STANDING IN
- **Need:** the specific RADAR case of the above, called out because it is the screen visible 90% of
  the time and the one the "survives a glance" principle is written about.
- **Screens:** `01 · RADAR - IN RANGE`.
- **Source:** `font-size:96px; line-height:.82; letter-spacing:-.04em` in `Flockys App Screens.dc.html`.
  Token is 80px with `-.03em` in the type table.
- **Stand-in:** `var(--fwm-text-hero)`.
- **Options:** as above; if only one screen gets a bespoke hero, this is the one.

## micro-type-below-stated-floor

- **Status:** OPEN
- **Need:** a legitimate type step below the stated 11px phone floor, or a decision to stop using one.
- **Screens:** RADAR stat tiles (9px labels, 9px unit captions), SWEEP ring labels (9px), REPORT
  compass cardinals (9px), EXPOSURE day-of-week axis (9px), ZONE AUDIT share-card footer (9px),
  and 10px micro labels nearly everywhere.
- **Source:** the type table states "text-micro 11px … floor for the phone. Watch floor is 13px",
  and the design's own screens break that floor constantly.
- **Stand-in:** `var(--fwm-text-micro)` (11px) at every one of those sites, so the app is currently
  *more* legible than the reference and slightly looser in fixed-height rows.
- **Options:**
  1. Hold the 11px floor and re-tune the affected rows - best for sunlight/driving legibility, drifts
     from the reference layout.
  2. Add `--fwm-text-nano: .5625rem` (9px) restricted to non-essential axis/caption text - matches
     the reference, weakens the floor rule.
  3. Keep 11px on phone and allow 9px only on `dash` where viewing distance is longer - needs a
     surface-scoped token.

## dock-key-height-58

- **Status:** STANDING IN
- **Need:** a dock key height token.
- **Screens:** all five dock screens.
- **Source:** keys render at 58px; `--fwm-nav-h` is 64px; the dock spec says "Dock total 130px + safe
  area" while the rendered dock measures ~148px (52 bar + 12/14 padding + 58 keys + 12 bottom).
- **Stand-in:** `var(--fwm-nav-h)`.
- **Options:** (1) retune `--fwm-nav-h` to 58px and add `--fwm-dock-h`; (2) add
  `--fwm-dock-key-h: 58px` and leave nav-h for other surfaces; (3) accept 64px keys and let the dock
  total land at 154px.

## report-bar-tint-and-alert-tints

- **Status:** STANDING IN
- **Need:** translucent state tints used as fills.
- **Screens:** REPORT bar fill `rgba(255,45,94,.09)`, RADAR "N in range" bar `rgba(255,45,94,.08)`,
  NODE connected card `rgba(61,224,138,.06)`, MESH banner `rgba(138,107,255,.07)`, RECORD banner
  `rgba(255,90,31,.07)`, WATCHLIST banner `rgba(255,45,94,.07)`, ROUTE least-watched
  `rgba(61,224,138,.06)`, DEAD DROP banner `rgba(255,192,46,.06)`.
- **Source:** used in eight places; declared in none. Section 08 exports no alpha ramp.
- **Stand-in:** `var(--fwm-surface-1)` as the fill with the hue carried by the 1px border only, which
  is the system's stated depth model ("Depth = 1px hairline + surface step").
- **Options:**
  1. Add a tint ramp - `--fwm-tint-in-range` etc. as `color-mix(in srgb, var(--fwm-alert-in-range) 8%, transparent)`,
     derived rather than hand-authored, so a mode swap carries the tint automatically.
  2. Keep border-only and drop the tint - most consistent with "no shadows, depth is hairline + surface".
  3. Hand-author eight alpha values - matches the render, adds eight untokenized colours.

## dash-surface-never-gets-dash-tokens

- **Status:** STANDING IN
- **Need:** the wiring between the detected `dash` surface and the dash-cast token block.
- **Screens:** the whole dash layout (800×480 head unit).
- **Source:** section 06 detection emits `data-fwm-surface="dash"`. Section 08 keys the 68px touch
  floor and 88px rail on `data-fwm-mode="dash-cast"`. Nothing connects them, so a projected head unit
  gets phone-sized 44px targets.
- **Stand-in:** `tokens.css` mirrors the dash-cast values onto `[data-fwm-surface="dash"]`.
- **Options:** (1) keep the mirror (current); (2) have `detectSurface()` also set
  `data-fwm-mode="dash-cast"` - but that would silently override a user's chosen mode; (3) rename the
  block to a surface selector in the design source and drop the mode entirely.

## watch-square-has-no-block

- **Status:** STANDING IN
- **Need:** a token block for the `watch-square` surface the detector emits.
- **Screens:** every watch face on a square Wear OS device.
- **Source:** detection emits `watch-square`; section 08 defines only `watch-round`. Section 07 says
  "square watch: same layout, corners stay empty".
- **Stand-in:** `watch-square` inherits the `watch-round` values verbatim.
- **Options:** (1) keep the alias; (2) give square a slightly larger safe area since corners are
  reachable - needs a design call, not an engineering one.

## night-watch-has-no-block

- **Status:** RESOLVED (2026-08-20) - by construction, not by choice.
- **Need:** a `[data-fwm-mode="night-watch"]` block, for symmetry with the other five modes.
- **Source:** Night Watch is described as the default and the only always-on watch mode, and section
  08 ships no override block for it because it *is* `:root`.
- **Decision:** `night-watch` stays unset - `:root` is Night Watch. `mode.ts` treats the absent
  attribute and `night-watch` as the same state, and refuses any other mode on a watch surface.

## mode-blocks-are-incomplete

- **Status:** OPEN
- **Need:** the token overrides each mode omits.
- **Source:** `cluster` sets `--fwm-surface-1` but never `--fwm-surface-2` or `--fwm-bg-sunken`, so
  cards in cluster mode fall back to the Night Watch charcoal against a `#04070A` background.
  `cartridge-96` sets `--fwm-text` but not `--fwm-text-2`, so secondary text keeps the Night Watch
  slate against a light bezel. `dash-cast` introduces `--fwm-nav-w` with no `:root` default.
  `pursuit` introduces `--fwm-scan-dur` with no `:root` default.
- **Stand-in:** the blocks are shipped verbatim; the fallbacks are whatever `:root` holds.
- **Options:** (1) complete each mode's ramp (needs design); (2) declare `--fwm-nav-w` and
  `--fwm-scan-dur` in `:root` so the modes override rather than introduce (safe, do this regardless);
  (3) verify contrast per mode and only fill the ramps that actually fail AA.

## animations-are-not-tokens

- **Status:** OPEN
- **Need:** the five keyframe animations as part of the exported system.
- **Screens:** sweep line (SWEEP, watch W4), alert ring expand (RADAR in-range, watch W1), pulse
  (approaching, ambient clear), scanner bar (pursuit mode), voice bars (ASK, pursuit).
- **Source:** `fwmSweep`, `fwmPulse`, `fwmRing`, `fwmScan`, `fwmVoice` are defined inline in all four
  design files, and exported in none. Their durations conflict between files;
  [`docs/gaps-inbox/README.md`](docs/gaps-inbox/README.md#source-authority)
  records how those conflicts are resolved in the public tree.
- **Stand-in:** keyframes copied verbatim into `global.css` with a comment citing the source file;
  durations use `var(--fwm-dur-*)` where a token matches, literals where none does.
- **Options:** (1) export them as part of tokens (they are as much "the system" as the easings);
  (2) keep them in `global.css` as system CSS and treat only the durations as tokens.

## no-settings-screen-exists

- **Status:** OPEN - blocks a screen listed in the brief.
- **Need:** a SETTINGS screen layout.
- **Screens:** RADAR's header has a `SET` key with nowhere to go. The product brief lists SETTINGS as
  screen 6 (alert distance slider, audio on/off + volume, vibration toggle, WiFi sync status +
  manual trigger, database freshness, screen wake lock toggle). The design system ships the toggle,
  slider and row components it would need, but no screen was ever drawn.
- **Stand-in:** none - not implemented. The `SET` key is inert.
- **Options:** (1) compose it from the existing row/toggle/slider components and the ALERT AT slider
  already drawn in section 04; (2) fold its contents into TRIAGE (B4), which already owns alert
  filtering; (3) leave `SET` inert until a screen is designed - dishonest to ship a key that does
  nothing, so option 1 or 2 is preferred.

## no-heat-map-screen-exists

- **Status:** OPEN
- **Need:** the HEAT MAP screen the LOG screen links to.
- **Screens:** LOG/EXPOSURE renders a `HEAT MAP` button; the brief lists HEAT MAP as screen 9 (roads
  driven coloured green→yellow→red, trip overlay toggle). The only heat rendering in the sources is
  the layer inside ZONE AUDIT (B6).
- **Stand-in:** none - not implemented.
- **Options:** (1) route `HEAT MAP` to ZONE AUDIT's heat layer with the trip overlay on; (2) draw a
  dedicated screen; (3) drop the button.

## vol-key-unspecified

- **Status:** OPEN
- **Need:** what the RADAR header's `VOL` key does.
- **Screens:** `01 · RADAR - IN RANGE` renders `REP`, `SET`, `VOL`; `VOL` is outlined in the in-range
  hue, implying an active/armed state, but no volume, audio or mute screen is drawn anywhere.
- **Stand-in:** none - inert.
- **Options:** (1) it is the mute toggle (the brief lists a mute toggle on RADAR, and the muted state
  shows `MUTED 8:12` in the header - this is the most likely reading); (2) it opens an audio sheet;
  (3) it cycles alert volume.
- **Leaning:** (1). Needs confirmation before wiring, because muting is a behaviour with rules
  attached and guessing it wrong is worse than leaving the key inert.

## multiple-state-never-rendered

- **Status:** STANDING IN
- **Need:** a rendered `multiple` alert state.
- **Screens:** RADAR, SWEEP, watch faces. The state matrix renders clear, approaching, no-GPS and
  muted; the in-range screen is drawn separately. `multiple` (`#FF3DBE`, "2+ in range · 2-pulse
  haptic") exists only as a colour swatch and a token.
- **Stand-in:** the in-range layout with the multiple hue applied and the in-range count emphasised.
- **Options:** (1) confirm the stand-in is the intent; (2) draw a distinct layout (e.g. the two
  nearest distances side by side); (3) treat `multiple` as an in-range modifier rather than a state -
  but the token set and the haptic rule both treat it as a state.

## empty-and-loading-states-mostly-undrawn

- **Status:** OPEN
- **Need:** empty, loading, denied and stale states for most screens.
- **Screens:** the design draws degraded states for RADAR (no-GPS, muted, offline) and nothing else.
  LOOKUP with no plate, MESH with nobody nearby, BOARD before a first submission, DEAD DROP with an
  empty queue, RECORD in a county with no entries, ROUTE before a destination - all undrawn.
- **Stand-in:** none yet; each screen's implementation will need one and will file its own entry.
- **Options:** (1) derive a single empty-state pattern from the existing card + micro-label
  vocabulary and apply it uniformly; (2) draw each one.

## untokenized-utility-colours

- **Status:** STANDING IN
- **Need:** the non-ramp colours the screens use.
- **Screens/values:** map wells `#04060A`, `#0A0D12`, `#070A0E` (SWEEP/CONVOY/ZONE AUDIT map
  backgrounds); segment-off green `#123A1E` (CARTRIDGE bar graph, ROUTE score bar); share-card ground
  `#0A0B0F` (ZONE AUDIT); label grey `#5C6472` (section eyebrows throughout the design documents).
- **Source:** none of these are in section 08.
- **Stand-in:** `var(--fwm-bg-sunken)` for map wells, `var(--fwm-surface-2)` for segment-off,
  `var(--fwm-bg-sunken)` for the share card, `var(--fwm-text-muted)` for eyebrows.
- **Note:** `#5C6472` appears only in the design-document chrome, not in any 375px screen frame - it
  is probably documentation styling rather than product styling. Treating it as such.
- **Options:** (1) add a `--fwm-bg-map` token, since a map well is a real product surface;
  (2) keep the stand-ins.

## logo-has-two-variants

- **Status:** STANDING IN
- **Need:** which mark is canonical, and what the monochrome/maskable derivatives come from.
- **Source:** the contract names `assets/darkroute-mark.png` as "the only brand asset", but the
  unpublished design archive also contained `assets/darkroute-eye.png` (colour) and a byte-identical
  copy under `uploads/`; neither is part of the public repository.
- **Stand-in:** white-on-transparent only. Derivatives are resize + maskable padding + monochrome
  from that single file. No redraw, no trace, no substitute.
- **Options:** (1) confirm white-only (current); (2) use the colour mark for the 192/512 home icon and
  white for monochrome/badge - needs an explicit call, since the manifest spec says "white mark on
  pure black, no rounded box baked in".

## fonts-must-be-self-hosted-for-offline

- **Status:** OPEN - engineering-forced, not a design gap, recorded here because it changes an asset.
- **Need:** Chakra Petch and JetBrains Mono available with the network off.
- **Source:** the design files load both from Google Fonts via `<link>`. Section 06 requires the app
  to work offline, and the build spec says "precache … fonts when licensing permits".
- **Stand-in:** the Google Fonts link is kept for now, so first paint offline falls back to
  `system-ui` / `ui-monospace` - which visibly breaks the instrument look.
- **Options:** (1) self-host both (both are SIL OFL 1.1, so redistribution is permitted) and precache
  the woff2 subsets - recommended; (2) keep the CDN and accept a degraded offline first paint.

---

## Detailed implementation records

The larger, screen-specific records remain under `docs/gaps-inbox/*.md`; this
index carries only the cross-cutting decisions.
