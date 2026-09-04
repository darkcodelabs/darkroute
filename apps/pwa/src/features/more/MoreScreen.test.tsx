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
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INSTALL_ELSEWHERE_SUB, INSTALL_SUB, MoreScreen } from './MoreScreen.tsx';
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
});

describe('what everybody gets', () => {
  it('keeps the rows that are not privileged', async () => {
    await mountAs({ email: null, admin: false });

    for (const label of ['How this works', 'Settings and themes', 'Offline readiness']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('does not turn installation into a background-alert promise', () => {
    expect(INSTALL_SUB).toBe('a home-screen shortcut and standalone window');
    expect(INSTALL_ELSEWHERE_SUB).toBe('open DarkRoute from your home screen');
    expect(`${INSTALL_SUB} ${INSTALL_ELSEWHERE_SUB}`).not.toMatch(
      /screen off|background|keep firing/i,
    );
  });
});
