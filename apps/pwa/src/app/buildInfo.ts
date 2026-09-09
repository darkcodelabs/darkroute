/**
 * WHICH BUILD IS THIS.
 *
 * =============================================================================
 * WHY IT EXISTS
 * =============================================================================
 * Asked for so a bug can be tracked to the version that produced it. Without
 * it a report is "it did the thing again" and the only way to place it in time
 * is to guess from the date, which fails exactly when it matters -- two
 * deploys in one afternoon, or a device sitting on a service worker that is
 * three builds behind and looks current.
 *
 * That last case is the real reason this is worth shipping. The worker takes
 * over by itself now (`vite.config.ts`), but a page already loaded keeps the
 * bundle it started with until it next navigates, so "I reloaded" and "I am
 * running the newest code" are different statements. This prints what is
 * ACTUALLY EXECUTING, which is the only version a report should ever name.
 *
 * =============================================================================
 * THE COMMIT IS THE PART THAT IDENTIFIES A BUILD
 * =============================================================================
 * The semver has been 0.1.0 for the entire life of this repo and would answer
 * "which build" with the same string for every deploy. A short sha answers it
 * exactly. `--dirty` is on deliberately: a build made from a working tree with
 * uncommitted changes is not the commit it claims to be, and a report naming a
 * clean sha for a dirty build sends whoever reads it to the wrong code.
 *
 * =============================================================================
 * NOTHING HERE IS ABOUT THE DEVICE
 * =============================================================================
 * Four build-time constants and no runtime lookup: no user agent, no screen
 * size, no locale, no identifier. This string is a property of the BUILD, and
 * it is identical on every phone running it -- which is what makes it safe to
 * read out loud, paste into a message, or print on a screen somebody is going
 * to photograph.
 */

/* Injected by `define` in vite.config.ts. Declared rather than imported: they
   are literals substituted into the bundle, so there is no module to import
   and no chance of the value drifting from the artefact it describes. */
declare const __FWM_VERSION__: string;
declare const __FWM_COMMIT__: string;
declare const __FWM_COMMIT_SHA__: string;
declare const __FWM_BUILT__: string;

export interface BuildInfo {
  /** Semver from `apps/pwa/package.json`, at build time. */
  readonly version: string;
  /** `git describe --always --dirty --abbrev=8`, or `nogit`. FOR READING. */
  readonly commit: string;
  /**
   * The full 40-character sha, or `nogit`. FOR LINKING.
   *
   * Separate from `commit` because a describe string is not a commit ref:
   * `v0-design-83-g<short-sha>` reads well and resolves nowhere. See the note on
   * `readCommitSha` in `vite.config.ts` for the link this was breaking.
   */
  readonly commitSha: string;
  /** UTC date the bundle was built, `YYYY-MM-DD`. */
  readonly built: string;
}

/**
 * A `define` that did not run leaves the identifier undefined rather than
 * throwing at import, so every field falls back instead of taking the app down
 * over a label. `typeof` is the only safe test for an undeclared binding.
 */
function stamped(value: unknown): string {
  return typeof value === 'string' && value !== '' ? value : 'dev';
}

export const BUILD: BuildInfo = {
  version: stamped(typeof __FWM_VERSION__ === 'undefined' ? undefined : __FWM_VERSION__),
  commit: stamped(typeof __FWM_COMMIT__ === 'undefined' ? undefined : __FWM_COMMIT__),
  commitSha: stamped(typeof __FWM_COMMIT_SHA__ === 'undefined' ? undefined : __FWM_COMMIT_SHA__),
  built: stamped(typeof __FWM_BUILT__ === 'undefined' ? undefined : __FWM_BUILT__),
};

/**
 * One line, in the order somebody would read it aloud.
 *
 * `v0.1.0 · <short-sha> · 2026-08-26`
 */
export function buildLabel(info: BuildInfo = BUILD): string {
  return `v${info.version} · ${info.commit} · ${info.built}`;
}
