/**
 * THE PUBLIC API'S FRONT DOOR: THROTTLING, CORS, AND HONEST ERRORS.
 *
 * =============================================================================
 * WHY THERE IS A PUBLIC API AT ALL
 * =============================================================================
 * The archive is ODbL data about public infrastructure. Locking it inside one
 * phone app would be a worse version of the thing this project objects to -
 * somebody deciding on your behalf what you may know about your own street.
 * Researchers, journalists and local groups need a way in that is not "install
 * a PWA and squint at a map".
 *
 * =============================================================================
 * WHY THROTTLING IS A CORRECTNESS PROBLEM, NOT A COST ONE
 * =============================================================================
 * People will try. That is not cynicism, it is the operating assumption: a
 * public endpoint over surveillance data attracts both scrapers who want the
 * whole archive in one afternoon and people who would like it to fall over.
 *
 * There are THREE separate defences here and they do different jobs. Only the
 * first is in this file, and it is the weakest of the three - saying so
 * plainly, because a limiter you overestimate is worse than one you know the
 * shape of:
 *
 *   1. THIS FILE - a per-isolate token bucket. Cloudflare runs many isolates,
 *      so a determined caller spread across colos gets more than the printed
 *      budget. It is a SPEED BUMP that makes casual hammering pointless and
 *      keeps one loop from one machine off the origin. It is not a guarantee
 *      and must never be described as one.
 *
 *   2. THE EDGE - a zone-level Cloudflare rate limiting rule, enforced before
 *      a request reaches any of this code. That is the real ceiling, and it is
 *      the only layer that sees a caller's whole traffic rather than one
 *      isolate's slice.
 *
 *   3. THE HANDLERS - hard caps on what a SINGLE request may ask for: bounded
 *      area, bounded row count, bounded tile fan-out. This is the one that
 *      actually protects the archive, because it converts "download everything
 *      in one request" into "make thousands of requests", which is precisely
 *      the shape layers 1 and 2 are good at catching.
 *
 * A limiter without caps is a door with a queue outside it and no lock.
 *
 * =============================================================================
 * WHAT A THROTTLED CALLER IS TOLD
 * =============================================================================
 * 429 with `Retry-After` and a JSON body saying which limit was hit and when
 * it resets. A rate limiter that returns an opaque error teaches callers to
 * retry immediately, which is the opposite of what it wants.
 */

import { acceptsMethod, allowHeader, notFoundBody, routeFor } from './_routes.ts';

interface Env {
  readonly CAMERA_TILES?: R2Bucket;
}

/**
 * The budget, per client, per window, PER ISOLATE.
 *
 * Sized for the honest cases and against the dishonest one. A researcher
 * walking a metro area at a tile at a time, or a docs console where somebody is
 * pressing Send and reading the answer, stays far under it. Something pulling
 * a national sweep as fast as it can does not.
 */
const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 60;

/**
 * How many distinct clients one isolate will track.
 *
 * An unbounded map keyed on caller-controlled input is a memory-exhaustion bug
 * wearing a rate limiter's clothes: a caller spoofing a new key per request
 * would grow it without limit. At the cap the oldest entries are dropped, which
 * degrades toward "not limited" rather than toward "out of memory" - the right
 * direction for a defence layer that is explicitly not the real ceiling.
 */
const MAX_TRACKED_CLIENTS = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * WHO IS ASKING.
 *
 * `CF-Connecting-IP` is set by Cloudflare's edge and cannot be forged by the
 * client - unlike `X-Forwarded-For`, which is caller-supplied and would let
 * anyone mint a fresh budget per request by changing a header. Falling back to
 * a single shared key rather than to a per-request one is deliberate: if the
 * real address is somehow unavailable, everybody shares one bucket, which fails
 * toward throttling rather than toward an unlimited free pass.
 */
function clientKey(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP');
  return typeof ip === 'string' && ip !== '' ? ip : 'unknown';
}

interface Decision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
}

function take(key: string, now: number): Decision {
  const existing = buckets.get(key);

  if (existing === undefined || now >= existing.resetAt) {
    if (buckets.size >= MAX_TRACKED_CLIENTS) {
      // Map iteration is insertion-ordered, so the first key is the oldest.
      const oldest = buckets.keys().next();
      if (!oldest.done) buckets.delete(oldest.value);
    }
    const fresh: Bucket = { count: 1, resetAt: now + WINDOW_MS };
    buckets.set(key, fresh);
    return { allowed: true, remaining: REQUESTS_PER_WINDOW - 1, resetAt: fresh.resetAt };
  }

  if (existing.count >= REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: REQUESTS_PER_WINDOW - existing.count,
    resetAt: existing.resetAt,
  };
}

