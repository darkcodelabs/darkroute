/**
 * COVERAGE: the one tab the design named and did not draw. "If the real
 * console has screens I have not drawn, fit them into this shell rather than
 * invent more" -- so this is the misuse table's shell with the archive's own
 * `counties.json` in it: every county with a camera, how many, and the share
 * of the archive that county holds. The rail keeps the one filter that means
 * something here, the state.
 */

import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { Archive } from './Console.tsx';
import { download, formatCount } from './data.ts';

export interface CoverageViewProps {
  readonly archive: Archive;
  readonly query: string;
}

type Sort = 'cameras' | 'name';

export function CoverageView({ archive, query }: CoverageViewProps): ReactElement {
  const [state, setState] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('cameras');
  const rows = archive.counties ?? [];
  const total = archive.stats?.cameras ?? rows.reduce((sum, r) => sum + r.cameras, 0);
  const states = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of rows) by.set(r.state, (by.get(r.state) ?? 0) + r.cameras);
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows
        .filter((r) => (state === null || r.state === state) && (q === '' || r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)))
        .sort((a, b) => (sort === 'cameras' ? b.cameras - a.cameras || a.label.localeCompare(b.label) : a.label.localeCompare(b.label))),
    [rows, state, q, sort],
  );

  return (
    <>
      <aside className="dc-rail" aria-label="Filters">
        <div className="dc-rail-head">
          <div className="dc-kicker">Where the archive is</div>
          <div className="dc-sub">
            {formatCount(rows.length)} counties · {formatCount(states.length)} states
          </div>
        </div>
        <button type="button" className="dc-row" aria-pressed={state === null} onClick={() => { setState(null); }}>
          {state === null ? <span className="dc-radio" aria-hidden="true" /> : <span className="dc-dot" aria-hidden="true" />}
          <span className="dc-row-name">All states</span>
          <span className="dc-row-value">{formatCount(total)}</span>
        </button>
        {states.slice(0, 24).map(([s, n]) => (
          <button
            key={s}
            type="button"
            className="dc-row"
            aria-pressed={state === s}
            onClick={() => {
              setState(state === s ? null : s);
            }}
          >
            <span className="dc-dot" data-owner="inter_agency" aria-hidden="true" />
            <span className="dc-row-name">{s}</span>
            <span className="dc-row-value">{formatCount(n)}</span>
          </button>
        ))}
        <div className="dc-rule" />
        <div className="dc-note">
          A county's count is cameras located inside its Census polygon at build time. It is a fact about
          the map, not a claim about the county.
        </div>
      </aside>
      <div className="dc-chips" role="group" aria-label="State">
        <button type="button" className="dc-chip" aria-pressed={state === null} onClick={() => { setState(null); }}>
          All {formatCount(total)}
        </button>
        {states.slice(0, 12).map(([s, n]) => (
          <button key={s} type="button" className="dc-chip" aria-pressed={state === s} onClick={() => { setState(state === s ? null : s); }}>
            {s} {formatCount(n)}
          </button>
        ))}
      </div>
      <section className="dc-pane" aria-label="Coverage">
        <div className="dc-table">
          <div className="dc-table-head">
            <div className="dc-table-title" data-tone="plain">
              Coverage by county
            </div>
            <div className="dc-table-sub">
              {formatCount(total)} cameras across {formatCount(rows.length)} counties · built{' '}
              {archive.built?.slice(0, 10) ?? '—'}
            </div>
          </div>
          <div className="dc-th" role="row">
            <span className="dc-c-year">FIPS</span>
            <button type="button" className="dc-c-name" data-on={sort === 'name'} onClick={() => { setSort('name'); }}>
              County
            </button>
            <span className="dc-c-place">State</span>
            <button type="button" className="dc-c-count" data-on={sort === 'cameras'} onClick={() => { setSort('cameras'); }}>
              Cameras
            </button>
            <span className="dc-c-count">Share</span>
          </div>
          {archive.counties === null ? <div className="dc-empty">{archive.state === 'down' ? 'the archive did not answer' : 'reading…'}</div> : null}
          {shown.slice(0, 400).map((r) => (
            <div key={r.fips} className="dc-tr" role="row">
              <span className="dc-c-year">{r.fips}</span>
              <span className="dc-c-name">{r.name} {r.lsad}</span>
              <span className="dc-c-place">{r.state}</span>
              <span className="dc-c-count" data-tone="plain">
                {formatCount(r.cameras)}
              </span>
              <span className="dc-c-count" data-tone="plain">
                {total > 0 ? `${((r.cameras / total) * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
          ))}
          <div className="dc-table-foot">
            <span>
              {shown.length > 400 ? `Showing 400 of ${formatCount(shown.length)}; the CSV has them all.` : `${formatCount(shown.length)} counties.`}
            </span>
            <button
              type="button"
              disabled={shown.length === 0}
              onClick={() => {
                const lines = ['fips,county,lsad,state,cameras', ...shown.map((r) => `${r.fips},"${r.name.replaceAll('"', '""')}",${r.lsad},${r.state},${String(r.cameras)}`)];
                download('darkroute-coverage.csv', `${lines.join('\n')}\n`, 'text/csv');
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
