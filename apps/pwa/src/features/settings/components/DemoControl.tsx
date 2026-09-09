/**
 * DEMO MODE, as a row in SETTINGS.
 *
 * A scripted drive through everything the app does, for showing somebody who
 * is not in a car. It drives the REAL pipeline - see `features/demo` - so what
 * it shows is what the product does, and a stage that stops appearing means
 * something is genuinely broken rather than that the demo needs updating.
 *
 * It navigates to RADAR on start, because RADAR is the thing being
 * demonstrated and a demo you watch from the settings screen is not one.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { openScreen } from '../../../app/screenState.ts';
import { DEMO_STAGES, demoRunning, onDemoStage, toggleDemo } from '../../demo/demoDrive.ts';
import type { DemoStage } from '../../demo/demoDrive.ts';

export const DEMO_SECTION = 'DEMO';
export const DEMO_CAPTION =
  'a scripted drive: clear road, the first warning, the alert, a gauntlet, a county with a ' +
  'documented record, and a mute. it seeds its own cameras and puts your archive back when it ' +
  'stops.';
export const DEMO_START = 'RUN THE DEMO';
export const DEMO_STOP = 'STOP THE DEMO';

export function DemoControl(): ReactElement {
  const [stage, setStage] = useState<DemoStage | null>(null);

  /**
   * SUBSCRIBES, NEVER OWNS.
   *
   * This used to hold the handle and stop it on unmount, which is the right
   * instinct for a component with a timer and exactly wrong here: the button
   * navigates to RADAR, that unmounts SETTINGS, the cleanup fires, and the
   * demo stopped before its first tick. It looked like a frozen drive; it was
   * a cancelled one. The module owns it now, like the alert loop does.
   */
  useEffect(() => onDemoStage(setStage), []);

  const toggle = useCallback(() => {
    const wasRunning = demoRunning();
    toggleDemo();
    // Only navigate on START. On stop, stay where the driver already is.
    if (!wasRunning) openScreen('radar');
  }, []);

  return (
    <section className="fwm-settings-section" aria-label={DEMO_SECTION}>
      <h2 className="fwm-settings-eyebrow fwm-data">{DEMO_SECTION}</h2>
      <p className="fwm-settings-caption fwm-data">{DEMO_CAPTION}</p>
      <button type="button" className="fwm-settings-link" onClick={toggle}>
        <span className="fwm-settings-link-label fwm-data">
          {stage === null ? DEMO_START : DEMO_STOP}
        </span>
        <span className="fwm-settings-link-note fwm-data">
          {stage === null ? `${String(DEMO_STAGES.length)} STAGES` : stage.title}
        </span>
      </button>
    </section>
  );
}
