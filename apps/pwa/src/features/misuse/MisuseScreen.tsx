/**
 * MISUSE - who has abused this, and where.
 *
 * SOURCE: `the_rest_of_the_app.dc.html`, section D, the MISUSE frame.
 *
 * =============================================================================
 * THE RECORDS ARE REAL AND THE DESIGN'S ARE NOT
 * =============================================================================
 * Both design passes ship hand-written cases - the first with invented tags
 * (STALKING, POLITICAL, SOLD DATA), invented camera counts and invented
 * sources; brief 4's frame with three plausible-looking agencies and datelines.
 * Not one of them appears here. What the spec page IS taken from is the shape:
 * the incident count and year on top, the agency at 17/700, the county in
 * tracked caps, three clamped lines of summary and the source at the bottom.
 *
 * What ships is `apps/pwa/public/records/counties.json`, every entry fetched
 * and read by a fact-check pass before it was written, every one carrying a URL
 * a reader can open. Six candidates were REJECTED by that pass - one
 * contradicted by its own source, one unfetchable, four duplicates - and
 * `scripts/check-record-citations.mjs` fails the build if any surviving entry
 * loses its citation.
 *
 * THE COUNTS ARE READ, NOT WRITTEN. This header used to say "47 entries across
 * 38 counties" and the file had grown to 93 records, 125 incidents and 84
 * counties without it - which is exactly why the hero derives every number it
 * prints from `countyRecords.all()` and nothing on this screen states a total
 * as a constant. The spec page's own "93 cases - 125 incidents - updated 3 Sept
 * 2026" is what the shipped file measured on the day it was drawn.
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
 *
 * =============================================================================
 * THE ATLAS BLOCK IS BELOW THE RECORDS, AND THAT PLACEMENT IS AN ARGUMENT
 * =============================================================================
 * The EFF Atlas of Surveillance layer is on this screen because this screen is
 * already county-scoped and already names agencies. It is NOT in the list above,
 * and it never will be, because the two are different claims:
 *
 *   a misuse record  a named agency did a specific thing, and a citation says so
 *   an atlas row     a named agency is recorded as OPERATING this technology
 *
 * 3,574 agencies appear in the Atlas's ALPR set. Almost none of them have been
 * accused of anything. Folding a register of operators into a feed of documented
 * abuse would publish thousands of accusations this product cannot support - the
 * single worst thing this screen could do - so the Atlas gets its own block, its
 * own surface, its own attribution and its own sentence saying which claim it is
 * making.
 *
 * WHY UNDER THE LIST RATHER THAN OVER IT. It reads as the denominator to the
 * numerator above: the county has 26 agencies on record as running plate
 * readers, and 0 documented misuse cases. Landing that immediately before the
 * footer is what makes the footer's point concrete rather than abstract -
 * "undocumented is not clean" means something once a reader has just been shown
 * how many agencies around them are operating and how few have ever been
 * audited. Putting it above the filters would also have broken the
 * filter-then-list adjacency, since the chips do not apply to it and must not.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../components/nav';
import { atlasCounties } from '../../services/records/atlasCounties.ts';
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
 * A driver who reads every record on file and sees their own county absent
 * must not conclude their own agency is clean.
 */
export const MISUSE_FOOTER =
  'this is what has been found and cited, not an audit. a county with nothing on file is ' +
  'undocumented, which is not the same as clean.';

export const SOURCE_PREFIX = 'Source: ';

/**
 * `1 incident` / `3 incidents`. Never "several".
 *
 * SHORTER THAN IT WAS, and the dropped word moved rather than vanishing. This
 * read `3 documented incidents` when it was a full-width tag on its own line;
 * it is a 22px outlined pill at the head of the card now, beside the year, and
 * "documented" is what the hero, the footer and the source line under it all
 * say already. The spec draws `6 incidents`.
 */
export function incidentLabel(count: number): string {
  return `${String(count)} incident${count === 1 ? '' : 's'}`;
}

/* ===========================================================================
 * THE EFF ATLAS BLOCK. See the component header for why it is separate.
 * ======================================================================== */

export const ATLAS_TITLE = 'Recorded as operating ALPR';

/**
 * THE SENTENCE THAT KEEPS THE TWO CLAIMS APART, and it is not decoration.
 *
 * A reader who has just scrolled a list of documented abuses will read the next
 * list of police departments as more of the same unless something says
 * otherwise. This says otherwise, in the first line, before any agency is named.
 */
export const ATLAS_LEDE =
  'a different claim from the records above. an atlas entry is not an allegation - it is a public ' +
  'record that an agency operates this technology. most agencies listed here have never been ' +
  'accused of anything.';

