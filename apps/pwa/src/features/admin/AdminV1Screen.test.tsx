/**
 * THE TESTER MANAGER HAS TO BE REACHABLE FROM THE SCREEN THE APP ROUTES TO.
 *
 * v0's ADMIN is a working client over `/api/admin/testers`. v1 replaced the
 * whole screen with a list of four moderation tools that have no backend, so
 * the redesign traded a feature that worked for four rows of em dashes - and
 * nothing failed, because `registry.v1.tsx` points at `AdminV1Screen` and
 * nothing rendered v1's admin screen and looked for the allowlist.
 *
 * It surfaced as "I used to be able to manage it from the app but now that's
 * gone too", which is the same shape as the CONFIRM deadlock: a control that
 * exists in the tree, is tested in the view the build does not ship, and is
 * unreachable in the one it does.
 *
 * These render the ROUTED component and look for the field a moderator types
 * an address into.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminV1Screen } from './AdminV1Screen.tsx';
import { loadAdminIdentity, resetAdminIdentity } from './useAdmin.ts';

/** The Access assertion the shell would have fetched, as the endpoint returns it. */
function identity(body: { email: string | null; admin: boolean }): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/admin/testers')) {
      return new Response(JSON.stringify({ testers: ['someone@example.com'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetAdminIdentity();
});

afterEach(() => {
  resetAdminIdentity();
  vi.restoreAllMocks();
});

describe('AdminV1Screen', () => {
  it('gives a moderator the tester field, on the screen the app actually routes to', async () => {
    const doFetch = identity({ email: 'cory@darkcode.ai', admin: true });
    vi.stubGlobal('fetch', doFetch);
    await act(async () => {
      await loadAdminIdentity(doFetch);
    });

    render(<AdminV1Screen />);

    // The whole point of the screen for the person using it.
    await waitFor(() => {
      expect(screen.getByLabelText(/add a tester/i)).toBeInTheDocument();
    });
  });

  it('does not show it to somebody who is not a moderator', async () => {
    // The endpoint refuses them anyway - it re-derives identity from the Access
    // assertion and never trusts the client. This is about not putting an
    // "ADD A TESTER" field in front of somebody whose every press would 403.
    const doFetch = identity({ email: 'someone@example.com', admin: false });
    vi.stubGlobal('fetch', doFetch);
    await act(async () => {
      await loadAdminIdentity(doFetch);
    });

    render(<AdminV1Screen />);

    expect(screen.queryByLabelText(/add a tester/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not on the moderator list/i)).toBeInTheDocument();
  });

  it('keeps the tool list, whose counts are still honestly unknown', async () => {
    const doFetch = identity({ email: 'cory@darkcode.ai', admin: true });
    vi.stubGlobal('fetch', doFetch);
    await act(async () => {
      await loadAdminIdentity(doFetch);
    });

    render(<AdminV1Screen />);

    expect(screen.getByText('Report queue')).toBeInTheDocument();
  });
});
