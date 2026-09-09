/**
 * WHAT IS PUBLISHED RIGHT NOW.
 *
 * The first call anybody makes against an unfamiliar API, and the one that
 * decides whether they trust the rest of it: how big is this, how old is it,
 * and what is it derived from.
 *
 * Freshness is reported as the UPSTREAM timestamp rather than only the build
 * time, because those answer different questions. A build made an hour ago from
 * a three-day-old OpenStreetMap snapshot is three days stale, and printing only
 * the build time would say the opposite.
 */

import { json } from './_middleware.ts';

interface Env {
  readonly CAMERA_TILES?: R2Bucket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  const [indexResponse, countiesResponse] = await Promise.all([
    fetch(new URL('/cameras/index.json', url.origin).toString(), {
      headers: { accept: 'application/json' },
    }),
    fetch(new URL('/records/counties.json', url.origin).toString(), {
      headers: { accept: 'application/json' },
    }),
  ]);

  if (!indexResponse.ok) {
    return json(503, {
      error: 'archive_unavailable',
      detail: 'the camera archive index did not answer',
    });
  }

  const index: unknown = await indexResponse.json();
  if (!isRecord(index)) {
    return json(503, { error: 'archive_malformed', detail: 'the archive index is not an object' });
  }

  let abuseRecords = 0;
  if (countiesResponse.ok) {
    const counties: unknown = await countiesResponse.json();
    const list: unknown = isRecord(counties) ? counties['records'] : null;
    if (Array.isArray(list)) abuseRecords = list.length;
  }

  return json(200, {
    cameras: typeof index['cameras'] === 'number' ? index['cameras'] : 0,
    /*
     * The generation the tiles are pinned to, taken from the response header
     * the camera route stamps rather than from a second lookup - so this can
     * never disagree with what a tile request would actually be served under.
     */
    generation: indexResponse.headers.get('x-darkroute-camera-generation'),
    generatedAt: str(index['generatedAt']),
    upstream: str(index['upstream']),
    zoom: typeof index['zoom'] === 'number' ? index['zoom'] : null,
    bbox: index['bbox'] ?? null,
    source: str(index['source']) ?? 'OpenStreetMap',
    attribution: str(index['attribution']) ?? 'Map data © OpenStreetMap contributors',
    licence: str(index['licence']) ?? 'ODbL-1.0',
    abuseRecords,
    /*
     * Said in the payload, not only in the docs. Somebody reading a camera
     * count of 139,918 needs to know it is ALPR nodes specifically and that
     * absence is not evidence, and the place they will definitely look is the
     * response they already have.
     */
    scope: 'US ALPR/ANPR nodes only, from man_made=surveillance + surveillance:type=ALPR',
    caveat:
      'coverage is uneven - dense in metros, thin rurally. an empty result means no camera is ' +
      'MAPPED there, never that none is present.',
  });
};
