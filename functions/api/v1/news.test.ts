import { describe, expect, it, vi } from 'vitest';
import { NEWS_KEY, onRequestGet } from './news.ts';

const feed = { schema: 'darkroute-news/v1', updatedAt: '2026-09-10T00:00:00Z', lastAttemptAt: '2026-09-10T00:00:00Z', coverage: { status: 'partial', attempted: 6, succeeded: 3 }, articles: [] };
const invoke = (bucket?: unknown) => onRequestGet({ env: bucket === undefined ? {} : { CAMERA_TILES: bucket } } as never) as Promise<Response>;

describe('automatic news snapshot', () => {
  it('serves the independent atomic news object with a short cache', async () => {
    const body = JSON.stringify(feed);
    const get = vi.fn().mockResolvedValue({ size: body.length, httpEtag: '"snapshot"', text: async () => body });
    const response = await invoke({ get });
    expect(get).toHaveBeenCalledWith(NEWS_KEY);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('max-age=60');
    expect(response.headers.get('etag')).toBe('"snapshot"');
    expect(await response.json()).toEqual(feed);
  });

  it('fails explicitly instead of reporting an empty feed for missing or unreadable data', async () => {
    for (const bucket of [undefined, { get: async () => null }, { get: async () => { throw new Error('storage failure'); } }]) {
      const response = await invoke(bucket);
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('refuses malformed and oversized snapshots', async () => {
    for (const body of ['<html>error</html>', '{}', JSON.stringify({ ...feed, articles: Array(1001).fill({}) })]) {
      expect((await invoke({ get: async () => ({ size: body.length, text: async () => body }) })).status).toBe(503);
    }
    const text = vi.fn();
    expect((await invoke({ get: async () => ({ size: 3_000_000, text }) })).status).toBe(503);
    expect(text).not.toHaveBeenCalled();
  });
});
