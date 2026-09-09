/**
 * ADMIN - v1.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isAdmin` block.
 *
 * =============================================================================
 * WHAT THIS SCREEN CAN AND CANNOT DO
 * =============================================================================
 * The design draws a moderation console: a report queue at 142, duplicate
 * merges at 23, owner corrections at 8, misuse submissions at 5. None of that
 * exists. There is no moderation backend, no queue, and no endpoint behind any
 * of those numbers.
 *
 * So the tools are LISTED and the counts are not invented. A number here would
 * be the one kind of lie this product cannot tell: a moderator acting on a
 * queue depth that came from a design file would be making decisions about
 * other people's reports based on fiction.
 *
 * What is real is the identity. Access sits in front of the deployment, the
 * app asks it who you are, and that answer decides whether any of this is even
 * offerable. That part is wired and always was.
 */

import type { ReactElement } from 'react';

import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../components/nav';
import { AdminScreen } from './AdminScreen.tsx';
import { useAdmin } from './useAdmin.ts';

import './adminV1.css';

export const NO_VALUE = '—';

export const ADMIN_TITLE = 'Admin';
export const ADMIN_GATE = 'Moderation is gated behind your own identity provider.';

/** Said while Access has not answered yet. Not "signed out", which is a claim. */
export const ADMIN_ASKING = 'asking cloudflare access who you are.';

export const ADMIN_SIGNED_OUT =
  'no access identity in front of this deployment. that is the correct state on a local build ' +
  'and on a preview url; moderation needs the real origin.';

export const ADMIN_NOT_ADMIN =
  'signed in, but this address is not on the moderator list. that list is a deployment setting, ' +
  'not something this screen can change.';

/**
 * The tools, without counts.
 *
 * Each is a real moderation job the product will need. None has a backend, so
 * each says what it would do and reports its queue as unknown rather than as
 * a number somebody might act on.
 */
export const TOOLS = [
  { label: 'Report queue', sub: 'confirm, merge or reject what drivers filed' },
  { label: 'Duplicate merge', sub: 'one pole reported by several drivers' },
  { label: 'Owner corrections', sub: 'reassign a camera to the right agency' },
  { label: 'Misuse submissions', sub: 'sourced cases awaiting review' },
] as const;

export function AdminV1Screen(): ReactElement {
  const identity = useAdmin();

  const state = !identity.known
    ? 'asking'
    : identity.email === null
      ? 'signed-out'
      : identity.admin
        ? 'admin'
        : 'not-admin';

  const note =
    state === 'asking'
      ? ADMIN_ASKING
      : state === 'signed-out'
        ? ADMIN_SIGNED_OUT
        : state === 'not-admin'
          ? ADMIN_NOT_ADMIN
          : null;

  return (
    <section className="fwm-adminv1" aria-label="admin">
      <header className="fwm-adminv1-header">
        {/* ADMIN IS THE ONE SCREEN A NON-MODERATOR CAN LAND ON BY ACCIDENT.
            `?screen=admin` resolves for anybody; the gate below refuses them.
            A refusal with no way off it is the worst version of that - so the
            arrow is outside every branch, drawn whether the identity check
            says yes, no, or is still asking. */}
        <BackKey to="more" label={BACK_TO_MORE} />
        <ReloadTitle title={ADMIN_TITLE} className="fwm-adminv1-title" />
        <span className="fwm-adminv1-state fwm-data" data-fwm-state={state}>
          {state === 'asking'
            ? 'CHECKING'
            : state === 'admin'
              ? 'SIGNED IN'
              : state === 'not-admin'
                ? 'NOT A MODERATOR'
                : 'SIGNED OUT'}
        </span>
      </header>

      <p className="fwm-adminv1-gate fwm-data">{ADMIN_GATE}</p>

      {identity.email === null ? null : (
        <p className="fwm-adminv1-who fwm-data">{identity.email}</p>
      )}

      {note === null ? null : <p className="fwm-adminv1-note fwm-data">{note}</p>}

      {/* THE TESTER MANAGER, WHICH v1 DROPPED ON THE FLOOR.
          =====================================================================
          v0's ADMIN is a working client over `/api/admin/testers` - it lists
          who may open the app, adds an address and removes one. v1 replaced
          the whole screen with the tool list below, and the tool list has no
          backend, so the redesign swapped a feature that worked for four rows
          of em dashes. Reported as "I used to be able to manage it from the
          app but now that's gone too", which is exactly what happened.

          Rendered rather than reimplemented, the same way SETTINGS keeps v0's
          container behind a v1 view and LOOKUP renders v0's whole screen
          inside v1's. There is one client for this endpoint and this is it -
          a second one would be a second place for the allowlist to go wrong.

          It is inside the `admin` branch on purpose: `AdminScreen` does its
          own gating too, but rendering it to a non-moderator would put an
          "ADD A TESTER" field in front of somebody who cannot use it. */}
      {state === 'admin' ? <AdminScreen /> : null}

      <ul className="fwm-adminv1-tools" aria-label="moderation tools">
        {TOOLS.map((tool) => (
          <li className="fwm-adminv1-tool" key={tool.label} data-fwm-enabled={String(state === 'admin')}>
            <span className="fwm-adminv1-tool-where">
              <span className="fwm-adminv1-tool-label">{tool.label}</span>
              <span className="fwm-adminv1-tool-sub fwm-data">{tool.sub}</span>
            </span>
            {/* THE COUNT IS AN EM DASH AND STAYS ONE until a queue exists to
                count. A moderator acting on a number that came from a design
                file would be deciding about other people's reports on fiction. */}
            <span className="fwm-adminv1-tool-count fwm-data">{NO_VALUE}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
