/**
 * DOES EVERY URL THIS PROJECT HANDS A STRANGER ACTUALLY RESOLVE?
 *
 * =============================================================================
 * THE DEFECT THIS EXISTS FOR
 * =============================================================================
 * `DATA-PROVENANCE.md` claimed ODbL 4.6 was discharged because "the whole
 * archive is committed to the public repository", and `TAXONOMY.md` handed the
 * reader the command to go get it:
 *
 *     git clone https://github.com/darkcodelabs/darkroute.git
 *
 * That returns 404. The repository is private until release, which is a
 * deliberate decision - but six documents were written in the present tense for
 * the world after release and shipped in the world before it. One of the six
 * was the licence-compliance claim, which is the one that has to be true.
 *
 * Nothing in the build could notice, because a URL in prose is just prose.
 *
 * =============================================================================
 * WHY A 200 IS NOT AN ANSWER
 * =============================================================================
 * Found while writing this: `darkroute.ai/cameras/index.json` returns **200**.
 * So does `darkroute.ai/this-path-does-not-exist-xyzzy`. Both are the same
 * Squarespace "Coming Soon" page, served with `content-type: text/html` for
 * every path on the host.
 *
 * A status-code check would have reported that route green and gone on to
 * certify a licence obligation against a parking page. So every probe here is
 * paired with a NONSENSE PATH on the same origin, and a URL is only reachable
 * if it is distinguishable from a path that cannot exist.
 *
 * =============================================================================
 * WHY IT FAILS WHEN AN ALLOWANCE STARTS WORKING
 * =============================================================================
 * `PRE_RELEASE` lists what is knowingly dark and why. The obvious rule is
 * "allowed to 404". The rule here is stricter, and it is the entire anti-rot
 * mechanism:
 *
 *   an allowance whose URL has become REACHABLE is a FAILURE.
 *
 * The day the repository goes public, this gate breaks. Breaking is the point.
 * It is the only forcing function that makes somebody revisit the six documents
 * hedged around it and put them back into the present tense. A gate that
 * quietly starts passing teaches nobody anything.
 *
 * =============================================================================
 * WHY IT IS NOT IN `pnpm lint`
 * =============================================================================
 * It needs the network, and a lint that fails on a train is a lint people learn
 * to skip. It runs from `pnpm check:links`, and from the release checklist,
 * where the network is a fair assumption.
 *
 * It also refuses to pass when it could not run. If the control probe fails the
 * exit code is 2, not 0 - "I did not check" and "I checked and it was fine" are
 * different answers, and a green tick for the first is how a safety net becomes
 * a comment about a safety net.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// What counts as ours
// ---------------------------------------------------------------------------

/**
 * Hosts whose 404 is THIS project's defect.
 *
 * Deliberately not "every URL in the docs". The documents cite OpenStreetMap,
 * news reports and other projects by design, and those hosts rate-limit, block
 * unknown user agents, and go down for reasons nobody here can fix. A gate that
 * fails on somebody else's outage gets disabled, and then it protects nothing.
 */
export const OWNED_HOSTS = ['github.com/darkcodelabs/', 'darkroute.ai', 'darkroute.ai'];

/** Canonical repository probe. This must outlive the pre-release allowance. */
export const PUBLIC_REPO_URL = 'https://github.com/darkcodelabs/darkroute';

/** URLs that must be genuinely public after the production DNS cutover. */
export const PUBLIC_LIVE_URLS = ['https://darkroute.ai/.well-known/security.txt'];

/** Where a reader could pick a URL up. `dist` is a build output, not a source. */
const SCAN_ROOTS = ['docs/public', 'apps/pwa/src', 'README.md', 'CITATION.cff'];

const SCAN_EXTENSIONS = new Set(['.md', '.ts', '.tsx', '.cff', '.css']);

/**
 * Test files are excluded, and it is not laziness.
 *
 * `manifest.test.ts` asserts against `tiles.darkroute.ai/a.pmtiles`,
 * `/GONE.pmtiles`, `/oops` and a deliberate `tiles.darkroute.ai.evil.example`
 * used to prove the host check rejects a lookalike. Those are fixtures. They
 * are SUPPOSED not to exist, and the first version of this gate reported all
 * seven as broken promises to a reader - which would have taught everybody to
 * ignore its output within a week.
 *
 * The rule this encodes: the gate checks what is offered, not what is asserted.
 */
