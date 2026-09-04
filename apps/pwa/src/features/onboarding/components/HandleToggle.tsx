/**
 * SHOW A HANDLE - the one preference onboarding collects.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A1 · ONBOARDING - PERMISSIONS`:
 *
 *   "SHOW A HANDLE"
 *   "off = you appear as an anonymous dot"
 *
 * The design draws it OFF, and OFF is the default. That is not a styling
 * decision: the privacy-preserving state is the one a driver gets without
 * choosing anything, and the copy under the label is the whole explanation of
 * what the other state costs them.
 *
 * THIS TOGGLE DOES NOT CLAIM A HANDLE. It records a preference and nothing
 * else. No name is entered here, no name is sent anywhere from here, and
 * turning it on does not reserve, verify or publish anything - claiming a
 * handle is a separate, later action against the session slice. Onboarding
 * runs before the driver has any reason to trust us with a name.
 *
 * THE WHOLE ROW IS THE SWITCH. The design draws a 56x30 track; that is 14px
 * under the 44px touch floor and this is a one-handed screen. The track is
 * decoration on a control the size of the card, which is what
 * `role="switch"` on the row buys us - one target, one accessible name, one
 * state.
 */

import type { ReactElement } from 'react';

import '../onboarding.css';

export interface HandleToggleProps {
  readonly checked: boolean;
  /** Called with the state the driver just asked for. */
  readonly onChange: (next: boolean) => void;
}

export function HandleToggle({ checked, onChange }: HandleToggleProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-handle-toggle"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="fwm-handle-text">
        <span className="fwm-handle-label">SHOW A HANDLE</span>
        <span className="fwm-handle-hint">off = you appear as an anonymous dot</span>
      </span>
      {/* Decoration. The state is on the button, where a screen reader reads
          it; this is the same state drawn for the eye. */}
      <span className="fwm-handle-track" aria-hidden="true">
        <span className="fwm-handle-knob" />
      </span>
    </button>
  );
}
