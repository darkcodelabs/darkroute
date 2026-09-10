import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from './monitoring.ts';

const date = '2026-09-10T00:00:00Z';
const snapshot = {
  schema: 'darkroute-road-monitoring/v1', generatedAt: date,
  sources: [{ id: 'county', name: 'County', url: 'https://example.org', attribution: 'County', licence: null, licenceUrl: null,
    coverage: 'County', checkedAt: date, fetchedAt: '2026-09-01T00:00:00Z', sourceUpdatedAt: null, status: 'stale', count: 2 }],
  records: [
    { id: 'one', sourceId: 'county', kind: 'bluetooth_sensor', lat: 39, lon: -94, name: 'Sensor', operator: null, road: null,
      direction: null, status: 'unknown', sourceUrl: 'https://example.org/1', imageUrl: null, sourceUpdatedAt: null },
    { id: 'two', sourceId: 'county', kind: 'traffic_camera', lat: 38, lon: -93, name: 'Camera', operator: null, road: null,
      direction: null, status: 'active', sourceUrl: 'https://example.org/2', imageUrl: null, sourceUpdatedAt: null },
  ],
};
const get = (query = '') => onRequestGet({ request: new Request(`https://darkroute.ai/api/v1/monitoring${query}`) } as never) as Promise<Response>;
afterEach(() => vi.restoreAllMocks());

describe('public monitoring inventory API', () => {
  it('reads the shared production artifact and preserves stale source metadata', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(snapshot)));
    const response = await get();
    expect(fetcher).toHaveBeenCalledWith('https://darkroute.ai/records/road-monitoring.json', expect.any(Object));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...snapshot, count: 2, total: 2, query: { bbox: null, kind: null } });
  });

  it('combines bbox and kind filters while retaining full inventory provenance counts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(snapshot)));
    const response = await get('?bbox=-94.5,38.5,-93.5,39.5&kind=bluetooth_sensor');
    await expect(response.json()).resolves.toMatchObject({ count: 1, total: 2, sources: [{ count: 2 }], records: [{ id: 'one' }] });
    await expect((await get('?bbox=-94.5,38.5,-93.5,39.5&kind=traffic_camera')).json()).resolves.toMatchObject({ count: 0, total: 2, records: [] });
  });

  it('rejects malformed query values before requesting any data', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const query of ['?bbox=', '?bbox=0,,1,1', '?bbox=0,0,1', '?bbox=1,0,0,1', '?bbox=-181,0,0,1', '?bbox=0,-91,1,1', '?kind=alpr', '?kind=']) {
      expect((await get(query)).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('distinguishes unavailable or invalid snapshots from an empty inventory', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const response of [new Response('gone', { status: 404 }), new Response('{}'), new Response('<html>offline</html>')]) {
      fetcher.mockResolvedValueOnce(response);
      const result = await get();
      expect(result.status).toBe(503);
      expect(result.headers.get('cache-control')).toBe('no-store');
    }
    fetcher.mockRejectedValueOnce(new Error('offline'));
    expect((await get()).status).toBe(503);
  });
});
