import { describe, expect, it } from 'vitest';

import { MAX_PER_HOUR, body, onRequestPost, parse } from './submit.ts';

let nextIp = 1;
function ip(): string {
  nextIp += 1;
  return `198.51.100.${String(nextIp)}`;
}

async function post(body: string, env: Record<string, string>, address: string) {
  const response = await onRequestPost({
    request: new Request('https://darkroute.ai/api/v1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': address },
      body,
    }),
    env,
  } as never);
  expect(response).toBeInstanceOf(Response);
  return response as Response;
}

describe('what a submission must look like', () => {
  it('refuses anything that is not an object', () => {
    expect(parse(null)).toEqual({ ok: false, detail: 'the submission must be a JSON object' });
    expect(parse([])).toMatchObject({ ok: false });
    expect(parse('correction')).toMatchObject({ ok: false });
  });

  it('names the kinds when the kind is missing or unknown', () => {
    const refused = parse({});
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.detail).toBe('kind must be one of: correction, new-camera, removed');
  });

  it('needs a cameraId for a correction and a position for a new camera', () => {
    expect(parse({ kind: 'correction' })).toEqual({
      ok: false,
      detail: 'a correction needs the cameraId it is correcting',
    });
    expect(parse({ kind: 'removed' })).toMatchObject({ ok: false });
    expect(parse({ kind: 'new-camera', lat: 39 })).toEqual({ ok: false, detail: 'a new camera needs lat and lon' });
  });

  it('bounds the fields that end up in a branch name or a file path', () => {
    expect(parse({ kind: 'correction', cameraId: '../etc' })).toEqual({
      ok: false,
      detail: 'cameraId may contain only letters, digits, colon, underscore and dash',
    });
    expect(parse({ kind: 'new-camera', lat: 100, lon: 0 })).toEqual({ ok: false, detail: 'lat must be within -85..85' });
    expect(parse({ kind: 'new-camera', lat: 0, lon: 181 })).toEqual({ ok: false, detail: 'lon must be within -180..180' });
    expect(parse({ kind: 'correction', cameraId: 'osm:1', field: 'colour' })).toMatchObject({ ok: false });
    expect(parse({ kind: 'correction', cameraId: 'osm:1', photoKey: 'x.jpg' })).toEqual({
      ok: false,
      detail: 'photoKey is not a key this service issued',
    });
  });

  it('accepts the shape the app sends, trimmed and bounded', () => {
    const parsed = parse({
      kind: 'correction',
      cameraId: 'osm:12345',
      lat: null,
      lon: null,
      field: 'brand',
      wrong: '  Motorola ',
      right: 'Flock',
      note: 'n'.repeat(700),
      photoKey: `${'a'.repeat(32)}.jpg`,
      contact: null,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({
        kind: 'correction',
        cameraId: 'osm:12345',
        lat: null,
        lon: null,
        field: 'brand',
        wrong: 'Motorola',
        right: 'Flock',
        note: 'n'.repeat(600),
        photoKey: `${'a'.repeat(32)}.jpg`,
        contact: null,
        archive: null,
      });
    }
  });
});

describe('the handler, before it reaches GitHub', () => {
  it('says plainly when no token is configured, and stores nothing', async () => {
    const response = await post('{}', {}, ip());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ error: 'submissions_unconfigured' });
  });

  it('refuses a body that is not JSON', async () => {
    const response = await post('notjson', { SUBMISSIONS_TOKEN: 'test-token' }, ip());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'bad_json' });
  });

  it('refuses a JSON body that is not a submission, naming the field', async () => {
    const response = await post('{"kind":"correction"}', { SUBMISSIONS_TOKEN: 'test-token' }, ip());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'bad_submission',
      detail: 'a correction needs the cameraId it is correcting',
    });
  });

  it(`answers the ${String(MAX_PER_HOUR + 1)}th submission in an hour with 429 AND a retry-after header`, async () => {
    const address = ip();
    const env = { SUBMISSIONS_TOKEN: 'test-token' };
    // Each one is refused as bad JSON, after the limiter has counted it -
    // so none of them can reach GitHub and every one spends a token.
    for (let i = 0; i < MAX_PER_HOUR; i += 1) {
      expect((await post('notjson', env, address)).status).toBe(400);
    }
    const response = await post('notjson', env, address);
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    const body = (await response.json()) as { error: string; retryAfterSeconds: number };
    expect(body.error).toBe('rate_limited');
    expect(body.retryAfterSeconds).toBe(retryAfter);
  });
});

describe('the archive snapshot', () => {
  it('keeps short string fields under sane keys and prints them in the review', () => {
    const parsed = parse({
      kind: 'correction',
      cameraId: 'osm:1',
      field: 'other',
      note: 'the pole is on the other corner',
      archive: {
        street: 'Metcalf Ave',
        cross: 'W 108th St',
        locality: 'Overland Park',
        'camera:mount': 'pole',
        'Bad Key': 'dropped',
        nested: { not: 'a string' },
        empty: '   ',
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.archive).toEqual({
      street: 'Metcalf Ave',
      cross: 'W 108th St',
      locality: 'Overland Park',
      'camera:mount': 'pole',
    });
    const rendered = body(parsed.value, '2026-09-09T19:00:00.000Z', null);
    expect(rendered).toContain('### The archive record, as the app showed it');
    expect(rendered).toContain('- **street:** Metcalf Ave');
    expect(rendered).toContain('- **locality:** Overland Park');
  });
  it('is null when nothing usable was sent', () => {
    const parsed = parse({ kind: 'correction', cameraId: 'osm:1', field: 'other', archive: 'nope' });
    expect(parsed.ok && parsed.value.archive).toBeNull();
  });
});
