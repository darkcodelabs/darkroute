/**
 * `WHERE WAS IT` - which side of the car, and how far over.
 *
 * =============================================================================
 * THIS IS THE CONTROL THAT MAKES A REPORT PUBLISHABLE
 * =============================================================================
 * Until a driver answers these two questions the report has no camera position
 * at all - only the phone's. `subject_position` stays null, and `osmBlocker`
 * refuses it. That is the correct behaviour and it is why the card says so out
 * loud rather than sitting there looking optional.
 *
 * It follows `MountChips` exactly: filled 8px chips in mono, a radio group that
 * can also be empty, `aria-pressed` carrying the third state honestly because
 * `role="radio"` cannot express "none of them". Pressing the pressed chip
 * clears it, which is the only way back to "I have not said".
 *
 * =============================================================================
 * THE DISTANCE ROW DISAPPEARS FOR OVERHEAD, AND THAT IS THE POINT
 * =============================================================================
 * A gantry camera is above the lane; there is no "how far over" to answer. A
 * disabled row would imply the question still applies and the driver simply
 * cannot answer it. It is removed instead, so the sheet asks exactly the
 * questions that have answers.
 *
 * =============================================================================
 * NO HEADING, NO SIDES
 * =============================================================================
 * "Left" means nothing without knowing which way the car was pointing. When the
 * platform reports no heading the side chips are disabled and the card says
 * why, leaving `OVERHEAD` - which needs no bearing - available. The alternative,
 * assuming a heading, would put a camera somewhere confident and wrong, which
 * is the failure this whole control exists to end.
 */

import type { ReactElement } from 'react';

import {
  OFFSET_LABEL,
  SIDE_LABEL,
  SUBJECT_OFFSETS_FT,
} from '../subjectPosition.ts';
import type { SubjectOffsetFt, SubjectSide } from '../subjectPosition.ts';

export const WHERE_LABEL = 'WHERE WAS IT';
export const WHERE_UNSET = 'NOT SAID · THIS REPORT CANNOT BE MAPPED';
export const WHERE_NO_HEADING = 'NO HEADING · ONLY OVERHEAD CAN BE PLACED';

const SIDES: readonly SubjectSide[] = ['left', 'overhead', 'right'];

export interface WhereChipsProps {
  readonly side: SubjectSide | null;
  readonly offsetFt: SubjectOffsetFt | null;
  /** False disables the two lateral chips - see the header. */
  readonly hasHeading: boolean;
  /** `RIGHT · ONE LANE OVER`, or null when nothing is chosen yet. */
  readonly summary: string | null;
  readonly onSide?: ((side: SubjectSide) => void) | undefined;
  readonly onOffset?: ((offsetFt: SubjectOffsetFt) => void) | undefined;
}

export function WhereChips({
  side,
  offsetFt,
  hasHeading,
  summary,
  onSide,
  onOffset,
}: WhereChipsProps): ReactElement {
  const needsOffset = side !== null && side !== 'overhead';

  return (
    <section className="fwm-report-where" aria-label="where was it">
      <h2 className="fwm-report-label">{WHERE_LABEL}</h2>

      <div className="fwm-report-chips" role="group" aria-label="side">
        {SIDES.map((kind) => {
          const needsBearing = kind !== 'overhead';
          const off = onSide === undefined || (needsBearing && !hasHeading);
          return (
            <button
              key={kind}
              type="button"
              className="fwm-report-chip"
              data-fwm-report-side={kind}
              aria-pressed={side === kind}
              disabled={off}
              onClick={
                off
                  ? undefined
                  : () => {
                      onSide?.(kind);
                    }
              }
            >
              {SIDE_LABEL[kind]}
            </button>
          );
        })}
      </div>

      {needsOffset ? (
        <div className="fwm-report-chips" role="group" aria-label="how far over">
          {SUBJECT_OFFSETS_FT.map((ft) => (
            <button
              key={ft}
              type="button"
              className="fwm-report-chip"
              data-fwm-report-offset={String(ft)}
              aria-pressed={offsetFt === ft}
              disabled={onOffset === undefined}
              onClick={
                onOffset === undefined
                  ? undefined
                  : () => {
                      onOffset(ft);
                    }
              }
            >
              {OFFSET_LABEL[ft]}
            </button>
          ))}
        </div>
      ) : null}

      {/* The state of the answer, in the driver's own words or the reason there
          is not one yet. Never blank: an empty line reads as "fine". */}
      <p
        className="fwm-report-detail fwm-data"
        data-fwm-report-where={summary === null ? 'unset' : 'set'}
      >
        {summary ?? (hasHeading ? WHERE_UNSET : WHERE_NO_HEADING)}
      </p>
    </section>
  );
}
