import { describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { monitoringGeoJSON, MONITORING_SOURCE, MONITORING_HIT, syncMonitoringLayers } from './monitoringLayers.ts';
import { monitoringSnapshotFixture as snapshot } from '../../services/records/monitoringFixture.ts';
import { readPalette } from './palette.ts';

function mapFixture() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, unknown>();
  const map = {
    getSource: (id: string) => sources.get(id), getLayer: (id: string) => layers.get(id),
    addSource: vi.fn((id: string) => { sources.set(id, { setData: vi.fn() }); }),
    addLayer: vi.fn((layer: { id: string }) => { layers.set(layer.id, layer); }),
    removeLayer: vi.fn((id: string) => { layers.delete(id); }),
  };
  return { map, sources, layers, instance: map as unknown as MapLibreMap };
}
describe('independent road monitoring map source', () => {
  it('omits publisher URLs and distinguishes selectable inventory ids from ALPR ids', () => {
    const data = monitoringGeoJSON(snapshot.records);
    expect(data.features[0]).toMatchObject({ geometry: { coordinates: [-94, 39] }, properties: { monitoringId: 'sensor-one', symbol: 'BT', status: 'active' } });
    expect(data.features[1]?.properties?.['symbol']).toBe('TT');
    expect(data.features[0]?.properties).not.toHaveProperty('id');
    expect(JSON.stringify(data)).not.toContain('publisher.test');
  });
  it('loads lazily, clears disabled points, and restores layers after a style replacement', () => {
    const { map, instance, sources, layers } = mapFixture();
    syncMonitoringLayers(instance, [], readPalette());
    expect(map.addSource).not.toHaveBeenCalled();
    syncMonitoringLayers(instance, snapshot.records, readPalette());
    expect([...sources.keys()]).toEqual([MONITORING_SOURCE]);
    expect(layers.has(MONITORING_HIT)).toBe(true);
    syncMonitoringLayers(instance, [], readPalette());
    expect(sources.get(MONITORING_SOURCE)?.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
    sources.clear(); layers.clear();
    syncMonitoringLayers(instance, snapshot.records, readPalette());
    expect([...sources.keys()]).toEqual([MONITORING_SOURCE]);
    expect(layers.size).toBe(3);
    expect(map.addSource).toHaveBeenCalledTimes(2);
  });
});
