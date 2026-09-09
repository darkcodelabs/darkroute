/**
 * The console host's proxy, measured against what it dropped.
 *
 * On 2026-09-09, live: `POST api.darkroute.ai/v1/submit` with a JSON body was
 * `400 bad_json` and `PUT /v1/photo/` with an image was `415 got nothing`,
 * because the fetch here carried no body and forwarded two headers. These
 * tests hold the body and its type on the wire, and hold `/api/v1/*` on this
 * host to the same answer as `/v1/*`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequest as onApiV1 } from './api/v1/[[path]].ts';
import { onRequest as onV1 } from './v1/[[path]].ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function upstreamSpy(body = '{"ok":true}', status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'ratelimit-remaining': '41' },
    }),
  );
}

async function call(handler: PagesFunction, request: Request) {
  const response = await handler({ request, env: {}, next: vi.fn() } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

describe('the console host proxy', () => {
  it('maps /v1/* onto the canonical /api/v1/*, query and all, forwarding the caller address', async () => {
    const fetchSpy = upstreamSpy();
    const response = await call(
      onV1,
      new Request('https://api.darkroute.ai/v1/cameras?bbox=-94.6,39,-94.5,39.1&limit=5', {
        headers: { 'CF-Connecting-IP': '203.0.113.7', accept: 'application/json', cookie: 'secret=1' },
      }),
    );
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://darkroute.ai/api/v1/cameras?bbox=-94.6,39,-94.5,39.1&limit=5');
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    const headers = init.headers as Record<string, string>;
    expect(headers['CF-Connecting-IP']).toBe('203.0.113.7');
    expect(headers['accept']).toBe('application/json');
    expect(headers['cookie']).toBeUndefined();
    expect(init.body).toBeUndefined();

    expect(response.status).toBe(200);
    expect(response.headers.get('ratelimit-remaining')).toBe('41');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-darkroute-upstream')).toBe('https://darkroute.ai');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('serves /api/v1/* on this host as the same upstream path, so the spec is valid here too', async () => {
    const fetchSpy = upstreamSpy();
    await call(onApiV1, new Request('https://api.darkroute.ai/api/v1/stats'));
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://darkroute.ai/api/v1/stats');
  });

  it('forwards a POST body with its content-type, so /submit sees the JSON it was sent', async () => {
    const fetchSpy = upstreamSpy();
    const payload = '{"kind":"correction","cameraId":"osm:1"}';
    await call(
      onV1,
      new Request('https://api.darkroute.ai/v1/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
        body: payload,
      }),
    );
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://darkroute.ai/api/v1/submit');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['content-length']).toBe(String(payload.length));
    expect(init.body).toBeDefined();
    await expect(new Response(init.body as BodyInit).text()).resolves.toBe(payload);
  });

  it('forwards a PUT body with its media type, so /photo sees the image rather than nothing', async () => {
    const fetchSpy = upstreamSpy();
    await call(
      onApiV1,
      new Request('https://api.darkroute.ai/api/v1/photo', {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg' },
        body: new Uint8Array([0xff, 0xd8, 0xff]),
      }),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
    expect(new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer())).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
  });

  it('passes the upstream status through untouched - a 404 stays a 404', async () => {
    upstreamSpy('{"error":"not_found"}', 404);
    const response = await call(onV1, new Request('https://api.darkroute.ai/v1/nonexistent'));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });
});
