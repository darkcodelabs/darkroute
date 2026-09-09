/**
 * ARCHIVE RESOLUTION - that a bad network never costs the driver the map.
 *
 * The corruption this scheme prevents is silent (see `manifest.ts`), so the
 * tests have to be about the DEGRADED paths: what happens when the manifest is
 * missing, slow, malformed, or the device is offline. Every one of those must
 * still yield a real archive.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  LAST_ARCHIVE_KEY,
  isPermittedArchive,
  manifestUrlFor,
  parseManifest,
  resolveArchiveUrl,
} from './manifest.ts';

const CURRENT = 'https://tiles.darkroute.ai/basemap-us-20260821.pmtiles';
const BUILT_IN = 'https://tiles.darkroute.ai/basemap-us-20260101.pmtiles';
const REMEMBERED = 'https://tiles.darkroute.ai/basemap-us-20260715.pmtiles';

function store(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    read: (k: string) => map.get(k) ?? null,
  };
}

/**
 * Manifest, then a successful range read.
 *
 * Resolution now PROBES the archive before trusting a pointer at it, so a stub
 * that only answers the manifest would make every happy-path test look like the
 * poisoning case.
 */
function ok(body: unknown): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    return call === 1
      ? new Response(JSON.stringify(body), { status: 200 })
      : new Response('', { status: 206 });
  }) as unknown as typeof fetch;
}

describe('parseManifest refuses anything that is not a usable pointer', () => {
  it('takes a well-formed manifest', () => {
    expect(parseManifest({ url: CURRENT, built: '2026-08-21', osm: '2026-08-20' })).toEqual({
      url: CURRENT,
      built: '2026-08-21',
      osm: '2026-08-20',
    });
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['no url', { built: '2026-08-21' }],
    ['an empty url', { url: '   ' }],
    ['a non-string url', { url: 42 }],
    ['a url that names no archive', { url: 'https://tiles.darkroute.ai/oops' }],
    ['rubbish that would resolve as a relative path', { url: 'not a url' }],
  ])('refuses %s', (_label, body) => {
    expect(parseManifest(body)).toBeNull();
  });
});

describe('resolveArchiveUrl prefers the manifest', () => {
  it('uses the current archive and remembers it', async () => {
    const storage = store();
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl: ok({ url: CURRENT }),
      storage,
    });
    expect(url).toBe(CURRENT);
    // Remembered so the NEXT launch, possibly offline, asks for the same file
    // it already has bytes of.
    expect(storage.read(LAST_ARCHIVE_KEY)).toBe(CURRENT);
  });

  it('asks the TILES host for the manifest, not the app origin', async () => {
    // The archive lifecycle belongs to the bucket. Asking the app's own origin
    // would mean shipping an app deploy to point at a newer map -- and would
    // appear to work in dev, where the server answers every path with the SPA.
    const fetchImpl = ok({ url: CURRENT });
    await resolveArchiveUrl({ fallbackUrl: BUILT_IN, fetchImpl, storage: store() });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://tiles.darkroute.ai/basemap.json',
      expect.anything(),
    );
  });

  it('derives the manifest URL from the archive it was given', () => {
    expect(manifestUrlFor('https://tiles.darkroute.ai/basemap-us-20260820.pmtiles')).toBe(
      'https://tiles.darkroute.ai/basemap.json',
    );
    expect(manifestUrlFor('http://localhost:8790/kc.pmtiles')).toBe(
      'http://localhost:8790/basemap.json',
    );
    // A relative archive is a local test build; the app origin serves it.
    expect(manifestUrlFor('/local.pmtiles')).toBe('/basemap.json');
    expect(manifestUrlFor(null)).toBeNull();
  });
});

describe('a broken manifest never costs the driver the map', () => {
  it('falls back to the remembered archive when offline', async () => {
    // THE CASE THAT MATTERS. A device that has been running for months holds
    // cached bytes of `REMEMBERED`; sending it to the built-in URL instead
    // would throw all of them away at the exact moment it has no network.
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl: vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      storage: store({ [LAST_ARCHIVE_KEY]: REMEMBERED }),
    });
    expect(url).toBe(REMEMBERED);
  });

  it('falls back to the built-in URL on a first run with no network', async () => {
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl: vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      storage: store(),
    });
    expect(url).toBe(BUILT_IN);
  });

  it('ignores a 404 manifest', async () => {
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl: vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch,
      storage: store({ [LAST_ARCHIVE_KEY]: REMEMBERED }),
    });
    expect(url).toBe(REMEMBERED);
  });

  it('ignores a manifest that parses but names nothing', async () => {
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl: ok({ built: '2026-08-21' }),
      storage: store(),
    });
    expect(url).toBe(BUILT_IN);
  });

  it('gives up on a slow manifest rather than holding up the map', async () => {
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      timeoutMs: 10,
      fetchImpl: ((_input: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        })) as unknown as typeof fetch,
      storage: store(),
    });
    expect(url).toBe(BUILT_IN);
  });

  it('survives a storage that throws, which private mode does', async () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl: ok({ url: CURRENT }),
      storage: hostile,
    });
    expect(url).toBe(CURRENT);
  });

  it('returns null when there is no fallback either, rather than inventing one', async () => {
    const url = await resolveArchiveUrl({
      fallbackUrl: null,
      fetchImpl: vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      storage: store(),
    });
    expect(url).toBeNull();
  });
});

