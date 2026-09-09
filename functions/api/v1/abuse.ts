/**
 * THE DOCUMENTED MISUSE RECORDS.
 *
 * One row per county, each naming an agency and citing a source URL. Served
 * whole rather than paged: it is 93 rows, and splitting a citation set across
 * pages makes it harder to check, not easier - which would defeat the only
 * reason the file exists.
 *
 * Read through the app's own `/records/` route for the same reasons the camera
 * endpoint reads through `/cameras/`: it inherits the edge cache, and it cannot
 * serve anything the product itself would not.
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
  const response = await fetch(new URL('/records/counties.json', url.origin).toString(), {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    return json(503, {
      error: 'records_unavailable',
      detail: 'the misuse record set did not answer',
    });
  }

  const body: unknown = await response.json();
  const list: unknown = isRecord(body) ? body['records'] : null;
  if (!Array.isArray(list)) {
    return json(503, { error: 'records_malformed', detail: 'the record set is not the expected shape' });
  }

  const records = list.filter(isRecord).map((r) => ({
    fips: str(r['fips']) ?? '',
    agency: str(r['agency']) ?? 'unnamed agency',
    incidents: typeof r['incidents'] === 'number' ? r['incidents'] : 0,
    year: typeof r['year'] === 'number' ? r['year'] : 0,
    sourceName: str(r['sourceName']) ?? '',
    summary: str(r['summary']) ?? '',
    sourceUrl: str(r['sourceUrl']) ?? '',
  }));

  return json(200, {
    /*
     * EVERY ROW CARRIES ITS SOURCE, and rows that do not are still returned
     * rather than silently dropped. A record with a missing citation is a
     * defect somebody should be able to see and fix; hiding it here would make
     * the set look better than it is, which is the opposite of the point.
     */
    note: 'one row per county. every row cites a source; check them.',
    count: records.length,
    uncited: records.filter((r) => r.sourceUrl === '').length,
    records,
  });
};
