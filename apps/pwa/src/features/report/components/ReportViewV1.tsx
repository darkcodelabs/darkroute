/**
 * REPORT - v1. "Drop a camera."
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isReport` block.
 *
 * A VIEW, NOT A SCREEN. `ReportScreen` still owns the GPS fix, the compass
 * seed, the draft reducer, the queue write and every submit blocker; this
 * draws that model as v1's bottom sheet.
 *
 * =============================================================================
 * NO v0 COMPONENT IS RENDERED HERE
 * =============================================================================
 * This used to mount `FacingDial` and `SubmitBlock`, both of which are v0's
 * chrome. `FacingDialV1` and the submit block below replace them and import
 * every hard part rather than reimplementing it: `facing.ts` still owns the
 * wedge geometry, the click-to-bearing maths, the step sizes and the ARIA
 * bounds, and the status line is still the container's `ReportStatus` with its
 * own tone and its own words.
 *
 * =============================================================================
 * THE PROMISE AT THE BOTTOM IS LOAD-BEARING
 * =============================================================================
 * It used to read "only the pin and the heading are sent. no photo, and no
 * record of you having been here." Both halves are now wrong, and each one is
 * wrong in a different way.
 *
 * "are sent" promised a transmission this app has never been able to make -
 * there is no `fetch` in `reportQueue.ts` and no upload path behind it. A
 * report is signed and held on the phone.
 *
 * "no photo, and no record of you having been here" was defensible while the
 * sheet held a pin and a bearing. This sheet attaches one photograph: the
 * driver presses ADD A PHOTO, `preparePhoto()` re-encodes it through a canvas
 * so the file that reaches disk carries none of the camera's EXIF, its SHA-256
 * goes into the signed payload's `photo` field, and its bytes go into the
 * `reportPhotos` store under the report id. A photograph of a real place, on
 * disk, IS a record of somebody having been there - so that clause could not
 * survive the feature, and {@link PRIVACY_NOTE} says what is true instead.
 *
 * The rule the old comment stated still holds and is the reason this paragraph
 * is this long: the sentence changes in the same commit as the behaviour, or it
 * becomes a lie printed under a submit button.
 */

import type { ReactElement } from 'react';

import { OverlayClose } from '../../../components/overlay/OverlayClose.tsx';
import { MOUNT_KINDS, MOUNT_LABEL } from '../reportDraft.ts';
import { FacingDialV1 } from './FacingDialV1.tsx';
import { WhereChips } from './WhereChips.tsx';
import { HOLD_HINT, SUBMIT_LABEL } from './SubmitBlock.tsx';
import type { PhotoAttachment, PhotoRejection, ReportViewProps } from './ReportView.tsx';

import '../reportV1.css';

export const REPORT_V1_TITLE = 'Drop a camera';

export const MODE_NEW = 'New camera';
export const MODE_CONFIRM = 'Confirm one';

/**
 * The promise, and this build's actual behaviour. Every clause is checkable
 * against code, which is the only reason any of them is printed:
 *
 *   nothing is uploaded          - `reportQueue.ts` has no `fetch` and nothing
 *                                  behind it does either.
 *   held on this phone           - `pendingReports`, `reportChain`,
 *                                  `reportPhotos`, all local stores.
 *   covered by the report        - deliberately not "signed": the bytes are not
 *   signature                     themselves signed, their SHA-256 is, and that
 *                                  digest is inside the payload the signature
 *                                  covers.
 *   re-encoded before it is      - `preparePhoto()` draws to a canvas and asks
 *   stored                        the encoder for a new file; only that file
 *                                  ever reaches `reportPhotos`.
 *   the location tag is gone     - the strongest claim the re-encode actually
 *                                  supports, and the one a driver cares about.
 *
 * See the header before editing a word of it.
 */
export const PRIVACY_NOTE =
  'nothing is uploaded. the pin, the heading and any photo you attach are held on this ' +
  'phone and covered by the report signature. a photo is re-encoded before it is stored, ' +
  'so the location tag your camera wrote into it is gone.';

/** Said in the position row when there is no fix to report. */
export const NO_FIX_LABEL = 'Waiting for a position';
export const FIX_LABEL = 'Position locked';

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

/** Said under CONFIRM when nothing is close enough to be the subject. */
export const NOTHING_TO_CONFIRM =
  'no camera near enough to confirm. the new-camera side works without one.';

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

