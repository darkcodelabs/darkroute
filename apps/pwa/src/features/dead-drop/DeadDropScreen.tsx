/**
 * DEAD DROP -- the signed queue, and the chain that proves its order.
 *
 * =============================================================================
 * THIS FILE IS WIRING. IT IS NOT A MOCK, AND IT IS NOT A CRYPTO IMPLEMENTATION.
 * =============================================================================
 * Every hash, every link and every signature on this screen was produced at
 * filing time by `services/crypto/chain.ts` and written by
 * `services/db/repositories/`. This file:
 *
 *   - hashes nothing, signs nothing and links nothing. It reads the queue back
 *     and asks `verifyChain()` whether it still holds.
 *   - calls no browser API. No `navigator`, no `fetch`, no clipboard, no share,
 *     no permission prompt -- on mount or ever. The only platform call in the
 *     subtree is `Date.now()`, injectable through the `now` prop, used for the
 *     age of a drop and for the export's own timestamp.
 *   - renders no drop it was not given. An empty queue says it is empty, a
 *     database that will not open says so, and neither draws a placeholder.
 *
 * =============================================================================
 * WHAT DEAD DROP OWNS THAT NOTHING ELSE DOES
 * =============================================================================
 * The export. `buildEvidenceExport()` writes the canonical form the chain
 * verifies against -- records verbatim, serialised with
 * `fwm-canonical-json/v1` -- so an export can be re-verified by somebody who
 * does not have this device. That is the whole point of a hash chain that is
 * held offline for weeks, and this screen is where it becomes reachable.
 *
 * =============================================================================
 * NOTHING LEAVES THE DEVICE FROM HERE
 * =============================================================================
 * Send and `EXPORT JSON` are injected handlers. There is no upload path
 * behind either of them in this file, no `console` call anywhere on the path,
 * and nothing written to the URL -- `screenState` carries a screen id and never
 * a payload, which is why a drop's coordinates cannot reach the query string.
 * The export bytes are handed to the caller; they are not sent, copied or
 * stored by anything here.
 * GAP: see docs/gaps-inbox/dead-drop.md#export-json-has-no-sink-on-this-device
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { syncActions } from '../../stores';
import type { QueuedDrop } from '../../stores';

import { DeadDropView } from './components/DeadDropView.tsx';
import { createDeadDropPort, describeLoadFailure } from './deadDropQueue.ts';
import type { DeadDropPort, DeadDropSnapshot } from './deadDropQueue.ts';
import { loadingModel, readyModel, unavailableModel } from './deadDropModel.ts';
import type { DeadDropViewModel } from './deadDropModel.ts';
import { buildEvidenceExport } from './evidenceExport.ts';
import type { EvidenceExportBundle } from './evidenceExport.ts';
import { hasPhoto, dropCameraId } from './format.ts';

import './dead-drop.css';

export interface DeadDropScreenProps {
  /**
   * Where the queue is read from. Defaults to this install's own database.
   * Injected by tests, which open a database of their own and sign with the
   * sanctioned harness in `services/crypto/testing.ts`.
   */
  readonly port?: DeadDropPort | undefined;
  /** Injectable clock. Drop ages and the export's `exported_at`. */
  readonly now?: (() => number) | undefined;
  /**
   * Drain the queue. Absent means "not wired in this build" and the key
   * renders disabled: this screen may not open a network path.
   */
  readonly onSyncNow?: (() => void) | undefined;
  /**
   * Receive the export. Absent means the key renders disabled -- see the gap
   * note. The bundle is built either way only when this fires, so a screen with
   * no handler never serialises a payload it has nowhere to put.
   */
  readonly onExport?: ((bundle: EvidenceExportBundle) => void) | undefined;
}

