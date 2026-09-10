/** Publish the existing county builder's output independently of app releases. */
import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { required, s3Credentials } from './camera-generation.mjs';

export const ATLAS_BUCKET = 'darkroute-cameras';
export const ATLAS_KEY = 'records/atlas-counties.json';
export const MAX_ATLAS_BYTES = 2_097_152;
const TIMEOUT_MS = 45_000;

export function validateAtlas(snapshot) {
  if (snapshot?.schema !== 'darkroute-atlas-counties/v1' ||
      !snapshot.counties || Array.isArray(snapshot.counties) ||
      !Object.keys(snapshot.counties).length ||
      !['fetchedAt', 'checkedAt'].every((key) => typeof snapshot[key] === 'string' && Number.isFinite(Date.parse(snapshot[key]))) ||
      Date.parse(snapshot.fetchedAt) > Date.parse(snapshot.checkedAt) ||
      !['name', 'home', 'attribution'].every((key) => typeof snapshot.source?.[key] === 'string' && snapshot.source[key]) ||
      !snapshot.source?.licence || typeof snapshot.source.licence !== 'object' ||
      !['alprRows', 'placed', 'unplaced', 'counties', 'agencies'].every((key) => Number.isSafeInteger(snapshot.totals?.[key]) && snapshot.totals[key] >= 0)) {
    throw new Error('Invalid Atlas snapshot');
  }
  let placed = 0;
  for (const [fips, county] of Object.entries(snapshot.counties)) {
    if (!/^\d{5}$/.test(fips) || !Number.isSafeInteger(county.n) || county.n < 1 ||
        !Array.isArray(county.agencies) || !county.agencies.length ||
        !county.agencies.every((name) => typeof name === 'string' && name.trim()) ||
        !Array.isArray(county.vendors) || !county.vendors.every((name) => typeof name === 'string') ||
        !Number.isSafeInteger(county.vendorKnown) || county.vendorKnown < 0 || county.vendorKnown > county.n) {
      throw new Error(`Invalid Atlas county ${fips}`);
    }
    placed += county.n;
  }
  if (snapshot.totals.placed !== placed || snapshot.totals.counties !== Object.keys(snapshot.counties).length ||
      snapshot.totals.alprRows !== snapshot.totals.placed + snapshot.totals.unplaced) {
    throw new Error('Atlas totals do not match county records');
  }
}

function etagOf(value) {
  if (typeof value !== 'string' || !/^"[a-f\d]{32}"$/i.test(value)) throw new Error('Invalid Atlas object ETag');
  return value;
}

export async function publishAtlas(snapshot, { client } = {}) {
  validateAtlas(snapshot);
  const bytes = Buffer.from(`${JSON.stringify(snapshot)}\n`);
  if (bytes.length > MAX_ATLAS_BYTES) throw new Error('Atlas snapshot is too large');
  const r2 = client ?? new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID?.trim() || required('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: await s3Credentials(), requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const send = (command) => r2.send(command, { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
  try {
    let previous = null;
    try {
      previous = await send(new GetObjectCommand({ Bucket: ATLAS_BUCKET, Key: ATLAS_KEY }));
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404 || error.name === 'NoSuchBucket') throw error;
    }
    let etag = null;
    if (previous !== null) {
      if (previous.ContentLength > MAX_ATLAS_BYTES) throw new Error('Stored Atlas is too large');
      const chunks = [];
      let size = 0;
      for await (const chunk of previous.Body) {
        const part = Buffer.from(chunk);
        size += part.length;
        if (size > MAX_ATLAS_BYTES) throw new Error('Stored Atlas is too large');
        chunks.push(part);
      }
      const stored = Buffer.concat(chunks);
      etag = etagOf(previous.ETag);
      if (createHash('md5').update(stored).digest('hex') !== etag.slice(1, -1).toLowerCase()) throw new Error('Stored Atlas integrity check failed');
      const old = JSON.parse(stored.toString('utf8'));
      validateAtlas(old);
      if (Date.parse(old.checkedAt) > Date.parse(snapshot.checkedAt) || Date.parse(old.fetchedAt) > Date.parse(snapshot.fetchedAt)) {
        throw new Error('Refusing to replace a newer Atlas snapshot');
      }
    }
    const digest = createHash('md5').update(bytes).digest();
    const result = await send(new PutObjectCommand({
      Bucket: ATLAS_BUCKET, Key: ATLAS_KEY, Body: bytes,
      ContentType: 'application/json; charset=utf-8', CacheControl: 'public, max-age=60',
      ContentMD5: digest.toString('base64'),
      ...(etag === null ? { IfNoneMatch: '*' } : { IfMatch: etag }),
    }));
    if (etagOf(result.ETag).slice(1, -1).toLowerCase() !== digest.toString('hex')) throw new Error('Published Atlas integrity check failed');
    return { etag: result.ETag, checkedAt: snapshot.checkedAt, counties: snapshot.totals.counties };
  } finally {
    if (client === undefined) r2.destroy();
  }
}
