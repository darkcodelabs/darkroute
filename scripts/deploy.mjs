/**
 * BUILD, DEPLOY, AND THEN GO LOOK.
 *
 * THE BUG THIS EXISTS TO PREVENT
 *   For a whole day the app was built, deployed, reported as shipped, and the
 *   URL being looked at kept serving an older bundle. Nothing errored. Every
 *   deploy printed "Deployment complete!" and a pages.dev link, and that link
 *   really did have the new code on it.
 *
 *   The cause: `dev.darkroute.ai` is a CUSTOM DOMAIN on the Pages project, and
 *   a Pages custom domain serves the project's PRODUCTION BRANCH -- here,
 *   `main`. Deploying with `--branch dev` produces a preview deployment at
 *   `dev.flockyswatchingme.pages.dev`. The branch name matching the subdomain
 *   is a coincidence that reads exactly like a connection.
 *
 *   So: deploys to `dev` were real, were live, and were on a URL nobody had
 *   open. The custom domain sat on the last `main` deployment.
 *
 * WHAT THIS DOES ABOUT IT
 *   Two things, and the second is the one that matters.
 *
 *   1. It deploys to {@link PRODUCTION_BRANCH}, which is what the custom
 *      domain actually serves.
 *   2. It then FETCHES THE LIVE URL and compares the bundle filename there
 *      against the one in `dist`. Vite content-hashes the filename, so this is
 *      an exact identity check on shipped bytes, not a liveness ping.
 *
 *   If they differ this exits non-zero and says so. "Deployed" is a claim
 *   about a server, and the only way to hold it is to ask the server.
 *
 * WHY THE CHECK RETRIES
 *   A Pages deployment is live within seconds, but not instantly, and not
 *   simultaneously at every edge. A single immediate fetch would flake. It
 *   polls, with a cache-buster, and only fails after the whole window.
 *
 * CREDENTIALS
 *   `CLOUDFLARE_API_TOKEN` comes from the environment and is never read from,
 *   written to, or logged by this file.
 *
 * USAGE
 *   pnpm ship          # build, deploy, verify
 *   node scripts/deploy.mjs --prebuilt # validate existing dist, deploy, verify
 *   pnpm ship:verify   # verify only, deploy nothing
 *   node scripts/deploy.mjs --preview   # deploy to a preview branch instead
 *
 *   The script is `ship`, not `deploy`, because `pnpm deploy` is pnpm's own
 *   built-in command for a workspace project and shadows anything named that.
 */

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FONT_STACKS,
  FONT_RANGES,
  REQUIRED_SPRITE_IMAGES,
  SPRITE_FLAVORS,
} from './vendor-basemap-assets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'apps/pwa/dist');

/**
 * THE CLOUDFLARE PAGES PROJECT, WHICH IS NOT THE PRODUCT NAME.
 *
 * The rebrand to DarkRoute renamed this to `darkroute` and the deploy failed
 * with `The Pages project "darkroute" does not exist`. It is infrastructure
 * that already exists under its original name, and renaming a Pages project
 * changes its `*.pages.dev` hostname - so it moves on its own schedule,
 * alongside the domain, not with a string swap.
 *
 * Leave this alone until that move actually happens.
 */
/*
 * The Pages project was renamed `flockyswatchingme` -> `darkroute` on
 * 2026-09-03, and a NEW project was created under that name on the same day
 * so the subdomain moved with it: the origin is `darkroute.pages.dev`.
 *
 * This comment previously asserted the opposite - that the subdomain could not
 * follow a rename and was still the old one. That was true of a rename and
 * false after the rebuild, and it was load-bearing: the R2 CORS allowlist kept
 * granting the dead subdomain on the strength of it while the real origin went
 * ungranted, which is a black map on the exact URL `wrangler pages deploy`
 * prints. Corrected here and in `scripts/basemap-r2-cors.json`.
 */
const PROJECT = 'darkroute';
/** What `dev.darkroute.ai` serves. Not a guess -- read from the Pages API. */
const PRODUCTION_BRANCH = 'main';
/** The URL a human actually opens. Verification is against THIS, nothing else. */
const LIVE_URL = 'https://dev.darkroute.ai';

