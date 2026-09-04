/**
 * The bottom of the sheet: the queue line, `SUBMIT REPORT`, and the hold hint.
 *
 * SOURCE: v2 `06 · REPORT`. Pinned with `margin-top:auto`: a 6px amber dot
 * beside `2 REPORTS QUEUED · SYNC ON WIFI`, a 56px filled button now at v2's
 * 8px radius (v1 drew 2px), and `HOLD REPORT BUTTON 1s TO ONE-TAP DROP A PIN`
 * centred under it. Nothing else in this block changed.
 *
 * THE QUEUE LINE IS THE RECEIPT. It is the only thing on this sheet that
 * changes after a successful submit, so it is the live region: the count it
 * reads is measured from disk by `reportQueue.ts`, never incremented in
 * memory. At zero it draws nothing at all, exactly as the REPORT bar draws no
 * `0 QUEUED`.
 *
 * IT IS EMPTY AT ZERO, NEVER HIDDEN AND NEVER UNMOUNTED. This `<p>` is rendered
 * on every state, with its children dropped rather than the element itself, and
 * `report.css` hides it by zeroing its margin rather than with `display:none`.
 * A live region that appears from `display:none` (or from nothing) is announced
 * unreliably across assistive technology, and this is the ONLY feedback that a
 * submit succeeded - the panel draws no confirmation.
 * GAP: see docs/gaps-inbox/report.md#submit-has-no-drawn-confirmation
 *
 * THE HINT IS ABOUT THE DOCK KEY, NOT ABOUT THIS BUTTON. v2 retitled the panel
 * `SHEET FROM THE DOCK KEY`, and the dock spec says of that key: "Tap opens the
 * sheet, 1s hold drops a pin." The hold gesture lives in
 * `components/dock/ReportKey.tsx`; this sheet only tells the driver it exists,
 * because v2 renders the sentence here. The string is v2's, verbatim, and it
 * still says "REPORT BUTTON" - v2 did not reword it when the bar became a key.
 */

import type { ReactElement } from 'react';

import type { ReportStatus } from '../reportDraft.ts';

/** Exact copy from the panel. Do not re-word them. */
export const SUBMIT_LABEL = 'SUBMIT REPORT';
export const HOLD_HINT = 'HOLD REPORT BUTTON 1s TO ONE-TAP DROP A PIN';

export interface SubmitBlockProps {
  /** Null when there is nothing to say: empty queue, nothing blocked. */
  readonly status: ReportStatus | null;
  readonly disabled: boolean;
  readonly onSubmit?: (() => void) | undefined;
}

export function SubmitBlock({ status, disabled, onSubmit }: SubmitBlockProps): ReactElement {
  return (
    <div className="fwm-report-submit-block">
      <p
        className="fwm-report-status"
        data-fwm-report-status={status === null ? 'none' : status.tone}
        role="status"
        aria-live="polite"
      >
        {status === null ? null : (
          <>
            <span className="fwm-report-status-dot" aria-hidden="true" />
            <span className="fwm-report-status-text">{status.text}</span>
          </>
        )}
      </p>

      <button
        type="button"
        className="fwm-report-submit"
        disabled={disabled || onSubmit === undefined}
        onClick={onSubmit}
      >
        {SUBMIT_LABEL}
      </button>

      <p className="fwm-report-hold-hint">{HOLD_HINT}</p>
    </div>
  );
}