describe('a manifest may say WHICH archive, never WHOSE', () => {
  it('refuses an archive on a different origin and keeps the fallback', async () => {
    // The rule the whole design rests on is self-hosted tiles or no basemap.
    // Without this, a wrong R2_PUBLIC_BASE or a compromised bucket would send
    // every driver's tile requests to a third party, silently.
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl: ok({ url: 'https://someone-else.example/basemap.pmtiles' }),
      storage: store(),
    });
    expect(url).toBe(BUILT_IN);
  });

  it('accepts a relative archive path, which stays on the same origin', async () => {
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl: ok({ url: '/basemap-us-20260820.pmtiles' }),
      storage: store(),
    });
    expect(url).toBe('/basemap-us-20260820.pmtiles');
  });

  it('judges permission by origin, not by string prefix', () => {
    expect(
      isPermittedArchive(
        'https://tiles.darkroute.ai/a.pmtiles',
        'https://tiles.darkroute.ai/basemap.json',
      ),
    ).toBe(true);
    // A host that merely STARTS with ours is a different host.
    expect(
      isPermittedArchive(
        'https://tiles.darkroute.ai.evil.example/a.pmtiles',
        'https://tiles.darkroute.ai/basemap.json',
      ),
    ).toBe(false);
    // A bare string resolves as a RELATIVE PATH on the manifest's origin, so
    // it is permitted here by design; `parseManifest` is what rejects it for
    // not naming an archive. Asserting the real behaviour, not the assumed one.
    expect(isPermittedArchive('some/path.pmtiles', 'https://tiles.darkroute.ai/basemap.json')).toBe(
      true,
    );
  });
});

describe('the three defects an adversarial audit found', () => {
  it('RESOLVES A MANIFEST WHEN THE FALLBACK IS RELATIVE', async () => {
    // Was inert. A relative fallback yields a relative `/basemap.json`, and
    // `new URL(x, '/basemap.json')` throws -- so every manifest was rejected
    // and archive resolution could never be exercised locally, which is the one
    // environment where you would notice it misbehaving.
    const url = await resolveArchiveUrl({
      fallbackUrl: '/local.pmtiles',
      fetchImpl: okThenRange({ url: '/basemap-us-20260820.pmtiles' }),
      storage: store(),
    });
    expect(url).toBe('/basemap-us-20260820.pmtiles');
  });

  it('REFUSES A MANIFEST NAMING AN ARCHIVE THAT IS NOT THERE', async () => {
    // One bad publish used to poison every device that fetched it: the URL is
    // well-formed and same-origin, it simply 404s, and it was remembered and
    // then outranked the known-good fallback forever.
    const storage = store();
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl: manifestThenMissing({ url: 'https://tiles.darkroute.ai/GONE.pmtiles' }),
      storage,
    });
    expect(url).toBe(BUILT_IN);
    expect(storage.read(LAST_ARCHIVE_KEY)).toBeNull();
  });

  it('REFUSES A .PMTILES SUFFIX IN THE WRONG CASE', () => {
    // `isPmtiles` matches case-sensitively, so accepting this would mean the
    // protocol handler is never registered while the style still says
    // `pmtiles://` -- accepted, remembered, and a dead map.
    expect(parseManifest({ url: 'https://tiles.darkroute.ai/X.PMTILES' })).toBeNull();
    expect(parseManifest({ url: 'https://tiles.darkroute.ai/x.pmtiles' })).not.toBeNull();
  });

  it('does not re-probe an archive it is already using', async () => {
    // The steady state must cost nothing: same URL as remembered, no range read.
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ url: CURRENT }), { status: 200 }),
    ) as unknown as typeof fetch;
    const url = await resolveArchiveUrl({
      fallbackUrl: BUILT_IN,
      fetchImpl,
      storage: store({ [LAST_ARCHIVE_KEY]: CURRENT }),
    });
    expect(url).toBe(CURRENT);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/** Manifest first, then a successful range read of the archive. */
function okThenRange(body: unknown): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    return call === 1
      ? new Response(JSON.stringify(body), { status: 200 })
      : new Response('', { status: 206 });
  }) as unknown as typeof fetch;
}

/** Manifest first, then a 404 for the archive it names. */
function manifestThenMissing(body: unknown): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    return call === 1
      ? new Response(JSON.stringify(body), { status: 200 })
      : new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}
