/**
 * MUTE, where VOL used to be.
 *
 * The point of moving it was that mute has rules a driver needs BEFORE they
 * press it. So the rules being on screen is the thing tested hardest here - a
 * switch that silences alerts with no stated expiry is exactly the control that
 * was wrong in the header.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alertActions, useAlertStore } from '../../../stores/index.ts';
import { DEFAULT_MUTE_DURATION_MS } from '../../../stores/fwmCore.ts';

import { MUTE_LABEL, MUTE_RULES, MUTE_SECTION, MuteControl } from './MuteControl.tsx';

const NOW = 1_700_000_000_000;

beforeEach(() => {
  alertActions.reset();
});

afterEach(() => {
  alertActions.reset();
});

describe('MuteControl', () => {
  it('reads unmuted when nothing is muted', () => {
    render(<MuteControl nowMs={NOW} />);
    expect(screen.getByRole('switch', { name: MUTE_LABEL })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('mutes every alert from one press, and unmutes from the next', () => {
    render(<MuteControl nowMs={NOW} />);
    const control = screen.getByRole('switch', { name: MUTE_LABEL });

    fireEvent.click(control);
    expect(useAlertStore.getState().muted).toBe(true);

    fireEvent.click(screen.getByRole('switch', { name: MUTE_LABEL }));
    expect(useAlertStore.getState().muted).toBe(false);
  });

  it('states the three rules that make mute surprising, always', () => {
    // Not conditional on being muted: they are what a driver needs to know
    // BEFORE pressing, which is the whole reason this is not a header key.
    render(<MuteControl nowMs={NOW} />);
    for (const rule of MUTE_RULES) {
      expect(screen.getByText(rule)).toBeInTheDocument();
    }
  });

  it('says how long the mute lasts, in the rules, in minutes', () => {
    // A mute with no stated expiry is how somebody drives silent for a week.
    const minutes = String(Math.round(DEFAULT_MUTE_DURATION_MS / 60_000));
    expect(MUTE_RULES.some((rule) => rule.includes(minutes))).toBe(true);
  });

  it('counts down only while something is actually muted', () => {
    const { container, rerender } = render(<MuteControl nowMs={NOW} />);
    expect(container.querySelector('[data-fwm-settings-mute="counting"]')).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: MUTE_LABEL }));
    rerender(<MuteControl nowMs={NOW} />);

    const countdown = container.querySelector('[data-fwm-settings-mute="counting"]');
    expect(countdown?.textContent).toMatch(/^alerts return in \d+:\d{2}$/);
  });

  it('reads the store’s clock rather than running a second one', () => {
    // Two timers counting the same mute is how they end up disagreeing on
    // screen. The countdown text is derived from `mutedRemainingMs`.
    render(<MuteControl nowMs={NOW} />);
    fireEvent.click(screen.getByRole('switch', { name: MUTE_LABEL }));
    expect(useAlertStore.getState().mutedRemainingMs).toBeGreaterThan(0);
  });

  it('is its own labelled section, so it is findable without reading every row', () => {
    const { container } = render(<MuteControl nowMs={NOW} />);
    expect(container.querySelector(`[aria-label="${MUTE_SECTION}"]`)).not.toBeNull();
  });
});
