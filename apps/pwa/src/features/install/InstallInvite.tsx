/**
 * THE INSTALL INVITE - install it, open it, or keep using the website.
 *
 * =============================================================================
 * WHY THE THIRD OPTION IS NOT A DISMISS
 * =============================================================================
 * Most install prompts offer "install" and "not now", which is a question the
 * app will ask again tomorrow. This one offers KEEP USING THE WEBSITE and
 * remembers it, because using the site in a browser is a legitimate permanent
 * choice - especially for this product. A driver who does not want a
 * counter-surveillance app as an icon on their home screen has a very good
 * reason not to want one, and nagging them about it is the app arguing with a
 * threat model it does not know.
 *
 * =============================================================================
 * WHAT IT OFFERS DEPENDS ON WHAT IS TRUE
 * =============================================================================
 *   installed elsewhere   OPEN IT. `getInstalledRelatedApps` found a copy on
 *                         this device, so the useful action is switching to it,
 *                         not installing a second one.
 *   installable           INSTALL. A real `beforeinstallprompt` was captured
 *                         and the browser will show its own dialog.
 *   neither               HOW TO. iOS Safari and Firefox never fire the event,
 *                         and the honest answer is the share-menu instruction
 *                         rather than a button that does nothing.
 *
 * =============================================================================
 * WHEN IT APPEARS
 * =============================================================================
 * Never on the first launch, never while a camera alert is live, never once
 * refused, and never when already running installed. Those four are the
 * controller's rules (`services/pwa/installPrompt.ts`) and this component does
 * not second-guess any of them - it renders when it is told to.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { closeOverlay } from '../../app/screenState.ts';
import { OverlayClose } from '../../components/overlay/OverlayClose.tsx';
import { useOverlayDismiss } from '../../components/overlay/useOverlayDismiss.ts';
import { installController } from '../../services/pwa/installRegistry.ts';
import type { InstallPromptStatus } from '../../services/pwa/installPrompt.ts';
import { hasInstalledRelatedApp } from '../../services/pwa/relatedApps.ts';

import './install.css';

export const INSTALL_TITLE = 'Add DarkRoute to this phone?';

export const INSTALL_BODY =
  'installed, DarkRoute gets its own icon and its files can stay available for drives with no ' +
  'signal. browser and phone rules still control whether warnings run with the screen locked. ' +
  'there is no account or app store, and it uninstalls like any icon.';

export const INSTALL_NOW = 'Install';
export const INSTALL_OPEN = 'Open the app';
export const INSTALL_WEB = 'Keep using the website';

/** Said on a browser with no install event. Safari and Firefox, mainly. */
export const INSTALL_MANUAL_TITLE = 'Add it from your browser menu';
export const INSTALL_MANUAL_BODY =
  'this browser does not let a page offer an install, so it is the share menu, then “add to home ' +
  'screen”.';

/** The one sentence that makes the third option a real choice. */
export const INSTALL_NEVER = 'we will not ask again.';

/**
 * Pop the invite. It is always the top of the stack when it is on screen --
 * the shell renders only the top overlay -- so this needs no id, and keeping
 * it out of the component makes it a stable reference for the dismiss hook.
 */
function closeInvite(): void {
  closeOverlay();
}

export function InstallInvite(): ReactElement | null {
  const [status, setStatus] = useState<InstallPromptStatus | null>(() =>
    installController()?.status() ?? null,
  );
  const [installedElsewhere, setInstalledElsewhere] = useState(false);

  useEffect(() => {
    const controller = installController();
    if (controller === null) return undefined;
    setStatus(controller.status());
    return controller.subscribe(setStatus);
  }, []);

  useEffect(() => {
    let live = true;
    void hasInstalledRelatedApp().then((found) => {
      if (live) setInstalledElsewhere(found);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * THE WAY OUT, and the route every other exit from this card takes.
   *
   * The X this returns is a NOT NOW and nothing more: it pops the overlay and
   * leaves the controller's own state alone, so the invite may be offered
   * again on a later launch. KEEP USING THE WEBSITE remains the durable
   * refusal -- that is the whole point of the third option, and an X that
   * quietly meant "never again" would take that decision away from the
   * driver without telling them.
   *
   * It also restores focus and answers Escape. See
   * components/overlay/useOverlayDismiss.ts.
   */
  const dismiss = useOverlayDismiss(closeInvite);

  /** INSTALL. Must run inside the gesture or the browser refuses the prompt. */
  const install = useCallback(() => {
    void installController()
      ?.prompt()
      .finally(() => {
        dismiss();
      });
  }, [dismiss]);

  /**
   * KEEP USING THE WEBSITE, remembered.
   *
   * The CONTROLLER's own dismiss() is the durable refusal, the same one that
   * stops it re-arming on the next launch -- not the overlay dismiss above,
   * which is only a not-now. This key is the permanent answer.
   */
  const keepWeb = useCallback(() => {
    void installController()
      ?.dismiss()
      .finally(() => {
        dismiss();
      });
  }, [dismiss]);

  /**
   * OPEN THE INSTALLED COPY.
   *
   * There is no web API that launches another app's window, so this cannot do
   * it for them - and a button that silently does nothing is the thing this
   * whole component exists to avoid. It records the refusal and says where the
   * icon is, which is the true and useful version.
   */
  const [openHint, setOpenHint] = useState(false);
  const openInstalled = useCallback(() => {
    setOpenHint(true);
  }, []);

  if (status?.installed === true) return null;

  const installable = status?.canPrompt === true;

  return (
    <section className="fwm-install" aria-label="install">
      <span className="fwm-install-grabber" aria-hidden="true" />

      <div className="fwm-install-head">
        <span className="fwm-install-mark" aria-hidden="true" />
        <h1 className="fwm-install-title">
          {installedElsewhere ? 'DarkRoute is already on this phone' : INSTALL_TITLE}
        </h1>
        {/* THE SAME CLOSE KEY THE REPORT SHEET DRAWS. This card had no
            dismiss at all: the only exits were answering the question or
            finding a back gesture, and in the installed PWA there is no
            browser chrome to find one in. */}
        <OverlayClose onClose={dismiss} />
      </div>

      <p className="fwm-install-body">
        {installedElsewhere
          ? 'you are looking at the website. open the installed copy from your home screen.'
          : INSTALL_BODY}
      </p>

      {installedElsewhere ? (
        <>
          <button type="button" className="fwm-install-key" data-fwm-key="primary" onClick={openInstalled}>
            {INSTALL_OPEN}
          </button>
          {openHint ? (
            <p className="fwm-install-note fwm-data" role="status">
              a page cannot launch another app, so this one cannot do it for you - open DarkRoute from
              your home screen.
            </p>
          ) : null}
        </>
      ) : installable ? (
        <button type="button" className="fwm-install-key" data-fwm-key="primary" onClick={install}>
          {INSTALL_NOW}
        </button>
      ) : (
        <div className="fwm-install-manual">
          <p className="fwm-install-manual-title">{INSTALL_MANUAL_TITLE}</p>
          <p className="fwm-install-note fwm-data">{INSTALL_MANUAL_BODY}</p>
        </div>
      )}

      <button type="button" className="fwm-install-key" onClick={keepWeb}>
        {INSTALL_WEB}
      </button>
      <p className="fwm-install-note fwm-data">{INSTALL_NEVER}</p>
    </section>
  );
}
