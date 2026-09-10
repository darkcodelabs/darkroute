import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAbuse, fetchAtlas, fetchNews } from './api.ts';
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
