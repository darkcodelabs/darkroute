/**
 * THE LIVE INSTALL PROMPT, for the screens that offer installing.
 *
 * =============================================================================
 * WHY A REGISTRY
 * =============================================================================
 * There may be exactly ONE `InstallPromptController` in a running app. It
 * counts launches, remembers a dismissal and holds the single deferred
 * `beforeinstallprompt` event the browser hands out once per page load. A
 * second one would double-count every session and race the first for an event
 * only one of them can win.
 *
 * `App` owns that one. MORE - a screen several levels below it, reached by a
 * dock key App knows nothing about - is where v1 puts the install affordance.
 * Threading the controller down as a prop would mean every screen registry
 * entry taking a prop that only one screen uses, so App PUBLISHES it here and
 * the screen asks.
 *
 * Same shape and the same reasoning as `features/map/mapRegistry.ts`.
 *
 * =============================================================================
 * IT IS ALLOWED TO BE EMPTY
 * =============================================================================
 * `null` in every unit test, on a watch surface, and in any build that passed
 * `installPrompt={null}`. A caller that cannot handle null is a caller that
 * would crash a screen over an affordance it could simply not draw.
 */

import type { InstallPromptController } from './installPrompt.ts';

let current: InstallPromptController | null = null;

/** Called by `App` when the controller is made, and with null on teardown. */
export function setInstallController(controller: InstallPromptController | null): void {
  current = controller;
}

/** The live controller, or null. Callers MUST handle null -- see the header. */
export function installController(): InstallPromptController | null {
  return current;
}
