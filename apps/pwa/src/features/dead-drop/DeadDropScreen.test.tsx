/**
 * DEAD DROP, wired to the real evidence chain and the real repositories.
 *
 * Nothing here renders a hand-built view model and nothing here mocks the
 * queue. Drops are filed the way `REPORT` files them -- `createReportQueue()`,
 * genuine ECDSA over the canonical bytes, into `pendingReports` and
 * `reportChain` -- and this screen reads them back out. A screen that agreed
 * with a mock and disagreed with the chain would fail here.
 *
 * TWO TEST DOUBLES, BOTH SANCTIONED AND BOTH NAMED:
 *   `services/db/testing/memory-idb.ts` -- jsdom implements no IndexedDB.
 *   `services/crypto/testing.ts`        -- node cannot persist a CryptoKey, so
 *                                          the harness supplies a key store the
 *                                          manager will sign with. The
 *                                          signatures it produces are real.
 *
 * THERE IS NO NETWORK IN THIS FILE, and `fetch` is stubbed with a spy that must
 * never be called: holding signed evidence offline is the product.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';
import {
  GENESIS_CHAIN_HASH,
  formatHashForDisplay,
  verifyChain,
} from '../../services/crypto/chain.ts';
import type { EvidenceRecord } from '../../services/crypto/chain.ts';
import { TEST_EPOCH_MS, createTestInstall } from '../../services/crypto/testing.ts';
import type { TestInstall } from '../../services/crypto/testing.ts';
import {
  DatabaseUnavailableError,
  closeFwmDb,
  createRepositories,
  openFwmDb,
} from '../../services/db/index.ts';
import type { FwmDatabase } from '../../services/db/repositories/support.ts';
import type { MemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import { resetAllStores, useSyncStore } from '../../stores';
import { createReportQueue } from '../report/reportQueue.ts';
import type { ReportQueuePort } from '../report/reportQueue.ts';

import { DeadDropScreen } from './DeadDropScreen.tsx';
import { createDeadDropPort } from './deadDropQueue.ts';
import type { DeadDropPort } from './deadDropQueue.ts';
import type { EvidenceExportBundle } from './evidenceExport.ts';

const MINUTE = 60_000;

/**
 * The four capture times the panel draws, in chain order:
 *   DROP 00  yesterday      (accepted)
 *   DROP 01  13:12          (held)
 *   DROP 02  13:58          (held)
 *   DROP 03  14:22:08.412   (held, 41 minutes ago)
 * The last is `TEST_EPOCH_MS`, which the crypto harness names for exactly this.
 */
const CAPTURES = [
  '2026-08-19T13:41:00.000Z',
  '2026-08-20T13:12:00.000Z',
  '2026-08-20T13:58:00.000Z',
  '2026-08-20T14:22:08.412Z',
] as const;

/** 41 minutes after the panel's capture time -- the card's `HELD · 41 MIN`. */
const NOW = TEST_EPOCH_MS + 41 * MINUTE;
const now = (): number => NOW;

let memory: MemoryIndexedDB;
let install: TestInstall;
let counter = 0;
let dbName = '';
let filing: ReportQueuePort | null = null;
let reading: DeadDropPort | null = null;
const fetchSpy = vi.fn();
const clipboardSpy = vi.fn();

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

beforeEach(() => {
  resetAllStores();
  counter += 1;
  install = createTestInstall({ startAt: Date.parse(CAPTURES[0]) });
  dbName = `fwm-dead-drop-${String(counter)}`;
  filing = createReportQueue({ chain: install.chain, dbName });
  reading = createDeadDropPort({ dbName });
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: clipboardSpy } });
});

afterEach(() => {
  filing?.close();
  reading?.close();
  filing = null;
  reading = null;
  fetchSpy.mockClear();
  clipboardSpy.mockClear();
  resetAllStores();
});

function payload(over: Partial<Record<string, unknown>> = {}): CanonicalObject {
  return {
    schema: 'fwm-report/v1',
    kind: 'new_camera',
    camera_id: null,
    position: { lat: 39.0997, lon: -84.5786 },
    gps_accuracy_m: 4,
    satellites: null,
    facing_deg: 223,
    facing_source: 'compass',
    mount: 'pole',
    make_model: null,
    photo: null,
    ...over,
  } as CanonicalObject;
}

/**
 * File one drop through the real submit path, then move the injected clock to
 * the next capture the panel draws.
 */
async function file(
  step: number,
  over: Partial<Record<string, unknown>> = {},
): Promise<string> {
  if (filing === null) throw new Error('the filing port was not opened');
  const receipt = await filing.submit(payload(over));
  const next = CAPTURES[step + 1];
  const here = CAPTURES[step];
  if (next !== undefined && here !== undefined) install.tick(Date.parse(next) - Date.parse(here));
  return receipt.reportId;
}

