/** Conditional publication of equipment metadata; camera generations are untouched. */
import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { required, s3Credentials } from './camera-generation.mjs';
import { MONITORING_MAX_BYTES, validateMonitoringSnapshot } from './road-monitoring-schema.mjs';

export const MONITORING_BUCKET = 'darkroute-cameras';
export const MONITORING_KEY = 'records/road-monitoring.json';
const timeout = () => ({ abortSignal: AbortSignal.timeout(45_000) });
function etagOf(value) {
  if (typeof value !== 'string' || !/^"[a-f\d]{32}"$/iu.test(value)) throw new Error('Invalid monitoring ETag');
  return value;
}
async function withClient(supplied, operation) {
  const client = supplied ?? new S3Client({ region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID?.trim() || required('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: await s3Credentials(), requestChecksumCalculation: 'WHEN_REQUIRED' });
  try { return await operation(client); } finally { if (supplied === undefined) client.destroy(); }
}

export async function readPublishedMonitoring({ client } = {}) {
  return withClient(client, async (r2) => {
    let response;
    try { response = await r2.send(new GetObjectCommand({ Bucket: MONITORING_BUCKET, Key: MONITORING_KEY }), timeout()); }
    catch (error) { if (error?.$metadata?.httpStatusCode === 404 && error.name !== 'NoSuchBucket') return null; throw error; }
    if (response.ContentLength > MONITORING_MAX_BYTES || !response.Body) throw new Error('Invalid stored monitoring body');
    const chunks = [];
    let size = 0;
    for await (const part of response.Body) {
      const bytes = Buffer.from(part);
      size += bytes.length;
      if (size > MONITORING_MAX_BYTES) throw new Error('Stored monitoring snapshot is too large');
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    const etag = etagOf(response.ETag);
    if (createHash('md5').update(bytes).digest('hex') !== etag.slice(1, -1).toLowerCase()) throw new Error('Stored monitoring integrity check failed');
    return { snapshot: validateMonitoringSnapshot(JSON.parse(bytes.toString('utf8'))), etag };
  });
}

export async function publishMonitoring(input, { client, expectedEtag, previousGeneratedAt = null } = {}) {
  const snapshot = validateMonitoringSnapshot(input);
  if (expectedEtag === undefined) throw new Error('Expected ETag is required');
  if (expectedEtag !== null) etagOf(expectedEtag);
  if (previousGeneratedAt !== null && (!Number.isFinite(Date.parse(previousGeneratedAt))
    || Date.parse(previousGeneratedAt) > Date.parse(snapshot.generatedAt))) throw new Error('Refusing older monitoring snapshot');
  const bytes = Buffer.from(`${JSON.stringify(snapshot)}\n`);
  if (bytes.length > MONITORING_MAX_BYTES) throw new Error('Monitoring snapshot is too large');
  const digest = createHash('md5').update(bytes).digest();
  return withClient(client, async (r2) => {
    const response = await r2.send(new PutObjectCommand({ Bucket: MONITORING_BUCKET, Key: MONITORING_KEY,
      Body: bytes, ContentType: 'application/json; charset=utf-8', CacheControl: 'public, max-age=300',
      ContentMD5: digest.toString('base64'), ...(expectedEtag === null ? { IfNoneMatch: '*' } : { IfMatch: expectedEtag }),
    }), timeout());
    const etag = etagOf(response.ETag);
    if (etag.slice(1, -1).toLowerCase() !== digest.toString('hex')) throw new Error('Published monitoring integrity check failed');
    return { etag, records: snapshot.records.length, generatedAt: snapshot.generatedAt };
  });
}
