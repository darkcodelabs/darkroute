/**
 * HEAT MAP -- `B6`'s heat layer with the screen to itself.
 *
 * `05 · LOG - EXPOSURE` draws the key that opens this screen and
 * `app/screenState.ts` reserves the id, but no design file draws the screen.
 * (`DESIGN-GAPS.md#no-heat-map-screen-exists`.) It is therefore exactly B6's
 * layer, B6's radius readout and B6's legend at full height -- no share card,
 * no export, and no control B6 does not draw.
 * GAP: see docs/gaps-inbox/zone-audit.md#heat-map-is-b6s-layer-with-no-panel-of-its-own
 *
 * Same wiring rules as `ZoneAuditScreen`: no browser API on mount or ever, no
 * geospatial arithmetic, no invented camera and no invented read. Muted cameras
 * count and draw; no mute selector is imported anywhere in this feature.
 */

import type { ReactElement } from 'react';

import { HeatMapView } from './components/HeatMapView.tsx';
import type { HeatMapViewModel } from './components/HeatMapView.tsx';
import { useZone } from './useZone.ts';

import './zone-audit.css';

export function HeatMapScreen(): ReactElement {
  const zone = useZone();

  const model: HeatMapViewModel = {
    radiusMi: zone.radiusMi,
    cells: zone.cells,
    heatCaption: zone.heatCaption,
    heatUnavailable: zone.heatUnavailable,
    tripOverlay: zone.tripOverlay,
  };

  return (
    <HeatMapView model={model} onRadius={zone.cycleRadius} onTripOverlay={zone.toggleTripOverlay} />
  );
}
