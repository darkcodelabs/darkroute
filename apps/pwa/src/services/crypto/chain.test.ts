import { describe, expect, it } from 'vitest';
import {
  CAPTURED_AT_RE,
  EVIDENCE_SCHEMA,
  EvidenceInputError,
  GENESIS_CHAIN_HASH,
  GENESIS_PREIMAGE,
  REPORT_ID_RE,
  advanceSyncState,
  chainHeadOf,
  computeChainHash,
  createEvidenceChain,
  formatHashForDisplay,
  verifyChain,
  type EvidenceRecord,
} from './chain';
import { CryptoUnavailableError, createKeyManager } from './keys';
import { canonicalBytes, type CanonicalObject } from './canonicalize';
import { concatBytes, fromBase64Url, fromHex, sha256Hex, toBase64Url, utf8 } from './bytes';
import { createTestInstall, ephemeralMemoryKeyStore, type TestInstall } from './testing';

const subtle = globalThis.crypto.subtle;

function payloadAt(index: number): CanonicalObject {
  return {
    gps_accuracy_m: 4,
    heading_deg: 223,
    mount: 'pole',
    position: { lat: 39.0997 + index / 10000, lon: -84.5786 },
    speed_mph: 47,
    street: `drop ${String(index)}`,
  };
}

async function buildChain(install: TestInstall, count: number): Promise<EvidenceRecord[]> {
  const records: EvidenceRecord[] = [];
  for (let i = 0; i < count; i++) {
    install.tick(1000);
    records.push(
      await install.chain.finalize({
        payload: payloadAt(i),
        previousChainHash: chainHeadOf(records),
      }),
    );
  }
  return records;
}

describe('genesis', () => {
  it('is the sha-256 of the published preimage', async () => {
    expect(GENESIS_PREIMAGE).toBe('flockyswatchingme/evidence-chain/v1/genesis');
    await expect(sha256Hex(subtle, utf8(GENESIS_PREIMAGE))).resolves.toBe(GENESIS_CHAIN_HASH);
  });

  it('is what the first record links to when no previous hash is supplied', async () => {
    const install = createTestInstall();
    const first = await install.chain.finalize({ payload: payloadAt(0) });
    expect(first.previousChainHash).toBe(GENESIS_CHAIN_HASH);
    expect(chainHeadOf([])).toBe(GENESIS_CHAIN_HASH);
  });

  it('rejects a chain whose first record links somewhere else', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 2);
    const result = await verifyChain(records.slice(1), { subtle });
    expect(result).toMatchObject({ ok: false, failure: { index: 0, code: 'bad-genesis' } });
  });
});

