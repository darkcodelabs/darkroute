import { describe, expect, it, vi } from 'vitest';

import { onRequestGet } from './[[path]].ts';

const POINTER_KEY = '__camera/current.json';
const GENERATION = 'a'.repeat(64);
const MANIFEST_SHA256 = 'b'.repeat(64);
const LOGICAL_KEY = '11/537/792.json';
const SELECTED_KEY = `__camera/slots/b/data/${LOGICAL_KEY}`;

const POINTER = JSON.stringify({
  schema: 'darkroute-camera-pointer/v1',
  slot: 'b',
  generation: GENERATION,
  manifestSha256: MANIFEST_SHA256,
  previous: {
    slot: 'a',
    generation: 'c'.repeat(64),
    manifestSha256: 'd'.repeat(64),
  },
  updatedAt: '2026-09-01T19:20:30.000Z',
});

function object(body: string) {
  const writeHttpMetadata = vi.fn((headers: Headers) => {
    headers.set('content-type', 'application/octet-stream');
    headers.set('content-disposition', 'attachment; filename=poisoned.html');
    headers.set('x-r2-meta', 'must not cross the boundary');
  });

  return {
    body,
    httpEtag: '"r2-etag"',
    async text() {
      return body;
    },
    writeHttpMetadata,
  };
}

async function request(
  entries: ReadonlyMap<string, ReturnType<typeof object>>,
  pathname = `/cameras/${LOGICAL_KEY}`,
) {
  const get = vi.fn(async (key: string) => entries.get(key) ?? null);
  const next = vi.fn(async () => new Response('static asset'));
  const response = await onRequestGet({
    request: new Request(`https://darkroute.ai${pathname}`),
    env: { CAMERA_TILES: { get } },
    next,
  } as never);

  expect(response).toBeInstanceOf(Response);
  return { response: response as Response, get, next };
}

