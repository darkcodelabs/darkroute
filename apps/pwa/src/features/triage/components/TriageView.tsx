/**
 * `B4 · ALERT TRIAGE - BY OWNER TYPE`, as a pure function of a view model.
 *
 * SOURCE: `Flockys Screens II.dc.html`, panel `B4 · ALERT TRIAGE - BY OWNER
 * TYPE`. Element order is the panel's order: header, the projection card, the
 * five owner rows, the muting card, and the re-alert row pinned to the bottom.
 *
 * The REPORT bar and the dock word-keys are NOT here: they are shell chrome
 * (`app/App.tsx` + `components/dock`), rendered on every screen, and drawing a
 * second copy would put two docks on the page. B4 draws neither.
 *
 * This component reads no store, calls no browser API and takes no clock. It is
 * the seam the state tests render against.
 */

import type { ReactElement } from 'react';

import type { AlertProjection, CameraOwnerType } from '../triage.ts';

import { MuteNotice } from './MuteNotice.tsx';
import { OwnerFilterList } from './OwnerFilterList.tsx';
import type { OwnerRow } from './OwnerFilterList.tsx';
import { ProjectionCard } from './ProjectionCard.tsx';
import { ReAlertRow } from './ReAlertRow.tsx';
import { TriageHeader } from './TriageHeader.tsx';

export type { OwnerRow };

export interface TriageViewModel {
  readonly projection: AlertProjection;
  /** Five rows, in the panel's order. */
  readonly rows: readonly OwnerRow[];
  /** `settings.reAlertWhenCloserThanFt`. Zero is the off position. */
  readonly reAlertFt: number;
}

export interface TriageViewHandlers {
  readonly onOwnerType?: ((ownerType: CameraOwnerType, enabled: boolean) => void) | undefined;
  readonly onReAlert?: ((on: boolean) => void) | undefined;
}

export type TriageViewProps = TriageViewHandlers & {
  readonly model: TriageViewModel;
};

export function TriageView({ model, onOwnerType, onReAlert }: TriageViewProps): ReactElement {
  return (
    <section className="fwm-triage" data-fwm-triage-drives={String(model.projection.drives)}>
      <TriageHeader />
      <div className="fwm-triage-body">
        <ProjectionCard projection={model.projection} />
        <OwnerFilterList rows={model.rows} onOwnerType={onOwnerType} />
        <MuteNotice />
        <ReAlertRow reAlertFt={model.reAlertFt} onReAlert={onReAlert} />
      </div>
    </section>
  );
}
