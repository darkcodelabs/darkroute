/**
 * `MUTED CAMERAS DON'T DISAPPEAR` -- the invariant, printed on the screen that
 * could most easily break it.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B4 · ALERT TRIAGE - BY OWNER TYPE` --
 * a card with a mono 10px/.18em eyebrow and a mono 11.5px/1.9 body in
 * `--fwm-text-2`. Both strings are verbatim.
 *
 * This is not marketing copy. It is the rule the rest of the product is built
 * to: `features/radar/radarState.ts` keeps a muted camera's distance live and
 * keeps counting it, `stores/history.ts#record` does not look at the mute state
 * before appending, and `features/log/exposure.ts` contains no `muted`
 * predicate. This card is where that behaviour is stated out loud.
 *
 * The sentence names LOOKUP, which is switched off in this build
 * (`config/features.ts`, pending permission). The claim is about the RECORD,
 * not about a screen: the plate-match store is intact and still written to.
 * GAP: see docs/gaps-inbox/triage.md#notice-names-a-flagged-off-screen
 */

import type { ReactElement } from 'react';

/** Verbatim from B4. Exported so a test can assert the exact sentence. */
export const MUTE_NOTICE_TITLE = "MUTED CAMERAS DON'T DISAPPEAR";

/** Verbatim from B4, em dash included. */
export const MUTE_NOTICE_BODY =
  'They still draw on SWEEP in grey, still count in EXPOSURE, still log to ' +
  'LOOKUP. Muting only removes the alert - never the record.';

export function MuteNotice(): ReactElement {
  return (
    <section
      className="fwm-triage-card fwm-triage-notice"
      data-fwm-triage-card="mute-notice"
      aria-label={MUTE_NOTICE_TITLE}
    >
      <div className="fwm-triage-card-label">{MUTE_NOTICE_TITLE}</div>
      <p className="fwm-triage-notice-body">{MUTE_NOTICE_BODY}</p>
    </section>
  );
}
