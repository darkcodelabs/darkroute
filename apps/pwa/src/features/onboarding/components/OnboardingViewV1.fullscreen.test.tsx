/**
 * FULL SCREEN IS ASKED FOR, NOT TAKEN.
 *
 * The app used to call `armImmersive()` unconditionally on mount, so the first
 * touch of every session took the whole screen - the clock, the battery and the
 * signal off a phone somebody was about to drive with. Nobody was asked, and it
 * became the most common complaint about the app.
 *
 * These tests hold the fix from both ends: the switch exists on the first
 * screen, and DOING NOTHING leaves it off. The second half is the one that
 * matters - a default is only a default if the person who never touches it gets
 * it.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, useSettingsStore } from '../../../stores/settings.ts';

import type { OnboardingPermission } from './OnboardingView.tsx';
import {
  FULLSCREEN_LABEL,
  FULLSCREEN_OFF,
  FULLSCREEN_ON,
  OnboardingViewV1,
} from './OnboardingViewV1.tsx';

const READY: OnboardingPermission = { permission: 'prompt', capability: 'supported' };

function first(): void {
  render(
    <OnboardingViewV1
      model={{
        location: READY,
        notifications: READY,
        motion: READY,
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

beforeEach(() => {
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

describe('the first-run full-screen switch', () => {
  it('is off for anybody who does not touch it', () => {
    expect(DEFAULT_SETTINGS.immersiveOnLaunch).toBe(false);

    first();
    const key = screen.getByTestId('onboarding-fullscreen');
    expect(key.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(FULLSCREEN_OFF)).toBeTruthy();
    expect(useSettingsStore.getState().immersiveOnLaunch).toBe(false);
  });

  it('is on the first screen, named, so nobody has to go looking for it', () => {
    first();
    expect(screen.getByText(FULLSCREEN_LABEL)).toBeTruthy();
  });

  it('turns on when pressed, and says what it will do', () => {
    first();
    fireEvent.click(screen.getByTestId('onboarding-fullscreen'));

    expect(useSettingsStore.getState().immersiveOnLaunch).toBe(true);
    expect(screen.getByText(FULLSCREEN_ON)).toBeTruthy();
  });

  it('turns back off, because a switch that only goes one way is a trap', () => {
    first();
    const key = screen.getByTestId('onboarding-fullscreen');
    fireEvent.click(key);
    fireEvent.click(key);

    expect(useSettingsStore.getState().immersiveOnLaunch).toBe(false);
  });
});