/** Before the file has loaded. Not "the atlas records nothing". */
export const ATLAS_LOADING = 'reading the atlas file.';

/**
 * No county to ask about. The layer is county-scoped and the county is worked
 * out on the device, so this is a missing fix rather than a missing answer.
 */
export const ATLAS_NO_COUNTY =
  'no county yet. this layer is scoped to the county you are in, and that is worked out on the ' +
  'phone - nothing about where you are is sent anywhere to find it.';

/**
 * The file could not be read, which is a fact about a file and NOT about
 * American policing. Rendering this as "nothing recorded" would be a claim made
 * on the strength of a failed fetch.
 */
export const ATLAS_UNREADABLE =
  'the atlas file could not be read. that is a missing file, not an empty atlas.';

/**
 * THE MOST IMPORTANT SENTENCE IN THE BLOCK.
 *
 * The Atlas is compiled from procurement records, council minutes and FOIA by
 * students and volunteers. A county missing from it has not been surveyed and
 * cleared; it has not been surveyed. A bare "0 recorded" would read as an audit,
 * which is exactly the mistake the misuse footer exists to prevent, so the same
 * discipline applies here.
 */
export const ATLAS_NONE_CAVEAT =
  'the atlas is compiled from procurement records, council minutes and public-records requests. ' +
  'it is not a census, and an agency missing from it may operate cameras anyway.';

/** How many agencies are named before the rest are counted rather than listed. */
export const ATLAS_AGENCY_LIMIT = 8;

export const ATLAS_LICENCE_PREFIX = 'Licence as observed: ';

/**
 * "26 agencies recorded as operating ALPR" / "8 recorded deployments across 7
 * agencies".
 *
 * ONE ROW IS ONE AGENCY IN 1,343 OF THE 1,345 COUNTIES IN THE FILE, so the
 * scoped sentence - "N deployments across M agencies" - would print "26
 * deployments across 26 agencies" almost everywhere, which is a tautology
 * dressed as a statistic. It prints both numbers only when they actually
 * differ, which is the honest form of the same claim.
 */
export function deploymentLabel(deployments: number, agencies: number): string {
  if (deployments === agencies) {
    return `${String(agencies)} agenc${agencies === 1 ? 'y' : 'ies'} recorded as operating ALPR`;
  }
  return (
    `${String(deployments)} recorded ALPR deployment${deployments === 1 ? '' : 's'} ` +
    `across ${String(agencies)} agenc${agencies === 1 ? 'y' : 'ies'}`
  );
}

/**
 * The vendor line, or null when there is nothing honest to say.
 *
 * 27.5% of the Atlas's ALPR rows name no vendor, so a bare list would read as
 * the whole picture. When the coverage is partial the count leads, because "8 of
 * 26" is the fact and the names are the detail.
 */
