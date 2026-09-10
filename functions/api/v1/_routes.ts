/**
 * THE ROUTE TABLE, WRITTEN DOWN ONCE.
 *
 * =============================================================================
 * WHY A TABLE AND NOT THE FILESYSTEM
 * =============================================================================
 * Cloudflare Pages derives routes from the files under `functions/`, which is
 * convenient and is also why nothing in this directory could answer three
 * questions about itself:
 *
 *   - which methods a path accepts, so a 405 can say so in `allow`;
 *   - whether a path exists at all, so an unknown one can be a 404 rather than
 *     the single-page app's HTML with a 200 on it;
 *   - what `openapi.json` must list, so the spec and the code are checked
 *     against each other by a test instead of by memory.
 *
 * This file is the one answer to all three. `_middleware.ts` reads it to gate
 * methods, `[[path]].ts` reads it to refuse unknown paths, and
 * `openapi.json.test.ts` reads it to prove the published contract names every
 * route and nothing else. A route added to the filesystem but not here is a
 * route the middleware will 405 - loudly, on the first request - which is the
 * right failure for an undocumented endpoint.
 *
 * The leading underscore keeps Pages from treating this as a route of its own.
 */

export type Method = 'GET' | 'POST' | 'PUT';

export interface RouteSpec {
  /** The path as the OpenAPI document spells it, `{param}` and all. */
  readonly path: string;
  /** What a concrete request path must match to be this route. */
  readonly pattern: RegExp;
  readonly methods: readonly Method[];
  /** The handler, relative to this directory. What the spec test reads. */
  readonly file: string;
}

export const ROUTES: readonly RouteSpec[] = Object.freeze([
  { path: '/api/v1/cameras', pattern: /^\/api\/v1\/cameras$/, methods: ['GET'], file: 'cameras.ts' },
  { path: '/api/v1/stats', pattern: /^\/api\/v1\/stats$/, methods: ['GET'], file: 'stats.ts' },
  { path: '/api/v1/abuse', pattern: /^\/api\/v1\/abuse$/, methods: ['GET'], file: 'abuse.ts' },
  { path: '/api/v1/atlas', pattern: /^\/api\/v1\/atlas$/, methods: ['GET'], file: 'atlas.ts' },
  { path: '/api/v1/news', pattern: /^\/api\/v1\/news$/, methods: ['GET'], file: 'news.ts' },
  { path: '/api/v1/place', pattern: /^\/api\/v1\/place$/, methods: ['GET'], file: 'place.ts' },
  { path: '/api/v1/route', pattern: /^\/api\/v1\/route$/, methods: ['GET'], file: 'route.ts' },
  {
    path: '/api/v1/openapi.json',
    pattern: /^\/api\/v1\/openapi\.json$/,
    methods: ['GET'],
    file: 'openapi.json.ts',
  },
  { path: '/api/v1/doc/{name}', pattern: /^\/api\/v1\/doc\/[^/]+$/, methods: ['GET'], file: 'doc/[name].ts' },
  { path: '/api/v1/submit', pattern: /^\/api\/v1\/submit$/, methods: ['POST'], file: 'submit.ts' },
  /*
   * The photo store is one file and two routes. A PUT goes to the bare path -
   * the key is derived from the bytes, so there is nothing for a caller to name
   * - and a GET names the key it was given. The trailing-slash spelling is
   * accepted on PUT because it was the only spelling the first shipped
   * middleware let through, and a client that learned it should keep working.
   */
  { path: '/api/v1/photo', pattern: /^\/api\/v1\/photo\/?$/, methods: ['PUT'], file: 'photo/[[key]].ts' },
  { path: '/api/v1/photo/{key}', pattern: /^\/api\/v1\/photo\/[^/]+$/, methods: ['GET'], file: 'photo/[[key]].ts' },
]);

/** The route a request path belongs to, or undefined when there is none. */
export function routeFor(pathname: string): RouteSpec | undefined {
  return ROUTES.find((route) => route.pattern.test(pathname));
}

/** Whether this path takes this method. Unknown paths take nothing. */
export function acceptsMethod(pathname: string, method: string): boolean {
  const route = routeFor(pathname);
  return route !== undefined && (route.methods as readonly string[]).includes(method);
}

/**
 * The `allow` header for a path: its methods, HEAD wherever GET is served, and
 * OPTIONS always, because the middleware answers preflights for everything.
 */
export function allowHeader(pathname: string): string {
  const route = routeFor(pathname);
  const methods: string[] = route === undefined ? ['GET'] : [...route.methods];
  if (methods.includes('GET')) methods.splice(methods.indexOf('GET') + 1, 0, 'HEAD');
  methods.push('OPTIONS');
  return methods.join(', ');
}

/** The body an unknown path gets. Lists what does exist, so the next request is a right one. */
export function notFoundBody(pathname: string): Record<string, unknown> {
  return {
    error: 'not_found',
    detail: `${pathname} is not an endpoint of this API. the contract is at /api/v1/openapi.json.`,
    available: ROUTES.map((route) => `${route.methods.join('|')} ${route.path}`),
  };
}
