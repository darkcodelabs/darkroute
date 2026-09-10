import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RECORD_FILES } from '../../shared/recordFiles.ts';
import { ApiRefView, OVERVIEW_CURL } from './ApiRefView.tsx';
import { datasetSummary } from './DatasetInventory.tsx';

describe('public data inventory', () => {
  it('separates dataset units and preserves source freshness and partial coverage', () => {
    expect(datasetSummary('monitoring', { count: 2, total: 2, records: [{}, {}], generatedAt: '2026-09-10T10:00:00Z', sources: [{ status: 'ok' }, { status: 'stale' }] }))
      .toMatchObject({ count: 2, unit: 'equipment records', detail: '2 sources · 1 current. Separate from ALPR cameras.' });
    expect(datasetSummary('atlas', { totals: { alprRows: 4146, agencies: 3574, counties: 1345 }, fetchedAt: '2026-09-09T12:00:00Z', checkedAt: '2026-09-10T12:00:00Z' }))
      .toMatchObject({ count: 4146, unit: 'deployment rows', date: expect.stringContaining('Checked 2026-09-10') });
    expect(datasetSummary('news', { articles: [{}], updatedAt: '2026-09-10T12:00:00Z', lastAttemptAt: '2026-09-10T13:00:00Z', coverage: { status: 'partial', succeeded: 1, attempted: 9 } }))
      .toMatchObject({ count: 1, detail: 'Collection partial · 1 of 9 searches answered.' });
    expect(datasetSummary('hazards', { count: 1, hazards: [{}], coverage: ['KS'], builtAt: '2026-09-04T00:00:00Z' }, Date.parse('2026-09-10T00:00:00Z')))
      .toMatchObject({ count: 1, unit: 'work-zone records', date: expect.stringContaining('2026-09-04'), detail: expect.stringContaining('Stale snapshot') });
  });

  it('refuses missing counts and incomplete arrays instead of displaying false zeros', () => {
    expect(() => datasetSummary('monitoring', { count: 1, total: 200, records: [{}] })).toThrow();
    expect(() => datasetSummary('abuse', { count: 93, records: [] })).toThrow();
    expect(() => datasetSummary('atlas', { totals: {} })).toThrow();
    expect(() => datasetSummary('hazards', '<html>SPA</html>')).toThrow();
    expect(datasetSummary('abuse', { count: 0, records: [], generatedAt: null })).toMatchObject({ count: 0, date: 'Dataset date unavailable' });
  });

  it('lists every proxied inventory, working UI entry points and the actual coordinate schema', () => {
    const html = renderToStaticMarkup(createElement(ApiRefView, { archive: { stats: null, tombstones: null, counties: null, built: null, tiles: null, state: 'pending' } }));
    for (const name of RECORD_FILES) expect(html).toContain(`/records/${name}`);
    for (const path of ['/?tab=monitoring', '/?tab=reports&amp;report=atlas', '/?tab=reports&amp;report=news', '/api/v1/news', '/docs/data-inventory.md']) expect(html).toContain(path);
    expect(html).toContain('Checking current inventory');
    expect(html).toContain('no camera IDs or full records');
    expect(html).not.toContain('[lat, lon, id]');
    expect(OVERVIEW_CURL).toContain('.coords as $c');
    expect(OVERVIEW_CURL).toContain('$c[$i + 1]');
  });
});
