/**
 * THE SIGN-IN GUARD - that it tells an expired session from a dead zone.
 *
 * The whole value of this module is that discrimination. Getting it wrong in
 * one direction reproduces the reported bug (an expired session reads as an app
 * with no data); getting it wrong in the other is worse, because it puts a
 * SIGN IN AGAIN banner over a driver's screen every time they lose signal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  guardedFetch,
  isAccessBounce,
  isSignedOut,
  resetAccessSession,
  subscribeToSignedOut,
} from './session.ts';

afterEach(() => {
  resetAccessSession();
});

/** A response of a given `type`, which is otherwise not constructible. */
function responseOfType(type: ResponseType, status = 200): Response {
  return { type, status, ok: status >= 200 && status < 300 } as Response;
}

describe('an Access bounce is recognised', () => {
  it('flags an opaqueredirect, which is what a gated origin returns', () => {
    expect(isSignedOut()).toBe(false);
    expect(isAccessBounce(responseOfType('opaqueredirect', 0))).toBe(true);
    expect(isSignedOut()).toBe(true);
  });

  it('NEVER flags a plain failure -- that is a tunnel, not a logout', async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(guardedFetch('/cameras/index.json', offline as unknown as typeof fetch)).rejects.toThrow();
    // The single most important assertion in this file. A driver on a bad
    // signal must not be told to sign in again.
    expect(isSignedOut()).toBe(false);
  });

  it('does not flag a 404, which is the normal answer for a rural tile', () => {
    expect(isAccessBounce(responseOfType('basic', 404))).toBe(false);
    expect(isSignedOut()).toBe(false);
  });

  it('does not flag a 200', () => {
    expect(isAccessBounce(responseOfType('basic', 200))).toBe(false);
    expect(isSignedOut()).toBe(false);
  });
});

describe('guardedFetch', () => {
  it('asks for redirect: manual, which is the only reason it can tell', async () => {
    const impl = vi.fn().mockResolvedValue(responseOfType('basic', 200));
    await guardedFetch('/cameras/11/1/2.json', impl as unknown as typeof fetch);
    expect(impl).toHaveBeenCalledWith('/cameras/11/1/2.json', { redirect: 'manual' });
  });

  it('returns the response so callers still see a 404 as a 404', async () => {
    const impl = vi.fn().mockResolvedValue(responseOfType('basic', 404));
    const res = await guardedFetch('/cameras/11/1/2.json', impl as unknown as typeof fetch);
    expect(res.status).toBe(404);
  });
});

describe('subscribers', () => {
  it('are told once, not on every bounced request', () => {
    const listener = vi.fn();
    const stop = subscribeToSignedOut(listener);
    isAccessBounce(responseOfType('opaqueredirect', 0));
    isAccessBounce(responseOfType('opaqueredirect', 0));
    isAccessBounce(responseOfType('opaqueredirect', 0));
    // A whole ring of camera tiles bounces at once. Publishing per response
    // would re-render the shell 289 times for one piece of news.
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stop being told after unsubscribing', () => {
    const listener = vi.fn();
    subscribeToSignedOut(listener)();
    isAccessBounce(responseOfType('opaqueredirect', 0));
    expect(listener).not.toHaveBeenCalled();
  });
});
