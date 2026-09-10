import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequestGet } from './abuse.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

async function get(query = '') {
  const response = await onRequestGet({ request: new Request(`https://darkroute.ai/api/v1/abuse${query}`), env: {} } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

describe('abuse records', () => {
  it('normalises every row, keeps the uncited ones, and counts them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          records: [
            { fips: '29095', agency: 'KCPD', incidents: 2, year: 2024, sourceName: 'Star', summary: 's', sourceUrl: 'https://x' },
            { fips: '20091', agency: '', incidents: 'many', year: null },
            'not a record',
          ],
        }),
      ),
    );
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(new URL(fetchSpy.mock.calls[0]?.[0] as string).toString()).toBe('https://darkroute.ai/records/counties.json');
    await expect(response.json()).resolves.toEqual({
      note: expect.stringContaining('One row per published finding'),
      generatedAt: null,
      countyFips: null,
      counties: 2,
      count: 2,
      uncited: 1,
      records: [
        { fips: '29095', agency: 'KCPD', incidents: 2, year: 2024, sourceName: 'Star', summary: 's', sourceUrl: 'https://x' },
        { fips: '20091', agency: 'unnamed agency', incidents: 0, year: 0, sourceName: '', summary: '', sourceUrl: '' },
      ],
    });
  });

  it('filters by county without losing the snapshot date or treating absence as exoneration', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      generatedAt: '2026-09-03', records: [
        { fips: '06073', agency: 'A', sourceUrl: 'https://example.org/source' },
        { fips: '29095', agency: 'B' },
      ],
    })));
    await expect((await get('?fips=06073')).json()).resolves.toMatchObject({
      generatedAt: '2026-09-03', countyFips: '06073', count: 1, counties: 1,
      records: [{ fips: '06073' }],
    });
    await expect((await get('?fips=20091')).json()).resolves.toMatchObject({ count: 0, records: [] });
    expect((await get('?fips=6073')).status).toBe(400);
  });

  it('returns a service error when the dataset is not JSON or the network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>offline</html>'));
    await expect((await get()).json()).resolves.toMatchObject({ error: 'records_malformed' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    await expect((await get()).json()).resolves.toMatchObject({ error: 'records_unavailable' });
  });

  it('503s when the set is missing or the wrong shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('gone', { status: 404 }));
    const missing = await get();
    expect(missing.status).toBe(503);
    await expect(missing.json()).resolves.toMatchObject({ error: 'records_unavailable' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"rows":[]}'));
    await expect((await get()).json()).resolves.toMatchObject({ error: 'records_malformed' });
  });
});
