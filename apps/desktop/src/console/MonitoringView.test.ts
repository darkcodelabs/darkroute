import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MonitoringRecord, MonitoringResult } from '../data/api.ts';
import { monitoringRows, MonitoringView } from './MonitoringView.tsx';

const record: MonitoringRecord = { id: 'city:1', sourceId: 'city', kind: 'bluetooth_sensor', lat: 39, lon: -94, name: 'Sensor at Main', operator: 'Transport department', road: 'Main Street', direction: 'Northbound', status: 'unknown', sourceUrl: 'https://example.gov/sensors/1', sourceUpdatedAt: null, imageUrl: null };
const data: MonitoringResult = {
  schema: 'darkroute-road-monitoring/v1', generatedAt: '2026-09-10T00:00:00Z', count: 3, total: 3,
  sources: [{ id: 'city', name: 'City open inventory', url: 'https://example.gov/sensors', attribution: 'City data', licence: null, licenceUrl: null, coverage: 'City roads', checkedAt: '2026-09-10T00:00:00Z', fetchedAt: '2026-09-10T00:00:00Z', sourceUpdatedAt: null, status: 'stale', count: 3 }],
  records: [record, { ...record, id: 'city:2', kind: 'traffic_camera', name: 'Main junction camera', status: 'active' }, { ...record, id: 'city:3', road: null, operator: null, name: 'Hill sensor', status: 'inactive' }],
};

describe('Monitoring inventory', () => {
  it('keeps traffic equipment separate from ALPR and offers every equipment kind before loading', () => {
    const html = renderToStaticMarkup(createElement(MonitoringView));
    expect(html).toContain('counted separately from the ALPR camera archive');
    for (const label of ['All equipment', 'Bluetooth sensors', 'Probe sensors', 'Traffic cameras', 'Red light cameras', 'Speed cameras', 'Toll readers', 'Radar sensors', 'Search this inventory']) expect(html).toContain(label);
    expect(html).not.toContain('No loaded inventory records');
  });

  it('combines equipment kind and local search while preserving unknown and inactive equipment', () => {
    expect(monitoringRows(data, 'bluetooth_sensor', ' MAIN street ').map((row) => row.id)).toEqual(['city:1']);
    expect(monitoringRows(data, 'traffic_camera', 'CITY OPEN').map((row) => row.id)).toEqual(['city:2']);
    expect(monitoringRows(data, 'bluetooth_sensor', '').map((row) => row.status)).toEqual(['unknown', 'inactive']);
    expect(monitoringRows(data, null, '')).toHaveLength(3);
    expect(monitoringRows(data, 'radar_sensor', '')).toEqual([]);
    expect(monitoringRows(null, null, '')).toEqual([]);
    expect(data.sources[0]?.count).toBe(3);
  });
});
