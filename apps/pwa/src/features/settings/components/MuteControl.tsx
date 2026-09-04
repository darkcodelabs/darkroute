/**
 * MUTE - the control that used to be a three-letter key called VOL.
 *
 * WHY IT MOVED HERE
 *   RADAR's header drew `VOL` with a hue outline, implying an armed control,
 *   and the design specified no behaviour for it anywhere. It is the mute, and
 *   mute has rules a driver has to know BEFORE they press it:
 *
 *     · it runs out. Ten minutes, then alerts come back on their own. A mute
 *       that stayed on until you remembered to undo it is how somebody drives
 *       silent for a week.
 *     · it does not silence everything. A camera closer than the re-alert
 *       distance still fires. Muting is "not this one, not now", not "stop
 *       watching".
 *     · it changes nothing that gets recorded. Passes still count, the log
 *       still fills, the zone card still counts what is around you.
 *
 *   None of that fits behind a 44px key labelled VOL. It fits next to a switch
 *   with the sentences printed under it, which is what this is.
 *
 * WHY THE COUNTDOWN IS LIVE
 *   `mutedRemainingMs` is held in the alert store and ticked by the driving
 *   loop, so this reads it rather than running a second timer. Two clocks
 *   counting the same mute is how they end up disagreeing on screen.
 */

import type { ReactElement } from 'react';

import { DEFAULT_MUTE_DURATION_MS } from '../../../stores/fwmCore.ts';

import { formatMuteCountdown } from '../../radar/format.ts';
import { alertActions, useIsMuted, useMuteRemainingMs } from '../../../stores/index.ts';

import { SwitchRow } from './SwitchRow.tsx';

export const MUTE_SECTION = 'MUTE';
export const MUTE_LABEL = 'MUTE ALL ALERTS';

/** The rules, in the order they surprise somebody. */
export const MUTE_RULES: readonly string[] = Object.freeze([
  `runs out on its own after ${String(Math.round(DEFAULT_MUTE_DURATION_MS / 60_000))} minutes.`,
  'a camera closer than your re-alert distance still fires through it.',
  'passes are still counted and still logged. muting hides the alert, not the record.',
]);

export interface MuteControlProps {
  /**
   * Injected so a test can drive the clock. The store stamps the mute with
   * this, and the driving loop counts down from it.
   */
  readonly nowMs?: number;
}

export function MuteControl({ nowMs }: MuteControlProps = {}): ReactElement {
  const muted = useIsMuted();
  const remainingMs = useMuteRemainingMs();

  const toggle = (on: boolean): void => {
    const at = nowMs ?? Date.now();
    if (on) alertActions.muteAll(at);
    else alertActions.unmuteAll(at);
  };

  return (
    <section className="fwm-settings-section" aria-label={MUTE_SECTION}>
      <h2 className="fwm-settings-eyebrow fwm-data">{MUTE_SECTION}</h2>
      <SwitchRow label={MUTE_LABEL} on={muted} onToggle={toggle} />
      {muted && remainingMs > 0 ? (
        <p className="fwm-settings-mute-countdown fwm-data" data-fwm-settings-mute="counting">
          {`alerts return in ${formatMuteCountdown(remainingMs)}`}
        </p>
      ) : null}
      <div className="fwm-settings-promises fwm-data">
        {MUTE_RULES.map((rule) => (
          <p key={rule} className="fwm-settings-promise">
            {rule}
          </p>
        ))}
      </div>
    </section>
  );
}
