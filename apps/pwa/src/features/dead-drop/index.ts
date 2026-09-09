/**
 * DEAD DROP's public surface.
 *
 * The shell registers `DeadDropScreen` against the `dead-drop` screen id;
 * everything else here is exported for tests, and for whatever eventually wires
 * a sync path or an export sink -- both of which are injected handlers rather
 * than anything this screen owns.
 *
 * `buildEvidenceExport` is exported deliberately: the export format is a
 * contract with a verifier that is not this app, and a backend or an
 * independent checker reproduces it from `evidenceExport.ts` alone.
 */

export { DeadDropScreen } from './DeadDropScreen.tsx';
export type { DeadDropScreenProps } from './DeadDropScreen.tsx';

export { DeadDropView } from './components/DeadDropView.tsx';
export type { DeadDropViewHandlers, DeadDropViewProps } from './components/DeadDropView.tsx';

export {
  ROW_BODY_FIELDS,
  createDeadDropPort,
  describeLoadFailure,
  rowBodyDisagreement,
  verdictFor,
} from './deadDropQueue.ts';
export type {
  ChainRun,
  DeadDropPort,
  DeadDropPortOptions,
  DeadDropSnapshot,
  DropRecord,
  RowBodyField,
  SignedVerdict,
  VerdictInput,
} from './deadDropQueue.ts';

export {
  BADGE_LABELS,
  CHAINING_NOTE,
  EMPTY_QUEUE,
  EXPORT_LABEL,
  META_WORDS,
  NO_SIGNATURE_CHECK,
  READING_LABEL,
  READING_QUEUE,
  SIGNING_STATEMENT,
  SYNC_LABEL,
  UNAVAILABLE_LABEL,
  VERDICT_LABELS,
  dropDetail,
  dropSummary,
  dropTitle,
  headerStatus,
  listMessage,
  loadingModel,
  metaTerms,
  readyModel,
  unavailableModel,
} from './deadDropModel.ts';
export type {
  DeadDropStatus,
  DeadDropViewModel,
  DropDetail,
  DropFact,
  DropSummary,
} from './deadDropModel.ts';

export {
  EVIDENCE_EXPORT_SCHEMA,
  buildEvidenceExport,
  evidenceExportDocument,
  evidenceExportFilename,
  recordToCanonical,
  runOf,
} from './evidenceExport.ts';
export type { EvidenceExportBundle, EvidenceRun } from './evidenceExport.ts';

export {
  NO_VALUE,
  capturedClock,
  capturedShort,
  dropCameraId,
  dropHeading,
  dropNumber,
  dropPhoto,
  dropPosition,
  hasPhoto,
  heldFor,
  photoWord,
} from './format.ts';