const VERIFY_ATTEMPTS = 10;
const VERIFY_DELAY_MS = 4_000;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
// Cyrillic, CJK and the final MapLibre range. Missing glyph files on Pages are
// answered by index.html, producing the misleading protobuf error
// `Unimplemented type: 4`. Build verification checks all 768; these samples
// prove the deployed/static boundary did not turn them back into HTML.
const GLYPH_PROBE_RANGES = ['1024-1279', '19968-20223', '65280-65535'];

const args = new Set(process.argv.slice(2));
const verifyOnly = args.has('--verify');
const preview = args.has('--preview');
const prebuilt = args.has('--prebuilt');
for (const argument of args) {
  if (!['--verify', '--preview', '--prebuilt'].includes(argument)) {
    process.stderr.write(`\ndeploy failed: unknown argument ${argument}\n`);
    process.exit(1);
  }
}
if (verifyOnly && (preview || prebuilt)) {
  process.stderr.write(
    '\ndeploy failed: --verify cannot be combined with --preview or --prebuilt\n',
  );
  process.exit(1);
}

function say(message) {
  process.stdout.write(`${message}\n`);
}

function die(message) {
  process.stderr.write(`\ndeploy failed: ${message}\n`);
  process.exit(1);
}

function run(command, commandArgs) {
  execFileSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' });
}

/**
 * The content-hashed bundle filename in `dist`, e.g. `index-BlrBoHmX.js`.
 *
 * Read from `index.html` rather than by listing `assets/`, because a stale
 * asset from a previous build can survive in `dist` and listing would find
 * two. The HTML names the one that will actually be loaded.
 */
function builtBundle() {
  let html;
  try {
    html = readFileSync(resolve(DIST, 'index.html'), 'utf8');
  } catch {
    die(`no build at ${DIST} -- run \`pnpm build\` first`);
  }
  const match = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html);
  if (match === null) {
    die('built index.html names no bundle -- the build output is not what this expects');
  }
  return match[1];
}

function filesBelow(root) {
  let rootInfo;
  try {
    rootInfo = lstatSync(root);
  } catch {
    die(`prebuilt directory is missing: ${root}`);
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    die(`prebuilt directory is not a real directory: ${root}`);
  }
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) die(`prebuilt output contains a symlink: ${path}`);
      if (info.isDirectory()) walk(path);
      else if (info.isFile()) files.push(relative(root, path));
      else die(`prebuilt output contains an unsupported entry: ${path}`);
    }
  };
  walk(root);
  return files.sort();
}

/**
 * Re-establish the build-time publication gates without executing package
 * scripts under production credentials. The uncredentialed workflow step has
 * already built this exact tree; this path only reads and compares bytes.
 */
function validatePrebuilt() {
  const publicRoot = resolve(ROOT, 'apps/pwa/public');
  const publicBasemap = join(publicRoot, 'basemap-assets');
  const builtBasemap = join(DIST, 'basemap-assets');
  const distFiles = filesBelow(DIST);
  const sourceFiles = filesBelow(publicBasemap);
  const builtFiles = filesBelow(builtBasemap);
  if (JSON.stringify(sourceFiles) !== JSON.stringify(builtFiles)) {
    die('prebuilt basemap inventory differs from the reviewed public assets');
  }
  for (const file of sourceFiles) {
    if (!readFileSync(join(publicBasemap, file)).equals(readFileSync(join(builtBasemap, file)))) {
      die(`prebuilt basemap bytes differ from the reviewed public asset: ${file}`);
    }
  }
  for (const stack of FONT_STACKS) {
    for (const range of FONT_RANGES) {
      if (readFileSync(join(builtBasemap, 'fonts', stack, `${range}.pbf`)).byteLength === 0) {
        die(`prebuilt basemap has an empty glyph: ${stack}/${range}.pbf`);
      }
    }
  }
  for (const flavor of SPRITE_FLAVORS) {
    for (const density of ['', '@2x']) {
      const index = JSON.parse(
        readFileSync(join(builtBasemap, 'sprites', `${flavor}${density}.json`), 'utf8'),
      );
      for (const image of REQUIRED_SPRITE_IMAGES) {
        if (!Object.hasOwn(index, image)) {
          die(`prebuilt sprite ${flavor}${density} is missing ${image}`);
        }
      }
      if (
        !readFileSync(join(builtBasemap, 'sprites', `${flavor}${density}.png`))
          .subarray(0, PNG_SIGNATURE.length)
          .equals(PNG_SIGNATURE)
      ) {
        die(`prebuilt sprite ${flavor}${density} has no PNG signature`);
      }
    }
  }

  const sourceHeaders = readFileSync(join(publicRoot, '_headers'));
  const builtHeaders = readFileSync(join(DIST, '_headers'));
  if (!sourceHeaders.equals(builtHeaders)) {
    die('prebuilt _headers differs from the reviewed public policy');
  }
  if (!sourceHeaders.toString('utf8').includes('Content-Security-Policy:')) {
    die('prebuilt _headers has no Content-Security-Policy');
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg?.devDependencies?.wrangler ?? '')) {
    die('Wrangler must be pinned to one exact version before deploying a prebuilt tree');
  }
  const bundle = builtBundle();
  const bundlePath = `assets/${bundle}`;
  if (!distFiles.includes(bundlePath) || readFileSync(join(DIST, bundlePath)).byteLength === 0) {
    die(`prebuilt index names a missing or empty bundle: ${bundlePath}`);
  }
  return bundle;
}