/** The four drops the panel draws: three held, one already accepted. */
async function panelQueue(): Promise<readonly string[]> {
  const zero = await file(0, { kind: 'confirm_existing', camera_id: 'FWM-0119' });
  const one = await file(1);
  const two = await file(2, { kind: 'confirm_existing', camera_id: 'FWM-0442' });
  const three = await file(3);
  // What a completed handover leaves behind: the queue row acknowledged and the
  // record's own transport state advanced with it.
  await withDatabase(async (db) => {
    const repos = createRepositories(db);
    await repos.reportChain.markSyncing(zero);
    await repos.reportChain.markSynced(zero);
    await repos.pendingReports.updateSyncState(zero, 'syncing');
    await repos.pendingReports.updateSyncState(zero, 'synced');
  });
  return [zero, one, two, three];
}

async function withDatabase<T>(run: (db: FwmDatabase) => Promise<T>): Promise<T> {
  const db = await openFwmDb({ name: dbName });
  try {
    return await run(db);
  } finally {
    closeFwmDb(db);
  }
}

async function storedRecord(reportId: string): Promise<EvidenceRecord> {
  const record = await withDatabase((db) => createRepositories(db).pendingReports.get(reportId));
  if (record === undefined) throw new Error(`no stored record for ${reportId}`);
  return record;
}

function renderScreen(
  props: Partial<Parameters<typeof DeadDropScreen>[0]> = {},
): ReturnType<typeof render> {
  return render(<DeadDropScreen port={reading ?? undefined} now={now} {...props} />);
}

describe('the queue as the panel draws it', () => {
  it('counts the held drops in the header, and does not count the accepted one', async () => {
    await panelQueue();
    renderScreen();

    expect(await screen.findByText('3 HELD')).toBeInTheDocument();
  });

  it('says READING before the queue has been read, never 0 HELD', async () => {
    await panelQueue();
    const { container } = renderScreen();

    expect(container.querySelector('.fwm-dead-drop-status')?.textContent).toBe('READING');
    expect(screen.queryByText('0 HELD')).not.toBeInTheDocument();
    await screen.findByText('3 HELD');
  });

  it('renders the signing statement verbatim', async () => {
    await panelQueue();
    renderScreen();

    expect(
      await screen.findByText(
        'Reports are signed the moment you file them and held on this phone. ' +
          'Nothing is edited after the fact. There is nowhere to send them yet.',
      ),
    ).toBeInTheDocument();
  });

  it('features the newest drop and numbers it by its place in the chain', async () => {
    await panelQueue();
    const { container } = renderScreen();

    await screen.findByText('3 HELD');
    const card = container.querySelector('[data-fwm-dead-drop-card]');
    expect(card?.getAttribute('data-fwm-dead-drop-card')).toBe('DROP 03');
    expect(within(card as HTMLElement).getByText('HELD · 41 MIN')).toBeInTheDocument();
  });

  it('lists the remaining drops newest first, with the accepted one last', async () => {
    await panelQueue();
    const { container } = renderScreen();

    await screen.findByText('3 HELD');
    const titles = [...container.querySelectorAll('.fwm-dead-drop-row-title')].map(
      (node) => node.textContent,
    );
    expect(titles).toEqual(['DROP 02 · FWM-0442', 'DROP 01', 'DROP 00 · FWM-0119']);

    const badges = [...container.querySelectorAll('.fwm-dead-drop-row .fwm-dead-drop-badge')].map(
      (node) => node.textContent,
    );
    expect(badges).toEqual(['HELD', 'HELD', 'SYNCED']);
  });

  it('renders the meta line the panel draws, from the signed record', async () => {
    await panelQueue();
    const { container } = renderScreen();

    await screen.findByText('3 HELD');
    const metas = [...container.querySelectorAll('.fwm-dead-drop-row-meta')].map(
      (node) => node.textContent,
    );
    expect(metas).toEqual([
      '13:58 · no photo · signed',
      '13:12 · no photo · signed',
      // The panel's accepted row is TWO terms: `yesterday · accepted`. The
      // photo term says what is still queued to hand over, and an accepted drop
      // has nothing left to hand over.
      'yesterday · accepted',
    ]);
  });
});

