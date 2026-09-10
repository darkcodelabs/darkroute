/**
 * REPORT - v1. `Add detail`, the sheet under the drop-a-camera modal.
 *
 * SOURCE: brief 4, section B. The modal keeps position, side and submit; this
 * is where the rest of the sheet went - "Moves behind `Add detail`: heading
 * arc, four mount chips, photo, make/model", plus the four how-far-over chips,
 * which are the second half of the control the modal's three-way segment is the
 * first half of.
 *
 * =============================================================================
 * NOTHING MOVED THAT COULD NOT MOVE, AND ONE THING HAD TO COME WITH THEM
 * =============================================================================
 * The offset chips are not on the brief's list, and they are here anyway: the
 * modal asks WHICH SIDE and this asks HOW FAR OVER, and the pair is one answer
 * - `projectSubject` needs both before a lateral report has a camera position
 * at all. Leaving the second half on the modal would have been a fourth control
 * on a card the brief cuts to three; deleting it would break the OSM path that
 * `WhereChips` was written to restore. So it is here, one tap from the side
 * that makes it necessary.
 *
 * =============================================================================
 * THE CONTAINER IS STILL MOUNTED WHILE THIS IS OPEN
 * =============================================================================
 * That is why this is a branch of `ReportViewV1` rather than an overlay of its
 * own, and it is not a detail: every value on this sheet lives in
 * `ReportScreen`'s `useState`, including a photograph the driver may have just
 * taken and cannot take again from the same place. A second overlay id would
 * unmount that container on the way in. See the note in `ReportViewV1`.
 */

import type { ReactElement } from 'react';

import { OverlayClose } from '../../../components/overlay/OverlayClose.tsx';
import { MOUNT_KINDS, MOUNT_LABEL } from '../reportDraft.ts';
import { OFFSET_LABEL, SUBJECT_OFFSETS_FT } from '../subjectPosition.ts';
import { FacingDialV1 } from './FacingDialV1.tsx';
import { WHERE_DISTANCE_UNSET, WHERE_NO_HEADING } from './WhereChips.tsx';
import type { PhotoAttachment, PhotoRejection, ReportViewModel } from './ReportView.tsx';

import '../reportDetailV1.css';

export const REPORT_DETAIL_TITLE = 'Add detail';

/** The spec's tracked-caps header over each group. */
export const OFFSET_SECTION = 'HOW FAR OVER';
export const MOUNT_SECTION = 'WHAT IS IT ON';
export const PHOTO_SECTION = 'ONE PHOTOGRAPH';
export const MAKE_MODEL_SECTION = 'MAKE OR MODEL, IF YOU CAN READ IT';

/**
 * What a rejected make-and-model says.
 *
 * `MakeModelIssue` is a code, not a sentence - v0's field sets `aria-invalid`
 * and a data attribute and paints the border, with nothing written. That works
 * on a form where the field has a visible label above it; on a sheet a driver
 * is filling in at the roadside it leaves them retyping the same thing. The
 * WHY is the useful half: the guard is deliberately eager, and knowing that
 * turns a rejection into one rephrase instead of three.
 */
export const MAKE_MODEL_ISSUE = 'that looks like a plate. this field goes to other drivers.';

/** The tile, at rest. One photograph, optional, never a submit blocker. */
export const PHOTO_ADD_LABEL = 'ADD A PHOTO';

/**
 * The tile while `preparePhoto()` is working, and this state is not cosmetic.
 *
 * That call decodes a 12 MP image and runs up to four full JPEG encodes down
 * the quality ladder, which is seconds on a mid-range phone. A button that
 * looks unpressed for seconds is a button a driver taps four times.
 */
export const PHOTO_PREPARING_LABEL = 'PREPARING…';

/** Drops the attachment. The report files either way. */
export const PHOTO_REMOVE_LABEL = 'REMOVE';

/**
 * Said on the attached photograph's facts line.
 *
 * A statement of fact rather than a hope: `PreparedPhoto.metadataStripped` is
 * the literal type `true`, produced by a canvas encoder that had nothing but
 * pixels to write. The bytes in `reportPhotos` are that encoder's output and
 * never the file the camera handed over.
 */
export const METADATA_NOTE = 'METADATA REMOVED';

/**
 * THE PHOTOGRAPH'S OWN HALF OF THE PROMISE, and it is here because the
 * photograph is here.
 *
 * `ReportViewV1.PRIVACY_NOTE` used to carry these two clauses under the submit
 * key, where brief 4 leaves a one-line promise and no camera. A claim about
 * EXIF belongs beside the control that strips it. Both clauses are checkable:
 *
 *   re-encoded before it is  - `preparePhoto()` draws to a canvas and asks the
 *   stored                     encoder for a new file; only that file ever
 *                              reaches `reportPhotos`.
 *   the location tag is gone - the strongest claim the re-encode actually
 *                              supports, and the one a driver cares about.
 */
