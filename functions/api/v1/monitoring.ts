import { MONITORING_KINDS } from '../../../packages/core/src/roadMonitoring.ts';
import type { MonitoringKind } from '../../../packages/core/src/roadMonitoring.ts';
import { json } from './_middleware.ts';
import { readMonitoringResponse } from './_monitoringSnapshot.ts';

type Bbox = readonly [number, number, number, number];
function box(value: string): Bbox | null {
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((part) => part.trim() === '' || !Number.isFinite(Number(part)))) return null;
  const [west, south, east, north] = parts.map(Number) as [number, number, number, number];
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  return [west, south, east, north];
}

/** An inventory query, kept separate from camera records and ALPR exposure totals. */
export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const wantedBox = url.searchParams.get('bbox');
  const bbox = wantedBox === null ? null : box(wantedBox);
  if (wantedBox !== null && bbox === null) return json(400, {
    error: 'bad_bbox', detail: 'bbox must be west,south,east,north within longitude -180..180 and latitude -90..90; east and north must exceed west and south',
  });
  const kind = url.searchParams.get('kind');
  if (kind !== null && !MONITORING_KINDS.includes(kind as MonitoringKind)) return json(400, {
    error: 'bad_kind', detail: `kind must be one of ${MONITORING_KINDS.join(', ')}`,
  });
  let upstream: Response;
  try {
    upstream = await fetch(new URL('/records/road-monitoring.json', url.origin).toString(), { headers: { accept: 'application/json' } });
  } catch { return json(503, { error: 'monitoring_unavailable', detail: 'the published inventory could not be read' }); }
  if (!upstream.ok) return json(503, { error: 'monitoring_unavailable', detail: 'the published inventory did not answer' });
  const snapshot = await readMonitoringResponse(upstream);
  if (snapshot === null) return json(503, { error: 'monitoring_malformed', detail: 'the published inventory is not the expected shape' });
  const records = snapshot.records.filter((item) => (kind === null || item.kind === kind)
    && (bbox === null || (item.lon >= bbox[0] && item.lon <= bbox[2] && item.lat >= bbox[1] && item.lat <= bbox[3])));
  return new Response(JSON.stringify({ ...snapshot, records, query: { bbox, kind }, count: records.length, total: snapshot.records.length }), {
    headers: {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300, must-revalidate',
      'x-content-type-options': 'nosniff',
    },
  });
};
