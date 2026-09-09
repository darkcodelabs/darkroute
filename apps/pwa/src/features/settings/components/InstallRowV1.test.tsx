/**
 * THE INSTALL ROW MUST SAY WHY, AND MUST NOT OFFER WHAT IT CANNOT DO.
 *
 * This row replaces a card that had exactly two states -- "Install" and the
 * browser-menu fallback -- so every other reason the controller can give
 * collapsed into "use your browser menu", which is wrong for most of them and
 * unanswerable for all of them. Somebody who backed out of Chrome's own sheet
 * once was told, forever, to add a home-screen icon by hand.
 *
 * `installRow` is where that branch order lives, so it is tested here directly
 * rather than through a DOM: the order IS the content, and it is not observable
 * from a rendered row that only ever shows one branch at a time.
 *
 * THE ORDER: already installed beats a copy already on the phone, which beats
 * "we can raise the sheet", which beats "here is why we cannot". Getting the
 * first two the wrong way round tells somebody standing inside the installed
 * app to go and install it.
 */

import { describe, expect, it } from 'vitest';

import type { InstallPromptStatus } from '../../../services/pwa/installPrompt.ts';
import {
  INSTALL_ELSEWHERE_SUB,
  INSTALL_MANUAL_SUB,
  INSTALL_SUB,
  INSTALL_WHY,
  INSTALLED_SUB,
  INSTALL_ASK_AGAIN,
} from './InstallRowV1.tsx';

import { INSTALL_ACTION, installRow } from './InstallRowV1.tsx';

function status(over: Partial<InstallPromptStatus>): InstallPromptStatus {
  return {
    captured: false,
    sessions: 3,
    dismissed: false,
    installed: false,
    canPrompt: false,
    reason: 'no-event',
    ...over,
  };
}

describe('what the install row states', () => {
  it('offers the browser its own sheet when the controller says it can', () => {
    expect(installRow(status({ canPrompt: true, reason: 'ready' }), false)).toEqual({
      value: INSTALL_SUB,
      action: INSTALL_ACTION,
    });
  });

  it('says it is already running installed, and offers nothing', () => {
    // The FIRST branch, and it has to be: an app offering to install itself to
    // somebody standing inside it is the failure this order exists to prevent.
    expect(installRow(status({ installed: true, canPrompt: true }), false).action).toBeNull();
    expect(installRow(status({ installed: true }), false).value).toBe(INSTALLED_SUB);
  });

  it('tells a browser tab that the phone already has a copy', () => {
    // `getInstalledRelatedApps` found one. Chrome does not fire
    // `beforeinstallprompt` for an app the device already has, so without this
    // branch the row falls through to "add it to your home screen" for an icon
    // that is already there.
    expect(installRow(status({ reason: 'no-event' }), true)).toEqual({
      value: INSTALL_ELSEWHERE_SUB,
      action: null,
    });
  });

  it('says why there is no offer, in the controller’s own words', () => {
    for (const reason of ['first-session', 'recently-declined', 'already-dismissed', 'alert-active'] as const) {
      expect(installRow(status({ reason }), false).value).toBe(INSTALL_WHY[reason]);
    }
  });

  it('offers again only where there is a refusal of ours to withdraw', () => {
    // `allowAgain()` clears this app's own two refusals. It does nothing at all
    // for `no-event` or `first-session`, so offering it there would be a
    // control that changes nothing -- and `alert-active` is a live camera
    // alert, which is not a refusal and is not for the driver to override.
    expect(installRow(status({ reason: 'already-dismissed' }), false).action).toBe(INSTALL_ASK_AGAIN);
    expect(installRow(status({ reason: 'recently-declined' }), false).action).toBe(INSTALL_ASK_AGAIN);
    expect(installRow(status({ reason: 'first-session' }), false).action).toBeNull();
    expect(installRow(status({ reason: 'alert-active' }), false).action).toBeNull();
  });

  it('states the manual route when this browser has no install event at all', () => {
    // Firefox and every iOS browser. `no-event` has no entry in `INSTALL_WHY`,
    // because there is no decision to explain -- the platform simply has none.
    expect(installRow(status({ reason: 'no-event' }), false)).toEqual({
      value: INSTALL_MANUAL_SUB,
      action: null,
    });
  });

  it('states the manual route when there is no controller at all', () => {
    // Null in every unit test, on a watch surface, and in any build that passed
    // `installPrompt={null}`. `installRegistry.ts` is explicit that a caller
    // which cannot handle null is one that would crash a screen over an
    // affordance it could simply not draw.
    expect(installRow(null, false)).toEqual({ value: INSTALL_MANUAL_SUB, action: null });
  });
});
