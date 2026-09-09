/**
 * api.darkroute.ai/v1/* -> darkroute.ai/api/v1/*
 *
 * `/v1/x` here is `/api/v1/x` there. The prefix differs because the apex has
 * an app on it and this hostname does not, and a developer typing the
 * hostname called `api` should not then have to type `/api` again. See
 * `../_proxy.ts` for everything else.
 */

import { proxy } from '../_proxy.ts';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  return proxy(context.request, `/api${url.pathname}${url.search}`);
};
