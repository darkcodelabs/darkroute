/**
 * REPORT's public surface.
 *
 * `src/app/App.tsx` takes a screen registry; this feature's entry in it is
 * {@link ReportScreen}, which is usable with no props. `screenState.ts`
 * reserves both the `report` screen id and the `sheet` overlay kind, so the
 * same component can be mounted as a screen or opened over any other one with
 * {@link openReportSheet}.
 *
 * {@link openReportSheet} IS THE ENTRY POINT, and after v2 it is the only one:
 * `Flockys App Screens v2.dc.html` retitles the panel
 * `06 · REPORT - SHEET FROM THE DOCK KEY` and deletes the `REPORT CAMERA` bar
 * that used to raise it from every screen. The dock's REPORT key calls this
 * function. Nothing in this feature reaches back at the dock.
 *
 * The rest is exported for tests and for the screens that share this one's
 * vocabulary: DEAD DROP renders the queue this sheet writes to, and the INTEL
 * CARD's `CONFIRM STILL THERE` is the same submission in confirm mode.
 *
 * Nothing here opens a database, prompts for a permission or touches a browser
 * API on import.
 */

export { ReportScreen, REPORT_OVERLAY, closeReport, openReportSheet } from './ReportScreen.tsx';
export type { PhotoSourcePort, ReportScreenProps } from './ReportScreen.tsx';

export { PhotoDigestUnavailableError, photoSha256 } from './photoDigest.ts';

export { ReportView, REPORT_TITLE, CLOSE_GLYPH } from './components/ReportView.tsx';
export type {
  PhotoAttachment,
  PhotoRejection,
  ReportViewHandlers,
  ReportViewModel,
  ReportViewProps,
} from './components/ReportView.tsx';

export { DetailTiles, MAKE_MODEL_LABEL, PHOTO_LABEL, PHOTO_OFF_NOTE } from './components/DetailTiles.tsx';
export type { DetailTilesProps } from './components/DetailTiles.tsx';
export { FacingDial } from './components/FacingDial.tsx';
export type { FacingDialProps } from './components/FacingDial.tsx';
export { ModeToggle } from './components/ModeToggle.tsx';
export type { ModeToggleProps } from './components/ModeToggle.tsx';
export { MountChips } from './components/MountChips.tsx';
export type { MountChipsProps } from './components/MountChips.tsx';
export { PositionCard } from './components/PositionCard.tsx';
export type { PositionCardProps } from './components/PositionCard.tsx';
export { HOLD_HINT, SUBMIT_LABEL, SubmitBlock } from './components/SubmitBlock.tsx';
export type { SubmitBlockProps } from './components/SubmitBlock.tsx';

export {
  FACING_HINT,
  FACING_LABEL,
  MODE_LABEL,
  MOUNT_KINDS,
  MOUNT_LABEL,
  NO_FIX_DETAIL,
  POSITION_LABEL,
  REPORT_MODES,
  REPORT_PAYLOAD_SCHEMA,
  emptyDraft,
  facingCardinal,
  facingDetail,
  laneCovered,
  makeModelIssue,
  normaliseDegrees,
  positionDetail,
  queueLine,
  reportCoordinates,
  reportPayload,
  reportStatus,
  seedFacing,
  submitBlocker,
  withFacing,
  withMakeModel,
  withMode,
  withMount,
} from './reportDraft.ts';
export type {
  FacingSource,
  MakeModelIssue,
  MountKind,
  ReportDraft,
  ReportMode,
  ReportStatus,
  ReportStatusTone,
  ReportSubject,
  SubmitBlocker,
} from './reportDraft.ts';

export {
  ARC_SPAN_DEG,
  CENTRE_DOT_RADIUS,
  DIAL_CARDINALS,
  DIAL_CENTRE,
  DIAL_UNITS,
  FACING_COARSE_STEP_DEG,
  FACING_MAX_DEG,
  FACING_MIN_DEG,
  FACING_STEP_DEG,
  RING_RADIUS,
  WEDGE_RADIUS,
  bearingFromPoint,
  dialPoint,
  facingAriaValue,
  facingWedgePath,
} from './facing.ts';
export type { DialCardinal, DialPoint, DialRect } from './facing.ts';

export {
  PHOTO_NOT_STORED,
  PhotoDigestMismatchError,
  createReportQueue,
  describeQueueFailure,
} from './reportQueue.ts';
export type {
  QueuedReceipt,
  ReportPhotoBytes,
  ReportQueueOptions,
  ReportQueuePort,
} from './reportQueue.ts';