const IS_TEST = /\.test\.[cm]?[jt]sx?$/;

/**
 * Knowingly unreachable, with the reason and the release that ends it.
 *
 * Read the header before adding one: an entry here is a promise that somebody
 * will be forced back to the documents when it starts working.
 */
/*
 * EMPTY, AND THAT IS THE FINISHED STATE.
 *
 * It held one entry - the repository, "private until release" - from the day
 * this gate was written until 2026-09-03, when the repository went public and
 * the gate broke exactly as designed. The entry is removed rather than
 * reworded: an allowance whose URL has become reachable is a failure, and the
 * point of the failure is to make somebody put the six documents hedged around
 * it back into the present tense. That has now been done.
 *
 * Add an entry only for something knowingly dark, with the reason written out.
 * Anything left here after it starts resolving fails this gate.
 */
export const PRE_RELEASE = [];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function walk(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  if (stat.isFile()) {
    return SCAN_EXTENSIONS.has(extname(path)) && !IS_TEST.test(path) ? [path] : [];
  }
  return readdirSync(path).flatMap((entry) =>
    entry === 'node_modules' || entry === 'dist' ? [] : walk(join(path, entry)),
  );
}

/**
 * Not a promise to a reader, and probing it produces noise.
 *
 * TEMPLATES. The docs write `basemap-us-<date>.pmtiles` and
 * `tiles.darkroute.ai/…`. The regex stops at `<`, so the first arrives here as
 * `basemap-us-` - a URL-shaped fragment of a sentence. Nobody was ever meant to
 * open it.
 *
 * BARE ORIGINS. `https://tiles.darkroute.ai` with no path is a host being
 * NAMED, not a page being offered. Its root legitimately 404s: it is an object
 * store with no index, which is correct and not a defect.
 */
function isProbeable(url) {
  if (/[…{}<>*]|\s/.test(url)) return false;
  let pathname;
  try {
    ({ pathname } = new URL(url));
  } catch {
    return false;
  }
  if (pathname === '' || pathname === '/') return false;
  // A trailing separator means the sentence continued where the URL stopped.
  return !/[-_/]$/.test(pathname);
}

/**
 * Every owned URL in a body of text, with the trailing punctuation of prose
 * stripped.
 *
 * A markdown sentence ends `...darkroute.git`, `...darkroute).` and
 * `...darkroute`, and probing the version with the full stop attached produces
 * a 404 that is the regex's fault rather than the project's.
 */
