/**
 * INTEL CARD -- one camera, everything this device honestly knows about it.
 *
 * =============================================================================
 * THIS FILE IS WIRING
 * =============================================================================
 * Every value below arrives from a store selector, and every store selector is
 * a cached output of the engine in `@fwm/core` or of an adapter that
 * capability-detected first. Like `RadarScreen.tsx` and the SWEEP component
 * library it embeds,
 * this file:
 *
 *   - calls no browser API on mount. The share and clipboard adapters are
 *     constructed, which is inert; nothing is invoked outside a tap.
 *   - does no geospatial arithmetic. Distance, bearing and facing arrive
 *     already measured.
 *   - fetches nothing. `CONFIRM STILL THERE` and `DISPUTE` write one row to
 *     IndexedDB and stop; sending is the sync layer's job and its schedule.
 *   - renders no camera it was not given. With nothing selected the card says
 *     so instead of drawing a plausible one.
 *
 * =============================================================================
 * IT IS BOTH A SCREEN AND AN OVERLAY
 * =============================================================================
 * `app/screenState.ts` reserves the `intel` id AND a `modal` overlay kind. The
 * card is normally raised from a SWEEP dot as a modal ({@link openIntelCard});
 * a deep link can also ask for `?screen=intel` directly, which is why the
 * empty state exists. The same zero-prop component serves both registries --
 * the shell decides which, this file does not care.
 *
 * =============================================================================
 * PRIVACY
 * =============================================================================
 * There is no plate on this screen and no path to one: `openIntelCard` writes
 * a camera id into the cameras slice and the overlay carries only an id and a
 * kind, because "a URL is copied into browser history, synced across devices,
 * and pasted into chats". Nothing here logs, and the share body is built by
 * `shareText()`, which drops the driver's own read count and every distance.
 *
 * =============================================================================
 * MUTED CAMERAS DO NOT DISAPPEAR
 * =============================================================================
 * Nothing in this file filters, hides or short-circuits on `muted`. A silenced
 * camera keeps its card, its facts, its actions and its place in the tallies;
 * muting reaches the view as a hue, an `aria-pressed` and a countdown, and
 * `MUTE THIS ONE` toggles the per-camera list only.
 *
 * =============================================================================
 * `MUTE THIS ONE` IS A TIMER, AND THE CARD READS THE TIMER
 * =============================================================================
 * `muteCamera()` writes an expiry timestamp -- `DEFAULT_MUTE_DURATION_MS`, ten
 * minutes, which is the design's own rule ("long-press = mute 10 min"). Ten
 * minutes later the mute lapses on its own and the camera alerts again.
 *
 * So this file does NOT ask the alert slice whether the id is in its muted
 * list: that list is a snapshot recomputed on an engine tick, and between ticks
 * it can outlive the timer it describes. It reads the mute's own expiry out of
 * the settings slice and subtracts its injected clock, which makes both the
 * key's pressed state and the countdown the card prints exact at every render,
 * and makes them impossible to disagree with each other.
 * GAP: docs/gaps-inbox/intel.md#mute-this-one-is-a-ten-minute-timer
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';

import { DEFAULT_SCREEN } from '../../app/screenState.ts';
import { useOverlayDismiss } from '../../components/overlay/useOverlayDismiss.ts';
import { navigationActions } from '../../stores';
import {
  alertActions,
  camerasActions,
  useAlertLog,
  useCachedCameras,
  useCameraAssessments,
  useGpsStatus,
  useIsMuted,
  useLocationPermission,
  useMutePierced,
  useSelectedCameraId,
  useSettingsStore,
} from '../../stores';
import type { AlertState, Overlay } from '../../stores';
import { createClipboardAdapter } from '../../services/adapters/clipboard.ts';
import type { ClipboardAdapter } from '../../services/adapters/clipboard.ts';
import { createShareAdapter } from '../../services/adapters/share.ts';
import type { ShareAdapter } from '../../services/adapters/share.ts';
import { gazetteer } from '../../services/cameras/gazetteer.ts';
import { resolveRadarState } from '../radar';

import { canUseGeoHandoff, navigateTo } from '../../services/adapters/navigateTo.ts';
import { IntelView } from './components/IntelView.tsx';
import type { IntelViewProps } from './components/IntelView.tsx';
import { createIntelQueue } from './intelActions.ts';
import type { IntelQueuePort, IntelStatement } from './intelActions.ts';
import { currentMap } from '../map/mapRegistry.ts';
import { streetAt } from '../map/streetAt.ts';
import { READ_WINDOW_DAYS, intelModel, intelReads, shareText } from './intelState.ts';
import type { IntelActionOutcome, IntelViewModel, OperatorRecord } from './intelState.ts';

import './intel.css';

/**
 * The overlay SWEEP raises. `modal`, because `A4` is a modal over the dial and
 * not a sheet the driver can leave half-open.
 *
 * The id is the screen id, so the shell can register one component against
 * both registries without a second name to keep in sync.
 */
