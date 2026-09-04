/**
 * The scope's two telemetry corners.
 *
 * SOURCE: `Flockys App Screens v2.dc.html`, `02 · SWEEP` -- `left:12px;
 * bottom:14px` and `right:12px; bottom:14px` inside the 343px scope, both at
 * `8px / .14em / #4E5563` with `line-height:1.7`, the right one right-aligned.
 *
 * The strings themselves, and the privacy rules the right-hand block is
 * governed by, live in `../telemetry.ts`. This file only places them.
 *
 * NO ATTRIBUTE HERE CARRIES A VALUE. The lines go in element CONTENT; the only
 * attributes are the class and the `data-fwm-sweep-telemetry` block name, which
 * are constants. That is what makes rule 3 in `telemetry.ts` true, and
 * `SweepTelemetry.test.tsx` walks the rendered tree to keep it true.
 */

import type { ReactElement } from 'react';

import { instrumentLines, vehicleLines } from '../telemetry.ts';
import type { SweepTelemetry as SweepTelemetryModel } from '../telemetry.ts';

export interface SweepTelemetryProps {
  readonly telemetry: SweepTelemetryModel;
}

function Block({
  block,
  lines,
}: {
  readonly block: 'instrument' | 'vehicle';
  readonly lines: readonly string[];
}): ReactElement {
  return (
    <div className="fwm-sweep-telemetry fwm-data" data-fwm-sweep-telemetry={block}>
      {lines.map((line) => (
        <span className="fwm-sweep-telemetry-line" key={line}>
          {line}
        </span>
      ))}
    </div>
  );
}

export function SweepTelemetry({ telemetry }: SweepTelemetryProps): ReactElement {
  return (
    <>
      <Block block="instrument" lines={instrumentLines(telemetry)} />
      <Block block="vehicle" lines={vehicleLines(telemetry)} />
    </>
  );
}
