/**
 * ADMIN - who else may open this app.
 *
 * =============================================================================
 * WHAT THIS SCREEN IS AND IS NOT
 * =============================================================================
 * It is a thin client over `/api/admin/testers`. Every decision that matters --
 * whether the caller may see this list, add to it, or remove from it -- is made
 * server-side from the Cloudflare Access assertion, and this file cannot
 * influence any of it. What it does is DRAW.
 *
 * That separation is deliberate and it is why the screen can afford to be
 * simple. If somebody forces `admin: true` in the browser they get this list
 * shape with nothing in it and three buttons that return 403.
 *
 * =============================================================================
 * WHY IT IS NOT IN THE DOCK
 * =============================================================================
 * Everybody else who reaches this app is a tester. A key they can see and
 * cannot turn is worse than no key: it invites an attempt, and the refusal is
 * the only thing it teaches. It lives at `?screen=admin` and is rendered only
 * when the server says so.
 *
 * =============================================================================
 * WHAT IT REFUSES TO DO
 * =============================================================================
 * Administrators are not editable here -- they come from an environment
 * variable the app cannot reach. Otherwise the first person granted access
 * could grant themselves the power to grant access, and "let a friend try the
 * app" and "hand over the keys" become the same button. The API enforces this;
 * the UI simply does not offer it.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { useAdmin } from './useAdmin.ts';
import './admin.css';

interface State {
  readonly testers: readonly string[];
  readonly loading: boolean;
  /** What went wrong, in words a person can act on. */
  readonly error: string | null;
  /** The address currently being written, so its row can say so. */
  readonly busy: string | null;
}

const EMPTY: State = { testers: [], loading: true, error: null, busy: null };

/**
 * The body, or an error that says what actually came back.
 *
 * This returned `{}` when the response was not JSON, and every caller then
 * fell back to the bare word "refused". That word cost an investigation: the
 * real cause was a missing deployment secret, the server never said
 * "refused" at all, and the screen reported a permissions problem to somebody
 * whose permissions were fine.
 *
 * A response that is not JSON is a fact worth reporting -- it means the
 * request never reached the Function, or the Function died before it could
 * answer -- so the status goes in the message rather than being swallowed.
 */
async function readBody(res: Response): Promise<{ testers?: string[]; error?: string }> {
  try {
    return (await res.json()) as { testers?: string[]; error?: string };
  } catch {
    return {
      error: res.ok
        ? 'the server answered with something that was not JSON'
        : `the server answered ${String(res.status)} with no explanation`,
    };
  }
}

export function AdminScreen(): ReactElement {
  const identity = useAdmin();
  const [state, setState] = useState<State>(EMPTY);
  const [draft, setDraft] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch('/api/admin/testers', { headers: { Accept: 'application/json' } });
      const body = await readBody(res);
      if (!res.ok) {
        setState({ testers: [], loading: false, error: body.error ?? 'the server refused and gave no reason', busy: null });
        return;
      }
      setState({ testers: body.testers ?? [], loading: false, error: null, busy: null });
    } catch {
      setState({ testers: [], loading: false, error: 'could not reach the server', busy: null });
    }
  }, []);

  useEffect(() => {
    if (identity.admin) void load();
  }, [identity.admin, load]);

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const email = draft.trim().toLowerCase();
    if (email === '') return;
    setState((s) => ({ ...s, busy: email, error: null }));
    const res = await fetch('/api/admin/testers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await readBody(res);
    if (!res.ok) {
      setState((s) => ({ ...s, busy: null, error: body.error ?? 'could not add that' }));
      return;
    }
    setDraft('');
    setState({ testers: body.testers ?? [], loading: false, error: null, busy: null });
  };

  const remove = async (email: string): Promise<void> => {
    setState((s) => ({ ...s, busy: email, error: null }));
    const res = await fetch(`/api/admin/testers?email=${encodeURIComponent(email)}`, {
      method: 'DELETE',
    });
    const body = await readBody(res);
    if (!res.ok) {
      setState((s) => ({ ...s, busy: null, error: body.error ?? 'could not remove that' }));
      return;
    }
    setState({ testers: body.testers ?? [], loading: false, error: null, busy: null });
  };

  // Nothing at all until the server has answered. A screen that renders as
  // "denied" and then flips to the real thing teaches people to ignore the
  // denial, and one that renders the list before it is entitled to is worse.
  if (!identity.known) {
    return <main className="fwm-admin" data-fwm-admin="waiting" aria-busy="true" />;
  }

  if (!identity.admin) {
    return (
      <main className="fwm-admin" data-fwm-admin="denied">
        <h1 className="fwm-admin-title fwm-data">ADMIN</h1>
        <p className="fwm-admin-note fwm-data">
          {identity.email === null
            ? 'no signed-in identity. this screen needs cloudflare access in front of the app.'
            : `${identity.email} is not an administrator.`}
        </p>
      </main>
    );
  }

  return (
    <main className="fwm-admin" data-fwm-admin="ready">
      <h1 className="fwm-admin-title fwm-data">ADMIN</h1>
      <p className="fwm-admin-note fwm-data">
        signed in as {identity.email}. these addresses can open the app. everyone here gets a
        one-time code by email - no shared password to leak.
      </p>

      <form className="fwm-admin-add" onSubmit={(event) => void add(event)}>
        <label className="fwm-admin-label fwm-data" htmlFor="fwm-admin-email">
          ADD A TESTER
        </label>
        <div className="fwm-admin-row">
          <input
            id="fwm-admin-email"
            className="fwm-admin-input"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="them@example.com"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <button className="fwm-admin-key" type="submit" disabled={state.busy !== null}>
            ADD
          </button>
        </div>
      </form>

      {state.error === null ? null : (
        <p className="fwm-admin-error fwm-data" role="alert">
          {state.error}
        </p>
      )}

      <ul className="fwm-admin-list" aria-label="people who can open the app">
        {state.loading ? (
          <li className="fwm-admin-note fwm-data">reading the policy…</li>
        ) : (
          state.testers.map((email) => (
            <li className="fwm-admin-item" key={email}>
              <span className="fwm-admin-email fwm-data">{email}</span>
              <button
                className="fwm-admin-remove fwm-data"
                type="button"
                disabled={state.busy !== null}
                onClick={() => void remove(email)}
                aria-label={`remove ${email}`}
              >
                {state.busy === email ? '…' : 'REMOVE'}
              </button>
            </li>
          ))
        )}
      </ul>

      <p className="fwm-admin-note fwm-data">
        administrators are set outside the app and cannot be removed here - that would lock you out
        of the screen you are standing on.
      </p>
    </main>
  );
}