describe('finalize', () => {
  it('produces a record with every field the storage layer needs', async () => {
    const install = createTestInstall();
    const record = await install.chain.finalize({ payload: payloadAt(0) });

    expect(record.schema).toBe(EVIDENCE_SCHEMA);
    expect(record.reportId).toMatch(REPORT_ID_RE);
    expect(record.capturedAt).toMatch(CAPTURED_AT_RE);
    expect(record.capturedAt).toBe('2026-08-20T14:22:08.412Z');
    expect(record.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.chainHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.publicKeyId).toMatch(/^[0-9a-f]{64}$/);
    expect(record.gpsAccuracyM).toBe(4);
    expect(record.syncState).toBe('held');
    expect(record.supersedes).toBeNull();
    // ECDSA P-256 raw r||s is exactly 64 bytes, never DER.
    expect(fromBase64Url(record.signature).length).toBe(64);
  });

  it('hashes the payload with the canonical form', async () => {
    const install = createTestInstall();
    const payload = payloadAt(0);
    const record = await install.chain.finalize({ payload });
    expect(record.payloadHash).toBe(await sha256Hex(subtle, canonicalBytes(payload)));
  });

  it('builds chain_hash from exactly prev || payload || captured_at || report_id', async () => {
    const install = createTestInstall();
    const record = await install.chain.finalize({ payload: payloadAt(0) });
    const preimage = concatBytes(
      fromHex(record.previousChainHash),
      fromHex(record.payloadHash),
      utf8(record.capturedAt),
      utf8(record.reportId),
    );
    expect(preimage.length).toBe(32 + 32 + 24 + 36);
    expect(record.chainHash).toBe(await sha256Hex(subtle, preimage));
    expect(record.chainHash).toBe(
      await computeChainHash(subtle, {
        previousChainHash: record.previousChainHash,
        payloadHash: record.payloadHash,
        capturedAt: record.capturedAt,
        reportId: record.reportId,
      }),
    );
  });

  it('signs the raw bytes of chain_hash, not its hex text', async () => {
    const install = createTestInstall();
    const record = await install.chain.finalize({ payload: payloadAt(0) });
    const publicKey = (await install.keys.signing()).publicKey;
    await expect(
      subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        fromBase64Url(record.signature) as BufferSource,
        fromHex(record.chainHash) as BufferSource,
      ),
    ).resolves.toBe(true);
    await expect(
      subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        fromBase64Url(record.signature) as BufferSource,
        utf8(record.chainHash) as BufferSource,
      ),
    ).resolves.toBe(false);
  });

  it('freezes the record and the payload it signed', async () => {
    const install = createTestInstall();
    const payload = { ...payloadAt(0) };
    const record = await install.chain.finalize({ payload });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.payload)).toBe(true);
    expect(() => {
      (record as { syncState: string }).syncState = 'synced';
    }).toThrow(TypeError);
    expect(() => {
      (payload as unknown as { mount: string }).mount = 'edited';
    }).toThrow(TypeError);
  });

  it('rejects inputs that would make a hash ambiguous', async () => {
    const install = createTestInstall();
    await expect(
      install.chain.finalize({ payload: payloadAt(0), capturedAt: '2026-08-20T14:22:08Z' }),
    ).rejects.toBeInstanceOf(EvidenceInputError);
    await expect(
      install.chain.finalize({ payload: payloadAt(0), previousChainHash: 'nope' }),
    ).rejects.toBeInstanceOf(EvidenceInputError);
    await expect(
      install.chain.finalize({ payload: payloadAt(0), reportId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(EvidenceInputError);
    await expect(
      install.chain.finalize({ payload: { gps_accuracy_m: -1 } }),
    ).rejects.toBeInstanceOf(EvidenceInputError);
  });

  it('reads gpsAccuracyM out of the signed payload, and allows null', async () => {
    const install = createTestInstall();
    const record = await install.chain.finalize({ payload: { gps_accuracy_m: null, a: 1 } });
    expect(record.gpsAccuracyM).toBeNull();
  });
});

describe('finalisation is impossible without integrity', () => {
  it('throws CryptoUnavailableError when the probe says unavailable', async () => {
    const chain = createEvidenceChain({
      keys: createKeyManager({ keyStore: ephemeralMemoryKeyStore() }),
    });
    const status = await chain.availability();
    expect(status.status).toBe('unavailable');
    await expect(chain.finalize({ payload: payloadAt(0) })).rejects.toBeInstanceOf(
      CryptoUnavailableError,
    );
  });

  it('carries the reason so the UI can render the exact state', async () => {
    const chain = createEvidenceChain({
      keys: createKeyManager({ keyStore: ephemeralMemoryKeyStore() }),
    });
    await expect(chain.finalize({ payload: payloadAt(0) })).rejects.toMatchObject({
      name: 'CryptoUnavailableError',
      reason: 'no-persistent-key-storage',
    });
  });
});

describe('verifyChain', () => {
  it('accepts an empty chain and reports genesis as the head', async () => {
    await expect(verifyChain([], { subtle })).resolves.toEqual({
      ok: true,
      count: 0,
      headChainHash: GENESIS_CHAIN_HASH,
    });
  });

  it('accepts a well-formed chain and reports its head', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 4);
    const result = await install.chain.verify(records);
    expect(result).toEqual({ ok: true, count: 4, headChainHash: chainHeadOf(records) });
  });

  it('still verifies when this install can no longer sign', async () => {
    // A record carries the key that signed it, so losing the local key must not
    // make an already-signed chain unverifiable.
    const install = createTestInstall();
    const records = await buildChain(install, 3);
    const keyless = createEvidenceChain({
      keys: createKeyManager({ keyStore: ephemeralMemoryKeyStore() }),
    });
    await expect(keyless.availability()).resolves.toMatchObject({ status: 'unavailable' });
    await expect(keyless.verify(records)).resolves.toMatchObject({ ok: true, count: 3 });
  });

  it('detects a tampered payload and names the record', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 3);
    const target = records[1] as EvidenceRecord;
    const tampered: EvidenceRecord = {
      ...target,
      payload: { ...target.payload, street: 'somewhere else' },
    };
    const result = await verifyChain([records[0] as EvidenceRecord, tampered, records[2] as EvidenceRecord], {
      subtle,
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { index: 1, reportId: target.reportId, code: 'payload-hash-mismatch' },
    });
  });

  it('detects a deleted middle record at the record after the hole', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 4);
    const withHole = [records[0], records[1], records[3]] as EvidenceRecord[];
    const result = await verifyChain(withHole, { subtle });
    expect(result).toMatchObject({
      ok: false,
      failure: { index: 2, reportId: records[3]?.reportId, code: 'broken-link' },
    });
  });

  it('detects a reordered record', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 4);
    const swapped = [records[0], records[2], records[1], records[3]] as EvidenceRecord[];
    const result = await verifyChain(swapped, { subtle });
    expect(result).toMatchObject({
      ok: false,
      failure: { index: 1, reportId: records[2]?.reportId, code: 'broken-link' },
    });
  });

  it('detects a forged signature', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 2);
    const target = records[1] as EvidenceRecord;
    const bytes = fromBase64Url(target.signature);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const forged: EvidenceRecord = { ...target, signature: toBase64Url(bytes) };
    const result = await verifyChain([records[0] as EvidenceRecord, forged], { subtle });
    expect(result).toMatchObject({
      ok: false,
      failure: { index: 1, reportId: target.reportId, code: 'bad-signature' },
    });
  });

  it('detects a record re-signed by another install', async () => {
    const alice = createTestInstall();
    const mallory = createTestInstall();
    const records = await buildChain(alice, 2);
    const target = records[1] as EvidenceRecord;
    const malloryKeys = await mallory.keys.signing();
    const reSigned: EvidenceRecord = {
      ...target,
      signature: toBase64Url(
        new Uint8Array(
          await subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' },
            (await mallory.keys.signing()).privateKey,
            fromHex(target.chainHash) as BufferSource,
          ),
        ),
      ),
    };
    // The record still claims Alice's key id and SPKI, so the signature fails.
    const result = await verifyChain([records[0] as EvidenceRecord, reSigned], { subtle });
    expect(result).toMatchObject({ ok: false, failure: { index: 1, code: 'bad-signature' } });

    // Swapping in Mallory's SPKI while keeping Alice's key id is caught earlier.
    const relabelled: EvidenceRecord = { ...reSigned, publicKeySpki: malloryKeys.publicKeySpki };
    await expect(verifyChain([records[0] as EvidenceRecord, relabelled], { subtle })).resolves.toMatchObject(
      { ok: false, failure: { index: 1, code: 'public-key-id-mismatch' } },
    );
  });

  it('can pin a chain to one install', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 1);
    const mine = (await install.keys.signing()).publicKeyId;
    await expect(
      verifyChain(records, { subtle, expectedPublicKeyId: mine }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyChain(records, { subtle, expectedPublicKeyId: 'f'.repeat(64) }),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'untrusted-public-key' } });
  });

  it('rejects a duplicated record', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 2);
    const doubled = [records[0], records[0], records[1]] as EvidenceRecord[];
    await expect(verifyChain(doubled, { subtle })).resolves.toMatchObject({
      ok: false,
      failure: { index: 1, code: 'duplicate-report-id' },
    });
  });

  it('rejects a record captured before the one it follows', async () => {
    const install = createTestInstall();
    const first = await install.chain.finalize({ payload: payloadAt(0) });
    install.tick(-60_000);
    const second = await install.chain.finalize({
      payload: payloadAt(1),
      previousChainHash: first.chainHash,
    });
    await expect(verifyChain([first, second], { subtle })).resolves.toMatchObject({
      ok: false,
      failure: { index: 1, code: 'out-of-order-timestamp' },
    });
  });

  it('rejects a malformed record before it tries to verify anything', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 1);
    const broken: EvidenceRecord = { ...(records[0] as EvidenceRecord), payloadHash: 'short' };
    await expect(verifyChain([broken], { subtle })).resolves.toMatchObject({
      ok: false,
      failure: { index: 0, code: 'malformed-record' },
    });
  });

  it('rejects a record declaring an unknown schema', async () => {
    const install = createTestInstall();
    const records = await buildChain(install, 1);
    const alien = { ...(records[0] as EvidenceRecord), schema: 'other/v9' } as unknown as EvidenceRecord;
    await expect(verifyChain([alien], { subtle })).resolves.toMatchObject({
      ok: false,
      failure: { index: 0, code: 'wrong-schema' },
    });
  });
});

