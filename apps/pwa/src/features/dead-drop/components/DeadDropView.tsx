/**
 * DEAD DROP, as a pure function of a view model.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B2 · DEAD DROP - QUEUE + EVIDENCE
 * CHAIN`. Element order is the panel's: header, signing statement, detail card,
 * queue list, send state / `EXPORT JSON`.
 *
 * The REPORT bar and the five dock word-keys the phone frame also carries are
 * NOT here: they are shell chrome (`app/App.tsx` + `components/dock`), rendered
 * on every screen, and drawing a second copy would put two docks on the page.
 *
 * This component reads no store, opens no database, calls no browser API and
 * takes no clock. It is the seam the model tests render against.
 */

import type { ReactElement } from 'react';

import { listMessage } from '../deadDropModel.ts';
import type { DeadDropViewModel } from '../deadDropModel.ts';

import { DeadDropActions } from './DeadDropActions.tsx';
import { DeadDropHeader } from './DeadDropHeader.tsx';
import { DropCard } from './DropCard.tsx';
import { DropList } from './DropList.tsx';
import { SigningNotice } from './SigningNotice.tsx';

export interface DeadDropViewHandlers {
  readonly onSyncNow?: (() => void) | undefined;
  readonly onExport?: (() => void) | undefined;
}

export type DeadDropViewProps = DeadDropViewHandlers & {
  readonly model: DeadDropViewModel;
};

export function DeadDropView({ model, onSyncNow, onExport }: DeadDropViewProps): ReactElement {
  return (
    <section className="fwm-dead-drop" data-fwm-dead-drop-status={model.status}>
      <DeadDropHeader model={model} />
      <div className="fwm-dead-drop-body">
        <SigningNotice />
        {model.detail === null ? null : <DropCard detail={model.detail} />}
        <DropList
          drops={model.drops}
          message={listMessage(model)}
          messageKind={model.status === 'unavailable' ? 'unavailable' : 'empty'}
        />
        <DeadDropActions
          onSyncNow={onSyncNow}
          onExport={onExport}
          canSync={model.hasHeld}
          canExport={model.hasExportable}
        />
      </div>
    </section>
  );
}
