/**
 * REPORT, wired to the real stores, the real evidence chain and the real
 * repositories.
 *
 * Nothing here renders a hand-built view model and nothing here mocks the
 * queue. A submission goes through `chain.finalize()` -- genuine ECDSA over the
 * canonical bytes -- into `pendingReports` and `reportChain`, and the assertions
 * read it back out of the database. A screen that agreed with a mock and
 * disagreed with the chain would fail here.
 *
 * TWO TEST DOUBLES, BOTH SANCTIONED AND BOTH NAMED:
 *   `services/db/testing/memory-idb.ts` -- jsdom implements no IndexedDB.
 *   `services/crypto/testing.ts`        -- node cannot persist a CryptoKey, so
 *                                          the harness supplies a key store the
 *                                          manager will sign with. The
 *                                          signatures it produces are real.
 *
 * THERE IS NO NETWORK IN THIS FILE, and `fetch` is stubbed with a spy that must
 * never be called: filing a report offline is the product.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapturedPhoto } from '../../services/adapters/cameraCapture.ts';
import { sha256Hex } from '../../services/crypto/bytes.ts';
import { createTestInstall } from '../../services/crypto/testing.ts';
import type { TestInstall } from '../../services/crypto/testing.ts';
import {
  DatabaseUnavailableError,
  closeFwmDb,
  createRepositories,
  openFwmDb,
} from '../../services/db/index.ts';
import type { MemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import { ingestAlertTick, positionActions, resetAllStores } from '../../stores';
import type { AlertState, AlertTick, CameraAssessment } from '../../stores';

import {
  NOTHING_TO_CONFIRM,
  PHOTO_ADD_LABEL,
  PHOTO_ISSUE,
  PHOTO_PREPARING_LABEL,
  PHOTO_REMOVE_LABEL,
  PRIVACY_NOTE,
  ReportViewV1,
  photoFacts,
} from './components/ReportViewV1.tsx';
import { osmBlocker } from './osmTags.ts';
import { MAX_BYTES, preparePhoto } from './preparePhoto.ts';
import type * as PreparePhotoModule from './preparePhoto.ts';
import type { PreparedPhoto } from './preparePhoto.ts';
import { emptyDraft, reportPayload } from './reportDraft.ts';
import { ReportScreen } from './ReportScreen.tsx';
import type { PhotoSourcePort } from './ReportScreen.tsx';
import { PHOTO_NOT_STORED, PhotoDigestMismatchError, createReportQueue } from './reportQueue.ts';
import type { ReportQueuePort } from './reportQueue.ts';

/**
 * `preparePhoto()` IS STUBBED, AND THIS IS NOT LAZINESS.
 *
 * `createImageBitmap` does not exist in jsdom, and `preparePhoto()`'s first
 * line returns null without it - so an unstubbed call here would take the "that
 * is not a photo" branch in every single test and every attach assertion below
 * would pass while proving nothing about the attach path.
 *
 * The re-encode that actually strips the metadata is proven where it can be, in
 * `e2e/preparePhoto.spec.ts`, in a real browser. What is proven HERE is the
 * wiring around it: the digest, the payload, the store, and the refusals.
 */
vi.mock('./preparePhoto.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof PreparePhotoModule>();
  return { ...actual, preparePhoto: vi.fn() };
});

const NOW = 1_760_000_000_000;

let memory: MemoryIndexedDB;
let install: TestInstall;
let counter = 0;
let dbName = '';
let port: ReportQueuePort | null = null;
const fetchSpy = vi.fn();

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

beforeEach(() => {
  resetAllStores();
  install = createTestInstall();
  dbName = `fwm-report-${String(++counter)}`;
  port = createReportQueue({ chain: install.chain, dbName });
  // `restoreMocks` only restores `vi.spyOn` spies; a `vi.fn()` from a module
  // factory keeps its call history for the whole file, so a test asserting
  // "never called" would read the previous test's calls. Reset it explicitly.
  vi.mocked(preparePhoto).mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  port?.close();
  port = null;
  fetchSpy.mockClear();
  resetAllStores();
});

/** The fix the panel renders: Cincinnati, ±4 m, pointing south-west. */
function lock(headingDeg: number | null = 223): void {
  positionActions.ingestFix({
    lat: 39.0997,
    lon: -84.5786,
    accuracyM: 4,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: 21,
    headingDeg,
    timestamp: NOW,
  });
}

function assessment(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: 'FWM-0442',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    bearingDeg: 41,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 221,
    inRange: true,
    muted: false,
    mergedIds: ['FWM-0442'],
    ...over,
  };
}

function tick(over: Partial<AlertTick> = {}): AlertTick {
  const nearest = over.nearest === undefined ? assessment() : over.nearest;
  const state: AlertState = over.state ?? 'in_range';
  return {
    timestampMs: NOW,
    state,
    previousState: 'clear',
    changed: true,
    nearest,
    cameras: nearest === null ? [] : [nearest],
    countInRange: 1,
    thresholdFt: 500,
    effectiveThresholdFt: 500,
    isClosing: true,
    speedMps: 21,
    speedSource: 'gps',
    accuracyM: 4,
    stationary: false,
    globallyMuted: false,
    shouldAlertUser: true,
    hapticPulses: 1,
    notifyCameraIds: ['FWM-0442'],
    suppressedBy: [],
    ...over,
  };
}

async function mount(): Promise<void> {
  await act(async () => {
    render(<ReportScreen queue={port ?? undefined} />);
  });
}

/**
 * Mount the view the app ACTUALLY ROUTES TO.
 *
 * `registry.v1.tsx:107` maps the `report` screen to `ReportV1Screen`, which
 * renders `ReportViewV1`. Every other test in this file mounts the default
 * view, which is v0 - so the whole suite was exercising a component the build
 * does not ship, and a deadlock that made the CONFIRM tab permanently
 * unpressable went out to a driver with 2,764 tests green behind it.
 */
async function mountV1(): Promise<void> {
  await act(async () => {
    render(<ReportScreen queue={port ?? undefined} view={ReportViewV1} />);
  });
}

