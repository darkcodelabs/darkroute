/**
 * The 52px header: `DEAD DROP` and the held count.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B2 · DEAD DROP` -- a 52px bar, the
 * title at 17px/700/.1em, and `3 HELD` at 10px mono/.1em in the approaching hue.
 *
 * `3 HELD` counts pending plus in-flight drops, which is exactly the three the
 * panel labels HELD: the featured DROP 03 and the two HELD rows below it. It is
 * never rendered as `0 HELD` before the queue has been read -- the slot says
 * `READING` instead, because a zero that turns into a three is a lie that
 * corrects itself.
 */

import type { ReactElement } from 'react';

import { headerStatus } from '../deadDropModel.ts';
import type { DeadDropViewModel } from '../deadDropModel.ts';

export interface DeadDropHeaderProps {
  readonly model: DeadDropViewModel;
}

export function DeadDropHeader({ model }: DeadDropHeaderProps): ReactElement {
  return (
    <header className="fwm-dead-drop-header">
      <h1 className="fwm-dead-drop-title">DEAD DROP</h1>
      <div className="fwm-dead-drop-status" data-fwm-dead-drop-status={model.status}>
        {headerStatus(model)}
      </div>
    </header>
  );
}
