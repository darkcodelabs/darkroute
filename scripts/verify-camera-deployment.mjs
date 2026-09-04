#!/usr/bin/env node

/**
 * Prove that the Pages camera route serves the exact pointer generation R2
 * returned after publication.
 *
 * The operator first hydrates the current pointer into a fresh temporary
 * target/state pair. This verifier deep-validates that pair, then performs one
 * cache-busted request to an exact owned origin. A static fallback, missing R2
 * binding, stale edge object, Access login page, or wrong bucket fails because
 * both the generation header and index bytes must match.
 *
 * Usage:
 *   node scripts/verify-camera-deployment.mjs \
 *     --target=/tmp/post-publish/cameras \
 *     --state-file=/tmp/post-publish/state.json \
 *     --origin=https://dev.darkroute.ai
 */

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readLocalGeneration } from './camera-generation.mjs';
import { CAMERA_CONTINUITY_KEY } from './camera-integrity.mjs';

export const CAMERA_VERIFY_ORIGINS = Object.freeze([
  'https://dev.darkroute.ai',
  'https://darkroute.ai',
  'https://www.darkroute.ai',
]);

const USER_AGENT =
  'DarkRoute-camera-deployment-verifier/0.1 (+https://darkroute.ai; contact cory@darkcode.ai)';

function optionValue(argv, index, name) {
  const argument = argv[index];
  if (argument === name) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
    return { value, consumed: 2 };
  }
  if (argument.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1);
    if (value === '') throw new Error(`${name} needs a value`);
    return { value, consumed: 1 };
  }
  return null;
}

export function parseVerificationArgs(argv) {
  const parsed = { target: null, stateFile: null, origin: null };
  const options = new Map([
    ['--target', 'target'],
    ['--state-file', 'stateFile'],
    ['--origin', 'origin'],
  ]);
  for (let index = 0; index < argv.length;) {
    let found = false;
    for (const [name, key] of options) {
      const option = optionValue(argv, index, name);
      if (option === null) continue;
      if (parsed[key] !== null) throw new Error(`${name} may be passed only once`);
      parsed[key] = option.value;
      index += option.consumed;
      found = true;
      break;
    }
    if (!found) throw new Error(`unknown camera deployment verification argument: ${argv[index]}`);
  }
  for (const [name, key] of options) {
    if (parsed[key] === null) throw new Error(`${name} is required`);
  }
  return parsed;
}

export function verifiedOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('camera verification origin is not a URL');
  }
  if (
    !CAMERA_VERIFY_ORIGINS.includes(url.origin) ||
    url.href !== `${url.origin}/` ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('camera verification origin is not an exact approved DarkRoute origin');
  }
  return url.origin;
}

export function accessHeaders(env = process.env) {
  const id = env['CF_ACCESS_SERVICE_CLIENT_ID']?.trim() ?? '';
  const secret = env['CF_ACCESS_SERVICE_CLIENT_SECRET']?.trim() ?? '';
  if ((id === '') !== (secret === '')) {
    throw new Error('set both CF_ACCESS_SERVICE_CLIENT_ID and CF_ACCESS_SERVICE_CLIENT_SECRET');
  }
  return id === ''
    ? {}
    : {
        'CF-Access-Client-Id': id,
        'CF-Access-Client-Secret': secret,
      };
}

export async function verifyCameraDeployment({
  target,
  stateFile,
  origin,
  fetchImpl = fetch,
  env = process.env,
  nonce = randomUUID(),
  validation = {},
}) {
  const approvedOrigin = verifiedOrigin(origin);
  const local = await readLocalGeneration(resolve(target), resolve(stateFile), {
    ...validation,
    requireLicenceUrl: true,
  });
  if (local.basePointer === null) {
    throw new Error('post-publication verification requires a freshly hydrated basePointer');
  }
  if (local.replication.versionsKnown !== true) {
    throw new Error('post-publication verification requires an approved versionsKnown generation');
  }
  const index = local.entries.find((entry) => entry.key === 'index.json');
  if (index === undefined) throw new Error('hydrated camera generation has no index.json');
  const continuity = local.entries.find((entry) => entry.key === CAMERA_CONTINUITY_KEY);
  if (continuity === undefined) throw new Error('hydrated camera generation has no continuity proof');

  const verifyEntry = async (entry) => {
    const requestUrl = new URL(`/cameras/${entry.key}`, approvedOrigin);
    requestUrl.searchParams.set('generation', local.basePointer.generation);
    requestUrl.searchParams.set('verify', nonce);
    const response = await fetchImpl(requestUrl.href, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': USER_AGENT,
        ...accessHeaders(env),
      },
    });
    if (!response.ok || response.status !== 200) {
      throw new Error(`camera deployment ${entry.key} returned HTTP ${String(response.status)}`);
    }
    if (response.url !== requestUrl.href) {
      throw new Error(`camera deployment ${entry.key} resolved to an unreviewed URL`);
    }
    const generation = response.headers.get('x-darkroute-camera-generation');
    if (generation !== local.basePointer.generation) {
      throw new Error('camera deployment did not serve the freshly hydrated generation');
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      throw new Error(`camera deployment ${entry.key} is not JSON`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.equals(entry.body)) {
      throw new Error(`camera deployment ${entry.key} bytes do not match the hydrated generation`);
    }
    return { url: requestUrl.href, bytes: body.length };
  };
  const indexResult = await verifyEntry(index);
  const continuityResult = await verifyEntry(continuity);
  return {
    origin: approvedOrigin,
    generation: local.basePointer.generation,
    indexBytes: indexResult.bytes,
    continuityBytes: continuityResult.bytes,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseVerificationArgs(argv);
  const result = await verifyCameraDeployment(options);
  process.stdout.write(
    `verified ${result.origin}/cameras/index.json at generation ${result.generation} ` +
      `(${String(result.indexBytes)} index bytes / ` +
      `${String(result.continuityBytes)} continuity bytes)\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
