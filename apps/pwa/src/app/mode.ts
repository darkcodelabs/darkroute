/**
 * THEME MODES - six skins, one layout.
 *
 * "A mode only overrides existing variable names - --fwm-bg, --fwm-surface,
 *  --fwm-alert-*, --fwm-radius-*. Layout, hit targets, hierarchy and the
 *  four-state hue logic never change, so a skin swap can't break glanceability.
 *  Set with <html data-fwm-mode="pursuit">; Night Watch is the fallback and the
 *  only mode allowed on the always-on watch face."
 * - Flockys Design System.dc.html, section 05
 *
 * HOW THAT IS ENFORCED HERE
 *   1. This module writes exactly one thing: `data-fwm-mode` on <html>. It has
 *      no other side effect, imports no stylesheet, and touches no class list.
 *      A mode therefore *cannot* change layout, hit targets or hierarchy from
 *      TypeScript - the only lever it has is the token remap in
 *      `styles/tokens.css`, and every block there redeclares existing
 *      `--fwm-*` names and nothing else.
 *   2. The four-state hue logic survives because a mode remaps
 *      `--fwm-alert-clear|approaching|in-range|multiple` - it never merges two
 *      of them and never adds a fifth. Components keep asking for "the in-range
 *      colour" and keep getting a distinct hue.
 *   3. The always-on watch rule is enforced in code, not in a comment:
 *      `resolveMode()` forces `night-watch` whenever the surface is `watch-*`,
 *      and `applyMode()` writes what `resolveMode()` returned. There is no code
 *      path that puts `pursuit` on a wrist.
 *
 * WHY NIGHT WATCH IS SPECIAL
 *   It has no override block in tokens.css by design - it *is* the `:root`
 *   block (see DESIGN-GAPS.md#night-watch-has-no-block). The attribute is still
 *   written for it so the DOM always states the active mode; the selector
 *   `[data-fwm-mode="night-watch"]` simply matches no rules, which is correct.
 */

import { currentSurface, type FwmSurface } from './surface.ts';

/**
 * The six modes, in the order section 05 renders them. `night-watch` is first
 * because it is the default, not because it is alphabetically lucky.
 */
export const FWM_MODES = [
  'night-watch',
  'neon-grid',
  'cartridge-96',
  'pursuit',
  'cluster',
  'dash-cast',
  // Added in "DarkRoute Design System 80sv3".
  'aurora',
  'refinement',
  /**
   * NOT FROM A DESIGN FILE. Asked for directly, and it earns its place by
   * being the only mode with a hardware reason rather than a stylistic one:
   * an e-paper panel holds a static image at nearly no power and repaints
   * slowly, so a phone mirrored to one, or a dash-mounted e-reader, needs a
   * skin with no glow to smear, no hue to dither and no animation to ghost.
   * GAP: see docs/gaps-inbox/settings.md#e-ink-mode-is-not-drawn
   */
  'e-ink',
  /**
   * THE FOUR v1 ADDED, and they exist for one reason: v1 is a complete design
   * with its own seven themes, and four of them had no id here at all - so a
   * v1 build could offer three of its own themes and six of v0's, which is two
   * designs mixed on one screen.
   *
   * Their palettes are declared ONLY under `[data-fwm-design="v1"]`. Chosen in
   * a v0 build they fall back to night watch, which is correct: they are not
   * v0's themes and v0's picker does not list them. See `V1_MODES`.
   */
  'slate',
  'carbon',
  'violet',
  'paper',
  /**
   * FOUR MORE, v1-only, and each one answers a condition rather than a decade.
   *
   * The seven before them are all cool or neutral except `paper`, so a driver
   * who wants warmth at night had nothing: `carbon` accents amber but keeps a
   * grey ground. These fill that, and `sodium` in particular is the one with a
   * hardware argument behind it - see its block in `tokens.css`.
   */
  'ember',
  'tide',
  'moss',
  'sodium',
] as const;

export type FwmMode = (typeof FWM_MODES)[number];

/**
 * What a fresh install gets, by owner decision.
 *
 * This constant used to do TWO jobs: the first-launch look AND the mode
 * `resolveMode` forces onto an always-on watch face. Those are different
 * questions with different answers - one is taste, the other is a power budget -
 * and they were the same value only by coincidence. Changing the look would have
 * silently moved the watch onto a palette with glow and shadow in it, on a face
 * that stays lit for hours. See {@link ALWAYS_ON_MODE}.
 */
/*
 * `night-watch` by owner decision, 2026-09-03. It has now been `night-watch`,
 * then `slate` for one day, then `neon-grid` for part of one, and back.
 *
 * Recorded rather than just changed, and the churn is the reason to record it:
 * this is the first thing every new install looks like, the reason is taste,
 * and taste is allowed to move. It is theirs to change and nothing depends on
 * the value.
 *
 * One thing to know before changing it again: `night-watch` has NO override
 * block in tokens.css, because `:root` IS Night Watch - see
 * DESIGN-GAPS.md#night-watch-has-no-block. So this default is also the
 * unstyled base, and a mode that fails to load lands here looking correct
 * rather than looking broken. That is a property worth keeping, not a reason
 * this value cannot change.
 *
 * `ALWAYS_ON_MODE` below happens to be the same string and is NOT the same
 * decision: it has a hardware constraint behind it and is deliberately
 * separate, so changing this one does not silently move the watch.
 */
export const DEFAULT_MODE: FwmMode = 'night-watch';

