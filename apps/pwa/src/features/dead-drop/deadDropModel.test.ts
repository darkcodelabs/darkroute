/**
 * The DEAD DROP view model: what gets numbered, what gets ordered, and what
 * each queue state is allowed to say.
 *
 * The snapshot is the model's input contract, so it is built here directly.
 * The hashes and signatures inside it are exercised end to end in
 * `DeadDropScreen.test.tsx`, against records the chain actually signed.
 */

import { describe, expect, it } from 'vitest';

import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';
import { GENESIS_CHAIN_HASH } from '../../services/crypto/chain.ts';
import type { EvidenceRecord } from '../../services/crypto/chain.ts';
import type { QueueSyncState, ReportChainRecord } from '../../services/db/schema.ts';

import type { DeadDropSnapshot, DropRecord, SignedVerdict } from './deadDropQueue.ts';
import {
  EMPTY_QUEUE,
  NO_SIGNATURE_CHECK,
  READING_QUEUE,
  headerStatus,
  listMessage,
  loadingModel,
  readyModel,
  unavailableModel,
} from './deadDropModel.ts';

const CAPTURED = '2026-08-20T14:22:08.412Z';
const NOW = Date.parse(CAPTURED) + 41 * 60_000;
const HASH_A = '8f04822fb975e9320ddb14d4'.padEnd(64, '0');
const HASH_B = 'ea6c81fb9735c5919b443f8b'.padEnd(64, '0');

function payload(over: Partial<Record<string, unknown>> = {}): CanonicalObject {
  return {
    schema: 'fwm-report/v1',
    kind: 'new_camera',
    camera_id: null,
    position: { lat: 39.0997, lon: -84.5786 },
    gps_accuracy_m: 4,
    facing_deg: 223,
    photo: null,
    ...over,
  } as CanonicalObject;
}

interface DropOptions {
  readonly id: string;
  readonly state: QueueSyncState;
  readonly capturedAt?: string;
  readonly verdict?: SignedVerdict;
  readonly cameraId?: string | null;
  readonly withBody?: boolean;
  readonly chainHash?: string;
  readonly previousChainHash?: string;
}

function drop(options: DropOptions): DropRecord {
  const capturedAt = options.capturedAt ?? CAPTURED;
  const row: ReportChainRecord = {
    reportId: options.id,
    payloadHash: HASH_A,
    previousChainHash: options.previousChainHash ?? GENESIS_CHAIN_HASH,
    chainHash: options.chainHash ?? HASH_B,
    signature: 'AAAA',
    publicKeyId: HASH_A,
    capturedAt,
    syncState: options.state,
    attempts: 0,
    nextAttemptAt: null,
    publishableAt: null,
    lastError: null,
    deadLetterReason: null,
    syncedAt: null,
  };
  if (options.withBody === false) return { row, body: null, verdict: 'no-body' };
  const body: EvidenceRecord = {
    schema: 'fwm-evidence/v1',
    reportId: options.id,
    capturedAt,
    payload: payload(
      options.cameraId === undefined || options.cameraId === null
        ? {}
        : { kind: 'confirm_existing', camera_id: options.cameraId },
    ),
    payloadHash: HASH_A,
    previousChainHash: row.previousChainHash,
    chainHash: row.chainHash,
    signature: 'AAAA',
    publicKeyId: HASH_A,
    publicKeySpki: 'AAAA',
    gpsAccuracyM: 4,
    syncState: 'held',
    supersedes: null,
  };
  return { row, body, verdict: options.verdict ?? 'verified' };
}

function snapshot(drops: readonly DropRecord[], verifiable = true): DeadDropSnapshot {
  const held = drops.filter(
    (entry) => entry.row.syncState === 'pending' || entry.row.syncState === 'syncing',
  ).length;
  const bodies = drops
    .map((entry) => entry.body)
    .filter((body): body is EvidenceRecord => body !== null);
  return {
    drops,
    counts: { reports: held, actions: 0, total: held, deadLettered: 0 },
    heldCount: held,
    linkage: { ok: true },
    runs: bodies.length === 0 ? [] : [{ records: bodies, startingChainHash: GENESIS_CHAIN_HASH, firstRowIndex: 0, verification: null }],
    verifiable,
    exportable: bodies,
    startingChainHash: GENESIS_CHAIN_HASH,
  };
}

/** The panel's queue: DROP 00 accepted, DROP 01 and 02 held, DROP 03 featured. */
function panelSnapshot(): DeadDropSnapshot {
  return snapshot([
    drop({ id: 'r0', state: 'synced', capturedAt: '2026-08-19T13:41:00.000Z', cameraId: 'FWM-0119' }),
    drop({ id: 'r1', state: 'pending', capturedAt: '2026-08-20T13:12:00.000Z' }),
    drop({ id: 'r2', state: 'pending', capturedAt: '2026-08-20T13:58:00.000Z', cameraId: 'FWM-0442' }),
    drop({ id: 'r3', state: 'pending' }),
  ]);
}

