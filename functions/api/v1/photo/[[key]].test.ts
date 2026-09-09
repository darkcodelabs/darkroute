import { describe, expect, it, vi } from 'vitest';

import { MAX_BYTES, PHOTO_KEY, onRequestGet, onRequestPut } from './[[key]].ts';

interface Stored {
  readonly body: ArrayBuffer;
  readonly httpMetadata: { readonly contentType: string };
}

/** Enough of an R2 bucket for these two handlers. */
function bucket() {
  const store = new Map<string, Stored>();
  return {
    store,
    put: vi.fn(async (key: string, body: ArrayBuffer, options: { httpMetadata: { contentType: string } }) => {
      store.set(key, { body, httpMetadata: options.httpMetadata });
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  };
}

async function put(body: BodyInit | null, contentType: string | null, env: Record<string, unknown>) {
  const headers = new Headers();
  if (contentType !== null) headers.set('content-type', contentType);
  const response = await onRequestPut({
    request: new Request('https://darkroute.ai/api/v1/photo', { method: 'PUT', headers, body }),
    env,
    params: {},
  } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

async function get(key: string, env: Record<string, unknown>) {
  const response = await onRequestGet({
    request: new Request(`https://darkroute.ai/api/v1/photo/${key}`),
    env,
    // A `[[key]]` segment arrives from Pages as an array.
    params: { key: [key] },
  } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

describe('storing a photo', () => {
  it('says so when there is no bucket, and stores nothing', async () => {
    const response = await put('abc', 'image/jpeg', {});
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'photos_unconfigured' });
  });

  it('refuses a media type it does not store, before reading the body', async () => {
    const b = bucket();
    expect((await put('abc', 'text/plain', { SUBMISSION_PHOTOS: b })).status).toBe(415);
    const none = await put('abc', null, { SUBMISSION_PHOTOS: b });
    expect(none.status).toBe(415);
    await expect(none.json()).resolves.toMatchObject({ error: 'unsupported_type' });
    expect(b.put).not.toHaveBeenCalled();
  });

  it('refuses no bytes', async () => {
    const b = bucket();
    const response = await put(null, 'image/png', { SUBMISSION_PHOTOS: b });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'empty' });
    expect(b.put).not.toHaveBeenCalled();
  });

  it(`refuses more than ${String(MAX_BYTES)} bytes`, async () => {
    const b = bucket();
    const response = await put(new Uint8Array(MAX_BYTES + 1), 'image/webp', { SUBMISSION_PHOTOS: b });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: 'too_large' });
    expect(b.put).not.toHaveBeenCalled();
  });

  it('keys the object by its bytes, ignores charset noise on the type, and serves it back', async () => {
    const b = bucket();
    const env = { SUBMISSION_PHOTOS: b };
    const stored = await put(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png; charset=binary', env);
    expect(stored.status).toBe(200);
    expect(stored.headers.get('cache-control')).toBe('no-store');
    expect(stored.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await stored.json()) as { ok: boolean; key: string; bytes: number };
    expect(body.ok).toBe(true);
    expect(body.bytes).toBe(4);
    expect(body.key).toMatch(PHOTO_KEY);
    expect(body.key.endsWith('.png')).toBe(true);
    expect(b.store.get(body.key)?.httpMetadata.contentType).toBe('image/png');

    // The same bytes again are the same key: one object, no second write of note.
    const again = (await (await put(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png', env)).json()) as { key: string };
    expect(again.key).toBe(body.key);

    const served = await get(body.key, env);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(served.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });
});

describe('reading a photo', () => {
  it('never turns a URL into an arbitrary object read', async () => {
    const b = bucket();
    for (const key of ['abc', '../index.json', `${'a'.repeat(32)}.gif`, `${'A'.repeat(32)}.jpg`]) {
      const response = await get(key, { SUBMISSION_PHOTOS: b });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: 'not_found' });
    }
    expect(b.get).not.toHaveBeenCalled();
  });

  it('404s a well-formed key that was never stored', async () => {
    const b = bucket();
    const response = await get(`${'0'.repeat(32)}.jpg`, { SUBMISSION_PHOTOS: b });
    expect(response.status).toBe(404);
    expect(b.get).toHaveBeenCalledOnce();
  });

  it('503s without a bucket', async () => {
    expect((await get(`${'0'.repeat(32)}.jpg`, {})).status).toBe(503);
  });
});