async function tap(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

/** What actually landed on disk, read through a second connection. */
async function stored(): Promise<{
  readonly chainRows: readonly { readonly reportId: string; readonly syncState: string }[];
  readonly payloads: readonly Record<string, unknown>[];
  readonly verified: boolean;
}> {
  const db = await openFwmDb({ name: dbName });
  const repos = createRepositories(db);
  const chainRows = await repos.reportChain.all();
  const records = await repos.pendingReports.all();
  const verification = await install.chain.verify(records);
  closeFwmDb(db);
  return {
    chainRows: chainRows.map((row) => ({ reportId: row.reportId, syncState: row.syncState })),
    payloads: records.map((record) => record.payload as Record<string, unknown>),
    verified: verification.ok,
  };
}

/** The bytes on disk for one report, read through a second connection. */
async function storedPhoto(reportId: string): Promise<{
  readonly sha256: string;
  readonly bytes: readonly number[];
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
} | null> {
  const db = await openFwmDb({ name: dbName });
  const row = await createRepositories(db).reportPhotos.get(reportId);
  closeFwmDb(db);
  if (row === undefined) return null;
  return {
    sha256: row.sha256,
    // NOT `row.bytes instanceof Uint8Array`: the memory IndexedDB double clones
    // with Node's `structuredClone`, so a stored array comes back built from
    // Node's `Uint8Array` while this file sees jsdom's, and `instanceof` is
    // false here and true in a browser. Compare the contents instead.
    bytes: Array.from(row.bytes),
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
  };
}

/** A dozen bytes standing in for a prepared JPEG. Content is irrelevant; the digest is not. */
const PHOTO_BYTES = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);

