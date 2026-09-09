/**
 * The `YOU` block -- what the microphone heard, behind a 2px rule.
 *
 * SOURCE: `Flockys App Screens.dc.html`, `04 · ASK - LISTENING` -- a 2px
 * #3A3F4B left rule, 14px of padding, the speaker label `YOU` in 10px mono at
 * .18em, and the question at 20px/600/1.3:
 *
 *   any cameras on my route home
 *
 * =============================================================================
 * A TRANSCRIPT IS THE MOST SENSITIVE STRING ON THIS SCREEN
 * =============================================================================
 * A spoken question can contain a licence plate, an address, or a name. This
 * component renders it and does nothing else with it: no storage, no URL, no
 * notification, no analytics, no log. It has no props but the string and no
 * imports but React, so there is no channel here that could carry one.
 *
 * INTERIM RESULTS ARE MARKED AS SUCH
 * An interim result is the recogniser's current guess and it will change. It
 * renders dimmed via `[data-fwm-ask-interim]` -- the smallest honest difference
 * between "this is what you said" and "this is what it has so far".
 */

import type { ReactElement } from 'react';

export interface TranscriptProps {
  readonly text: string;
  /** True while the recogniser has not marked this result final. */
  readonly interim: boolean;
}

export function Transcript({ text, interim }: TranscriptProps): ReactElement | null {
  if (text.trim() === '') return null;

  return (
    <div className="fwm-ask-you">
      <p className="fwm-ask-speaker">YOU</p>
      <p className="fwm-ask-transcript" data-fwm-ask-interim={interim ? 'true' : 'false'}>
        {text}
      </p>
    </div>
  );
}
