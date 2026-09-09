/**
 * The REPORT key's two gestures, and what v2 draws on it.
 *
 *   "REPORT is the last key in the bar, always far right: 42px eye mark on a
 *    tinted chip, split from the destinations by a hairline. Tap opens the
 *    sheet, 1s hold drops a pin. Amber badge = queued reports."
 *     -- Flockys App Screens v2.dc.html, DOCK panel
 *   "HOLD REPORT BUTTON 1s TO ONE-TAP DROP A PIN"
 *     -- Flockys App Screens v2.dc.html, 06 REPORT
 *
 * The defect these tests exist to prevent is a hold that ALSO opens the sheet:
 * a driver holding for a pin drop would get a modal in their face at speed.
 * v2 changed the key's SHAPE and nothing about its gestures, so every gesture
 * test below is the one that guarded the 52px bar, unchanged.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { disposeScreenState, getScreenState } from '../../app/screenState.ts';

import {
  HOLD_MOVE_SLOP_PX,
  HOLD_TO_DROP_MS,
  PIN_CONFIRM_DWELL_MS,
  ReportKey,
} from './ReportKey.tsx';

function setup(queuedCount = 2) {
  const onReport = vi.fn();
  const onPinDrop = vi.fn();
  const onHaptic = vi.fn();
  render(
    <ReportKey
      queuedCount={queuedCount}
      onReport={onReport}
      onPinDrop={onPinDrop}
      onHaptic={onHaptic}
    />,
  );
  return { key: screen.getByRole('button'), onReport, onPinDrop, onHaptic };
}

/** Fake timers are load-bearing here: the whole contract is a 1s threshold. */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // The screen-state adapter is module state; the default-wiring test moves it.
  disposeScreenState();
});

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('ReportKey gestures', () => {
  it('drops a pin after a 1s hold and never also opens the sheet', () => {
    const { key, onReport, onPinDrop, onHaptic } = setup();

    fireEvent.pointerDown(key, { button: 0, clientX: 100, clientY: 200 });
    expect(onPinDrop).not.toHaveBeenCalled();

    advance(HOLD_TO_DROP_MS);
    expect(onPinDrop).toHaveBeenCalledTimes(1);
    expect(onHaptic).toHaveBeenCalledTimes(1);
    expect(onReport).not.toHaveBeenCalled();

    // Releasing after the drop must not turn the hold into a tap as well.
    fireEvent.pointerUp(key, { button: 0, clientX: 100, clientY: 200 });
    expect(onReport).not.toHaveBeenCalled();
    expect(onPinDrop).toHaveBeenCalledTimes(1);
  });

  it('opens the sheet when the hold is released at 500ms, and drops no pin', () => {
    const { key, onReport, onPinDrop, onHaptic } = setup();

    fireEvent.pointerDown(key, { button: 0, clientX: 100, clientY: 200 });
    advance(500);
    fireEvent.pointerUp(key, { button: 0, clientX: 100, clientY: 200 });

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onPinDrop).not.toHaveBeenCalled();
    expect(onHaptic).not.toHaveBeenCalled();

    // The armed timer was cleared, not merely ignored.
    advance(HOLD_TO_DROP_MS * 2);
    expect(onPinDrop).not.toHaveBeenCalled();
  });

  it('cancels the hold when the pointer moves beyond the slop', () => {
    const { key, onReport, onPinDrop } = setup();

    fireEvent.pointerDown(key, { button: 0, clientX: 100, clientY: 200 });
    fireEvent.pointerMove(key, { clientX: 100, clientY: 200 + HOLD_MOVE_SLOP_PX * 4 });
    advance(HOLD_TO_DROP_MS);
    fireEvent.pointerUp(key, { button: 0, clientX: 100, clientY: 240 });

    expect(onPinDrop).not.toHaveBeenCalled();
    expect(onReport).not.toHaveBeenCalled();
  });

  it('tolerates a small drift -- a thumb in a car mount is never still', () => {
    const { key, onPinDrop } = setup();

    fireEvent.pointerDown(key, { button: 0, clientX: 100, clientY: 200 });
    fireEvent.pointerMove(key, { clientX: 102, clientY: 203 });
    advance(HOLD_TO_DROP_MS);

    expect(onPinDrop).toHaveBeenCalledTimes(1);
  });

  it('fires nothing when the gesture is cancelled by the platform', () => {
    const { key, onReport, onPinDrop } = setup();

    fireEvent.pointerDown(key, { button: 0, clientX: 100, clientY: 200 });
    fireEvent.pointerCancel(key);
    advance(HOLD_TO_DROP_MS);
    fireEvent.pointerUp(key, { button: 0, clientX: 100, clientY: 200 });

    expect(onPinDrop).not.toHaveBeenCalled();
    expect(onReport).not.toHaveBeenCalled();
  });

  it('ignores a secondary button', () => {
    const { key, onReport, onPinDrop } = setup();

    fireEvent.pointerDown(key, { button: 2, clientX: 100, clientY: 200 });
    advance(HOLD_TO_DROP_MS);
    fireEvent.pointerUp(key, { button: 2, clientX: 100, clientY: 200 });

    expect(onPinDrop).not.toHaveBeenCalled();
    expect(onReport).not.toHaveBeenCalled();
  });

  it('opens the sheet from the keyboard without arming the hold', () => {
    const { key, onReport, onPinDrop } = setup();

    fireEvent.keyDown(key, { key: 'Enter' });
    advance(HOLD_TO_DROP_MS);

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onPinDrop).not.toHaveBeenCalled();
  });

  it('never touches the vibration motor itself', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      writable: true,
      value: vibrate,
    });
    try {
      const { key } = setup();
      fireEvent.pointerDown(key, { button: 0, clientX: 100, clientY: 200 });
      advance(HOLD_TO_DROP_MS);
      // Haptics are reserved for camera alerts. The key reports the drop
      // through onHaptic and lets the owner decide, it does not buzz.
      expect(vibrate).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate');
    }
  });
});

