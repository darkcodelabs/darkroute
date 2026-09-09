/**
 * THE WAY IN TO ADMIN - a row in SETTINGS, for the people who have one.
 *
 * =============================================================================
 * WHY IT IS CONDITIONAL AND WHY THAT IS NOT THE SECURITY
 * =============================================================================
 * The row renders only when `/api/admin/me` says the signed-in Access identity
 * is an administrator. That is a COURTESY, not a control: everybody else who
 * reaches this app is a tester, and a row they can see but not use invites an
 * attempt whose only lesson is the refusal.
 *
 * The control is elsewhere and cannot be reached from here. The ADMIN screen
 * re-asks the server, and every endpoint that changes who may open the app
 * re-derives the caller from the Access assertion and refuses on its own terms.
 * Deleting this file would hide the door; it would not unlock anything.
 */

import type { ReactElement } from 'react';

import { openScreen } from '../../../app/screenState.ts';
import { useAdmin } from '../../admin/useAdmin.ts';

export const ADMIN_SECTION = 'ACCESS';
export const ADMIN_CAPTION =
  'who else can open this app. everyone on the list signs in with a one-time code.';

export function AdminLink(): ReactElement | null {
  const identity = useAdmin();
  if (!identity.admin) return null;

  return (
    <section className="fwm-settings-section" aria-label={ADMIN_SECTION}>
      <h2 className="fwm-settings-eyebrow fwm-data">{ADMIN_SECTION}</h2>
      <p className="fwm-settings-caption fwm-data">{ADMIN_CAPTION}</p>
      <button
        type="button"
        className="fwm-settings-link"
        onClick={() => {
          openScreen('admin');
        }}
      >
        <span className="fwm-settings-link-label fwm-data">MANAGE TESTERS</span>
        <span className="fwm-settings-link-note fwm-data">{identity.email}</span>
      </button>
    </section>
  );
}
