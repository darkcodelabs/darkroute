/**
 * DISMISSING AN OVERLAY: ESCAPE, AND WHERE FOCUS GOES AFTERWARDS.
 *
 * =============================================================================
 * THE BUG THIS EXISTS TO NOT REPEAT
 * =============================================================================
 * MapControlPanel already learned it, and its closeAndRestore carries the
 * note: a surface that shuts from inside its own click handler takes the
 * button that had focus with it, so focus falls to the document body. A
 * sighted driver never notices. A screen-reader driver is returned to the top
 * of the page with no announcement that anything closed, and no idea where
 * they now are.
 *
 * The panel could be handed a ref to the key that opened it because DRIVE owns
 * both. An overlay cannot: it is raised through openOverlay from a dock key, a
 * map dot, a Look up row or - for the install invite - from no gesture at all,
 * and the shell that renders it has never met the opener. So the opener is
 * remembered here instead, read once as the overlay mounts.
 *
 * =============================================================================
 * ESCAPE IS NOT A NICETY HERE
 * =============================================================================
 * This app runs on desktop browsers too, and an overlay that only closes
 * under a thumb is an overlay a keyboard cannot leave. Bound on the document
 * rather than on the surface, because a sheet does not take focus when it
 * opens - the report sheet never has.
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * The shell marks its screen element with this. It is the fallback the focus
 * goes to when the control that opened the overlay is gone - a Look up row
 * whose list re-rendered, a map dot that was never a DOM node at all.
 */
export const SCREEN_ROOT_ATTRIBUTE = 'data-fwm-screen-root';

/**
 * Whatever had focus when the overlay went up, or null.
 *
 * document.activeElement answers with the body element when nothing is
 * focused, and the body is not somewhere to send a reader back to - it is
 * precisely the failure this file exists to prevent, so it reads as nothing.
 */
function openerAtMount(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** The opener if it is still in the document, otherwise the screen under it. */
function restoreFocus(opener: HTMLElement | null): void {
  if (opener !== null && opener.isConnected) {
    opener.focus();
    return;
  }
  const screen = document.querySelector<HTMLElement>('[' + SCREEN_ROOT_ATTRIBUTE + ']');
  screen?.focus();
}

/**
 * Wrap an overlay's own close function so that every way out behaves the same.
 *
 * The returned function is what the close key, the scrim and Escape must all
 * call - never the raw close, or one of the three drops focus and the other
 * two do not. Order matters and is the panel's: close first, then move focus,
 * so the element being focused is one React is not about to unmount.
 */
export function useOverlayDismiss(close: () => void): () => void {
  const [opener] = useState<HTMLElement | null>(openerAtMount);

  const dismiss = useCallback((): void => {
    close();
    restoreFocus(opener);
  }, [close, opener]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // A view that answers Escape itself marks the event handled - v0's INTEL
      // card does, because it traps focus and owns its own dismiss. Acting on
      // it a second time here would close the overlay and then pop a history
      // entry behind it, which lands the driver on a screen they never chose.
      if (event.defaultPrevented) return;
      /*
       * ESCAPE CLOSES THE TOPMOST SURFACE, AND ONLY THAT ONE.
       *
       * This listener is CAPTURE phase, and it marks the event handled. Both
       * matter, and the bug that forced them is worth stating: DRIVE's map
       * control panel binds its own `document` keydown (MapControlPanel.tsx,
       * see the comment there). With both on the bubble phase, registration
       * order decided the outcome - the panel mounts with the screen, the
       * overlay mounts later, so ONE Escape closed the sheet AND the unrelated
       * panel behind it, and the sheet's focus restore then overwrote the
       * panel's. Reading `defaultPrevented` did not help: the guard was
       * one-directional, checking a flag this hook never set.
       *
       * Capture runs before any bubble listener on the same node, so an open
       * overlay - which is by definition on top - answers first and stops the
       * event before anything underneath sees it.
       */
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [dismiss]);

  return dismiss;
}
