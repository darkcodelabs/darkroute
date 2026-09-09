/**
 * LOOK UP - names first, ids in mono.
 *
 * SOURCE: `the_rest_of_the_app.dc.html`, section C, frame 2.
 *
 * =============================================================================
 * THIS IS A DIFFERENT QUESTION FROM v0'S LOOKUP
 * =============================================================================
 * v0's LOOKUP asks "has an operator searched my plate?", which only
 * haveibeenflocked.com can answer, so that screen is a hand-off. v1's asks
 * "where are the cameras near here?", which this device can answer completely,
 * offline, from the archive it already holds.
 *
 * Both are real and neither replaces the other, so BOTH are here: the search is
 * the screen, and the plate hand-off opens behind a row at the bottom.
 * Dropping it to make room would have removed the only route to a question the
 * product cannot answer any other way.
 *
 * =============================================================================
 * "SEARCHES OFFLINE" IS THE CLAIM, AND IT IS ENFORCED
 * =============================================================================
 * `LookupV1Screen.source.test.ts` reads this file and fails on `fetch(`,
 * `XMLHttpRequest`, `axios`, `EventSource(` or `WebSocket(`, the same way v0's
 * does. A search screen that quietly gained a network call would break the one
 * promise that makes it worth having.
 *
 * =============================================================================
 * WHAT BRIEF 4 CHANGED
 * =============================================================================
 * THE ROW LEADS WITH A NAME. "`osm:12425289022` is a database key, not a name."
 * The title is the cross street, the operator where there is no cross street,
 * and `unnamed pole` where there is neither - see `rowTitleOf`. The id is still
 * on the row and still quotable, one line down, in mono at 11.5 faint.
 *
 * THE OWNER MOVED FROM THE SUBLINE TO THE DOT. It was a second line of text on
 * every row, which is where it went when the street became the card header.
 * The spec draws it as a 9px mark in that class's own hue at the head of the
 * row - the same vocabulary the chips above the list are coloured in, so the
 * filter and the result it produced are the same colour rather than the same
 * word twice.
 *
 * THE CHIPS SCROLL, AND THEY END IN AN 8PX GUTTER. "A partial chip must read as
 * more-to-the-right, never as a cut glyph."
 *
 * THE COUNT LINE SAYS WHAT IT SEARCHED, AND HOW IT ORDERED IT. See
 * `orderingNote` below for the one place this screen refuses the spec's copy.
 */

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { gazetteer } from '../../services/cameras/gazetteer.ts';
import type { CameraOwnerType, CameraRecord } from '../../services/db/schema.ts';
import { atlasCounties } from '../../services/records/atlasCounties.ts';
import { useCachedCameraCount, useCachedCameras, useCurrentFix } from '../../stores/index.ts';
import { openIntelCard } from '../intel';

import { aroundSummary, headLineOf, makerLineOf } from './around.ts';
import { PlateHandoffV1 } from './PlateHandoffV1.tsx';
import { formatDistance, searchCameras } from './search.ts';
import { contextLineOf, detailLineOf, groupByStreet, groupListLabel, rowTitleOf } from './streetGroups.ts';
import { ReloadTitle } from '../../components/nav';
import { ScreenChevron } from '../../components/screen';

import '../../styles/screen.css';
import './lookupV1.css';

export const LOOKUP_V1_TITLE = 'Look up';
export const LOOKUP_V1_PLACEHOLDER = 'street, cross street, or camera id';

/** The badge on the field. The claim, and the reason this screen exists. */
export const LOCAL_BADGE = 'LOCAL';

export const PLATE_LABEL = 'Has an operator searched my plate?';
export const PLATE_SUB = 'a different question, and only haveibeenflocked.com can answer it';

/** Said before the archive has loaded, which is not the same as no matches. */
export const NOT_LOADED = 'the camera archive has not loaded on this device yet.';
export const NO_MATCHES = 'nothing on this phone matches that.';

/** Said where a distance would go with no fix to measure from. */
export const NO_FIX = 'no fix';

/** The chip that clears the filter. `All`, as the spec writes it. */
export const ALL_OWNERS = 'All';

/** The kicker on the card above the rows. See `around.ts` for what is on it. */
export const AROUND_KICKER = 'AROUND YOU';

/** How often the screen looks to see whether the two record files have landed. */
const RECORDS_POLL_MS = 400;

