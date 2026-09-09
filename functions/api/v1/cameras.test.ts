import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LIMIT, MAX_LIMIT, MAX_TILES, onRequestGet } from './cameras.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A small box in Kansas City that sits inside one zoom-11 tile. */
const KC = '-94.60,39.05,-94.58,39.07';

async function get(query: string) {
  const response = await onRequestGet({
    request: new Request(`https://darkroute.ai/api/v1/cameras${query}`),
    env: {},
  } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

function tile(cameras: unknown[]): Response {
  return new Response(JSON.stringify({ cameras }), { headers: { 'content-type': 'application/json' } });
}

describe('refusals, each naming the constraint', () => {
  it('needs a well-formed bbox', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const [query, fragment] of [
      ['', 'bbox is required'],
      ['?bbox=1,2,3', 'needs 4'],
      ['?bbox=a,b,c,d', 'not a number'],
      ['?bbox=-94.5,39,-94.6,39.1', 'east must be greater'],
      ['?bbox=-94.6,39.1,-94.5,39', 'north must be greater'],
      ['?bbox=-181,39,-94.5,39.1', 'longitude'],
      ['?bbox=-96,38,-94,40', 'at most 1.5'],
    ] as const) {
      const response = await get(query);
      expect(response.status, query).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = (await response.json()) as { error: string; detail: string };
      expect(body.error).toBe('bad_bbox');
      expect(body.detail).toContain(fragment);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('needs a known owner and an integer limit in range', async () => {
    await expect((await get(`?bbox=${KC}&owner=bogus`)).json()).resolves.toMatchObject({ error: 'bad_owner' });
    for (const limit of ['0', String(MAX_LIMIT + 1), '1.5', 'ten']) {
      const response = await get(`?bbox=${KC}&limit=${limit}`);
      expect(response.status, limit).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: 'bad_limit' });
    }
  });

  it(`refuses a box that opens more than ${String(MAX_TILES)} tiles even when its span is legal`, async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await get('?bbox=-95.3,38.3,-93.8,39.8');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; detail: string };
    expect(body.error).toBe('too_many_tiles');
    expect(body.detail).toContain(`limit is ${String(MAX_TILES)}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('reading through the tile route', () => {
  it('fetches zoom-11 tiles same-origin, filters to the box, and reports attribution', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      tile([
        { id: 'osm:1', lat: 39.06, lon: -94.59, ownerType: 'police', street: 'Main', tags: { operator: 'KCPD' } },
        { id: 'osm:2', lat: 39.06, lon: -94.59, ownerType: 'private' },
        { id: 'osm:outside', lat: 39.2, lon: -94.59 },
        { id: 'osm:nocoords' },
      ]),
    );
    const response = await get(`?bbox=${KC}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');

    const requested = fetchSpy.mock.calls.map(([url]) => new URL(url as string));
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.length).toBeLessThanOrEqual(MAX_TILES);
    for (const url of requested) {
      expect(url.origin).toBe('https://darkroute.ai');
      expect(url.pathname).toMatch(/^\/cameras\/11\/\d+\/\d+\.json$/);
    }

    const body = (await response.json()) as Record<string, unknown> & { cameras: Record<string, unknown>[] };
    expect(body['attribution']).toBe('Map data © OpenStreetMap contributors');
    expect(body['licence']).toBe('ODbL-1.0');
    expect(body['query']).toEqual({ bbox: [-94.6, 39.05, -94.58, 39.07], owner: null, limit: DEFAULT_LIMIT });
    expect(body['truncated']).toBe(false);
    expect(body['emptyTiles']).toBe(0);
    expect(body['count']).toBe(2 * requested.length);
    expect(body.cameras[0]).toEqual({
      id: 'osm:1',
      lat: 39.06,
      lon: -94.59,
      ownerType: 'police',
      street: 'Main',
      cross: null,
      directionDeg: null,
      operator: 'KCPD',
      manufacturer: null,
      mount: null,
      locality: null,
      streetM: null,
    });
  });

  it('counts a 404 tile as empty ground, not as a failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('null', { status: 404 }));
    const response = await get(`?bbox=${KC}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { count: number; emptyTiles: number };
    expect(body.count).toBe(0);
    expect(body.emptyTiles).toBe(fetchSpy.mock.calls.length);
  });

  it('applies the owner filter and the limit, and says when it cut the answer short', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      tile([
        { id: 'osm:1', lat: 39.06, lon: -94.59, ownerType: 'police' },
        { id: 'osm:2', lat: 39.06, lon: -94.59, ownerType: 'police' },
        { id: 'osm:3', lat: 39.06, lon: -94.59, ownerType: 'hoa' },
      ]),
    );
    const filtered = (await (await get(`?bbox=${KC}&owner=hoa&limit=${String(MAX_LIMIT)}`)).json()) as {
      cameras: { id: string }[];
      truncated: boolean;
    };
    expect(filtered.cameras.every((camera) => camera.id === 'osm:3')).toBe(true);
    expect(filtered.truncated).toBe(false);

    const limited = (await (await get(`?bbox=${KC}&limit=1`)).json()) as { count: number; truncated: boolean };
    expect(limited.count).toBe(1);
    expect(limited.truncated).toBe(true);
  });

  it('503s rather than serving a partial answer when the archive fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('camera archive unavailable', { status: 503 }));
    const response = await get(`?bbox=${KC}`);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ error: 'archive_unavailable' });
  });
});