function preparedPhoto(over: Partial<PreparedPhoto> = {}): PreparedPhoto {
  return {
    blob: new Blob([PHOTO_BYTES], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    sizeBytes: PHOTO_BYTES.byteLength,
    width: 1600,
    height: 1200,
    metadataStripped: true,
    capturedAt: NOW,
    ...over,
  };
}

/** What the OS camera handed over. `preparePhoto` is stubbed, so it is never decoded. */
function capturedPhoto(): CapturedPhoto {
  return {
    blob: new Blob([PHOTO_BYTES], { type: 'image/jpeg' }),
    mimeType: 'image/jpeg',
    sizeBytes: PHOTO_BYTES.byteLength,
    metadataStripped: false,
    capturedAt: NOW,
  };
}

/** A camera that always hands back the same shot. Null models backing out. */
function source(photo: CapturedPhoto | null = capturedPhoto()): PhotoSourcePort {
  return { pick: () => Promise.resolve(photo) };
}

/**
 * Press ADD A PHOTO and let the whole pipeline land.
 *
 * The attach path spans four awaits, two of them IndexedDB round trips, so the
 * state updates arrive after the click's own `act()` has closed - which React
 * reports as an update outside `act`. Draining a macrotask INSIDE an `act`
 * puts them back where they belong.
 */
async function tapAttach(): Promise<void> {
  await tap(screen.getByRole('button', { name: PHOTO_ADD_LABEL }));
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Which of the four photo states the SHIPPED sheet is in.
 *
 * `ReportViewV1` puts `data-fwm-report-photo` on the block that wraps all four
 * states rather than on the tile, because `attached` has no tile - so this one
 * query answers the question whichever state is drawn. WHY the reason is not in
 * here as well: the reason is the authored sentence, and asserting the sentence
 * is what proves the driver was told something useful.
 */
function photoState(): string {
  return document.querySelector('[data-fwm-report-photo]')?.getAttribute('data-fwm-report-photo') ?? '';
}

/**
 * `mountV1()` WITH A CAMERA. Same view the app routes to, same controls a
 * driver presses.
 *
 * This used to mount a `PhotoHarnessView` wrapper that added its own attach and
 * remove buttons, because `ReportViewV1` had no photo affordance yet. It has
 * one now, so the wrapper is gone: a test pressing a button the shipped sheet
 * does not draw proves the container and nothing about what a driver can reach.
 */
async function mountWithCamera(
  camera: PhotoSourcePort,
  queue: ReportQueuePort | undefined = port ?? undefined,
): Promise<void> {
  await act(async () => {
    render(<ReportScreen queue={queue} photos={camera} view={ReportViewV1} />);
  });
}

describe('wiring', () => {
  it("renders the position slice's own fix and accuracy", async () => {
    lock();
    await mount();

    expect(screen.getByText('POSITION · AUTO')).toBeInTheDocument();
    expect(screen.getByText('39.0997 N · 84.5786 W')).toBeInTheDocument();
    // No satellite count on a browser: the line falls back to the accuracy.
    expect(screen.getByText('±4 M')).toBeInTheDocument();
  });

  it('does NOT point the arc from the phone, even with a heading available', async () => {
    // `lock()` supplies headingDeg 223 - the CAR's course over ground. The
    // camera is a separate object on a pole, usually across the road rather
    // than along it, so seeding from this was an inference about one thing
    // printed as a measurement of another and signed into the payload.
    //
    // It was also sometimes not a bearing at all: adapters/orientation.ts:117
    // says a non-absolute reading has an arbitrary zero and "the caller must
    // not render it as a bearing", and the flag it sets has no consumer.
    lock(223);
    await mount();

    expect(screen.getByText('FACING · NOT SET YET')).toBeInTheDocument();
    expect(screen.queryByText('FACING · FROM COMPASS')).not.toBeInTheDocument();
    // Still filable. An unset facing is a missing OPTIONAL fact, not a blocker.
    expect(screen.getByRole('button', { name: 'SUBMIT REPORT' })).toBeEnabled();
  });

  it('says the same thing when there is no heading at all, because it is the same state', async () => {
    lock(null);
    await mount();

    expect(screen.getByText('FACING · NOT SET YET')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SUBMIT REPORT' })).toBeEnabled();
  });

  it("takes the driver's own bearing off the dial", async () => {
    lock();
    await mount();

    const dial = screen.getByRole('slider', { name: 'camera facing' });
    await act(async () => {
      fireEvent.keyDown(dial, { key: 'PageUp' });
    });

    expect(screen.getByText('FACING · SET BY HAND')).toBeInTheDocument();
    // From an unset arc, PageUp is the coarse step off 0 rather than off 223.
    expect(screen.getByText(/15°/)).toBeInTheDocument();
  });
});

describe('SUBMIT REPORT, with no network', () => {
  it('signs the report, chains it, holds it, and reads the count back from disk', async () => {
    lock();
    await mount();

    await tap(screen.getByRole('button', { name: 'POLE MOUNT' }));
    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));

    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    const disk = await stored();
    expect(disk.chainRows).toHaveLength(1);
    expect(disk.chainRows[0]?.syncState).toBe('pending');
    expect(disk.verified).toBe(true);
    expect(disk.payloads[0]).toMatchObject({
      kind: 'new_camera',
      mount: 'pole',
      // Unset: the driver filed without pointing the arc, and the sheet no
      // longer fills it in from the car's course over ground.
      facing_deg: null,
      observer_position: { lat: 39.0997, lon: -84.5786 },
      subject_position: null,
      gps_accuracy_m: 4,
      photo: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('TWO TAPS MAKE IT MAPPABLE: side and distance reach the signed payload', async () => {
    /*
     * THE WHOLE POINT OF THE PLACEMENT CONTROL, end to end.
     *
     * The test above files a report with `subject_position: null` - correct,
     * and permanently unpublishable, because nobody said where the camera was.
     * This one presses the two chips a driver would press and asserts that the
     * answer survives all the way into the signed record.
     *
     * The heading is 223 degrees. RIGHT of that bearing is roughly
     * west-north-west, so the camera lands WEST of the driver, and the
     * assertion below checks the direction rather than only the presence of a
     * coordinate - a projection that produced the driver's own position, or
     * offset it the wrong way, would still be a non-null object.
     */
    lock();
    await mount();

    await tap(screen.getByRole('button', { name: 'RIGHT' }));
    await tap(screen.getByRole('button', { name: 'ONE LANE OVER' }));
    expect(screen.getByText('RIGHT · ONE LANE OVER')).toBeInTheDocument();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    const disk = await stored();
    const payload = disk.payloads[0] as Record<string, unknown>;
    expect(payload['subject_position_source']).toBe('projected');

    const subject = payload['subject_position'] as { lat: number; lon: number };
    const observer = payload['observer_position'] as { lat: number; lon: number };
    expect(subject).toBeTruthy();
    // NOT the driver's own fix. That equality was the bug.
    expect(subject).not.toEqual(observer);
    // Heading 223, so RIGHT is west of travel.
    expect(subject.lon).toBeLessThan(observer.lon);

    // 40 ft is 12.19 m. Checking the magnitude catches a feet-for-metres slip,
    // which would still produce a plausible-looking coordinate.
    const mPerDegLon = 111_320 * Math.cos((observer.lat * Math.PI) / 180);
    const dx = (subject.lon - observer.lon) * mPerDegLon;
    const dy = (subject.lat - observer.lat) * 111_320;
    expect(Math.hypot(dx, dy)).toBeCloseTo(40 * 0.3048, 1);

    // And the record is now something the OSM path would accept, which is the
    // state no report could reach before this control existed.
    expect(osmBlocker(payload as never)).toBeNull();
  });

  it('OVERHEAD needs no distance, and still places the camera', async () => {
    lock();
    await mount();

    await tap(screen.getByRole('button', { name: 'OVERHEAD' }));
    // The distance row is removed rather than disabled - a gantry camera has
    // no "how far over" to answer.
    expect(screen.queryByRole('button', { name: 'ONE LANE OVER' })).toBeNull();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    const payload = (await stored()).payloads[0] as Record<string, unknown>;
    // Equal to the observer fix, and that is a real answer here: the camera is
    // on a gantry above the lane. It differs from the v1 bug in that the driver
    // asserted it rather than the code assuming it, which is why the source
    // field says so.
    expect(payload['subject_position']).toEqual(payload['observer_position']);
    expect(payload['subject_position_source']).toBe('projected');
    expect(osmBlocker(payload as never)).toBeNull();
  });

  it('links a second report to the first, so the queue order is provable', async () => {
    lock();
    await mount();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('2 REPORTS QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    const disk = await stored();
    expect(disk.chainRows).toHaveLength(2);
    expect(disk.verified).toBe(true);
    // BOTH payloads, not just the count. A chain of two rows proves the ORDER
    // of two records; it says nothing about what is inside the second one, and
    // a report that verifies is not the same thing as a report that is right.
    expect(disk.payloads).toHaveLength(2);
    for (const payload of disk.payloads) {
      expect(payload).toMatchObject({
        kind: 'new_camera',
        // Unset, because the driver never pointed the arc. The sheet no longer
        // fills this in from the car's course over ground.
        facing_deg: null,
        // `reportDraft.ts:542` nulls the source whenever there is no bearing -
        // a provenance for a value that does not exist would be noise.
        facing_source: null,
        observer_position: { lat: 39.0997, lon: -84.5786 },
        subject_position: null,
        gps_accuracy_m: 4,
        photo: null,
      });
    }
  });

  it('files an unset facing rather than the car\'s heading, twice running', async () => {
    // THE STATIONARY CASE: a driver pulled over beside the camera, heading
    // unchanged between reports. This used to be the case that proved the
    // re-seed worked; it now proves the opposite invariant - that a bearing
    // nobody set never reaches the signed evidence.
    lock(223);
    await mount();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    expect(screen.getByText('FACING · NOT SET YET')).toBeInTheDocument();
    expect(screen.queryByText('FACING · FROM COMPASS')).toBeNull();

    const dial = screen.getByRole('slider', { name: 'camera facing' });
    expect(dial).toHaveAttribute('data-fwm-report-facing', 'unset');
    // No wedge, because there is no bearing to draw. Drawing one at 0 would
    // point every unset report due north.
    expect(document.querySelector('.fwm-report-dial-wedge')).toBeNull();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('2 REPORTS QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    const disk = await stored();
    expect(disk.payloads.map((payload) => payload['facing_deg'])).toEqual([null, null]);
    expect(disk.payloads.map((payload) => payload['facing_source'])).toEqual([null, null]);
    expect(disk.verified).toBe(true);
  });

  it('does not leak a hand-set bearing into the next report', async () => {
    // The invariant that survives the redesign unchanged, and the one that
    // actually matters: what the driver said about THIS camera must not become
    // a silent claim about the next one.
    lock(223);
    await mount();

    const dial = screen.getByRole('slider', { name: 'camera facing' });
    await act(async () => {
      fireEvent.keyDown(dial, { key: 'PageUp' });
    });
    expect(screen.getByText('FACING · SET BY HAND')).toBeInTheDocument();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    // Back to unset - not to the sensor, and not to the last driver's tap.
    expect(screen.getByText('FACING · NOT SET YET')).toBeInTheDocument();

    const disk = await stored();
    expect(disk.payloads[0]).toMatchObject({ facing_deg: 15, facing_source: 'manual' });
  });

  it('still opens unset after a submit when the device never had a heading', async () => {
    lock(null);
    await mount();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    expect(screen.getByText('FACING · NOT SET YET')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'camera facing' })).toHaveAttribute(
      'data-fwm-report-facing',
      'unset',
    );
    const disk = await stored();
    expect(disk.payloads[0]).toMatchObject({ facing_deg: null, facing_source: null });
  });

  it('empties the sheet after filing, so the next report is not a copy of the last', async () => {
    lock();
    await mount();

    await tap(screen.getByRole('button', { name: 'TRAILER' }));
    await tap(screen.getByRole('button', { name: 'MAKE / MODEL' }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('MAKE / MODEL'), { target: { value: 'Falcon' } });
    });
    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));

    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    // EVERY part of the reset, because a reset that clears three fields and
    // silently drops a fourth is how a signed record loses one.
    expect(screen.getByRole('button', { name: 'TRAILER' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByLabelText('MAKE / MODEL')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'NEW CAMERA' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The facing is emptied along with everything else now. It used to be
    // re-seeded from the compass, which was the one field the reset deliberately
    // did NOT clear - and that only made sense while the compass was considered
    // a legitimate source for it.
    expect(screen.getByText('FACING · NOT SET YET')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'camera facing' })).not.toHaveAttribute(
      'aria-valuenow',
    );

    // And the filed report kept what the driver actually entered.
    const disk = await stored();
    expect(disk.payloads[0]).toMatchObject({ mount: 'trailer', make_model: 'Falcon' });
  });

  it('refuses to file a report with no position, and says which fact is missing', async () => {
    await mount();

    expect(screen.getByText('NO FIX')).toBeInTheDocument();
    expect(screen.getByText('NO POSITION FIX · A REPORT NEEDS ONE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SUBMIT REPORT' })).toBeDisabled();

    await expect(stored()).resolves.toMatchObject({ chainRows: [] });
  });

  it('refuses a report whose MAKE / MODEL is plate-shaped, and keeps the plate off disk', async () => {
    lock();
    await mount();

    await tap(screen.getByRole('button', { name: 'MAKE / MODEL' }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('MAKE / MODEL'), { target: { value: 'HVK 8842' } });
    });

    expect(screen.getByText('MAKE / MODEL LOOKS LIKE A PLATE · NOT QUEUED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SUBMIT REPORT' })).toBeDisabled();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await expect(stored()).resolves.toMatchObject({ chainRows: [] });
  });
});

