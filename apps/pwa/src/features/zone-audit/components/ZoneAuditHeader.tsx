/**
 * The 52px header: the screen name and the radius readout.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B6 · ZONE AUDIT` -- a 52px bar, the
 * title at 17px/700/.1em, and `2 MI RADIUS` in 10px mono at the right.
 *
 * THE READOUT IS THE SELECTOR. B6 draws one static value and no picker of any
 * kind, so the drawn element takes the job: pressing it advances to the next
 * radius and wraps. The element count, the copy and the position are B6's.
 * GAP: see docs/gaps-inbox/zone-audit.md#radius-selector-is-named-but-never-drawn
 *
 * A build with no handler renders the readout as text with no control at all,
 * rather than a live-looking key that does nothing.
 */

import type { ReactElement } from 'react';

import { BrandMark } from '../../../components/brand/BrandMark.tsx';

import { formatRadiusReadout } from '../zone.ts';
import type { ZoneRadiusMi } from '../zone.ts';

export interface ZoneAuditHeaderProps {
  /** `ZONE AUDIT`, or `HEAT MAP` on the full-screen layer. */
  readonly title: string;
  readonly radiusMi: ZoneRadiusMi;
  /** Absent means "not wired in this build" -- the readout renders disabled. */
  readonly onRadius?: (() => void) | undefined;
}

export function ZoneAuditHeader({ title, radiusMi, onRadius }: ZoneAuditHeaderProps): ReactElement {
  const readout = formatRadiusReadout(radiusMi);
  return (
    <header className="fwm-zone-header">
      <BrandMark />
      <h1 className="fwm-zone-title">{title}</h1>
      <button
        type="button"
        className="fwm-zone-radius"
        data-fwm-zone-radius={String(radiusMi)}
        aria-label={`${readout} - CHANGE`}
        disabled={onRadius === undefined}
        onClick={onRadius}
      >
        {readout}
      </button>
    </header>
  );
}
