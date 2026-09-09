/**
 * The five owner-class rows.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B4 · ALERT TRIAGE - BY OWNER TYPE` --
 * five 64px rows split by 1px rules, each a 15px/600 headline over a mono 11px
 * caption, with the switch right-aligned. Row order and the five headlines are
 * the panel's, in the panel's order.
 *
 * =============================================================================
 * A SWITCHED-OFF CLASS IS STILL ON THIS SCREEN, AND STILL IN EVERY COUNT
 * =============================================================================
 * Nothing here removes, reorders, collapses or hides a row when its switch goes
 * off. The headline dims -- which is how the design draws the two off rows --
 * and the caption's count is computed from the recorded log without consulting
 * the switch at all. "Muting only removes the alert - never the record."
 */

import type { ReactElement } from 'react';

import type { CameraOwnerType } from '../triage.ts';

import { TriageSwitch } from './TriageSwitch.tsx';

export interface OwnerRow {
  readonly ownerType: CameraOwnerType;
  /** `POLICE / AGENCY`, `HOA / NEIGHBORHOOD`, ... */
  readonly label: string;
  /** `any owner, shared feed`, `11 on your usual routes`, ... */
  readonly caption: string;
  /** True means "alert on this class". */
  readonly enabled: boolean;
}

export interface OwnerFilterListProps {
  readonly rows: readonly OwnerRow[];
  /** Absent means "not wired in this build" -- the switches render disabled. */
  readonly onOwnerType?: ((ownerType: CameraOwnerType, enabled: boolean) => void) | undefined;
}

export function OwnerFilterList({ rows, onOwnerType }: OwnerFilterListProps): ReactElement {
  return (
    <div className="fwm-triage-owners" role="group" aria-label="ALERT BY OWNER TYPE">
      {rows.map((row) => (
        <div
          key={row.ownerType}
          className="fwm-triage-owner"
          data-fwm-triage-owner={row.ownerType}
          data-fwm-triage-owner-enabled={String(row.enabled)}
        >
          <div className="fwm-triage-owner-main">
            <div className="fwm-triage-owner-label">{row.label}</div>
            <div className="fwm-triage-owner-caption">{row.caption}</div>
          </div>
          <TriageSwitch
            label={row.label}
            on={row.enabled}
            tone="alert"
            onToggle={
              onOwnerType === undefined
                ? undefined
                : (next) => {
                    onOwnerType(row.ownerType, next);
                  }
            }
          />
        </div>
      ))}
    </div>
  );
}
