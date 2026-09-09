/**
 * The pill toggle, exactly as the design system draws it.
 *
 * SOURCE: `Flockys Design System.dc.html` section 04, panel
 * `TOGGLE · SLIDER · CHIPS` -- a 56x30 track at radius 999 with a 24px knob
 * inset 3px on every edge. ON is the clear green with a knob in the page
 * ground and the knob to the right; OFF is the line grey with a muted-grey
 * knob to the left.
 *
 * =============================================================================
 * WHY THIS IS NOT `TriageSwitch`
 * =============================================================================
 * Same geometry, different hue, and the hue is the whole point. B4 and B5
 * colour their ON state with the in-range crimson because those switches decide
 * whether a camera alerts you -- they are part of the alert language. Section
 * 04 colours the component toggle `#3DE08A`, the clear green, because these
 * ones decide how the app behaves and carry no alert meaning at all.
 *
 * `TriageSwitch`'s tone union is `'alert' | 'pierce'`; adding a third would
 * mean editing a file this feature does not own, so the section-04 toggle is
 * built here instead. Geometry is derived the same way in `settings.css`, from
 * the same tokens, so the two cannot drift in size.
 * GAP: see docs/gaps-inbox/settings.md#section-04-toggle-hue-differs-from-b4
 *
 * =============================================================================
 * THE KNOB DOES NOT MOVE BY A COMPUTED OFFSET
 * =============================================================================
 * There is no inline style in this feature. The knob's side is flex alignment
 * keyed off `aria-checked` -- the same attribute assistive technology reads --
 * so the picture and the announcement cannot drift apart.
 *
 * A switch with no handler renders disabled rather than live-looking and inert.
 */

import type { ReactElement } from 'react';

export interface SettingsSwitchProps {
  /** What this switch is about, for the accessible name. */
  readonly label: string;
  readonly on: boolean;
  /** Absent means "not wired in this build". */
  readonly onToggle?: ((on: boolean) => void) | undefined;
}

export function SettingsSwitch({ label, on, onToggle }: SettingsSwitchProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="fwm-settings-switch"
      disabled={onToggle === undefined}
      onClick={
        onToggle === undefined
          ? undefined
          : () => {
              onToggle(!on);
            }
      }
    >
      <span className="fwm-settings-switch-track" aria-hidden="true">
        <span className="fwm-settings-switch-knob" />
      </span>
    </button>
  );
}
