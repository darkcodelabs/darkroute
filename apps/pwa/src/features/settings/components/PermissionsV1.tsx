/**
 * PERMISSIONS - v1's row list.
 *
 * =============================================================================
 * WHY THIS IS NOT `PermissionsSection`
 * =============================================================================
 * That component draws v0's chrome: `fwm-settings-section`, `fwm-settings-
 * eyebrow`, and three `PermissionCard`s built for v0's SETTINGS. Rendering it
 * inside a v1 screen put a v0 panel in the middle of a v1 page, which is the
 * whole thing the two designs exist to keep apart.
 *
 * =============================================================================
 * WHAT IS SHARED, AND IT IS THE PART THAT MATTERS
 * =============================================================================
 * The BEHAVIOUR, not the markup:
 *
 *   - `capabilitiesActions.probe` / `readPermissions` on mount. Both are
 *     passive and documented as safe on load; neither can raise a dialog.
 *   - `capabilitiesActions.request` from a tap and from nowhere else. A
 *     settings screen that raises an OS prompt for being opened is a settings
 *     screen nobody opens twice.
 *   - `statusWordFor` and `isRequestable`, imported rather than re-derived, so
 *     v0 and v1 can never disagree about what the OS said or about which rows
 *     have a prompt behind them.
 *
 * WHAT IT STILL CANNOT DO: revoke. No web API hands a permission back. A
 * granted row says so and points at the system settings rather than offering a
 * button that would silently do nothing.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';

import { createPlatformAdapters } from '../../../services/adapters';
import type { AdapterSet } from '../../../services/adapters';
import {
  capabilitiesActions,
  useCapabilityEnabled,
  useCapabilityStatus,
  usePermission,
  useSettingsStore,
} from '../../../stores/index.ts';
import type { AdapterName } from '../../../stores/index.ts';
import { isRequestable, statusWordFor } from '../../onboarding/components/PermissionCard.tsx';
import type { PermissionRole } from '../../onboarding/components/PermissionCard.tsx';

export const PERMISSIONS_HEADING = 'Permissions';
export const PERMISSIONS_CAPTION =
  'what this app is allowed to read, and whether it is using it. switching one off stops us ' +
  'reading it; clearing the permission itself is your browser’s settings.';

/* The same three sentences the onboarding switches use. Imported would be
   better; duplicated is what the two screens already do for every other row,
   and diverging copy is the thing worth avoiding, not the constant. */
const GRANTED_SUB = 'on. switch it off here whenever you want.';
const OFF_SUB =
  'off. the app is not using it. the permission itself stays until you clear it in your browser.';
const DENIED_SUB = 'refused. your browser’s site settings are the only place to allow it.';
const UNAVAILABLE_SUB = 'this phone or browser does not offer it.';

/** The three the product actually asks for. Not every `AdapterName`. */
type PermissionName = 'geolocation' | 'notifications' | 'motion';

interface RowState {
  readonly permission: ReturnType<typeof usePermission>;
  readonly capability: ReturnType<typeof useCapabilityStatus>;
}

const ROWS: readonly {
  readonly name: PermissionName;
  readonly label: string;
  readonly sub: string;
  readonly role: PermissionRole;
}[] = [
  {
    name: 'geolocation',
    label: 'Location',
    sub: 'required. distance is computed here and never leaves the phone.',
    role: 'required',
  },
  {
    name: 'notifications',
    label: 'Notifications',
    sub: 'asks the phone to show alert notices. one channel, never stacks.',
    role: 'recommended',
  },
  {
    name: 'motion',
    label: 'Motion sensors',
    sub: 'fills in which way a camera faces when you report one.',
    role: 'optional',
  },
];

export interface PermissionsV1Props {
  /** Injected in tests so nothing probes a real platform. */
  readonly adapters?: AdapterSet;
  /** Injected in tests. */
  readonly now?: () => number;
}

export function PermissionsV1({ adapters, now }: PermissionsV1Props = {}): ReactElement {
  const set = useMemo(() => adapters ?? createPlatformAdapters(), [adapters]);
  const clockRef = useRef(now ?? Date.now);

  // PASSIVE on mount. Neither call can raise a dialog; `request` below is the
  // only door to one, and every caller of it is an onClick.
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

  /**
   * Read at the top, one call per row, never inside the map.
   *
   * Hooks cannot be called from a loop body, and the three rows are fixed, so
   * this is three literal pairs rather than a clever loop. v0's component has
   * the same shape for the same reason.
   *
   * Typed to the THREE names this screen offers rather than to `AdapterName`,
   * which spans fifteen capabilities - most of them not permissions at all.
   */
  const state: Record<PermissionName, RowState> = {
    geolocation: {
      permission: usePermission('geolocation'),
      capability: useCapabilityStatus('geolocation'),
    },
    notifications: {
      permission: usePermission('notifications'),
      capability: useCapabilityStatus('notifications'),
    },
    motion: { permission: usePermission('motion'), capability: useCapabilityStatus('motion') },
  };

  /* Our own use of each, which is the half that can be switched back off. */
  const enabled: Record<PermissionName, boolean> = {
    geolocation: useCapabilityEnabled('geolocation'),
    notifications: useCapabilityEnabled('notifications'),
    motion: useCapabilityEnabled('motion'),
  };
  const setCapabilityEnabled = useSettingsStore((store) => store.setCapabilityEnabled);

  return (
    <div className="fwm-settingsv1-card">
      <div className="fwm-settingsv1-card-head">
        <h2 className="fwm-settingsv1-card-title">{PERMISSIONS_HEADING}</h2>
      </div>
      <p className="fwm-settingsv1-note fwm-data">{PERMISSIONS_CAPTION}</p>

      <ul className="fwm-settingsv1-perms">
        {ROWS.map((row) => {
          const word = statusWordFor(row.role, state[row.name].permission, state[row.name].capability);
          const askable = isRequestable(word);
          const granted = word === 'GRANTED';
          // ON is the OS grant AND our own use of it. Same rule as onboarding.
          const on = granted && enabled[row.name];
          const pressable = askable || granted;
          return (
            <li key={row.name}>
              <button
                type="button"
                className="fwm-settingsv1-perm"
                data-testid={`settingsv1-permission-${row.name}`}
                data-fwm-state={word}
                /* Identical semantics to the onboarding rows, deliberately:
                   these are the same three permissions and a driver who
                   learned the control on the first screen must not meet a
                   different one here. See `OnboardingViewV1` for why a granted
                   row is `aria-disabled` and not `disabled`. */
                role="switch"
                aria-checked={on}
                disabled={word === 'UNAVAILABLE'}
                aria-disabled={!pressable}
                onClick={() => {
                  if (!pressable) return;
                  if (granted) {
                    setCapabilityEnabled(row.name, !enabled[row.name]);
                    return;
                  }
                  setCapabilityEnabled(row.name, true);
                  request(row.name);
                }}
              >
                <span className="fwm-settingsv1-perm-rule" aria-hidden="true" />
                <span className="fwm-settingsv1-switch-where">
                  <span className="fwm-settingsv1-switch-label">{row.label}</span>
                  <span className="fwm-settingsv1-switch-sub fwm-data">
                    {granted
                      ? enabled[row.name]
                        ? GRANTED_SUB
                        : OFF_SUB
                      : word === 'DENIED'
                        ? DENIED_SUB
                        : word === 'UNAVAILABLE'
                          ? UNAVAILABLE_SUB
                          : row.sub}
                  </span>
                </span>
                <span className="fwm-settingsv1-perm-track" aria-hidden="true">
                  <span className="fwm-settingsv1-perm-knob" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
