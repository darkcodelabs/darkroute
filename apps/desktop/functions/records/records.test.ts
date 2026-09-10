import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest, RECORD_FILES } from './[[path]].ts';

afterEach(() => vi.restoreAllMocks());
const call = (path: string, method = 'GET') => onRequest({ request: new Request(`https://api.darkroute.ai${path}`, { method }) } as never) as Promise<Response>;

describe('published inventories on the API host', () => {
  it.each(RECORD_FILES)('forwards %s to the canonical JSON with attribution and cache headers intact', async (name) => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"attribution":"Publisher","count":3}', {
      headers: { 'content-type': 'application/json; charset=utf-8', etag: '"snapshot"', 'cache-control': 'public, max-age=300' },
    }));
    const response = await call(`/records/${name}?check=1`);
    expect(upstream.mock.calls[0]?.[0]).toBe(`https://darkroute.ai/records/${name}?check=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"snapshot"');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    await expect(response.json()).resolves.toEqual({ attribution: 'Publisher', count: 3 });
  });

  it('keeps HEAD bodyless and forwards HEAD upstream', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { headers: { 'content-type': 'application/json', 'content-length': '42' } }));
    const response = await call('/records/road-monitoring.json', 'HEAD');
    expect(upstream.mock.calls[0]?.[1]?.method).toBe('HEAD');
    expect(response.headers.get('content-length')).toBe('42');
    expect(await response.text()).toBe('');
  });

  it('rejects unknown paths and write methods without contacting upstream', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch');
    for (const path of ['/records/missing.json', '/records/landmarks.json', '/records/a/road-monitoring.json', '/records/%72oad-monitoring.json']) {
      const response = await call(path);
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe('not_found');
    }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const response = await call('/records/road-monitoring.json', method);
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('GET, HEAD');
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('turns upstream HTML fallbacks and connection errors into explicit JSON failures', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>SPA</html>', { headers: { 'content-type': 'text/html' } }));
    expect((await call('/records/road-monitoring.json')).status).toBe(502);
    upstream.mockRejectedValue(new Error('network'));
    const response = await call('/records/road-monitoring.json');
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('inventory_unavailable');
    const head = await call('/records/road-monitoring.json', 'HEAD');
    expect(head.status).toBe(502);
    expect(await head.text()).toBe('');
  });
});
