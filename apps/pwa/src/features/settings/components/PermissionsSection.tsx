/**
 * PERMISSIONS, ON THE SETTINGS SCREEN.
 *
 * Onboarding asks for location, notifications and motion once, on first run.
 * After that there was nowhere in the product to see what had been granted or
 * to change it - a driver who tapped "not now" on location, or who revoked it
 * later in the OS, had no route back except reinstalling. That is the gap this
 * closes.
 *
 * IT IS THE SAME CONTROL, NOT A SECOND ONE.
 *   `PermissionCard` is imported from `features/onboarding` rather than
 *   reimplemented, so the status words, the roles (required / recommended / optional)
 *   and the "unavailable on this platform" case cannot drift between the two
 *   screens. If they ever disagree, one of them is lying about what the OS
 *   said.
 *
 * THE RULE ONBOARDING LIVES BY APPLIES HERE TOO
 *   Nothing on this screen calls `request()` on mount. A permission prompt is
 *   only legal from a user gesture, and a settings screen that raises an OS
 *   dialog just for being opened is a settings screen nobody opens twice.
 *   Reading the CURRENT state is passive and happens on mount; asking is a tap.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   The handle toggle. Onboarding asks it in the same breath, but `showHandle`
 *   is only read when presence is live, and presence is off - SETTINGS does not
 *   offer a control that would write a field nothing honours. Its own test says
 *   so, and the test is right.
 *
 * WHAT IT CANNOT DO
 *   Revoke. No web API can hand a permission back - that is the OS's screen,
 *   not ours. A row that has been granted says so and points at the system
 *   settings rather than offering a button that would silently do nothing.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';

import { createPlatformAdapters } from '../../../services/adapters';
import type { AdapterSet } from '../../../services/adapters';
import {
  capabilitiesActions,
  useCapabilityStatus,
  usePermission,
} from '../../../stores/index.ts';
import type { AdapterName } from '../../../stores/index.ts';
import { PermissionCard } from '../../onboarding/components/PermissionCard.tsx';

export const PERMISSIONS_SECTION = 'PERMISSIONS';
export const PERMISSIONS_CAPTION =
  'what this app is allowed to read. granting is a tap; taking it back is your phone’s settings, not ours.';

/** The same three onboarding asks for, in the same order, with the same copy. */
const LOCATION_BODY =
  'Required. Distance to cameras is computed on-device. Coordinates never leave the phone unless ' +
  'you file a report.';
const NOTIFICATIONS_BODY =
  'Asks the browser to show an alert notice. Delivery follows browser and phone rules. One ' +
  'channel, replaces itself, never stacks.';
const MOTION_BODY = 'Compass auto-fills which way a camera faces when you report one.';

export interface PermissionsSectionProps {
  /** Injected in tests so nothing probes a real platform. */
  readonly adapters?: AdapterSet;
  /** Injected in tests. */
  readonly now?: () => number;
}

export function PermissionsSection({ adapters, now }: PermissionsSectionProps): ReactElement {
  const set = useMemo(() => adapters ?? createPlatformAdapters(), [adapters]);
  const clockRef = useRef(now ?? Date.now);

  // PASSIVE on mount. `probe` reads capability, `readPermissions` reads state;
  // neither can raise a dialog. `request` is only ever called from a tap below.
  useEffect(() => {
    capabilitiesActions.probe(set, clockRef.current());
    void capabilitiesActions.readPermissions(set);
  }, [set]);

  const request = useCallback(
    (name: AdapterName): void => {
      void capabilitiesActions.request(set, name);
    },
    [set],
  );

  return (
    <section className="fwm-settings-section" aria-label={PERMISSIONS_SECTION}>
      <h2 className="fwm-settings-eyebrow fwm-data">{PERMISSIONS_SECTION}</h2>
      <p className="fwm-settings-caption fwm-data">{PERMISSIONS_CAPTION}</p>

      <div className="fwm-settings-permissions">
        <PermissionCard
          label="LOCATION"
          body={LOCATION_BODY}
          role="required"
          permission={usePermission('geolocation')}
          capability={useCapabilityStatus('geolocation')}
          onRequest={() => {
            request('geolocation');
          }}
          testId="settings-permission-geolocation"
        />
        <PermissionCard
          label="NOTIFICATIONS"
          body={NOTIFICATIONS_BODY}
          role="recommended"
          permission={usePermission('notifications')}
          capability={useCapabilityStatus('notifications')}
          onRequest={() => {
            request('notifications');
          }}
          testId="settings-permission-notifications"
        />
        <PermissionCard
          label="MOTION SENSORS"
          body={MOTION_BODY}
          role="optional"
          permission={usePermission('motion')}
          capability={useCapabilityStatus('motion')}
          onRequest={() => {
            request('motion');
          }}
          testId="settings-permission-motion"
        />
      </div>

    </section>
  );
}
