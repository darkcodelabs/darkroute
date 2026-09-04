/**
 * ONBOARDING's markup, extracted from the screen without a character changed.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * v1 redraws this screen and must not fork what is behind it. `start()` in the
 * container carries the fix for the refresh trap - the FIRST location refusal
 * stops once and says why, every press after that goes through - and that is
 * the single most consequential piece of logic in the first-run flow: getting
 * it wrong strands a driver on a screen whose only button appears to do
 * nothing. There will be exactly one copy of it.
 *
 * So the container keeps everything it had and hands a model to a view.
 *
 * THIS FILE IS A MOVE, NOT A REWRITE. Every element, class, testId, string and
 * order is what `OnboardingScreen` rendered before the extraction, which is why
 * `OnboardingScreen.test.tsx` is untouched by it.
 */

import type { ReactElement } from 'react';

import type { CapabilityStatus, PermissionStatus } from '../../../stores/index.ts';

import { HandleToggle } from './HandleToggle.tsx';
import { LocationDeniedNotice } from './LocationDeniedNotice.tsx';
import { PermissionCard } from './PermissionCard.tsx';

/**
 * The lede. Transcribed character for character, straight apostrophe included.
 * Kept as a constant so the string is in one place and a reflow of the JSX
 * cannot quietly re-wrap it into different whitespace.
 */
export const LEDE =
  'Cameras read your plate as you drive. This tells you where they are, before you pass them. ' +
  "Three permissions, then you're done.";

export const LOCATION_BODY =
  'Required. Distance to cameras is computed on-device. Coordinates never leave the phone unless ' +
  'you file a report.';

export const NOTIFICATIONS_BODY =
  'Asks the browser to show an alert notice. Delivery follows browser and phone rules. One ' +
  'channel, replaces itself, never stacks.';

export const MOTION_BODY = 'Compass auto-fills which way a camera faces when you report one.';

/** One permission, as both views read it. */
export interface OnboardingPermission {
  readonly permission: PermissionStatus;
  readonly capability: CapabilityStatus;
}

export interface OnboardingViewModel {
  readonly location: OnboardingPermission;
  readonly notifications: OnboardingPermission;
  readonly motion: OnboardingPermission;
  /** True when location has actually been refused, not merely unasked. */
  readonly locationDenied: boolean;
  readonly showHandle: boolean;
}

export interface OnboardingViewHandlers {
  readonly onRequestLocation: () => void;
  readonly onRequestNotifications: () => void;
  readonly onRequestMotion: () => void;
  readonly onShowHandleChange: (next: boolean) => void;
  /** START WATCHING. The container owns what this does. */
  readonly onStart: () => void;
}

export type OnboardingViewProps = OnboardingViewHandlers & {
  readonly model: OnboardingViewModel;
};

export function OnboardingView({
  model,
  onRequestLocation,
  onRequestNotifications,
  onRequestMotion,
  onShowHandleChange,
  onStart,
}: OnboardingViewProps): ReactElement {
  return (
    <section className="fwm-onboarding" data-testid="onboarding">
      <header className="fwm-onboarding-header">
        <h1 className="fwm-onboarding-wordmark">
          Dark<span className="fwm-onboarding-wordmark-hue">Route</span>
        </h1>
        <p className="fwm-onboarding-tagline">THEY WATCHING. WE WATCHING BACK.</p>
      </header>

      <p className="fwm-onboarding-lede">{LEDE}</p>

      <ul className="fwm-onboarding-permissions">
        <PermissionCard
          testId="permission-location"
          label="LOCATION"
          body={LOCATION_BODY}
          role="required"
          permission={model.location.permission}
          capability={model.location.capability}
          onRequest={onRequestLocation}
        />
        <PermissionCard
          testId="permission-notifications"
          label="NOTIFICATIONS"
          body={NOTIFICATIONS_BODY}
          role="recommended"
          permission={model.notifications.permission}
          capability={model.notifications.capability}
          onRequest={onRequestNotifications}
        />
        <PermissionCard
          testId="permission-motion"
          label="MOTION SENSORS"
          body={MOTION_BODY}
          role="optional"
          permission={model.motion.permission}
          capability={model.motion.capability}
          onRequest={onRequestMotion}
        />
      </ul>

      {/* Sits under the three cards rather than inside the list: a live region
          is not a list item, and the notice names LOCATION itself. */}
      {model.locationDenied ? <LocationDeniedNotice onRetry={onRequestLocation} /> : null}

      <HandleToggle checked={model.showHandle} onChange={onShowHandleChange} />

      <footer className="fwm-onboarding-footer">
        <button type="button" className="fwm-onboarding-start" onClick={onStart}>
          START WATCHING
        </button>
        {/* The design draws these as one centred block split by a <br>. */}
        <p className="fwm-onboarding-fineprint">
          <span className="fwm-onboarding-fineprint-line">
            no account · no analytics · GPL-3.0-only source
          </span>
          <span className="fwm-onboarding-fineprint-line">
            you can skip everything except location
          </span>
        </p>
      </footer>
    </section>
  );
}
