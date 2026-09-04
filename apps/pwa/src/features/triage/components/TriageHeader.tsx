/**
 * The 52px header: `TRIAGE` and `ALERT FATIGUE CONTROL`.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B4 · ALERT TRIAGE - BY OWNER TYPE` --
 * a 52px bar, the title at 17px/700/.1em, and a mono 10px/.1em strapline in
 * the muted grey, right-aligned and never wrapped.
 *
 * The strapline is a label, not a control. B4 draws no back key, no settings
 * key and no toggle up here, so this component renders none.
 */

import type { ReactElement } from 'react';

import { BrandMark } from '../../../components/brand/BrandMark.tsx';

export function TriageHeader(): ReactElement {
  return (
    <header className="fwm-triage-header">
      <BrandMark />
      <h1 className="fwm-triage-title">TRIAGE</h1>
      <div className="fwm-triage-strapline">ALERT FATIGUE CONTROL</div>
    </header>
  );
}
