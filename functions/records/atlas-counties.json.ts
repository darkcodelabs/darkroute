import { ATLAS_KEY, ATLAS_MAX_BYTES, parseAtlasSnapshot } from '../api/v1/_atlasSnapshot.ts';

interface Env { readonly CAMERA_TILES?: R2Bucket }

function unavailable(reason: string): Response {
  return new Response(JSON.stringify({ error: 'atlas_unavailable', detail: reason }), {
    status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** One live artifact for the phone and API, retaining the bundled artifact until first publication. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  let object: R2ObjectBody | null = null;
  if (context.env.CAMERA_TILES !== undefined) {
    try { object = await context.env.CAMERA_TILES.get(ATLAS_KEY); } catch {
      return unavailable('the live Atlas snapshot could not be read');
    }
  }
  let text: string;
  let headers: Headers;
  if (object === null) {
    let fallback: Response;
    try {
      fallback = context.request.method === 'HEAD'
        ? await context.next(new Request(context.request, { method: 'GET' }))
        : await context.next();
    } catch { return unavailable('the bundled Atlas snapshot could not be read'); }
    if (!fallback.ok) return unavailable('no Atlas snapshot is available');
    text = await fallback.text();
    headers = new Headers(fallback.headers);
    headers.set('x-darkroute-atlas-source', 'static');
    headers.delete('content-length');
    headers.delete('content-encoding');
  } else {
    if (object.size > ATLAS_MAX_BYTES) return unavailable('the live Atlas snapshot is too large');
    try { text = await object.text(); } catch { return unavailable('the live Atlas snapshot could not be read'); }
    headers = new Headers({ etag: object.httpEtag, 'x-darkroute-atlas-source': 'r2' });
  }
  if (parseAtlasSnapshot(text) === null) return unavailable('the Atlas snapshot is malformed');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'public, max-age=300, must-revalidate');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(text, { headers });
};

export const onRequestHead: PagesFunction<Env> = async (context) => {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
};
