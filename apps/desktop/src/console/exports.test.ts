import { describe, expect, it } from 'vitest';
import type { MonitoringResult } from '../data/api.ts';
import { monitoringCsv, recordsCsv } from './exports.ts';

describe('complete data exports', () => {
  it('exports beyond the display page and keeps separate source findings and all fields', () => {
    const records = Array.from({ length: 150 }, (_, index) => ({ agency: 'Same agency', year: 2026, sourceUrl: `https://example.gov/${index}`, summary: `Finding ${index}` }));
    const csv = recordsCsv(records);
    expect(csv.split('\r\n')).toHaveLength(152);
    expect(csv).toContain('https://example.gov/149');
    expect(csv).toContain('Finding 149');
    expect(csv).toContain('"summary"');
  });

  it('escapes CSV text and formula prefixes while retaining numbers and nested fields', () => {
    const csv = recordsCsv([{ name: '=SUM(1,2)', summary: 'Line one\n"quoted"', lon: -94.5, vendors: ['a', 'b'], absent: null }]);
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain('"Line one\n""quoted"""');
    expect(csv).toContain('"-94.5"');
    expect(csv).toContain('"[""a"",""b""]"');
    expect(recordsCsv([{ name: ' \t=1+2' }])).toContain('"\' \t=1+2"');
  });

  it('carries source attribution, licence and freshness with monitoring CSV records', () => {
    const data: MonitoringResult = {
      schema: 'darkroute-road-monitoring/v1', generatedAt: '2026-09-10T00:00:00Z', count: 1, total: 1,
      sources: [{ id: 'city', name: 'City', url: 'https://example.gov', attribution: 'City transport', licence: 'CC0-1.0', licenceUrl: 'https://example.gov/terms', coverage: 'City', checkedAt: '2026-09-10T00:00:00Z', fetchedAt: '2026-09-09T00:00:00Z', sourceUpdatedAt: null, status: 'stale', count: 1 }],
      records: [{ id: 'city:1', sourceId: 'city', kind: 'traffic_camera', lat: 39, lon: -94, name: 'Main', operator: null, road: null, direction: null, status: 'unknown', sourceUrl: 'https://example.gov/1', sourceUpdatedAt: null, imageUrl: null }],
    };
    const csv = monitoringCsv(data, data.records);
    for (const text of ['City transport', 'CC0-1.0', 'https://example.gov/terms', 'stale', '2026-09-09T00:00:00Z', 'snapshotGeneratedAt']) expect(csv).toContain(text);
  });
});
