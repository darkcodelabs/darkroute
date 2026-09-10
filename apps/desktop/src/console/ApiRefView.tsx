/**
 * API: a 760 px measure and no rails, "because prose has a reading width and a
 * 1600 px line of it does not get read." The published files first, weighed
 * live with a HEAD each; then the query endpoints; then the one-line
 * integration and the licence.
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import type { Archive } from './Console.tsx';
import { fetchSize, formatBytes, formatCount } from './data.ts';
import { DatasetInventory } from './DatasetInventory.tsx';

export interface ApiRefViewProps {
  readonly archive: Archive;
}

interface Endpoint {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly path: string;
  readonly note: string;
  readonly weigh?: string;
}

const FILES: readonly Endpoint[] = [
  { method: 'GET', path: '/cameras/index.json', note: 'count and bbox for the whole archive — fetch this first', weigh: '/cameras/index.json' },
  { method: 'GET', path: '/cameras/overview.json', note: 'count and flat coords: [lat, lon, lat, lon, …]; no camera IDs or full records', weigh: '/cameras/overview.json' },
  { method: 'GET', path: '/cameras/11/{x}/{y}.json', note: 'slippy tiles at z11, full records: street, town, owner, maker, facing', weigh: '/cameras/11/485/783.json' },
  { method: 'GET', path: '/cameras/tombstones.json', note: 'removed cameras and the cause of removal', weigh: '/cameras/tombstones.json' },
  { method: 'GET', path: '/cameras/counties.json', note: 'every county with a camera in it, and how many', weigh: '/cameras/counties.json' },
  { method: 'GET', path: '/cameras/places.json', note: 'every city and town with a camera in it, and how many', weigh: '/cameras/places.json' },
  { method: 'GET', path: '/cameras/continuity.json', note: 'the attested chain from the reviewed capture to the head of replication', weigh: '/cameras/continuity.json' },
  { method: 'GET', path: '/records/road-monitoring.json', note: 'complete equipment inventory and source status, dates, attribution and terms' },
  { method: 'GET', path: '/records/atlas-counties.json', note: 'EFF Atlas ALPR deployment context grouped by county, including source metadata' },
  { method: 'GET', path: '/records/counties.json', note: 'every documented abuse source record, including summaries and citations' },
  { method: 'GET', path: '/api/v1/news', note: 'complete current news feed, with collection dates and coverage status' },
  { method: 'GET', path: '/records/hazards.json', note: 'packaged KS/MO work-zone snapshot; inspect builtAt for freshness' },
  { method: 'GET', path: '/records/county-index.json', note: 'supporting Census county boundaries used to locate records; not surveillance devices' },
  { method: 'GET', path: '/records/candidates.json', note: 'historical unreviewed candidate queue; not approved findings or the current news feed' },
];

const QUERIES: readonly Endpoint[] = [
  { method: 'GET', path: '/api/v1/cameras?bbox=w,s,e,n[&owner=][&limit=]', note: 'cameras in a box up to 1.5°, 24 tiles, 1000 rows' },
  { method: 'GET', path: '/api/v1/stats', note: 'the live generation: count, hash, build time, replication watermark' },
  { method: 'GET', path: '/api/v1/abuse[?fips=]', note: 'documented abuse by county, one record per dated source, with dataset freshness' },
  { method: 'GET', path: '/api/v1/news', note: 'automatic ALPR headlines, abuse/news topics, source links, last collection and partial coverage' },
  { method: 'GET', path: '/api/v1/atlas[?fips=]', note: 'EFF Atlas agencies and partial vendors by county, retrieval/check dates and attribution; no camera ownership inference' },
  { method: 'GET', path: '/api/v1/monitoring[?bbox=w,s,e,n][&kind=]', note: 'road monitoring equipment inventory, separate from ALPR cameras; kind filters, coordinates, source provenance, status and freshness' },
  { method: 'GET', path: '/api/v1/monitoring/image?id=', note: 'source photo for a published inventory record, fetched on demand through DarkRoute; no image archive' },
  { method: 'GET', path: '/api/v1/place?q=&near=', note: 'a place search, US and PR only, six results' },
  { method: 'GET', path: '/api/v1/route?from=&to=[&avoid=]', note: 'a drive that keeps the listed cameras off the line' },
  { method: 'POST', path: '/api/v1/submit', note: 'a correction — opens a public pull request, never writes the archive; 6 an hour' },
  { method: 'PUT', path: '/api/v1/photo', note: 'a photograph a correction refers to, keyed by its bytes; 6 MiB' },
  { method: 'GET', path: '/api/v1/openapi.json', note: 'the contract, generated from the route table the server runs' },
];

export const OVERVIEW_CURL = `curl -fsS https://api.darkroute.ai/cameras/overview.json \\
  | jq '.coords as $c | range(0; $c | length; 2) as $i | [$c[$i], $c[$i + 1]] | select(.[0] > 38.8 and .[0] < 39.1 and .[1] > -94.8 and .[1] < -94.3)'`;

export function ApiRefView({ archive }: ApiRefViewProps): ReactElement {
  const [sizes, setSizes] = useState<Readonly<Record<string, number | null>>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      FILES.map(async (f) => [f.path, f.weigh === undefined ? null : await fetchSize(f.weigh, controller.signal)] as const),
    ).then((entries) => {
      if (!controller.signal.aborted) setSizes(Object.fromEntries(entries));
    });
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <section className="dc-pane" aria-label="API reference">
      <div className="dc-measure">
        <DatasetInventory archive={archive} />
        <div className="dc-panel">
          <div className="dc-h">Published files and complete snapshots</div>
          <div className="dc-lede">
            Complete JSON reads with no key or account. Camera generation{' '}
            <span className="dc-mono">{archive.stats?.generation?.slice(0, 12) ?? '—'}</span>,{' '}
            {formatCount(archive.stats?.cameras ?? null)} ALPR cameras. The other datasets update independently.
          </div>
          {FILES.map((f) => (
            <div key={f.path} className="dc-endpoint">
              <span className="dc-method" data-method={f.method}>
                {f.method}
              </span>
              <div className="dc-endpoint-body">
                <div className="dc-path">
                  <a href={f.weigh ?? f.path} target="_blank" rel="noreferrer">
                    {f.path}
                  </a>
                </div>
                <div className="dc-endpoint-note">{f.note}</div>
              </div>
              <span className="dc-size">{formatBytes(sizes[f.path] ?? null)}</span>
            </div>
          ))}
        </div>
        <div className="dc-panel">
          <div className="dc-h">Query endpoints</div>
          <div className="dc-lede">
            Cloudflare Functions on the same origin. CORS open, 60 requests a minute per address, every refusal
            a JSON body with an <span className="dc-mono">error</span> code.
          </div>
          {QUERIES.map((f) => (
            <div key={f.path} className="dc-endpoint">
              <span className="dc-method" data-method={f.method}>
                {f.method}
              </span>
              <div className="dc-endpoint-body">
                <div className="dc-path">{f.path}</div>
                <div className="dc-endpoint-note">{f.note}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="dc-panel">
          <div className="dc-code">
            <div className="dc-code-head">
              <span>Every mapped ALPR coordinate in a bbox</span>
              <button
                type="button"
                className="dc-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(OVERVIEW_CURL).then(() => {
                    setCopied(true);
                    setTimeout(() => {
                      setCopied(false);
                    }, 1200);
                  });
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre>{OVERVIEW_CURL}</pre>
          </div>
          <div className="dc-licence">
            Camera data: <strong>ODbL-1.0</strong>. Attribute "Map data © OpenStreetMap contributors", and publish
            your changes under the same terms. News links belong to their publishers. Atlas responses carry EFF attribution and the source licence observation. Monitoring inventory carries attribution and licence details per source; its counts do not change the ALPR archive. The contract lives at{' '}
            <a className="dc-mono" href="/api/v1/openapi.json">
              /api/v1/openapi.json
            </a>{' '}
            and the long-form reference at{' '}
            <a className="dc-mono" href="/api/v1/doc/api">
              /api/v1/doc/api
            </a>
            . Read the <a className="dc-source" href="https://github.com/darkcodelabs/darkroute/blob/main/docs/reports.md" target="_blank" rel="noreferrer">Reports data and freshness guide</a> for News, Abuse and EFF Atlas.
          </div>
        </div>
      </div>
    </section>
  );
}
