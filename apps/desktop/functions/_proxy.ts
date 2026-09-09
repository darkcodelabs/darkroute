/**
 * api.darkroute.ai -> THE REAL API.
 *
 * =============================================================================
 * WHY THIS EXISTS AT ALL
 * =============================================================================
 * The console is served from `api.darkroute.ai`, and the endpoints it browses
 * live at `darkroute.ai/api/v1/*` - same origin as the app, because the camera
 * route they read through is the app's own.
 *
 * Without this file that hostname is a lie in the worst available way. A
 * developer doing the obvious thing:
 *
 *   curl https://api.darkroute.ai/v1/cameras?bbox=...
 *   curl https://api.darkroute.ai/api/v1/cameras?bbox=...
 *
 * would get the console's HTML with a 200. Not a 404 they could act on - a
 * SUCCESS carrying the wrong body. This codebase has shipped that failure
 * twice: camera tiles answering 503 behind a green deploy, and `/api/report`
 * looking like it accepted reports because the SPA fallback returned 200 to
 * everything. It is the single most expensive shape of bug here, and putting a
 * hostname called `api` in front of a single-page app manufactures it.
 *
 * So the name is made true instead of the expectation being managed. Two
 * spellings are served, because both are what people type: `/v1/*` (the host
 * already says `api`) and `/api/v1/*` (the path the OpenAPI document lists, so
 * the same spec is valid against either host). `v1/[[path]].ts` and
 * `api/v1/[[path]].ts` are one-line routes onto this file.
 *
 * =============================================================================
 * A PROXY, NOT A SECOND IMPLEMENTATION
 * =============================================================================
 * It forwards. It does not re-implement a single endpoint, re-derive a single
 * cap, or cache anything of its own. `darkroute.ai/api/v1` stays canonical -
 * two implementations of a rate limit is how one of them quietly stops
 * applying, and a caps check that exists twice is a caps check that will
 * disagree with itself.
 *
 * The upstream's own headers come back untouched, including the rate-limit
 * ones, so a caller here sees the same budget as a caller anywhere else.
 *
 * =============================================================================
 * WHAT IS FORWARDED, AND WHY THE BODY IS
 * =============================================================================
 * The first version of this forwarded `accept` and the caller's address and
 * nothing else - no body, no `content-type`. Reads worked, which is what got
 * tested. Writes did not: `POST /v1/submit` with a JSON body reached the
 * upstream as an empty POST and was refused as `bad_json`; `PUT /v1/photo`
 * with an image arrived as "got nothing" and was 415. A proxy that forwards
 * half a request is a second implementation after all - of the failure.
 *
 * So for a method that carries a body, the body streams through with its
 * `content-type` and `content-length`. Nothing else the caller sent is
 * forwarded: not cookies (the API has none), not `origin` (the API answers
 * `*` regardless), not `x-forwarded-for` (which `CF-Connecting-IP` exists to
 * make irrelevant).
 */

const UPSTREAM = 'https://darkroute.ai';

/** Methods whose request has a body worth forwarding. */
const CARRIES_BODY = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Forward one request to `targetPath` on the canonical origin and hand the
 * answer back with two headers added.
 */
export async function proxy(request: Request, targetPath: string): Promise<Response> {
  const target = new URL(targetPath, UPSTREAM);

  const headers: Record<string, string> = {
    accept: request.headers.get('accept') ?? 'application/json',
    /*
     * The caller's address, forwarded so the upstream rate limiter buckets
     * the real client rather than this Worker. Without it every request
     * through this hostname shares one bucket and the first busy caller
     * throttles everyone else.
     */
    'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') ?? '',
  };

  const init: RequestInit = { method: request.method, headers, redirect: 'manual' };

  if (CARRIES_BODY.has(request.method)) {
    for (const name of ['content-type', 'content-length'] as const) {
      const value = request.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    init.body = request.body;
  }

  const upstream = await fetch(target.toString(), init);

  // Headers copied onto a new response: an upstream response can carry
  // immutable headers, and mutating those throws at runtime.
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('access-control-allow-origin', '*');
  /* Says where the answer actually came from, so somebody debugging a
     surprising response can go straight to the canonical origin. */
  responseHeaders.set('x-darkroute-upstream', target.origin);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
