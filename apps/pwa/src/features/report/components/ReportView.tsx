/**
 * THE REPORT SHEET, as a pure function of a view model.
 *
 * SOURCE: `Flockys App Screens v2.dc.html`, `06 · REPORT - SHEET FROM THE DOCK
 * KEY`. v1 titled the same panel `SHEET FROM ANY SCREEN`; v2 is the later
 * decision and it wins.
 *
 * =============================================================================
 * THE STACK, TOP TO BOTTOM - transcribed from the panel
 * =============================================================================
 *   52px header            `REPORT` in the in-range hue, `✕` on the right
 *   mode toggle            `NEW CAMERA` / `CONFIRM EXISTING`
 *   position card          `POSITION · AUTO`
 *   facing                 `FACING · FROM COMPASS`, the dial, the readout
 *   two keys               `PHOTO`, `MAKE / MODEL`
 *   mount chips            `POLE MOUNT` `SOLAR` `TRAILER` `UNSURE`
 *   pinned to the bottom   queue line, `SUBMIT REPORT`, the hold hint
 *
 * =============================================================================
 * THE HEADING IS `REPORT`, NOT `REPORT CAMERA`, AND THAT IS THE ENTRY POINT
 * =============================================================================
 * v2 shortened it because the sheet is no longer raised by a crimson
 * `REPORT CAMERA` bar sitting on every screen - that bar is gone, absorbed into
 * the dock (`components/dock/ReportKey.tsx`). The word `CAMERA` was the bar's,
 * and the bar is not here any more. What raises this sheet is the REPORT key in
 * the dock, through `openReportSheet()`.
 *
 * Nothing in this file names, draws or reaches for that entry point. The sheet
 * renders the same from a dock tap, a screen-registry mount or a test, and
 * `onClose` is whatever its owner passes - there is no back-target pointing at
 * a bar that no longer exists.
 *
 * `ReportScreen.tsx` owns the stores, the clock and the queue; this file
 * decides what is on screen and in what order, so every state - no fix, nothing
 * nearby to confirm, a plate typed into MAKE / MODEL, a queue that would not
 * take the report - is renderable in a test with no database and no sensors.
 */

import type { ReactElement } from 'react';

import { BrandMark } from '../../../components/brand/BrandMark.tsx';

import type { MakeModelIssue, ReportDraft, ReportStatus } from '../reportDraft.ts';
import type { MountKind, ReportMode } from '../reportDraft.ts';
import type { SubjectOffsetFt, SubjectSide } from '../subjectPosition.ts';

import { DetailTiles } from './DetailTiles.tsx';
import { FacingDial } from './FacingDial.tsx';
import { ModeToggle } from './ModeToggle.tsx';
import { MountChips } from './MountChips.tsx';
import { PositionCard } from './PositionCard.tsx';
import { SubmitBlock } from './SubmitBlock.tsx';
import { WhereChips } from './WhereChips.tsx';

/**
 * Exact copy from the v2 panel. v1 read `REPORT CAMERA`; v2 reads `REPORT`.
 * See the header for why the word went away with the bar.
 */
export const REPORT_TITLE = 'REPORT';
/** The glyph the panel draws in the top right. */
export const CLOSE_GLYPH = '✕';

/** Why a photograph was refused. Each one has an authored sentence in `ReportViewV1`. */
export type PhotoRejection = 'unreadable' | 'too-big' | 'no-room';

/**
 * The photograph attached to this report, as a state rather than a bag of
 * optionals.
 *
 * A discriminated union because `exactOptionalPropertyTypes` makes optional
 * fields expensive to read AND because the shape is the invariant: there is no
 * way to spell an `attached` photograph with no dimensions, and no way to spell
 * a `rejected` one that also has a preview. The alternative - four booleans and
 * six optionals - can express every impossible combination.
 *
 * `previewUrl` is an object URL owned by `ReportScreen`. A view must never
 * create or revoke one: a component that renders a URL it also owns leaks it on
 * every re-render.
 */
export type PhotoAttachment =
  | { readonly state: 'none' }
  | { readonly state: 'preparing' }
  | {
      readonly state: 'attached';
      readonly previewUrl: string;
      readonly width: number;
      readonly height: number;
      readonly sizeBytes: number;
      /** Lowercase hex, 64 chars. The same value the signed payload carries. */
      readonly sha256: string;
    }
  | { readonly state: 'rejected'; readonly reason: PhotoRejection };

