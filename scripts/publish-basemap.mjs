/**
 * PUBLISH A BASEMAP ARCHIVE - immutably, and point the manifest at it.
 *
 * =============================================================================
 * THE RULE THIS SCRIPT ENFORCES: NEVER OVERWRITE AN ARCHIVE
 * =============================================================================
 * A PMTiles archive is read by HTTP range request, so a client caches BYTE
 * OFFSETS INTO A SPECIFIC FILE. Replace the file at that URL and every cached
 * offset now points at unrelated bytes. The map does not error; it draws
 * garbage until the cache is cleared.
 *
 * PMTiles' client tries to catch this via the ETag, and its own docs say it
 * "does not send conditional request headers If-Match because of CORS. Instead,
 * it detects ETag mismatches via the response ETag or the 416 response code."
 * That detection only works if the bucket sends
 * `Access-Control-Expose-Headers: etag`. A silent corruption guarded by a CORS
 * header somebody has to remember is not a guard, so:
 *
 *   - every upload is a NEW date-stamped key, and this script REFUSES to
 *     overwrite one that already exists
 *   - `basemap.json` is the only mutable object, and it is tiny
 *   - the CORS check runs anyway, because the ETag path is still the second
 *     line of defence
 *
 * =============================================================================
 * WHY THE AWS SDK
 * =============================================================================
 * R2 speaks the S3 API. Signing requests by hand means implementing SigV4,
 * which is exactly the class of thing this project has been burned by writing
 * itself. `@aws-sdk/client-s3` also brings multipart upload, which a
 * multi-gigabyte archive requires and which is not a thing to hand-roll either.
 *
 * =============================================================================
 * USAGE
 * =============================================================================
 *   node scripts/publish-basemap.mjs <archive.pmtiles> [--dry-run]
 *   node scripts/publish-basemap.mjs --verify-live
 *
 * The archive must have the adjacent deterministic receipt emitted by
 * `build-basemap.mjs`. The publisher hashes the complete archive again and
 * refuses a missing, stale, incomplete, or foreign receipt before it opens an
 * R2 client.
 *
 * Credentials, from the environment (never committed, never logged). Either:
 *
 *   R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET
 *
 * or, more likely on this machine, a plain Cloudflare API token:
 *
 *   CLOUDFLARE_API_TOKEN  CLOUDFLARE_ACCOUNT_ID  R2_BUCKET
 *
 * R2's S3 endpoint accepts a Cloudflare API token directly, with the token's
 * ID as the access key and the SHA-256 of the token's VALUE as the secret. That
 * is worth doing rather than minting a separate R2 key pair: one credential to
 * rotate, and it is the one already on this host.
 *
 * Optional:
 *   R2_PUBLIC_BASE   default https://tiles.darkroute.ai
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import { verifiedReceiptForPublish } from './build-basemap.mjs';

const MANIFEST_KEY = 'basemap.json';
const DEFAULT_PUBLIC_BASE = 'https://tiles.darkroute.ai';
export const BASEMAP_BUCKET = 'flockys-tiles';
const CORS_PROBE_RANGE = 'bytes=0-15';
const CORS_PROBE_BYTES = 16;
const REQUIRED_EXPOSED_HEADERS = ['etag', 'content-range', 'accept-ranges', 'content-length'];

/**
 * Every browser origin allowed to read the public tile bucket, READ FROM THE
 * ONE FILE THAT DEFINES THEM.
 *
 * This was a second, hand-maintained copy of the list in
 * `scripts/basemap-r2-cors.json`, and the two drifted exactly as two copies
 * do. A rebrand sweep rewrote the retired origins in place here, which
 * DUPLICATED two of them and silently dropped the `*.pages.dev` origin the
 * Pages project actually serves - and because this script is what WRITES the
 * policy to the bucket, running it would have restored the broken list over a
 * corrected one.
 *
 * The JSON file is the source. It is also what a human edits and what is
 * applied by hand, so deriving from it means there is no second place to
 * forget.
 */
export const BROWSER_ORIGINS = JSON.parse(
  readFileSync(new URL('./basemap-r2-cors.json', import.meta.url), 'utf8'),
).rules[0].allowed.origins;

/**
 * S3 credentials, derived from a Cloudflare API token when they are not set
 * directly.
 *
 * The token ID comes from `/user/tokens/verify`, which is also a live check
 * that the token still works -- better than discovering it mid-upload of a
 * multi-gigabyte archive.
 */
