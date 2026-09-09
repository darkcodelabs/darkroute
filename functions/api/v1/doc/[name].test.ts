import { afterEach, describe, expect, it, vi } from 'vitest';

import { DOCS, onRequestGet } from './[name].ts';

afterEach(() => {
  vi.restoreAllMocks();
});

async function get(name: string) {
  const response = await onRequestGet({
    request: new Request(`https://darkroute.ai/api/v1/doc/${name}`),
    env: {},
    params: { name },
  } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

describe('published documents', () => {
  it('serves only the allowlisted names, and lists them on a miss without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const name of ['nope', '../../package.json', 'API.md', '']) {
      const response = await get(name);
      expect(response.status, name).toBe(404);
      const body = (await response.json()) as { error: string; detail: string };
      expect(body.error).toBe('unknown_document');
      for (const known of Object.keys(DOCS)) expect(body.detail).toContain(known);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches the public mirror, serves the bytes as markdown, and says where they came from', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('# API and network surface\n', { headers: { 'content-type': 'text/plain' } }));
    const response = await get('api');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=900');
    expect(response.headers.get('x-darkroute-source')).toBe(
      'https://raw.githubusercontent.com/darkcodelabs/darkroute/main/docs/public/API.md',
    );
    await expect(response.text()).resolves.toBe('# API and network surface\n');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { cf?: unknown }];
    expect(url).toBe('https://raw.githubusercontent.com/darkcodelabs/darkroute/main/docs/public/API.md');
    expect(init.cf).toEqual({ cacheTtl: 900, cacheEverything: true });
  });

  it('502s rather than serving a stale copy when the repository does not answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
    const response = await get('threat-model');
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { error: string; detail: string };
    expect(body.error).toBe('document_unavailable');
    expect(body.detail).toContain('THREAT-MODEL.md');
    expect(body.detail).toContain('429');
  });
});