export const PHOTO_PRIVACY_NOTE =
  'a photo is re-encoded before it is stored, so the location tag your camera wrote into ' +
  'it is gone. it is held on this phone and covered by the report signature.';

/**
 * Why a photograph was refused, in sentences rather than codes.
 *
 * The same argument as {@link MAKE_MODEL_ISSUE}: a driver at the roadside who
 * is told only that something was refused tries the identical thing again.
 * Each sentence names the fix.
 *
 * `unreadable` covers two causes on purpose. `preparePhoto()` returns null for
 * an undecodable file AND for a runtime with no canvas, indistinguishably, so
 * this sentence must not pretend to know which one happened.
 */
export const PHOTO_ISSUE: Readonly<Record<PhotoRejection, string>> = {
  unreadable: 'that file is not a photo this phone can read. try the camera.',
  'too-big': 'that photo is too large to hold in the queue. try one closer in.',
  'no-room': 'too many photos are already waiting to sync. file or clear some first.',
};

/** Bytes per kilobyte. Named because a bare 1024 in a template reads as a size. */
const BYTES_PER_KB = 1024;

/**
 * `1600 × 1200 · 412 KB · METADATA REMOVED`.
 *
 * Rounded UP, so a file that exists never prints `0 KB`. Under-reporting the
 * size of the one thing on this sheet measured in hundreds of kilobytes would
 * be the wrong direction to be wrong in: the driver is deciding whether to
 * carry it in an unsynced queue.
 */
export function photoFacts(photo: Extract<PhotoAttachment, { state: 'attached' }>): string {
  const kb = Math.ceil(photo.sizeBytes / BYTES_PER_KB);
  return `${String(photo.width)} × ${String(photo.height)} · ${String(kb)} KB · ${METADATA_NOTE}`;
}

export interface ReportDetailV1Props {
  readonly model: ReportViewModel;
  /** Back to the modal. Required: this sheet covers the map and the dock. */
  readonly onClose: () => void;
  readonly onAdjustFacing?: ((bearingDeg: number) => void) | undefined;
  readonly onToggleMount?: ((mount: (typeof MOUNT_KINDS)[number]) => void) | undefined;
  readonly onSelectOffset?: ((offsetFt: (typeof SUBJECT_OFFSETS_FT)[number]) => void) | undefined;
  readonly onMakeModelChange?: ((value: string) => void) | undefined;
  readonly onAttachPhoto?: (() => void) | undefined;
  readonly onRemovePhoto?: (() => void) | undefined;
}

