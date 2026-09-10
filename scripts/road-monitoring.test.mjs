import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import { collectRoadMonitoring, fetchMonitoringSource } from './build-road-monitoring.mjs';
import { MONITORING_SOURCES } from './road-monitoring-sources.mjs';
import { MONITORING_MAX_BYTES, MONITORING_SCHEMA, validateMonitoringSnapshot } from './road-monitoring-schema.mjs';
import { readPublishedMonitoring, publishMonitoring, MONITORING_KEY } from './road-monitoring-publish.mjs';

const NOW = '2026-09-10T08:00:00.000Z';
const OLD = '2026-09-09T08:00:00.000Z';
const op = MONITORING_SOURCES.find((source) => source.id === 'overland-park-traffic');
const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-94.674, 38.855] },
  properties: { OBJECTID: 251, DisplayId: '151st & Conser', Attribute7: 'https://www2.opkansas.org/external-files/traffic-cameras/151st_Conser_W.jpeg',
    ignoredObservation: 'must not publish' } };
const row = op.normalize(feature);
const source = { id: op.id, name: op.name, url: op.url, attribution: op.attribution,
  licence: op.licence, licenceUrl: op.licenceUrl, coverage: op.coverage, checkedAt: OLD,
  fetchedAt: OLD, sourceUpdatedAt: null, status: 'ok', count: 1 };
const snapshot = { schema: MONITORING_SCHEMA, generatedAt: OLD, sources: [source], records: [row] };
const response = (data, init) => Response.json(data, init);
const inventory = (features) => ({ type: 'FeatureCollection', features });
const arcgis = (features = [feature]) => async (url) => {
  const u = new URL(url);
  if (!u.pathname.endsWith('/query')) return response({ objectIdField: 'OBJECTID' });
  if (u.searchParams.has('returnCountOnly')) return response({ count: features.length });
  const offset = Number(u.searchParams.get('resultOffset'));
  return response(inventory(features.slice(offset, offset + 1000)));
};