export interface ReportViewModel {
  readonly draft: ReportDraft;
  /** `39.0997 N · 84.5786 W`, or the em dash. */
  readonly coordinates: string;
  /** `±4 M · 9 SATS · FWM-0442`, or null. */
  readonly positionDetail: string | null;
  readonly hasFix: boolean;
  /** `FACING · FROM COMPASS`, or whichever provenance is true. */
  readonly facingLabel: string;
  /**
   * Confirm mode's subject, and null in NEW mode by design - a new-camera
   * report must not carry the id of whatever else happens to be nearby.
   *
   * Do NOT gate the CONFIRM control on this. It is null in new mode whether or
   * not a camera is there, so a control that disables itself on it can never
   * be pressed, and the mode becomes unreachable. Use {@link canConfirm}, which
   * asks about the world rather than about the draft. See `ReportScreen.tsx`.
   */
  readonly cameraId: string | null;
  /**
   * Is there a camera near enough to confirm, IRRESPECTIVE of the current mode.
   *
   * This is what the CONFIRM tab must gate on. It exists because gating on
   * `cameraId` deadlocked the tab shut for every driver - the whole account is
   * on `nearbyCameraId` in `ReportScreen.tsx`.
   */
  readonly canConfirm: boolean;
  /**
   * True when the subject camera is muted. It is still confirmable, still
   * counted and still named: muting silences an alert, it does not delete a
   * camera or remove it from a report.
   */
  readonly cameraMuted: boolean;
  /**
   * Whether v0's `DetailTiles` PHOTO tile can be pressed. FALSE, still, and no
   * longer for the old reason.
   *
   * It used to mean "no photo can be attached anywhere, because nothing can
   * strip a photo's metadata". `preparePhoto()` strips it now and the sheet
   * does attach photographs - through {@link photo} and `onAttachPhoto`, which
   * `ReportViewV1` draws. `DetailTiles` is v0's layout, the build routes to v1
   * (`app/registry.v1.tsx`), and v0 has no attach wiring behind that tile - so
   * pressing it would do nothing. It stays dark until somebody wires it, which
   * is a fact about v0's plumbing and not about photo metadata.
   */
  readonly photoAvailable: boolean;
  /** The photograph attached to this report, in whichever state it is in. */
  readonly photo: PhotoAttachment;
  readonly makeModelIssue: MakeModelIssue | null;
  readonly status: ReportStatus | null;
  readonly submitDisabled: boolean;
  /** Which side of the car the camera was on, once the driver has said. */
  readonly side: SubjectSide | null;
  readonly offsetFt: SubjectOffsetFt | null;
  /** False disables the lateral chips: `left` needs a bearing to mean anything. */
  readonly hasHeading: boolean;
  /** `RIGHT · ONE LANE OVER`, or null while nothing is chosen. */
  readonly whereSummary: string | null;
}

export interface ReportViewHandlers {
  readonly onClose?: (() => void) | undefined;
  readonly onSelectMode?: ((mode: ReportMode) => void) | undefined;
  readonly onAdjustFacing?: ((bearingDeg: number) => void) | undefined;
  readonly onToggleMount?: ((mount: MountKind) => void) | undefined;
  readonly onSelectSide?: ((side: SubjectSide) => void) | undefined;
  readonly onSelectOffset?: ((offsetFt: SubjectOffsetFt) => void) | undefined;
  readonly onMakeModelChange?: ((value: string) => void) | undefined;
  /**
   * Open the camera. USER GESTURE ONLY - a file picker will not open outside
   * one, so this must be called straight from the click handler and never from
   * a timer or a promise continuation.
   */
  readonly onAttachPhoto?: (() => void) | undefined;
  /** Drop the attached photograph. The report is still filable either way. */
  readonly onRemovePhoto?: (() => void) | undefined;
  readonly onSubmit?: (() => void) | undefined;
}

export type ReportViewProps = ReportViewHandlers & {
  readonly model: ReportViewModel;
};

export function ReportView({ model, ...handlers }: ReportViewProps): ReactElement {
  const { draft } = model;

  return (
    <section
      className="fwm-report"
      data-fwm-report-mode={draft.mode}
      data-fwm-report-muted={model.cameraMuted ? 'true' : 'false'}
      {...(model.cameraId === null ? {} : { 'data-fwm-report-camera': model.cameraId })}
      aria-label="report"
    >
      <header className="fwm-report-header">
        <BrandMark />
      <h1 className="fwm-report-title">{REPORT_TITLE}</h1>
        <button
          type="button"
          className="fwm-report-close"
          aria-label="close"
          disabled={handlers.onClose === undefined}
          onClick={handlers.onClose}
        >
          <span aria-hidden="true">{CLOSE_GLYPH}</span>
        </button>
      </header>

      <div className="fwm-report-body">
        <ModeToggle mode={draft.mode} onSelect={handlers.onSelectMode} />

        <PositionCard
          coordinates={model.coordinates}
          detail={model.positionDetail}
          hasFix={model.hasFix}
        />

        <WhereChips
          side={model.side}
          offsetFt={model.offsetFt}
          hasHeading={model.hasHeading}
          summary={model.whereSummary}
          onSide={handlers.onSelectSide}
          onOffset={handlers.onSelectOffset}
        />

        <FacingDial
          facingDeg={draft.facingDeg}
          label={model.facingLabel}
          onAdjust={handlers.onAdjustFacing}
        />

        <DetailTiles
          photoAvailable={model.photoAvailable}
          makeModel={draft.makeModel}
          issue={model.makeModelIssue}
          onMakeModelChange={handlers.onMakeModelChange}
        />

        <MountChips mount={draft.mount} onToggle={handlers.onToggleMount} />

        <SubmitBlock
          status={model.status}
          disabled={model.submitDisabled}
          onSubmit={handlers.onSubmit}
        />
      </div>
    </section>
  );
}