/**
 * Whether an asset the page references actually LOADS as that kind of asset.
 *
 * THE HAZARD THIS CATCHES
 *   A Pages deploy does not land atomically at the edge. There is a window
 *   where the new index.html is being served while its content-hashed assets
 *   are not there yet, and Pages answers a missing path with index.html at a
 *   200. So the browser asks for `index-abc123.js`, receives HTML, and refuses
 *   it: "Expected a JavaScript-or-Wasm module script but the server responded
 *   with a MIME type of text/html". The page is blank.
 *
 *   Checking only that the HTML NAMES the right bundle -- which is all this
 *   did at first -- passes cleanly through that entire window. The name was
 *   right. The file was not there.
 */
async function assetLoads(path, expectType, validateBody) {
  const res = await fetch(`${LIVE_URL}/${path}`, {
    headers: { 'cache-control': 'no-cache', ...accessHeaders() },
    redirect: 'follow',
  });
  if (!res.ok) return `${path} -> HTTP ${String(res.status)}`;
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  // The SPA fallback is the failure mode: a 200 carrying index.html.
  if (expectType !== null) {
    const expectedTypes = Array.isArray(expectType) ? expectType : [expectType];
    if (!expectedTypes.some((expected) => type.includes(expected))) {
      return `${path} -> content-type ${type || '(none)'}`;
    }
  }
  if (validateBody !== undefined) {
    const problem = validateBody(Buffer.from(await res.arrayBuffer()));
    if (problem !== null) return `${path} -> ${problem}`;
  }
  return null;
}

function validSpriteIndex(body) {
  try {
    const index = JSON.parse(body.toString('utf8'));
    if (typeof index !== 'object' || index === null) return 'body is not a JSON object';
    const missing = REQUIRED_SPRITE_IMAGES.filter((image) => !Object.hasOwn(index, image));
    return missing.length === 0 ? null : `missing required images ${missing.join(', ')}`;
  } catch {
    return 'body is not JSON (the Pages HTML fallback may have answered)';
  }
}

function validSpritePng(body) {
  return body.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ? null
    : 'body has no PNG signature';
}

function matchesBuiltAsset(path) {
  const expected = readFileSync(resolve(DIST, path));
  return (body) => (body.equals(expected) ? null : 'body differs from the reviewed build asset');
}

/**
 * The Access service-token headers, when there are any.
 *
 * Cloudflare Access now sits in front of the site, which is correct and which
 * BLINDED THIS SCRIPT: an unauthenticated fetch of the document gets the login
 * page, so the verifier read "live page names no bundle" on a deploy that had
 * in fact succeeded. A verifier that cannot tell a good deploy from a bad one
 * is worse than no verifier, because it fails loudly on the wrong thing and
 * teaches you to ignore it.
 *
 * A service token is Access's answer for machines: two headers, no interactive
 * login, and its own policy that can be revoked without touching anybody's
 * access. Set both in `.deploy.env` and the check works again.
 */
