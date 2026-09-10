import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from './atlas.ts';

const snapshot = readFileSync(new URL('../../../apps/pwa/public/records/atlas-counties.json', import.meta.url), 'utf8');
const get = (query = '') => onRequestGet({ request: new Request(`https://darkroute.ai/api/v1/atlas${query}`) } as never) as Promise<Response>;
afterEach(() => vi.restoreAllMocks());

describe('EFF Atlas county API', () => {
  it('joins the exact camera county and preserves retrieval metadata and source attribution', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(snapshot));
    const response = await get('?fips=29095');
    const body = await response.json() as Record<string, unknown>;
    expect(fetcher).toHaveBeenCalledWith('https://darkroute.ai/records/atlas-counties.json', expect.any(Object));
    expect(body).toMatchObject({ countyFips: '29095', coverage: 'recorded', count: 1,
      counties: [{ fips: '29095', agencies: expect.arrayContaining(['Kansas City Police Department']) }],
      source: { name: 'Atlas of Surveillance' }, fetchedAt: expect.any(String), checkedAt: expect.any(String),
    });
    expect(body['note']).toContain('not abuse findings');
    const all = await (await get()).json() as { count: number };
    expect(all.count).toBe(Object.keys(JSON.parse(snapshot).counties).length);
  });

  it('distinguishes a valid county with no entry from an unreadable dataset', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(snapshot));
    await expect((await get('?fips=00000')).json()).resolves.toMatchObject({ count: 0, counties: [], coverage: 'none' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('missing', { status: 404 }));
    expect((await get('?fips=00000')).status).toBe(503);
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));
    expect((await get()).status).toBe(503);
  });

  it('rejects malformed data and invalid county parameters', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const query of ['?fips=', '?fips=6073', '?fips=abcde', '?fips=060730']) {
      expect((await get(query)).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
    for (const body of ['{}', '<html>oops</html>', JSON.stringify({ ...JSON.parse(snapshot), counties: { '29095': { n: 3, agencies: [], vendors: [], vendorKnown: 0 } } })]) {
      fetcher.mockResolvedValueOnce(new Response(body));
      const response = await get();
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});
