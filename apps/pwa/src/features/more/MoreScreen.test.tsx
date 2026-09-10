/**
 * THE ADMIN ROW IS THE ONLY THING ON THIS SCREEN THAT IS NOT FOR EVERYONE.
 *
 * `MoreScreen` had no test at all, which is how it shipped an Admin row that
 * rendered for every visitor with the sub text "needs an access identity". That
 * is a reasonable developer affordance and the wrong thing to publish: it tells
 * a stranger a moderator surface exists and invites them to go and rattle it.
 * `AdminLink.tsx:29` already had the right rule and this list did not.
 *
 * It matters more now than it did. `dev.darkroute.ai` stays behind Cloudflare
 * Access as the admin host and `darkroute.ai` is public with no Access at all,
 * so on production no request carries a `Cf-Access-Jwt-Assertion` header,
 * `verifyAccess` returns null, and nobody is an administrator. The row's
 * absence there is produced by the SAME fail-closed auth that protects the
 * endpoint, rather than by a hostname check that could drift when a domain
 * changes - so these two tests are what stand between that and a regression.
 *
 * =============================================================================
 * WHAT BRIEF 4 CHANGED HERE, AND WHY THESE CASES MOVED WITH IT
 * =============================================================================
 * The screen was five tiles plus three cards; it is seven rows in four groups.
 * Two of the cases below asserted about copy that the refactor deletes rather
 * than restyles, and they are REWRITTEN rather than dropped, because what each
 * was actually protecting still needs protecting:
 *
 *   'Settings and themes' / 'Offline readiness' were the labels a case used to
 *   prove the unprivileged rows survive an admin check that returns false. The
 *   labels are the spec's now - `Settings`, and `Offline readiness` is gone
 *   entirely - but the property is unchanged, so the case names the spec's own
 *   seven instead. It also now asserts the COUNT, which the old one could not:
 *   a screen that renders every row twice would have passed it.
 *
 *   The INSTALL_SUB case pinned two strings against a promise the install card
 *   must never make - that installing turns on background alerts. The card is
 *   deleted, so the strings are gone and the promise cannot be made from here.
 *   What replaces it is the assertion that the card is really gone, in the two
 *   places it could come back: the offer and the "already installed" state.
 */

import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GROUP_ABOUT,
  GROUP_ACCOUNTABILITY,
  GROUP_ALERTS,
  GROUP_THIS_PHONE,
  MORE_NOTE,
  MoreScreen,
} from './MoreScreen.tsx';
import { loadAdminIdentity, resetAdminIdentity } from '../admin/useAdmin.ts';

/** The Access assertion the shell would have fetched, as the endpoint returns it. */
function identity(body: { email: string | null; admin: boolean }): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

async function mountAs(body: { email: string | null; admin: boolean }): Promise<void> {
  const doFetch = identity(body);
  vi.stubGlobal('fetch', doFetch);
  await act(async () => {
    await loadAdminIdentity(doFetch);
  });
  await act(async () => {
    render(<MoreScreen />);
  });
}

/** Every row on the screen, in the order it was drawn. */
function rowTitles(): readonly string[] {
  return [...document.querySelectorAll('.fwm-screen-row-title')].map(
    (node) => node.textContent ?? '',
  );
}

beforeEach(() => {
  resetAdminIdentity();
});

afterEach(() => {
  resetAdminIdentity();
  vi.restoreAllMocks();
});

describe('the Admin row', () => {
  it('is not there for somebody who is not a moderator', async () => {
    await mountAs({ email: 'someone@example.com', admin: false });

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    // And not as a teaser either. The old copy named the mechanism.
    expect(screen.queryByText(/access identity/i)).not.toBeInTheDocument();
  });

  it('is not there on a host with no Access at all', async () => {
    // Production: no Cf-Access-Jwt-Assertion header, so the endpoint reports
    // no identity. This is the state every visitor to the public domain is in.
    await mountAs({ email: null, admin: false });

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('is there for a moderator, on the Access-gated host', async () => {
    await mountAs({ email: 'cory@darkcode.ai', admin: true });

    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('moderator tools')).toBeInTheDocument();
  });

  it('lands under ABOUT rather than opening a fifth group', async () => {
    // The spec draws four groups and a moderator does not get a fifth. If this
    // ever fails, a privileged row has grown its own header - which is the
    // advertisement the whole file exists to prevent, in a louder form.
    await mountAs({ email: 'cory@darkcode.ai', admin: true });

    const about = screen.getByRole('region', { name: GROUP_ABOUT });

    expect(within(about).getByText('Admin')).toBeInTheDocument();
    expect(document.querySelectorAll('.fwm-screen-group-label')).toHaveLength(4);
  });
});

describe('what everybody gets', () => {
  it('draws the public destinations including automatic News', async () => {
    await mountAs({ email: null, admin: false });

    expect(rowTitles()).toEqual([
      'Reports',
      'Report abuse',
      'News',
      'Alert diet',
      'Hands free',
      'What it knows',
      'Settings',
      'How this works',
    ]);
  });

  it('files each row under the header the brief assigns it', async () => {
    await mountAs({ email: null, admin: false });

    const under = (label: string): readonly string[] =>
      [...screen.getByRole('region', { name: label }).querySelectorAll('.fwm-screen-row-title')].map(
        (node) => node.textContent ?? '',
      );

    expect(under(GROUP_ACCOUNTABILITY)).toEqual(['Reports', 'Report abuse', 'News']);
    expect(under(GROUP_ALERTS)).toEqual(['Alert diet', 'Hands free']);
    expect(under(GROUP_THIS_PHONE)).toEqual(['What it knows', 'Settings']);
    expect(under(GROUP_ABOUT)).toEqual(['How this works']);
  });

  it('has no theme card, no install prompt and no Find a camera', async () => {
    /*
     * The three deletions, pinned as deletions. Each is a thing that already
     * has a home somewhere else, and each would be easy to reintroduce by
     * somebody who reads this hub as "the index of everything".
     */
    await mountAs({ email: null, admin: false });

    // Theme: the map rail and Settings. Not a third place.
    expect(screen.queryByText(/light and dark/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    // Install: Settings. Both the offer and the already-installed state.
    expect(screen.queryByText(/install on this phone/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/home.screen/i)).not.toBeInTheDocument();
    // Search: the Lookup dock key.
    expect(screen.queryByText('Find a camera')).not.toBeInTheDocument();
  });

  it('says where theme and search went, because a hub that loses a door is broken', async () => {
    await mountAs({ email: null, admin: false });

    expect(screen.getByText(MORE_NOTE)).toBeInTheDocument();
  });

  it('stays silent about the misuse count rather than printing a zero', async () => {
    /*
     * `countyRecords` is empty in a mount - the record index is a file the app
     * loads at runtime. "0 documented cases" would be this app making a claim
     * about American policing that it has not earned, so the meta is empty and
     * the row still says `Reports`.
     */
    await mountAs({ email: null, admin: false });

    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.queryByText(/documented cases/)).not.toBeInTheDocument();
  });
});
