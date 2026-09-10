import { describe, expect, it } from 'vitest';
import { MONITORING_MAX_BYTES, MONITORING_MAX_RECORDS, parseMonitoringSnapshot } from './roadMonitoring.ts';

const date = '2026-09-10T00:00:00Z';
const fixture = () => ({
  schema: 'darkroute-road-monitoring/v1', generatedAt: date,
  sources: [{ id: 'county', name: 'County inventory', url: 'https://example.org/inventory',
    attribution: 'County transportation department', licence: null, licenceUrl: null,
    coverage: 'County roads', checkedAt: date, fetchedAt: date, sourceUpdatedAt: null,
    status: 'ok', count: 1 }],
  records: [{ id: 'county:1', sourceId: 'county', kind: 'bluetooth_sensor', lat: 38.9, lon: -94.6,
    name: 'Travel time sensor', operator: null, road: 'Main St', direction: null,
    status: 'unknown', sourceUrl: 'https://example.org/inventory/1', imageUrl: null, sourceUpdatedAt: null }],
});

describe('road monitoring inventory boundary', () => {
  it('preserves provenance and unknown device status without converting sensors to ALPR', () => {
    expect(parseMonitoringSnapshot(fixture())).toEqual(fixture());
  });

  it('preserves last-good inventory from a stale source and the actual collection dates', () => {
    const input = fixture();
    input.sources[0]!.status = 'stale';
    input.sources[0]!.fetchedAt = '2026-09-01T00:00:00Z';
    expect(parseMonitoringSnapshot(input)?.sources[0]).toMatchObject({ status: 'stale', fetchedAt: '2026-09-01T00:00:00Z', checkedAt: date, count: 1 });
    expect(parseMonitoringSnapshot(input)?.records).toHaveLength(1);
  });

  it('strips undeclared payloads instead of forwarding images or observations', () => {
    const input = fixture();
    const withExtra = { ...input, observations: ['plate'], records: input.records.map((item) => ({ ...item, image: 'image bytes', observations: ['MAC address'] })) };
    expect(parseMonitoringSnapshot(withExtra)).toEqual(input);
  });

  it('rejects duplicate identities, missing source references and inconsistent source counts', () => {
    for (const mutate of [
      (input: ReturnType<typeof fixture>) => { input.records.push({ ...input.records[0]! }); input.sources[0]!.count = 2; },
      (input: ReturnType<typeof fixture>) => { input.sources.push({ ...input.sources[0]! }); },
      (input: ReturnType<typeof fixture>) => { input.records[0]!.sourceId = 'missing'; },
      (input: ReturnType<typeof fixture>) => { input.sources[0]!.count = 2; },
    ]) {
      const input = fixture(); mutate(input);
      expect(parseMonitoringSnapshot(input)).toBeNull();
    }
  });

  it('rejects unsupported kinds, invalid coordinates, dates and unbounded names', () => {
    for (const field of [{ kind: 'alpr' }, { lat: NaN }, { lat: 91 }, { lon: -181 }, { sourceUpdatedAt: 'today' }, { name: 'x'.repeat(1001) }]) {
      const input = fixture();
      expect(parseMonitoringSnapshot({ ...input, records: [{ ...input.records[0], ...field }] })).toBeNull();
    }
    expect(parseMonitoringSnapshot({ ...fixture(), generatedAt: '2026-13-40' })).toBeNull();
    expect(parseMonitoringSnapshot({ ...fixture(), generatedAt: '2026-02-30T00:00:00Z' })).toBeNull();
  });

  it('accepts HTTP(S) sources and rejects credentials, unsafe protocols and invalid authorities', () => {
    const credentialUrl = new URL('https://example.org/');
    credentialUrl.username = 'fixture-user';
    credentialUrl.password = 'fixture-password';
    for (const sourceUrl of ['javascript:alert(1)', credentialUrl.href, 'https://user%40name@example.org/', 'https://example.org\\@evil.org/', 'https://999.999.1.2/', 'https://[:::]/']) {
      const input = fixture(); input.records[0]!.sourceUrl = sourceUrl;
      expect(parseMonitoringSnapshot(input)).toBeNull();
    }
    for (const sourceUrl of ['http://example.org/1', 'https://[2001:db8::1]/record']) {
      const input = fixture(); input.records[0]!.sourceUrl = sourceUrl;
      expect(parseMonitoringSnapshot(input)).not.toBeNull();
    }
  });

  it('enforces both record and UTF-8 byte bounds, including unexpected fields', () => {
    const input = fixture();
    expect(parseMonitoringSnapshot({ ...input, records: Array(MONITORING_MAX_RECORDS + 1).fill(input.records[0]) })).toBeNull();
    expect(parseMonitoringSnapshot({ ...input, extra: 'é'.repeat(MONITORING_MAX_BYTES / 2) })).toBeNull();
    const circular: Record<string, unknown> = { ...input }; circular['cycle'] = circular;
    expect(parseMonitoringSnapshot(circular)).toBeNull();
  });
});
