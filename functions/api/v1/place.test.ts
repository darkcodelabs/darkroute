import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_QUERY, MAX_RESULTS, onRequestGet, readPlaces, splitDisplayName, viewboxAround } from './place.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

async function get(query: string, env: Record<string, string> = {}) {
  const response = await onRequestGet({
    request: new Request(`https://darkroute.ai/api/v1/place${query}`),
    env,
  } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

describe('reading the geocoder', () => {
  it('splits a display name into the place and four fields of context', () => {
    expect(
      splitDisplayName('Home Depot, 9600, Metcalf Avenue, Overland Park, Johnson County, Kansas, 66212, United States'),
    ).toEqual({ name: 'Home Depot', detail: '9600, Metcalf Avenue, Overland Park, Johnson County' });
    expect(splitDisplayName('Denver')).toEqual({ name: 'Denver', detail: '' });
    expect(splitDisplayName('  ')).toEqual({ name: '', detail: '' });
  });

  it('drops malformed rows and never returns more than the cap', () => {
    const rows = Array.from({ length: MAX_RESULTS + 3 }, (_, i) => ({
      display_name: `Place ${String(i)}, Kansas`,
      lat: String(39 + i * 0.01),
      lon: '-94.6',
    }));
    const places = readPlaces([
      null,
      { display_name: '', lat: '1', lon: '2' },
      { display_name: 'No coordinates', lat: 'x', lon: '2' },
      ...rows,
    ]);
    expect(places).toHaveLength(MAX_RESULTS);
    expect(places[0]).toEqual({ name: 'Place 0', detail: 'Kansas', lat: 39, lon: -94.6 });
    expect(readPlaces({ not: 'an array' })).toEqual([]);
  });

  it('builds the viewbox in Nominatim order: left, top, right, bottom', () => {
    expect(viewboxAround(39, -94.5)).toBe('-96.5,41,-92.5,37');
  });
});

describe('the handler', () => {
  it('refuses a missing, blank or over-long query without calling upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await get('')).status).toBe(400);
    await expect((await get('?q=%20%20')).json()).resolves.toMatchObject({ error: 'missing_query' });
    const long = await get(`?q=${'a'.repeat(MAX_QUERY + 1)}`);
    expect(long.status).toBe(400);
    await expect(long.json()).resolves.toMatchObject({ error: 'query_too_long' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards a US-only, bounded query with a real user-agent, and shapes the answer', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ display_name: 'Union Station, Pershing Road, Kansas City', lat: '39.085', lon: '-94.585' }])),
    );
    const response = await get('?q=Union%20Station&near=39.09,-94.58');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    await expect(response.json()).resolves.toEqual({
      query: 'Union Station',
      places: [{ name: 'Union Station', detail: 'Pershing Road, Kansas City', lat: 39.085, lon: -94.585 }],
      attribution: '© OpenStreetMap contributors (ODbL)',
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { cf?: unknown }];
    const upstream = new URL(url);
    expect(upstream.origin + upstream.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(upstream.searchParams.get('countrycodes')).toBe('us,pr');
    expect(upstream.searchParams.get('limit')).toBe(String(MAX_RESULTS));
    expect(upstream.searchParams.get('bounded')).toBe('0');
    expect(upstream.searchParams.get('viewbox')).toBe(viewboxAround(39.09, -94.58));
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/^DarkRoute\/1\.0 \(\+https:\/\/darkroute\.ai; /);
    expect(init.cf).toEqual({ cacheTtl: 3600, cacheEverything: true });
  });

  it('ignores a malformed near rather than refusing the query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    expect((await get('?q=Denver&near=garbage')).status).toBe(200);
    const upstream = new URL(fetchSpy.mock.calls[0]?.[0] as string);
    expect(upstream.searchParams.has('viewbox')).toBe(false);
  });

  it('honours NOMINATIM_URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'));
    await get('?q=Denver', { NOMINATIM_URL: 'https://geocoder.example/search' });
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/^https:\/\/geocoder\.example\/search\?/);
  });

  it('tells the caller which way the geocoder failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    await expect((await get('?q=Denver')).json()).resolves.toMatchObject({ error: 'geocoder_unreachable' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('busy', { status: 503 }));
    const failed = await get('?q=Denver');
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({ error: 'geocoder_failed' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>'));
    await expect((await get('?q=Denver')).json()).resolves.toMatchObject({ error: 'geocoder_unreadable' });
  });
});