/**
 * THE CHIP LABELS, AND WHY THEY ARE NOT THE SPEC'S FOUR.
 *
 * The spec's `owners` block lists four chips: Flock, Police, Private,
 * Unverified. The archive's own taxonomy is five and it is a different five -
 * `CameraOwnerType` is `police | inter_agency | hoa | private | unverified`,
 * and there is no `flock` class on a camera record at all.
 *
 * Shipping the spec's four literally would do two bad things at once: a `Flock`
 * chip would filter on a class no record can carry and would therefore always
 * return nothing, and `inter_agency` and `hoa` would lose their chips - so a
 * driver could no longer filter to the HOA reader they are standing under, on
 * the screen whose whole claim is that it can find everything this phone holds.
 * That is a capability deleted to match a picture.
 *
 * So the spec's SHORTENING RULE is what ships rather than its list: the first
 * word of the class, in title case, which is exactly how it got `Police`,
 * `Private` and `Unverified` out of `POLICE / AGENCY`, `PRIVATE / BUSINESS`
 * and `UNVERIFIED REPORTS`. Applied to all five, that is the map below. The
 * dot beside each one carries the class's own hue, which is the part of the
 * spec's chip that does the real work.
 *
 * `OWNER_LABELS` in `triage/triage.ts` is untouched: ALERT DIET is a settings
 * screen with room for `HOA / NEIGHBORHOOD`, and a 32px chip is not.
 */
export const OWNER_CHIP_LABELS: Readonly<Record<CameraOwnerType, string>> = Object.freeze({
  police: 'Police',
  inter_agency: 'Shared',
  hoa: 'HOA',
  private: 'Private',
  unverified: 'Unverified',
});

const OWNERS: readonly CameraOwnerType[] = [
  'police',
  'inter_agency',
  'hoa',
  'private',
  'unverified',
];

/**
 * `1,010`, the way the spec writes it.
 *
 * The count line is the one place on this screen a four-figure number is read
 * rather than scanned, and an ungrouped `1010` is read as a code. Grouped with
 * the device's own locale separator rather than a hardcoded comma: this ships
 * to phones that write it as `1.010` and to phones that write it as `1 010`.
 */
function grouped(count: number): string {
  return count.toLocaleString();
}