function accessHeaders() {
  const id = process.env['CF_ACCESS_SERVICE_CLIENT_ID'];
  const secret = process.env['CF_ACCESS_SERVICE_CLIENT_SECRET'];
  if (id === undefined || secret === undefined) return {};
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
}

/** True when what came back is Access's login rather than our app. */
function isAccessLogin(res, html) {
  const host = (() => {
    try {
      return new URL(res.url).host;
    } catch {
      return '';
    }
  })();
  return host.endsWith('.cloudflareaccess.com') || html.includes('cdn-cgi/access/login');
}

/**
 * A deployment is not verified if its browser boundary quietly disappeared.
 * `_headers` only becomes real after Cloudflare parses it, so checking the
 * source file or build artifact cannot establish this part.
 */
function securityHeaderProblem(res) {
  const csp = res.headers.get('content-security-policy') ?? '';
  const requiredCsp = [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "connect-src 'self' https://tiles.darkroute.ai",
  ];
  const missing = requiredCsp.filter((directive) => !csp.includes(directive));
  if (missing.length > 0) return `security policy missing ${missing.join(', ')}`;
  if (res.headers.get('referrer-policy') !== 'no-referrer') {
    return 'Referrer-Policy is not no-referrer';
  }
  if ((res.headers.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') {
    return 'X-Content-Type-Options is not nosniff';
  }
  if ((res.headers.get('x-frame-options') ?? '').toUpperCase() !== 'DENY') {
    return 'X-Frame-Options is not DENY';
  }
  if ((res.headers.get('permissions-policy') ?? '') === '') {
    return 'Permissions-Policy is missing';
  }
  return null;
}

async function liveBundle() {
  // Cache-buster on the document: Pages sends `must-revalidate` for HTML, but
  // a query string removes any doubt about an intermediary.
  const res = await fetch(`${LIVE_URL}/?deploy-check=${String(Date.now())}`, {
    headers: { 'cache-control': 'no-cache', ...accessHeaders() },
    redirect: 'follow',
  });
  if (!res.ok) return { error: `HTTP ${String(res.status)}` };
  const html = await res.text();

  // NAME THE REAL PROBLEM. Without this the message is "live page names no
  // bundle", which sends you looking at the build for a fault that is in the
  // credentials -- and the deploy itself was fine.
  if (isAccessLogin(res, html)) {
    return {
      error:
        'Cloudflare Access returned its login page, so the app was never read.\n' +
        '    The deploy may well have succeeded -- this check simply cannot see it.\n' +
        '    Set CF_ACCESS_SERVICE_CLIENT_ID and CF_ACCESS_SERVICE_CLIENT_SECRET\n' +
        '    in .deploy.env (Zero Trust -> Access -> Service Auth), and add a\n' +
        '    policy on the app that includes that service token.',
      blind: true,
    };
  }

  const headerProblem = securityHeaderProblem(res);
  if (headerProblem !== null) return { error: headerProblem };

  const match = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html);
  if (match === null) return { error: 'live page names no bundle' };

  // Every asset the document references, fetched. Not just named -- fetched.
  const css = /assets\/(index-[A-Za-z0-9_-]+\.css)/.exec(html);
  const spriteChecks = SPRITE_FLAVORS.flatMap((flavor) =>
    ['', '@2x'].flatMap((density) => [
      assetLoads(`basemap-assets/sprites/${flavor}${density}.json`, 'json', validSpriteIndex),
      assetLoads(`basemap-assets/sprites/${flavor}${density}.png`, 'image/png', validSpritePng),
    ]),
  );
  const glyphChecks = FONT_STACKS.flatMap((stack) =>
    GLYPH_PROBE_RANGES.map((range) => {
      const path = `basemap-assets/fonts/${stack}/${range}.pbf`;
      // Vite and Pages may omit a MIME mapping for .pbf. Exact byte equality
      // is stronger than accepting one guessed type and still rejects the SPA
      // HTML fallback conclusively.
      return assetLoads(path, null, matchesBuiltAsset(path));
    }),
  );
  const problems = (
    await Promise.all([
      assetLoads(`assets/${match[1]}`, 'javascript'),
      css === null ? Promise.resolve(null) : assetLoads(`assets/${css[1]}`, 'css'),
      ...spriteChecks,
      ...glyphChecks,
    ])
  ).filter((p) => p !== null);

  if (problems.length > 0) return { bundle: match[1], error: problems.join('; ') };
  return { bundle: match[1] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function verify(expected) {
  say(`\nverifying ${LIVE_URL} serves ${expected}`);
  let last = '';
  let blindly = false;
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    const { bundle, error, blind } = await liveBundle();
    // Both halves must hold: the right bundle NAMED, and every asset it names
    // actually served as that asset.
    if (bundle === expected && error === undefined) {
      say(`  live: ${bundle}, assets load  (attempt ${String(attempt)})`);
      return true;
    }
    last = error ?? `serving ${String(bundle)}`;
    // Retrying a missing credential nine more times just wastes a minute and
    // buries the one line that says what to do.
    if (blind === true) {
      blindly = true;
      break;
    }
    say(`  not yet: ${last}`);
    if (attempt < VERIFY_ATTEMPTS) await sleep(VERIFY_DELAY_MS);
  }
  // Two different failures, and conflating them misdirects. One is "the deploy
  // did not land where you think"; the other is "this check has no credentials
  // and saw nothing at all". Only the first has anything to do with branches.
  if (blindly) {
    /**
     * ACCESS BLOCKING THE CHECK IS NOT A FAILED DEPLOY.
     *
     * This called die(), so a perfectly successful deploy printed
     * "deploy failed" whenever the site was behind Cloudflare Access -- which
     * is always, because password-protecting it was the point. A check that
     * cries failure on every success is one people learn to ignore, and then it
     * is worse than not existing.
     *
     * It asks the Pages API instead. That needs no new credentials and no
     * widened token scope: the same CLOUDFLARE_API_TOKEN that just performed
     * the deploy can read back what it produced. It cannot prove the CDN is
     * serving the bytes -- only a request through Access could -- so it says
     * exactly that rather than implying more.
     */
    const landed = await confirmViaApi();
    if (landed === true) {
      say(
        `\ncannot read ${LIVE_URL} from here -- Cloudflare Access gates it, which is\n` +
          'what protecting the site means. Confirmed through the Pages API instead:\n' +
          `  the newest ${PRODUCTION_BRANCH} deployment reports success.\n` +
          'NOT verified: that the CDN serves this exact bundle. Only a request\n' +
          'through Access can show that, so open the site and check.',
      );
      return true;
    }
    die(
      `${LIVE_URL} could not be read (${last}), and the Pages API does not show a\n` +
        `  successful ${PRODUCTION_BRANCH} deployment either. This one really did fail.`,
    );
  }
  die(
    `${LIVE_URL} still ${last} after ${String(VERIFY_ATTEMPTS)} checks.\n` +
      `  The custom domain serves the "${PRODUCTION_BRANCH}" branch. If a deploy\n` +
      `  went to another branch it is live on a pages.dev URL nobody is looking at.`,
  );
  return false;
}

/**
 * Did a production deployment land, according to Cloudflare itself?
 *
 * Read-only, using the token the deploy already needs. Returns true, false, or
 * null when the question cannot be asked -- and null is reported as unknown
 * rather than as failure, which is the mistake this whole path exists to undo.
 */
async function confirmViaApi() {
  const token = process.env['CLOUDFLARE_API_TOKEN'];
  const account = process.env['CLOUDFLARE_ACCOUNT_ID'];
  if (token === undefined || account === undefined) return null;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT}/deployments?per_page=5`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.success !== true) return null;
    const newest = (body.result ?? []).find((d) => d.environment === 'production');
    if (newest === undefined) return false;
    return newest?.latest_stage?.name === 'deploy' && newest?.latest_stage?.status === 'success';
  } catch {
    return null;
  }
}

if (verifyOnly) {
  // `verify` prints what it actually established -- which, behind Access, is
  // that the deployment landed and NOT that the CDN serves this bundle. Saying
  // "live bundle matches the local build" here regardless would re-introduce
  // the exact overclaim the blind path was just fixed to avoid, one line later.
  await verify(builtBundle());
  process.exit(0);
}

if (!preview && process.env['CLOUDFLARE_API_TOKEN'] === undefined) {
  die('CLOUDFLARE_API_TOKEN is not set');
}

/**
 * THE CAMERA FUNCTION MUST NOT OUTRUN THE DATA IT READS.
 *
 * This deploy script builds the WORKING TREE, not HEAD. That is deliberate and
 * it is also how the whole camera archive came off the live app: a half-finished
 * generation cutover was sitting uncommitted, `pnpm ship` picked it up, and the
 * Function started resolving every `/cameras/*` read through a
 * `__camera/current.json` pointer that had never been published. The build was
 * green, the deploy reported success, and the map lost its dots.
 *
 * There is no local way to prove an R2 object exists - this token is scoped to
 * Pages - so the gate is an explicit acknowledgement rather than a probe. That
 * is the right shape anyway: publishing the pointer is a deliberate operational
 * step with its own approval, so shipping the reader that depends on it should
 * be a deliberate step too, not a side effect of whatever is in the tree.
 */
const CAMERA_FUNCTION = resolve(ROOT, 'functions/cameras/[[path]].ts');
const POINTER_KEY = '__camera/current.json';
/*
 * THE GUARD NOW ASKS WHETHER THE FUNCTION CAN COPE, not merely whether it
 * mentions the pointer.
 *
 * It was written when the Function read tiles ONLY through the pointer, so
 * naming the pointer really did mean "this build serves 503 until a generation
 * is published". The Function has a flat-root fallback now: an ABSENT pointer
 * reads the flat archive and stamps a generation derived from index.json, while
 * a BROKEN pointer still fails closed. A build with that fallback is safe to
 * ship before any generation exists - which is the entire point of it - so
 * gating it would keep the very fix for the outage it was written to prevent
 * permanently undeployable.
 *
 * The original refusal still stands for a Function that reads the pointer and
 * has no fallback, which is what the sentinel below detects.
 */
const CAMERA_FUNCTION_SOURCE = readFileSync(CAMERA_FUNCTION, 'utf8');
const HAS_FLAT_FALLBACK = CAMERA_FUNCTION_SOURCE.includes('readFlatGeneration');
if (CAMERA_FUNCTION_SOURCE.includes(POINTER_KEY) && !HAS_FLAT_FALLBACK) {
  if (process.env['FWM_CAMERA_GENERATION_PUBLISHED'] !== 'true') {
    die(
      `functions/cameras/[[path]].ts resolves reads through ${POINTER_KEY}, which only\n` +
        '  exists once a camera generation has been published to R2. Deploying it before\n' +
        '  then serves 503 for every camera tile and empties the map.\n\n' +
        '  If the generation IS published, say so explicitly:\n' +
        '    FWM_CAMERA_GENERATION_PUBLISHED=true pnpm ship\n\n' +
        '  If it is not, deploy the flat reader instead - the version that calls\n' +
        '  bucket.get(key) directly - and leave the gated one committed but unshipped.',
    );
  }
  say(`camera generation pointer acknowledged as published (${POINTER_KEY})`);
}
if (HAS_FLAT_FALLBACK) {
  say('camera Function carries the flat-root fallback; safe before a generation exists');
}

let bundle;
if (prebuilt) {
  say('validating the existing prebuilt tree without running package scripts...');
  bundle = validatePrebuilt();
} else {
  say('building...');
  run('pnpm', ['build']);
  bundle = builtBundle();
}
const branch = preview ? 'dev' : PRODUCTION_BRANCH;
say(`\ndeploying ${bundle} to branch "${branch}"...`);
run('pnpm', [
  'exec',
  'wrangler',
  'pages',
  'deploy',
  DIST,
  '--project-name',
  PROJECT,
  '--branch',
  branch,
  '--commit-dirty=true',
]);

if (preview) {
  say(`\npreview deployed. NOTE: ${LIVE_URL} serves "${PRODUCTION_BRANCH}" and is unchanged.`);
  process.exit(0);
}

await verify(bundle);
// NOT claimed unconditionally. Behind Access the check established that the
// deployment landed, not that the CDN serves this bundle, and `verify` has
// already printed exactly which of those it proved. Restating the stronger
// claim here would be the same overclaim, three lines later.
say('');
