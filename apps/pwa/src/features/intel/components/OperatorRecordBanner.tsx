/**
 * `OPERATOR HAS A RECORD` -- B9, on the intel card.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B9 · RECORD FLAGS - WHERE IT
 * SURFACES`, panel 1. A destructive-edged card: an 8px dot beside a
 * 10px/.14em mono label, a 14px sentence, and a scan-cyan `SEE THE 3 SOURCES`.
 *
 * =============================================================================
 * THE FLAG COLOURS THE OPERATOR, NOT THE CAMERA
 * =============================================================================
 *   "RECORD only ever states what a citable source states, and always names the
 *    agency -- never an individual. The flag colors the operator, not the
 *    camera, so a flagged agency's cams still alert normally."  -- B9
 *
 * This banner is the only destructive-hued element on the card. It does not
 * touch `--fwm-intel-hue`, the card's top edge, the distance readout or the
 * alert state, and `IntelView.test.tsx` asserts that a flagged card is
 * pixel-identical to an unflagged one everywhere except here.
 *
 * =============================================================================
 * IT DOES NOT RENDER WITHOUT ITS CITATIONS
 * =============================================================================
 * `operatorRecordVisible()` gates on `FEATURES.record`, which is off in this
 * build "until the aggregation contract lands and every displayed entry can
 * carry its citation", and on there being at least one source. An accusation
 * against a named agency with no way to see what it rests on is precisely what
 * the flag exists not to be.
 */

import type { ReactElement } from 'react';

import {
  OPERATOR_RECORD_LABEL,
  operatorRecordVisible,
  operatorSentence,
  operatorSourcesLabel,
} from '../intelState.ts';
import type { OperatorRecord } from '../intelState.ts';

export interface OperatorRecordBannerProps {
  readonly record: OperatorRecord | null;
  /** Opens RECORD scoped to this operator. Without it the link is not shown. */
  readonly onSeeSources?: (() => void) | undefined;
}

export function OperatorRecordBanner({
  record,
  onSeeSources,
}: OperatorRecordBannerProps): ReactElement | null {
  if (!operatorRecordVisible(record)) return null;

  return (
    <section className="fwm-intel-record" aria-label="operator record">
      <div className="fwm-intel-record-head">
        <span className="fwm-intel-record-dot" aria-hidden="true" />
        <span className="fwm-intel-record-label fwm-data">{OPERATOR_RECORD_LABEL}</span>
      </div>

      <p className="fwm-intel-record-summary">{operatorSentence(record)}</p>

      {onSeeSources === undefined ? null : (
        <button
          type="button"
          className="fwm-intel-record-sources fwm-data"
          data-fwm-intel-sources="true"
          onClick={onSeeSources}
        >
          {operatorSourcesLabel(record.sources)}
        </button>
      )}
    </section>
  );
}