async function s3Credentials() {
  const direct = process.env['R2_ACCESS_KEY_ID'];
  if (typeof direct === 'string' && direct.trim() !== '') {
    return { accessKeyId: direct.trim(), secretAccessKey: required('R2_SECRET_ACCESS_KEY') };
  }

  const token = process.env['CLOUDFLARE_API_TOKEN'];
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error(
      'No R2 credentials. Set either R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY,\n' +
        'or CLOUDFLARE_API_TOKEN (the S3 keys are derived from it).',
    );
  }

  const response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${token.trim()}` },
  });
  const body = await response.json();
  const id = body?.result?.id;
  if (body?.success !== true || typeof id !== 'string') {
    throw new Error('CLOUDFLARE_API_TOKEN did not verify; cannot derive S3 credentials.');
  }

  const { createHash } = await import('node:crypto');
  return {
    accessKeyId: id,
    secretAccessKey: createHash('sha256').update(token.trim()).digest('hex'),
  };
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${name} is not set.\n` +
        'Publishing needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and\n' +
        'R2_BUCKET in the environment. They are credentials: put them in a\n' +
        'gitignored env file, never in the repo and never on a command line.',
    );
  }
  return value.trim();
}

async function main() {
  const [, , archivePath, ...rest] = process.argv;

  if (archivePath === '--verify-live') {
    if (rest.length > 0) throw new Error('--verify-live does not accept other arguments');
    await verifyLive(process.env['R2_PUBLIC_BASE'] ?? DEFAULT_PUBLIC_BASE);
    return;
  }

  if (archivePath === undefined || !existsSync(archivePath)) {
    throw new Error(
      'usage: node scripts/publish-basemap.mjs <archive.pmtiles> [--dry-run]\n' +
        '   or: node scripts/publish-basemap.mjs --verify-live',
    );
  }
  if (!archivePath.endsWith('.pmtiles')) {
    throw new Error('that is not a .pmtiles archive');
  }

  const resolvedArchive = resolve(archivePath);
  const size = statSync(resolvedArchive).size;
  const receipt = await verifiedReceiptForPublish(resolvedArchive);
  const identity = resolvePublishIdentity(receipt, rest);
  const { dryRun, objectKey, osm } = identity;
  const publicBase = (process.env['R2_PUBLIC_BASE'] ?? DEFAULT_PUBLIC_BASE).replace(/\/$/, '');
  const publicUrl = `${publicBase}/${objectKey}`;

  process.stdout.write(
    `archive : ${basename(archivePath)} (${(size / 1e9).toFixed(2)} GB)\n` +
      `osm     : ${osm ?? 'unknown'}\n` +
      `key     : ${objectKey}\n` +
      `url     : ${publicUrl}\n\n`,
  );

  if (dryRun) {
    process.stdout.write('--dry-run: nothing uploaded\n');
    return;
  }

  const accountId = process.env['R2_ACCOUNT_ID']?.trim() || required('CLOUDFLARE_ACCOUNT_ID');
  const bucket = assertBasemapBucket(required('R2_BUCKET'));
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: await s3Credentials(),
  });

  // IMMUTABILITY, ENFORCED. Not a convention -- a refusal. See the header.
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    throw new Error(
      `${objectKey} already exists and archives are never overwritten.\n` +
        'Clients cache byte offsets into a specific file; replacing it corrupts\n' +
        'them silently. If this build genuinely differs, republish it with\n' +
        '--suffix <name> to give it a distinct, immutable key.',
    );
  } catch (cause) {
    const status = cause?.$metadata?.httpStatusCode;
    if (status !== 404 && status !== 412) throw cause;
  }

  /**
   * CHECK THE BUCKET BEFORE MOVING THE POINTER, NOT AFTER.
   *
   * This ran at the very end, after the manifest was already published, and
   * only ever printed a warning -- so a publish onto a bucket with no
   * `Accept-Ranges` and no exposed ETag exited 0, looked successful, and had
   * already pointed every client at it. Both misconfigurations are invisible at
   * runtime: without ranges a phone downloads whole multi-gigabyte archives,
   * and without the exposed ETag PMTiles cannot detect an archive changing
   * underneath a cached client.
   *
   * Probed against whatever is already in the bucket, so it costs nothing and
   * tells us about the bucket rather than about this upload.
   */
  const posture = await checkBucketPosture(publicBase, client, bucket);
  if (posture !== null) {
    process.stderr.write(`\n${posture}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('uploading (multipart)...\n');
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: objectKey,
      Body: createReadStream(resolvedArchive),
      ContentType: 'application/octet-stream',
      // A year, immutable. The whole point of the versioned key is that this is
      // safe -- the bytes behind it will never change.
      CacheControl: 'public, max-age=31536000, immutable',
    },
    queueSize: 4,
    partSize: 64 * 1024 * 1024,
  });
  let lastPct = -1;
  upload.on('httpUploadProgress', (p) => {
    const pct = Math.floor(((p.loaded ?? 0) / size) * 100);
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      process.stdout.write(`  ${String(pct)}%\n`);
    }
  });
  await upload.done();

  /*
   * Prove the new object through the public hostname before moving the
   * manifest. A failed check leaves one harmless, unreferenced immutable
   * object; moving the pointer first would leave every browser with a broken
   * map until somebody repaired CORS.
   */
  await verifyCors(publicBase, objectKey);

  // The pointer goes LAST. Until it moves, every client keeps reading the
  // previous archive -- which is complete and consistent, just a day older.
  const manifest = {
    url: publicUrl,
    built: new Date().toISOString(),
    ...(osm === null ? {} : { osm }),
  };
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: MANIFEST_KEY,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
      // Short. This is the one object whose job is to change.
      CacheControl: 'public, max-age=60',
    }),
  );

  process.stdout.write(`\npublished ${objectKey}\nmanifest -> ${publicUrl}\n\n`);
}

/**
 * The verified receipt, not mtime or an operator-supplied date, names the
 * immutable object. Legacy --osm/--suffix flags are accepted only when they
 * repeat the receipt exactly, so an old runbook cannot silently mislabel it.
 */
export function resolvePublishIdentity(receipt, args) {
  let dryRun = false;
  let osmFlag = null;
  let suffixFlag = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      if (dryRun) throw new Error('--dry-run was repeated');
      dryRun = true;
    } else if (argument === '--osm' || argument === '--suffix') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`);
      }
      if (argument === '--osm') {
        if (osmFlag !== null) throw new Error('--osm was repeated');
        osmFlag = value;
      } else {
        if (suffixFlag !== null) throw new Error('--suffix was repeated');
        suffixFlag = value;
      }
      index += 1;
    } else {
      throw new Error(`unknown publish argument ${JSON.stringify(argument)}`);
    }
  }

  const expectedOsm = receipt?.publish?.osm;
  const expectedSuffix = receipt?.publish?.suffix;
  const objectKey = receipt?.publish?.objectKey;
  if (osmFlag !== null && osmFlag !== expectedOsm) {
    throw new Error(
      `--osm ${JSON.stringify(osmFlag)} disagrees with verified receipt ${expectedOsm}`,
    );
  }
  if (suffixFlag !== null && suffixFlag !== expectedSuffix) {
    throw new Error(
      `--suffix ${JSON.stringify(suffixFlag)} disagrees with verified receipt ${expectedSuffix}`,
    );
  }
  const version = expectedOsm.slice(0, 10).replaceAll('-', '');
  if (objectKey !== `basemap-us-${version}-${expectedSuffix}.pmtiles`) {
    throw new Error(
      'verified receipt object key is inconsistent with its OSM timestamp and suffix',
    );
  }
  return { dryRun, objectKey, osm: expectedOsm };
}

