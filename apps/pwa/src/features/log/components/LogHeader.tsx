/**
 * The 52px header: `EXPOSURE` and the TRIP / ALL TIME toggle.
 *
 * SOURCE: `Flockys App Screens.dc.html`, `05 · LOG - EXPOSURE` -- a 52px bar,
 * the title at 17px/700/.1em, and a single outlined block holding two 34px mono
 * keys, `TRIP` filled in the in-range hue with the page ground as its text.
 *
 * WHAT THE TOGGLE SCOPES: the two surfaces on this screen that carry no scope
 * label of their own -- `HOTTEST SEGMENT` and `TIMELINE`. `FLOCKED TODAY` and
 * `ALL TIME` name their own windows and do not move.
 * GAP: see docs/gaps-inbox/log.md#what-the-trip-all-time-toggle-scopes
 */

import type { ReactElement } from 'react';

import { BrandMark } from '../../../components/brand/BrandMark.tsx';

import { LOG_SCOPES, SCOPE_LABELS } from '../exposure.ts';
import type { LogScope } from '../exposure.ts';

export interface LogHeaderProps {
  readonly scope: LogScope;
  /** Absent means "not wired in this build" -- the keys render disabled. */
  readonly onScope?: ((scope: LogScope) => void) | undefined;
}

export function LogHeader({ scope, onScope }: LogHeaderProps): ReactElement {
  return (
    <header className="fwm-log-header">
      <BrandMark />
      <h1 className="fwm-log-title">EXPOSURE</h1>
      <div className="fwm-log-toggle" role="group" aria-label="EXPOSURE SCOPE">
        {LOG_SCOPES.map((key) => (
          <button
            key={key}
            type="button"
            className="fwm-log-toggle-key"
            data-fwm-log-scope-key={key}
            aria-pressed={key === scope}
            disabled={onScope === undefined}
            onClick={
              onScope === undefined
                ? undefined
                : () => {
                    onScope(key);
                  }
            }
          >
            {SCOPE_LABELS[key]}
          </button>
        ))}
      </div>
    </header>
  );
}
