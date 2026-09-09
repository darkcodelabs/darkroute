/**
 * REPORT - v1. "Drop a camera", as a modal over the map.
 *
 * SOURCE: `the_rest_of_the_app.dc.html`, section B, the right-hand frame
 * ("DROP A CAMERA · was a full sheet, now 282 px tall"). Every number and
 * colour below is written there; `reportV1.css` carries the spec's own pixel
 * beside each token.
 *
 * A VIEW, NOT A SCREEN. `ReportScreen` still owns the GPS fix, the compass
 * seed, the draft reducer, the queue write and every submit blocker; this
 * draws that model.
 *
 * =============================================================================
 * THE ONE-TAP PATH IS POSITION + SIDE + SUBMIT
 * =============================================================================
 * Brief 4: "the one-tap path is position + side + submit; everything else is
 * behind Add detail." So this sheet is 282px of glass over a live map and holds
 * five things - where you are, which side of the road it was on, the key, the
 * row into the rest, and the promise. The heading arc, the mount chips, the
 * photograph, the make and model and the how-far-over chips are all one level
 * deeper, in {@link ReportDetailV1}, and none of them was deleted.
 *
 * =============================================================================
 * WHAT WAS DELETED: THE NEW CAMERA / CONFIRM ONE SWITCH
 * =============================================================================
 * Brief 4 deletes it outright, and the argument is that the product already has
 * that control somewhere better: "Confirming an existing camera is what
 * `Still there` in the camera modal already does. It does not need a second
 * entry point." The camera modal writes `confirm_camera` through the same queue
 * this sheet writes `new_camera` through, from the card that actually shows the
 * driver WHICH camera they would be confirming - which this sheet never did.
 *
 * The consequence, stated so nobody has to rediscover it: `ReportDraft.mode` is
 * now always `new` on the routed view, `reportPayload` therefore always emits
 * `kind: 'new_camera'` with `camera_id: null`, and `withMode` survives for v0's
 * `ModeToggle` alone. Nothing in the container was touched.
 *
 * =============================================================================
 * A LANDMINE IN THE ONE-TAP PATH, FLAGGED AND NOT PAPERED OVER
 * =============================================================================
 * `ReportScreen` builds the subject choice as: `overhead` synthesises an offset
 * of 15ft and is complete on its own; `left` and `right` with no offset chosen
 * resolve to `null`. `projectSubject` then returns null, `reportPayload` emits
 * `subject_position: null`, and `osmBlocker` returns `'no-subject-position'`.
 *
 * So the brief's one-tap path is publishable for OVERHEAD and is not for LEFT
 * or RIGHT: the report files, it signs, it queues, and it can never reach
 * OpenStreetMap. Defaulting an offset for the lateral sides would fix it in one
 * line and it is a DATA decision - it asserts a distance nobody stated, on a
 * record whose entire purpose is to say where a camera is - so it is not made
 * here. The offset chips are one tap away behind `Add detail`, exactly as the
 * brief places them.
 */

import { useState } from 'react';
import type { ReactElement } from 'react';

import { OverlayClose } from '../../../components/overlay/OverlayClose.tsx';
import { SIDE_LABEL } from '../subjectPosition.ts';
import type { SubjectSide } from '../subjectPosition.ts';
import { SUBMIT_LABEL } from './SubmitBlock.tsx';
import type { ReportViewProps } from './ReportView.tsx';
import { ReportDetailV1 } from './ReportDetailV1.tsx';

import '../reportV1.css';

export const REPORT_V1_TITLE = 'Drop a camera';

/**
 * THE PROMISE, and this build's actual behaviour. Every clause is checkable
 * against code, which is the only reason any of them is printed:
 *
 *   nothing is uploaded    - `reportQueue.ts` has no `fetch` and nothing behind
 *                            it does either.
 *   held on this phone     - `pendingReports`, `reportChain`, `reportPhotos`,
 *                            all local stores.
 *   covered by the report  - deliberately not "signed": the bytes are not
 *   signature                themselves signed, their SHA-256 is, and that
 *                            digest is inside the payload the signature covers.
 *
 * It used to carry two more clauses, about a photograph being re-encoded and
 * its location tag stripped. Those moved with the photograph, to
 * {@link ReportDetailV1}'s own note - a promise about a control belongs beside
 * the control, and a sentence about EXIF under a sheet with no camera on it is
 * a sentence nobody reads at the moment it matters.
 *
 * The rule that governs both halves is unchanged and is why this paragraph is
 * this long: the sentence changes in the same commit as the behaviour, or it
 * becomes a lie printed under a submit button.
 */
