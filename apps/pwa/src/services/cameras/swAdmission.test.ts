/**
 * WHAT THE WORKER KEEPS, ASKED AS A QUESTION ABOUT A REAL RESPONSE.
 *
 * The service-worker policy was previously asserted by grepping
 * `vite.config.ts` for the regexes it contains, which cannot tell a rule that
 * works from a rule that is merely present. These are the functions Workbox
 * serialises into `dist/sw.js`, called with real `URL`, `Request` and
 * `Response` objects.
 *
 * The rule they enforce is the client's own: bytes may only be stored under the
 * generation they claim. A cache that broke it would be worse than no cache,
 * because a mismatched body stored under a generation-keyed URL passes the
 * CLIENT's header check for ever after - the response coming back out of the
 * cache carries the header it was stored with.
 */

import { describe, expect, it } from 'vitest';

import { admitGenerationBoundResponse, isCameraSidecarRequest } from './swAdmission.ts';

const G1 = 'a'.repeat(64);
const G2 = 'b'.repeat(64);

/** The worker's own origin, which is the only one these routes may match. */
const ORIGIN = self.location.origin;

function sidecarUrl(file: string, generation: string | null): URL {
  const url = new URL(`/cameras/${file}`, ORIGIN);
  if (generation !== null) url.searchParams.set('generation', generation);
  return url;
}

function served(generation: string | null, status = 200): Response {
  return new Response('{"rows":[]}', {
    status,
    ...(generation === null ? {} : { headers: { 'x-darkroute-camera-generation': generation } }),
  });
}

describe('which requests the sidecar route claims', () => {
  it('claims all three files that describe the archive, generation key and all', () => {
    for (const file of ['overview.json', 'counties.json', 'places.json']) {
      expect(isCameraSidecarRequest({ url: sidecarUrl(file, G1) })).toBe(true);
      // Before the generation protocol reached them these were fetched
      // unversioned. The route has to claim that shape too, or an old client
      // on a new worker goes uncached.
      expect(isCameraSidecarRequest({ url: sidecarUrl(file, null) })).toBe(true);
    }
  });

  it('leaves the z11 tiles to the tile route and the index to the identity route', () => {
    // Three routes, three policies. Overlapping them would mean tiles landing
    // in a six-entry cache, or the pointer read answered stale.
    expect(isCameraSidecarRequest({ url: sidecarUrl('11/484/783.json', G1) })).toBe(false);
    expect(isCameraSidecarRequest({ url: sidecarUrl('index.json', G1) })).toBe(false);
  });

  it('refuses another origin serving a file with the same name', () => {
    const foreign = new URL('/cameras/counties.json', 'https://not-darkroute.example');
    expect(isCameraSidecarRequest({ url: foreign })).toBe(false);
  });

  it('refuses a path that merely contains a sidecar name', () => {
    expect(isCameraSidecarRequest({ url: sidecarUrl('sub/overview.json', G1) })).toBe(false);
    expect(isCameraSidecarRequest({ url: new URL('/records/counties.json', ORIGIN) })).toBe(false);
  });
});

describe('what the worker is allowed to store', () => {
  it('keeps a 200 whose header is the generation the URL asked for', async () => {
    const response = served(G1);
    await expect(
      admitGenerationBoundResponse({
        request: new Request(sidecarUrl('counties.json', G1)),
        response,
      }),
    ).resolves.toBe(response);
  });

  it('refuses a body from another generation, however healthy it looks', async () => {
    // THE RACE THIS EXISTS FOR: the pointer moved between the request leaving
    // and the response arriving. The body is perfectly coherent -- with G2 --
    // which is exactly why it may not be stored under the G1 URL. Stored, it
    // would answer every later G1 read with G2 bytes carrying a G2 header, and
    // the client's own check would wave it through.
    await expect(
      admitGenerationBoundResponse({
        request: new Request(sidecarUrl('overview.json', G1)),
        response: served(G2),
      }),
    ).resolves.toBeNull();
  });

  it('refuses a response with no generation header at all', async () => {
    // A static-asset origin, or a deploy without the camera Function. Nothing
    // about those bytes can be tied to a snapshot, so nothing may be kept as
    // one -- and the app degrades to "unknown" rather than to a wrong name.
    await expect(
      admitGenerationBoundResponse({
        request: new Request(sidecarUrl('places.json', G1)),
        response: served(null),
      }),
    ).resolves.toBeNull();
  });

  it('refuses an unversioned request even when the response names a generation', async () => {
    // The route claims these URLs so they are still SERVED from the network;
    // it must not STORE them, because no later generation could invalidate an
    // entry that carries no generation in its key.
    await expect(
      admitGenerationBoundResponse({
        request: new Request(sidecarUrl('counties.json', null)),
        response: served(G1),
      }),
    ).resolves.toBeNull();
  });

  it('refuses a malformed generation key', async () => {
    await expect(
      admitGenerationBoundResponse({
        request: new Request(sidecarUrl('counties.json', 'not-a-digest')),
        response: served('not-a-digest'),
      }),
    ).resolves.toBeNull();
  });

  it('refuses every non-200, including the 503 a damaged generation answers with', async () => {
    // `functions/cameras/[[path]].ts` answers a missing sidecar with 503
    // precisely so a damaged generation cannot read as an empty catalogue.
    // Caching that for a week would make it one.
    for (const status of [404, 500, 503]) {
      await expect(
        admitGenerationBoundResponse({
          request: new Request(sidecarUrl('overview.json', G1)),
          response: served(G1, status),
        }),
      ).resolves.toBeNull();
    }
  });

  it('refuses an Access redirect, which arrives as status 0', async () => {
    // An expired Cloudflare Access session answers with a redirect. Stored
    // under a camera URL, that is a sign-in page served as the archive.
    const bounce = Response.error();
    await expect(
      admitGenerationBoundResponse({
        request: new Request(sidecarUrl('overview.json', G1)),
        response: bounce,
      }),
    ).resolves.toBeNull();
  });
});
