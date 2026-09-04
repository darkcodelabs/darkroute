/**
 * The single action a degraded RADAR offers.
 *
 * SOURCE: `Flockys App Screens v2.dc.html`, state matrix card 3 -- a 44px
 * `RETRY LOCK` at the bottom of the card, `background:#1B1E25` at an 8px
 * radius with no border. `A2 · OFFLINE` draws a 48px `RETRY SYNC` and
 * `A1 · ONBOARDING` labels the location permission control `ALLOW`; v2 did not
 * redraw either, so both keep their labels and take v2's flat treatment
 * through this one component.
 *
 * v1 drew this control as a 1px `#3A3F4B` outline at a 2px radius. That is the
 * single element the v2 pass changed in the whole state matrix, which is what
 * makes "flat borderless controls" a global reading rather than a screen-01
 * one.
 *
 * WHY IT CAN BE DISABLED
 *   RADAR does not own a sensor, a permission or a sync queue -- it is handed a
 *   callback or it is handed nothing. A build that has not wired one yet
 *   renders the button the design draws, disabled, rather than a live-looking
 *   control that silently does nothing. Faking the capability is the one thing
 *   this component may not do.
 *
 * PERMISSIONS ARE ONLY EVER REQUESTED FROM A PRESS
 *   `ALLOW` is a button and its handler runs on click. Nothing on this screen
 *   requests a permission on mount, and nothing here touches an adapter
 *   directly -- the handler comes from above.
 */

import type { ReactElement } from 'react';

export interface RadarActionProps {
  /** The exact label from the design: `RETRY LOCK`, `ALLOW`, `RETRY SYNC`. */
  readonly label: string;
  /** Absent means "not wired in this build" -- the button renders disabled. */
  readonly onPress?: (() => void) | undefined;
}

export function RadarAction({ label, onPress }: RadarActionProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-radar-action"
      data-fwm-radar-action={label}
      disabled={onPress === undefined}
      onClick={onPress}
    >
      {label}
    </button>
  );
}