export function vendorLabel(
  vendors: readonly string[],
  vendorKnown: number,
  deployments: number,
): string | null {
  if (vendors.length === 0) return 'no vendor recorded for any of them.';
  const names = vendors.join(', ');
  if (vendorKnown >= deployments) return `vendor: ${names}.`;
  return `vendor recorded for ${String(vendorKnown)} of ${String(deployments)}: ${names}.`;
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
  /*
   * THE ATLAS LOADS ON THE SAME TIMER, not a second one.
   *
   * Both files are fetched on demand by services with no subscription, and two
   * pollers would mean two re-renders a quarter-second apart - which on this
   * screen reads as the counts correcting themselves, and a count that visibly
   * changes after a reader has accepted it is worse than a count that arrives
   * late. The tick waits for BOTH before it stops.
   */
  const [atlasReady, setAtlasReady] = useState(() => atlasCounties.ready());
  const [atlasAt, setAtlasAt] = useState<string | null>(() => dataAsOf(atlasCounties.fetchedAt()));
  useEffect(() => {
    const settled = (): boolean => countyRecords.ready() && atlasCounties.ready();
    const read = (): void => {
      setRecords(countyRecords.all());
      setBuiltAt(dataAsOf(countyRecords.generatedAt()));
      setAtlasReady(atlasCounties.ready());
      setAtlasAt(dataAsOf(atlasCounties.fetchedAt()));
    };
    if (settled()) {
      read();
      return undefined;
    }
    let live = true;
    const timer = globalThis.setInterval(() => {
      if (!settled()) return;
      if (live) read();
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

  /*
   * THE ATLAS ANSWER FOR THIS COUNTY, and the three absences kept apart.
   *
   * `coverageOf` distinguishes "the atlas has rows here", "the atlas has been
   * read and has none here" and "nobody has read the atlas" - which are three
   * different sentences, and rendering the third as the second would be a claim
   * about American policing made on the strength of a failed fetch. The service
   * header sets that rule; this is the screen keeping it.
   *
   * `atlasReady` is in the dependency list because the service holds its answer
   * in module state with no subscription: without it, the memo would be computed
   * once against an unloaded index and never recomputed.
   */
  const atlasCoverage = useMemo(
    () => (atlasReady ? atlasCounties.coverageOf(myFips) : 'unknown'),
    [atlasReady, myFips],
  );
  const atlas = useMemo(
    () => (atlasReady ? atlasCounties.forCounty(myFips) : null),
    [atlasReady, myFips],
  );
  const atlasSource = useMemo(() => (atlasReady ? atlasCounties.source() : null), [atlasReady]);
  const countyLabel = myFips === null ? null : (gazetteer.county(myFips)?.label ?? `FIPS ${myFips}`);

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

      {/* THE HERO, AND IT DOES NOT SCROLL. Three lines: the claim, what a case
          is, and the size of the file - which is measured, never written. */}
      <div className="fwm-misuse-hero">
        <h2 className="fwm-misuse-headline">{MISUSE_HEADLINE}</h2>
        <p className="fwm-misuse-body">{MISUSE_BODY}</p>
        {records.length === 0 ? null : (
          <p className="fwm-misuse-count fwm-data">
            {records.length} cases · {total} incidents
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

      {/* THE SCROLLING BAND. The title track, the hero and the filters are
          fixed; everything below moves under them, and 150px at its foot keeps
          the last card clear of the dock. */}
      <div className="fwm-misuse-band">
        {records.length === 0 ? <p className="fwm-misuse-note fwm-data">{LOADING}</p> : null}
        {records.length > 0 && shown.length === 0 ? (
          <p className="fwm-misuse-note fwm-data">{NO_MATCHES}</p>
        ) : null}

        <ul className="fwm-misuse-list" aria-label="records">
          {shown.map((record) => (
            <li key={`${record.fips}-${record.agency}-${String(record.year)}`}>
              {/* THE WHOLE CARD IS THE TAP TARGET, and that is why the card
                  itself is the anchor.

                  It used to be an `<li>` holding a `<a class="fwm-misuse-
                  source">` at the bottom, so the only reachable thing on a
                  card was one line of 12px text under a fourteen-line body.
                  Brief 4 makes the card the target for "the full case"; the
                  full case is the citation, because that is the only place the
                  detail exists - this app holds one summary per record and
                  publishes no case page of its own. So the card IS the link,
                  there is no anchor nested inside a target, and the source line
                  at the foot names where the press goes before it is pressed.

                  `noreferrer` so the outlet's logs do not record which of our
                  screens sent them. */}
              <a
                className="fwm-misuse-card"
                href={record.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="fwm-misuse-card-head">
                  <span className="fwm-misuse-tag fwm-data">
                    {incidentLabel(record.incidents)}
                  </span>
                  <span className="fwm-misuse-year fwm-data">{record.year}</span>
                </span>

                {/* THE AGENCY, never an officer. The file's own rule: a record
                    concerns the organisation that holds the database. */}
                <span className="fwm-misuse-agency">{record.agency}</span>
                <span className="fwm-misuse-where fwm-data">
                  {gazetteer.county(record.fips)?.label ?? `FIPS ${record.fips}`}
                </span>

                {/* CLAMPED TO THREE LINES by `misuse.css`. The summaries in the
                    record file run from 187 to 1,042 characters, median 435 --
                    fourteen lines, one card per screen, a list nobody can
                    scan. Three lines is enough to know whether this is the case
                    you were looking for; the citation has the rest, and the
                    whole card opens it. Nothing is truncated in the DATA -- the
                    clamp is visual, so a reader who copies the card gets the
                    whole summary. */}
                <span className="fwm-misuse-summary">{record.summary}</span>

                {/* THE CITATION, NAMED RATHER THAN LINKED SEPARATELY. The whole
                    screen rests on a reader being able to check it, and now the
                    entire card opens it -- so this line says WHICH outlet and
                    WHEN, and the chevron says that pressing leaves. */}
                <span className="fwm-misuse-foot">
                  <span className="fwm-misuse-source fwm-data">
                    {SOURCE_PREFIX}
                    {record.sourceName}
                  </span>
                  <span className="fwm-misuse-chevron" aria-hidden="true">
                    {'\u203a'}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>

        {/* ===================================================================
            THE EFF ATLAS. Its own surface, deliberately not a record card.
            ===================================================================
            `--dr-group-line` rather than the record cards' `--dr-card-line`,
            because this block has to be visibly a different KIND of thing from
            the cards above it: an atlas row says an agency OPERATES this
            technology, a record says a named agency did a specific thing, and
            an edge nobody can tell apart would have left it looking like one
            more case. */}
        <section className="fwm-misuse-atlas" aria-label="atlas of surveillance">
          <h3 className="fwm-misuse-atlas-title">{ATLAS_TITLE}</h3>
          <p className="fwm-misuse-atlas-lede fwm-data">{ATLAS_LEDE}</p>

          {!atlasReady ? <p className="fwm-misuse-note fwm-data">{ATLAS_LOADING}</p> : null}

          {atlasReady && myFips === null ? (
            <p className="fwm-misuse-note fwm-data">{ATLAS_NO_COUNTY}</p>
          ) : null}

          {atlasReady && myFips !== null && atlasCoverage === 'unknown' ? (
            <p className="fwm-misuse-note fwm-data">{ATLAS_UNREADABLE}</p>
          ) : null}

          {/* NO DEPLOYMENT ON RECORD, said as two sentences on purpose: the fact,
              then what the fact does not mean. The second is the one that stops a
              driver reading a blank as a clean bill of health. */}
          {atlasCoverage === 'none' && countyLabel !== null ? (
            <>
              <p className="fwm-misuse-atlas-count fwm-data">
                no ALPR deployment recorded in {countyLabel}
              </p>
              <p className="fwm-misuse-note fwm-data">{ATLAS_NONE_CAVEAT}</p>
            </>
          ) : null}

          {atlasCoverage === 'recorded' && atlas !== null && countyLabel !== null ? (
            <>
              <p className="fwm-misuse-atlas-count fwm-data">
                {countyLabel} · {deploymentLabel(atlas.deployments, atlas.agencies.length)}
              </p>
              {/* THE VENDOR COVERAGE IS PRINTED EVEN WHEN IT IS BAD. A quarter of
                  the Atlas's rows name no vendor, and a list with the gap hidden
                  would read as the whole picture. */}
              <p className="fwm-misuse-note fwm-data">
                {vendorLabel(atlas.vendors, atlas.vendorKnown, atlas.deployments)}
              </p>
              <ul className="fwm-misuse-atlas-agencies" aria-label="agencies">
                {atlas.agencies.slice(0, ATLAS_AGENCY_LIMIT).map((agency) => (
                  <li className="fwm-misuse-atlas-agency" key={agency}>
                    {agency}
                  </li>
                ))}
              </ul>
              {/* NOT A "SHOW MORE". The remainder is COUNTED rather than hidden,
                  so the reader knows exactly what is not on screen; a truncation
                  that says nothing about its own size is the kind of quiet
                  under-reporting this product exists to avoid. */}
              {atlas.agencies.length > ATLAS_AGENCY_LIMIT ? (
                <p className="fwm-misuse-note fwm-data">
                  and {atlas.agencies.length - ATLAS_AGENCY_LIMIT} more recorded in the atlas.
                </p>
              ) : null}
            </>
          ) : null}

          {/* ATTRIBUTION IS A LICENCE CONDITION, not a courtesy, and the version
              is deliberately not asserted: eff.org/copyright states CC BY 4.0 in
              prose and CC BY 3.0 US in the rel="license" badge in the same
              paragraph. What ships is what was observed, plus a link so a reader
              can go and see the contradiction for themselves. */}
          {atlasSource === null ? null : (
            <p className="fwm-misuse-atlas-credit fwm-data">
              {atlasSource.attribution}
              {atlasAt === null ? null : <> · retrieved {atlasAt}</>}
              {atlasSource.licenceUrl === '' ? null : (
                <>
                  {' · '}
                  <a
                    className="fwm-misuse-atlas-licence"
                    href={atlasSource.licenceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {ATLAS_LICENCE_PREFIX}
                    {atlasSource.licenceObserved}
                  </a>
                </>
              )}
            </p>
          )}
        </section>

        {/* THE LAST THING READ, and the most important sentence on the screen:
            a county with nothing on file is UNDOCUMENTED, not clean. It sits
            inside the scrolling band because it is the end of the argument the
            list makes, not a fixed footer bar. */}
        <p className="fwm-misuse-footer fwm-data">{MISUSE_FOOTER}</p>
      </div>
    </section>
  );
}