describe('the detail card is the record, not a summary of it', () => {
  it('renders the signed capture time, position and facing', async () => {
    await panelQueue();
    const { container } = renderScreen();

    await screen.findByText('3 HELD');
    const facts = new Map(
      [...container.querySelectorAll('[data-fwm-dead-drop-fact]')].map((node) => [
        node.getAttribute('data-fwm-dead-drop-fact'),
        node.querySelector('.fwm-dead-drop-fact-value')?.textContent,
      ]),
    );

    expect(facts.get('CAPTURED')).toBe('14:22:08.412 UTC');
    expect(facts.get('POSITION')).toBe('39.0997 N 84.5786 W ±4M');
    expect(facts.get('HEADING')).toBe('223°');
    expect(facts.get('PHOTO')).toBe('NONE');
  });

  it('shows the drop’s own hash and the hash of the drop before it', async () => {
    const ids = await panelQueue();
    const newest = await storedRecord(ids[3] ?? '');
    const previous = await storedRecord(ids[2] ?? '');
    const { container } = renderScreen();

    await screen.findByText('3 HELD');
    expect(container.querySelector('[data-fwm-dead-drop-hash="chain"]')?.textContent).toBe(
      formatHashForDisplay(newest.chainHash),
    );
    expect(container.querySelector('[data-fwm-dead-drop-hash="previous"]')?.textContent).toBe(
      formatHashForDisplay(previous.chainHash),
    );
    expect(newest.previousChainHash).toBe(previous.chainHash);
  });

  it('renders six middot-separated groups of four, exactly as the panel does', async () => {
    await panelQueue();
    const { container } = renderScreen();

    await screen.findByText('3 HELD');
    const chain = container.querySelector('[data-fwm-dead-drop-hash="chain"]')?.textContent ?? '';
    expect(chain).toMatch(/^[0-9a-f]{4}(·[0-9a-f]{4}){5}$/);
  });

  it('links the first drop in the chain to genesis', async () => {
    await file(3);
    const { container } = renderScreen();

    await screen.findByText('1 HELD');
    expect(container.querySelector('[data-fwm-dead-drop-hash="previous"]')?.textContent).toBe(
      formatHashForDisplay(GENESIS_CHAIN_HASH),
    );
  });

  it('says DEVICE KEY OK only after every signature actually verified', async () => {
    await panelQueue();
    const { container } = renderScreen();

    await screen.findByText('3 HELD');
    const signed = container.querySelector('[data-fwm-dead-drop-fact="SIGNED"]');
    const value = signed?.querySelector('.fwm-dead-drop-fact-value');
    expect(value?.textContent).toBe('DEVICE KEY OK');
    expect(value?.getAttribute('data-fwm-dead-drop-verdict')).toBe('verified');
  });

  it('reports a chain whose stored payload was edited as broken, not as signed', async () => {
    const ids = await panelQueue();
    const doomed = ids[3] ?? '';

    // Rewrite the stored body under the repository, the way a tampered device
    // or a corrupted store would. The queue row -- and therefore the hash it
    // claims -- is untouched.
    await withDatabase(async (db) => {
      const stored = await db.get('pendingReports', doomed);
      if (stored === undefined) throw new Error('nothing to tamper with');
      const edited: EvidenceRecord = {
        ...stored,
        payload: { ...stored.payload, mount: 'wall' },
      };
      const tx = db.transaction('pendingReports', 'readwrite');
      void tx.store.put(edited);
      await tx.done;
    });

    const { container } = renderScreen();
    await screen.findByText('3 HELD');
    const value = container.querySelector(
      '[data-fwm-dead-drop-fact="SIGNED"] .fwm-dead-drop-fact-value',
    );
    expect(value?.textContent).toBe('CHAIN BROKEN');
    expect(value?.getAttribute('data-fwm-dead-drop-verdict')).toBe('broken');
  });

  it('says DEVICE KEY OK when a drop in the MIDDLE of the queue was purged', async () => {
    // `purgeSynced()` deletes EVERY synced body, not only the oldest, so a drop
    // that syncs while an older one is still held leaves a hole in the middle.
    // The drops around it are intact evidence and must not read CHAIN BROKEN.
    const ids = await panelQueue();
    const middle = ids[2] ?? '';
    await withDatabase(async (db) => {
      const repos = createRepositories(db);
      await repos.reportChain.markSyncing(middle);
      await repos.reportChain.markSynced(middle);
      await repos.pendingReports.updateSyncState(middle, 'syncing');
      await repos.pendingReports.updateSyncState(middle, 'synced');
      expect(await repos.pendingReports.purgeSynced()).toBe(2);
    });

    const { container } = renderScreen();
    await screen.findByText('2 HELD');
    const value = container.querySelector(
      '[data-fwm-dead-drop-fact="SIGNED"] .fwm-dead-drop-fact-value',
    );
    expect(value?.textContent).toBe('DEVICE KEY OK');
    expect(value?.getAttribute('data-fwm-dead-drop-verdict')).toBe('verified');
  });

  it('exports a holed queue as a document that still re-verifies', async () => {
    const bundles: EvidenceExportBundle[] = [];
    const ids = await panelQueue();
    const middle = ids[2] ?? '';
    await withDatabase(async (db) => {
      const repos = createRepositories(db);
      await repos.reportChain.markSyncing(middle);
      await repos.reportChain.markSynced(middle);
      await repos.pendingReports.updateSyncState(middle, 'syncing');
      await repos.pendingReports.updateSyncState(middle, 'synced');
      await repos.pendingReports.purgeSynced();
    });

    renderScreen({
      onExport: (bundle) => {
        bundles.push(bundle);
      },
    });
    await screen.findByText('2 HELD');
    fireEvent.click(screen.getByRole('button', { name: 'EXPORT JSON' }));

    const bundle = bundles[0];
    if (bundle === undefined) throw new Error('nothing was exported');
    expect(bundle.count).toBe(2);
    expect(bundle.runCount).toBe(2);

    const parsed = JSON.parse(bundle.text) as {
      readonly runs: readonly {
        readonly first_index: number;
        readonly count: number;
        readonly starting_chain_hash: string;
      }[];
      readonly records: EvidenceRecord[];
    };
    for (const entry of parsed.runs) {
      const slice = parsed.records.slice(entry.first_index, entry.first_index + entry.count);
      await expect(
        verifyChain(slice, { startingChainHash: entry.starting_chain_hash }),
      ).resolves.toMatchObject({ ok: true });
    }
  });

  it('refuses to call a coherently re-signed body signed', async () => {
    // A body rewritten with a new payload, recomputed hashes and a fresh
    // signature under an attacker's own key passes `verifyChain` on its own.
    // What it cannot do is match the queue row this card reads its hashes off.
    const ids = await panelQueue();
    const target = ids[3] ?? '';
    const original = await storedRecord(target);

    const attacker = createTestInstall({ startAt: Date.parse(CAPTURES[3]) });
    const forged = await attacker.chain.finalize({
      payload: payload({ position: { lat: 12.3456, lon: 65.4321 } }),
      previousChainHash: original.previousChainHash,
      capturedAt: original.capturedAt,
      reportId: original.reportId,
    });
    await withDatabase(async (db) => {
      const tx = db.transaction('pendingReports', 'readwrite');
      void tx.store.put(forged);
      await tx.done;
    });

    const { container } = renderScreen();
    await screen.findByText('3 HELD');
    const value = container.querySelector(
      '[data-fwm-dead-drop-fact="SIGNED"] .fwm-dead-drop-fact-value',
    );
    expect(value?.textContent).toBe('CHAIN BROKEN');
    expect(value?.getAttribute('data-fwm-dead-drop-verdict')).toBe('broken');
    // The hashes on the card are still the row's, and the row was never touched.
    expect(container.querySelector('[data-fwm-dead-drop-hash="chain"]')?.textContent).toBe(
      formatHashForDisplay(original.chainHash),
    );
  });

  it('keeps a purged drop’s row, its number and its hashes', async () => {
    const ids = await panelQueue();
    await withDatabase(async (db) => {
      const purged = await createRepositories(db).pendingReports.purgeSynced();
      expect(purged).toBe(1);
    });

    const { container } = renderScreen();
    await screen.findByText('3 HELD');

    const titles = [...container.querySelectorAll('.fwm-dead-drop-row-title')].map(
      (node) => node.textContent,
    );
    // DROP 00's body is gone; its row, its number and its place are not.
    expect(titles).toEqual(['DROP 02 · FWM-0442', 'DROP 01', 'DROP 00']);
    expect(ids).toHaveLength(4);
  });
});

