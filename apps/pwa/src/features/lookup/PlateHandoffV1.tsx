/**
 * THE PLATE HAND-OFF - v1.
 *
 * =============================================================================
 * WHY THIS IS NOT `LookupScreen`
 * =============================================================================
 * v1's LOOK UP used to render v0's whole screen inline behind a disclosure
 * row, which put a v0 screen inside a v1 one. This is the same behaviour in v1
 * chrome.
 *
 * =============================================================================
 * EVERY RULE v0'S SCREEN ENFORCES IS ENFORCED HERE
 * =============================================================================
 * `handoff.ts` is imported whole and is where all of it lives:
 *
 *   - COPY FIRST, THEN OPEN. A clipboard write after a navigation can lose the
 *     document's user activation and fail silently, leaving somebody staring
 *     at a search box with nothing to paste.
 *   - THE PLATE NEVER TRAVELS IN A URL. A plate in a URL is a plate in a
 *     browser history, a referrer header and a server log. It goes on the
 *     clipboard and the driver pastes it, which keeps the decision with the
 *     person whose plate it is.
 *   - `noopener,noreferrer`, so their page cannot reach back through
 *     `window.opener` and their logs do not record which of our screens
 *     somebody came from.
 *   - THE FIELD IS CLEARED on hand-off and nothing typed is stored.
 *   - NO CLAIM ABOUT A HIT. Their robots.txt refuses `/api/`, so this app
 *     cannot know, and the copy never implies it does.
 *
 * `LookupV1Screen.source.test.ts` reads this file too and fails on any network
 * call appearing in it.
 */

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';

import {
  HANDOFF_NOTE,
  HIBF_URL,
  NO_AUTOMATIC_CHECK_NOTE,
  browserOpener,
  handOff,
} from './handoff.ts';
import type { HandoffOutcome } from './handoff.ts';

export const PLATE_HEADING = 'Has an operator searched my plate?';
export const PLATE_BODY =
  'only haveibeenflocked.com knows, from records they got by foia request. this sends you there ' +
  'with the plate on your clipboard.';

export const PLATE_FIELD_LABEL = 'PLATE · OPTIONAL';
export const PLATE_GO = 'Open haveibeenflocked';

/** v0's words for the three outcomes, unchanged: they are all true. */
export const OUTCOME_TEXT: Readonly<Record<HandoffOutcome, string>> = {
  'copied-and-opened': 'opened. the plate is on your clipboard, paste it into their search.',
  // Not an error. The site is open and the driver has the plate in front of them.
  'opened-only': 'opened. your browser would not let us copy, so type the plate in their search.',
  unavailable: `could not open a tab. their site is ${HIBF_URL}`,
};

export function PlateHandoffV1(): ReactElement {
  const [plate, setPlate] = useState('');
  const [outcome, setOutcome] = useState<HandoffOutcome | null>(null);

  const onGo = useCallback((): void => {
    void (async (): Promise<void> => {
      const result = await handOff(plate.trim(), {
        clipboard: {
          async write(text: string): Promise<boolean> {
            if (text === '') return false;
            try {
              await navigator.clipboard.writeText(text);
              return true;
            } catch {
              // Refused, or no permission. The site still opens.
              return false;
            }
          },
        },
        opener: browserOpener(),
      });
      setOutcome(result);
      // Cleared on the way out. Nothing typed here is kept.
      setPlate('');
    })();
  }, [plate]);

  return (
    <div className="fwm-lookupv1-plate-panel">
      <h2 className="fwm-lookupv1-plate-heading">{PLATE_HEADING}</h2>
      <p className="fwm-lookupv1-plate-body fwm-data">{PLATE_BODY}</p>

      <label className="fwm-lookupv1-plate-field">
        <span className="fwm-lookupv1-plate-field-label fwm-data">{PLATE_FIELD_LABEL}</span>
        <input
          className="fwm-lookupv1-input"
          type="text"
          value={plate}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setPlate(event.target.value);
          }}
        />
      </label>

      <button type="button" className="fwm-lookupv1-plate-go" onClick={onGo}>
        {PLATE_GO}
      </button>

      <p className="fwm-lookupv1-plate-note fwm-data">{HANDOFF_NOTE}</p>
      <p className="fwm-lookupv1-plate-note fwm-data">{NO_AUTOMATIC_CHECK_NOTE}</p>

      {outcome === null ? null : (
        <p className="fwm-lookupv1-plate-outcome fwm-data" role="status">
          {OUTCOME_TEXT[outcome]}
        </p>
      )}
    </div>
  );
}