export function ReportViewV1({
  model,
  onClose,
  onSelectMode,
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

  return (
    <section
      className="fwm-reportv1"
      data-fwm-report-mode={draft.mode}
      data-fwm-report-muted={model.cameraMuted ? 'true' : 'false'}
      {...(model.cameraId === null ? {} : { 'data-fwm-report-camera': model.cameraId })}
      aria-label="report"
    >
      {/* The grabber. Decoration - the sheet is dismissed by the close key and
          by the scrim, both of which are real targets. */}
      <span className="fwm-reportv1-grabber" aria-hidden="true" />

      {/* A PLAIN `<h1>`, DELIBERATELY. v1's page titles are `ReloadTitle` - tap
          the screen's name, reload the page - and this sheet is one of the two
          places that would be a data-loss bug rather than a refresh.

          The sheet holds an UNSENT DRAFT: a mode, a facing, a note, and a
          photograph the driver may have just taken and cannot take again from
          the same place. None of it is persisted until submit. A title that
          silently binned all of it would be the worst kind of control - one
          that looks inert, is not, and destroys work. The close key beside it
          is the way out, and it is the one the driver already knows. */}
      <header className="fwm-reportv1-header">
        <h1 className="fwm-reportv1-title">{REPORT_V1_TITLE}</h1>
        {/* THE ONE CLOSE KEY. It was written here first, and every other
            overlay now draws the same component -- same round 44px target,
            same accessible name. See components/overlay/OverlayClose.tsx. */}
        <OverlayClose onClose={onClose} />
      </header>

      <div className="fwm-reportv1-modes" role="radiogroup" aria-label="report mode">
        {(
          [
            { mode: 'new' as const, label: MODE_NEW },
            { mode: 'confirm' as const, label: MODE_CONFIRM },
          ] satisfies readonly { mode: 'new' | 'confirm'; label: string }[]
        ).map((choice) => (
          <button
            type="button"
            key={choice.mode}
            className="fwm-reportv1-mode"
            role="radio"
            aria-checked={draft.mode === choice.mode}
            // CONFIRM with nothing to confirm is inert, not hidden: the mode
            // exists, and a driver who cannot see it cannot learn that it needs
            // a camera nearby.
            //
            // GATED ON `canConfirm`, NOT ON `cameraId`. `cameraId` is null in
            // NEW mode whatever is nearby, so gating on it disabled this tab
            // permanently: null meant disabled meant the mode could never
            // change meant still null. `canConfirm` asks whether a camera is
            // there, which is the question this control is actually about.
            disabled={
              onSelectMode === undefined || (choice.mode === 'confirm' && !model.canConfirm)
            }
            data-fwm-selected={String(draft.mode === choice.mode)}
            onClick={() => {
              onSelectMode?.(choice.mode);
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>

      {/* WHY THE TAB IS DEAD, said while the tab is dead.
          This read `draft.mode === 'confirm' && model.cameraId === null`, a
          branch nothing could reach: entering confirm mode was the very thing
          the disabled tab prevented. So the control was inert AND the product's
          explanation for it was unreachable, which is how this survived to a
          driver at the roadside asking why nothing happens. */}
      {model.canConfirm ? null : (
        <p className="fwm-reportv1-note fwm-data">{NOTHING_TO_CONFIRM}</p>
      )}

      <div className="fwm-reportv1-position" data-fwm-fix={String(model.hasFix)}>
        <span className="fwm-reportv1-dot" aria-hidden="true" />
        <span className="fwm-reportv1-position-where">
          <span className="fwm-reportv1-position-label">
            {model.hasFix ? FIX_LABEL : NO_FIX_LABEL}
          </span>
          <span className="fwm-reportv1-coords fwm-data">{model.coordinates}</span>
          {model.positionDetail === null ? null : (
            <span className="fwm-reportv1-coords fwm-data">{model.positionDetail}</span>
          )}
        </span>
      </div>

      {/* WHERE THE CAMERA IS, relative to the car.
          =====================================================================
          THIS WAS MISSING, AND IT KILLED THE WHOLE OSM PATH.
          `WhereChips` is what produces `subject_position` - which side of the
          car the camera was on and how far over - and v1 never rendered it.
          v0's `ReportView.tsx:159` does; `registry.v1.tsx:107` routes the app
          to this file.

          The consequence is not cosmetic. `reportPayload` emits
          `subject_position: null` when no side was chosen, and
          `osmBlocker()` (osmTags.ts:158-163) returns `'no-subject-position'`
          for exactly that. So EVERY report a real driver has ever filed is
          structurally unpublishable, and the v2 schema work that split the
          observer from the subject - the entire fix for "the camera is where
          the driver was" - has been dead on the shipped route the whole time.

          Placed before the dial deliberately: where the thing is comes before
          which way it points, and the projection needs a side before a bearing
          means anything. */}
      <WhereChips
        side={model.side}
        offsetFt={model.offsetFt}
        hasHeading={model.hasHeading}
        summary={model.whereSummary}
        onSide={onSelectSide}
        onOffset={onSelectOffset}
      />

      <FacingDialV1
        facingDeg={draft.facingDeg}
        label={model.facingLabel}
        onAdjust={onAdjustFacing}
      />

      <div className="fwm-reportv1-mounts" role="group" aria-label="mount">
        {MOUNT_KINDS.map((mount) => (
          <button
            type="button"
            key={mount}
            className="fwm-reportv1-mount"
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

      {/* ONE PHOTOGRAPH, AFTER WHAT THE THING IS AND BEFORE WHAT IT SAYS ON IT.
          Deliberately not below the status line: nothing may come between the
          product's reason for refusing a submit and the key that submits.

          `data-fwm-report-photo` is on this wrapper rather than on the tile
          because the `attached` state has no single tile to put it on - it is a
          thumbnail, a facts line and a REMOVE key. One attribute in one place
          means one query answers "what state is the photograph in" in all four,
          instead of a test having to know which element exists this time. */}
      <div className="fwm-reportv1-photo-block" data-fwm-report-photo={model.photo.state}>
        {model.photo.state === 'attached' ? (
          <div className="fwm-reportv1-photo-attached">
            {/* `alt=""`: this is the driver's own photograph, shown back to them
                a second after they took it, and the facts line beside it
                carries everything a screen reader needs. A generated
                description of a photo of a pole would be noise at best and a
                guess at worst. */}
            <img className="fwm-reportv1-photo-thumb" src={model.photo.previewUrl} alt="" />
            <span className="fwm-reportv1-photo-facts fwm-data">{photoFacts(model.photo)}</span>
            <button
              type="button"
              className="fwm-reportv1-photo-remove"
              disabled={onRemovePhoto === undefined}
              onClick={onRemovePhoto}
            >
              {PHOTO_REMOVE_LABEL}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="fwm-reportv1-photo"
            // CALLED STRAIGHT FROM THE CLICK. `onAttachPhoto` opens a file
            // picker, and a picker opened outside a user gesture does not open
            // at all - so this must never be wrapped in a timer, a debounce or
            // a promise continuation. No jsdom test would catch it.
            // NOT DISABLED WHILE PREPARING, deliberately.
              //
              // `cameraCapture.capture()` settles on `change`, on `cancel`, on
              // `abort()`, or when a later `capture()` supersedes it. `cancel`
              // on `<input type=file>` is not universal - older Android
              // WebViews and Firefox do not fire it - so on those a driver who
              // backs out of the picker settles nothing, and disabling the
              // button here closed the supersede route as well. The tile then
              // read PREPARING... forever while nothing was being prepared, and
              // ADD A PHOTO was dead until the sheet was closed and reopened.
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
          <span className="fwm-reportv1-issue fwm-data" role="alert">
            {PHOTO_ISSUE[model.photo.reason]}
          </span>
        ) : null}
      </div>

      <label className="fwm-reportv1-field">
        <span className="fwm-reportv1-field-label fwm-data">MAKE OR MODEL, IF YOU CAN READ IT</span>
        <input
          className="fwm-reportv1-input"
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
          <span className="fwm-reportv1-issue fwm-data" role="alert">
            {MAKE_MODEL_ISSUE}
          </span>
        )}
      </label>

      {/* THE STATUS LINE IS THE PRODUCT SAYING WHY A SUBMIT IS REFUSED, and it
          comes from the container with its own tone and its own words. Nothing
          here writes one: a sheet that refuses silently is a sheet a driver
          taps four times and gives up on. */}
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

      <p className="fwm-reportv1-hold fwm-data">{HOLD_HINT}</p>

      <p className="fwm-reportv1-promise fwm-data">{PRIVACY_NOTE}</p>
    </section>
  );
}
