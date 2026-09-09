import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequestGet } from './stats.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const GENERATION = '0e1b7974'.padEnd(64, '0');

function byUrl(handlers: Record<string, () => Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(typeof input === 'string' ? input : input.url).pathname;
    const handler = handlers[path];
    return handler === undefined ? new Response('missing', { status: 404 }) : handler();
  });
}

async function get() {
  const response = await onRequestGet({ request: new Request('https://darkroute.ai/api/v1/stats'), env: {} } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

describe('stats', () => {
  it('reports the archive from its index and the generation the tile route stamped', async () => {
    const fetchSpy = byUrl({
      '/cameras/index.json': () =>
        new Response(
          JSON.stringify({
            cameras: 139918,
            generatedAt: '2026-09-01T18:26:43Z',
            upstream: '2026-09-01T18:00:00Z',
            zoom: 11,
            bbox: [-125, 24, -66, 50],
            source: 'OpenStreetMap',
          }),
          { headers: { 'x-darkroute-camera-generation': GENERATION } },
        ),
      '/records/counties.json': () => new Response(JSON.stringify({ records: [{}, {}, {}] })),
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      cameras: 139918,
      generation: GENERATION,
      generatedAt: '2026-09-01T18:26:43Z',
      upstream: '2026-09-01T18:00:00Z',
      zoom: 11,
      bbox: [-125, 24, -66, 50],
      source: 'OpenStreetMap',
      attribution: 'Map data © OpenStreetMap contributors',
      licence: 'ODbL-1.0',
      abuseRecords: 3,
    });
    expect(typeof body['scope']).toBe('string');
    expect(body['caveat']).toContain('MAPPED');
    expect(fetchSpy.mock.calls.map(([url]) => new URL(url as string).origin)).toEqual([
      'https://darkroute.ai',
      'https://darkroute.ai',
    ]);
  });

  it('counts zero misuse records when that file is unavailable, but 503s when the index is', async () => {
    byUrl({ '/cameras/index.json': () => new Response(JSON.stringify({ cameras: 1 })) });
    await expect((await get()).json()).resolves.toMatchObject({ abuseRecords: 0, generation: null });

    byUrl({ '/records/counties.json': () => new Response('{"records":[]}') });
    const down = await get();
    expect(down.status).toBe(503);
    expect(down.headers.get('cache-control')).toBe('no-store');
    await expect(down.json()).resolves.toMatchObject({ error: 'archive_unavailable' });

    byUrl({ '/cameras/index.json': () => new Response('[]') });
    await expect((await get()).json()).resolves.toMatchObject({ error: 'archive_malformed' });
  });
});
