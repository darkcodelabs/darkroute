/**
 * `RE-ALERT ON MUTED IF` / `closer than 150 ft`.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B4 · ALERT TRIAGE - BY OWNER TYPE` --
 * a 56px row with a rule above it, pushed to the bottom of the body, a 15px/600
 * headline over a mono 11px caption, and the switch in the approaching amber
 * rather than the crimson the owner rows use.
 *
 * WHAT IT CONTROLS: `settings.reAlertWhenCloserThanFt`, which
 * `stores/alert.ts#mutePierces` compares the nearest distance against. This is
 * the one control on the screen that makes a MUTED camera louder rather than
 * quieter, which is why it is drawn in a different hue and lives below the
 * card that explains what muting does and does not do.
 *
 * The design draws a switch, and the model stores a distance. Off is expressed
 * as `RE_ALERT_OFF_FT`, which `mutePierces` can never satisfy.
 * GAP: see docs/gaps-inbox/triage.md#re-alert-is-a-switch-over-a-distance
 */

import type { ReactElement } from 'react';

import { isReAlertOn, reAlertCaption } from '../triage.ts';

import { TriageSwitch } from './TriageSwitch.tsx';

/** Verbatim from B4. */
export const RE_ALERT_LABEL = 'RE-ALERT ON MUTED IF';

export interface ReAlertRowProps {
  /** The stored distance in feet. Zero is the off position. */
  readonly reAlertFt: number;
  /** Absent means "not wired in this build" -- the switch renders disabled. */
  readonly onReAlert?: ((on: boolean) => void) | undefined;
}

export function ReAlertRow({ reAlertFt, onReAlert }: ReAlertRowProps): ReactElement {
  const on = isReAlertOn(reAlertFt);

  return (
    <div className="fwm-triage-footer">
      <div className="fwm-triage-realert" data-fwm-triage-realert={on ? 'on' : 'off'}>
        <div className="fwm-triage-owner-main">
          <div className="fwm-triage-owner-label">{RE_ALERT_LABEL}</div>
          <div className="fwm-triage-owner-caption">{reAlertCaption(reAlertFt)}</div>
        </div>
        <TriageSwitch label={RE_ALERT_LABEL} on={on} tone="pierce" onToggle={onReAlert} />
      </div>
    </div>
  );
}
