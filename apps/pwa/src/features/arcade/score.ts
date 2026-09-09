/**
 * THE SESSION'S BEST, AND NOTHING ELSE.
 *
 * One number, at module scope, the way `PixelSweep.tsx` holds `ambientLeft`
 * and `Toast.tsx` describes the haKCer tap counter: a property of the SESSION,
 * so a remount of the overlay does not reset it and an unmount does not lose
 * it, and gone the moment the tab is.
 *
 * IT IS NOT PERSISTED. Not through `stores/persist.ts`, whose header lists the
 * two slices that may survive a reload and this is not one of them; not
 * through `localStorage`, which the repo bans; not to the network, which the
 * game never touches. A score that wrote itself down would be a record of when
 * the phone was parked next to which reader, and this file holds no camera id
 * precisely so that conversation never has to happen. The end card says "best
 * this session" because that is the whole of what it is.
 */

let sessionBest = 0;

/** Record a finished round. Returns the session's best afterwards. */
export function noteRound(hits: number): number {
  const safe = Number.isFinite(hits) && hits > 0 ? Math.floor(hits) : 0;
  if (safe > sessionBest) sessionBest = safe;
  return sessionBest;
}

/** The best round this session, or 0. */
export function sessionBestHits(): number {
  return sessionBest;
}
