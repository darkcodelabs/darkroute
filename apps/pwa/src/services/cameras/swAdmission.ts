/**
 * WHAT THE SERVICE WORKER IS ALLOWED TO KEEP.
 *
 * =============================================================================
 * THESE FUNCTIONS RUN INSIDE THE GENERATED WORKER, NOT IN THE APP
 * =============================================================================
 * `vite.config.ts` hands them to Workbox, which SERIALISES each one into
 * `dist/sw.js` by its source text. That has one hard consequence:
 *
 *   EVERY FUNCTION HERE MUST BE SELF-CONTAINED.
 *
 * No imports, no module-level constants, no calling each other - a free
 * identifier compiles fine, serialises fine, and then throws `ReferenceError`
 * in the worker on a driver's phone, where nothing is watching. The repeated
 * regex literal below is that rule being obeyed, not an oversight.
 * `scripts/service-worker-policy.test.mjs` asserts the BUILT worker carries
 * these bodies rather than their names.
 *
 * Their signatures are Workbox's own (`{ url }` for a route match,
 * `{ request, response }` for `cacheWillUpdate`) so that the config passes them
 * straight through - and so that a test can call them with a real URL, a real
 * Request and a real Response and ask the only question that matters: given
 * this response, does the worker keep it?
 *
 * They live in `src/` rather than beside the config for exactly that reason.
 * The policy used to be asserted by grepping `vite.config.ts` for a regex,
 * which cannot tell a rule that works from a rule that is merely present.
 *
 * =============================================================================
 * WHY A CACHE ADMISSION RULE IS PART OF THE GENERATION PROTOCOL
 * =============================================================================
 * The client binds every camera read to one immutable generation: the URL
 * carries `?generation=<G>` and the response header must equal it. A cache that
 * admitted a response whose header said otherwise would hold bytes from one
 * snapshot under another snapshot's URL, and every later read of that URL would
 * pass the client's header check by reading the WRONG BODY back out of the
 * cache. The protocol has to hold at both ends or it holds at neither.
 */

/**
 * Does this request name one of the files that describe the archive itself?
 *
 * `overview.json` (the whole-country point set), `counties.json` and
 * `places.json` (the gazetteer). They were matched by no route at all: not
 * precached (`globPatterns` is js/css/html/woff2/png/svg) and named by no
 * runtime route, so with no signal the warning tiles kept working while the map
 * overview, the POI export and every place name failed outright - the app
 * quietly disagreeing with itself about what it holds.
 *
 * The z11 tiles have their own route; this is deliberately not it.
 */
export function isCameraSidecarRequest({ url }: { url: URL }): boolean {
  return (
    url.origin === self.location.origin &&
    /^\/cameras\/(?:overview|counties|places)\.json$/.test(url.pathname)
  );
}

/**
 * May this response be stored under this request's URL?
 *
 * Only when the URL asks for a generation, the response says it is serving that
 * generation, and the status is a real 200. Everything else is refused:
 *
 *   no `?generation=`   an unversioned URL from an older build. Storing it
 *                       creates an entry no later generation can invalidate.
 *   header mismatch     the pointer moved between the request and the response.
 *                       The body is coherent - with the OTHER generation -
 *                       which is precisely why it may not be kept under this
 *                       one.
 *   missing header      the origin is not serving this archive through the
 *                       generation Function. Nothing about the body can be tied
 *                       to a snapshot, so nothing may be cached as one.
 *   any non-200         a 404 cached as camera data is "nothing published here"
 *                       and an Access redirect cached as data is a sign-in page
 *                       served as the archive.
 */
export async function admitGenerationBoundResponse({
  request,
  response,
}: {
  request: Request;
  response: Response;
}): Promise<Response | null> {
  const expected = new URL(request.url).searchParams.get('generation');
  const actual = response.headers.get('x-darkroute-camera-generation');
  return response.status === 200 && /^[0-9a-f]{64}$/.test(expected ?? '') && actual === expected
    ? response
    : null;
}
