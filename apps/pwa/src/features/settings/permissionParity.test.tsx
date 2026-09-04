/**
 * THE PERMISSION CONTROL IS THE SAME ON BOTH SCREENS.
 *
 * Onboarding asks for these three, and SETTINGS is where a driver goes back to
 * change them. They were two different controls doing one job: onboarding got
 * switches, and settings kept a status pill that read GRANTED / ALLOW /
 * OPTIONAL and afforded nothing. A driver who learned the switch on the first
 * screen of the app met a label on the second.
 *
 * That is the drift this file exists to catch. It asserts the CONTRACT rather
 * than the markup - role, checked state, and the one-way/two-way rule - so the
 * two can be styled apart but cannot start behaving differently.
 *
 * The rule, on both screens:
 *
 *   ON      the OS granted it AND we are using it
 *   OFF     either the OS has not granted it, or the driver switched us off
 *   press   requests when there is a prompt behind it; otherwise flips our own
 *           use of the grant, in either direction
 *   granted rows stay reachable (`aria-disabled`), never `disabled` - a
 *           disabled control is skipped by screen-reader control navigation
 *   UNAVAILABLE is the only genuinely `disabled` state
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCapabilitiesStore } from '../../stores/capabilities.ts';
import { useSettingsStore } from '../../stores/index.ts';
import { OnboardingViewV1 } from '../onboarding/components/OnboardingViewV1.tsx';
import type { OnboardingPermission } from '../onboarding/components/OnboardingView.tsx';
import { PermissionsV1 } from './components/PermissionsV1.tsx';

const GRANTED: OnboardingPermission = { permission: 'granted', capability: 'supported' };

beforeEach(() => {
  for (const name of ['geolocation', 'notifications', 'motion'] as const) {
    useSettingsStore.getState().setCapabilityEnabled(name, true);
  }
  /*
   * SEEDED, because jsdom has none of these APIs and an unprobed capability
   * reports `unsupported` - which is the one state where `disabled` is
   * correct. Without this the parity assertions would pass for the wrong
   * reason: both screens agreeing that everything is unavailable.
   */
  useCapabilitiesStore.setState({
    capabilities: Object.freeze({
      geolocation: { supported: true },
      notifications: { supported: true },
      motion: { supported: true },
    } as never),
    permissions: Object.freeze({
      geolocation: 'granted',
      notifications: 'granted',
      motion: 'granted',
    } as never),
  });
});

function onboarding(): void {
  render(
    <OnboardingViewV1
      model={{
        location: GRANTED,
        notifications: GRANTED,
        motion: GRANTED,
        locationDenied: false,
        showHandle: false,
      }}
      onRequestLocation={vi.fn()}
      onRequestNotifications={vi.fn()}
      onRequestMotion={vi.fn()}
      onShowHandleChange={vi.fn()}
      onStart={vi.fn()}
    />,
  );
}

describe('the permission control, on both screens', () => {
  it('is a switch on ONBOARDING', () => {
    onboarding();

    expect(screen.getAllByRole('switch').length).toBeGreaterThanOrEqual(3);
  });

  it('is a switch on SETTINGS, not a status word', () => {
    render(<PermissionsV1 />);

    // The regression this file is named for: settings kept a pill that said
    // GRANTED and could not be pressed.
    expect(screen.getAllByRole('switch').length).toBeGreaterThanOrEqual(3);
  });

  it('reflects the SAME state on both, because it is the same preference', () => {
    useSettingsStore.getState().setCapabilityEnabled('geolocation', false);

    const { unmount } = render(<PermissionsV1 />);
    const inSettings = screen
      .getAllByRole('switch')
      .map((el) => el.getAttribute('aria-checked'));
    unmount();

    onboarding();
    const inOnboarding = screen
      .getAllByRole('switch')
      .map((el) => el.getAttribute('aria-checked'));

    // Location is off in both, and off for the same reason: one store field
    // that both screens read. Two sources of truth is how they drift.
    expect(inSettings[0]).toBe('false');
    expect(inOnboarding[0]).toBe('false');
  });

  it('never disables a row it has drawn as ON, on either screen', () => {
    /*
     * The invariant, stated so it holds without seeding a capability the way
     * `PermissionsV1` would immediately re-probe away: a row drawn CHECKED is a
     * row the driver can switch off, on both screens. If checked ever implies
     * `disabled`, the switch has become a status light again - which is the
     * exact regression this file is named for.
     */
    const check = (): void => {
      for (const el of screen.getAllByRole('switch') as HTMLButtonElement[]) {
        if (el.getAttribute('aria-checked') === 'true') {
          expect(el.disabled).toBe(false);
          expect(el.getAttribute('aria-disabled')).toBe('false');
        }
      }
    };

    const { unmount } = render(<PermissionsV1 />);
    check();
    unmount();

    onboarding();
    check();
  });
});