describe('CONFIRM EXISTING', () => {
  it("names the camera the engine says is nearest and files it against that id", async () => {
    lock();
    ingestAlertTick(tick());
    await mount();

    await tap(screen.getByRole('button', { name: 'CONFIRM EXISTING' }));

    expect(screen.getByText('±4 M · FWM-0442')).toBeInTheDocument();
    // The bearing on record for the camera, not the vehicle's heading.
    expect(screen.getByText('FACING · ON RECORD')).toBeInTheDocument();
    expect(screen.getByText(/221°/)).toBeInTheDocument();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    const disk = await stored();
    expect(disk.payloads[0]).toMatchObject({ kind: 'confirm_existing', camera_id: 'FWM-0442' });
  });

  it('still confirms a MUTED camera: muting silences an alert, it does not delete a camera', async () => {
    lock();
    // Muted, and still in range: the engine keeps counting it either way.
    ingestAlertTick(tick({ nearest: assessment({ muted: true }), globallyMuted: true }));
    await mount();

    await tap(screen.getByRole('button', { name: 'CONFIRM EXISTING' }));

    const sheet = document.querySelector('.fwm-report');
    expect(sheet).toHaveAttribute('data-fwm-report-camera', 'FWM-0442');
    expect(sheet).toHaveAttribute('data-fwm-report-muted', 'true');

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    const disk = await stored();
    expect(disk.payloads[0]).toMatchObject({ camera_id: 'FWM-0442' });
  });

  it('refuses to confirm anything when the engine has nothing nearby', async () => {
    lock();
    await mount();

    await tap(screen.getByRole('button', { name: 'CONFIRM EXISTING' }));

    expect(screen.getByText('NO KNOWN CAMERA NEARBY TO CONFIRM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SUBMIT REPORT' })).toBeDisabled();
  });
});

describe('the shell contract', () => {
  it('renders with no props at all, which is how the screen registry mounts it', async () => {
    lock();
    await act(async () => {
      render(<ReportScreen />);
    });

    expect(screen.getByRole('heading', { name: 'REPORT' })).toBeInTheDocument();
    expect(screen.getByText('39.0997 N · 84.5786 W')).toBeInTheDocument();
  });

  it('says the queue is unreadable instead of showing a count it does not have', async () => {
    const broken: ReportQueuePort = {
      counts: () => Promise.reject(new DatabaseUnavailableError('no IndexedDB here')),
      photosAtCapacity: () => Promise.reject(new DatabaseUnavailableError('no IndexedDB here')),
      submit: () => Promise.reject(new DatabaseUnavailableError('no IndexedDB here')),
      close: () => {},
    };

    lock();
    await act(async () => {
      render(<ReportScreen queue={broken} />);
    });

    await waitFor(() => {
      expect(
        screen.getByText('NO LOCAL STORAGE · NOTHING CAN BE QUEUED HERE'),
      ).toBeInTheDocument();
    });
  });
});

