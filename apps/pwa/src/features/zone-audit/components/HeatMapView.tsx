/**
 * HEAT MAP -- `B6`'s heat layer with the screen to itself.
 *
 * No design file draws a HEAT MAP screen; `05 · LOG - EXPOSURE` draws the key
 * that navigates to it and `app/screenState.ts` reserves the id.
 * (`DESIGN-GAPS.md#no-heat-map-screen-exists`.) So this view is B6's layer at
 * full height with B6's header shape, B6's radius readout and B6's legend --
 * and nothing else. Every string on it is a string B6 draws, except the title,
 * which is the exact label of the key that opens it.
 * GAP: see docs/gaps-inbox/zone-audit.md#heat-map-is-b6s-layer-with-no-panel-of-its-own
 *
 * There is no share card and no export here on purpose: B6 puts both on ZONE
 * AUDIT, and a second copy would be a second place for the same bytes to leave.
 */

import type { ReactElement } from 'react';

import type { HeatCell, ZoneRadiusMi } from '../zone.ts';

import { HeatLayer } from './HeatLayer.tsx';
import { HeatLegend } from './HeatLegend.tsx';
import { ZoneAuditHeader } from './ZoneAuditHeader.tsx';

/** The label of the key that opens this screen, verbatim. */
export const HEAT_MAP_TITLE = 'HEAT MAP';

export interface HeatMapViewModel {
  readonly radiusMi: ZoneRadiusMi;
  readonly cells: readonly HeatCell[];
  /** The heat layer's caption, which names the scope its numbers were taken in. */
  readonly heatCaption: string;
  readonly heatUnavailable: string | null;
  readonly tripOverlay: boolean;
}

export interface HeatMapViewHandlers {
  readonly onRadius?: (() => void) | undefined;
  readonly onTripOverlay?: (() => void) | undefined;
}

export type HeatMapViewProps = HeatMapViewHandlers & {
  readonly model: HeatMapViewModel;
};

export function HeatMapView({ model, onRadius, onTripOverlay }: HeatMapViewProps): ReactElement {
  return (
    <section
      className="fwm-zone"
      data-fwm-zone-screen="heat-map"
      data-fwm-zone-radius={String(model.radiusMi)}
    >
      <ZoneAuditHeader title={HEAT_MAP_TITLE} radiusMi={model.radiusMi} onRadius={onRadius} />
      <div className="fwm-zone-body">
        <HeatLayer
          cells={model.cells}
          tripOverlay={model.tripOverlay}
          unavailable={model.heatUnavailable}
          caption={model.heatCaption}
        />
        <HeatLegend tripOverlay={model.tripOverlay} onTripOverlay={onTripOverlay} />
      </div>
    </section>
  );
}
