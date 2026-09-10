import { MONITORING_MAX_BYTES } from '../../packages/core/src/roadMonitoring.ts';
import { MONITORING_KEY, readMonitoringResponse } from '../api/v1/_monitoringSnapshot.ts';

interface Env { readonly CAMERA_TILES?: R2Bucket }

function unavailable(detail: string): Response {
  return new Response(JSON.stringify({ error: 'monitoring_unavailable', detail }), {
    status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  let object: R2ObjectBody | null = null;
  if (context.env.CAMERA_TILES !== undefined) {
    try { object = await context.env.CAMERA_TILES.get(MONITORING_KEY); } catch {
      return unavailable('the published road monitoring inventory could not be read');
    }
  }
  let upstream: Response;
  let source: 'r2' | 'static';
  let etag: string | null = null;
  if (object === null) {
    try {
      upstream = context.request.method === 'HEAD'
        ? await context.next(new Request(context.request, { method: 'GET' })) : await context.next();
    } catch { return unavailable('the packaged road monitoring inventory could not be read'); }
    if (!upstream.ok) return unavailable('no road monitoring inventory is available');
    source = 'static';
    etag = upstream.headers.get('etag');
  } else {
    if (object.size > MONITORING_MAX_BYTES) return unavailable('the road monitoring inventory exceeds its size bound');
    upstream = new Response(object.body);
    source = 'r2';
    etag = object.httpEtag;
  }
  const snapshot = await readMonitoringResponse(upstream);
  if (snapshot === null) return unavailable('the road monitoring inventory is malformed');
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300, must-revalidate',
    'x-content-type-options': 'nosniff', 'x-darkroute-monitoring-source': source,
  });
  if (etag !== null) headers.set('etag', etag);
  return new Response(JSON.stringify(snapshot), { headers });
};

export const onRequestHead: PagesFunction<Env> = async (context) => {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
};
