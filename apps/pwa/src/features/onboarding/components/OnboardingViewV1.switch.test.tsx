/**
 * THE PERMISSION ROWS AS SWITCHES.
 *
 * A tester reported "none of the buttons on this work". The buttons were
 * firing - the request path from `onClick` to `adapter.request()` has no
 * `await` in front of it, so the user gesture survives - but nothing on the
 * screen afforded a press or acknowledged one. A word in a pill is a label,
 * not a control.
 *
 * =============================================================================
 * THE HALF THAT IS EASY TO BREAK LATER
 * =============================================================================
 * This switch only goes one way. No web API hands a permission back, so
 * turning one OFF is something only the browser's own site settings can do.
 * The obvious "fix" for that asymmetry - make the granted row `disabled` - is
 * wrong, and these tests exist to keep it wrong:
 *
 *   a `disabled` button is skipped by a screen reader's control navigation,
 *   so the one reader who most needs to hear "this is on, and here is where to
 *   change it" is the one who would never reach the row.
 *
 * So a granted row stays focusable, announces `aria-checked="true"` and
 * `aria-disabled="true"`, and refuses the press in the handler. UNAVAILABLE is
 * the only genuinely `disabled` state, because there is no prompt behind it on
 * that device and no advice to give.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '../../../stores/index.ts';
import { OnboardingViewV1 } from './OnboardingViewV1.tsx';
import type { OnboardingPermission } from './OnboardingView.tsx';

const READY: OnboardingPermission = { permission: 'prompt', capability: 'supported' };

function model(over: Partial<Record<'location' | 'notifications' | 'motion', OnboardingPermission>>) {
  return {
    location: READY,
    notifications: READY,
    motion: READY,
    locationDenied: false,
    showHandle: false,
    ...over,
  };
}

function view(over: Parameters<typeof model>[0] = {}, handlers = {}) {
  const props = {
    onRequestLocation: vi.fn(),
    onRequestNotifications: vi.fn(),
    onRequestMotion: vi.fn(),
    onStart: vi.fn(),
    onShowHandleChange: vi.fn(),
    ...handlers,
  };
  render(<OnboardingViewV1 model={model(over)} {...props} />);
  return props;
}

/** The row for one permission, by the role a user actually navigates by. */
function row(name: RegExp): HTMLButtonElement {
  return screen.getByRole('switch', { name }) as HTMLButtonElement;
}

beforeEach(() => {
  useSettingsStore.getState().setCapabilityEnabled('geolocation', true);
  useSettingsStore.getState().setCapabilityEnabled('notifications', true);
  useSettingsStore.getState().setCapabilityEnabled('motion', true);
});

describe('the onboarding permission switches', () => {
  it('is a switch, not an unlabelled button, so it reads as pressable', () => {
    view();

    // `getByRole('switch')` is the assertion: it fails if these go back to
    // being plain buttons with a word in a pill.
    expect(screen.getAllByRole('switch')).toHaveLength(3);
  });

  it('asks for the permission when an ungranted row is pressed', () => {
    const props = view();

    fireEvent.click(row(/Location/i));

    expect(props.onRequestLocation).toHaveBeenCalledTimes(1);
  });

  it('shows a granted permission as ON', () => {
    view({ location: { permission: 'granted', capability: 'supported' } });

    expect(row(/Location/i).getAttribute('aria-checked')).toBe('true');
  });

  it('turns a granted permission OFF, which is the half the OS cannot do', () => {
    const props = view({ location: { permission: 'granted', capability: 'supported' } });
    const control = row(/Location/i);

    // Pressable in BOTH directions once the OS has answered: the grant is
    // one-way, but whether the app USES it is not, and that is the switch.
    expect(control.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(control);

    // No prompt - there is nothing to ask for, the answer is already yes.
    expect(props.onRequestLocation).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().capabilitiesEnabled.geolocation).toBe(false);
  });

  it('reads OFF once the driver has switched it off, though the grant remains', () => {
    useSettingsStore.getState().setCapabilityEnabled('geolocation', false);
    view({ location: { permission: 'granted', capability: 'supported' } });
    const control = row(/Location/i);

    // The OS still says granted. The switch says off, because that is the
    // question a driver is actually asking of it.
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.textContent).toMatch(/not using it/i);
    // ...and it says the grant is still there, because pretending otherwise
    // would be the same dishonesty in the other direction.
    expect(control.textContent).toMatch(/permission itself stays/i);
  });

  it('turns it back on without re-prompting, because the answer is already yes', () => {
    useSettingsStore.getState().setCapabilityEnabled('geolocation', false);
    const props = view({ location: { permission: 'granted', capability: 'supported' } });

    fireEvent.click(row(/Location/i));

    expect(useSettingsStore.getState().capabilitiesEnabled.geolocation).toBe(true);
    expect(props.onRequestLocation).not.toHaveBeenCalled();
  });

  it('says where a refused permission can be allowed', () => {
    view({ location: { permission: 'denied', capability: 'supported' } });
    const control = row(/Location/i);

    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(control.textContent).toMatch(/site settings/i);
  });

  it('genuinely disables a permission this device does not have', () => {
    view({ motion: { permission: 'unavailable', capability: 'unsupported' } });
    const control = row(/Motion/i);

    // The one state where `disabled` is right: no prompt exists behind it on
    // this device, and there is no advice to send anyone anywhere with.
    expect(control.disabled).toBe(true);
    expect(control.textContent).toMatch(/does not offer it/i);
  });

  it('lets an unread row be pressed, because location is the press this depends on', () => {
    const props = view({ location: { permission: 'unknown', capability: 'supported' } });

    fireEvent.click(row(/Location/i));

    expect(props.onRequestLocation).toHaveBeenCalledTimes(1);
  });
});