export function LookupV1Screen(): ReactElement {
  const cameras = useCachedCameras();
  const cached = useCachedCameraCount();
  const fix = useCurrentFix();

  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState<CameraOwnerType | null>(null);
  /**
   * Whether the plate hand-off is open.
   *
   * IT IS EMBEDDED, NOT LINKED. v1 registers this component under the `lookup`
   * id, so `openScreen('lookup')` from here would navigate to this screen -
   * a key that appears to go somewhere and returns you to where you already
   * are. `PlateHandoffV1` is that hand-off in v1 chrome, importing `handoff.ts`
   * whole so the copy-then-open order, the no-plate-in-a-URL rule and the
   * noopener/noreferrer open are all the same code v0 runs.
   */
  const [plateOpen, setPlateOpen] = useState(false);

  // The scan is fast but it is not free, and it runs on every keystroke.
  // Deferring it keeps the field itself responsive under a thumb.
  const deferred = useDeferredValue(query);

  const at = fix === null ? null : { lat: fix.lat, lon: fix.lon };

  const hits = useMemo(
    () => searchCameras({ cameras, query: deferred, ownerType: owner, at }),
    [cameras, deferred, owner, at],
  );

  // THE STREETS ARE DERIVED FROM THE HITS, not searched for separately. Every
  // row the flat list drew is in exactly one group and no group holds anything
  // that was not a hit, so the badge on a card and the figure at the top of the
  // screen are two readings of one array and cannot disagree.
  const groups = useMemo(() => groupByStreet(hits), [hits]);

  /*
   * THE TWO RECORD FILES THE CARD READS -- the gazetteer for the county's name,
   * the EFF Atlas for who is on record running ALPR there. Both are on the
   * phone, both load themselves the first time they are asked, and neither
   * publishes a change when the bytes land; MISUSE waits for them the same
   * way. Until they have, the card simply has no county and no Atlas line --
   * `aroundSummary` treats `unknown` as nothing to say, never as "none".
   */
  const [recordsReady, setRecordsReady] = useState(() => atlasCounties.ready() && gazetteer.ready());
  useEffect(() => {
    if (recordsReady) return;
    /* ASKING IS WHAT STARTS THE LOAD. Neither store fetches until something
       asks it a question; the gazetteer is asked below for every render, but
       the Atlas was only asked once it was already ready, which is never. */
    atlasCounties.coverageOf(undefined);
    const timer = setInterval(() => {
      if (atlasCounties.ready() && gazetteer.ready()) setRecordsReady(true);
    }, RECORDS_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [recordsReady]);

  const around = useMemo(
    () =>
      aroundSummary({
        hits,
        hasFix: fix !== null,
        countyLabel: (fips) => gazetteer.county(fips)?.label ?? null,
        atlas: (fips) => ({
          coverage: recordsReady ? atlasCounties.coverageOf(fips) : 'unknown',
          county: recordsReady ? atlasCounties.forCounty(fips) : null,
        }),
      }),
    [hits, fix, recordsReady],
  );
  const makerLine = around === null ? null : makerLineOf(around.makers);

  const loaded = cached !== null && cached > 0;

  /**
   * `of 1,010 on this phone - nearest first`, MINUS THE HALF THAT CAN BE FALSE.
   *
   * `searchCameras` orders by distance when there is a fix and BY ID when there
   * is not, so it cannot reshuffle between renders. The spec's line claims
   * "nearest first" unconditionally, and with the GPS off - a cold start, a
   * denied permission, indoors - that is the screen stating an order it did not
   * apply, directly above a column of rows that each read `no fix`.
   *
   * So the ordering clause is printed only when it is true. The denominator,
   * which is the part of the line that matters, is printed either way.
   */
  const orderingNote = fix === null ? '' : ' · nearest first';

  return (
    <section className="fwm-screen fwm-lookupv1" aria-label="look up">
      {/* NO BACK KEY, and the history here is worth keeping. LOOK UP was a
          dock key in v0, became a MORE tile in v1 -- which is how it ended up
          with no way out, since nothing needed one while the dock pointed
          here -- and is a dock key again now that SEARCH is in the bar. It is
          a root once more: its own key is lit while it is on top, exactly
          like DRIVE, LOG, MESH and MORE, and the only parent a root has is
          itself. `backAffordance.source.test.ts` holds this to the dock.

          The spec's 40px exit circle is not drawn here for that reason. See
          `MoreScreen.tsx` for the whole of the argument and the open question. */}
      <div className="fwm-screen-title">
        <ReloadTitle title={LOOKUP_V1_TITLE} className="fwm-screen-title-text" />
      </div>

      <div className="fwm-screen-band fwm-lookupv1-band">
        <div className="fwm-lookupv1-field">
          {/* The 17px lens. Its stroke inherits the field's placeholder tier so
              the glyph and the words beside it are one object. */}
          <svg
            className="fwm-lookupv1-lens"
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m15.8 15.8 4.2 4.2" />
          </svg>
          <input
            className="fwm-lookupv1-input"
            type="search"
            value={query}
            placeholder={LOOKUP_V1_PLACEHOLDER}
            aria-label={LOOKUP_V1_TITLE}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {/* NOT DECORATION. It is the difference between this screen and every
              other search box on a phone, and it is true. */}
          <span className="fwm-lookupv1-badge fwm-data">{LOCAL_BADGE}</span>
        </div>

        <div className="fwm-screen-scroller fwm-lookupv1-filters" role="group" aria-label="owner">
          <button
            type="button"
            className="fwm-screen-chip"
            data-fwm-selected={String(owner === null)}
            onClick={() => {
              setOwner(null);
            }}
          >
            {ALL_OWNERS}
          </button>
          {OWNERS.map((ownerType) => (
            <button
              type="button"
              key={ownerType}
              className="fwm-screen-chip"
              data-fwm-selected={String(owner === ownerType)}
              onClick={() => {
                setOwner(owner === ownerType ? null : ownerType);
              }}
            >
              <span
                className="fwm-screen-chip-dot"
                data-fwm-owner={ownerType}
                aria-hidden="true"
              />
              {OWNER_CHIP_LABELS[ownerType]}
            </button>
          ))}
          {/* THE 8PX TRAILING GUTTER, and it is an element rather than a
              padding on purpose: every engine collapses a scroll container's
              end padding at the end of the scroll range, which is exactly the
              moment this exists for. */}
          <span className="fwm-screen-scroller-tail" aria-hidden="true" />
        </div>

        {/* THE COUNT SAYS WHAT IT COUNTED. "40 matches" alone would leave a
            driver to assume it searched everything; this says which everything,
            and how many of them are on the phone. */}
        <p className="fwm-lookupv1-count">
          <span className="fwm-lookupv1-count-figure fwm-data">{hits.length}</span>
          <span className="fwm-lookupv1-count-body fwm-data">
            {loaded ? `of ${grouped(cached)} on this phone${orderingNote}` : NOT_LOADED}
          </span>
        </p>

        {loaded && hits.length === 0 ? (
          <p className="fwm-lookupv1-empty fwm-data">{NO_MATCHES}</p>
        ) : null}

        {/* AROUND YOU. The reading a driver takes before the rows: which town,
            how far to the nearest, how many inside the dock's two miles, whose
            hardware, and who in this county is on record running it. Computed
            from the same ranked hits the rows are, so it cannot describe a
            different set of cameras than the list under it. */}
        {around === null ? null : (
          <section className="fwm-lookupv1-around" aria-label="around you">
            <div className="fwm-lookupv1-around-top">
              <span className="fwm-lookupv1-around-kicker fwm-data">{AROUND_KICKER}</span>
              {around.county === null ? null : (
                <span className="fwm-lookupv1-around-county fwm-data">{around.county}</span>
              )}
            </div>
            <p className="fwm-lookupv1-around-head">{headLineOf(around)}</p>
            {makerLine === null ? null : (
              <p className="fwm-lookupv1-around-line fwm-data">{makerLine}</p>
            )}
            {around.atlasLine === null ? null : (
              <p className="fwm-lookupv1-around-line">{around.atlasLine}</p>
            )}
          </section>
        )}

        {/* THE STREET IS THE HEADING AND THE CAMERAS ON IT ARE THE ROWS.
            This was forty rows in one column, each led by its operator, which
            told a driver whose camera each one was and never told them that six
            of the forty are on the road they are about to turn onto. The
            grouping key, what happens to the quarter of the archive that has no
            street at all, and why nothing in here sorts, are all argued in
            `streetGroups.ts`.

            The heading is a 34px tracked-caps line with a count at its tail
            rather than a bordered card head: brief 4 gives this section one
            surface, the 44px row, and a card around a run of rows would be a
            second one.

            The OUTER list keeps `aria-label="results"`: it is the same list of
            results it always was, and the tests that read this screen find it
            by that name. */}
        <ul className="fwm-lookupv1-results" aria-label="results">
          {groups.map((group) => (
            <li
              key={group.key}
              className="fwm-lookupv1-group"
              /* False on the one group that is a note about the archive rather
                 than a place, so the stylesheet can stop it looking like a road
                 name. Nothing else branches on it. */
              data-fwm-street={String(group.isStreet)}
            >
              <div className="fwm-lookupv1-group-head">
                <h2 className="fwm-lookupv1-street">{group.label}</h2>
                {/* THE COUNT COUNTS THE ROWS BELOW IT AND NOTHING ELSE. It is
                    `group.hits.length`, so it cannot claim a number the group
                    does not then draw - which matters because `searchCameras`
                    caps the whole list at 40 and a street can be truncated by
                    that cap. */}
                <span className="fwm-lookupv1-tally fwm-data">{group.hits.length}</span>
              </div>

              {/* The count is a bare numeral to a screen reader. The list it
                  counts says the same thing in words. */}
              <ul className="fwm-lookupv1-rows" aria-label={groupListLabel(group)}>
                {group.hits.map((hit) => (
                  <li key={hit.camera.id}>
                    <button
                      type="button"
                      className="fwm-screen-row fwm-lookupv1-result"
                      data-fwm-lead="mark"
                      onClick={() => {
                        // The camera detail, which is a real screen with real actions.
                        openIntelCard(hit.camera.id);
                      }}
                    >
                      {/* WHOSE, as a mark. `unknown` is not `unverified`:
                          absent and unverified are different facts about a
                          camera, and the mark is grey for the first. */}
                      <span
                        className="fwm-screen-dot"
                        data-fwm-owner={ownerAttrOf(hit.camera)}
                        aria-hidden="true"
                      />
                      <span className="fwm-lookupv1-where">
                        <span className="fwm-lookupv1-place">{rowTitleOf(hit.camera)}</span>
                        {/* WHAT ELSE THE RECORD KNOWS: maker, mount, which way
                            it looks, the town. The id it used to print is on
                            the intel card, where a driver reporting a bad
                            record goes anyway. See `contextLineOf`. */}
                        <span className="fwm-lookupv1-context">{contextLineOf(hit.camera)}</span>
                        <span className="fwm-lookupv1-detail">{detailLineOf(hit.camera)}</span>
                      </span>
                      <span className="fwm-lookupv1-dist fwm-data">
                        {formatDistance(hit.metres) ?? NO_FIX}
                        {hit.bearing === undefined || hit.bearing === null ? null : (
                          <span className="fwm-lookupv1-bearing">{hit.bearing}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {/* v0's LOOKUP, kept whole and rendered inline. See `plateOpen`. */}
        <button
          type="button"
          className="fwm-screen-row fwm-lookupv1-plate"
          aria-expanded={plateOpen}
          onClick={() => {
            setPlateOpen(!plateOpen);
          }}
        >
          <span className="fwm-screen-row-title fwm-lookupv1-plate-label">{PLATE_LABEL}</span>
          <span className="fwm-screen-row-meta fwm-data">{PLATE_SUB}</span>
          <ScreenChevron />
        </button>

        {plateOpen ? <PlateHandoffV1 /> : null}
      </div>

      <div className="fwm-screen-dock-reserve" aria-hidden="true" />
    </section>
  );
}

/**
 * The value the owner mark's hue is selected on.
 *
 * `unknown` rather than the empty string, so the stylesheet's default - grey,
 * the absence - is reached by NOT matching any owner rule rather than by
 * matching an attribute that happens to be blank.
 */
function ownerAttrOf(camera: CameraRecord): string {
  return camera.ownerType ?? 'unknown';
}
