/**
 * INSTALL ON THIS PHONE - the THIS PHONE group's second row.
 *
 * =============================================================================
 * WHY THIS ROW IS ON SETTINGS AT ALL
 * =============================================================================
 * Brief 4 draws it here, and section C of the same brief deletes MORE's install
 * card with the reason: "the install prompt - same [as the theme card], it
 * belongs in Settings". One affordance, one place. Until section C ships, MORE
 * still draws its own card and there are briefly TWO of them; that is a
 * sequencing consequence of building section D first and it is reported rather
 * than worked around, because the fix is section C's deletion and not a second
 * gate here.
 *
 * =============================================================================
 * THE COPY IS IMPORTED, NOT RETYPED
 * =============================================================================
 * Every string below already exists in `features/more/MoreScreen.tsx`, written
 * for the card this row replaces - including `INSTALL_LABEL`, which is the
 * spec's own row label to the character, and `INSTALL_WHY`, whose
 * `already-dismissed` entry is what the spec's right-hand `you declined` is
 * showing. They are imported so the two affordances cannot disagree while both
 * exist, and so section C's deletion is a compile error here rather than a
 * silent copy divergence. When that card goes, these constants move into this
 * file and the import is inverted.
 *
 * =============================================================================
 * THE CONTROLLER MAY BE ABSENT, AND THE ROW STILL HAS TO SAY SOMETHING
 * =============================================================================
 * `installController()` is null in every unit test, on a watch surface, and in
 * any build that passed `installPrompt={null}` - `installRegistry.ts` is
 * explicit that a caller which cannot handle null is a caller that would crash
 * a screen over an affordance it could simply not draw. With no controller the
 * row states the manual route and offers nothing, which is the honest answer on
 * Firefox and on every iOS browser, where `beforeinstallprompt` never fires.
 *
 * `hasInstalledRelatedApp()` is what separates "no event because the phone
 * already has a copy" from "no event because this browser has none". Without
 * it, somebody looking at a tab of an app that is already on their home screen
 * was told to add it by hand.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { installController } from '../../../services/pwa/installRegistry.ts';
import type { InstallPromptStatus } from '../../../services/pwa/installPrompt.ts';
import { hasInstalledRelatedApp } from '../../../services/pwa/relatedApps.ts';

/** The word in the row's third slot when the browser's own sheet can be raised. */

/*
 * THE INSTALL COPY LIVES HERE NOW, and the move is the point rather than a
 * side effect.
 *
 * It used to be exported from `features/more/MoreScreen.tsx` and imported back
 * across the app, because MORE drew the install card. Brief 4 deletes that card
 * - "the install prompt belongs in Settings", one place per setting - and the
 * strings went with it. This row is what replaced it, so this is where the
 * words belong; an import reaching back into a screen for copy the screen no
 * longer draws is exactly the seam that broke the build when the two halves
 * landed from different directions.
 *
 * Copied verbatim from MoreScreen rather than rewritten: this is the copy that
 * shipped and was argued over, and a paraphrase here would be a silent redesign
 * of five sentences a driver reads at the one moment they are deciding whether
 * to trust the app enough to put it on their home screen.
 */
export const INSTALL_LABEL = 'Install on this phone';
export const INSTALL_SUB = 'a home-screen shortcut and standalone window';

/** Said when the browser has no `beforeinstallprompt` - Firefox, every iOS browser. */
export const INSTALL_MANUAL_SUB = 'use your browser menu: add to home screen';
export const INSTALLED_LABEL = 'Installed';
export const INSTALLED_SUB = 'running from your home screen';

/**
 * SAID WHEN THE COPY IS ON THE PHONE BUT YOU ARE IN A TAB.
 *
 * Chrome does not fire `beforeinstallprompt` for an app the device already
 * has, so the controller reports `no-event` and this screen fell through to
 * the manual row - telling somebody to add a home-screen icon they already
 * have. It is the right answer to the wrong question: the reason there is no
 * install offer is not that the browser cannot make one.
 *
 * `getInstalledRelatedApps()` is what tells the two apart, which is what the
 * manifest's `related_applications` entry exists to make answerable.
 */
