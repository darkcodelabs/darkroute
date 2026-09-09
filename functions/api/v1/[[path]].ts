/**
 * EVERYTHING UNDER /api/v1 THAT IS NOT AN ENDPOINT.
 *
 * Without this file, Cloudflare Pages answers an unknown `/api/v1/*` path with
 * the single-page app: `GET /api/v1/nonexistent` was a 200 carrying HTML. A
 * developer who mistyped a path got a success, and a client that parsed the
 * body as JSON got a syntax error a long way from the cause. That is the most
 * expensive shape of bug this project has shipped - a 200 with the wrong body -
 * and this catch-all exists so the API surface cannot produce it.
 *
 * Pages routes most-specific-first, so this only runs when no handler file
 * claimed the path for this method. Two things can be true at that point: the
 * path is a real route that does not take this method (`GET /api/v1/submit`),
 * or it is not a route at all. Both are answered from the route table, so the
 * answer here can never disagree with `openapi.json`.
 *
 * In practice `_middleware.ts` answers both cases first, from the same table,
 * and nothing reaches this file. It stays because the middleware is one edit
 * away from letting something through, and the cost of a wrong answer here is
 * the 200-with-HTML this directory exists to never produce again.
 */

import { json } from './_middleware.ts';
import { allowHeader, notFoundBody, routeFor } from './_routes.ts';

export const onRequest: PagesFunction = (context) => {
  const path = new URL(context.request.url).pathname;

  if (routeFor(path) !== undefined) {
    return json(
      405,
      {
        error: 'method_not_allowed',
        detail: `${path} does not take ${context.request.method}. see the allow header.`,
      },
      { allow: allowHeader(path) },
    );
  }

  return json(404, notFoundBody(path));
};
