/**
 * One notice line under ASK's header.
 *
 * =============================================================================
 * THE DESIGN DRAWS NO SURFACE FOR THIS, AND TWO RULES REQUIRE ONE
 * =============================================================================
 *   1. "The `WAKE WORD ON` chip drawn in `04 · ASK` must render this reason
 *       instead of a broken promise."
 *   2. "`sendsAudioOffDevice()` exposes the Chromium fact so a screen can warn
 *       BEFORE the first press rather than after."
 *       -- both docs/platform-capabilities.md
 *
 * A 10px nowrap chip in a 52px header cannot carry either sentence. Rather than
 * invent a new surface, this follows RADAR's OFFLINE strip: full width, under
 * the header, mono micro, amber. The idiom already exists in the product and
 * already means "something about this screen is degraded".
 *
 * It is NOT a verbatim copy of that strip, and the differences are deliberate:
 * no pulsing dot, and it wraps and grows past 32px instead of truncating,
 * because these sentences are whole sentences and a privacy disclosure that
 * ends in an ellipsis has not been disclosed.
 * GAP: see docs/gaps-inbox/ask.md#no-drawn-surface-for-the-wake-word-reason
 *
 * WHAT IT SAYS IS NOT AUTHORED COPY, EXCEPT TWICE
 * The wake-word and speech reasons are the adapter's own sentences, rendered
 * verbatim, so the screen and the platform can never drift apart. The
 * off-device-audio line and the wake-word-yielded line are the two authored
 * strings, both cadenced on RADAR's `NO NETWORK · RUNNING ON CACHE`.
 */

import type { ReactElement } from 'react';

/**
 * `warning` is amber: something the driver should weigh before pressing.
 * `unsupported` is grey: a capability that is simply absent is a fact, not an
 * alarm, and grey is how this product draws "not an alert".
 */
export type AskNoticeTone = 'warning' | 'unsupported';

export interface AskNoticeProps {
  readonly text: string;
  readonly tone: AskNoticeTone;
}

export function AskNotice({ text, tone }: AskNoticeProps): ReactElement | null {
  if (text.trim() === '') return null;

  return (
    <p className="fwm-ask-notice" data-fwm-ask-notice={tone} role="status">
      {text}
    </p>
  );
}