/**
 * WHY THERE IS NO INSTALL OFFER, said out loud.
 *
 * The card had exactly two states - "Install" and the browser-menu fallback -
 * so every other reason the controller can give collapsed into "use your
 * browser menu", which is wrong for most of them and unanswerable for all of
 * them. Somebody who declined Chrome's own sheet once got a screen that told
 * them to add a home-screen icon by hand, forever, with nothing saying why.
 *
 * The controller has always known the reason. This prints it.
 */
export const INSTALL_WHY: Readonly<Record<string, string>> = Object.freeze({
  'first-session': 'ask again after another launch or two.',
  'recently-declined': 'you backed out of the install sheet. we will offer again shortly.',
  'already-dismissed': 'you asked us not to offer this again.',
  'alert-active': 'not while a camera alert is live.',
});

export const INSTALL_ASK_AGAIN = 'Offer it again';

export const INSTALL_ELSEWHERE_LABEL = 'Already on this phone';
export const INSTALL_ELSEWHERE_SUB = 'open DarkRoute from your home screen';

export const INSTALL_ACTION = 'Install';

/**
 * What the row states, and what -- if anything -- it offers.
 *
 * Split out of the component so the branch order is testable without a DOM and
 * without a live controller. The ORDER is the whole content: "already
 * installed" beats "a copy is on the phone" beats "we can raise the sheet"
 * beats "here is why we cannot".
 */
export function installRow(
  status: InstallPromptStatus | null,
  elsewhere: boolean,
): { readonly value: string; readonly action: string | null } {
  if (status?.installed === true) return { value: INSTALLED_SUB, action: null };
  if (elsewhere) return { value: INSTALL_ELSEWHERE_SUB, action: null };
  if (status?.canPrompt === true) return { value: INSTALL_SUB, action: INSTALL_ACTION };
  /* A REFUSAL IS OFFERABLE AGAIN; A MISSING EVENT IS NOT. `allowAgain()` clears
     both of this app's own refusals, so it is the right affordance for
     `already-dismissed` and `recently-declined` and does nothing at all for
     `no-event`, where the browser never made an offer to withdraw. */
  const reason = status?.reason ?? 'no-event';
  const why = INSTALL_WHY[reason];
  if (why !== undefined) {
    const offerable = reason === 'already-dismissed' || reason === 'recently-declined';
    return { value: why, action: offerable ? INSTALL_ASK_AGAIN : null };
  }
  return { value: INSTALL_MANUAL_SUB, action: null };
}

export function InstallRowV1(): ReactElement {
  const [status, setStatus] = useState<InstallPromptStatus | null>(null);
  const [elsewhere, setElsewhere] = useState(false);

  // The controller is App's, and it publishes itself through the registry
  // rather than being threaded down as a prop every screen would have to carry.
  useEffect(() => {
    const controller = installController();
    if (controller === null) return undefined;
    setStatus(controller.status());
    return controller.subscribe(setStatus);
  }, []);

  /* Asked once on mount and never again: it is a question about what is on the
     phone, not about anything on this screen. */
  useEffect(() => {
    let live = true;
    void hasInstalledRelatedApp().then((found) => {
      if (live) setElsewhere(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const { value, action } = installRow(status, elsewhere);

  const press = useCallback(() => {
    const controller = installController();
    if (controller === null) return;
    if (action === INSTALL_ACTION) {
      // MUST be inside the gesture: the browser refuses a prompt raised
      // anywhere else, and `prompt()` returns `blocked` rather than throwing.
      void controller.prompt();
      return;
    }
    void controller.allowAgain();
  }, [action]);

  /* NO AFFORDANCE MEANS NO BUTTON. A row that says "use your browser menu" has
     nothing to press, and drawing it pressable would be the green light wired
     to nothing this screen's alert group exists to remove. */
  if (action === null) {
    return (
      <div className="fwm-settingsv1-row" data-testid="settingsv1-install">
        <span className="fwm-settingsv1-row-label">{INSTALL_LABEL}</span>
        <span className="fwm-settingsv1-row-value fwm-data">{value}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="fwm-settingsv1-row"
      data-testid="settingsv1-install"
      onClick={press}
    >
      <span className="fwm-settingsv1-row-label">{INSTALL_LABEL}</span>
      <span className="fwm-settingsv1-row-value fwm-data">{value}</span>
      <span className="fwm-settingsv1-row-word">{action}</span>
    </button>
  );
}
