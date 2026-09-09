/**
 * `TIMELINE` -- one row per camera ENCOUNTER, newest first.
 *
 * SOURCE: `Flockys App Screens.dc.html`, `05 · LOG - EXPOSURE` -- a 56px row:
 * an 8px dot in the alert hue, `Vine St & 7th` at 15px/600, the mono line
 * `14:22:08 · 47 MPH · 380 FT`, and `CONF` (green) or `DISM` (grey) on the
 * right.
 *
 * =============================================================================
 * A ROW IS NOT ALWAYS A PASS
 * =============================================================================
 * The design's middle row is amber (`#FFC02E`, `--fwm-alert-approaching`) at
 * 760 FT against a 500 FT threshold: a camera the driver came up on and never
 * entered range of. `exposure.ts` `cameraEncounters()` decides which rows exist
 * and at which state; this file draws what it is handed and filters nothing.
 * GAP: see docs/gaps-inbox/log.md#timeline-draws-encounters-hero-counts-passes
 *
 * =============================================================================
 * MUTED ROWS ARE ROWS
 * =============================================================================
 * Nothing here filters on `muted`, and no rule in `log.css` dims a muted row.
 * `data-fwm-log-muted` is carried so a test can prove the row is present and
 * identical; it changes nothing that is drawn.
 *   "Muting only removes the alert - never the record."
 *     -- Flockys Screens II.dc.html, B4
 *
 * =============================================================================
 * CONF AND DISM ARE CONTROLS
 * =============================================================================
 * The design draws the ONE word a row ended up with, because every row in the
 * reference is already ruled on. Both keys are rendered here: the recorded
 * outcome is the pressed one and takes the colour the design draws it in, and
 * the other stays reachable, because a row nobody has ruled on yet has to be
 * rulable and a log that cannot be corrected is not a log.
 * GAP: see docs/gaps-inbox/log.md#conf-dism-are-controls-not-a-recorded-word
 *
 * =============================================================================
 * NO PLATE, EVER
 * =============================================================================
 * A row prints a place name that belongs to the CAMERA, a clock time, a speed
 * and a distance. There is no plate on this screen, there is no coordinate in
 * the record it reads, and pressing CONF or DISM writes one enum to a local
 * store -- no network call, no URL, no analytics.
 */

import type { ReactElement } from 'react';

import type { AlertOutcome, AlertState } from '../../../stores';

export interface LogRow {
  /** The history slice's local id -- what `setOutcome` is keyed by. */
  readonly id: number;
  readonly name: string;
  readonly meta: string;
  readonly state: AlertState;
  readonly outcome: AlertOutcome | null;
  /** Recorded, never applied. Present so a test can assert it is not applied. */
  readonly muted: boolean;
}

export interface TimelineProps {
  readonly rows: readonly LogRow[];
  /** What to say when there is nothing in scope. Never a fake row. */
  readonly emptyMessage: string;
  /** Absent means "not wired in this build" -- the keys render disabled. */
  readonly onOutcome?: ((id: number, outcome: AlertOutcome) => void) | undefined;
}

const OUTCOME_KEYS: readonly (readonly [AlertOutcome, string])[] = [
  ['confirmed', 'CONF'],
  ['dismissed', 'DISM'],
];

export function Timeline({ rows, emptyMessage, onOutcome }: TimelineProps): ReactElement {
  if (rows.length === 0) {
    return (
      <div className="fwm-log-empty" data-fwm-log-empty="timeline" role="status">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="fwm-log-timeline" data-fwm-log-rows={String(rows.length)}>
      {rows.map((row) => (
        <li
          key={row.id}
          className="fwm-log-row"
          data-fwm-log-row={String(row.id)}
          data-fwm-log-muted={String(row.muted)}
          data-fwm-log-outcome={row.outcome ?? 'none'}
        >
          <span className="fwm-log-row-dot" data-fwm-log-row-state={row.state} aria-hidden="true" />
          <div className="fwm-log-row-main">
            <div className="fwm-log-row-name">{row.name}</div>
            <div className="fwm-log-row-meta fwm-data">{row.meta}</div>
          </div>
          <div className="fwm-log-row-actions">
            {OUTCOME_KEYS.map(([outcome, label]) => (
              <button
                key={outcome}
                type="button"
                className="fwm-log-outcome"
                data-fwm-log-outcome-key={outcome}
                aria-label={`${label} ${row.name}`}
                aria-pressed={row.outcome === outcome}
                disabled={onOutcome === undefined}
                onClick={
                  onOutcome === undefined
                    ? undefined
                    : () => {
                        onOutcome(row.id, outcome);
                      }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
