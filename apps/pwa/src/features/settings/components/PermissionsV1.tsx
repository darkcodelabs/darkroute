/**
 * PERMISSIONS - v1's group.
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
 *
 * =============================================================================
 * BRIEF 4: THE STRIPE IS GONE AND THE STATE IS SPELLED OUT
 * =============================================================================
 * This was a card with a heading, a paragraph of caption, and three rows each
 * carrying a coloured LEFT-BORDER STRIPE keyed off `data-fwm-state`. The brief
 * deletes the stripe by name -- nothing else in the app has one, and the row
 * hairline plus a hue on the group header already says the same thing twice
 * over. `<span className="fwm-settingsv1-perm-rule">` and its five CSS blocks
 * are deleted rather than restyled.
 *
 * What the card becomes is the row/group language the LAYERS and ABUSE menus
 * already ship: a tracked-caps header over a stack of 44px rows, each row
 * LABEL, then ITS CURRENT STATE IN WORDS, then the 40x23 switch. The spec's own
 * three lines are `on - used while the map is open`, `on - alerts and turns`
 * and `off - fills in camera facing`, which is `<state> - <what it is for>`;
 * {@link ROWS} carries the second half and {@link stateLine} composes the pair.
 *
 * `data-fwm-state`, `role="switch"`, `aria-checked`, `aria-disabled` and the
 * `data-testid` are all unchanged. `PermissionsV1.test.tsx` and
 * `permissionParity.test.tsx` assert on every one of them, and the parity test
 * is the reason: a driver who learned this control during onboarding must not
 * meet a different one here.
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
import type {
  PermissionRole,
  PermissionStatusWord,
} from '../../onboarding/components/PermissionCard.tsx';

export const PERMISSIONS_HEADING = 'Permissions';

/**
 * The sub-line under the group header. The spec's own, shortened from the
 * paragraph this card used to carry: the two sentences about switching one off
 * and about clearing the permission itself now live on the ROWS, which is where
 * a reader is when they need them.
 */
export const PERMISSIONS_CAPTION = 'what the app may read, and whether it is using it';

/**
 * THE TWO STATES THE SPEC HAS NO STRING FOR.
 *
 * `on - <use>` and `off - <use>` cover a permission the OS has granted. They
 * cannot express DENIED - where the browser's own site settings are the only
 * way back - or UNAVAILABLE, where there is nothing to grant. Both of those
 * carry an instruction, and an instruction does not fit the `<state> - <use>`
 * shape, so these two sentences are kept verbatim from the version this screen
 * replaces rather than being squeezed into it.
 */
const DENIED_STATE = 'refused - your browser’s site settings are the only way back';
const UNAVAILABLE_STATE = 'this phone or browser does not offer it';

/** The three the product actually asks for. Not every `AdapterName`. */
type PermissionName = 'geolocation' | 'notifications' | 'motion';

interface RowState {
  readonly permission: ReturnType<typeof usePermission>;
  readonly capability: ReturnType<typeof useCapabilityStatus>;
}

const ROWS: readonly {
  readonly name: PermissionName;
  readonly label: string;
  /**
   * WHAT IT IS USED FOR, as a fragment rather than a sentence.
   *
   * These are the spec's own three, word for word, and they are fragments on
   * purpose: they are the tail of `on - used while the map is open`, so they
   * have to read after a state word and never on their own. The longer
   * sentences this file used to carry -- "required. distance is computed here
   * and never leaves the phone." -- said the same thing and could not fit in a
   * right-aligned 13px slot on a 390px phone.
   */
  readonly use: string;
  readonly role: PermissionRole;
}[] = [
  {
    name: 'geolocation',
    label: 'Location',
    use: 'used while the map is open',
    role: 'required',
  },
  {
    name: 'notifications',
    label: 'Notifications',
    use: 'alerts and turns',
    role: 'recommended',
  },
  {
    name: 'motion',
    label: 'Motion sensors',
    use: 'fills in camera facing',
    role: 'optional',
  },
];

/**
 * THE STATE, IN WORDS. The whole reason this row type exists rather than a
 * switch with a caption.
 *
 * ON is the OS grant AND our own use of it, which is the same rule onboarding
 * runs -- a granted permission the app has been told not to use is OFF, and
 * saying "on" there would be the app claiming a capability it is not exercising.
 *
 * A permission that has never been asked for reads `off`, which is literally
 * true: the app is not using it. The alternative was to print the status word
 * -- `allow`, `optional` -- and those are names for what a PROMPT would offer,
 * not for what is currently happening. The spec supplies no string for this
 * state; `off - <use>` is the one that stays true.
 */
export function stateLine(word: PermissionStatusWord, enabled: boolean, use: string): string {
  if (word === 'UNAVAILABLE') return UNAVAILABLE_STATE;
  if (word === 'DENIED') return DENIED_STATE;
  if (word === 'CHECKING') return `checking · ${use}`;
  return `${word === 'GRANTED' && enabled ? 'on' : 'off'} · ${use}`;
}

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
    <div className="fwm-settingsv1-group" role="group" aria-label={PERMISSIONS_HEADING}>
      <div className="fwm-settingsv1-group-head">
        {/* CYAN, WHICH IS WHAT THE DELETED STRIPE WAS FOR. One hue on the
            header says "this group is about what the app may read"; a hue on
            every row said it three times and then had to encode five states in
            a colour nobody could name. */}
        <h2 className="fwm-settingsv1-group-label" data-fwm-hue="accent">
          {PERMISSIONS_HEADING}
        </h2>
        <p className="fwm-settingsv1-group-note fwm-data">{PERMISSIONS_CAPTION}</p>
      </div>

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
                <span className="fwm-settingsv1-switch-label">{row.label}</span>
                {/* The words and `aria-checked` carry the same fact to the eye
                    and to a screen reader, so the two cannot drift. */}
                <span className="fwm-settingsv1-switch-sub fwm-data">
                  {stateLine(word, enabled[row.name], row.use)}
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
