/**
 * The detail card -- the newest drop in the queue.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B2 · DEAD DROP`. Element order is the
 * panel's: `DROP 03` with its state and age, the five fact rows
 * (CAPTURED · POSITION · HEADING · PHOTO · SIGNED), the sha256/prev block, and
 * the note about chaining.
 *
 * The hashes are rendered by `formatHashForDisplay()` from
 * `services/crypto/chain.ts` -- the function that exists for this readout -- so
 * the six middot-separated groups are the first 24 characters of the real
 * lowercase hex digest and not a shortened copy this component invented.
 *
 * SIGNED is a result, never a label: its hue and its words come from a
 * `verifyChain()` run over the signed bodies on disk, cross-checked against the
 * queue row this card reads its hashes from.
 *
 * When the platform has no WebCrypto, every verdict is UNVERIFIED and the card
 * says why. The panel draws no such line, and a screen that renders UNVERIFIED
 * without a reason is a screen that reads like an accusation.
 * GAP: see docs/gaps-inbox/dead-drop.md#a-device-with-no-webcrypto-says-so
 */

import type { ReactElement } from 'react';

import { CHAINING_NOTE } from '../deadDropModel.ts';
import type { DropDetail } from '../deadDropModel.ts';

export interface DropCardProps {
  readonly detail: DropDetail;
}

export function DropCard({ detail }: DropCardProps): ReactElement {
  return (
    <section
      className="fwm-dead-drop-card"
      data-fwm-dead-drop-card={detail.title}
      aria-label={detail.title}
    >
      <div className="fwm-dead-drop-card-head">
        <h2 className="fwm-dead-drop-card-title">{detail.title}</h2>
        <div className="fwm-dead-drop-badge" data-fwm-dead-drop-state={detail.state}>
          {detail.badge}
        </div>
      </div>

      <dl className="fwm-dead-drop-facts">
        {detail.facts.map((fact) => (
          <div className="fwm-dead-drop-fact" key={fact.key} data-fwm-dead-drop-fact={fact.key}>
            <dt className="fwm-dead-drop-fact-key">{fact.key}</dt>
            <dd
              className="fwm-dead-drop-fact-value"
              {...(fact.key === 'SIGNED' ? { 'data-fwm-dead-drop-verdict': detail.verdict } : {})}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="fwm-dead-drop-hashes" data-fwm-dead-drop-hashes="true">
        <span className="fwm-dead-drop-hash-key">sha256</span>
        <span data-fwm-dead-drop-hash="chain">{detail.chainHash}</span>
        <span className="fwm-dead-drop-hash-key">prev</span>
        <span data-fwm-dead-drop-hash="previous">{detail.previousChainHash}</span>
      </div>

      {detail.unverifiableReason === null ? null : (
        <p className="fwm-dead-drop-warning" data-fwm-dead-drop-unverifiable="true">
          {detail.unverifiableReason}
        </p>
      )}

      <p className="fwm-dead-drop-note">{CHAINING_NOTE}</p>
    </section>
  );
}
