/**
 * LOOK UP - v1.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isLookup` block.
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
 */

import { useDeferredValue, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { CameraOwnerType } from '../../services/db/schema.ts';
import { useCachedCameraCount, useCachedCameras, useCurrentFix } from '../../stores/index.ts';
import { openIntelCard } from '../intel';
import { OWNER_LABELS } from '../triage/triage.ts';

import { PlateHandoffV1 } from './PlateHandoffV1.tsx';
import { formatDistance, placeOf, searchCameras } from './search.ts';
import { ReloadTitle } from '../../components/nav';

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

const OWNERS: readonly CameraOwnerType[] = [
  'police',
  'inter_agency',
  'hoa',
  'private',
  'unverified',
];

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

  const loaded = cached !== null && cached > 0;

  return (
    <section className="fwm-lookupv1" aria-label="look up">
      <header className="fwm-lookupv1-header">
        {/* NO BACK KEY, and the history here is worth keeping. LOOK UP was a
            dock key in v0, became a MORE tile in v1 -- which is how it ended up
            with no way out, since nothing needed one while the dock pointed
            here -- and is a dock key again now that SEARCH is in the bar. It is
            a root once more: its own key is lit while it is on top, exactly
            like DRIVE, LOG, MESH and MORE, and the only parent a root has is
            itself. `backAffordance.source.test.ts` holds this to the dock. */}
        <ReloadTitle title={LOOKUP_V1_TITLE} className="fwm-lookupv1-title" />
      </header>

      <div className="fwm-lookupv1-field">
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

      <div className="fwm-lookupv1-filters" role="group" aria-label="owner">
        <button
          type="button"
          className="fwm-lookupv1-chip"
          data-fwm-selected={String(owner === null)}
          onClick={() => {
            setOwner(null);
          }}
        >
          All owners
        </button>
        {OWNERS.map((ownerType) => (
          <button
            type="button"
            key={ownerType}
            className="fwm-lookupv1-chip"
            data-fwm-selected={String(owner === ownerType)}
            onClick={() => {
              setOwner(owner === ownerType ? null : ownerType);
            }}
          >
            {OWNER_LABELS[ownerType]}
          </button>
        ))}
      </div>

      {/* THE COUNT SAYS WHAT IT COUNTED. "6 matches" alone would leave a driver
          to assume it searched everything; this says which everything. */}
      <p className="fwm-lookupv1-count">
        <span className="fwm-lookupv1-count-figure">{hits.length}</span>
        <span className="fwm-lookupv1-count-body fwm-data">
          {loaded
            ? `matching, searched against the ${String(cached)} cameras on this phone`
            : NOT_LOADED}
        </span>
      </p>

      {loaded && hits.length === 0 ? (
        <p className="fwm-lookupv1-empty fwm-data">{NO_MATCHES}</p>
      ) : null}

      <ul className="fwm-lookupv1-results" aria-label="results">
        {hits.map((hit) => (
          <li key={hit.camera.id}>
            <button
              type="button"
              className="fwm-lookupv1-result"
              onClick={() => {
                // The camera detail, which is a real screen with real actions.
                openIntelCard(hit.camera.id);
              }}
            >
              <span
                className="fwm-lookupv1-dot"
                data-fwm-owner={hit.camera.ownerType ?? 'unknown'}
                aria-hidden="true"
              />
              <span className="fwm-lookupv1-where">
                <span className="fwm-lookupv1-place">{placeOf(hit.camera)}</span>
                <span className="fwm-lookupv1-owner fwm-data">
                  {hit.camera.ownerType === undefined
                    ? 'owner unrecorded'
                    : OWNER_LABELS[hit.camera.ownerType]}
                </span>
              </span>
              <span className="fwm-lookupv1-dist fwm-data">
                {formatDistance(hit.metres) ?? NO_FIX}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* v0's LOOKUP, kept whole and rendered inline. See `plateOpen`. */}
      <button
        type="button"
        className="fwm-lookupv1-plate"
        aria-expanded={plateOpen}
        onClick={() => {
          setPlateOpen(!plateOpen);
        }}
      >
        <span className="fwm-lookupv1-where">
          <span className="fwm-lookupv1-place">{PLATE_LABEL}</span>
          <span className="fwm-lookupv1-owner fwm-data">{PLATE_SUB}</span>
        </span>
        <span className="fwm-lookupv1-chevron" aria-hidden="true">
          {plateOpen ? '\u2039' : '\u203a'}
        </span>
      </button>

      {plateOpen ? (
        <PlateHandoffV1 />
      ) : null}
    </section>
  );
}
