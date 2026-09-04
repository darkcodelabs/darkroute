/**
 * THE FAQ, as a row in SETTINGS.
 *
 * It used to be a `?` key in RADAR's header, on the argument that "what is this
 * app doing with my location" should not sit behind the same control as the
 * themes. That argument is right and the placement was not: the header's middle
 * is a live count, and when that count gained LOCAL and NETWORK it had nowhere
 * to grow but underneath the title. Two keys either side of a reading that
 * changes width is one key too many.
 *
 * So it is one tap further away and the header has room for the thing it exists
 * to show. The answers themselves are unchanged -- `features/help` renders
 * them, each citing the file that makes it true, and
 * `scripts/check-help-citations.mjs` fails the build if a citation stops
 * resolving.
 */

import type { ReactElement } from 'react';

import { openScreen } from '../../../app/screenState.ts';

export const HELP_SECTION = 'QUESTIONS';
export const HELP_CAPTION =
  'what this app knows, what it keeps, and what it sends. every answer names the file that makes it true.';
export const HELP_LABEL = 'WHAT THIS APP KNOWS';

export function HelpLink(): ReactElement {
  return (
    <section className="fwm-settings-section" aria-label={HELP_SECTION}>
      <h2 className="fwm-settings-eyebrow fwm-data">{HELP_SECTION}</h2>
      <p className="fwm-settings-caption fwm-data">{HELP_CAPTION}</p>
      <button
        type="button"
        className="fwm-settings-link"
        onClick={() => {
          openScreen('help');
        }}
      >
        <span className="fwm-settings-link-label fwm-data">{HELP_LABEL}</span>
      </button>
    </section>
  );
}
