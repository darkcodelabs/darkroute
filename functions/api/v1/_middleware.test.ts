/**
 * THE FRONT DOOR, MEASURED.
 *
 * Every case here was a live failure on 2026-09-09 or is the invariant that
 * stops one coming back:
 *
 *   - `PUT /api/v1/photo` (no trailing slash - the path the app sends) was 405,
 *     because the allowlist named `/api/v1/photo/`. Every photo upload the
 *     shipped client made was refused.
 *   - `access-control-allow-methods` said `GET, OPTIONS` while POST and PUT
 *     were accepted, so a cross-origin browser could never preflight a write.
 *   - HEAD was advertised in `allow:` and served as the single-page app.
 *   - An unknown path was the single-page app with a 200 on it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { onRequest } from './_middleware.ts';

let nextIp = 1;
/** A fresh address per test, so one test's budget never leaks into another's. */
function ip(): string {
  nextIp += 1;
  return `203.0.113.${String(nextIp)}`;
}

async function call(
  method: string,
  path: string,
  options: { readonly ip?: string; readonly headers?: Record<string, string>; readonly body?: string } = {},
) {
  const next = vi.fn(
    async () =>
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }),
  );
  const request = new Request(`https://darkroute.ai${path}`, {
    method,
    headers: { 'CF-Connecting-IP': options.ip ?? ip(), ...(options.headers ?? {}) },
    ...(options.body === undefined ? {} : { body: options.body }),
  });
  const response = await onRequest({ request, env: {}, next } as never);
  expect(response).toBeInstanceOf(Response);
  return { response: response as Response, next };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('preflight', () => {
  it('answers OPTIONS with CORS that names every method a route takes', async () => {
    const { response, next } = await call('OPTIONS', '/api/v1/photo', {
      headers: { origin: 'https://example.org', 'access-control-request-method': 'PUT' },
    });
    expect(response.status).toBe(204);
    expect(next).not.toHaveBeenCalled();
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const methods = (response.headers.get('access-control-allow-methods') ?? '').split(/,\s*/);
    expect(methods).toEqual(expect.arrayContaining(['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS']));
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });
});

describe('the write allowlist', () => {
  it('lets PUT /api/v1/photo through - the bare path the app actually sends', async () => {
    const { response, next } = await call('PUT', '/api/v1/photo', {
      headers: { 'content-type': 'image/jpeg' },
      body: 'x',
    });
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it('still lets the trailing-slash spelling through', async () => {
    const { next } = await call('PUT', '/api/v1/photo/', { headers: { 'content-type': 'image/jpeg' }, body: 'x' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('lets POST /api/v1/submit through', async () => {
    const { next } = await call('POST', '/api/v1/submit', {
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('refuses PUT to a photo KEY - the key is derived from the bytes, never named', async () => {
    const { response, next } = await call('PUT', '/api/v1/photo/abc.jpg', { body: 'x' });
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });
});

describe('methods a path does not take', () => {
  it('405s GET /api/v1/submit and names POST in allow', async () => {
    const { response, next } = await call('GET', '/api/v1/submit');
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST, OPTIONS');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ error: 'method_not_allowed' });
  });

  it('405s DELETE on a read route with the read methods in allow', async () => {
    const { response } = await call('DELETE', '/api/v1/stats');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('404s a write to a path that is not a route, rather than 405ing it', async () => {
    const { response, next } = await call('PUT', '/api/v1/nonexistent', { body: 'x' });
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string; available: string[] };
    expect(body.error).toBe('not_found');
    expect(body.available).toContain('GET /api/v1/cameras');
    expect(body.available).toContain('POST /api/v1/submit');
  });

  it('404s an unknown GET itself, before the handler chain - never the app shell', async () => {
    const { response, next } = await call('GET', '/api/v1/nonexistent');
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(response.json()).resolves.toMatchObject({ error: 'not_found' });
  });

  it('405s GET on the bare photo path, which only takes PUT', async () => {
    const { response } = await call('GET', '/api/v1/photo');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('PUT, OPTIONS');
  });
});

describe('HEAD', () => {
  it('is answered from a same-origin GET: its headers, no body, not counted twice', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"cameras":139918}', {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': '18',
          'cache-control': 'public, max-age=300',
          'ratelimit-remaining': '58',
          'access-control-allow-origin': '*',
        },
      }),
    );
    const address = ip();
    const { response, next } = await call('HEAD', '/api/v1/stats', { ip: address });

    expect(next).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://darkroute.ai/api/v1/stats');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['CF-Connecting-IP']).toBe(address);

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('ratelimit-remaining')).toBe('58');
    expect(response.headers.get('content-length')).toBeNull();
  });

  it('carries the GET status through, so HEAD on an unknown path is a 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"not_found"}', { status: 404 }));
    const { response } = await call('HEAD', '/api/v1/nonexistent');
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
  });
});

describe('pass-through', () => {
  it('stamps CORS and the rate-limit headers on a handler response', async () => {
    const { response } = await call('GET', '/api/v1/stats');
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('ratelimit-limit')).toBe('60');
    expect(response.headers.get('ratelimit-remaining')).toBe('59');
    expect(Number(response.headers.get('ratelimit-reset'))).toBeGreaterThan(0);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('answers the 61st request in a minute from one address with 429, retry-after and a JSON body', async () => {
    const address = ip();
    for (let i = 0; i < 60; i += 1) {
      const { response } = await call('GET', '/api/v1/stats', { ip: address });
      expect(response.status).toBe(200);
    }
    const { response, next } = await call('GET', '/api/v1/stats', { ip: address });
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(429);
    expect(response.headers.get('ratelimit-remaining')).toBe('0');
    const retryAfter = Number(response.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = (await response.json()) as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe('rate_limited');
    expect(body.retryAfterSeconds).toBe(retryAfter);
  });

  it('buckets by CF-Connecting-IP, not by anything the caller can set', async () => {
    const address = ip();
    for (let i = 0; i < 60; i += 1) await call('GET', '/api/v1/stats', { ip: address });
    // A different X-Forwarded-For does not mint a new budget.
    const { response } = await call('GET', '/api/v1/stats', {
      ip: address,
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });
    expect(response.status).toBe(429);
  });
});
