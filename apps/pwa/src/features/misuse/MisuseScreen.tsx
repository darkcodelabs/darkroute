/**
 * MISUSE - who has abused this, and where.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isMisuse` block.
 *
 * =============================================================================
 * THE RECORDS ARE REAL AND THE DESIGN'S ARE NOT
 * =============================================================================
 * The design ships four hand-written cases with invented tags - STALKING,
 * POLITICAL, SOLD DATA - invented camera counts and invented sources. Not one
 * of them appears here.
 *
 * What ships is `apps/pwa/public/records/counties.json`: 47 entries across 38
 * counties, every one fetched and read by a fact-check pass before it was
 * written, every one carrying a URL a reader can open. Six candidates were
 * REJECTED by that pass - one contradicted by its own source, one unfetchable,
 * four duplicates - and `scripts/check-record-citations.mjs` fails the build if
 * any surviving entry loses its citation.
 *
 * That gate is the reason this screen can exist at all. It makes public
 * allegations of misconduct about named agencies and shows them to drivers in
 * those agencies' jurisdictions; an entry without a source a reader can open is
 * not a record, it is an accusation.
 *
 * =============================================================================
 * WHY THE FILTERS ARE NOT THE DESIGN'S
 * =============================================================================
 * The design's chips are categories - stalking, political, sold data - and the
 * records carry no category. Inventing one per entry would mean this screen
 * deciding what somebody's misconduct WAS, from a one-sentence summary, and
 * publishing that judgement next to their employer's name.
 *
 * The two filters below are facts the data actually holds: whether a record is
 * in the county you are standing in, and which year it is from.
 *
 * =============================================================================
 * WHAT IS NEVER SAID
 * =============================================================================
 * That a county with no record is clean. Absence here means UNDOCUMENTED, and
 * the footer says so - the file is what a handful of people have found and
 * cited, not an audit of American policing.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../components/nav';
import { countyLocator } from '../../services/records/countyLocate.ts';
import { countyRecords } from '../../services/records/countyRecords.ts';
import type { CountyMisuseRecord } from '../../services/records/countyRecords.ts';
import { gazetteer } from '../../services/cameras/gazetteer.ts';
import { dataAsOf } from '../intel/intelState.ts';
import { useCurrentFix, useNearestCamera, useCamerasStore } from '../../stores/index.ts';

import './misuse.css';

export const MISUSE_TITLE = 'Misuse';

export const MISUSE_HEADLINE = 'Who has abused this, and where.';
export const MISUSE_BODY =
  'documented cases of officers and operators searching the network for people they knew. every ' +
  'one is dated, named to the agency that did it, and carries a source you can open.';

export const FILTER_ALL = 'All';
export const FILTER_NEAR = 'Near me';

/** Said before the file has loaded. Not the same as "nothing documented". */
export const LOADING = 'reading the record file.';

/** Said when a filter excludes everything. */
export const NO_MATCHES = 'nothing on file matches that.';

/**
 * The footer, and the most important sentence on the screen.
 *
 * A driver who reads 47 records and sees their own county absent must not
 * conclude their own agency is clean.
 */
export const MISUSE_FOOTER =
  'this is what has been found and cited, not an audit. a county with nothing on file is ' +
  'undocumented, which is not the same as clean.';

export const SOURCE_PREFIX = 'Source: ';

/** `1 documented incident` / `3 documented incidents`. Never "several". */
export function incidentLabel(count: number): string {
  return `${String(count)} documented incident${count === 1 ? '' : 's'}`;
}

