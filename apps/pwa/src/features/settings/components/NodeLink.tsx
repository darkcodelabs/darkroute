/**
 * CONNECT - the way in to node pairing, as a row in SETTINGS.
 *
 * UNCONDITIONAL, unlike `AdminLink`. Whether a driver has hardware is not
 * something the app can detect, and hiding the row until a node appears would
 * mean the only people who could find it are the ones who already knew where
 * it was. The screen it opens is honest about how far the work has got, which
 * is the right place for that answer -- not a missing row.
 *
 * Placed after ACCESS and before MAP: it is a door to another screen like the
 * two above it, and it is not a preference like the sections below.
 */

import type { ReactElement } from 'react';

import { openScreen } from '../../../app/screenState.ts';

export const NODE_SECTION = 'CONNECT';
export const NODE_CAPTION =
  'a node is a small radio in the car - a better fix than the phone can give, and a lora link ' +
  'that reaches other darkroute with no cell network in between.';
export const NODE_LABEL = 'NODE + MESH';
/** The true state, said before the row is pressed rather than after. */
export const NODE_NOTE = 'NONE PAIRED';

export function NodeLink(): ReactElement {
  return (
    <section className="fwm-settings-section" aria-label={NODE_SECTION}>
      <h2 className="fwm-settings-eyebrow fwm-data">{NODE_SECTION}</h2>
      <p className="fwm-settings-caption fwm-data">{NODE_CAPTION}</p>
      <button
        type="button"
        className="fwm-settings-link"
        onClick={() => {
          openScreen('node');
        }}
      >
        <span className="fwm-settings-link-label fwm-data">{NODE_LABEL}</span>
        <span className="fwm-settings-link-note fwm-data">{NODE_NOTE}</span>
      </button>
    </section>
  );
}
