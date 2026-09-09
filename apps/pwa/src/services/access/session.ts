/**
 * THE SIGN-IN THAT EXPIRED - noticed, instead of rendered as missing data.
 *
 * =============================================================================
 * THE BUG THIS EXISTS FOR
 * =============================================================================
 * A tester opened the app and reported "camera data is not loading", plus the
 * ADMIN row gone from SETTINGS. Nothing had changed in either path -- the last
 * commit to touch the camera fetch was weeks old. What had changed was the
 * clock: Cloudflare Access is in front of this site with a 24-hour session, and
 * theirs had run out.
 *
 * When that happens the edge answers every request with a 302 to
 * `<team>.cloudflareaccess.com`. That is Access working exactly as designed.
 * What was wrong was the app's reading of it:
 *
 *   THE DOCUMENT still loads -- the service worker's document cache has it, and
 *   a navigation gets redirected to the login page only if it actually reaches
 *   the network.
 *   `/cameras/index.json` follows the redirect cross-origin, the response
 *   carries no CORS headers, and `fetch` rejects with a bare TypeError.
 *   `catalogue.ts` catches it and reports `null`, which the header renders as
 *   ` - CAMS`.
 *   Every camera tile fails the same way, so `sync.ts` writes no tile, and the
 *   map draws the honest-looking "no cameras on the map here".
 *   `/api/admin/me` fails the same way, `useAdmin` publishes `admin: false`,
 *   and the ADMIN section correctly hides itself.
 *
 * Three screens each did the right, careful, defensive thing with an answer
 * they could not get -- and between them they produced a confident picture of
 * an app with no data in it. Nobody was going to guess "sign in again" from
 * that, and it will happen again every twenty-four hours.
 *
 * =============================================================================
 * HOW IT IS DETECTED, AND WHY NOT BY CATCHING THE ERROR
 * =============================================================================
 * The TypeError from a blocked cross-origin redirect is indistinguishable from
 * the TypeError of being in a tunnel. Treating every failed fetch as "signed
 * out" would put a sign-in banner over a driver's screen in a dead zone, which
 * is worse than the bug.
 *
 * So the request asks for `redirect: 'manual'` instead. The redirect is then
 * never followed: the browser hands back an `opaqueredirect` response, status
 * 0, and that is unambiguous. A static JSON file on our own origin has no
 * legitimate reason to redirect anywhere, so an opaque redirect means one thing
 * -- something in front of the origin is bouncing us -- while a real network
 * failure still arrives as a rejection and is still treated as offline.
 *
 * =============================================================================
 * WHAT IT DOES NOT DO
 * =============================================================================
 * It does not sign anybody in, and it does not redirect on its own. A page that
 * navigates itself away because a background fetch failed is a page that can
 * throw away a queued report, or interrupt a live alert, at a moment nobody
 * chose. It raises a flag; `SignedOutBanner` offers the door; the driver
 * decides when to walk through it.
 */

let bounced = false;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (bounced === next) return;
  bounced = next;
  for (const listener of listeners) listener();
}

/**
 * Was this response the edge turning us away rather than our own server?
 *
 * Call it on every same-origin GET that matters. Returns true when the caller
 * should stop and treat the answer as absent rather than as empty.
 */
export function isAccessBounce(res: Response): boolean {
  // `opaqueredirect` is the only shape a `redirect: 'manual'` fetch produces
  // for a redirect, and same-origin static data never legitimately redirects.
  const bounce = res.type === 'opaqueredirect';
  if (bounce) publish(true);
  return bounce;
}

/**
 * A same-origin GET that can tell an expired sign-in from a dead zone.
 *
 * `redirect: 'manual'` is the whole point -- see the note above. Everything
 * else about the request is left alone, including credentials, because the
 * Access cookie is what makes the request work in the first place.
 */
export async function guardedFetch(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const res = await fetchImpl(url, { redirect: 'manual' });
  isAccessBounce(res);
  return res;
}

/** True once any guarded request has been bounced to the sign-in page. */
export function isSignedOut(): boolean {
  return bounced;
}

export function subscribeToSignedOut(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Send the driver to the sign-in, by reloading the page they are on.
 *
 * NOT by constructing an Access login URL. The edge already knows where its
 * login lives and already redirects there, complete with the signed callback
 * token that brings the driver back to this exact path; hand-building that URL
 * would be guessing at somebody else's protocol and would rot the day it
 * changed. A navigation is the one request Access answers with the login page,
 * so the correct move is simply to make one.
 *
 * A full navigation, not a background fetch: Access sets its cookie on the way
 * back, and only a document load carries that into the page.
 */
export function goToSignIn(location: Location = globalThis.location): void {
  location.reload();
}

/** For tests: forget that anything was bounced. */
export function resetAccessSession(): void {
  publish(false);
}
