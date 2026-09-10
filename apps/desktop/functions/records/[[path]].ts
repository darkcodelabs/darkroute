import { proxy } from '../_proxy.ts';
import { RECORD_FILES } from '../../shared/recordFiles.ts';
export { RECORD_FILES } from '../../shared/recordFiles.ts';

/** Only these published inventories belong on this host; never pass arbitrary paths to the SPA. */
const PATHS = new Set(RECORD_FILES.map((name) => `/records/${name}`));

function error(request: Request, status: number, code: string, detail: string): Response {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: code, detail }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(status === 405 ? { allow: 'GET, HEAD' } : {}),
    },
  });
}

export const onRequest: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  if (!PATHS.has(url.pathname)) return error(request, 404, 'not_found', 'No published inventory at this path.');
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(request, 405, 'method_not_allowed', 'Published inventories support GET and HEAD.');
  try {
    const response = await proxy(request, `${url.pathname}${url.search}`);
    if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
      return error(request, 502, 'inventory_unavailable', 'The published inventory did not return JSON.');
    }
    return request.method === 'HEAD' ? new Response(null, response) : response;
  } catch {
    return error(request, 502, 'inventory_unavailable', 'The published inventory could not be reached.');
  }
};
