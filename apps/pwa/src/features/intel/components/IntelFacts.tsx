/**
 * The five-row record block.
 *
 * SOURCE: `A4 · INTEL CARD`. One bordered `--fwm-surface-1` card, 11.5px mono
 * at `line-height:2`, five label/value rows justified apart:
 *
 *   EFF ATLAS              CROSS-REFERENCED     green
 *   INTER-AGENCY SHARING   YES · 412 AGENCIES   alert
 *   FIRST REPORTED         MAR 2026
 *   CONFIRMED BY           28 HAKCERS
 *   YOUR READS             21 IN 30 DAYS        alert
 *
 * Four of the five have no field in `CameraRecord` and render an em dash in
 * this build -- see the header of `intelState.ts`. The rows still draw:
 * silently dropping `INTER-AGENCY SHARING` would read as "this one does not
 * share", which is a claim, not an absence.
 */

import type { ReactElement } from 'react';

import type { IntelFact } from '../intelState.ts';

export interface IntelFactsProps {
  readonly facts: readonly IntelFact[];
}

export function IntelFacts({ facts }: IntelFactsProps): ReactElement {
  return (
    <dl className="fwm-intel-facts fwm-data">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="fwm-intel-fact"
          data-fwm-intel-fact={fact.label}
          data-fwm-intel-known={fact.known ? 'true' : 'false'}
        >
          <dt className="fwm-intel-fact-label">{fact.label}</dt>
          <dd className="fwm-intel-fact-value" data-fwm-intel-tone={fact.tone}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
