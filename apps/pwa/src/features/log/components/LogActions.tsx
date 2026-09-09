/**
 * `HEAT MAP` and `ZONE AUDIT` -- the two 44px keys pinned to the bottom.
 *
 * SOURCE: `Flockys App Screens.dc.html`, `05 · LOG - EXPOSURE` -- two equal
 * 44px buttons, 1px `--fwm-line-strong` rule, radius 2, 12px/600/.08em.
 *
 * Both navigate through the one navigation model (`app/screenState.ts`, mirrored
 * by `stores/navigation.ts`), which writes a screen id and nothing else to the
 * URL. There is no second router here and no destination invented for them:
 * `heat-map` and `zone-audit` are already declared screen ids.
 *
 * `HEAT MAP` has no screen drawn for it yet
 * (`DESIGN-GAPS.md#no-heat-map-screen-exists`); the shell renders its honest
 * "screen not built" state, which is the truth rather than a fake map.
 *
 * A key with no handler renders disabled rather than live-looking and inert.
 */

import type { ReactElement } from 'react';

export interface LogActionsProps {
  readonly onHeatMap?: (() => void) | undefined;
  readonly onZoneAudit?: (() => void) | undefined;
}

export function LogActions({ onHeatMap, onZoneAudit }: LogActionsProps): ReactElement {
  return (
    <div className="fwm-log-actions">
      <button
        type="button"
        className="fwm-log-action"
        data-fwm-log-action="HEAT MAP"
        disabled={onHeatMap === undefined}
        onClick={onHeatMap}
      >
        HEAT MAP
      </button>
      <button
        type="button"
        className="fwm-log-action"
        data-fwm-log-action="ZONE AUDIT"
        disabled={onZoneAudit === undefined}
        onClick={onZoneAudit}
      >
        ZONE AUDIT
      </button>
    </div>
  );
}
