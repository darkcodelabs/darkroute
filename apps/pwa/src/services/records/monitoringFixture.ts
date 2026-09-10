import type { MonitoringRecord, MonitoringSnapshot, MonitoringSource } from '../../stores/fwmCore.ts';
export const monitoringSourceFixture: MonitoringSource = {
  id: 'inventory', name: 'Public road inventory', url: 'https://publisher.test/inventory',
  attribution: 'City open data', licence: 'Open licence', licenceUrl: 'https://publisher.test/licence',
  coverage: 'Example County', checkedAt: '2026-09-10T02:00:00Z', fetchedAt: '2026-09-10T01:00:00Z',
  sourceUpdatedAt: '2026-08-01T00:00:00Z', status: 'ok', count: 3,
};
export const monitoringRecordFixture: MonitoringRecord = {
  id: 'sensor-one', sourceId: 'inventory', kind: 'bluetooth_sensor', lat: 39, lon: -94,
  name: 'Main Street sensor', operator: 'City transport', road: 'Main Street', direction: null,
  status: 'active', sourceUrl: 'https://publisher.test/sensor-one', imageUrl: null, sourceUpdatedAt: null,
};
export const monitoringSnapshotFixture: MonitoringSnapshot = {
  schema: 'darkroute-road-monitoring/v1', generatedAt: '2026-09-10T02:00:00Z', sources: [monitoringSourceFixture],
  records: [monitoringRecordFixture,
    { ...monitoringRecordFixture, id: 'probe-two', kind: 'probe_sensor', status: 'unknown' },
    { ...monitoringRecordFixture, id: 'retired-three', status: 'inactive' }],
};
