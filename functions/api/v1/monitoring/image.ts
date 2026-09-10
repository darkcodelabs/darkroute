import type { MonitoringRecord } from '../../../../packages/core/src/roadMonitoring.ts';
import { json } from '../_middleware.ts';
import { readMonitoringResponse } from '../_monitoringSnapshot.ts';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 10_000;

/** Only inventoried cameras from these official image services may be requested. */
export function officialImageUrl(record: MonitoringRecord): string | null {
  if (record.imageUrl === null || record.kind !== 'traffic_camera') return null;
  try {
    const url = new URL(record.imageUrl);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
    const path = decodeURIComponent(url.pathname);
    if (/%/u.test(path) || path.split('/').some((part) => part === '..' || part === '.')) return null;
    const op = record.sourceId === 'overland-park-traffic' && url.hostname === 'www2.opkansas.org'
      && /^\/external-files\/traffic-cameras\/[a-z0-9_ .()-]+\.jpeg$/iu.test(path);
    const district = /^caltrans-d([1-9]|1[0-2])$/u.exec(record.sourceId)?.[1];
    const caltrans = district !== undefined && url.hostname === 'cwwp2.dot.ca.gov'
      && path.startsWith(`/data/d${district}/cctv/image/`)
      && /^\/data\/d\d{1,2}\/cctv\/image\/(?:[a-z0-9_ .()-]+\/)*[a-z0-9_ .()-]+\.jpg$/iu.test(path);
    if (!op && !caltrans) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function matchesImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  return mime === 'image/webp' && bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
}

async function imageBytes(response: Response): Promise<Uint8Array | null> {
  if (response.body === null) return null;
  if (Number(response.headers.get('content-length')) > IMAGE_MAX_BYTES) { await response.body.cancel(); return null; }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > IMAGE_MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Resolve a known inventory ID; no arbitrary target URL or caller headers are forwarded. */
export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id === null || id.trim() === '' || id.length > 300) return json(400, { error: 'bad_id', detail: 'id must identify a published road monitoring record' });
  let response: Response;
  try {
    response = await fetch(new URL('/records/road-monitoring.json', url.origin).toString(), {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
  } catch { return json(503, { error: 'monitoring_unavailable', detail: 'the published inventory could not be read' }); }
  if (!response.ok) return json(503, { error: 'monitoring_unavailable', detail: 'the published inventory did not answer' });
  const snapshot = await readMonitoringResponse(response);
  if (snapshot === null) return json(503, { error: 'monitoring_malformed', detail: 'the published inventory is malformed' });
  const record = snapshot.records.find((item) => item.id === id);
  if (record === undefined || record.imageUrl === null) return json(404, { error: 'image_not_found', detail: 'no official image is recorded for this inventory entry' });
  const target = officialImageUrl(record);
  if (target === null) return json(503, { error: 'image_source_refused', detail: 'the recorded image is not on an approved official image service' });
  try {
    const image = await fetch(target, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      // Fresh application headers: never copy the viewer's headers into this subrequest.
      headers: { accept: 'image/jpeg, image/png, image/webp' },
    });
    if (image.status >= 300 && image.status < 400) {
      await image.body?.cancel();
      return json(503, { error: 'image_source_refused', detail: 'image service redirects are not followed' });
    }
    if (!image.ok) { await image.body?.cancel(); return json(503, { error: 'image_unavailable', detail: 'the official image service did not answer' }); }
    const mime = image.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      await image.body?.cancel();
      return json(502, { error: 'image_invalid', detail: 'the image service did not return a supported raster image' });
    }
    const bytes = await imageBytes(image);
    if (bytes === null || !matchesImage(bytes, mime)) return json(502, { error: 'image_invalid', detail: 'the image exceeds its size bound or does not match its media type' });
    return new Response(bytes, { headers: {
      'content-type': mime, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
    } });
  } catch { return json(503, { error: 'image_unavailable', detail: 'the official image could not be read within the request time limit' }); }
};
