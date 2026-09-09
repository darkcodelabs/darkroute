/**
 * MISUSE: a table, not cards. "A phone shows three of these as cards. A desk
 * shows forty as rows -- that is the whole reason this surface exists."
 *
 * Rows come from `/api/v1/abuse`, grouped by year, agency and county with
 * their dated sources, and the rail keeps the two filters that mean something
 * here: agency and year. Every row links its source; the whole table leaves
 * as a CSV.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { fetchAbuse } from '../data/api.ts';
import type { AbuseRecord } from '../data/api.ts';
import type { Archive } from './Console.tsx';
import { download, formatCount, misuseCsv, misuseRows } from './data.ts';

export interface MisuseViewProps {
  readonly archive: Archive;
  readonly query: string;
}

export function MisuseView({ archive, query }: MisuseViewProps): ReactElement {
  const [records, setRecords] = useState<readonly AbuseRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAbuse(controller.signal)
      .then((result) => {
        setRecords(result.records);
      })
      .catch((cause: unknown) => {
        /* StrictMode mounts twice in development and aborts the first fetch;
           an abort is not the archive failing to answer. */
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('the misuse archive did not answer');
      });
    return () => {
      controller.abort();
    };
  }, []);

  const rows = useMemo(() => misuseRows(records ?? [], archive.counties), [records, archive.counties]);
  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a), [rows]);
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (year === null || r.year === year) &&
      (q === '' || r.agency.toLowerCase().includes(q) || r.county.toLowerCase().includes(q)),
  );
  const agencies = new Set(rows.map((r) => r.agency)).size;
  const incidents = rows.reduce((sum, r) => sum + r.incidents, 0);
  const cases = records?.length ?? 0;

  return (
    <>
      <aside className="dc-rail" aria-label="Filters">
        <div className="dc-rail-head">
          <div className="dc-kicker">Documented misuse</div>
          <div className="dc-sub">
            {formatCount(cases)} cases · {formatCount(agencies)} agencies
          </div>
        </div>
        <button type="button" className="dc-row" aria-pressed={year === null} onClick={() => { setYear(null); }}>
          {year === null ? <span className="dc-radio" aria-hidden="true" /> : <span className="dc-dot" aria-hidden="true" />}
          <span className="dc-row-name">All years</span>
          <span className="dc-row-value">{formatCount(rows.length)}</span>
        </button>
        {years.map((y) => (
          <button
            key={y}
            type="button"
            className="dc-row"
            aria-pressed={year === y}
            onClick={() => {
              setYear(year === y ? null : y);
            }}
          >
            <span className="dc-dot" data-owner="police" aria-hidden="true" />
            <span className="dc-row-name">{String(y)}</span>
            <span className="dc-row-value">{formatCount(rows.filter((r) => r.year === y).length)}</span>
          </button>
        ))}
        <div className="dc-rule" />
        <div className="dc-note">
          Every row carries a dated source. A case is one documented record; incidents are what the
          record counted.
        </div>
      </aside>
      <div className="dc-chips" role="group" aria-label="Year">
        <button type="button" className="dc-chip" aria-pressed={year === null} onClick={() => { setYear(null); }}>
          All years
        </button>
        {years.map((y) => (
          <button key={y} type="button" className="dc-chip" aria-pressed={year === y} onClick={() => { setYear(year === y ? null : y); }}>
            {String(y)}
          </button>
        ))}
      </div>
      <section className="dc-pane" aria-label="Documented misuse">
        <div className="dc-table">
          <div className="dc-table-head">
            <div className="dc-table-title">Documented misuse</div>
            <div className="dc-table-sub">
              {formatCount(cases)} cases · {formatCount(incidents)} incidents · {formatCount(agencies)} agencies
              · every row carries a dated source
            </div>
          </div>
          <div className="dc-th" role="row">
            <span className="dc-c-year">Year</span>
            <span className="dc-c-name">Agency</span>
            <span className="dc-c-place">County</span>
            <span className="dc-c-count">Cases</span>
            <span className="dc-c-count">Source</span>
          </div>
          {error !== null ? <div className="dc-empty">{error}</div> : null}
          {records === null && error === null ? <div className="dc-empty">reading…</div> : null}
          {shown.map((r) => (
            <div key={r.key} className="dc-tr" role="row">
              <span className="dc-c-year">{String(r.year)}</span>
              <span className="dc-c-name" title={r.agency}>
                {r.agency}
              </span>
              <span className="dc-c-place">{r.county}</span>
              <span className="dc-c-count">{String(r.cases)}</span>
              <a className="dc-c-count dc-source" href={r.sourceUrl} target="_blank" rel="noreferrer" title={r.sourceName}>
                source ↗
              </a>
            </div>
          ))}
          <div className="dc-table-foot">
            <span>
              A phone shows three of these as cards. A desk shows {formatCount(shown.length)} as rows — that is
              the whole reason this surface exists.
            </span>
            <button
              type="button"
              disabled={shown.length === 0}
              onClick={() => {
                download('darkroute-misuse.csv', misuseCsv(shown), 'text/csv');
              }}
            >
              Download CSV
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
