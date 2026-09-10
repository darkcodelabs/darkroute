import type { FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap, LayerSpecification } from 'maplibre-gl';
import type { MonitoringRecord } from '../../stores/fwmCore.ts';
import { MONITORING_SYMBOLS } from '../../services/records/monitoringCatalog.ts';
import type { Palette } from './palette.ts';

export const MONITORING_SOURCE = 'fwm-road-monitoring';
export const MONITORING_POINTS = 'fwm-road-monitoring-points';
export const MONITORING_LABELS_LAYER = 'fwm-road-monitoring-labels';
export const MONITORING_HIT = 'fwm-road-monitoring-hit';
export const NO_MONITORING: readonly MonitoringRecord[] = Object.freeze([]);

export function monitoringGeoJSON(records: readonly MonitoringRecord[]): FeatureCollection<Point> {
  return { type: 'FeatureCollection', features: records.map((record) => ({
    type: 'Feature', id: record.id,
    geometry: { type: 'Point', coordinates: [record.lon, record.lat] },
    properties: { monitoringId: record.id, kind: record.kind, status: record.status, symbol: MONITORING_SYMBOLS[record.kind] },
  })) };
}
export function monitoringLayers(palette: Palette): readonly LayerSpecification[] {
  return [
    { id: MONITORING_POINTS, type: 'circle', source: MONITORING_SOURCE, paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 10, 9, 14, 12],
      'circle-color': ['case', ['==', ['get', 'status'], 'inactive'], palette['--fwm-text-2'], palette['--fwm-bg']],
      'circle-opacity': ['case', ['==', ['get', 'status'], 'inactive'], 0.35, 1],
      'circle-stroke-width': 2,
      'circle-stroke-color': ['case', ['==', ['get', 'status'], 'inactive'], palette['--fwm-text-2'], palette['--fwm-accent-scan']],
    } },
    { id: MONITORING_LABELS_LAYER, type: 'symbol', source: MONITORING_SOURCE, minzoom: 10, layout: {
      'text-field': ['get', 'symbol'], 'text-font': ['Noto Sans Medium'], 'text-size': 10,
      'text-allow-overlap': true, 'text-ignore-placement': true,
    }, paint: { 'text-color': palette['--fwm-text'] } },
    { id: MONITORING_HIT, type: 'circle', source: MONITORING_SOURCE,
      paint: { 'circle-radius': 18, 'circle-opacity': 0 } },
  ];
}
/** This source never enters the camera overview, camera store, or alert engine. */
export function syncMonitoringLayers(map: MapLibreMap, records: readonly MonitoringRecord[], palette: Palette): void {
  const source = map.getSource<GeoJSONSource>(MONITORING_SOURCE);
  if (source === undefined) {
    if (records.length === 0) return;
    map.addSource(MONITORING_SOURCE, { type: 'geojson', data: monitoringGeoJSON(records) });
  } else { source.setData(monitoringGeoJSON(records)); }
  for (const layer of monitoringLayers(palette)) {
    if (map.getLayer(layer.id) !== undefined) map.removeLayer(layer.id);
    map.addLayer(layer);
  }
}
export function monitoringInView(map: Pick<MapLibreMap, 'getBounds'>, records: readonly MonitoringRecord[]): number {
  const bounds = map.getBounds();
  return records.filter((record) => bounds.contains([record.lon, record.lat])).length;
}