describe('road monitoring equipment sources', () => {
  it('imports coordinates and optional image links without imagery or observation fields', async () => {
    const requests = [];
    const read = async (url, options) => { requests.push({ url, options }); return arcgis()(url); };
    const result = await fetchMonitoringSource(op, read);
    assert.equal(result.records[0].id, 'overland-park-traffic:251');
    assert.equal(result.records[0].imageUrl, feature.properties.Attribute7);
    assert.equal(result.records[0].status, 'unknown');
    assert.equal('ignoredObservation' in result.records[0], false);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(({ url }) => !url.includes('/external-files/')));
    assert.ok(requests.every(({ options }) => options.redirect === 'error'));
  });

  it('retrieves every ArcGIS page and rejects silent truncation', async () => {
    const features = Array.from({ length: 1001 }, (_, id) => ({ ...feature, properties: { ...feature.properties, OBJECTID: id } }));
    assert.equal((await fetchMonitoringSource(op, arcgis(features))).records.length, 1001);
    await assert.rejects(fetchMonitoringSource(op, async (url) => {
      if (new URL(url).searchParams.has('returnCountOnly')) return response({ count: 1001 });
      if (new URL(url).pathname.endsWith('/query')) return response(inventory([feature]));
      return response({});
    }), /Incomplete/);
  });

  it('retains a failed source and its source dates while refreshing healthy sources', async () => {
    const second = { ...op, id: 'second', endpoint: 'https://second.example/layer' };
    const result = await collectRoadMonitoring({ previous: snapshot, sources: [op, second], now: NOW,
      read: async (url) => url.startsWith(op.endpoint) ? response({}, { status: 503 }) : arcgis()(url) });
    assert.equal(result.sources[0].status, 'stale');
    assert.equal(result.sources[0].fetchedAt, OLD);
    assert.equal(result.sources[0].checkedAt, NOW);
    assert.equal(result.sources[1].status, 'ok');
    assert.deepEqual(result.records[0], row);
    assert.equal(result.records.length, 2);
  });

  it('honors a GIS service page limit below 1,000 without losing locations', async () => {
    const features = Array.from({ length: 5 }, (_, id) => ({ ...feature, properties: { ...feature.properties, OBJECTID: id } }));
    const offsets = [];
    const result = await fetchMonitoringSource(op, async (url) => {
      const params = new URL(url).searchParams;
      if (params.has('returnCountOnly')) return response({ count: features.length });
      if (!new URL(url).pathname.endsWith('/query')) return response({ objectIdField: 'OBJECTID', maxRecordCount: 2 });
      assert.equal(params.get('resultRecordCount'), '2');
      const offset = Number(params.get('resultOffset'));
      offsets.push(offset);
      return response(inventory(features.slice(offset, offset + 2)));
    });
    assert.equal(result.records.length, 5);
    assert.deepEqual(offsets, [0, 2, 4]);
  });

  it('validates complete JSON inventories and keeps the last good data for malformed responses', async () => {
    const config = { ...op, format: 'json', rows: (data) => data.cameras };
    const good = await collectRoadMonitoring({ sources: [config], now: OLD,
      read: async () => response({ cameras: [feature] }, { headers: { 'last-modified': 'Wed, 09 Sep 2026 00:00:00 GMT' } }) });
    assert.equal(good.records.length, 1);
    assert.equal(good.sources[0].sourceUpdatedAt, '2026-09-09T00:00:00.000Z');
    for (const cameras of [undefined, {}, [], [feature, feature]]) {
      const result = await collectRoadMonitoring({ sources: [config], previous: good, now: NOW,
        read: async () => response({ cameras }) });
      assert.equal(result.sources[0].status, 'stale');
      assert.equal(result.sources[0].fetchedAt, OLD);
      assert.deepEqual(result.records, good.records);
    }
  });

  it('never publishes an initial failed/empty inventory as zero coverage', async () => {
    await assert.rejects(collectRoadMonitoring({ sources: [op], now: NOW, read: async () => response({}, { status: 503 }) }), /No valid monitoring data/);
    const result = await collectRoadMonitoring({ previous: snapshot, sources: [op], now: NOW, read: arcgis([]) });
    assert.equal(result.sources[0].status, 'stale');
    assert.equal(result.records.length, 1);
  });

  it('keeps a never-fetched source unavailable across repeated failures', async () => {
    const failed = { ...op, id: 'never-fetched', endpoint: 'https://failed.example/layer' };
    const read = async (url) => url.startsWith(failed.endpoint) ? response({}, { status: 503 }) : arcgis()(url);
    const first = await collectRoadMonitoring({ sources: [op, failed], now: OLD, read });
    const second = await collectRoadMonitoring({ previous: first, sources: [op, failed], now: NOW, read });
    assert.equal(second.sources[1].status, 'unavailable');
    assert.equal(second.sources[1].fetchedAt, null);
    assert.equal(second.sources[1].count, 0);
    assert.equal(second.sources[0].status, 'ok');
  });

  it('deduplicates proven publisher aliases and retains unmatched cameras when preferred coverage is missing', async () => {
    const fallback = { ...op, id: 'fallback', endpoint: 'https://fallback.example/layer',
      duplicateOf: op.id, duplicateKey: (record) => record.name };
    const unmatched = { ...feature, properties: { ...feature.properties, OBJECTID: 252, DisplayId: 'Harris Road' } };
    const read = async (url) => url.startsWith(fallback.endpoint) ? arcgis([feature, unmatched])(url) : arcgis()(url);
    const both = await collectRoadMonitoring({ sources: [op, fallback], now: OLD, read });
    assert.equal(both.records.length, 2);
    assert.equal(both.sources[1].count, 1);
    assert.equal(both.records[1].name, 'Harris Road');
    const absent = await collectRoadMonitoring({ sources: [op, fallback], now: NOW,
      read: async (url) => url.startsWith(op.endpoint) ? response({}, { status: 503 }) : read(url) });
    assert.equal(absent.sources[0].status, 'unavailable');
    assert.equal(absent.sources[1].count, 2);
    assert.equal(absent.records.length, 2);
    const stale = await collectRoadMonitoring({ previous: both, sources: [op, fallback], now: NOW,
      read: async (url) => url.startsWith(op.endpoint) ? response({}, { status: 503 }) : read(url) });
    assert.equal(stale.sources[0].status, 'stale');
    assert.equal(stale.sources[1].count, 1);
    assert.equal(stale.records.length, 2);
  });

  it('loads maintenance-only Socrata inventories and drops explicitly retired equipment', async () => {
    const chicago = MONITORING_SOURCES.find((config) => config.id === 'chicago-speed');
    const camera = { id: 'one', latitude: 41.8, longitude: -87.6, address: 'Example street' };
    const socrata = (description) => async (url) => {
      if (url === chicago.metadata) return response({ description });
      if (new URL(url).searchParams.has('$select')) return response([{ count: '1' }]);
      return response([camera]);
    };
    const previous = await collectRoadMonitoring({ sources: [chicago], now: OLD,
      read: socrata('This dataset is no longer actively maintained.') });
    assert.equal(previous.sources[0].status, 'ok');
    assert.equal(previous.records.length, 1);
    const result = await collectRoadMonitoring({ previous, sources: [chicago], now: NOW,
      read: socrata('These cameras have all been removed from operation.') });
    assert.equal(result.sources[0].status, 'retired');
    assert.equal(result.sources[0].count, 0);
    assert.equal(result.sources[0].fetchedAt, NOW);
    assert.deepEqual(result.records, []);
    const failedRefresh = await collectRoadMonitoring({ previous: result, sources: [chicago], now: NOW,
      read: async () => response({}, { status: 503 }) });
    assert.equal(failedRefresh.sources[0].status, 'retired');
    assert.deepEqual(failedRefresh.records, []);
    for (const description of ['Some cameras were retired.', 'Cameras were not retired.', 'Cameras will be retired.']) {
      assert.equal((await fetchMonitoringSource(chicago, socrata(description))).records.length, 1);
    }
    for (const description of [
      'Bluetooth sensors are no longer actively maintained and have been removed from operation.',
      'The Bluetooth sensors have since been removed from operation.',
    ]) {
      const retired = await collectRoadMonitoring({ previous, sources: [chicago], now: NOW, read: socrata(description) });
      assert.equal(retired.sources[0].status, 'retired');
      assert.deepEqual(retired.records, []);
    }
  });

  it('clears old Florida assets when the complete inventory explicitly removes every row', async () => {
    const florida = MONITORING_SOURCES.find((config) => config.id === 'florida-probe');
    const probe = { ...feature, geometry: { type: 'Point', coordinates: [-82, 29] },
      properties: { GlobalID: 'asset', FlagForRemoval: 'No', Status: null } };
    const previous = await collectRoadMonitoring({ sources: [florida], now: OLD, read: arcgis([probe]) });
    assert.equal(previous.records.length, 1);
    const removed = { ...probe, properties: { ...probe.properties, FlagForRemoval: 'Yes' } };
    const result = await collectRoadMonitoring({ previous, sources: [florida], now: NOW, read: arcgis([removed]) });
    assert.equal(result.sources[0].status, 'ok');
    assert.equal(result.sources[0].count, 0);
    assert.equal(result.sources[0].fetchedAt, NOW);
    assert.deepEqual(result.records, []);
  });

  it('keeps Bluetooth, unspecified probes and cameras separate, excluding removed inventory', () => {
    assert.ok(!MONITORING_SOURCES.some((config) => /austin/iu.test(config.id) && config.kind !== 'traffic_camera'));
    const york = MONITORING_SOURCES.find((config) => config.id === 'york-bluetooth');
    const yorkRow = york.normalize({ ...feature, geometry: { type: 'Point', coordinates: [-79.4, 44] }, properties: { OBJECTID: 2, READERID: 'Road reader' } });
    assert.equal(yorkRow.kind, 'bluetooth_sensor');
    assert.equal(yorkRow.status, 'active');
    assert.equal(yorkRow.imageUrl, null);
    const delaware = MONITORING_SOURCES.find((config) => config.id === 'delaware-bluetooth');
    const detector = { ...feature, geometry: { type: 'Point', coordinates: [-76.18227, 38.969067] },
      properties: { PERMITNUM: 'SBT0047', DEVICE_TYPE: 'BLUETOOTH DETECTOR', STATUS: 'EXISTING', SYSTEM_STATUS: 'OFFLINE' } };
    assert.equal(delaware.normalize(detector).kind, 'bluetooth_sensor');
    assert.equal(delaware.normalize(detector).status, 'inactive');
    assert.equal(delaware.normalize({ ...detector, properties: { ...detector.properties, STATUS: 'REMOVED' } }), null);
    assert.throws(() => delaware.normalize({ ...detector, properties: { ...detector.properties, DEVICE_TYPE: 'UNKNOWN' } }), /device type/);
    const florida = MONITORING_SOURCES.find((config) => config.id === 'florida-probe');
    const probe = { ...feature, geometry: { type: 'Point', coordinates: [-82, 29] }, properties: { GlobalID: 'asset', FlagForRemoval: 'No', Status: null } };
    assert.equal(florida.normalize(probe).kind, 'probe_sensor');
    assert.equal(florida.normalize(probe).status, 'unknown');
    assert.equal(florida.normalize({ ...probe, properties: { ...probe.properties, FlagForRemoval: 'Yes' } }), null);
    assert.throws(() => op.normalize({ ...feature, geometry: { type: 'Point', coordinates: [0, 0] } }), /outside/);
  });

  it('rejects broken inventory relationships, dates and excessive payloads', () => {
    for (const bad of [
      { ...snapshot, records: [row, row] }, { ...snapshot, records: [{ ...row, sourceId: 'absent' }] },
      { ...snapshot, records: [{ ...row, imageUrl: 'file:///etc/passwd' }] },
      { ...snapshot, sources: [{ ...source, fetchedAt: NOW }] },
      { ...snapshot, records: [{ ...row, lat: Infinity }] },
      { ...snapshot, extra: 'x'.repeat(MONITORING_MAX_BYTES) },
    ]) assert.throws(() => validateMonitoringSnapshot(bad));
  });

  it('rejects impossible calendar dates and URLs that the core parser rejects', () => {
    for (const date of ['2026-02-30T08:00:00.000Z', '2026-02-29T08:00:00Z', '1900-02-29T08:00:00Z']) {
      for (const bad of [
        { ...snapshot, generatedAt: date },
        ...['checkedAt', 'fetchedAt', 'sourceUpdatedAt'].map((field) => ({ ...snapshot, sources: [{ ...source, [field]: date }] })),
        { ...snapshot, records: [{ ...row, sourceUpdatedAt: date }] },
      ]) assert.throws(() => validateMonitoringSnapshot(bad));
    }
    assert.equal(validateMonitoringSnapshot({ ...snapshot, records: [{ ...row, sourceUpdatedAt: '2000-02-29T08:00:00Z' }] }).records.length, 1);
    for (const url of ['https:\\example.org/path', 'https://example.org\\path', 'https://example.org/a b',
      'https://example.org/\nimage', 'https://-bad.example/path', 'https://127.1/path', 'https://[:::]/path']) {
      for (const bad of [
        ...['url', 'licenceUrl'].map((field) => ({ ...snapshot, sources: [{ ...source, [field]: url }] })),
        ...['sourceUrl', 'imageUrl'].map((field) => ({ ...snapshot, records: [{ ...row, [field]: url }] })),
      ]) assert.throws(() => validateMonitoringSnapshot(bad));
    }
  });

  it('normalizes unknown fields out of snapshots and retained failed-source records', async () => {
    const extra = { humanObservations: [{ deviceId: 'must not publish' }] };
    const dirty = { ...snapshot, ...extra, sources: [{ ...source, ...extra }], records: [{ ...row, ...extra }] };
    assert.deepEqual(validateMonitoringSnapshot(dirty), snapshot);
    assert.ok('humanObservations' in dirty.records[0]);
    const retained = await collectRoadMonitoring({ previous: dirty, sources: [op], now: NOW,
      read: async () => response({}, { status: 503 }) });
    assert.deepEqual(retained.records, [row]);
    assert.equal('humanObservations' in retained.sources[0], false);
    const config = { ...op, normalize(feature) { return { ...op.normalize(feature), ...extra }; } };
    const fresh = await collectRoadMonitoring({ sources: [config], now: NOW, read: arcgis() });
    assert.deepEqual(fresh.records, [row]);
  });
});