export function MisuseScreen(): ReactElement {
  const fix = useCurrentFix();
  const nearest = useNearestCamera();
  const cameras = useCamerasStore((s) => s.cameras);

  /**
   * The file loads on demand and the index has no subscription, so this
   * re-reads once it is ready rather than leaving an empty screen forever.
   */
  const [records, setRecords] = useState<readonly CountyMisuseRecord[]>(() =>
    countyRecords.all(),
  );
  /*
   * The build stamp, set from the same readiness signal as the records rather
   * than by a second poller. It cannot be known before the file loads, and a
   * stamp that appeared a beat after the counts would read as a late correction
   * to a number the reader had already accepted.
   */
  const [builtAt, setBuiltAt] = useState<string | null>(() =>
    dataAsOf(countyRecords.generatedAt()),
  );
  useEffect(() => {
    if (countyRecords.ready()) {
      setRecords(countyRecords.all());
      setBuiltAt(dataAsOf(countyRecords.generatedAt()));
      return undefined;
    }
    let live = true;
    const timer = globalThis.setInterval(() => {
      if (!countyRecords.ready()) return;
      if (live) {
        setRecords(countyRecords.all());
        setBuiltAt(dataAsOf(countyRecords.generatedAt()));
      }
      globalThis.clearInterval(timer);
    }, 250);
    return () => {
      live = false;
      globalThis.clearInterval(timer);
    };
  }, []);

  /**
   * WHICH COUNTY THE DRIVER IS IN.
   *
   * =========================================================================
   * THIS READ THE NEAREST CAMERA'S `countyFips`, AND THAT FIELD DOES NOT EXIST
   * =========================================================================
   * The idea was right - the records are FIPS-keyed, and asking a network
   * service where somebody is standing is the exact thing this product exists
   * not to do - but the premise was wrong. The shipped archive's cameras do not
   * carry `countyFips`. `fetch-cameras.mjs:490` emits it; the capture that
   * actually produced the live archive is `fetch-cameras-deflock.mjs`, which
   * never writes it. Measured on the live archive: 0 of 868 cameras across 60
   * randomly sampled z11 tiles have the field, and it is absent from the record
   * shape entirely.
   *
   * So this returned null every time, and NEAR ME was permanently disabled -
   * correctly disabled rather than silently returning everything, but nobody
   * could ever press it.
   *
   * `countyLocate.ts` answers the question from county geometry ON THE DEVICE,
   * so it is right regardless of what any camera record carries, and it keeps
   * the property that mattered: nothing about the driver's position leaves the
   * phone. The camera field is still PREFERRED when a camera does carry one -
   * an enriched archive is the more direct answer and costs nothing to use -
   * so this improves on its own when the v3 capture lands.
   */
  const [locatedFips, setLocatedFips] = useState<string | null>(null);
  const cameraFips = useMemo(() => {
    if (fix === null) return null;
    const id = nearest?.id;
    const record = id === undefined ? null : (cameras.find((c) => c.id === id) ?? null);
    return record?.countyFips ?? null;
  }, [fix, nearest, cameras]);

  useEffect(() => {
    if (fix === null || cameraFips !== null) return undefined;
    let live = true;
    void countyLocator.locate(fix.lat, fix.lon).then((hit) => {
      if (live) setLocatedFips(hit?.fips ?? null);
    });
    return () => {
      live = false;
    };
  }, [fix, cameraFips]);

  const myFips = cameraFips ?? locatedFips;

  const [near, setNear] = useState(false);
  const [year, setYear] = useState<number | null>(null);

  /** Every year present in the file, newest first. Never a fixed list. */
  const years = useMemo(
    () => [...new Set(records.map((r) => r.year))].sort((a, b) => b - a),
    [records],
  );

  const shown = useMemo(
    () =>
      records.filter((r) => {
        if (near && (myFips === null || r.fips !== myFips)) return false;
        if (year !== null && r.year !== year) return false;
        return true;
      }),
    [records, near, year, myFips],
  );

  const total = records.reduce((sum, r) => sum + r.incidents, 0);

  return (
    <section className="fwm-misuse" aria-label="misuse">
      <header className="fwm-misuse-header">
        {/* THE ORIGINAL OF THIS CONTROL, now the shared one. It used to be a
            local button labelled "back", which said that something would move
            and not where to. Same circle, same glyph, same destination - it is
            `components/nav/BackKey.tsx` that draws it now, so the eight screens
            that had no way out at all get exactly this and not an approximation
            of it. */}
        <BackKey to="more" label={BACK_TO_MORE} />
        <ReloadTitle title={MISUSE_TITLE} className="fwm-misuse-title" />
      </header>

      <div className="fwm-misuse-hero">
        <h2 className="fwm-misuse-headline">{MISUSE_HEADLINE}</h2>
        <p className="fwm-misuse-body">{MISUSE_BODY}</p>
        {records.length === 0 ? null : (
          <p className="fwm-misuse-count fwm-data">
            {records.length} records · {total} documented incidents
            {/* WHEN, because a count with no date reads as current.
                This file is a hand-curated set refreshed by a daily patrol, so
                the stamp is the difference between "here is the record" and
                "here is the record, judge its age yourself". `dataAsOf` is the
                same formatter the INTEL card uses - absolute date AND relative
                age, because a bare date makes a reader do arithmetic and a bare
                "13 days ago" is meaningless in a screenshot read next month.
                Omitted rather than guessed when the file states no stamp. */}
            {builtAt === null ? null : <> · updated {builtAt}</>}
          </p>
        )}
      </div>

      <div className="fwm-misuse-filters" role="group" aria-label="filter">
        <button
          type="button"
          className="fwm-misuse-chip"
          data-fwm-selected={String(!near && year === null)}
          onClick={() => {
            setNear(false);
            setYear(null);
          }}
        >
          {FILTER_ALL}
        </button>
        {/* INERT WITHOUT A COUNTY. With no fix, or a fix the county index
            cannot place (outside the US, or the index unreadable), "near me"
            has nothing to compare against - and a chip that silently returned
            everything would read as "nothing near me", which is a claim about
            surveillance records rather than about a missing file. */}
        <button
          type="button"
          className="fwm-misuse-chip"
          disabled={myFips === null}
          data-fwm-selected={String(near)}
          onClick={() => {
            setNear(!near);
          }}
        >
          {FILTER_NEAR}
        </button>
        {years.map((value) => (
          <button
            type="button"
            key={value}
            className="fwm-misuse-chip"
            data-fwm-selected={String(year === value)}
            onClick={() => {
              setYear(year === value ? null : value);
            }}
          >
            {value}
          </button>
        ))}
      </div>

      {records.length === 0 ? <p className="fwm-misuse-note fwm-data">{LOADING}</p> : null}
      {records.length > 0 && shown.length === 0 ? (
        <p className="fwm-misuse-note fwm-data">{NO_MATCHES}</p>
      ) : null}

      <ul className="fwm-misuse-list" aria-label="records">
        {shown.map((record) => (
          <li className="fwm-misuse-card" key={`${record.fips}-${record.agency}-${String(record.year)}`}>
            <div className="fwm-misuse-card-head">
              <span className="fwm-misuse-tag fwm-data">{incidentLabel(record.incidents)}</span>
              <span className="fwm-misuse-year fwm-data">{record.year}</span>
            </div>

            {/* THE AGENCY, never an officer. The file's own rule: a record
                concerns the organisation that holds the database. */}
            <h3 className="fwm-misuse-agency">{record.agency}</h3>
            <p className="fwm-misuse-where fwm-data">
              {gazetteer.county(record.fips)?.label ?? `FIPS ${record.fips}`}
            </p>

            <p className="fwm-misuse-summary">{record.summary}</p>

            {/* THE CITATION IS A REAL LINK. The whole screen rests on a reader
                being able to check it, so it opens - with `noreferrer` so the
                outlet's logs do not record which of our screens sent them. */}
            <a
              className="fwm-misuse-source"
              href={record.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {SOURCE_PREFIX}
              {record.sourceName}
            </a>
          </li>
        ))}
      </ul>

      <p className="fwm-misuse-footer fwm-data">{MISUSE_FOOTER}</p>
    </section>
  );
}