describe('ReportKey readout', () => {
  it('draws the eye mark, and only the eye mark', () => {
    const { key } = setup(0);
    // "42px eye mark on a tinted chip" -- one masked brand image, no glyph
    // redrawn in SVG and no emoji.
    expect(key.querySelector('.fwm-report-eye')).not.toBeNull();
    expect(key.querySelector('svg, img')).toBeNull();
  });

  it('badges the queue as a numeral, and says it in full to a screen reader', () => {
    setup(2);
    // v2 paints the bare count; a numeral alone is meaningless read aloud, so
    // v1's wording survives as the accessible text.
    const badge = screen.getByText('2');
    expect(badge.classList.contains('fwm-report-badge')).toBe(true);
    expect(badge.dataset['fwmQueued']).toBe('2');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('2 QUEUED')).toBeInTheDocument();
  });

  it('renders no badge when nothing is queued', () => {
    setup(0);
    expect(screen.queryByText(/QUEUED/)).toBeNull();
    expect(document.querySelector('.fwm-report-badge')).toBeNull();
  });

  it('names itself REPORT CAMERA, confirms PIN DROPPED, then goes back', () => {
    const { key } = setup();
    expect(screen.getByText('REPORT CAMERA')).toBeInTheDocument();
    expect(key.dataset['fwmConfirming']).toBe('false');

    fireEvent.pointerDown(key, { button: 0, clientX: 100, clientY: 200 });
    advance(HOLD_TO_DROP_MS);
    expect(screen.getByText('PIN DROPPED')).toBeInTheDocument();
    expect(screen.queryByText('REPORT CAMERA')).toBeNull();
    // The design draws no confirmation state at all; the attribute is what
    // `reportKey.css` inverts the chip on.
    expect(key.dataset['fwmConfirming']).toBe('true');

    advance(PIN_CONFIRM_DWELL_MS);
    expect(screen.getByText('REPORT CAMERA')).toBeInTheDocument();
    expect(screen.queryByText('PIN DROPPED')).toBeNull();
    expect(key.dataset['fwmConfirming']).toBe('false');
  });

  it('does not follow the active screen hue -- v2 draws it crimson on all five', () => {
    // v1's bar took the lit key's colour. All five v2 docks draw the eye in
    // #FF2D5E, so the key carries no hue attribute to be re-pointed at all.
    const { key } = setup();
    expect(key.dataset['fwmDockHue']).toBeUndefined();
    expect(key.dataset['fwmDockKey']).toBe('report');
  });

  it('advertises an armed hold when a pin-drop handler is wired', () => {
    const { key } = setup();
    expect(key.dataset['fwmPinDrop']).toBe('hold');
  });
});

describe('ReportKey without a pin-drop handler', () => {
  it('does not arm the hold, and says the capability is unavailable', () => {
    render(<ReportKey />);
    const key = screen.getByRole('button');
    expect(key.dataset['fwmPinDrop']).toBe('unavailable');

    fireEvent.pointerDown(key, { button: 0, clientX: 10, clientY: 10 });
    advance(HOLD_TO_DROP_MS * 2);
    expect(screen.queryByText('PIN DROPPED')).toBeNull();
    expect(screen.getByText('REPORT CAMERA')).toBeInTheDocument();
  });

  it('still opens the report screen on a tap, through the screen-state adapter', () => {
    render(<ReportKey />);
    const key = screen.getByRole('button');
    fireEvent.pointerDown(key, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(key, { button: 0, clientX: 10, clientY: 10 });
    expect(getScreenState().screen).toBe('report');
  });
});
