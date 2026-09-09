import { describe, expect, it } from 'vitest';

import { CONSOLE_URL, SURFACE_COOKIE, onRequest, wantsConsole } from './_middleware.ts';

const DESK =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36';

function request(path: string, headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request(`https://darkroute.ai${path}`, {
    method,
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': DESK, ...headers },
  });
}

async function run(req: Request): Promise<Response> {
  const next = async (): Promise<Response> => new Response('app', { status: 200 });
  const context = { request: req, next } as unknown as Parameters<typeof onRequest>[0];
  return onRequest(context);
}

describe('who gets the console', () => {
  it('sends a desk browser at the front door to the console', () => {
    expect(wantsConsole(request('/'))).toBe(true);
  });
  it('serves the app to a phone, by hint or by agent', () => {
    expect(wantsConsole(request('/', { 'user-agent': PHONE }))).toBe(false);
    expect(wantsConsole(request('/', { 'user-agent': ANDROID }))).toBe(false);
    expect(wantsConsole(request('/', { 'sec-ch-ua-mobile': '?1' }))).toBe(false);
    expect(wantsConsole(request('/', { 'sec-ch-ua-mobile': '?0', 'user-agent': PHONE }))).toBe(true);
  });
  it('never touches a deep link, an explicit ask, an asset or an API call', () => {
    expect(wantsConsole(request('/?screen=lookup'))).toBe(false);
    expect(wantsConsole(request('/?camera=osm:1'))).toBe(false);
    expect(wantsConsole(request('/?app'))).toBe(false);
    expect(wantsConsole(request('/?source=pwa'))).toBe(false);
    expect(wantsConsole(request('/?src=pwa'))).toBe(false);
    expect(wantsConsole(request('/api/v1/stats', { accept: 'application/json' }))).toBe(false);
    expect(wantsConsole(request('/assets/index.js', { accept: '*/*' }))).toBe(false);
    expect(wantsConsole(request('/', { accept: 'application/json' }))).toBe(false);
    expect(wantsConsole(request('/', {}, 'POST'))).toBe(false);
    expect(wantsConsole(request('/', { 'user-agent': '' }))).toBe(false);
  });
  it('respects the cookie a desk set by asking for the app', () => {
    expect(wantsConsole(request('/', { cookie: `${SURFACE_COOKIE}=app` }))).toBe(false);
    expect(wantsConsole(request('/', { cookie: `theme=dark; ${SURFACE_COOKIE}=app; x=1` }))).toBe(false);
    expect(wantsConsole(request('/', { cookie: 'theme=dark' }))).toBe(true);
  });
});

describe('the middleware', () => {
  it('redirects a desk with an uncacheable 302 to the console', async () => {
    const response = await run(request('/'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(CONSOLE_URL);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toContain('user-agent');
  });
  it('passes a phone through to the app', async () => {
    const response = await run(request('/', { 'user-agent': PHONE }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('app');
  });
  it('remembers a desk that asked for the app', async () => {
    const response = await run(request('/?app'));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(`${SURFACE_COOKIE}=app`);
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });
});
