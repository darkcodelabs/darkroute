import { describe, expect, it } from 'vitest';

import { onRequest } from './[[path]].ts';
import { ROUTES } from './_routes.ts';

async function call(method: string, path: string) {
  const response = await onRequest({
    request: new Request(`https://darkroute.ai${path}`, { method }),
    env: {},
    next: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
  } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

describe('the /api/v1 catch-all', () => {
  it('answers an unknown path with 404 JSON that lists every route, never the app shell', async () => {
    const response = await call('GET', '/api/v1/nonexistent');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { error: string; detail: string; available: string[] };
    expect(body.error).toBe('not_found');
    expect(body.detail).toContain('/api/v1/openapi.json');
    expect(body.available).toHaveLength(ROUTES.length);
    expect(body.available).toContain('PUT /api/v1/photo');
  });

  it('treats the bare /api/v1 as unknown too', async () => {
    expect((await call('GET', '/api/v1')).status).toBe(404);
    expect((await call('GET', '/api/v1/')).status).toBe(404);
  });

  it('405s a real path reached with a method its handler does not export', async () => {
    const response = await call('GET', '/api/v1/submit');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST, OPTIONS');
    await expect(response.json()).resolves.toMatchObject({ error: 'method_not_allowed' });
  });
});