describe('privacy', () => {
  it('never puts a coordinate in the URL, whatever the driver files', async () => {
    lock();
    await mount();
    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));

    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    expect(window.location.search).not.toContain('39.09');
    expect(window.location.href).not.toContain('84.57');
  });

  it("leaves v0's PHOTO tile dark, because v0 has nothing behind it", async () => {
    lock();
    await mount();

    // WAS "because a photo cannot be stripped of its location yet". That reason
    // died with `preparePhoto()`: photographs ARE attachable now, on
    // `ReportViewV1`, which is the view the build routes to. `DetailTiles` is
    // v0's layout and no handler is wired to this tile, so it stays disabled -
    // a fact about v0's plumbing, not about EXIF.
    const photo = screen.getByRole('button', { name: /^PHOTO - / });
    expect(photo).toBeDisabled();
    expect(photo).toHaveAttribute('data-fwm-report-capture', 'unavailable');
  });
});

/**
 * THE VIEW THE BUILD SHIPS.
 *
 * `registry.v1.tsx:107` routes `report` to `ReportV1Screen` -> `ReportViewV1`.
 * Nothing above this block mounts it: every other test renders the default v0
 * view, whose `ModeToggle` disables the mode buttons only when no handler is
 * supplied. v1 added its own gate and got it wrong, and no test could see it
 * because no test rendered v1 through the screen.
 *
 * These press the control a driver presses. A test that calls `setDraft` or
 * passes `initialMode: 'confirm'` cannot catch a control that refuses to change
 * the mode, which is exactly what shipped.
 */
describe('ReportViewV1 - the routed view', () => {
  it('lets a driver reach CONFIRM by pressing the tab, with a camera nearby', async () => {
    lock();
    ingestAlertTick(tick()); // FWM-0442, in range
    await mountV1();

    const confirm = screen.getByRole('radio', { name: 'Confirm one' });

    // THE REGRESSION. `cameraId` was `mode === 'confirm' ? nearest.id : null`,
    // and this tab was disabled on `cameraId === null`. Starting in `new` made
    // it null, disabled, unpressable, and therefore null forever - with a
    // camera 500 ft away and the map showing it.
    expect(confirm).not.toBeDisabled();

    await tap(confirm);

    expect(confirm).toHaveAttribute('aria-checked', 'true');
    expect(document.querySelector('.fwm-reportv1')).toHaveAttribute(
      'data-fwm-report-camera',
      'FWM-0442',
    );
  });

  it('files the confirmation against the nearest id, end to end', async () => {
    lock();
    ingestAlertTick(tick());
    await mountV1();

    await tap(screen.getByRole('radio', { name: 'Confirm one' }));
    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));

    await waitFor(async () => {
      const disk = await stored();
      expect(disk.payloads[0]).toMatchObject({
        kind: 'confirm_existing',
        camera_id: 'FWM-0442',
      });
    });
  });

  it('says WHY the tab is dead when there is genuinely nothing to confirm', async () => {
    lock();
    ingestAlertTick(tick({ nearest: null, state: 'clear', cameras: [] }));
    await mountV1();

    // The note used to be behind `draft.mode === 'confirm'`, a branch the
    // disabled tab prevented anybody from reaching. The control was inert and
    // the explanation for it was unreachable, so the sheet just looked broken.
    expect(screen.getByText(NOTHING_TO_CONFIRM)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Confirm one' })).toBeDisabled();
  });

  it('still files a NEW camera, which must not carry a nearby id', async () => {
    lock();
    ingestAlertTick(tick());
    await mountV1();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));

    await waitFor(async () => {
      const disk = await stored();
      expect(disk.payloads[0]).toMatchObject({ kind: 'new_camera', camera_id: null });
    });
  });
});

/**
 * CAN A REPORT FILED ON THE SHIPPED SHEET EVER REACH OPENSTREETMAP?
 *
 * Until this block, no. `ReportViewV1` did not render `WhereChips`, which is
 * the only control that sets `side`/`offsetFt`, which is what `projectSubject`
 * turns into `subject_position`. Without it every payload carried
 * `subject_position: null`, and `osmBlocker` returns `'no-subject-position'`
 * for exactly that - so 100% of real reports were structurally unpublishable
 * and the v2 schema split that separated the observer from the subject was
 * dead on the routed view.
 *
 * The v0 tests could not see it: they mount `ReportView`, which does render the
 * chips. Third instance today of the same shape - a control covered in the view
 * the build does not ship.
 */
describe('the OSM path, from the sheet a driver actually gets', () => {
  it('is BLOCKED when the driver says nothing about where the camera was', async () => {
    lock();
    ingestAlertTick(tick());
    await mountV1();

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));

    // ONE read of disk, after the queue has settled. Reading it inside the
    // waitFor and again afterwards made this flaky: the two reads are separate
    // transactions and the second could land before the first had committed,
    // so the test failed in a full suite run and passed in isolation.
    await waitFor(async () => {
      expect((await stored()).payloads).toHaveLength(1);
    });
    const disk = await stored();

    expect(disk.payloads[0]).toMatchObject({ subject_position: null });
    expect(osmBlocker((disk.payloads[0] ?? null) as never)).toBe('no-subject-position');
  });

  it('is OPEN once they press a side and an offset, which is what the chips are for', async () => {
    lock();
    ingestAlertTick(tick());
    await mountV1();

    // The exact controls that were unreachable. If WhereChips stops being
    // rendered, these queries fail and this test says why.
    // Buttons in a role="group", not radios: the header on WhereChips explains
    // that role="radio" cannot express "none of them", and none-of-them is the
    // state the sheet opens in.
    await tap(screen.getByRole('button', { name: 'RIGHT' }));
    await tap(screen.getByRole('button', { name: 'ONE LANE OVER' }));

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));

    await waitFor(async () => {
      expect((await stored()).payloads).toHaveLength(1);
    });
    const disk = await stored();

    expect(disk.payloads[0]?.['subject_position']).not.toBeNull();
    // The camera is NOT where the driver was - that was the v1 bug the schema
    // split exists to prevent, and this is the assertion that proves it.
    expect(disk.payloads[0]).toMatchObject({ subject_position_source: 'projected' });
    expect(osmBlocker((disk.payloads[0] ?? null) as never)).toBeNull();
  });
});


