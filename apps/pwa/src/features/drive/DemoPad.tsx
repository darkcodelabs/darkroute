/**
 * THE DEMO PAD - four directions, a brake, and a way out.
 * =============================================================================
 * Mounted over the map only while demo drive is on. Every press moves the
 * hand-placed fix in `services/adapters/demoGeolocation.ts`, which reaches the
 * app through the same subscriber set a real GPS fix does - so the alert
 * engine, the corridor, the navigation family and the abuse zones all run their
 * real code paths against it. Nothing here is a mock of anything.
 *
 * WHY A D-PAD AND NOT A DRAGGABLE PIN. A pin needs the map to give up its own
 * drag gesture, and the map's drag is how you look at where you are going. The
 * pad also gives the one thing a pin cannot: a HEADING, taken from the
 * direction you last moved. `planDetour` aims at the device heading when it has
 * one, and a demo with no heading exercises the parked branch instead of the
 * driving one - which is the bug that made "route around them" go one hop.
 *
 * THE STEP IS A REAL DISTANCE. Three sizes, in metres, so a demo can cross a
 * junction or cross a metro without either taking all afternoon or overshooting
 * the reader it was aimed at. They are distances, not design values.
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import {
  demoDriveState,
  haltDemoDrive,
  nudgeDemoDrive,
  stopDemoDrive,
  subscribeDemoDrive,
} from '../../services/adapters/demoGeolocation.ts';

import './demoPad.css';

/**
 * HOW FAR ONE PRESS GOES, in metres.
 *
 * 25 is inside a block: the step for walking up on a reader to watch the alert
 * escalate. 150 crosses a junction. 800 is the one that gets you between
 * clusters without forty presses. The alert thresholds run 100 to 1000 ft
 * (30 - 305 m), so the small step is deliberately finer than the tightest
 * threshold and the middle one straddles the widest.
 */
export const DEMO_STEPS = [
  { id: 'fine', label: '25 m', metres: 25 },
  { id: 'block', label: '150 m', metres: 150 },
  { id: 'far', label: '800 m', metres: 800 },
] as const;

export type DemoStepId = (typeof DEMO_STEPS)[number]['id'];

/* Compass bearings, clockwise from north. Degrees of arc, not lengths - the
   design gate reads bare numbers in a .tsx as candidate pixel values, and a
   quarter turn is the one number here that is neither. */
const QUARTER_TURN = 360 / 4;
const HEADINGS = {
  up: 0,
  right: QUARTER_TURN,
  down: QUARTER_TURN * 2,
  left: QUARTER_TURN * 3,
} as const;

export interface DemoPadProps {
  /** Called after demo mode is turned off, so the host can clear its own flag. */
  readonly onExit: () => void;
  /**
   * Called on every move, so the host can stop the map following.
   *
   * THE MARKER MOVES, THE MAP HOLDS. A real drive centres on the vehicle
   * because the driver cannot see round corners. A demo is the opposite case:
   * the operator is looking at the whole field and steering a dot across it, so
   * a map that recentres on every press pins the marker to the middle of the
   * screen and reads as a control that does nothing.
   */
  readonly onMove?: (() => void) | undefined;
  /**
   * The map's current rotation in degrees, so the arrows stay SCREEN directions.
   *
   * THE BUG THIS CLOSES: pressing RIGHT moved the marker UP. The arrows were
   * emitting true-north bearings while the map was rotated to the direction of
   * travel, so `east` was drawn wherever the map happened to have put it. An
   * arrow is a picture of a screen direction and must mean that whatever the
   * map is doing underneath.
   *
   * North-up is now the default, which makes this zero most of the time - but
   * heading-up is one row away in MAP VIEW and the pad has to be right in both.
   */
  readonly mapBearingDeg?: number | undefined;
}

export function DemoPad({ onExit, onMove, mapBearingDeg }: DemoPadProps): ReactElement | null {
  const [active, setActive] = useState(() => demoDriveState().active);
  const [step, setStep] = useState<DemoStepId>('block');

  useEffect(() => subscribeDemoDrive((s) => setActive(s.active)), []);

  if (!active) return null;

  const metres = DEMO_STEPS.find((s) => s.id === step)?.metres ?? 150;

  /* One place, so no direction can forget to recentre - or to account for the
     map's rotation. The arrow is a SCREEN direction; the world bearing it
     corresponds to is that direction plus however far the map has been turned.
     `% 360` keeps it in range for `conePath` and the heading readout. */
  const move = (screenBearing: number): void => {
    const world = (screenBearing + (mapBearingDeg ?? 0) + 360) % 360;
    nudgeDemoDrive(world, metres);
    onMove?.();
  };

  return (
    <div className="fwm-demo-pad" role="group" aria-label="Demo drive controls">
      <div className="fwm-demo-dial">
        <button
          type="button"
          className="fwm-demo-key"
          data-fwm-dir="up"
          aria-label="Move north"
          onClick={() => move(HEADINGS.up)}
        >
          <Chevron rotate={0} />
        </button>
        <button
          type="button"
          className="fwm-demo-key"
          data-fwm-dir="left"
          aria-label="Move west"
          onClick={() => move(HEADINGS.left)}
        >
          <Chevron rotate={270} />
        </button>

        {/* THE BRAKE. Parked is a state worth demonstrating on its own: the
            dock's browse states and the abuse zones only draw when the car is
            not moving, and a demo that can only drive can never show them. */}
        <button
          type="button"
          className="fwm-demo-halt"
          aria-label="Stop here"
          onClick={() => {
            haltDemoDrive();
            onMove?.();
          }}
        />

        <button
          type="button"
          className="fwm-demo-key"
          data-fwm-dir="right"
          aria-label="Move east"
          onClick={() => move(HEADINGS.right)}
        >
          <Chevron rotate={90} />
        </button>
        <button
          type="button"
          className="fwm-demo-key"
          data-fwm-dir="down"
          aria-label="Move south"
          onClick={() => move(HEADINGS.down)}
        >
          <Chevron rotate={180} />
        </button>
      </div>

      <div className="fwm-demo-steps" role="radiogroup" aria-label="Step size">
        {DEMO_STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === step}
            className="fwm-demo-step"
            data-fwm-chosen={s.id === step ? 'true' : undefined}
            onClick={() => setStep(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="fwm-demo-exit"
        onClick={() => {
          stopDemoDrive();
          onExit();
        }}
      >
        <CloseMark />
        Exit demo mode
      </button>
    </div>
  );
}

/* Drawn, never a text character: a font without an arrow would silently
   substitute a box, and this is the control the whole demo runs on. */
function Chevron({ rotate }: { readonly rotate: number }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6 15l6-6 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={`rotate(${String(rotate)} 12 12)`}
      />
    </svg>
  );
}

function CloseMark(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
