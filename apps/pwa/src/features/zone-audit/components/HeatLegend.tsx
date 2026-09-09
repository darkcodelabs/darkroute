/**
 * `■ LOW  ■ MEDIUM  ■ HEAVY` and the trip overlay key.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B6 · ZONE AUDIT` -- one 10px mono row,
 * three coloured squares, and `TRIP OVERLAY ON` pushed to the right edge.
 *
 * The overlay key carries B6's string and toggles it. It cannot draw a route:
 * no trip path exists on this device, on purpose.
 * GAP: see docs/gaps-inbox/zone-audit.md#trip-overlay-cannot-draw-a-route
 */

import type { ReactElement } from 'react';

import { HEAT_RANKS, HEAT_RANK_LABELS, tripOverlayLabel } from '../zone.ts';

/** The square B6 draws in each hue. Decorative: the word beside it is the label. */
const SWATCH = '■';

export interface HeatLegendProps {
  readonly tripOverlay: boolean;
  /** Absent means "not wired in this build" -- the key renders disabled. */
  readonly onTripOverlay?: (() => void) | undefined;
}

export function HeatLegend({ tripOverlay, onTripOverlay }: HeatLegendProps): ReactElement {
  return (
    <div className="fwm-zone-legend">
      {HEAT_RANKS.map((rank) => (
        <div key={rank} className="fwm-zone-legend-item" data-fwm-zone-legend={rank}>
          <span
            className="fwm-zone-legend-swatch"
            data-fwm-zone-heat-rank={rank}
            aria-hidden="true"
          >
            {SWATCH}
          </span>
          {HEAT_RANK_LABELS[rank]}
        </div>
      ))}
      <button
        type="button"
        className="fwm-zone-trip"
        aria-pressed={tripOverlay}
        disabled={onTripOverlay === undefined}
        onClick={onTripOverlay}
      >
        {tripOverlayLabel(tripOverlay)}
      </button>
    </div>
  );
}