describe('camera generation routing', () => {
  it('passes through to the static asset when R2 is unbound', async () => {
    const staticAsset = new Response('static archive');
    const next = vi.fn(async () => staticAsset);

    const response = await onRequestGet({
      request: new Request(`https://darkroute.ai/cameras/${LOGICAL_KEY}`),
      env: {},
      next,
    } as never);

    expect(response).toBe(staticAsset);
    expect(next).toHaveBeenCalledOnce();
  });

  it('fails closed when a bound bucket has neither a pointer nor a flat index', async () => {
    /*
     * WHAT THIS ASSERTED BEFORE, AND WHY IT WAS WRONG.
     *
     * It asserted that a bound bucket with NO pointer 503s and never reads the
     * flat root - `get` called exactly once, for the pointer, and the flat key
     * left untouched.
     *
     * That was the deployed behaviour and it was the bug. No generation has
     * ever been published: a read-only inventory of the live bucket returns
     * 8,821 objects at the flat root, `pointer: none`. So this rule served 503
     * for every camera tile in production, and a fresh install drew an empty
     * map over a city full of cameras. It went unnoticed because the client
     * caches tiles, so devices that had used the app before kept working.
     *
     * The safety property behind it is KEPT, narrowed to the case it was
     * actually about: a pointer that EXISTS and is broken still fails closed
     * and still never reads the flat root, because pairing a new watermark with
     * an old snapshot is a real hazard. The two tests below cover that. An
     * ABSENT pointer is not that case - there is nothing to pair with.
     *
     * What survives here is the genuine availability failure: a bucket with no
     * pointer AND no flat index has nothing publishable in it.
     */
    const { response, next } = await request(
      new Map([[LOGICAL_KEY, object('a tile with no index to identify it')]]),
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-darkroute-camera-generation')).toBeNull();
  });

  it('reads the selected slot and identifies its generation', async () => {
    const tile = JSON.stringify({ cameras: [{ id: 'osm:2' }] });
    const selected = object(tile);
    const { response, get } = await request(
      new Map([
        [POINTER_KEY, object(POINTER)],
        [SELECTED_KEY, selected],
        [LOGICAL_KEY, object('legacy must not be read')],
      ]),
    );

    expect(get.mock.calls.map(([key]) => key)).toEqual([POINTER_KEY, SELECTED_KEY]);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(tile);
    expect(response.headers.get('etag')).toBe('"r2-etag"');
    expect(response.headers.get('x-darkroute-camera-generation')).toBe(GENERATION);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600, must-revalidate');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(response.headers.get('x-r2-meta')).toBeNull();
    expect(selected.writeHttpMetadata).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed pointer and never reads the legacy root', async () => {
    const injected = JSON.stringify({
      ...JSON.parse(POINTER),
      slot: '../../legacy',
    });
    const { response, get } = await request(
      new Map([
        [POINTER_KEY, object(injected)],
        [LOGICAL_KEY, object('legacy must not be read')],
      ]),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(get.mock.calls.map(([key]) => key)).toEqual([POINTER_KEY]);
  });

  it('fails closed when the pointer cannot be read', async () => {
    const get = vi.fn(async () => {
      throw new Error('R2 unavailable');
    });
    const response = await onRequestGet({
      request: new Request(`https://darkroute.ai/cameras/${LOGICAL_KEY}`),
      env: { CAMERA_TILES: { get } },
      next: vi.fn(),
    } as never);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
    expect(get).toHaveBeenCalledOnce();
  });

  it('returns a normal 404 when the selected generation has no object', async () => {
    const { response, get, next } = await request(new Map([[POINTER_KEY, object(POINTER)]]));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('null');
    expect(response.headers.get('x-darkroute-camera-generation')).toBe(GENERATION);
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600, must-revalidate');
    expect(get.mock.calls.map(([key]) => key)).toEqual([POINTER_KEY, SELECTED_KEY]);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    'index.json',
    'overview.json',
    'tombstones.json',
    'places.json',
    'counties.json',
    'continuity.json',
  ])(
    'fails closed when the selected generation is missing required sidecar %s',
    async (sidecar) => {
      const { response, get, next } = await request(
        new Map([[POINTER_KEY, object(POINTER)]]),
        `/cameras/${sidecar}`,
      );

      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(get.mock.calls.map(([key]) => key)).toEqual([
        POINTER_KEY,
        `__camera/slots/b/data/${sidecar}`,
      ]);
      expect(get).not.toHaveBeenCalledWith(sidecar);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each([
    '/cameras/../index.json',
    '/cameras/%2e%2e/index.json',
    '/cameras/__camera/current.json',
    '/cameras/11/2048/1.json',
    '/cameras/12/1/1.json',
    '/cameras/notes.json',
  ])('rejects a path outside the logical camera archive: %s', async (pathname) => {
    const { response, get } = await request(new Map(), pathname);

    expect(response.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });
});

/**
 * THE FLAT-ROOT FALLBACK.
 *
 * The deployed Function read every tile through `__camera/current.json`, and
 * that pointer has never been written: a read-only inventory of the live bucket
 * returns 8,821 objects at the flat root and no pointer. So every camera tile
 * answered 503 in production. It was invisible because the client caches tiles
 * in IndexedDB - an existing device kept drawing what it already had, and only
 * a FRESH INSTALL saw the empty map.
 */
function flatObject(body: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    ...object(body),
    async arrayBuffer() {
      return bytes.buffer;
    },
  };
}

/** The same bytes every time, so the per-isolate memo stays coherent. */
const FLAT_INDEX = JSON.stringify({ zoom: 11, cameras: 139934, tiles: 8802 });

describe('the flat-root fallback, for a bucket with no published generation', () => {
  it('SERVES THE TILE instead of 503, which is the whole bug', async () => {
    const { response } = await request(
      new Map([
        ['index.json', flatObject(FLAT_INDEX)],
        [LOGICAL_KEY, flatObject('{"cameras":[]}')],
      ]),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"cameras":[]}');
  });

  it('reads the FLAT key, never a slot path, when there is no pointer', async () => {
    const { get } = await request(
      new Map([
        ['index.json', flatObject(FLAT_INDEX)],
        [LOGICAL_KEY, flatObject('{"cameras":[]}')],
      ]),
    );

    const asked = get.mock.calls.map(([k]) => k);
    expect(asked).toContain(LOGICAL_KEY);
    expect(asked.some((k) => String(k).startsWith('__camera/slots/'))).toBe(false);
  });

  it('stamps a 64-hex generation, because the client refuses anything else', async () => {
    // `services/cameras/generation.ts` requires the header to be 64 hex and to
    // equal what was requested. Serving the tile with no header would draw
    // cameras and then refuse every sidecar - tiles but no county names.
    const { response } = await request(
      new Map([
        ['index.json', flatObject(FLAT_INDEX)],
        [LOGICAL_KEY, flatObject('{"cameras":[]}')],
      ]),
    );

    const stamped = response.headers.get('x-darkroute-camera-generation');
    expect(stamped).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives that generation from index.json, so it moves when the archive does', async () => {
    // Proven by reading index.json at all: a constant would not need it.
    const { get } = await request(
      new Map([
        ['index.json', flatObject(FLAT_INDEX)],
        [LOGICAL_KEY, flatObject('{"cameras":[]}')],
      ]),
    );

    expect(get.mock.calls.map(([k]) => k)).toContain('index.json');
  });

  it('PREFERS a published generation the moment one exists', async () => {
    // The fallback must delete itself on cutover rather than becoming a second
    // permanent protocol racing the first.
    const { response, get } = await request(
      new Map([
        [POINTER_KEY, flatObject(POINTER)],
        ['index.json', flatObject(FLAT_INDEX)],
        [SELECTED_KEY, flatObject('{"cameras":["slot"]}')],
      ]),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"cameras":["slot"]}');
    expect(response.headers.get('x-darkroute-camera-generation')).toBe(GENERATION);
    expect(get.mock.calls.map(([k]) => k)).toContain(SELECTED_KEY);
  });

  it('still fails closed when there is no pointer AND no flat index', async () => {
    // A bucket with nothing publishable in it is a real availability failure,
    // and is the only one left after this change.
    const { response } = await request(new Map([[LOGICAL_KEY, flatObject('{}')]]));

    expect(response.status).toBe(503);
  });

  it('answers a rural square with 404 and still stamps the generation', async () => {
    const { response } = await request(new Map([['index.json', flatObject(FLAT_INDEX)]]));

    expect(response.status).toBe(404);
    expect(response.headers.get('x-darkroute-camera-generation')).toMatch(/^[0-9a-f]{64}$/);
  });
});