export function assertBasemapBucket(value) {
  if (value !== BASEMAP_BUCKET) {
    throw new Error(
      `R2_BUCKET must be the reviewed basemap bucket ${BASEMAP_BUCKET}; got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Check the two headers the client silently depends on.
 *
 * Both failures are invisible at runtime: without `Accept-Ranges` the client
 * downloads whole archives, and without the exposed ETag it cannot detect the
 * archive changing underneath it. Neither throws; both just make the map wrong
 * in ways nobody attributes to a bucket setting.
 */
/**
 * Is this bucket fit to serve a PMTiles archive at all?
 *
 * Returns null when it is, or a message explaining what is wrong. Probes an
 * object that already exists; if the bucket is empty there is nothing to probe
 * and the check passes rather than blocking a first publish.
 */
export async function checkBucketPosture(publicBase, client, bucket, fetchImpl = fetch) {
  let probeKey = null;
  try {
    const listing = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'basemap-us-', MaxKeys: 1 }),
    );
    probeKey = (listing.Contents ?? []).find((o) => o.Key?.endsWith('.pmtiles'))?.Key ?? null;
  } catch (cause) {
    return (
      `BUCKET POSTURE UNKNOWN: could not list an existing basemap (${shortError(cause)}).\n` +
      'Refusing to publish because the cross-origin range contract was not proved.'
    );
  }
  if (probeKey === null) return null;

  const url = `${publicBase}/${probeKey}`;
  const failures = await probeAllOrigins(url, fetchImpl);
  return failures.length === 0 ? null : corsFailureMessage('BUCKET NOT FIT TO SERVE', failures);
}

export async function verifyLive(publicBase, fetchImpl = fetch) {
  const base = parsePublicBase(publicBase);
  const manifestUrl = new URL(MANIFEST_KEY, base).href;
  const response = await fetchImpl(manifestUrl, {
    cache: 'no-store',
    redirect: 'error',
  });
  if (response.status !== 200) {
    await response.body?.cancel?.();
    throw new Error(`LIVE BASEMAP MANIFEST: HTTP ${String(response.status)}, expected 200`);
  }
  if (response.redirected === true || response.url !== manifestUrl) {
    await response.body?.cancel?.();
    throw new Error(
      `LIVE BASEMAP MANIFEST: final URL ${JSON.stringify(response.url)}, expected ${JSON.stringify(manifestUrl)}`,
    );
  }
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    await response.body?.cancel?.();
    throw new Error(
      `LIVE BASEMAP MANIFEST: content-type ${JSON.stringify(contentType)}, expected application/json`,
    );
  }
  const declaredLengthHeader = response.headers.get('content-length');
  const declaredLength = declaredLengthHeader === null ? null : Number(declaredLengthHeader);
  if (
    declaredLength !== null &&
    (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 65_536)
  ) {
    await response.body?.cancel?.();
    throw new Error('LIVE BASEMAP MANIFEST: unsafe content-length');
  }

  const bytes = await boundedBodyBytes(response, 65_536);
  if (bytes.byteLength < 2) {
    throw new Error('LIVE BASEMAP MANIFEST: body is empty');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('LIVE BASEMAP MANIFEST: body is not UTF-8');
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('LIVE BASEMAP MANIFEST: body is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || typeof body.url !== 'string') {
    throw new Error('LIVE BASEMAP MANIFEST: body has no string url');
  }

  let archive;
  try {
    archive = new URL(body.url);
  } catch {
    throw new Error('LIVE BASEMAP MANIFEST: url is not absolute');
  }
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (
    archive.origin !== base.origin ||
    !archive.pathname.startsWith(basePath) ||
    archive.pathname === basePath ||
    !archive.pathname.endsWith('.pmtiles') ||
    archive.search !== '' ||
    archive.hash !== '' ||
    archive.username !== '' ||
    archive.password !== ''
  ) {
    throw new Error(
      `LIVE BASEMAP MANIFEST: archive ${JSON.stringify(archive.href)} is not under ${base.href}`,
    );
  }

  await verifyArchiveUrl(archive.href, fetchImpl);
  process.stdout.write(`manifest: ${manifestUrl}\narchive : ${archive.href}\n`);
}

export async function verifyCors(publicBase, objectKey, fetchImpl = fetch) {
  const base = publicBase.replace(/\/$/, '');
  await verifyArchiveUrl(`${base}/${objectKey}`, fetchImpl);
}

async function verifyArchiveUrl(url, fetchImpl) {
  const failures = await probeAllOrigins(url, fetchImpl);
  if (failures.length > 0) {
    throw new Error(corsFailureMessage('PUBLISHED OBJECT FAILED CORS VERIFICATION', failures));
  }
  process.stdout.write(
    `verify  : ${String(BROWSER_ORIGINS.length)} origins x ${String(CORS_PROBE_BYTES)} exact bytes, CORS/range/ETag contract passed\n`,
  );
}

function parsePublicBase(value) {
  let base;
  try {
    base = new URL(value.endsWith('/') ? value : `${value}/`);
  } catch {
    throw new Error(`R2_PUBLIC_BASE is not an absolute URL: ${JSON.stringify(value)}`);
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username !== '' ||
    base.password !== '' ||
    base.search !== '' ||
    base.hash !== ''
  ) {
    throw new Error(`R2_PUBLIC_BASE is not a clean HTTP(S) base: ${JSON.stringify(value)}`);
  }
  return base;
}

async function probeAllOrigins(url, fetchImpl) {
  const results = await Promise.all(
    BROWSER_ORIGINS.map(async (origin) => {
      try {
        return { origin, problems: await probeOrigin(url, origin, fetchImpl) };
      } catch (cause) {
        return { origin, problems: [`request failed (${shortError(cause)})`] };
      }
    }),
  );
  return results.filter(({ problems }) => problems.length > 0);
}

async function probeOrigin(url, origin, fetchImpl) {
  const response = await fetchImpl(url, {
    redirect: 'error',
    headers: { Range: CORS_PROBE_RANGE, Origin: origin },
  });
  const problems = [];
  const contentRange = response.headers.get('content-range') ?? '';
  const contentLength = response.headers.get('content-length') ?? '';
  const ranges = (response.headers.get('accept-ranges') ?? '').toLowerCase();
  const allowOrigin = response.headers.get('access-control-allow-origin') ?? '';
  const exposed = headerTokens(response.headers.get('access-control-expose-headers'));
  const vary = headerTokens(response.headers.get('vary'));
  const etag = response.headers.get('etag') ?? '';
  const rangeMatch = /^bytes 0-15\/([1-9][0-9]*)$/.exec(contentRange);

  if (response.status !== 206) problems.push(`HTTP ${String(response.status)}, expected 206`);
  if (response.redirected === true) problems.push('response followed a redirect');
  if (response.url !== url) {
    problems.push(`final URL ${JSON.stringify(response.url)}, expected ${JSON.stringify(url)}`);
  }
  if (allowOrigin !== origin) {
    problems.push(`access-control-allow-origin ${JSON.stringify(allowOrigin)}, expected ${origin}`);
  }
  if (!vary.has('origin')) problems.push('vary does not include Origin');
  if (ranges !== 'bytes')
    problems.push(`accept-ranges ${JSON.stringify(ranges)}, expected "bytes"`);
  if (rangeMatch === null || Number(rangeMatch[1]) < CORS_PROBE_BYTES) {
    problems.push(
      `content-range ${JSON.stringify(contentRange)}, expected "bytes 0-15/<archive-size>"`,
    );
  }
  if (contentLength !== String(CORS_PROBE_BYTES)) {
    problems.push(
      `content-length ${JSON.stringify(contentLength)}, expected "${String(CORS_PROBE_BYTES)}"`,
    );
  }
  if (etag.trim() === '') problems.push('etag is missing');
  for (const header of REQUIRED_EXPOSED_HEADERS) {
    if (!exposed.has(header)) problems.push(`${header} is not exposed to browser JavaScript`);
  }

  if (
    response.status === 206 &&
    rangeMatch !== null &&
    Number(rangeMatch[1]) >= CORS_PROBE_BYTES &&
    contentLength === String(CORS_PROBE_BYTES)
  ) {
    const bodyLength = await boundedBodyLength(response, CORS_PROBE_BYTES);
    if (bodyLength !== CORS_PROBE_BYTES) {
      problems.push(
        `body contained ${String(bodyLength)} bytes, expected ${String(CORS_PROBE_BYTES)}`,
      );
    }
  } else {
    await response.body?.cancel?.();
  }

  return problems;
}

async function boundedBodyLength(response, expected) {
  if (typeof response.body?.getReader !== 'function') {
    return (await response.arrayBuffer()).byteLength;
  }
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (total <= expected) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expected) await reader.cancel();
    }
  } finally {
    reader.releaseLock();
  }
  return total;
}

async function boundedBodyBytes(response, maximum) {
  if (typeof response.body?.getReader !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximum) throw new Error('LIVE BASEMAP MANIFEST: body exceeds 64 KiB');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new Error('LIVE BASEMAP MANIFEST: body exceeds 64 KiB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function headerTokens(value) {
  return new Set(
    (value ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function corsFailureMessage(title, failures) {
  const details = failures.flatMap(({ origin, problems }) =>
    problems.map((problem) => `  ${origin}: ${problem}`),
  );
  return (
    `${title}:\n${details.join('\n')}\n` +
    'Refusing to move the manifest. A missing origin or unreadable range/ETag\n' +
    'breaks PMTiles silently in that browser.'
  );
}

function shortError(cause) {
  return String(cause?.message ?? cause)
    .replaceAll(/\s+/g, ' ')
    .slice(0, 160);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${String(error.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