export function ownedUrls(text) {
  const out = new Set();
  for (const match of text.matchAll(/https:\/\/[^\s"'`)\]<>]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, '');
    if (!OWNED_HOSTS.some((host) => url.includes(host))) continue;
    if (!isProbeable(url)) continue;
    out.add(url);
  }
  return [...out];
}

export function collect(roots = SCAN_ROOTS) {
  /** @type {Map<string, string[]>} */
  const sites = new Map();
  for (const file of roots.flatMap((root) => walk(root))) {
    for (const url of ownedUrls(readFileSync(file, 'utf8'))) {
      sites.set(url, [...(sites.get(url) ?? []), file]);
    }
  }
  return sites;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * What a probe pair means.
 *
 * `real` is the URL as published. `control` is a path on the same origin that
 * cannot exist. If the two are indistinguishable the host answers everything,
 * so the real URL proves nothing - that is `soft-404`, and it is treated
 * exactly as harshly as a hard 404 because it misleads more.
 */
export function classify(real, control) {
  if (real.error !== undefined) return { state: 'error', detail: real.error };
  if (real.status === 401 || real.status === 403) {
    return { state: 'gated', detail: `HTTP ${String(real.status)}` };
  }
  if (
    real.redirect !== null &&
    real.redirect !== undefined &&
    /cloudflareaccess\.com/.test(real.redirect)
  ) {
    return { state: 'gated', detail: 'Cloudflare Access' };
  }
  if (real.status === 404) return { state: 'missing', detail: 'HTTP 404' };
  if (real.status >= 400) return { state: 'missing', detail: `HTTP ${String(real.status)}` };
  if (control.status === real.status && control.bytes === real.bytes) {
    return {
      state: 'soft-404',
      detail: `host answers ${String(real.status)} with the same ${String(real.bytes)} bytes for a path that cannot exist`,
    };
  }
  return { state: 'reachable', detail: `HTTP ${String(real.status)}` };
}

export function allowanceFor(url, allowances = PRE_RELEASE) {
  return allowances.find((entry) => url.startsWith(entry.prefix)) ?? null;
}

/**
 * The verdict for one URL, given its classification and the allowance list.
 *
 * The asymmetry is deliberate and is the whole design: an allowed URL that is
 * DOWN passes, and an allowed URL that is UP fails.
 */
export function verdict(url, state, allowances = PRE_RELEASE, requiredPublicUrls = []) {
  if (requiredPublicUrls.includes(url) && state !== 'reachable') {
    return {
      ok: false,
      note: `public launch URL must be reachable without authentication; got ${state}`,
    };
  }
  const allowance = allowanceFor(url, allowances);
  const down = state === 'missing' || state === 'soft-404';
  if (allowance === null) {
    if (down || state === 'error') {
      return { ok: false, note: 'handed to a reader, does not resolve' };
    }
    return { ok: true, note: state };
  }
  if (down) return { ok: true, note: `pre-release: ${allowance.reason}` };
  return {
    ok: false,
    note: 'STALE ALLOWANCE - this resolves now. Remove it from PRE_RELEASE and put every document that hedges around it back into the present tense.',
  };
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

const CONTROL_PATH = '/darkroute-gate-control-path-that-cannot-exist';

async function fetchOnce(url) {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'darkroute-link-gate' },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
    return {
      status: res.status,
      redirect: res.headers.get('location'),
      bytes: body.byteLength,
    };
  } catch (error) {
    return { status: 0, redirect: null, bytes: 0, error: String(error) };
  }
}

/** A nonsense sibling on the same origin, to expose a catch-all host. */
function controlUrl(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${CONTROL_PATH}`;
}

/**
 * Follow a redirect before believing it, because GitHub 301s a private repo.
 *
 * `github.com/darkcodelabs/darkroute.git` answers **301** while the repository
 * is private - the canonicalisation happens before the visibility check. Taken
 * at face value that is a 3xx, which is not an error, which the first version
 * of this gate scored as `reachable`. It then declared the pre-release
 * allowance stale and demanded the docs be un-hedged, on the strength of a repo
 * that is still 404.
 *
 * A redirect is a pointer. What matters is what it points AT.
 */
async function follow(url, hops = 3) {
  let current = url;
  for (let i = 0; i <= hops; i += 1) {
    const res = await fetchOnce(current);
    const location = res.redirect;
    if (res.status < 300 || res.status >= 400 || location === null) return res;
    // Access is the destination that matters; do not chase it to a login form.
    if (/cloudflareaccess\.com/.test(location)) return res;
    current = new URL(location, current).href;
  }
  return { status: 508, redirect: null, bytes: 0 };
}

async function probe(url) {
  const [real, control] = await Promise.all([follow(url), fetchOnce(controlUrl(url))]);
  return classify(real, control);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * The app's own belief about whether the repository is public.
 *
 * `DocsScreen` renders a caution when this is false, because otherwise every
 * row on that screen opens a GitHub 404 with no explanation. The constant and
 * the world can disagree in both directions, and both are shipping defects:
 * `true` while the repo is private hides the warning from people who need it,
 * `false` after it opens nags people about a problem that is fixed.
 */
const DOCS_TS = 'apps/pwa/src/features/docs/docs.ts';

export function declaredRepoPublic(source) {
  const match = /export const REPO_PUBLIC\s*=\s*(true|false)/.exec(source);
  return match === null ? null : match[1] === 'true';
}

/** Does the app's claim match what the repository actually does? */
export function repoFlagVerdict(declared, state) {
  if (declared === null) {
    return { ok: false, note: `could not read REPO_PUBLIC from ${DOCS_TS}` };
  }
  const live = state === 'reachable';
  if (declared === live) return { ok: true, note: `REPO_PUBLIC=${String(declared)} matches` };
  return {
    ok: false,
    note: declared
      ? `REPO_PUBLIC is true but the repository is ${state}. The app is telling users the documents are public when they 404.`
      : `REPO_PUBLIC is false but the repository is reachable. Set it true in ${DOCS_TS} and delete the pre-release paragraphs in AUDITING.md, CONTRIBUTING.md, TAXONOMY.md 4.0 and DATA-PROVENANCE.md 7.1.`,
  };
}

/** Capture the canonical repo probe independently of any temporary allowance. */
export function repoStateFromProbe(url, state) {
  return url === PUBLIC_REPO_URL ? state : null;
}

export function parseArgs(argv) {
  let requirePublicLive = false;
  for (const arg of argv) {
    if (arg === '--require-public-live' && !requirePublicLive) {
      requirePublicLive = true;
      continue;
    }
    throw new Error(`unknown or duplicate argument: ${arg}`);
  }
  return { requirePublicLive };
}

export function missingRequiredPublicUrls(probedUrls, requiredPublicUrls) {
  const probed = new Set(probedUrls);
  return requiredPublicUrls.filter((url) => !probed.has(url));
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`check-public-links: ${String(error)}`);
    process.exit(2);
  }

  // Exit 2, not 1, and never 0: "could not check" is its own answer.
  const control = await fetchOnce('https://github.com/');
  if (control.error !== undefined || control.status === 0) {
    console.error('check-public-links: NOT RUN - no network (control probe to github.com failed).');
    console.error('  This gate needs the network. It is not reporting a pass.');
    process.exit(2);
  }

  const sites = collect();
  if (sites.size === 0) {
    console.error(
      'check-public-links: found no owned URLs at all, which means the scan is broken.',
    );
    process.exit(2);
  }

  const failures = [];
  const lines = [];
  const requiredPublicUrls = options.requirePublicLive ? PUBLIC_LIVE_URLS : [];
  const probedUrls = new Set();
  /** @type {string | null} */
  let repoState = null;

  for (const [url, files] of [...sites].sort()) {
    const { state, detail } = await probe(url);
    probedUrls.add(url);
    repoState = repoStateFromProbe(url, state) ?? repoState;
    const { ok, note } = verdict(url, state, PRE_RELEASE, requiredPublicUrls);
    lines.push(`  ${ok ? 'ok  ' : 'FAIL'}  ${state.padEnd(9)} ${url}`);
    lines.push(`          ${detail} - ${note}`);
    if (!ok) failures.push({ url, state, detail, note, files });
  }

  for (const url of missingRequiredPublicUrls(probedUrls, requiredPublicUrls)) {
    const note = 'required public launch URL was not found in the publishable source scan';
    lines.push(`  FAIL  ${'not-found'.padEnd(9)} ${url}`);
    lines.push(`          ${note}`);
    failures.push({ url, state: 'not-found', detail: '', note, files: [] });
  }

  // The app's claim about the repository, checked against the repository.
  if (repoState !== null) {
    const declared = declaredRepoPublic(readFileSync(DOCS_TS, 'utf8'));
    const flag = repoFlagVerdict(declared, repoState);
    lines.push(`  ${flag.ok ? 'ok  ' : 'FAIL'}  ${'app-flag'.padEnd(9)} ${DOCS_TS}`);
    lines.push(`          ${flag.note}`);
    if (!flag.ok) {
      failures.push({
        url: DOCS_TS,
        state: 'app-flag',
        detail: '',
        note: flag.note,
        files: [DOCS_TS],
      });
    }
  }

  console.log(`check-public-links: ${String(sites.size)} URL(s) on owned hosts\n`);
  console.log(lines.join('\n'));

  if (failures.length === 0) {
    console.log(
      '\nEvery URL this project hands a reader resolves, or is a declared pre-release gap.',
    );
    return;
  }

  console.error(`\n${String(failures.length)} URL(s) failed:\n`);
  for (const failure of failures) {
    console.error(`  ${failure.url}`);
    console.error(`    ${failure.note}`);
    for (const file of failure.files) console.error(`    cited by ${file}`);
  }
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
