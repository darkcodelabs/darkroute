/**
 * The INTEL CARD's public surface.
 *
 * `src/app/App.tsx` takes a screen registry AND an overlay registry, and this
 * feature's entry in both is {@link IntelScreen}, which is usable with no
 * props: `app/screenState.ts` reserves the `intel` screen id and a `modal`
 * overlay kind, and `A4` is drawn as a modal raised from a SWEEP dot.
 *
 *   screens:  { intel: IntelScreen }
 *   overlays: { [INTEL_OVERLAY.id]: IntelScreen }
 *
 * {@link openIntelCard} is the handler `SweepScreen`'s `onSelectCamera` prop is
 * shaped for, and `main.tsx` wires the two together -- `IntelScreen` is in both
 * registries and SWEEP's dial raises the card through `openIntelCard`. This
 * feature exports the pieces; the shell decides where they go, and nothing in
 * here reaches back out to check.
 *
 * The rest is exported for tests and for the screens that share this card's
 * vocabulary -- RECORD (B8) states the same operator findings, and TRIAGE (B4)
 * groups by the same owner types.
 *
 * Nothing here reads a store, opens a database, prompts for a permission or
 * touches a browser API on import.
 */

export { IntelScreen, INTEL_OVERLAY, closeIntelCard, openIntelCard } from './IntelScreen.tsx';
export type { IntelScreenProps } from './IntelScreen.tsx';

export { IntelView, NO_CAMERA_NOTE } from './components/IntelView.tsx';
export type { IntelViewHandlers, IntelViewProps } from './components/IntelView.tsx';

export { IntelHeader } from './components/IntelHeader.tsx';
export type { IntelHeaderProps } from './components/IntelHeader.tsx';
export { IntelTiles } from './components/IntelTiles.tsx';
export type { IntelTilesProps } from './components/IntelTiles.tsx';
export { IntelFacts } from './components/IntelFacts.tsx';
export type { IntelFactsProps } from './components/IntelFacts.tsx';
export { DROP_PHOTO_LABEL, IntelPhoto, PHOTO_OFF_NOTE } from './components/IntelPhoto.tsx';
export type { IntelPhotoProps } from './components/IntelPhoto.tsx';
export {
  CONFIRM_LABEL,
  DISPUTE_LABEL,
  IntelActions,
  MUTE_LABEL,
  SHARE_LABEL,
} from './components/IntelActions.tsx';
export type { IntelActionsProps } from './components/IntelActions.tsx';
export { OperatorRecordBanner } from './components/OperatorRecordBanner.tsx';
export type { OperatorRecordBannerProps } from './components/OperatorRecordBanner.tsx';

export {
  FACT_LABELS,
  FACT_TONE,
  IDENTITY_UNKNOWN_NOTE,
  MUTE_STILL_COUNTED,
  OPERATOR_RECORD_LABEL,
  OWNER_LABEL,
  READ_WINDOW_DAYS,
  TILE_LABELS,
  actionMessage,
  intelFact,
  intelFacts,
  intelIdentity,
  intelModel,
  intelReadout,
  intelReads,
  intelTiles,
  isActionFailure,
  muteClockLabel,
  operatorRecordVisible,
  operatorSentence,
  operatorSourcesLabel,
  shareHeadline,
  shareText,
} from './intelState.ts';
export type {
  IntelActionOutcome,
  IntelFact,
  IntelFactLabel,
  IntelFactTone,
  IntelFactsInput,
  IntelIdentity,
  IntelInput,
  IntelReadout,
  IntelTile,
  IntelTileLabel,
  IntelViewModel,
  OperatorRecord,
} from './intelState.ts';

export { createIntelQueue } from './intelActions.ts';
export type { IntelQueueOptions, IntelQueuePort, IntelStatement } from './intelActions.ts';