export const INTEL_OVERLAY: Overlay = Object.freeze({ id: 'intel', kind: 'modal' });

/**
 * Raise the card for one camera. This is `SweepScreen`'s `onSelectCamera`.
 *
 * The camera id goes into the cameras slice, NOT into the overlay and NOT into
 * the URL: `Overlay` is deliberately payload-free and `?screen=` is the only
 * thing this product writes to a query string.
 */
export function openIntelCard(cameraId: string): void {
  camerasActions.selectCamera(cameraId);
  navigationActions.openOverlay(INTEL_OVERLAY);
}

/** Close it, whether it was raised as a modal or reached as a screen. */
export function closeIntelCard(): void {
  // THREE BRANCHES, THE SAME THREE THE REPORT SHEET UNWINDS THROUGH. Raised
  // over a screen, popping the overlay is the whole job. Reached as a screen,
  // history is. Reached as the ENTRY POINT -- a shared ?screen=intel link --
  // there is no history to pop, and the close key used to be a control that
  // did nothing at all; DRIVE is where that lands now.
  if (
    !navigationActions.closeOverlay(INTEL_OVERLAY.id) &&
    !navigationActions.back()
  ) {
    navigationActions.openScreen(DEFAULT_SCREEN, { replace: true });
  }
  camerasActions.selectCamera(null);
}

export interface IntelScreenProps {
  /** The clock. Injected by tests; the app uses `Date.now`. */
  readonly now?: () => number;
  /**
   * Where `CONFIRM STILL THERE` and `DISPUTE` are written. Injected by tests so
   * they never share the app's queue. `null` renders both keys disabled, which
   * is the honest state for a build with no local storage.
   */
  readonly queue?: IntelQueuePort | null;
  readonly share?: ShareAdapter | null;
  readonly clipboard?: ClipboardAdapter | null;
  /**
   * The B9 flag. There is no aggregation service behind `FEATURES.record` yet,
   * so nothing in this build supplies one and the banner does not draw.
   */
  readonly operatorRecord?: OperatorRecord | null;
  /** Opens RECORD scoped to this operator. Absent hides the sources link. */
  readonly onSeeSources?: (() => void) | undefined;
  /**
   * WHICH VIEW DRAWS THE MODEL.
   *
   * Same seam as `SettingsScreen` and `TriageScreen`. This container owns the
   * gazetteer lookup, the street-off-the-basemap fallback, the queue writes,
   * the clipboard and share adapters and the mute countdown - none of which v1
   * changes. Defaults to v0's view.
   */
  readonly view?: ComponentType<IntelViewProps> | undefined;
}

/**
 * A street name for a record that has none, read off the live basemap.
 *
 * Returns null whenever it is not certain -- no map yet, no roads loaded, or
 * two roads equally close (the frontage-road case). The card prints what it
 * printed before, which is the right failure for a surveillance record.
 */
function streetForRecord(record: { lat: number; lon: number; street?: string } | null): string | null {
  if (record === null || typeof record.street === 'string') return null;
  const map = currentMap();
  if (map === null) return null;
  return streetAt(map, record.lon, record.lat)?.name ?? null;
}

