/**
 * Feature flags.
 *
 * A flag here means "built, kept, and switched off" - not "removed". Nothing
 * gets deleted to turn a feature off, so flipping one back on is a one-line
 * change rather than an archaeology exercise.
 *
 * Flags are compile-time constants, not runtime configuration. A disabled
 * feature should not ship a live code path that a crafted request could reach,
 * and the bundler can drop the dead branch entirely.
 */

export interface FeatureFlags {
  /**
   * The plate lookup - LOOKUP dock screen and the watchlist's plate checks.
   *
   * OFF since 2026-08-20, pending permission.
   *
   * Why: there is no authorized, documented third-party API integration.
   * haveibeenflocked.com answers a related but different question: whether an
   * operator search appears in released audit logs, not whether a camera saw a
   * plate. Its coverage is retrospective and incomplete.
   * That is a genuinely valuable and quite different feature, and it deserves
   * its own screen rather than being quietly substituted behind LOOKUP.
   *
   * What stays intact while this is off: the encrypted plate vault, the blind
   * index, the removal path, the LOOKUP screen state, and the dock key
   * definition. Nothing is deleted. See
   * `docs/public/AGGREGATION-POLICY.md#external-lookup-boundary` and
   * `docs/public/DATA-CONTRACTS.md` §4.7.
   *
   * To turn back on: set this to `true`. Do that after either (a) a documented,
   * authorized integration, or (b) rescoping LOOKUP to local-only matching
   * against the device's own trip log, which needs nobody's permission -
   * "Plate never leaves this device. Matched against your own trip log - no
   * Flock system is queried."
   */
  readonly plateLookup: boolean

  /**
   * Anonymised nearby-user presence (the ghost dots on SWEEP, the MESH feed).
   *
   * Depends on Durable Objects and a deployed API, neither of which exists
   * yet, so it is off until the backend ships. Leaving it on would mean the
   * UI advertises other drivers it cannot actually see.
   */
  readonly presence: boolean

  /**
   * RECORD - documented agency misuse, sourced from public reporting.
   *
   * Off until the aggregation contract lands and every displayed entry can
   * carry its citation. The product rule is that nothing appears without a
   * citable published source, so an empty-but-visible RECORD screen would be
   * worse than no screen.
   */
  readonly record: boolean
}

export const FEATURES: FeatureFlags = {
  plateLookup: false,
  presence: false,
  // ON. The gate on this flag was "off until every displayed entry can carry
  // its citation", and that condition is now met and enforced:
  // `apps/pwa/public/records/counties.json` holds 47 entries across 38
  // counties, every one fetched and read by a fact-check pass before it was
  // written, and `scripts/check-record-citations.mjs` fails the build if any
  // entry loses its source.
  //
  // Six candidate entries were REJECTED by that pass and are worth recording:
  // one was contradicted by its own source (it claimed a guilty plea; the
  // article says the officer pleaded not guilty), one could not be fetched at
  // all, and four were duplicates. That is the failure mode this flag existed
  // to prevent.
  record: true,
}

/** Narrow helper so call sites read as intent rather than as config lookup. */
export function isEnabled(flag: keyof FeatureFlags): boolean {
  return FEATURES[flag]
}
