/**
 * One 56px toggle row: a label on the left, the pill on the right.
 *
 * SOURCE: `Flockys Design System.dc.html` section 04 -- 56px tall, a 1px rule
 * along the bottom, the label at 15px/600/.04em, and the label rendered in the
 * MUTED grey when the switch is off. That last detail is section 04's own:
 * `Vibration` is drawn in `#F7F9FC` with the switch on, `Wake lock` in
 * `#6B7381` with it off. The row states its value twice, which is what makes
 * it readable at a glance in a car.
 *
 * The label element is a `<span>`, not a `<label>`: the control is a
 * `role="switch"` button that carries its own accessible name, and wrapping it
 * in a label would announce the name twice.
 */

import type { ReactElement } from 'react';

import { SettingsSwitch } from './SettingsSwitch.tsx';

export interface SwitchRowProps {
  readonly label: string;
  readonly on: boolean;
  readonly onToggle?: ((on: boolean) => void) | undefined;
}

export function SwitchRow({ label, on, onToggle }: SwitchRowProps): ReactElement {
  return (
    <div className="fwm-settings-row" data-fwm-settings-row={on ? 'on' : 'off'}>
      <span className="fwm-settings-row-label">{label}</span>
      <SettingsSwitch label={label} on={on} onToggle={onToggle} />
    </div>
  );
}