export function ReportDetailV1({
  model,
  onClose,
  onAdjustFacing,
  onToggleMount,
  onSelectOffset,
  onMakeModelChange,
  onAttachPhoto,
  onRemovePhoto,
}: ReportDetailV1Props): ReactElement {
  const { draft } = model;
  /* A gantry camera is above the lane; there is no "how far over" to answer.
     The row is REMOVED rather than disabled, so the sheet asks exactly the
     questions that have an answer - which is what `WhereChips` does and why. */
  const needsOffset = model.side !== null && model.side !== 'overhead';
  const missingPosition = !model.hasHeading
    ? WHERE_NO_HEADING
    : needsOffset
      ? WHERE_DISTANCE_UNSET
      : 'Camera position missing · close Add detail and choose left, right, or overhead.';

  return (
    <section className="fwm-reportdetailv1" aria-label="report detail">
      <header className="fwm-reportdetailv1-head">
        <OverlayClose onClose={onClose} />
        {/* NOT a `ReloadTitle`, for the same reason the modal's title is not:
            a reload here bins an unsent draft and a photograph. */}
        <h1 className="fwm-reportdetailv1-title">{REPORT_DETAIL_TITLE}</h1>
      </header>

      <div className="fwm-reportdetailv1-band">
        <FacingDialV1
          facingDeg={draft.facingDeg}
          label={model.facingLabel}
          onAdjust={onAdjustFacing}
        />

        {needsOffset ? (
          <section className="fwm-reportdetailv1-group" aria-label="how far over">
            <p className="fwm-reportdetailv1-section fwm-data">{OFFSET_SECTION}</p>
            <div className="fwm-reportdetailv1-chips" role="group" aria-label="how far over">
              {SUBJECT_OFFSETS_FT.map((ft) => (
                <button
                  key={ft}
                  type="button"
                  className="fwm-reportdetailv1-chip"
                  data-fwm-report-offset={String(ft)}
                  aria-pressed={model.offsetFt === ft}
                  data-fwm-selected={String(model.offsetFt === ft)}
                  disabled={onSelectOffset === undefined}
                  onClick={
                    onSelectOffset === undefined
                      ? undefined
                      : () => {
                          onSelectOffset(ft);
                        }
                  }
                >
                  {OFFSET_LABEL[ft]}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Name the missing camera position and the next action. Side selection
            is on the parent report; the distance choices are on this sheet. */}
        <p
          className="fwm-reportdetailv1-where fwm-data"
          data-fwm-report-where={model.whereSummary === null ? 'unset' : 'set'}
        >
          {model.whereSummary ?? missingPosition}
        </p>

        <section className="fwm-reportdetailv1-group" aria-label="mount">
          <p className="fwm-reportdetailv1-section fwm-data">{MOUNT_SECTION}</p>
          <div className="fwm-reportdetailv1-chips" role="group" aria-label="mount">
            {MOUNT_KINDS.map((mount) => (
              <button
                type="button"
                key={mount}
                className="fwm-reportdetailv1-chip"
                aria-pressed={draft.mount === mount}
                disabled={onToggleMount === undefined}
                data-fwm-selected={String(draft.mount === mount)}
                onClick={() => {
                  onToggleMount?.(mount);
                }}
              >
                {MOUNT_LABEL[mount]}
              </button>
            ))}
          </div>
        </section>

        {/* ONE PHOTOGRAPH.
            `data-fwm-report-photo` is on this wrapper rather than on the tile
            because the `attached` state has no tile to put it on - it is a
            thumbnail, a facts line and a REMOVE key. One attribute in one place
            means one query answers "what state is the photograph in" in all
            four, instead of a test having to know which element exists this
            time. */}
        <section className="fwm-reportdetailv1-group" aria-label="photograph">
          <p className="fwm-reportdetailv1-section fwm-data">{PHOTO_SECTION}</p>
          <div className="fwm-reportdetailv1-photo-block" data-fwm-report-photo={model.photo.state}>
            {model.photo.state === 'attached' ? (
              <div className="fwm-reportdetailv1-photo-attached">
                {/* `alt=""`: this is the driver's own photograph, shown back to
                    them a second after they took it, and the facts line beside
                    it carries everything a screen reader needs. A generated
                    description of a photo of a pole would be noise at best and
                    a guess at worst. */}
                <img
                  className="fwm-reportdetailv1-photo-thumb"
                  src={model.photo.previewUrl}
                  alt=""
                />
                <span className="fwm-reportdetailv1-photo-facts fwm-data">
                  {photoFacts(model.photo)}
                </span>
                <button
                  type="button"
                  className="fwm-reportdetailv1-photo-remove"
                  disabled={onRemovePhoto === undefined}
                  onClick={onRemovePhoto}
                >
                  {PHOTO_REMOVE_LABEL}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="fwm-reportdetailv1-photo"
                // CALLED STRAIGHT FROM THE CLICK. `onAttachPhoto` opens a file
                // picker, and a picker opened outside a user gesture does not
                // open at all - so this must never be wrapped in a timer, a
                // debounce or a promise continuation. No jsdom test would catch
                // it.
                //
                // NOT DISABLED WHILE PREPARING, deliberately.
                // `cameraCapture.capture()` settles on `change`, on `cancel`,
                // on `abort()`, or when a later `capture()` supersedes it.
                // `cancel` on `<input type=file>` is not universal - older
                // Android WebViews and Firefox do not fire it - so on those a
                // driver who backs out of the picker settles nothing, and
                // disabling the button here closed the supersede route as well.
                // The tile then read PREPARING... forever while nothing was
                // being prepared, and ADD A PHOTO was dead until the sheet was
                // closed and reopened.
                //
                // `attachPhoto` bumps a generation on every tap, so the earlier
                // encode drops its own result and a second tap is safe.
                disabled={onAttachPhoto === undefined}
                onClick={onAttachPhoto}
              >
                {model.photo.state === 'preparing' ? PHOTO_PREPARING_LABEL : PHOTO_ADD_LABEL}
              </button>
            )}
            {/* A rejected photograph leaves the tile pressable and says why. The
                report is still filable without one - `submitBlocker()` has never
                heard of a photograph, and the camera on the pole is still worth
                reporting. */}
            {model.photo.state === 'rejected' ? (
              <span className="fwm-reportdetailv1-issue fwm-data" role="alert">
                {PHOTO_ISSUE[model.photo.reason]}
              </span>
            ) : null}
          </div>
        </section>

        <label className="fwm-reportdetailv1-field">
          <span className="fwm-reportdetailv1-section fwm-data">{MAKE_MODEL_SECTION}</span>
          <input
            className="fwm-reportdetailv1-input"
            type="text"
            value={draft.makeModel}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={model.makeModelIssue !== null}
            data-fwm-report-make-model={model.makeModelIssue ?? 'ok'}
            readOnly={onMakeModelChange === undefined}
            onChange={(event) => {
              onMakeModelChange?.(event.target.value);
            }}
          />
          {/* The container's own validation sentence, never a second one. */}
          {model.makeModelIssue === null ? null : (
            <span className="fwm-reportdetailv1-issue fwm-data" role="alert">
              {MAKE_MODEL_ISSUE}
            </span>
          )}
        </label>

        <p className="fwm-reportdetailv1-promise fwm-data">{PHOTO_PRIVACY_NOTE}</p>
      </div>
    </section>
  );
}