describe('numbering and order', () => {
  it('numbers a drop by its place in the chain, oldest first', () => {
    const model = readyModel(panelSnapshot(), NOW);
    expect(model.detail?.title).toBe('DROP 03');
    expect(model.drops.map((entry) => entry.title)).toEqual([
      'DROP 02 · FWM-0442',
      'DROP 01',
      'DROP 00 · FWM-0119',
    ]);
  });

  it('features the newest drop and lists the rest newest first', () => {
    const model = readyModel(panelSnapshot(), NOW);
    expect(model.detail?.reportId).toBe('r3');
    expect(model.drops.map((entry) => entry.reportId)).toEqual(['r2', 'r1', 'r0']);
  });

  it('does not renumber the older drops when a new one is filed', () => {
    const before = readyModel(panelSnapshot(), NOW);
    const after = readyModel(
      snapshot([...panelSnapshot().drops, drop({ id: 'r4', state: 'pending' })]),
      NOW,
    );
    expect(before.drops.map((entry) => entry.title)).toEqual(
      after.drops.slice(1).map((entry) => entry.title),
    );
  });

  it('features a synced newest drop rather than skipping it', () => {
    const model = readyModel(
      snapshot([drop({ id: 'r0', state: 'pending' }), drop({ id: 'r1', state: 'synced' })]),
      NOW,
    );
    expect(model.detail?.reportId).toBe('r1');
    expect(model.detail?.badge.startsWith('SYNCED')).toBe(true);
  });
});

describe('the header count', () => {
  it('counts held and in-flight drops, and no others', () => {
    const model = readyModel(panelSnapshot(), NOW);
    expect(headerStatus(model)).toBe('3 HELD');
  });

  it('never renders a placeholder zero before the queue has been read', () => {
    expect(headerStatus(loadingModel())).toBe('READING');
    expect(loadingModel().heldCount).toBeNull();
  });

  it('says so when the queue could not be read at all', () => {
    expect(headerStatus(unavailableModel('NO LOCAL STORAGE'))).toBe('UNAVAILABLE');
  });
});

describe('every queue state is drawn, not just the two on the panel', () => {
  const states: readonly [QueueSyncState, string, string][] = [
    ['pending', 'HELD', 'signed'],
    ['syncing', 'SYNCING', 'signed'],
    ['synced', 'SYNCED', 'accepted'],
    ['rejected', 'REFUSED', 'refused'],
    ['dead_letter', 'STUCK', 'stuck'],
  ];

  for (const [state, badge, word] of states) {
    it(`renders a ${state} drop with its own badge and word`, () => {
      const model = readyModel(
        snapshot([drop({ id: 'r0', state }), drop({ id: 'r1', state: 'pending' })]),
        NOW,
      );
      const row = model.drops[0];
      expect(row?.badge).toBe(badge);
      expect(row?.meta.endsWith(` · ${word}`)).toBe(true);
      expect(row?.state).toBe(state);
    });
  }

  it('keeps a dead-lettered drop in the queue, because it is still evidence', () => {
    const model = readyModel(
      snapshot([drop({ id: 'r0', state: 'dead_letter' }), drop({ id: 'r1', state: 'pending' })]),
      NOW,
    );
    expect(model.drops).toHaveLength(1);
    expect(model.drops[0]?.reportId).toBe('r0');
  });
});

describe('the row meta line', () => {
  it('draws three terms on a held row, as the panel does', () => {
    const model = readyModel(panelSnapshot(), NOW);
    expect(model.drops[0]?.meta).toBe('13:58 · no photo · signed');
    expect(model.drops[1]?.meta).toBe('13:12 · no photo · signed');
  });

  it('draws TWO terms on the accepted row, as the panel does', () => {
    const model = readyModel(panelSnapshot(), NOW);
    // The panel's own synced row is `yesterday · accepted`. A third term here
    // is a segment the design does not draw.
    expect(model.drops[2]?.meta).toBe('yesterday · accepted');
    expect(model.drops[2]?.meta.split(' · ')).toHaveLength(2);
  });

  it('claims nothing about a photo when the body is no longer on the device', () => {
    const model = readyModel(
      snapshot([
        drop({ id: 'r0', state: 'dead_letter', withBody: false }),
        drop({ id: 'r1', state: 'pending' }),
      ]),
      NOW,
    );
    expect(model.drops[0]?.meta).toBe('14:22 · stuck');
    expect(model.drops[0]?.meta).not.toContain('photo');
  });

  it('says `photo` only when the signed record actually carries one', () => {
    const withPhoto = drop({ id: 'r0', state: 'pending' });
    const carrying: DropRecord = {
      ...withPhoto,
      body:
        withPhoto.body === null
          ? null
          : { ...withPhoto.body, payload: { ...withPhoto.body.payload, photo: 'blob-ref' } },
    };
    const model = readyModel(snapshot([carrying, drop({ id: 'r1', state: 'pending' })]), NOW);
    expect(model.drops[0]?.meta).toBe('14:22 · photo · signed');
  });
});

