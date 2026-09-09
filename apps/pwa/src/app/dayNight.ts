/**
 * THE DAY/NIGHT KEY'S ONE DECISION, in a module both of its keys can reach.
 *
 * The portrait rail's theme key and the landscape right rail's Day/night
 * circle are the same control on two surfaces. The decision used to be a
 * closure inside `DriveScreen.tsx` -- the only writer of `data-fwm-mode` in the
 * product -- and the landscape circle, which is mounted by `app/ShellDock.tsx`
 * in a subtree DRIVE is not an ancestor of, could not reach it. It shipped
 * unwired: a lit circle that did nothing on the one surface where the portrait
 * rail is `display: none`.
 *
 * Lifting the closure here changes who may call it, not what it does. It reads
 * the mode off the settings store at the press rather than from a render, so
 * the two keys can never disagree about which theme is on.
 *
 * DARK IS SLATE, LIGHT IS REFINEMENT, and this key knows only those two. Going
 * "back to dark" returns to `DEFAULT_MODE` rather than to whatever the driver
 * had before -- a one-press control with no memory cannot restore `pursuit`,
 * and pretending otherwise would need state that outlives the press. Settings
 * is where a specific skin gets chosen.
 */

import { useSettingsStore } from '../stores/settings.ts';
import { DEFAULT_MODE, applyMode } from './mode.ts';
import type { FwmMode } from './mode.ts';

/*
 * THE THREE LIGHT SKINS, which `tokens.css` already groups as a set - the same
 * three the search mark's light twin used to be swapped on. The key asks "am I
 * currently light?" of this rather than comparing against one name, so a
 * driver who picked `paper` in settings sees the moon and gets slate back.
 */
export const LIGHT_MODES: ReadonlySet<string> = new Set(['refinement', 'paper', 'e-ink']);

/** The one the key turns ON. The other two are only ever recognised, never set. */
export const LIGHT_MODE: FwmMode = 'refinement';

/** Whether the glyph should be the moon: true while a light skin is on. */
export function isLightMode(mode: string): boolean {
  return LIGHT_MODES.has(mode);
}

/**
 * Flip between the dark default and the light skin, and write it down. Called
 * from a press and from nowhere else.
 */
export function toggleDayNight(): void {
  const settings = useSettingsStore.getState();
  const next: FwmMode = LIGHT_MODES.has(settings.mode) ? DEFAULT_MODE : LIGHT_MODE;
  applyMode(next);
  settings.setMode(next);
}
