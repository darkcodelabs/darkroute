/**
 * THE CLOSE KEY EVERY OVERLAY DRAWS.
 *
 * =============================================================================
 * WHY THIS IS A COMPONENT AND NOT A CONVENTION
 * =============================================================================
 * The REPORT sheet has always had a round X at its top right and it has always
 * worked. Nothing else did: INTEL drew a back chevron, the install invite drew
 * no dismiss at all, and a driver who opened either one in the installed PWA
 * had no browser chrome to fall back on. The fix is not a third close key with
 * roughly the same shape -- it is this one, carrying the sheet's own markup,
 * the sheet's own 44px rule and the sheet's own accessible name, everywhere.
 *
 * A BARE GLYPH IS NOT A NAME. The cross is drawn and aria-hidden; the button
 * is named by OVERLAY_CLOSE_LABEL. A screen reader that announces
 * "multiplication sign, button" has told a driver nothing about the way out.
 *
 * This draws the key and nothing else. WHAT closing means -- which overlay id
 * is popped, where focus lands afterwards, and whether Escape does the same
 * thing -- is useOverlayDismiss.ts, next to it.
 */

import type { ReactElement } from 'react';

import './overlayClose.css';

/** The accessible name, identical on every overlay so it is one thing to find. */
export const OVERLAY_CLOSE_LABEL = 'close';

/** Drawn, and hidden from the reader: the label above is what it is called. */
export const OVERLAY_CLOSE_GLYPH = '✕';

export interface OverlayCloseProps {
  /**
   * Dismiss the overlay. Absent renders the key DISABLED rather than absent --
   * the report sheet's own rule. A missing key reads as "this surface has no
   * exit"; a disabled one reads as "this build did not wire it", which is the
   * truth and is visible in a screenshot.
   */
  readonly onClose?: (() => void) | undefined;
}

export function OverlayClose({ onClose }: OverlayCloseProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-overlay-close"
      aria-label={OVERLAY_CLOSE_LABEL}
      disabled={onClose === undefined}
      onClick={onClose}
    >
      <span aria-hidden="true">{OVERLAY_CLOSE_GLYPH}</span>
    </button>
  );
}
