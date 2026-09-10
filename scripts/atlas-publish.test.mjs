import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { ATLAS_BUCKET, ATLAS_KEY, MAX_ATLAS_BYTES, publishAtlas } from './atlas-publish.mjs';

const snapshot = {
  schema: 'darkroute-atlas-counties/v1', fetchedAt: '2026-09-09T12:00:00Z', checkedAt: '2026-09-10T12:00:00Z',
  source: { name: 'Atlas of Surveillance', home: 'https://atlasofsurveillance.org/', attribution: 'Atlas of Surveillance', licence: {} },
  totals: { counties: 1, placed: 1, unplaced: 0, alprRows: 1, agencies: 1 },
  counties: { '20091': { n: 1, agencies: ['Example agency'], vendors: [], vendorKnown: 0 } },
};
const bytesOf = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const etagOf = (bytes) => `"${createHash('md5').update(bytes).digest('hex')}"`;
const failure = (code, name) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: code } });
function clientFor(previous = null, putError = null) {
  const commands = [];
  return { commands, async send(command) {
    commands.push(command);
    if (command.constructor.name === 'GetObjectCommand') {
      if (previous instanceof Error) throw previous;
      if (previous === null) throw failure(404, 'NoSuchKey');
      const bytes = bytesOf(previous);
      return { ContentLength: bytes.length, ETag: etagOf(bytes), Body: Readable.from([bytes]) };
    }
    if (putError) throw putError;
    return { ETag: etagOf(command.input.Body) };
  } };
}

describe('Atlas snapshot publication', () => {
  it('creates only the fixed Atlas object with an atomic first-write condition', async () => {
    const client = clientFor();
    await publishAtlas(snapshot, { client });
    const put = client.commands[1].input;
    assert.equal(put.Bucket, ATLAS_BUCKET);
    assert.equal(put.Key, ATLAS_KEY);
    assert.equal(put.IfNoneMatch, '*');
    assert.equal(put.IfMatch, undefined);
    assert.equal(put.CacheControl, 'public, max-age=60');
    assert.equal(put.ContentMD5, createHash('md5').update(bytesOf(snapshot)).digest('base64'));
  });
  it('replaces the observed snapshot conditionally and propagates competing writes', async () => {
    const client = clientFor(snapshot);
    await publishAtlas(snapshot, { client });
    assert.equal(client.commands[1].input.IfMatch, etagOf(bytesOf(snapshot)));
    const conflict = failure(412, 'PreconditionFailed');
    const race = clientFor(snapshot, conflict);
    await assert.rejects(publishAtlas(snapshot, { client: race }), (error) => error === conflict);
    assert.equal(race.commands.length, 2);
  });
  it('retains newer published data when a stale collection finishes later', async () => {
    const client = clientFor({ ...snapshot, checkedAt: '2026-09-11T12:00:00Z' });
    await assert.rejects(publishAtlas(snapshot, { client }), /newer Atlas/);
    assert.equal(client.commands.length, 1);
  });
  it('refuses unreadable storage instead of treating it as a first publication', async () => {
    for (const error of [failure(403, 'AccessDenied'), failure(503, 'ServiceUnavailable'), failure(404, 'NoSuchBucket')]) {
      const client = clientFor(error);
      await assert.rejects(publishAtlas(snapshot, { client }), (cause) => cause === error);
      assert.equal(client.commands.length, 1);
    }
  });
  it('rejects incomplete, empty, oversized and inconsistent snapshots before storage access', async () => {
    for (const invalid of [null, { ...snapshot, counties: {} }, { ...snapshot, totals: { placed: 2, counties: 1 } },
      { ...snapshot, checkedAt: '2020-01-01T00:00:00Z' }, { ...snapshot, extra: 'x'.repeat(MAX_ATLAS_BYTES) }]) {
      const client = clientFor();
      await assert.rejects(publishAtlas(invalid, { client }));
      assert.equal(client.commands.length, 0);
    }
  });
  it('does not replace a stored object whose bytes do not match its ETag', async () => {
    const client = { async send() { return { ETag: etagOf(Buffer.from('different')), Body: Readable.from([bytesOf(snapshot)]) }; } };
    await assert.rejects(publishAtlas(snapshot, { client }), /integrity/);
  });
});