/**
 * ONE PHOTOGRAPH, HASHED INTO THE SIGNED PAYLOAD, HELD IN A SECOND STORE.
 *
 * Every assertion below reads the database back through a second connection.
 * The digest in the payload is recomputed here from the bytes on disk with the
 * same `sha256Hex` the evidence chain uses, so a screen that hashed the wrong
 * thing - the camera's original file instead of the prepared one, say - fails
 * here rather than shipping a record naming bytes nobody has.
 *
 * WHAT THESE DO NOT PROVE: that the metadata is gone. That is `preparePhoto`'s
 * job, it needs a real decoder, and it is proven in `e2e/preparePhoto.spec.ts`.
 */
describe('attaching a photograph', () => {
  it('signs the digest of the prepared bytes into the payload and stores the bytes beside it', async () => {
    vi.mocked(preparePhoto).mockResolvedValue(preparedPhoto());
    lock();
    await mountWithCamera(source());

    await tapAttach();
    await waitFor(() => {
      expect(photoState()).toBe('attached');
    });

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(async () => {
      expect((await stored()).payloads).toHaveLength(1);
    });

    const disk = await stored();
    const payload = disk.payloads[0];
    // The digest, independently computed from the bytes this test supplied.
    const expected = await sha256Hex(crypto.subtle, PHOTO_BYTES);
    expect(payload?.['photo']).toBe(expected);
    // 64 lowercase hex characters, the shape every other hash in this app has.
    expect(payload?.['photo']).toMatch(/^[0-9a-f]{64}$/);
    // Still a real signature over a payload that now carries a photo digest.
    expect(disk.verified).toBe(true);

    const reportId = disk.chainRows[0]?.reportId ?? '';
    const row = await storedPhoto(reportId);
    expect(row).not.toBeNull();
    expect(row?.sha256).toBe(expected);
    expect(row?.bytes).toEqual(Array.from(PHOTO_BYTES));
    expect(row?.mimeType).toBe('image/jpeg');
    expect(row?.width).toBe(1600);

    // The bytes are in `reportPhotos` and NOWHERE ELSE. A signed record is
    // frozen at signing time and diffed field by field; image data in there
    // would be both meaningless to compare and unaffordable.
    expect(JSON.stringify(payload)).not.toContain('255,216');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('files with photo null when nothing was attached, exactly as before', async () => {
    lock();
    await mountWithCamera(source());

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(async () => {
      expect((await stored()).payloads).toHaveLength(1);
    });

    const disk = await stored();
    expect(disk.payloads[0]?.['photo']).toBeNull();
    expect(await storedPhoto(disk.chainRows[0]?.reportId ?? '')).toBeNull();
  });

  it('goes quietly back to nothing when the driver backs out of the camera', async () => {
    lock();
    await mountWithCamera(source(null));

    await tapAttach();

    // Not `rejected`. Closing the camera app is an ordinary thing to do and
    // telling somebody their photo was refused for doing it would be a lie.
    await waitFor(() => {
      expect(photoState()).toBe('none');
    });
    // `preparePhoto` is never reached: there is nothing to prepare.
    expect(vi.mocked(preparePhoto)).not.toHaveBeenCalled();
  });

  it('refuses a file it cannot read, and the report is still filable', async () => {
    // Null is what `preparePhoto` returns for an undecodable file AND for a
    // runtime with no canvas, indistinguishably. One state covers both.
    vi.mocked(preparePhoto).mockResolvedValue(null);
    lock();
    await mountWithCamera(source());

    await tapAttach();
    await waitFor(() => {
      expect(photoState()).toBe('rejected');
    });
    expect(screen.getByRole('alert')).toHaveTextContent(PHOTO_ISSUE.unreadable);

    // THE POINT OF THE WHOLE STATE. A refused photo is not a submit blocker:
    // the camera on the pole is still worth reporting.
    expect(screen.getByRole('button', { name: 'SUBMIT REPORT' })).toBeEnabled();
    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(async () => {
      expect((await stored()).payloads).toHaveLength(1);
    });
    expect((await stored()).payloads[0]?.['photo']).toBeNull();
  });

  it('refuses a photo that came out over the byte ceiling', async () => {
    // `preparePhoto` returns an oversized file rather than degrading it past
    // MIN_QUALITY, and reports the size so the caller can refuse. This is the
    // caller refusing.
    vi.mocked(preparePhoto).mockResolvedValue(preparedPhoto({ sizeBytes: MAX_BYTES + 1 }));
    lock();
    await mountWithCamera(source());

    await tapAttach();
    await waitFor(() => {
      expect(photoState()).toBe('rejected');
    });
    expect(screen.getByRole('alert')).toHaveTextContent(PHOTO_ISSUE['too-big']);
  });

  it('refuses at the cap rather than deleting a photograph to make room', async () => {
    vi.mocked(preparePhoto).mockResolvedValue(preparedPhoto());
    const full: ReportQueuePort = {
      ...(port as ReportQueuePort),
      photosAtCapacity: () => Promise.resolve(true),
    };
    lock();
    await mountWithCamera(source(), full);

    await tapAttach();
    await waitFor(() => {
      expect(photoState()).toBe('rejected');
    });
    expect(screen.getByRole('alert')).toHaveTextContent(PHOTO_ISSUE['no-room']);

    // `reportPhotos` is eviction-exempt: evicting one would leave a signed
    // record citing a digest whose bytes the app itself removed unasked. So the
    // new photo is refused and the report files without it.
    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(async () => {
      expect((await stored()).payloads).toHaveLength(1);
    });
    expect((await stored()).payloads[0]?.['photo']).toBeNull();
  });

  it('revokes the preview URL when the photograph is removed, and files photo null', async () => {
    // A leaked object URL pins the whole blob in memory for the life of the
    // document. `ReportScreen` owns the URL precisely so there is one revoke.
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const create = vi.spyOn(URL, 'createObjectURL');
    vi.mocked(preparePhoto).mockResolvedValue(preparedPhoto());
    lock();
    await mountWithCamera(source());

    await tapAttach();
    await waitFor(() => {
      expect(photoState()).toBe('attached');
    });
    // The thumbnail is rendering the object URL the container owns, which is the
    // thing being revoked below.
    const thumb = document.querySelector('[data-fwm-report-photo="attached"] img');
    const url = create.mock.results[0]?.value as string;
    expect(thumb?.getAttribute('src')).toBe(url);

    await tap(screen.getByRole('button', { name: PHOTO_REMOVE_LABEL }));
    expect(photoState()).toBe('none');
    // The one the thumbnail was showing, not merely one call: revoking some
    // other URL would leak this blob for the life of the document and blank a
    // live thumbnail somewhere else.
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(url);

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(async () => {
      expect((await stored()).payloads).toHaveLength(1);
    });
    expect((await stored()).payloads[0]?.['photo']).toBeNull();
  });

  it('clears the attachment after filing, so the next report does not carry it', async () => {
    vi.mocked(preparePhoto).mockResolvedValue(preparedPhoto());
    lock();
    await mountWithCamera(source());

    await tapAttach();
    await waitFor(() => {
      expect(photoState()).toBe('attached');
    });
    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(photoState()).toBe('none');
    });

    // The same picture left attached would be filed a second time under a
    // second report id, with nothing in either record able to say they are one
    // photograph.
    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(async () => {
      expect((await stored()).payloads).toHaveLength(2);
    });
    const disk = await stored();
    expect(disk.payloads[1]?.['photo']).toBeNull();
    expect(await storedPhoto(disk.chainRows[1]?.reportId ?? '')).toBeNull();
  });

  it('says the report was filed without its picture rather than reporting a failed submit', async () => {
    vi.mocked(preparePhoto).mockResolvedValue(preparedPhoto());
    const real = port as ReportQueuePort;
    const photoWriteFails: ReportQueuePort = {
      ...real,
      submit: async (payload, photo) => {
        const receipt = await real.submit(payload, photo);
        return { ...receipt, photoStored: false };
      },
    };
    lock();
    await mountWithCamera(source(), photoWriteFails);

    await tapAttach();
    await waitFor(() => {
      expect(photoState()).toBe('attached');
    });
    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));

    // The report IS filed by the time the photo write is attempted. Calling it
    // a failed submit would send a driver back to file the same camera twice.
    await waitFor(() => {
      expect(screen.getByText(PHOTO_NOT_STORED)).toBeInTheDocument();
    });
    expect((await stored()).payloads).toHaveLength(1);
  });

  it('queues nothing at all when the payload and the bytes name different photographs', async () => {
    // The guard runs before the first write, so a wiring slip is loud and
    // total rather than producing a signed record naming bytes it never got.
    const queue = port as ReportQueuePort;
    const payload = reportPayload(
      emptyDraft(),
      { cameraId: null, lat: 39.0997, lon: -84.5786, accuracyM: 4, satellites: null },
      'f'.repeat(64),
    );

    await expect(
      queue.submit(payload, {
        sha256: '0'.repeat(64),
        bytes: PHOTO_BYTES,
        mimeType: 'image/jpeg',
        sizeBytes: PHOTO_BYTES.byteLength,
        width: 1600,
        height: 1200,
      }),
    ).rejects.toThrow(PhotoDigestMismatchError);

    expect((await stored()).payloads).toHaveLength(0);
    expect((await stored()).chainRows).toHaveLength(0);
  });
});


