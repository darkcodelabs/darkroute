/**
 * The two rules this service exists to hold:
 *   1. A photograph that has not been re-encoded never leaves the device.
 *   2. Nothing is sent except by a direct call — there is no queue, no timer.
 */

import { describe, expect, it } from 'vitest';

import { ShareRefused, shareCorrection } from './shareCorrection.ts';

function respond(bodies: readonly { status: number; body: unknown }[]): typeof fetch {
  let n = 0;
  return (async () => {
    // Narrowed rather than asserted: the strict config makes an index
    // `T | undefined`, and a test helper that lies about that hides the
    // failure mode it is meant to exercise.
    const next = bodies[Math.min(n++, bodies.length - 1)] ?? { status: 500, body: null };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => Promise.resolve(next.body),
    } as unknown as Response;
  }) as typeof fetch;
}

const PR = { status: 200, body: { ok: true, url: 'https://github.com/x/y/pull/9', duplicate: false } };

describe('a correction', () => {
  it('opens a pull request and returns it as the receipt', async () => {
    const result = await shareCorrection(
      { kind: 'correction', cameraId: 'osm:1', field: 'brand', wrong: 'Flock', right: 'Motorola' },
      respond([PR]),
    );
    expect(result.url).toBe('https://github.com/x/y/pull/9');
    expect(result.duplicate).toBe(false);
  });

  it('sends exactly the fields the API takes, and nulls the rest', async () => {
    const seen: string[] = [];
    const spy = (async (_url: string, init?: RequestInit) => {
      seen.push(String(init?.body ?? ''));
      return { ok: true, status: 200, json: async () => Promise.resolve(PR.body) } as unknown as Response;
    }) as unknown as typeof fetch;
    await shareCorrection({ kind: 'correction', cameraId: 'osm:1' }, spy);
    const sent = JSON.parse(seen[0] ?? '{}') as Record<string, unknown>;
    expect(sent['kind']).toBe('correction');
    expect(sent['cameraId']).toBe('osm:1');
    expect(sent['photoKey']).toBeNull();
    expect(sent['lat']).toBeNull();
  });

  it('reports a duplicate as a duplicate rather than a second success', async () => {
    const result = await shareCorrection(
      { kind: 'correction', cameraId: 'osm:1' },
      respond([{ status: 200, body: { ok: true, url: 'https://x/pull/9', duplicate: true } }]),
    );
    expect(result.duplicate).toBe(true);
  });

  it("carries the server's own explanation, not a generic failure", async () => {
    await expect(
      shareCorrection(
        { kind: 'correction', cameraId: 'osm:1' },
        respond([{ status: 400, body: { error: 'bad_submission', detail: 'a correction needs the cameraId it is correcting' } }]),
      ),
    ).rejects.toMatchObject({
      code: 'bad_submission',
      message: 'a correction needs the cameraId it is correcting',
    });
  });
});

describe('a photograph', () => {
  it('is uploaded first and referenced by the key the store issued', async () => {
    const calls: string[] = [];
    const spy = (async (url: string) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () =>
          Promise.resolve(
            String(url).includes('/photo') ? { key: 'abc.jpg' } : { ok: true, url: 'https://x/pull/9' },
          ),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await shareCorrection(
      {
        kind: 'correction',
        cameraId: 'osm:1',
        photo: { bytes: new Blob(['x'], { type: 'image/jpeg' }), metadataStripped: true },
      },
      spy,
    );
    expect(calls[0]).toContain('/api/v1/photo');
    expect(calls[1]).toContain('/api/v1/submit');
  });

  /*
   * THE RULE THIS FILE EXISTS FOR. A phone photograph carries the driver's
   * exact position in its EXIF. Sending one from a product about not being
   * tracked would be the worst bug available, so an unstripped attachment is
   * refused here rather than trusted to have been handled upstream.
   */
  it('is REFUSED when it has not been re-encoded, and nothing is sent', async () => {
    let called = 0;
    const spy = (async () => {
      called += 1;
      return { ok: true, status: 200, json: async () => Promise.resolve({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(
      shareCorrection(
        {
          kind: 'correction',
          cameraId: 'osm:1',
          photo: {
            bytes: new Blob(['x'], { type: 'image/jpeg' }),
            metadataStripped: false as unknown as true,
          },
        },
        spy,
      ),
    ).rejects.toBeInstanceOf(ShareRefused);
    expect(called).toBe(0);
  });
});
