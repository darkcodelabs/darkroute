/**
 * The test-alert button reports what the platform actually said.
 *
 * The one thing worth pinning here is that the outcome word is the ADAPTER'S,
 * not a fixed "sent". A control that says the same thing whether the OS raised a
 * card or refused one is worse than no control: it is a green light wired to
 * nothing, on the screen a driver opens precisely because they suspect the
 * alerter is silent.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMockAdapters, type MockAdapterSet } from '../../../services/adapters/testing/mocks.ts';
import { ALERT_TEST_BEARING, ALERT_TEST_IDLE, AlertTestV1 } from './AlertTestV1.tsx';

let adapters: MockAdapterSet;

beforeEach(() => {
  adapters = createMockAdapters();
});

const button = (): HTMLElement => screen.getByTestId('settingsv1-alert-test');

describe('the test alert', () => {
  it('sends nothing until it is pressed', () => {
    render(<AlertTestV1 adapters={adapters} />);
    expect(button()).toHaveAttribute('data-fwm-state', ALERT_TEST_IDLE);
  });

  it('goes through the same notification adapter a camera alert uses', async () => {
    render(<AlertTestV1 adapters={adapters} />);
    await act(async () => {
      fireEvent.click(button());
    });

    await waitFor(() => {
      expect(button()).not.toHaveAttribute('data-fwm-state', ALERT_TEST_IDLE);
    });

    // The body that lands on the lock screen says what it is. A test card
    // indistinguishable from a real one teaches the driver to distrust both.
    const composed = adapters.notifications.compose({
      kind: 'camera-alert',
      state: 'in_range',
      distanceFt: 500,
      bearingLabel: ALERT_TEST_BEARING,
      inRangeCount: 1,
    });
    expect(composed.body).toContain('test alert');
  });

  it('reports the adapter’s own refusal rather than claiming success', async () => {
    adapters.notifications.show = () =>
      Promise.resolve({
        outcome: 'blocked' as const,
        channel: 'alert-in-range' as const,
        tag: 'fwm-camera-alert',
        silent: false,
        reason: 'the phone refused',
      });

    render(<AlertTestV1 adapters={adapters} />);
    await act(async () => {
      fireEvent.click(button());
    });

    await waitFor(() => {
      expect(button()).toHaveAttribute('data-fwm-state', 'blocked');
    });
    expect(screen.getByText('the phone refused')).toBeInTheDocument();
  });
});
