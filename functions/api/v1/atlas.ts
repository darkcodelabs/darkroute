import { json } from './_middleware.ts';

import { ATLAS_MAX_BYTES, parseAtlasSnapshot } from './_atlasSnapshot.ts';

/** County context from the same published Atlas artifact the map reads. */
export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const fips = url.searchParams.get('fips');
  if (fips !== null && !/^\d{5}$/u.test(fips)) {
    return json(400, { error: 'bad_fips', detail: 'fips must be a five-digit county code, including leading zeros' });
  }
  let body: ReturnType<typeof parseAtlasSnapshot>;
  try {
    const response = await fetch(new URL('/records/atlas-counties.json', url.origin).toString(), {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return json(503, { error: 'atlas_unavailable', detail: 'the published Atlas dataset did not answer' });
    if (Number(response.headers.get('content-length')) > ATLAS_MAX_BYTES) {
      return json(503, { error: 'atlas_malformed', detail: 'the Atlas dataset exceeds its size bound' });
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > ATLAS_MAX_BYTES) {
      return json(503, { error: 'atlas_malformed', detail: 'the Atlas dataset exceeds its size bound' });
    }
    body = parseAtlasSnapshot(text);
  } catch {
    return json(503, { error: 'atlas_unavailable', detail: 'the published Atlas dataset could not be read' });
  }
  if (body === null) return json(503, { error: 'atlas_malformed', detail: 'the Atlas dataset is not the expected shape' });
  const counties = Object.entries(body.counties)
    .filter(([code]) => fips === null || code === fips)
    .map(([code, row]) => ({
      fips: code, deployments: row.n, agencies: row.agencies,
      vendors: row.vendors, vendorKnown: row.vendorKnown,
    }));
  return json(200, {
    schema: 'darkroute-atlas-api/v1',
    note: 'County-level agencies recorded as operating ALPR. These are not abuse findings, camera counts, or proof of ownership of any camera. No county entry means no Atlas record, not no ALPR.',
    fetchedAt: body['fetchedAt'],
    checkedAt: body.checkedAt ?? body.fetchedAt,
    source: body['source'], totals: body['totals'],
    countyFips: fips, coverage: fips === null ? null : counties.length > 0 ? 'recorded' : 'none',
    count: counties.length, counties,
  });
};
