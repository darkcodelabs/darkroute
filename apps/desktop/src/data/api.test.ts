import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAbuse, fetchAtlas, fetchMonitoring, fetchMonitoringImage, fetchNews } from './api.ts';
import type { ApiError } from './api.ts';

afterEach(() => vi.restoreAllMocks());

describe('public Reports API client', () => {
  it('reads every report type from the canonical production API with no browser credentials or referrer', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    const controller = new AbortController();
    await Promise.all([fetchNews(controller.signal), fetchAbuse(controller.signal), fetchAtlas(controller.signal)]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://darkroute.ai/api/v1/news', 'https://darkroute.ai/api/v1/abuse', 'https://darkroute.ai/api/v1/atlas',
    ]);
    for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache',
    });
  });

  it('preserves error status and detail instead of turning unavailable reports into an empty result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'atlas_unavailable', detail: 'Atlas could not be read' }), { status: 503 }));
    await expect(fetchAtlas()).rejects.toMatchObject({ name: 'ApiError', status: 503, code: 'atlas_unavailable', message: 'Atlas could not be read' } satisfies Partial<ApiError>);
  });
});

describe('public monitoring client', () => {
  const snapshot = { schema: 'darkroute-road-monitoring/v1', generatedAt: '2026-09-10T00:00:00Z', sources: [], records: [], query: { bbox: null, kind: null }, count: 0, total: 0 };

  it('loads the full production inventory without sending location or search data', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(snapshot)));
    const controller = new AbortController();
    await expect(fetchMonitoring(controller.signal)).resolves.toMatchObject({ records: [], count: 0, total: 0 });
    expect(fetcher).toHaveBeenCalledWith('https://darkroute.ai/api/v1/monitoring', expect.objectContaining({
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache',
    }));
  });

  it('rejects malformed or partial successful responses rather than replacing an inventory with them', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const invalid of [{}, { ...snapshot, total: 1 }, { ...snapshot, query: { bbox: null, kind: 'traffic_camera' } }, { ...snapshot, sources: [{ id: 'incomplete' }] }]) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(invalid)));
      await expect(fetchMonitoring()).rejects.toMatchObject({ code: 'monitoring_malformed' });
    }
  });

  it('preserves unavailable status and the server explanation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'monitoring_unavailable', detail: 'The inventory has not been published yet.' }), { status: 503 }));
    await expect(fetchMonitoring()).rejects.toMatchObject({ status: 503, code: 'monitoring_unavailable', message: 'The inventory has not been published yet.' });
  });

  it('requests photos through the same-origin proxy with an encoded record ID and no credentials or cache', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }));
    const controller = new AbortController();
    expect((await fetchMonitoringImage('city:Main & 1', controller.signal)).size).toBe(4);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/monitoring/image?id=city%3AMain+%26+1', expect.objectContaining({
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    }));
  });

  it('rejects unavailable, non-image and oversized photo responses', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const response of [new Response('unavailable', { status: 503 }), new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }), new Response('bytes', { headers: { 'content-type': 'image/jpeg', 'content-length': String(6 * 1024 * 1024) } })]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(fetchMonitoringImage('city:1')).rejects.toMatchObject({ code: 'monitoring_image_unavailable' });
    }
  });
});
