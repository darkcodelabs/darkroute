/**
 * RADAR's public surface.
 *
 * The shell registers `RadarScreen` against the `radar` screen id; everything
 * else here is exported for tests and for the sibling screens that need the
 * same state vocabulary (SWEEP draws the same six hues).
 */

export { RadarScreen } from './RadarScreen.tsx';
export type { RadarScreenProps } from './RadarScreen.tsx';


export { RadarView } from './components/RadarView.tsx';
export type { RadarViewHandlers, RadarViewModel, RadarViewProps } from './components/RadarView.tsx';

export { CountyRecordStrip, OfflineStrip } from './components/RadarStrip.tsx';
export type {
  CountyRecord,
  CountyRecordStripProps,
  OfflineStripProps,
} from './components/RadarStrip.tsx';

export {
  hasLiveDistance,
  radarHue,
  radarRing,
  resolveRadarGate,
  resolveRadarState,
} from './radarState.ts';
export type { RadarGate, RadarHue, RadarInput, RadarRing, RadarState } from './radarState.ts';

export { SCAN_RATE_SAMPLES, formatScanRate, scanRateHz, trackFixTime } from './scanRate.ts';

export {
  NO_VALUE,
  coarseDirection,
  directionLine,
  distanceUnit,
  fineDirection,
  formatCoordinates,
  formatCount,
  formatDistanceValue,
  formatFixAge,
  formatHeadingCardinal,
  formatHeadingDegrees,
  formatMuteCountdown,
  formatSatellites,
  formatSpeedMph,
} from './format.ts';
export type { DirectionLineInput, DistanceUnit, FineDirectionInput } from './format.ts';
