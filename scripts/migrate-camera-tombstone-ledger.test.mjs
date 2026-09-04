import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  assertTombstoneLedgerAncestry,
  migrateLegacyTombstoneLedger,
  parseCapturedLegacyTombstoneBytes,
  parseLegacyTombstoneBytes,
  parseMigrationArgs,
  verifyTombstoneLedgerAncestry,
  verifyCutoverReconciliation,
} from './migrate-camera-tombstone-ledger.mjs';
import { buildPredecessorEvidence } from './camera-predecessor.mjs';
import {
  ATTRIBUTION,
  LICENCE,
  LICENCE_URL,
  validateReleaseTombstoneLedger,
} from './fetch-cameras.mjs';

const source = {
  generatedAt: '2026-09-01T20:00:00.000Z',
  upstream: '2026-09-01T19:00:00Z',
  tombstones: [
    { id: 'osm:20', reason: 'osm_untag', seq: 11 },
    { id: 'osm:10', reason: 'osm_delete', seq: 10, osmVersion: 2 },
  ],
};

const bytes = Buffer.from(`${JSON.stringify(source)}\n`);
const deployment = { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' };
const legacyPredecessor = buildPredecessorEvidence({
  mode: 'legacy-flat-root',
  entries: [
    { key: 'index.json', body: Buffer.from('{}') },
    { key: 'tombstones.json', body: bytes },
  ],
  deployment,
  capturedAt: '2026-09-01T20:05:00.000Z',
});

describe('legacy tombstone ledger migration', () => {
  it('pins source bytes, verifies exact diff versions, adds notices, and canonical-sorts', async () => {
    const parsed = parseCapturedLegacyTombstoneBytes(bytes, legacyPredecessor);
    const loadSequence = async (sequence) =>
      sequence === 10
        ? [{ type: 'node', id: 10, action: 'delete', version: 2, tags: {} }]
        : [
            {
              type: 'node',
              id: 20,
              action: 'modify',
              version: 4,
              tags: { man_made: 'surveillance' },
            },
          ];
    const { ledger, resolution } = await migrateLegacyTombstoneLedger(parsed, loadSequence);
    assert.equal(ledger.attribution, ATTRIBUTION);
    assert.equal(ledger.licence, LICENCE);
    assert.deepEqual(
      ledger.tombstones.map(({ id, osmVersion }) => [id, osmVersion]),
      [
        ['osm:10', 2],
        ['osm:20', 4],
      ],
    );
    assert.equal(resolution.added, 1);
    assert.equal(resolution.verified, 1);
    assert.doesNotThrow(() => validateReleaseTombstoneLedger(ledger));
    const migratedBytes = Buffer.from(`${JSON.stringify(ledger)}\n`);
    assert.deepEqual(
      assertTombstoneLedgerAncestry({
        predecessor: legacyPredecessor,
        sourceBytes: bytes,
        migratedBytes,
        migratedLedger: ledger,
      }),
      ledger,
    );
    await assert.doesNotReject(
      verifyTombstoneLedgerAncestry({
        predecessor: legacyPredecessor,
        sourceBytes: bytes,
        migratedBytes,
        migratedLedger: ledger,
        loadSequence,
      }),
    );
    const forged = structuredClone(ledger);
    forged.tombstones[1].osmVersion = 400;
    const forgedBytes = Buffer.from(`${JSON.stringify(forged)}\n`);
    await assert.rejects(
      verifyTombstoneLedgerAncestry({
        predecessor: legacyPredecessor,
        sourceBytes: bytes,
        migratedBytes: forgedBytes,
        migratedLedger: forged,
        loadSequence,
      }),
      /no exact-diff OSM version proof/,
    );
  });

  it('rejects changed source bytes, duplicate ids, and implicit output paths', () => {
    assert.throws(() => parseLegacyTombstoneBytes(bytes, '0'.repeat(64)), /source-sha256/);
    const duplicate = { ...source, tombstones: [source.tombstones[0], source.tombstones[0]] };
    const duplicateBytes = Buffer.from(JSON.stringify(duplicate));
    const duplicateSha = createHash('sha256').update(duplicateBytes).digest('hex');
    assert.throws(
      () => parseLegacyTombstoneBytes(duplicateBytes, duplicateSha),
      /invalid or duplicate/,
    );
    assert.throws(
      () => parseMigrationArgs(['--input=x', '--predecessor=predecessor.json']),
      /--out is required/,
    );
  });

  it('requires a versioned generation ledger to be copied byte-for-byte', () => {
    const ledger = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: source.generatedAt,
      upstream: source.upstream,
      tombstones: [{ id: 'osm:10', reason: 'osm_out_of_scope', seq: 10, osmVersion: 3 }],
    };
    const generationBytes = Buffer.from(`${JSON.stringify(ledger)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'generation',
      entries: [
        { key: 'index.json', body: Buffer.from('{}') },
        { key: 'tombstones.json', body: generationBytes },
      ],
      deployment,
      pointer: {
        schema: 'darkroute-camera-pointer/v1',
        slot: 'a',
        generation: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
        previous: null,
        updatedAt: '2026-09-01T20:00:00.000Z',
      },
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    assert.deepEqual(
      assertTombstoneLedgerAncestry({
        predecessor,
        sourceBytes: generationBytes,
        migratedBytes: generationBytes,
        migratedLedger: ledger,
      }),
      ledger,
    );
    assert.throws(
      () =>
        assertTombstoneLedgerAncestry({
          predecessor,
          sourceBytes: generationBytes,
          migratedBytes: Buffer.from(
            `${JSON.stringify({ ...ledger, generatedAt: source.upstream })}\n`,
          ),
          migratedLedger: { ...ledger, generatedAt: source.upstream },
        }),
      /copied byte-for-byte/,
    );
  });

  it('exact-diff migrates a versionsKnown:false pointer generation', async () => {
    const falseGenerationSource = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: source.generatedAt,
      upstream: source.upstream,
      tombstones: [
        ...source.tombstones,
        { id: 'osm:30', reason: 'osm_out_of_scope', seq: 12, osmVersion: 5 },
      ],
    };
    const falseGenerationBytes = Buffer.from(`${JSON.stringify(falseGenerationSource)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'generation',
      entries: [
        { key: 'index.json', body: Buffer.from('{}') },
        { key: 'tombstones.json', body: falseGenerationBytes },
      ],
      deployment,
      pointer: {
        schema: 'darkroute-camera-pointer/v1',
        slot: 'a',
        generation: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
        previous: null,
        updatedAt: '2026-09-01T20:00:00.000Z',
      },
      versionsKnown: false,
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    const parsed = parseCapturedLegacyTombstoneBytes(falseGenerationBytes, predecessor);
    const loadSequence = async (sequence) =>
      sequence === 10
        ? [{ type: 'node', id: 10, action: 'delete', version: 2, tags: {} }]
        : sequence === 12
          ? [
              {
                type: 'node',
                id: 30,
                action: 'modify',
                version: 5,
                lat: 49.2827,
                lon: -123.1207,
                tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' },
              },
            ]
          : [
              {
                type: 'node',
                id: 20,
                action: 'modify',
                version: 4,
                tags: { man_made: 'surveillance' },
              },
            ];
    const countyIndex = { lookup: () => null };
    const { ledger } = await migrateLegacyTombstoneLedger(parsed, loadSequence, {
      countyIndex,
    });
    const migratedBytes = Buffer.from(`${JSON.stringify(ledger)}\n`);
    await assert.doesNotReject(
      verifyTombstoneLedgerAncestry({
        predecessor,
        sourceBytes: falseGenerationBytes,
        migratedBytes,
        migratedLedger: ledger,
        loadSequence,
        countyIndex,
      }),
    );
    assert.equal(ledger.licenceUrl, LICENCE_URL);
    assert.deepEqual(
      ledger.tombstones.map(({ id, osmVersion }) => [id, osmVersion]),
      [
        ['osm:10', 2],
        ['osm:20', 4],
        ['osm:30', 5],
      ],
    );
    await assert.rejects(
      verifyTombstoneLedgerAncestry({
        predecessor,
        sourceBytes: falseGenerationBytes,
        migratedBytes,
        migratedLedger: ledger,
        loadSequence,
        countyIndex: { lookup: () => ({ fips: '53033' }) },
      }),
      /does not end as a qualifying node outside/,
    );
  });

  it('requires a genuinely empty predecessor to use an empty ledger', () => {
    const predecessor = buildPredecessorEvidence({
      mode: 'empty-r2',
      entries: [],
      deployment,
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    const ledger = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: source.generatedAt,
      upstream: source.upstream,
      tombstones: [{ id: 'osm:10', reason: 'osm_delete', seq: 10, osmVersion: 2 }],
    };
    assert.throws(
      () =>
        assertTombstoneLedgerAncestry({
          predecessor,
          sourceBytes: null,
          migratedBytes: Buffer.from(`${JSON.stringify(ledger)}\n`),
          migratedLedger: ledger,
        }),
      /canonical empty tombstone ledger/,
    );
  });

  it('accepts only the exact current version for the complete absent-predecessor set', async () => {
    const emptySource = {
      generatedAt: source.generatedAt,
      upstream: source.upstream,
      tombstones: [],
    };
    const sourceBytes = Buffer.from(`${JSON.stringify(emptySource)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'legacy-flat-root',
      entries: [
        { key: 'index.json', body: Buffer.from('{}') },
        { key: 'tombstones.json', body: sourceBytes },
        {
          key: '11/1/2.json',
          body: Buffer.from(JSON.stringify({ cameras: [{ id: 'osm:99' }] })),
        },
      ],
      deployment,
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    const ledger = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: '2026-09-01T20:06:00.000Z',
      upstream: '2026-09-01T20:00:00Z',
      tombstones: [{ id: 'osm:99', reason: 'cutover_reconciliation', seq: 12, osmVersion: 5 }],
    };
    const bytes = Buffer.from(`${JSON.stringify(ledger)}\n`);
    const node = {
      type: 'node',
      id: 99,
      version: 5,
      timestamp: '2026-09-01T19:30:00Z',
      visible: true,
      lat: 49.2,
      lon: -123.1,
      tags: {},
    };
    const fetchImpl = async (url) =>
      url.endsWith('.state.txt')
        ? {
            ok: true,
            status: 200,
            url,
            text: async () => 'sequenceNumber=12\ntimestamp=2026-09-01T20\\:00\\:00Z\n',
          }
        : {
            ok: true,
            status: 200,
            url,
            json: async () => ({ elements: [node] }),
          };
    await assert.doesNotReject(
      verifyCutoverReconciliation({
        predecessor,
        sourceBytes,
        migratedBytes: bytes,
        migratedLedger: ledger,
        baselineLiveIds: [],
        countyIndex: { lookup: () => null },
        fetchImpl,
      }),
    );
    const forged = structuredClone(ledger);
    forged.tombstones[0].osmVersion = 1;
    await assert.rejects(
      verifyCutoverReconciliation({
        predecessor,
        sourceBytes,
        migratedBytes: Buffer.from(`${JSON.stringify(forged)}\n`),
        migratedLedger: forged,
        baselineLiveIds: [],
        countyIndex: { lookup: () => null },
        fetchImpl,
      }),
      /not the exact current node version/,
    );
    await assert.rejects(
      verifyCutoverReconciliation({
        predecessor,
        sourceBytes,
        migratedBytes: bytes,
        migratedLedger: ledger,
        baselineLiveIds: ['osm:99'],
        countyIndex: { lookup: () => null },
        fetchImpl,
      }),
      /does not exactly cover/,
    );
    await assert.rejects(
      verifyCutoverReconciliation({
        predecessor,
        sourceBytes,
        migratedBytes: bytes,
        migratedLedger: ledger,
        baselineLiveIds: [],
        countyIndex: { lookup: () => ({}) },
        fetchImpl: async (url) =>
          url.endsWith('.state.txt')
            ? fetchImpl(url)
            : {
                ok: true,
                status: 200,
                url,
                json: async () => ({
                  elements: [
                    {
                      ...node,
                      lat: 38.9,
                      lon: -94.7,
                      tags: {
                        man_made: 'surveillance',
                        'surveillance:type': 'ANPR',
                      },
                    },
                  ],
                }),
              },
      }),
      /still a qualifying in-scope camera/,
    );
  });

  it('requires exact-current reconciliation for a predecessor-live inherited-tombstone overlap', async () => {
    const overlapSource = {
      generatedAt: source.generatedAt,
      upstream: source.upstream,
      tombstones: [{ id: 'osm:99', reason: 'osm_delete', seq: 10, osmVersion: 2 }],
    };
    const sourceBytes = Buffer.from(`${JSON.stringify(overlapSource)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'legacy-flat-root',
      entries: [
        { key: 'index.json', body: Buffer.from('{}') },
        { key: 'tombstones.json', body: sourceBytes },
        {
          key: '11/1/2.json',
          body: Buffer.from(JSON.stringify({ cameras: [{ id: 'osm:99' }] })),
        },
      ],
      deployment,
      capturedAt: '2026-09-01T20:05:00.000Z',
    });
    const inherited = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: source.generatedAt,
      upstream: source.upstream,
      tombstones: overlapSource.tombstones,
    };
    await assert.rejects(
      verifyCutoverReconciliation({
        predecessor,
        sourceBytes,
        migratedBytes: Buffer.from(`${JSON.stringify(inherited)}\n`),
        migratedLedger: inherited,
        baselineLiveIds: [],
        countyIndex: { lookup: () => null },
        fetchImpl: async () => {
          throw new Error('an inherited historical tombstone must fail before network');
        },
      }),
      /does not exactly cover the absent predecessor ids/,
    );

    const reconciled = {
      ...inherited,
      generatedAt: '2026-09-01T20:06:00.000Z',
      upstream: '2026-09-01T20:00:00Z',
      tombstones: [{ id: 'osm:99', reason: 'cutover_reconciliation', seq: 12, osmVersion: 5 }],
    };
    const currentNode = {
      type: 'node',
      id: 99,
      version: 5,
      timestamp: '2026-09-01T19:30:00Z',
      visible: true,
      lat: 49.2,
      lon: -123.1,
      tags: {},
    };
    const fetchImpl = async (url) =>
      url.endsWith('.state.txt')
        ? {
            ok: true,
            status: 200,
            url,
            text: async () => 'sequenceNumber=12\ntimestamp=2026-09-01T20\\:00\\:00Z\n',
          }
        : {
            ok: true,
            status: 200,
            url,
            json: async () => ({ elements: [currentNode] }),
          };
    await assert.doesNotReject(
      verifyCutoverReconciliation({
        predecessor,
        sourceBytes,
        migratedBytes: Buffer.from(`${JSON.stringify(reconciled)}\n`),
        migratedLedger: reconciled,
        baselineLiveIds: [],
        countyIndex: { lookup: () => null },
        fetchImpl,
      }),
    );
    await assert.rejects(
      verifyCutoverReconciliation({
        predecessor,
        sourceBytes,
        migratedBytes: Buffer.from(`${JSON.stringify(reconciled)}\n`),
        migratedLedger: reconciled,
        baselineLiveIds: [],
        countyIndex: { lookup: () => ({ fips: '53033' }) },
        fetchImpl: async (url) =>
          url.endsWith('.state.txt')
            ? fetchImpl(url)
            : {
                ok: true,
                status: 200,
                url,
                json: async () => ({
                  elements: [
                    {
                      ...currentNode,
                      lat: 38.9,
                      lon: -94.7,
                      tags: {
                        man_made: 'surveillance',
                        'surveillance:type': 'ALPR',
                      },
                    },
                  ],
                }),
              },
      }),
      /still a qualifying in-scope camera/,
    );
  });
});