/**
 * THE SHEET A DRIVER ACTUALLY SEES.
 *
 * Everything here mounts `ReportViewV1` through `ReportScreen` - the view
 * `app/registry.v1.tsx` routes to - and presses the controls by their printed
 * labels. Three separate bugs have shipped from adding an affordance to
 * `ReportView` (v0), which the build does not render, and proving it with a
 * test that mounted v0 as well.
 */
describe("the sheet's photo tile", () => {
  it('offers one photograph, at rest, on the shipped sheet', async () => {
    lock();
    await mountV1();

    const tile = screen.getByRole('button', { name: PHOTO_ADD_LABEL });
    expect(tile).toBeEnabled();
    expect(photoState()).toBe('none');
    // Optional, and it must look it: a photograph has never been a submit
    // blocker and `submitBlocker()` has never heard of one.
    expect(screen.getByRole('button', { name: 'SUBMIT REPORT' })).toBeEnabled();
  });

  it('says PREPARING while the encode runs, and stays pressable', async () => {
    // `preparePhoto()` decodes a 12 MP image and runs up to four full JPEG
    // encodes down the quality ladder - seconds on a mid-range phone. A tile
    // that still reads ADD A PHOTO through all of that is one a driver taps
    // four times, which is four pickers and four races into one slot.
    let release: (photo: CapturedPhoto | null) => void = () => {};
    const slow: PhotoSourcePort = {
      pick: () =>
        new Promise<CapturedPhoto | null>((resolve) => {
          release = resolve;
        }),
    };
    lock();
    await mountWithCamera(slow);

    await tap(screen.getByRole('button', { name: PHOTO_ADD_LABEL }));

    expect(photoState()).toBe('preparing');
    // RELABELLED BUT NOT DISABLED. This asserted `toBeDisabled()` when it was
    // written, which pinned a defect: `cameraCapture.capture()` settles on
    // `change`, `cancel`, `abort()` or a superseding `capture()`, and `cancel`
    // is not universal on `<input type=file>`. On a browser that does not fire
    // it, a driver who backs out of the picker settles nothing - and with the
    // control disabled the supersede route was closed too, so the tile read
    // PREPARING... forever and ADD A PHOTO was dead until the sheet was closed
    // and reopened. A second tap is safe because `attachPhoto` bumps a
    // generation and the earlier encode drops its own result.
    expect(screen.getByRole('button', { name: PHOTO_PREPARING_LABEL })).toBeEnabled();
    expect(screen.queryByRole('button', { name: PHOTO_ADD_LABEL })).toBeNull();

    await act(async () => {
      release(null);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(photoState()).toBe('none');
    });
  });

  it('draws the thumbnail, the facts and a way back out once one is attached', async () => {
    // 412 KB exactly, so the printed figure cannot come out right by rounding.
    const sizeBytes = 412 * 1024;
    vi.mocked(preparePhoto).mockResolvedValue(preparedPhoto({ sizeBytes }));
    lock();
    await mountWithCamera(source());

    await tapAttach();
    await waitFor(() => {
      expect(photoState()).toBe('attached');
    });

    // METADATA REMOVED is a statement of fact, not a hope: `metadataStripped`
    // is the literal type `true`, and only the re-encoded file reaches disk.
    expect(screen.getByText('1600 × 1200 · 412 KB · METADATA REMOVED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PHOTO_REMOVE_LABEL })).toBeEnabled();
    // Decorative: it is the driver's own photograph from a second ago, and the
    // facts line beside it carries everything a screen reader needs.
    const thumb = document.querySelector('[data-fwm-report-photo="attached"] img');
    expect(thumb?.getAttribute('alt')).toBe('');
    expect(thumb?.getAttribute('src')).toMatch(/^blob:/);
  });

  it('never prints 0 KB for a file that exists', async () => {
    // Rounded up. A photograph the driver is being asked to carry in an
    // unsynced queue must not be reported as weighing nothing.
    expect(
      photoFacts({ state: 'attached', previewUrl: '', width: 1600, height: 1200, sizeBytes: 1, sha256: '' }),
    ).toContain('1 KB');
  });

  it('says why a photograph was refused, and leaves the tile pressable', async () => {
    vi.mocked(preparePhoto).mockResolvedValue(null);
    lock();
    await mountWithCamera(source());

    await tapAttach();
    await waitFor(() => {
      expect(photoState()).toBe('rejected');
    });

    // A code painted on a border is what v0 does for a rejected make and model,
    // and it leaves a driver retrying the identical thing. The sentence names
    // the fix.
    expect(screen.getByRole('alert')).toHaveTextContent(PHOTO_ISSUE.unreadable);
    expect(screen.getByRole('button', { name: PHOTO_ADD_LABEL })).toBeEnabled();
  });

  it('prints a promise that is true of a build which stores photographs', async () => {
    lock();
    await mountV1();

    expect(screen.getByText(PRIVACY_NOTE)).toBeInTheDocument();

    // THE TWO CLAUSES THAT HAD TO GO, asserted as absent rather than left to a
    // reader of the constant.
    //
    // "are sent" promised a transmission that has never existed - there is no
    // `fetch` in `reportQueue.ts` - and "no record of you having been here"
    // stopped being true the moment a photograph of a real place went to disk.
    expect(PRIVACY_NOTE).not.toContain('are sent');
    expect(PRIVACY_NOTE).not.toContain('no record of you');
    expect(PRIVACY_NOTE).toContain('nothing is uploaded');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * TWO WAYS AN IN-FLIGHT ENCODE COULD REACH THE WRONG REPORT.
 *
 * Preparing a photograph is asynchronous and SUBMIT REPORT stays pressable
 * throughout, on purpose: a camera is still worth filing without a picture. So
 * an encode can outlive the report it was started for, and both of these were
 * reachable before `photoGeneration` existed.
 */
describe('a photograph belongs to the report it was taken for', () => {
  /** A camera whose pick resolves only when the test says so. */
  function deferredSource(): {
    readonly port: PhotoSourcePort;
    release(): void;
  } {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    return {
      port: {
        pick: async () => {
          await gate;
          return capturedPhoto();
        },
      },
      release: () => {
        release();
      },
    };
  }

  it('does NOT attach to the next report when the encode finishes after a submit', async () => {
    // The proven failure: report 1 files with no photo, the encoder resolves
    // onto the empty sheet, and report 2 is SIGNED carrying a picture of the
    // camera on the previous street.
    lock();
    const camera = deferredSource();
    await mountWithCamera(camera.port);

    await tap(screen.getByRole('button', { name: PHOTO_ADD_LABEL }));
    expect(photoState()).toBe('preparing');

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(() => {
      expect(screen.getByText('1 REPORT QUEUED · SYNC ON WIFI')).toBeInTheDocument();
    });

    // The encoder comes back for a report that has already been filed.
    await act(async () => {
      camera.release();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(photoState()).toBe('none');

    await tap(screen.getByRole('button', { name: 'SUBMIT REPORT' }));
    await waitFor(async () => {
      expect((await stored()).payloads).toHaveLength(2);
    });

    const disk = await stored();
    expect(disk.payloads.map((payload) => payload['photo'])).toEqual([null, null]);
  });

  it('bumps the generation on REMOVE, though the sheet cannot reach that state today', () => {
    // Written down rather than tested through the UI, because it is not
    // reachable through the UI: `ReportViewV1` draws REMOVE only in the
    // `attached` state (`:323`), and by then the encode has finished. The bump
    // in `removePhoto` is defence for the day the sheet lets a driver remove
    // while one is still running - it costs one integer and it is the same
    // class of bug as the submit case above, which WAS reachable.
    expect(PHOTO_REMOVE_LABEL).toBe('REMOVE');
  });

  it('leaves ADD A PHOTO pressable while preparing, so a picker that never settles can be superseded', async () => {
    // `cancel` on <input type=file> is not universal. Disabling the button
    // during `preparing` closed the only escape and stranded the sheet on
    // PREPARING... until it was closed and reopened.
    lock();
    const stuck: PhotoSourcePort = { pick: async () => new Promise(() => undefined) };
    await mountWithCamera(stuck);

    await tap(screen.getByRole('button', { name: PHOTO_ADD_LABEL }));
    expect(photoState()).toBe('preparing');
    // Same control, relabelled - so it is queried by the label it now carries.
    expect(screen.getByRole('button', { name: PHOTO_PREPARING_LABEL })).toBeEnabled();
  });
});
