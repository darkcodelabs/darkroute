/**
 * The pill switch B4 draws six times: five owner classes and the re-alert row.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B4 · ALERT TRIAGE - BY OWNER TYPE` --
 * a 56x30 track at radius 999 with a 24px knob inset 3px. ON is the in-range
 * crimson with a knob in the page ground and the knob to the right; OFF is the
 * line grey with a muted-grey knob to the left. The re-alert row's ON state is
 * the approaching amber instead of the crimson.
 *
 * THE KNOB DOES NOT MOVE BY A COMPUTED OFFSET. There is no inline style in this
 * feature, so the knob's side is flex alignment keyed off `aria-checked` -- the
 * same attribute assistive technology reads. The picture and the announcement
 * cannot drift apart.
 *
 * A switch with no handler renders disabled rather than live-looking and inert.
 */

import type { ReactElement } from 'react';

/** Which ON hue. `alert` silences a class; `pierce` lets one through a mute. */
export type SwitchTone = 'alert' | 'pierce';

export interface TriageSwitchProps {
  /** What this switch is about, for the accessible name. */
  readonly label: string;
  readonly on: boolean;
  readonly tone: SwitchTone;
  /** Absent means "not wired in this build". */
  readonly onToggle?: ((on: boolean) => void) | undefined;
}

export function TriageSwitch({ label, on, tone, onToggle }: TriageSwitchProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="fwm-triage-switch"
      data-fwm-triage-switch-tone={tone}
      disabled={onToggle === undefined}
      onClick={
        onToggle === undefined
          ? undefined
          : () => {
              onToggle(!on);
            }
      }
    >
      <span className="fwm-triage-switch-track" aria-hidden="true">
        <span className="fwm-triage-switch-knob" />
      </span>
    </button>
  );
}
