/**
 * THE HAVEIBEENFLOCKED HAND-OFF.
 *
 * LOOKUP answers one question: "has a Flock operator searched my plate?" Only
 * haveibeenflocked.com can answer it - the data is FOIA'd audit logs they
 * collected. We do not have it and cannot compute it.
 *
 * SO THIS SENDS THE DRIVER, IT DOES NOT FETCH.
 *
 *   robots.txt on haveibeenflocked.com:
 *       User-agent: *
 *       Allow: /
 *       Disallow: /api/
 *
 *   `Allow: /` is explicit permission to link to the site. `Disallow: /api/`
 *   is an equally explicit refusal of the thing their plate search calls. So
 *   the product opens the page and the driver runs the search themselves:
 *   nothing automated, nothing bypassed, no quota consumed on somebody else's
 *   donated infrastructure, and no relationship that needs their permission to
 *   exist.
 *
 * THE PLATE STILL DOES NOT LEAVE THIS DEVICE BY ITSELF.
 *   The hand-off puts the plate on the CLIPBOARD and opens the site. The driver
 *   pastes it, or does not. There is no URL parameter carrying it - partly
 *   because the site has no documented one, and mostly because a plate in a URL
 *   is a plate in a browser history, a referrer header and a server log.
 *
 * WHAT THIS CANNOT DO, AND WHY THE PRODUCT MUST NOT PRETEND OTHERWISE
 *   Without calling their API, the app CANNOT KNOW whether a plate has a hit.
 *   So there is no "you are on the hit list" banner here: that would require
 *   either the automated querying this file refuses, or an invented answer.
 *   The honest version is a reminder to check, and a one-tap route to the only
 *   place that can say. If a partnership ever makes the API legitimate, the
 *   alert becomes real and this file is where it plugs in. No partnership or
 *   API permission exists today.
 */

/** Their homepage. The one URL `Allow: /` covers without ambiguity. */
export const HIBF_URL = 'https://haveibeenflocked.com/';

/** Shown next to the button, so the trade is stated before it is made. */
export const HANDOFF_NOTE =
  'opens haveibeenflocked.com and copies the plate. you paste it there - this app never sends it.';

/** Shown where a driver might expect an automatic answer. */
export const NO_AUTOMATIC_CHECK_NOTE =
  'nothing here checks by itself. we do not query their service, so we cannot know about a hit until you look.';

export interface Clipboard {
  write(text: string): Promise<boolean>;
}

export interface Opener {
  open(url: string): void;
}

export interface HandoffPorts {
  readonly clipboard?: Clipboard | null;
  readonly opener?: Opener | null;
}

export type HandoffOutcome =
  /** Site opened and the plate is on the clipboard. */
  | 'copied-and-opened'
  /** Site opened; the clipboard refused, so the driver types it. */
  | 'opened-only'
  /** Nothing could be opened - no browser context, or a blocked popup. */
  | 'unavailable';

/**
 * Send the driver to the site with the plate ready to paste.
 *
 * The order matters: copy FIRST, then open. A clipboard write after a
 * navigation can lose the document's user-activation and silently fail, which
 * would leave somebody staring at a search box with nothing to paste.
 */
export async function handOff(plate: string, ports: HandoffPorts = {}): Promise<HandoffOutcome> {
  const { clipboard = null, opener = null } = ports;
  const copied = clipboard === null ? false : await clipboard.write(plate);
  if (opener === null) return 'unavailable';
  opener.open(HIBF_URL);
  return copied ? 'copied-and-opened' : 'opened-only';
}

/**
 * The default opener: a new tab, with `noopener` so the opened page cannot
 * reach back into this one through `window.opener`, and no referrer so their
 * logs do not record which of our screens the driver came from.
 */
export function browserOpener(): Opener | null {
  if (typeof globalThis.window === 'undefined') return null;
  return {
    open(url: string): void {
      globalThis.window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}
