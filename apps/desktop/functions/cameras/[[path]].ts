/**
 * `/cameras/*` ON THE CONSOLE HOST IS THE ARCHIVE, not the single-page app.
 *
 * The API reference on this host lists `/cameras/index.json`,
 * `/cameras/overview.json`, `/cameras/11/{x}/{y}` and `/cameras/tombstones.json`
 * as the published files, and the console itself reads the counties and
 * tombstone sidecars to fill its rails. Without this Function every one of
 * those paths fell through to the console's HTML with a 200 -- the exact
 * "200 with the wrong body" the proxy exists to never produce. Same proxy as
 * `/v1/*`: the canonical origin answers, and the headers say so.
 */

import { proxy } from '../_proxy.ts';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  return proxy(context.request, `${url.pathname}${url.search}`);
};
