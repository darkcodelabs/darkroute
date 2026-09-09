/**
 * The two strips that sit under the header, above the content.
 *
 * COUNTY RECORD -- 34px
 *   "HAMILTON CO · 6 ON RECORD" with a `VIEW` affordance on the right.
 *   "Strip sits under the header, above content, 34px. It replaces the OFFLINE
 *    strip when both apply -- record outranks connectivity. Tapping it opens
 *    RECORD scoped to this county."
 *     -- Flockys Screens II.dc.html, county-entry escalation, panel 2
 *
 * OFFLINE -- 32px
 *   "NO NETWORK · RUNNING ON CACHE" with a pulsing amber dot.
 *     -- Flockys Screens II.dc.html, A2 · OFFLINE - DEGRADED
 *
 * NEITHER SURVIVES A LIVE ALERT. Both are the "any banner" the escalation
 * ladder says a camera alert beats; `RadarView` drops them while the takeover
 * is up rather than stacking them under it.
 *
 * THE COUNTY STRIP CARRIES NO HAPTIC AND NO SOUND. County entry is a
 * notification about a place, not a camera: "Alert haptics are reserved for
 * cameras." Nothing in this file vibrates anything.
 */

import type { ReactElement } from 'react';

import { FEATURES } from '../../../config/features.ts';
import { formatCount } from '../format.ts';

/** What the county strip needs. Never a coordinate -- a name and a count. */
export interface CountyRecord {
  /** As rendered: "HAMILTON CO". Supplied already formatted by its source. */
  readonly label: string;
  /** Documented misuse incidents on record for this county. */
  readonly incidents: number;
}

/**
 * Will the county strip actually draw?
 *
 * Callers need this to decide whether the offline strip is displaced -- "record
 * outranks connectivity" only applies when the record is on screen. Asking the
 * component would mean rendering it to find out, and a flagged-off feature that
 * silently swallowed the offline strip would leave a driver on a stale database
 * with no indication of it.
 */
export function countyStripVisible(record: CountyRecord | null): record is CountyRecord {
  return FEATURES.record && record !== null;
}

export interface CountyRecordStripProps {
  readonly record: CountyRecord | null;
  /** Opens RECORD scoped to this county. Without it the strip is not tappable. */
  readonly onView?: (() => void) | undefined;
}

/**
 * Renders nothing when there is no record to show, and nothing at all while
 * `FEATURES.record` is off.
 *
 * The flag is off because "nothing appears without a citable published source"
 * and the aggregation contract that would carry those citations does not exist
 * yet. A strip that announced a county's record without being able to show the
 * record behind it would be exactly the thing the flag exists to prevent.
 */
export function CountyRecordStrip({ record, onView }: CountyRecordStripProps): ReactElement | null {
  if (!countyStripVisible(record)) return null;

  const label = `${record.label} · ${formatCount(record.incidents)} ON RECORD`;

  return (
    <button
      type="button"
      className="fwm-radar-strip"
      data-fwm-radar-strip="county"
      disabled={onView === undefined}
      onClick={onView}
    >
      <span className="fwm-radar-strip-dot" aria-hidden="true" />
      <span className="fwm-radar-strip-label">{label}</span>
      <span className="fwm-radar-strip-action">VIEW</span>
    </button>
  );
}

export interface OfflineStripProps {
  readonly offline: boolean;
}

/** "NO NETWORK · RUNNING ON CACHE". Not tappable -- A2 draws no affordance on it. */
export function OfflineStrip({ offline }: OfflineStripProps): ReactElement | null {
  if (!offline) return null;

  return (
    <div className="fwm-radar-strip" data-fwm-radar-strip="offline" role="status">
      <span className="fwm-radar-strip-dot" aria-hidden="true" />
      <span className="fwm-radar-strip-label">NO NETWORK · RUNNING ON CACHE</span>
    </div>
  );
}