export function IntelScreen({
  now = Date.now,
  queue,
  share,
  clipboard,
  operatorRecord = null,
  onSeeSources,
  view: View = IntelView,
}: IntelScreenProps = {}): ReactElement {
  const canShowInMaps = canUseGeoHandoff();
  // --- which camera --------------------------------------------------------
  const cameraId = useSelectedCameraId();
  /**
   * EVERY WAY OUT OF THE CARD, THROUGH ONE FUNCTION: the close key, and now
   * Escape. Focus goes back to whatever raised it -- the dock, a Look up row,
   * the map canvas -- rather than onto the body. See
   * components/overlay/useOverlayDismiss.ts for the bug that motivates it.
   *
   * v0's card handles Escape itself and marks the event handled, so the two
   * do not both fire. The hook checks defaultPrevented for exactly that.
   */
  const dismiss = useOverlayDismiss(closeIntelCard);


  // --- what the engine and the cache say about it --------------------------
  const assessments = useCameraAssessments();
  const cameras = useCachedCameras();
  const entries = useAlertLog();

  // --- the gates -----------------------------------------------------------
  const gps = useGpsStatus();
  const locationPermission = useLocationPermission();
  const globallyMuted = useIsMuted();
  // The mute timers themselves, not the alert slice's per-tick snapshot of
  // them. A frozen record, replaced whole on every mute change, so this is a
  // stable reference between changes.
  const mutedCameras = useSettingsStore((state) => state.mutedCameras);
  const mutePierced = useMutePierced();

  // --- the ports -----------------------------------------------------------
  // Constructed once. Neither adapter touches a browser API until it is asked
  // to; `start()` is deliberately not called, because a copy and a share are
  // always a user gesture and neither needs arming.
  const ownQueue = useMemo(() => (queue === undefined ? createIntelQueue() : queue), [queue]);
  const shareAdapter = useMemo(
    () => (share === undefined ? createShareAdapter() : share),
    [share],
  );
  const clipboardAdapter = useMemo(
    () => (clipboard === undefined ? createClipboardAdapter() : clipboard),
    [clipboard],
  );

  useEffect(() => () => {
    ownQueue?.close();
  }, [ownQueue]);

  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<IntelActionOutcome | null>(null);

  // A queue write is async and the card can be dismissed mid-flight. Writing
  // state into an unmounted card is a warning in a test and a leak in a car.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // A new camera starts with a clean slate: the previous camera's "DISPUTE
  // QUEUED" must never appear under a card it was not about.
  useEffect(() => {
    setOutcome(null);
  }, [cameraId]);

  /**
   * The cached record for the open camera, at render scope.
   *
   * The model resolves the same row inside its memo, but NAVIGATE needs the
   * raw coordinates and the memo only exposes what the card draws - and the
   * card deliberately draws no coordinate. Reading it once here is cheaper
   * than widening the view model with a position no pixel uses.
   */
  const selected = cameraId === null ? null : (cameras.find((item) => item.id === cameraId) ?? null);

  const model: IntelViewModel | null = useMemo(() => {
    if (cameraId === null) return null;

    const nowMs = now();
    const assessment = assessments.find((item) => item.id === cameraId) ?? null;
    const record = cameras.find((item) => item.id === cameraId) ?? null;

    // The timer, read against this render's clock. `Math.max` rather than a
    // raw subtraction: a lapsed mute is zero time left, never negative time.
    const mutedUntilMs = mutedCameras[cameraId];
    const muteRemainingMs =
      mutedUntilMs === undefined ? 0 : Math.max(0, mutedUntilMs - nowMs);
    const mutedCamera = muteRemainingMs > 0;
    const muted = globallyMuted || mutedCamera || assessment?.muted === true;

    // The engine's verdict for THIS camera, in the same two words SWEEP uses
    // for a dot: in range, or merely known. `clear` when the engine has not
    // assessed it at all -- a cached record with no live measurement is not an
    // alert, and must not be drawn as one.
    const alertState: AlertState =
      assessment === null ? 'clear' : assessment.inRange ? 'in_range' : 'approaching';

    return intelModel({
      cameraId,
      record,
      // Only consulted when the record has no baked street -- see
      // `IntelInput.streetFallback`. Reads the basemap the driver is already
      // looking at, so the name can never disagree with what is on screen.
      streetFallback: streetForRecord(record),
      // Resolved HERE, not in `intelState`, which does no I/O by contract --
      // same arrangement as `streetFallback`. The gazetteer is already loaded
      // for RADAR's zone strip, so this costs no request.
      county: gazetteer.county(record?.countyFips),
      place: gazetteer.place(record?.placeGeoid)?.label ?? null,
      assessment,
      state: resolveRadarState({ alertState, gps, locationPermission, muted, mutePierced }),
      mutedCamera,
      muteRemainingMs,
      reads: intelReads(entries, cameraId, nowMs),
      windowDays: READ_WINDOW_DAYS,
      operatorRecord,
      // Always false: `cameraCapture` cannot strip a photo's EXIF GPS and no
      // re-encode step exists downstream. See `IntelPhoto.tsx`.
      photoAvailable: false,
    });
  }, [
    cameraId,
    assessments,
    cameras,
    entries,
    gps,
    locationPermission,
    globallyMuted,
    mutedCameras,
    mutePierced,
    operatorRecord,
    now,
  ]);

  const statement = useCallback(
    (kind: IntelStatement): void => {
      if (cameraId === null || ownQueue === null) return;
      setBusy(true);
      void ownQueue.queue(kind, cameraId, now()).then((queued) => {
        if (!live.current) return;
        setBusy(false);
        setOutcome(
          queued ? (kind === 'confirm_camera' ? 'confirm-queued' : 'dispute-queued') : 'queue-failed',
        );
      });
    },
    [cameraId, ownQueue, now],
  );

  const toggleMute = useCallback((): void => {
    if (cameraId === null) return;
    const atMs = now();
    const mutedUntilMs = mutedCameras[cameraId];
    if (mutedUntilMs !== undefined && mutedUntilMs > atMs) {
      alertActions.unmuteCamera(cameraId, atMs);
      setOutcome('unmuted');
      return;
    }
    // No duration argument: the store's default IS the design's ten minutes,
    // and a second copy of that number here is a second thing to keep in sync.
    // What the card prints is read back off the timer this writes.
    alertActions.muteCamera(cameraId, atMs);
    // No outcome line. `IntelView` draws a standing `MUTED 9:59 · STILL DRAWN,
    // STILL COUNTED` for as long as the mute lasts, which says everything a
    // one-shot "MUTED" line said and also says when it stops.
    setOutcome(null);
  }, [cameraId, mutedCameras, now]);

  const copyId = useCallback((): void => {
    if (cameraId === null || clipboardAdapter === null) return;
    void clipboardAdapter.writeText('camera-id', cameraId).then((copied) => {
      if (!live.current) return;
      setOutcome(copied ? 'id-copied' : 'copy-failed');
    });
  }, [cameraId, clipboardAdapter]);

  const shareCard = useCallback((): void => {
    if (model === null || shareAdapter === null) return;
    // No `url`. `share.ts` refuses to construct or guess an origin, this build
    // has no configured one, and a share with no link beats a share with the
    // wrong one.
    void shareAdapter
      .share({ kind: 'camera-intel', title: model.identity.title, text: shareText(model) })
      .then((result) => {
        if (!live.current) return;
        if (result.status === 'cancelled') return;
        if (result.status === 'shared') {
          setOutcome('shared');
          return;
        }
        setOutcome(result.status === 'unsupported' ? 'share-unavailable' : 'share-failed');
      });
  }, [model, shareAdapter]);

  return (
    <View
      model={model}
      busy={busy}
      outcome={outcome}
      onDismiss={dismiss}
      onCopyId={clipboardAdapter === null ? undefined : copyId}
      onConfirm={
        ownQueue === null
          ? undefined
          : () => {
              statement('confirm_camera');
            }
      }
      onDispute={
        ownQueue === null
          ? undefined
          : () => {
              statement('dispute_camera');
            }
      }
      onToggleMute={toggleMute}
      onNavigate={
        selected === null || !canShowInMaps
          ? undefined
          : () => {
              navigateTo({ lat: selected.lat, lon: selected.lon, label: selected.id });
            }
      }
      onShare={shareAdapter === null ? undefined : shareCard}
      onSeeSources={onSeeSources}
    />
  );
}