/**
 * The only mode an always-on watch may use, and NOT a preference.
 *
 * Night watch is the block with "no glow, no shadow - lowest power draw"
 * (section 05). An always-on face burns pixels for hours, so this is a hardware
 * constraint wearing the clothes of a theme. It is enforced in `resolveMode`
 * over any request, including a valid one.
 */
export const ALWAYS_ON_MODE: FwmMode = 'night-watch';

/** The attribute every mode override block in tokens.css selects on. */
export const MODE_ATTRIBUTE = 'data-fwm-mode';

/** `dataset` key form of {@link MODE_ATTRIBUTE}. */
const MODE_DATASET_KEY = 'fwmMode';

export function isFwmMode(value: unknown): value is FwmMode {
  return typeof value === 'string' && (FWM_MODES as readonly string[]).includes(value);
}

/** True for the two watch surfaces, which are the ones with an always-on face. */
export function isWatchSurface(surface: FwmSurface | null): boolean {
  return surface === 'watch-round' || surface === 'watch-square';
}

/**
 * Why the effective mode is what it is. `forced-watch` is the case the design
 * calls out; surfacing it means SETTINGS can render "night watch · locked on
 * this device" instead of silently ignoring the user's choice.
 */
export type ModeReason = 'requested' | 'forced-watch' | 'unknown-mode';

export interface ResolvedMode {
  readonly mode: FwmMode;
  readonly reason: ModeReason;
  /** What the caller asked for, echoed back for an honest SETTINGS screen. */
  readonly requested: string;
}

/**
 * Decide the mode that may actually be applied.
 *
 * `surface` defaults to whatever `data-fwm-surface` currently says. Pass it
 * explicitly from a test or from a caller that has just re-detected.
 */
export function resolveMode(requested: string, surface?: FwmSurface | null): ResolvedMode {
  const on = surface === undefined ? currentSurface() : surface;

  // The watch rule wins over everything, including a valid request. An
  // always-on face burns pixels for hours; night-watch is the block with
  // "no glow, no shadow - lowest power draw" (section 05).
  if (isWatchSurface(on)) {
    return {
      mode: ALWAYS_ON_MODE,
      reason: requested === ALWAYS_ON_MODE ? 'requested' : 'forced-watch',
      requested,
    };
  }

  if (!isFwmMode(requested)) {
    return { mode: DEFAULT_MODE, reason: 'unknown-mode', requested };
  }

  return { mode: requested, reason: 'requested', requested };
}

/**
 * The last mode a caller asked for, valid or not.
 *
 * Kept so that a surface change can restore the user's choice instead of
 * reading the attribute back - the attribute holds the *forced* mode on a
 * watch, and reading it would quietly turn a temporary override into the new
 * preference. This is presentation state, never persisted here, and it can
 * never contain a plate or a coordinate: it is one of six literal strings.
 */
let lastRequested: string = DEFAULT_MODE;

/**
 * Write the resolved mode to <html> and return what was written.
 *
 * This is the ONLY function in the product that sets `data-fwm-mode`. It is
 * idempotent and does nothing else - no class, no style, no layout.
 */
/**
 * THE SYSTEM CHROME FOLLOWS THE THEME.
 *
 * `theme-color` is what an installed PWA and a TWA paint their status bar and
 * navigation bar with, and it was a constant `#000000` in `index.html` and in
 * the manifest -- correct for seven of the eight modes and wrong for the one
 * that matters. `refinement` is a LIGHT theme, so black system bars top and
 * bottom framed a paper-coloured app in exactly the way that reads as a
 * rendering fault rather than a design.
 *
 * Read from the token rather than tabled here: `--fwm-bg` IS the chrome
 * colour, it is already defined per mode, and a second copy in TypeScript is a
 * second place for it to drift.
 *
 * The MANIFEST value stays #000000 and cannot follow the mode -- it is read
 * once at install time, long before any preference exists, and it is what the
 * splash screen uses. That is the honest default for a dark-first app.
 */
function applyThemeColour(): void {
  const root = globalThis.document?.documentElement;
  if (root === undefined || root === null) return;
  const meta = globalThis.document?.querySelector('meta[name="theme-color"]');
  if (meta === null || meta === undefined) return;
  const bg = getComputedStyle(root).getPropertyValue('--fwm-bg').trim();
  if (bg !== '') meta.setAttribute('content', bg);
}

export function applyMode(requested: string, surface?: FwmSurface | null): ResolvedMode {
  lastRequested = requested;
  const resolved = resolveMode(requested, surface);
  if (typeof document !== 'undefined' && document.documentElement !== null) {
    document.documentElement.dataset[MODE_DATASET_KEY] = resolved.mode;
    // After the attribute, never before: the token is only correct once the
    // mode that defines it is on the element.
    applyThemeColour();
  }
  return resolved;
}

/** What the last caller asked for, before the watch rule was applied. */
export function requestedMode(): string {
  return lastRequested;
}

/** Read the attribute without resolving. Returns null when unset or unknown. */
export function currentMode(): FwmMode | null {
  if (typeof document === 'undefined' || document.documentElement === null) return null;
  const value = document.documentElement.dataset[MODE_DATASET_KEY];
  return isFwmMode(value) ? value : null;
}

/**
 * Re-apply the current mode against a (possibly new) surface.
 *
 * Called after `watchSurface()` reports a change: a phone in a dock that
 * becomes `dash` keeps its mode, but a device that resolves to `watch-*`
 * must drop back to night-watch on the spot rather than at the next reload.
 */
export function reconcileMode(surface: FwmSurface | null): ResolvedMode {
  return applyMode(lastRequested, surface);
}
