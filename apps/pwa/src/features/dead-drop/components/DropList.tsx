/**
 * The scrolling queue below the card -- every other drop, newest first.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B2 · DEAD DROP`: a 60px row with a
 * state dot, `DROP 02 · Vine St` at 15px/600 over `13:58 · photo · signed` in
 * 11px mono, and the state word right-aligned in 10px mono.
 *
 * NOTHING IS FILTERED. Every row the chain holds is drawn, in every state,
 * including drops the backend refused and drops whose signed body was purged
 * after sync. A queue screen that hides a drop is a queue screen that has lost
 * it.
 */

import type { ReactElement } from 'react';

import type { DropSummary } from '../deadDropModel.ts';

export interface DropListProps {
  readonly drops: readonly DropSummary[];
  /** Rendered instead of rows when there are none. Null draws nothing. */
  readonly message: string | null;
  /** Colours the message as a failure rather than as a fact. */
  readonly messageKind: 'empty' | 'unavailable';
}

export function DropList({ drops, message, messageKind }: DropListProps): ReactElement {
  if (drops.length === 0) {
    return (
      <div className="fwm-dead-drop-list">
        {message === null ? null : (
          <p className="fwm-dead-drop-empty" data-fwm-dead-drop-empty={messageKind}>
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <ul className="fwm-dead-drop-list" aria-label="QUEUE">
      {drops.map((drop) => (
        <li
          className="fwm-dead-drop-row"
          key={drop.reportId}
          data-fwm-dead-drop-state={drop.state}
        >
          <div className="fwm-dead-drop-dot" data-fwm-dead-drop-state={drop.state} />
          <div className="fwm-dead-drop-row-main">
            <div className="fwm-dead-drop-row-title">{drop.title}</div>
            <div className="fwm-dead-drop-row-meta">{drop.meta}</div>
          </div>
          <div className="fwm-dead-drop-badge" data-fwm-dead-drop-state={drop.state}>
            {drop.badge}
          </div>
        </li>
      ))}
    </ul>
  );
}
