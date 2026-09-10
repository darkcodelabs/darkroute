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
  { method: 'GET', path: '/cameras/overview.json', note: 'every camera as [lat, lon, id], nothing else', weigh: '/cameras/overview.json' },
  { method: 'GET', path: '/cameras/11/{x}/{y}.json', note: 'slippy tiles at z11, full records: street, town, owner, maker, facing', weigh: '/cameras/11/485/783.json' },
  { method: 'GET', path: '/cameras/tombstones.json', note: 'removed cameras and the cause of removal', weigh: '/cameras/tombstones.json' },
  { method: 'GET', path: '/cameras/counties.json', note: 'every county with a camera in it, and how many', weigh: '/cameras/counties.json' },
  { method: 'GET', path: '/cameras/places.json', note: 'every city and town with a camera in it, and how many', weigh: '/cameras/places.json' },
  { method: 'GET', path: '/cameras/continuity.json', note: 'the attested chain from the reviewed capture to the head of replication', weigh: '/cameras/continuity.json' },
];

const QUERIES: readonly Endpoint[] = [
  { method: 'GET', path: '/api/v1/cameras?bbox=w,s,e,n[&owner=][&limit=]', note: 'cameras in a box up to 1.5°, 24 tiles, 1000 rows' },
  { method: 'GET', path: '/api/v1/stats', note: 'the live generation: count, hash, build time, replication watermark' },
  { method: 'GET', path: '/api/v1/abuse[?fips=]', note: 'documented abuse by county, one record per dated source, with dataset freshness' },
  { method: 'GET', path: '/api/v1/news', note: 'automatic ALPR headlines, abuse/news topics, source links, last collection and partial coverage' },
  { method: 'GET', path: '/api/v1/atlas[?fips=]', note: 'EFF Atlas agencies and partial vendors by county, retrieval/check dates and attribution; no camera ownership inference' },
  { method: 'GET', path: '/api/v1/place?q=&near=', note: 'a place search, US and PR only, six results' },
  { method: 'GET', path: '/api/v1/route?from=&to=[&avoid=]', note: 'a drive that keeps the listed cameras off the line' },
  { method: 'POST', path: '/api/v1/submit', note: 'a correction — opens a public pull request, never writes the archive; 6 an hour' },
  { method: 'PUT', path: '/api/v1/photo', note: 'a photograph a correction refers to, keyed by its bytes; 6 MiB' },
  { method: 'GET', path: '/api/v1/openapi.json', note: 'the contract, generated from the route table the server runs' },
];

const CURL = `curl -s https://api.darkroute.ai/cameras/overview.json \\
  | jq '.[] | select(.[0] > 38.8 and .[0] < 39.1)'`;

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
        <div className="dc-panel">
          <div className="dc-h">Published files</div>
          <div className="dc-lede">
            Static files on a CDN. No keys, no account — a fetch is the whole integration. Generation{' '}
            <span className="dc-mono">{archive.stats?.generation?.slice(0, 12) ?? '—'}</span>,{' '}
            {formatCount(archive.stats?.cameras ?? null)} cameras.
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
              <span>Every camera in a bbox</span>
              <button
                type="button"
                className="dc-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(CURL).then(() => {
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
            <pre>{CURL}</pre>
          </div>
          <div className="dc-licence">
            Camera data: <strong>ODbL-1.0</strong>. Attribute "Map data © OpenStreetMap contributors", and publish
            your changes under the same terms. News links belong to their publishers. Atlas responses carry EFF attribution and the source licence observation. The contract lives at{' '}
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