describe('the send boundary', () => {
  it('names the missing transport and disables the key when no path is wired', async () => {
    await panelQueue();
    renderScreen();

    await screen.findByText('3 HELD');
    const send = screen.getByRole('button', { name: 'NOT SENT' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', 'No upload destination is configured in this build.');
  });

  it('runs the injected handler and opens no network path of its own', async () => {
    const onSyncNow = vi.fn();
    await panelQueue();
    renderScreen({ onSyncNow });

    await screen.findByText('3 HELD');
    fireEvent.click(screen.getByRole('button', { name: 'SEND NOW' }));

    expect(onSyncNow).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stays disabled when nothing is held, however it is wired', async () => {
    renderScreen({ onSyncNow: vi.fn() });

    await screen.findByText('0 HELD');
    expect(screen.getByRole('button', { name: 'SEND NOW' })).toBeDisabled();
  });
});

describe('EXPORT JSON', () => {
  it('renders the key disabled when nothing is wired to receive an export', async () => {
    await panelQueue();
    renderScreen();

    await screen.findByText('3 HELD');
    expect(screen.getByRole('button', { name: 'EXPORT JSON' })).toBeDisabled();
  });

  it('hands over a document that re-verifies against the chain', async () => {
    const bundles: EvidenceExportBundle[] = [];
    await panelQueue();
    renderScreen({
      onExport: (bundle) => {
        bundles.push(bundle);
      },
    });

    await screen.findByText('3 HELD');
    fireEvent.click(screen.getByRole('button', { name: 'EXPORT JSON' }));

    const bundle = bundles[0];
    if (bundle === undefined) throw new Error('nothing was exported');
    expect(bundle.count).toBe(4);

    const parsed = JSON.parse(bundle.text) as {
      readonly starting_chain_hash: string;
      readonly records: EvidenceRecord[];
    };
    await expect(
      verifyChain(parsed.records, { startingChainHash: parsed.starting_chain_hash }),
    ).resolves.toMatchObject({ ok: true, count: 4 });
  });

  it('sends nothing, copies nothing and writes nothing to the clipboard', async () => {
    await panelQueue();
    renderScreen({ onExport: vi.fn() });

    await screen.findByText('3 HELD');
    fireEvent.click(screen.getByRole('button', { name: 'EXPORT JSON' }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(clipboardSpy).not.toHaveBeenCalled();
  });

  it('exports nothing and stays disabled on an empty queue', async () => {
    const onExport = vi.fn();
    renderScreen({ onExport });

    await screen.findByText('0 HELD');
    expect(screen.getByRole('button', { name: 'EXPORT JSON' })).toBeDisabled();
    expect(onExport).not.toHaveBeenCalled();
  });
});

describe('states the panel does not draw', () => {
  it('says the queue is empty rather than drawing a placeholder drop', async () => {
    const { container } = renderScreen();

    expect(await screen.findByText('NOTHING QUEUED')).toBeInTheDocument();
    expect(container.querySelector('[data-fwm-dead-drop-card]')).toBeNull();
    expect(container.querySelectorAll('.fwm-dead-drop-row')).toHaveLength(0);
  });

  it('stays quiet when the whole queue is the one drop in the card', async () => {
    await file(3);
    const { container } = renderScreen();

    await screen.findByText('1 HELD');
    expect(screen.queryByText('NOTHING QUEUED')).not.toBeInTheDocument();
    expect(container.querySelector('[data-fwm-dead-drop-card]')).not.toBeNull();
  });

  it('says so when there is no local storage, and offers no controls that would lie', async () => {
    const broken: DeadDropPort = {
      load: () => Promise.reject(new DatabaseUnavailableError('no indexeddb here')),
      close: () => undefined,
    };
    render(<DeadDropScreen port={broken} now={now} onSyncNow={vi.fn()} onExport={vi.fn()} />);

    expect(await screen.findByText('NO LOCAL STORAGE · NOTHING IS QUEUED HERE')).toBeInTheDocument();
    expect(screen.getByText('UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SEND NOW' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'EXPORT JSON' })).toBeDisabled();
  });
});

describe('what the rest of the app is told', () => {
  it('publishes the queue to the sync slice so the dock badge agrees', async () => {
    await panelQueue();
    renderScreen();

    await screen.findByText('3 HELD');
    await waitFor(() => {
      expect(useSyncStore.getState().reports).toBe(3);
    });
    expect(useSyncStore.getState().drops).toHaveLength(4);
  });

  it('publishes no payload, no hash and no signature with it', async () => {
    await panelQueue();
    renderScreen();

    await screen.findByText('3 HELD');
    await waitFor(() => {
      expect(useSyncStore.getState().drops.length).toBeGreaterThan(0);
    });

    for (const drop of useSyncStore.getState().drops) {
      expect(Object.keys(drop).sort()).toEqual([
        'attempts',
        'capturedAt',
        'hasPhoto',
        'label',
        'nextAttemptAtMs',
        'reportId',
        'syncState',
      ]);
    }
  });

  it('publishes no street name, because there is none to publish', async () => {
    await panelQueue();
    renderScreen();

    await screen.findByText('3 HELD');
    await waitFor(() => {
      expect(useSyncStore.getState().drops.length).toBeGreaterThan(0);
    });

    const labels = useSyncStore.getState().drops.map((drop) => drop.label);
    expect(labels).toEqual([null, 'FWM-0442', null, 'FWM-0119']);
  });
});
