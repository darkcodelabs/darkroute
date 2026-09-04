/**
 * ZONE AUDIT's public surface.
 *
 * `src/app/App.tsx` takes a screen registry. This feature has TWO entries in
 * it, because `app/screenState.ts` reserves two ids for the one panel:
 *   zone-audit  {@link ZoneAuditScreen}  B6 in full
 *   heat-map    {@link HeatMapScreen}    B6's heat layer, full screen
 * Both are usable with no props. The rest is exported for tests and for the
 * screens that share this vocabulary -- `05 · LOG - EXPOSURE` draws the two
 * keys that navigate here.
 *
 * Nothing here reads a store, prompts for a permission or touches a browser API
 * on import.
 */

export { ZoneAuditScreen } from './ZoneAuditScreen.tsx';
export type { ZoneAuditScreenProps } from './ZoneAuditScreen.tsx';

export { HeatMapScreen } from './HeatMapScreen.tsx';

export { useZone } from './useZone.ts';
export type { ZoneModel } from './useZone.ts';

export { ZONE_AUDIT_TITLE, ZONE_NOTICES, ZoneAuditView } from './components/ZoneAuditView.tsx';
export type {
  ZoneAuditViewHandlers,
  ZoneAuditViewModel,
  ZoneAuditViewProps,
  ZoneNotice,
} from './components/ZoneAuditView.tsx';

export { HEAT_MAP_TITLE, HeatMapView } from './components/HeatMapView.tsx';
export type {
  HeatMapViewHandlers,
  HeatMapViewModel,
  HeatMapViewProps,
} from './components/HeatMapView.tsx';

export { HeatLayer } from './components/HeatLayer.tsx';
export type { HeatLayerProps } from './components/HeatLayer.tsx';
export { HeatLegend } from './components/HeatLegend.tsx';
export type { HeatLegendProps } from './components/HeatLegend.tsx';
export { ShareCard } from './components/ShareCard.tsx';
export type { ShareCardProps } from './components/ShareCard.tsx';
export { EXPORT_LABEL, SHARE_LABEL, ZoneAuditActions } from './components/ZoneAuditActions.tsx';
export type { ZoneAuditActionsProps } from './components/ZoneAuditActions.tsx';
export { ZoneAuditHeader } from './components/ZoneAuditHeader.tsx';
export type { ZoneAuditHeaderProps } from './components/ZoneAuditHeader.tsx';

export {
  DEFAULT_ZONE_RADIUS_MI,
  FEET_PER_MILE,
  HEAT_CAPTION,
  HEAT_CAPTION_RECORDED,
  HEAT_GRID_COLS,
  HEAT_GRID_ROWS,
  HEAT_RANKS,
  HEAT_RANK_LABELS,
  HEAT_SCOPES,
  HEAVY_READS,
  HEAVY_READS_PER_MI,
  MEDIUM_READS,
  MEDIUM_READS_PER_MI,
  SHARE_CARD_EYEBROW,
  ZONE_RADII_MI,
  ZONE_STAT_ROWS,
  camerasInZone,
  cardProvenance,
  cardSentence,
  cellFor,
  formatRadiusReadout,
  heatCaption,
  heatCells,
  heatRank,
  heatScope,
  heatUnavailableReason,
  inReadWindow,
  isZoneRadiusMi,
  nextZoneRadius,
  readCounts,
  tripOverlayLabel,
  zoneStatValue,
  zoneStats,
  zoneTilesCached,
} from './zone.ts';
export type {
  HeatAvailability,
  HeatBand,
  HeatCell,
  HeatInput,
  HeatRank,
  HeatScope,
  ReadWindow,
  ZoneCamera,
  ZoneCentre,
  ZoneRadiusMi,
  ZoneStatRow,
  ZoneStats,
} from './zone.ts';

export {
  BRAND_PREFIX,
  BRAND_SUFFIX,
  SHARE_CARD_TITLE,
  buildZoneSharePayload,
  shareCardText,
} from './shareCard.ts';
export type { ShareCardInput } from './shareCard.ts';

export {
  ZONE_CSV_COLUMNS,
  ZONE_CSV_SCHEMA,
  buildZoneCsv,
  csvField,
  facingField,
  sortForExport,
  zoneCsvFilename,
  zoneCsvRow,
} from './zoneCsv.ts';
export type { ZoneCsvBundle } from './zoneCsv.ts';