/**
 * CORS, wide open on purpose.
 *
 * This is public, openly licensed data about public infrastructure. Restricting
 * which web page may read it would inconvenience exactly the people the API is
 * for and would stop nobody - `curl` does not send an `Origin`. The limits that
 * matter are the rate limit and the per-request caps, both of which apply
 * identically whoever asks.
 *
 * No credentials are ever accepted, so there is no cookie or token for a hostile
 * page to ride. `Access-Control-Allow-Credentials` is deliberately absent.
 *
 * POST and PUT are listed because `/submit` and `/photo` take them. This said
 * `GET, OPTIONS` after those routes shipped, so a browser on any other origin
 * failed the preflight for a write the server would have accepted - the
 * same-origin app never noticed, which is exactly how a CORS list goes stale.
 */
const CORS: Readonly<Record<string, string>> = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
});

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...CORS } });
  }

  const path = new URL(request.url).pathname;

  /*
   * HEAD, ANSWERED FROM A GET.
   *
   * Every handler here exports `onRequestGet` and nothing else, and Pages
   * routes strictly by method: a HEAD matched no handler, fell through this
   * middleware to the static layer, and came back as the single-page app -
   * `HEAD /api/v1/stats` was `200 text/html` while `allow:` advertised HEAD.
   *
   * So a HEAD is turned into a same-origin GET for the same URL and its
   * headers are returned with no body, which is what HEAD means. The GET goes
   * back through this middleware, so it is rate-limited and CORS-stamped
   * exactly once - the HEAD itself is not counted, or one request would cost
   * two tokens. `content-length` is dropped because it described a body this
   * response does not carry, and a wrong one is worse than none.
   */
  if (request.method === 'HEAD') {
    const probe = await fetch(request.url, {
      method: 'GET',
      headers: {
        accept: request.headers.get('accept') ?? 'application/json',
        'CF-Connecting-IP': clientKey(request),
      },
    });
    const headers = new Headers(probe.headers);
    headers.delete('content-length');
    return new Response(null, { status: probe.status, statusText: probe.statusText, headers });
  }

  /*
   * READ-ONLY EXCEPT WHERE A ROUTE EXISTS TO ACCEPT SOMETHING.
   *
   * The archive itself takes no writes and never will: its provenance chain is
   * what makes it worth reading, and an endpoint that accepted anonymous edits
   * would be a way to put unattributed claims into it.
   *
   * Two routes are different in kind and neither writes to the archive.
   * `/submit` opens a PULL REQUEST - a public, reviewable proposal that a human
   * merges or does not - and `/photo` stores an image that a proposal refers
   * to. Both leave the published data untouched.
   *
   * The methods each path takes come from `_routes.ts`, the same table the
   * OpenAPI document is tested against. This guard used to be an inline
   * allowlist that named `/api/v1/photo/` with a trailing slash while the
   * client PUT to `/api/v1/photo` without one, and every photo upload the app
   * shipped was answered 405. A list that lives in one place cannot drift from
   * the spec in another.
   */
  if (!acceptsMethod(path, request.method)) {
    if (routeFor(path) === undefined) {
      /*
       * Not a route at all. A 404 here, before the handler chain, so a PUT to
       * a typo is told the path is wrong rather than that the method is - the
       * `allow` header on a 405 would name methods for a path that does not
       * exist.
       */
      return json(404, notFoundBody(path));
    }
    return json(
      405,
      {
        error: 'method_not_allowed',
        detail:
          `${path} does not take ${request.method}. the archive is read-only: corrections go to ` +
          'POST /api/v1/submit, which opens a pull request rather than writing to the data.',
      },
      { allow: allowHeader(path) },
    );
  }

  const now = Date.now();
  const decision = take(clientKey(request), now);
  const resetSeconds = Math.max(1, Math.ceil((decision.resetAt - now) / 1000));

  const limitHeaders: Record<string, string> = {
    'ratelimit-limit': String(REQUESTS_PER_WINDOW),
    'ratelimit-remaining': String(decision.remaining),
    'ratelimit-reset': String(resetSeconds),
  };

  if (!decision.allowed) {
    return json(
      429,
      {
        error: 'rate_limited',
        detail:
          `this API allows ${String(REQUESTS_PER_WINDOW)} requests per minute per address. ` +
          'the archive is published in full as a downloadable dataset - if you need bulk ' +
          'access, take that instead of paging this endpoint.',
        retryAfterSeconds: resetSeconds,
      },
      { ...limitHeaders, 'retry-after': String(resetSeconds) },
    );
  }

  const response = await context.next();

  /*
   * Headers are copied onto a NEW response rather than mutated in place: a
   * response returned from a static asset or a cached subrequest can carry
   * immutable headers, and mutating those throws at runtime - a failure that
   * only shows up once something downstream starts caching.
   */
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries({ ...CORS, ...limitHeaders })) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/** A JSON response with the shape every error in this API uses. */
export function json(
  status: number,
  body: unknown,
  extra: Readonly<Record<string, string>> = {},
): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=300' : 'no-store',
      ...extra,
    },
  });
}