/**
 * The queue, as the sync slice publishes it to the rest of the app.
 *
 * No payload, no hash, no signature -- `QueuedDrop` is deliberately shaped that
 * way and this is the one place DEAD DROP writes to it, so the dock badge and
 * this screen can never disagree about how many drops are held.
 *
 * `label` is the camera the report names, or null. It is never a street name:
 * there is none on this device and producing one would mean geocoding the
 * driver's exact position.
 *
 * `stores/sync.ts` still documents that field as `"Vine St", "I-71 ramp" - a
 * place, from the report's own camera record`, and nothing on this device can
 * produce that. What this screen writes is a public camera id (`FWM-0442`), so
 * the shared contract says one thing and its only writer does another. The
 * comment on the shared field is not this feature's to edit; the divergence is
 * written down instead, and any consumer that renders `label` as a place will
 * print a camera id until it is fixed at the source.
 * GAP: see docs/gaps-inbox/dead-drop.md#queueddrop-label-carries-a-camera-id-not-a-place
 * GAP: see docs/gaps-inbox/dead-drop.md#place-names-cannot-be-produced-without-a-geocoder
 */
function publishedDrops(snapshot: DeadDropSnapshot): readonly QueuedDrop[] {
  return snapshot.drops
    .map((drop): QueuedDrop => {
      const payload = drop.body?.payload ?? null;
      return {
        reportId: drop.row.reportId,
        label: dropCameraId(payload),
        capturedAt: drop.row.capturedAt,
        syncState: drop.row.syncState,
        attempts: drop.row.attempts,
        hasPhoto: hasPhoto(payload),
        nextAttemptAtMs: drop.row.nextAttemptAt,
      };
    })
    .reverse();
}

export function DeadDropScreen({
  port,
  now = Date.now,
  onSyncNow,
  onExport,
}: DeadDropScreenProps = {}): ReactElement {
  // Created once. A caller that supplies a port owns its lifetime; a port this
  // screen created is closed when the screen goes away.
  const [ownedPort] = useState<DeadDropPort | null>(() =>
    port === undefined ? createDeadDropPort() : null,
  );
  const active = port ?? ownedPort;

  const [snapshot, setSnapshot] = useState<DeadDropSnapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const snapshotRef = useRef<DeadDropSnapshot | null>(null);

  useEffect(() => {
    if (ownedPort === null) return undefined;
    return () => {
      ownedPort.close();
    };
  }, [ownedPort]);

  // Read the queue once, from disk. Every number on this screen is measured
  // rather than remembered, and the sync slice is told what was measured so the
  // dock badge agrees with the header.
  useEffect(() => {
    if (active === null) return undefined;
    let cancelled = false;
    void active
      .load()
      .then((loaded) => {
        if (cancelled) return;
        snapshotRef.current = loaded;
        setSnapshot(loaded);
        syncActions.setCounts(loaded.counts);
        syncActions.setDrops(publishedDrops(loaded));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(describeLoadFailure(error));
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  /**
   * Serialise on the press, never before. A build with no handler wired never
   * builds the bytes at all, which is the strongest form of "nothing is
   * uploaded that the design does not say is uploaded".
   */
  const handleExport = useCallback((): void => {
    const loaded = snapshotRef.current;
    if (onExport === undefined || loaded === null || loaded.exportable.length === 0) return;
    // The RUNS, not the flat array: a purge can leave a hole in the middle of
    // the bodies, and a document that did not say where the holes are would
    // fail `verifyChain` with `broken-link` on evidence that is intact.
    onExport(buildEvidenceExport(loaded.runs, now()));
  }, [onExport, now]);

  // Recomputed on every render on purpose: `HELD · 41 MIN` is an age, and an
  // age memoised against a stale clock stops counting.
  const model: DeadDropViewModel =
    failure !== null
      ? unavailableModel(failure)
      : snapshot === null
        ? loadingModel()
        : readyModel(snapshot, now());

  return (
    <DeadDropView
      model={model}
      onSyncNow={onSyncNow}
      onExport={onExport === undefined ? undefined : handleExport}
    />
  );
}
