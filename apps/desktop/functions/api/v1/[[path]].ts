/**
 * api.darkroute.ai/api/v1/* -> darkroute.ai/api/v1/*
 *
 * The path the OpenAPI document lists, unchanged, so the spec is valid against
 * this host as well as the canonical one - and so the console's own "try it"
 * box, which fetches a relative `/api/v1/...`, reaches the API rather than the
 * console's HTML. Before this file existed, `GET api.darkroute.ai/api/v1/stats`
 * was a 200 carrying the single-page app. See `../../_proxy.ts`.
 */

import { proxy } from '../../_proxy.ts';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  return proxy(context.request, `${url.pathname}${url.search}`);
};