describe('monitoring publication', () => {
  it('writes only the monitoring key, with first-write preconditions and integrity', async () => {
    const calls = [];
    const client = { send: async (command) => { calls.push(command.input); return { ETag: `"${createHash('md5').update(command.input.Body).digest('hex')}"` }; } };
    await publishMonitoring({ ...snapshot, observations: ['excluded'], records: [{ ...row, imageBytes: 'excluded' }] }, { client, expectedEtag: null });
    assert.deepEqual(JSON.parse(calls[0].Body.toString('utf8')), snapshot);
    assert.equal(calls[0].Key, MONITORING_KEY);
    assert.equal(calls[0].IfNoneMatch, '*');
    assert.ok(calls[0].ContentMD5);
    assert.equal(calls[0].ContentType, 'application/json; charset=utf-8');
  });

  it('requires an ETag, refuses time rollback and never retries a concurrent writer', async () => {
    let calls = 0;
    const etag = `"${'a'.repeat(32)}"`;
    const client = { send: async (command) => { calls += 1; assert.equal(command.input.IfMatch, etag); throw new Error('412'); } };
    await assert.rejects(publishMonitoring(snapshot, { client }), /ETag/);
    await assert.rejects(publishMonitoring(snapshot, { client, expectedEtag: etag, previousGeneratedAt: NOW }), /older/);
    assert.equal(calls, 0);
    await assert.rejects(publishMonitoring(snapshot, { client, expectedEtag: etag }), /412/);
    assert.equal(calls, 1);
  });

  it('distinguishes absent storage from failed authorization and verifies stored bytes', async () => {
    const absent = Object.assign(new Error('absent'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    assert.equal(await readPublishedMonitoring({ client: { send: async () => { throw absent; } } }), null);
    await assert.rejects(readPublishedMonitoring({ client: { send: async () => { throw new Error('AccessDenied'); } } }), /AccessDenied/);
    const bytes = Buffer.from(JSON.stringify(snapshot));
    const etag = `"${createHash('md5').update(bytes).digest('hex')}"`;
    const client = { send: async () => ({ Body: [bytes], ContentLength: bytes.length, ETag: etag }) };
    assert.deepEqual((await readPublishedMonitoring({ client })).snapshot, snapshot);
    await assert.rejects(readPublishedMonitoring({ client: { send: async () => ({ Body: [bytes], ETag: `"${'0'.repeat(32)}"` }) } }), /integrity/);
  });
});
