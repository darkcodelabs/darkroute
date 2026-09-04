import { describe, expect, it, vi } from 'vitest';

import { generationBoundUrl, readCameraGeneration } from './generation.ts';

const GENERATION = 'b'.repeat(64);

describe('camera generation identity', () => {
  it('binds a valid served index to its immutable response header', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            zoom: 11,
            cameras: 132_470,
            tiles: 8_605,
            upstream: '2026-09-02T10:00:00Z',
          }),
          { headers: { 'x-darkroute-camera-generation': GENERATION } },
        ),
    ) as unknown as typeof fetch;

    await expect(
      readCameraGeneration({ fetchImpl, base: '/cameras', cacheKey: '123-0' }),
    ).resolves.toEqual({
      generation: GENERATION,
      cameras: 132_470,
      tiles: 8_605,
      upstream: '2026-09-02T10:00:00Z',
    });
    expect(fetchImpl).toHaveBeenCalledWith('/cameras/index.json?camera-generation=123-0', {
      redirect: 'manual',
      cache: 'no-store',
    });
  });

  it('rejects malformed index metadata even with a valid-looking header', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ cameras: 132_470 }), {
          headers: { 'x-darkroute-camera-generation': GENERATION },
        }),
    ) as unknown as typeof fetch;
    await expect(
      readCameraGeneration({ fetchImpl, base: '/cameras', cacheKey: 'x' }),
    ).rejects.toThrow(/invalid index body/);
  });

  it('puts the generation, and no location, in an immutable tile URL', () => {
    expect(generationBoundUrl('/cameras', '11/484/783.json', GENERATION)).toBe(
      `/cameras/11/484/783.json?generation=${GENERATION}`,
    );
  });
});
