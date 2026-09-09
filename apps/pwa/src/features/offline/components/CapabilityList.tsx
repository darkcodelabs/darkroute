/**
 * The WHAT STILL WORKS card.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A2 · OFFLINE - DEGRADED`, lines 99-107
 * -- a 1px-bordered `#0E0F13` card, a 10px `.2em` `WHAT STILL WORKS` caption,
 * then five 12px mono rows at `line-height:2.1`, each a green `OK` or an orange
 * `NO` followed by the label.
 *
 * The verdicts arrive resolved from `capabilities.ts`. This file paints them
 * and knows nothing about networks, storage or feature flags -- which is what
 * makes all three verdicts renderable in a test without a database.
 *
 * A row whose verdict is not known yet prints the same em dash the rest of the
 * app prints for an honest absence, rather than a spinner in a five-row list.
 */

import type { ReactElement } from 'react';

import type { CapabilityVerdict, OfflineCapability } from '../capabilities.ts';
import { NO_VALUE } from '../format.ts';

/** The caption above the rows, verbatim. */
export const CAPABILITY_HEADING = 'WHAT STILL WORKS';

/** `OK` and `NO` exactly as A2 draws them; ` - ` for a verdict still in flight. */
export function verdictMark(verdict: CapabilityVerdict): string {
  if (verdict === 'ok') return 'OK';
  return verdict === 'no' ? 'NO' : NO_VALUE;
}

export interface CapabilityListProps {
  readonly capabilities: readonly OfflineCapability[];
}

export function CapabilityList({ capabilities }: CapabilityListProps): ReactElement {
  return (
    <section className="fwm-offline-card" aria-label={CAPABILITY_HEADING}>
      <h2 className="fwm-offline-card-heading">{CAPABILITY_HEADING}</h2>
      <ul className="fwm-offline-caps">
        {capabilities.map((capability) => (
          <li
            key={capability.id}
            className="fwm-offline-cap"
            data-fwm-offline-cap={capability.id}
            data-fwm-offline-verdict={capability.verdict}
          >
            <span className="fwm-offline-cap-mark">{verdictMark(capability.verdict)}</span>
            <span className="fwm-offline-cap-label">{capability.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