describe('a platform that cannot check a signature says so', () => {
  it('carries no reason when the check ran', () => {
    const model = readyModel(panelSnapshot(), NOW);
    expect(model.verifiable).toBe(true);
    expect(model.detail?.unverifiableReason).toBeNull();
  });

  it('names the outage rather than leaving UNVERIFIED unexplained', () => {
    const model = readyModel(
      snapshot([drop({ id: 'r0', state: 'pending', verdict: 'unverified' })], false),
      NOW,
    );
    expect(model.verifiable).toBe(false);
    expect(model.detail?.unverifiableReason).toBe(NO_SIGNATURE_CHECK);
    expect(model.detail?.facts.find((fact) => fact.key === 'SIGNED')?.value).toBe('UNVERIFIED');
  });
});

describe('the SIGNED row', () => {
  const verdicts: readonly [SignedVerdict, string][] = [
    ['verified', 'DEVICE KEY OK'],
    ['broken', 'CHAIN BROKEN'],
    ['unverified', 'UNVERIFIED'],
    ['no-body', 'BODY NOT HELD'],
  ];

  for (const [verdict, label] of verdicts) {
    it(`says ${label} for a ${verdict} drop`, () => {
      const model = readyModel(snapshot([drop({ id: 'r0', state: 'pending', verdict })]), NOW);
      const signed = model.detail?.facts.find((fact) => fact.key === 'SIGNED');
      expect(signed?.value).toBe(label);
      expect(model.detail?.verdict).toBe(verdict);
    });
  }

  it('claims nothing about a drop whose body is no longer on the device', () => {
    const model = readyModel(
      snapshot([drop({ id: 'r0', state: 'synced', withBody: false })]),
      NOW,
    );
    const facts = new Map(model.detail?.facts.map((fact) => [fact.key, fact.value]));
    expect(facts.get('SIGNED')).toBe('BODY NOT HELD');
    expect(facts.get('POSITION')).toBe('—');
    expect(facts.get('HEADING')).toBe('—');
  });
});

describe('what the fact rows are, and in what order', () => {
  it('is the panel’s five rows, in the panel’s order', () => {
    const model = readyModel(panelSnapshot(), NOW);
    expect(model.detail?.facts.map((fact) => fact.key)).toEqual([
      'CAPTURED',
      'POSITION',
      'HEADING',
      'PHOTO',
      'SIGNED',
    ]);
  });

  it('shortens both hashes to the six groups the panel draws', () => {
    const model = readyModel(panelSnapshot(), NOW);
    expect(model.detail?.chainHash).toBe('ea6c·81fb·9735·c591·9b44·3f8b');
    expect(model.detail?.previousChainHash).toMatch(/^[0-9a-f]{4}(·[0-9a-f]{4}){5}$/);
  });
});

describe('what the list says when it has no rows', () => {
  it('says it is reading while the database is still opening', () => {
    expect(listMessage(loadingModel())).toBe(READING_QUEUE);
  });

  it('says the queue is empty when there is genuinely nothing in it', () => {
    expect(listMessage(readyModel(snapshot([]), NOW))).toBe(EMPTY_QUEUE);
  });

  it('stays silent when the only drop is the one in the card', () => {
    const model = readyModel(snapshot([drop({ id: 'r0', state: 'pending' })]), NOW);
    expect(model.drops).toHaveLength(0);
    expect(listMessage(model)).toBeNull();
  });

  it('repeats the failure when the queue could not be read', () => {
    expect(listMessage(unavailableModel('NO LOCAL STORAGE'))).toBe('NO LOCAL STORAGE');
  });
});

describe('what the action keys are allowed to do', () => {
  it('has work for a send path only while something is held', () => {
    expect(readyModel(panelSnapshot(), NOW).hasHeld).toBe(true);
    expect(readyModel(snapshot([drop({ id: 'r0', state: 'synced' })]), NOW).hasHeld).toBe(false);
    expect(loadingModel().hasHeld).toBe(false);
  });

  it('has bytes for EXPORT JSON only while a signed body is on disk', () => {
    expect(readyModel(panelSnapshot(), NOW).hasExportable).toBe(true);
    expect(
      readyModel(snapshot([drop({ id: 'r0', state: 'synced', withBody: false })]), NOW)
        .hasExportable,
    ).toBe(false);
  });
});