describe('corrections', () => {
  it('supersedes an earlier record with a new linked record', async () => {
    const install = createTestInstall();
    const first = await install.chain.finalize({ payload: payloadAt(0) });
    install.tick(1000);
    const correction = await install.chain.finalize({
      payload: { ...payloadAt(0), mount: 'mast' },
      previousChainHash: first.chainHash,
      supersedes: first.reportId,
    });
    expect(correction.supersedes).toBe(first.reportId);
    await expect(verifyChain([first, correction], { subtle })).resolves.toMatchObject({ ok: true });
  });

  it('rejects a correction pointing at a record that is not in the chain', async () => {
    const install = createTestInstall();
    const orphan = await install.chain.finalize({
      payload: payloadAt(0),
      supersedes: '11111111-1111-4111-8111-111111111111',
    });
    await expect(verifyChain([orphan], { subtle })).resolves.toMatchObject({
      ok: false,
      failure: { index: 0, code: 'unknown-supersedes' },
    });
  });

  it('refuses a record that supersedes itself', async () => {
    const install = createTestInstall();
    await expect(
      install.chain.finalize({
        payload: payloadAt(0),
        reportId: '22222222-2222-4222-8222-222222222222',
        supersedes: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toBeInstanceOf(EvidenceInputError);
  });
});

describe('advanceSyncState', () => {
  it('returns a new record and leaves the original untouched', async () => {
    const install = createTestInstall();
    const record = await install.chain.finalize({ payload: payloadAt(0) });
    const syncing = advanceSyncState(record, 'syncing');
    expect(syncing).not.toBe(record);
    expect(record.syncState).toBe('held');
    expect(syncing.syncState).toBe('syncing');
    expect(Object.isFrozen(syncing)).toBe(true);
  });

  it('never changes a signed field', async () => {
    const install = createTestInstall();
    const record = await install.chain.finalize({ payload: payloadAt(0) });
    const synced = advanceSyncState(advanceSyncState(record, 'syncing'), 'synced');
    for (const field of [
      'reportId',
      'capturedAt',
      'payloadHash',
      'previousChainHash',
      'chainHash',
      'signature',
      'publicKeyId',
      'publicKeySpki',
    ] as const) {
      expect(synced[field]).toBe(record[field]);
    }
    await expect(verifyChain([synced], { subtle })).resolves.toMatchObject({ ok: true });
  });

  it('refuses an illegal move, including any move out of synced', async () => {
    const install = createTestInstall();
    const record = await install.chain.finalize({ payload: payloadAt(0) });
    expect(() => advanceSyncState(record, 'synced')).toThrow(EvidenceInputError);
    const synced = advanceSyncState(advanceSyncState(record, 'syncing'), 'synced');
    expect(() => advanceSyncState(synced, 'held')).toThrow(EvidenceInputError);
  });

  it('allows the dead-letter path and a requeue', async () => {
    const install = createTestInstall();
    const record = await install.chain.finalize({ payload: payloadAt(0) });
    const rejected = advanceSyncState(advanceSyncState(record, 'syncing'), 'rejected');
    expect(advanceSyncState(rejected, 'held').syncState).toBe('held');
  });
});

describe('formatHashForDisplay', () => {
  it('renders the six four-character groups the DEAD DROP readout shows', () => {
    expect(formatHashForDisplay('8f04822fb975e9320ddb14d4ffffffff')).toBe(
      '8f04·822f·b975·e932·0ddb·14d4',
    );
  });
});