export const PRIVACY_NOTE =
  'Nothing is uploaded. Held on this phone, covered by the report signature.';

/** Said in the position row when there is no fix to report. */
export const NO_FIX_LABEL = 'Waiting for a position';
export const FIX_LABEL = 'Position locked';

/** The spec's own header over the three-way control. */
export const SIDE_SECTION = 'WHICH SIDE OF THE ROAD';

/** The row that opens the deep sheet, and what the spec says is behind it. */
export const DETAIL_LABEL = 'Add detail';
export const DETAIL_HINT = 'heading, mount, photo, model';

/**
 * Left, Overhead, Right - the spec's order, and it is not alphabetical or
 * arbitrary. The two lateral answers sit either side of the one that means
 * "above the lane", so the control reads as a picture of the road.
 */
const SIDES: readonly SubjectSide[] = ['left', 'overhead', 'right'];

export function ReportViewV1({
  model,
  onClose,
  onAdjustFacing,
  onToggleMount,
  onMakeModelChange,
  onSelectSide,
  onSelectOffset,
  onAttachPhoto,
  onRemovePhoto,
  onSubmit,
}: ReportViewProps): ReactElement {
  const { draft } = model;

  /*
   * `Add detail` IS THIS COMPONENT'S OWN STATE, and it has to be.
   *
   * The sheet holds an UNSENT DRAFT - a facing, a mount, a note, and a
   * photograph the driver may have just taken and cannot take again from the
   * same place - and all of it lives in `ReportScreen`'s `useState`. A second
   * overlay id would render the detail sheet INSTEAD of this one (`App.tsx`
   * draws only the top overlay), which unmounts that container and destroys
   * every one of those values on the way into the screen that exists to edit
   * them. Local state keeps the container mounted, which is the whole
   * requirement.
   */
  const [detail, setDetail] = useState(false);

  return (
    <section
      className="fwm-reportv1"
      data-fwm-report-mode={draft.mode}
      data-fwm-report-muted={model.cameraMuted ? 'true' : 'false'}
      {...(model.cameraId === null ? {} : { 'data-fwm-report-camera': model.cameraId })}
      aria-label="report"
    >
      {/* NO SCRIM, DELIBERATELY, and it is the one place this modal differs
          from the camera modal beside it. The map above this card is visible
          and inert - `.fwm-shell-layer` is `inset: 0` and swallows the touch
          whatever is drawn there - and that is the lesser evil: a card holding
          an unsent report and a photograph must not be dismissed by a thumb
          that grazed the map. The close key is a 44px target at the top right
          and Escape does the same thing. */}
      <div className="fwm-reportv1-card">
        <div className="fwm-reportv1-head">
          <div className="fwm-reportv1-ident">
            {/* A PLAIN `<h1>`, DELIBERATELY. v1's page titles are `ReloadTitle`
                - tap the screen's name, reload the page - and this sheet is one
                of the two places that would be a data-loss bug rather than a
                refresh. None of the draft is persisted until submit. A title
                that silently binned all of it would be the worst kind of
                control: one that looks inert, is not, and destroys work. */}
            <h1 className="fwm-reportv1-title">{REPORT_V1_TITLE}</h1>

            {/* WHERE THE PHONE THINKS IT IS, on one line under the title.
                GREEN ONLY WITH A FIX: the dot is the one glanceable answer to
                "does it know where I am", and a green dot over a missing
                coordinate would be the sheet claiming a position it does not
                have. */}
            <p className="fwm-reportv1-position" data-fwm-fix={String(model.hasFix)}>
              <span className="fwm-reportv1-dot" aria-hidden="true" />
              <span className="fwm-reportv1-position-text fwm-data">
                {/* The spec draws `position locked · ±40 m`. The accuracy is
                    whatever the fix actually reports, through the container's
                    own `positionDetail`, which also carries the satellite count
                    when the platform gives one. */}
                {[model.hasFix ? FIX_LABEL : NO_FIX_LABEL, model.positionDetail]
                  .filter((part): part is string => part !== null)
                  .join(' · ')}
              </span>
            </p>
          </div>

          {/* THE ONE CLOSE KEY. It was written for this sheet first, and every
              other overlay now draws the same component - same round 44px
              target, same accessible name. See
              components/overlay/OverlayClose.tsx. */}
          <OverlayClose onClose={onClose} />
        </div>

        {/* WHICH SIDE OF THE ROAD.
            =================================================================
            THIS IS WHAT MAKES A REPORT PUBLISHABLE.
            Until the driver answers it the report has no camera position at
            all - only the phone's - `subject_position` stays null, and
            `osmBlocker` refuses it. That is why the one-tap path has it and
            why it is the only question on the modal.

            NO HEADING, NO SIDES. "Left" means nothing without knowing which way
            the car was pointing, so with no bearing the two lateral keys are
            inert and OVERHEAD - which needs none - stays live. Assuming a
            heading would put a camera somewhere confident and wrong, which is
            the failure this control exists to end. */}
        <p className="fwm-reportv1-section fwm-data">{SIDE_SECTION}</p>
        <div className="fwm-reportv1-sides" role="group" aria-label="which side of the road">
          {SIDES.map((side) => {
            const needsBearing = side !== 'overhead';
            const off = onSelectSide === undefined || (needsBearing && !model.hasHeading);
            return (
              <button
                key={side}
                type="button"
                className="fwm-reportv1-side"
                data-fwm-report-side={side}
                // `aria-pressed`, not `role="radio"`: none-of-them is the state
                // this sheet opens in and a radio group cannot express it.
                aria-pressed={model.side === side}
                data-fwm-selected={String(model.side === side)}
                disabled={off}
                onClick={
                  off
                    ? undefined
                    : () => {
                        onSelectSide?.(side);
                      }
                }
              >
                {SIDE_LABEL[side]}
              </button>
            );
          })}
        </div>

        {/* THE STATUS LINE IS THE PRODUCT SAYING WHY A SUBMIT IS REFUSED, and
            it comes from the container with its own tone and its own words.
            Nothing here writes one: a sheet that refuses silently is a sheet a
            driver taps four times and gives up on. Directly above the key, and
            nothing may come between the two. */}
        <p
          className="fwm-reportv1-status"
          data-fwm-report-status={model.status === null ? 'none' : model.status.tone}
          role="status"
          aria-live="polite"
        >
          {model.status === null ? null : (
            <>
              <span className="fwm-reportv1-status-dot" aria-hidden="true" />
              <span>{model.status.text}</span>
            </>
          )}
        </p>

        <button
          type="button"
          className="fwm-reportv1-submit"
          disabled={model.submitDisabled || onSubmit === undefined}
          onClick={onSubmit}
        >
          {SUBMIT_LABEL}
        </button>

        {/* THE ROW INTO EVERYTHING ELSE. Its right-hand text names what is
            behind it rather than saying "more": four fields, and a driver who
            has none of them to give should be able to tell that from here. */}
        <button
          type="button"
          className="fwm-reportv1-row"
          aria-expanded={detail}
          onClick={() => {
            setDetail(true);
          }}
        >
          <span className="fwm-reportv1-row-label">{DETAIL_LABEL}</span>
          <span className="fwm-reportv1-row-value fwm-data">{DETAIL_HINT}</span>
          <svg
            className="fwm-reportv1-row-glyph"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9.5 6.5 15 12l-5.5 5.5" />
          </svg>
        </button>

        <p className="fwm-reportv1-promise fwm-data">{PRIVACY_NOTE}</p>
      </div>

      {detail ? (
        <ReportDetailV1
          model={model}
          onClose={() => {
            setDetail(false);
          }}
          onAdjustFacing={onAdjustFacing}
          onToggleMount={onToggleMount}
          onSelectOffset={onSelectOffset}
          onMakeModelChange={onMakeModelChange}
          onAttachPhoto={onAttachPhoto}
          onRemovePhoto={onRemovePhoto}
        />
      ) : null}
    </section>
  );
}
