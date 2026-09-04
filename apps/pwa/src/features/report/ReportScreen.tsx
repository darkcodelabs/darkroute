/**
 * REPORT - the sheet that files a camera, offline, signed, raised by the dock.
 *
 * =============================================================================
 * ONE ENTRY POINT: `openReportSheet()`
 * =============================================================================
 * v2 retitled the panel from `06 · REPORT - SHEET FROM ANY SCREEN` to
 * `06 · REPORT - SHEET FROM THE DOCK KEY`, and the title is the behaviour. v1's
 * crimson `REPORT CAMERA` bar sat above the keys on every screen and was what
 * raised this sheet; v2 deleted that bar and absorbed it into the dock as the
 * sixth key ("REPORT is the last key in the bar, always far right... Tap opens
 * the sheet, 1s hold drops a pin").
 *
 * What that changes here is nothing about how the sheet renders and everything
 * about what it may assume:
 *
 *   - `openReportSheet()` is the ONE way in. It was already the one way in; v2
 *     removed the alternative rather than adding one. It opens the reserved
 *     `report` / `sheet` overlay OVER whatever screen the driver is on, which
 *     is still true when the tap comes from the dock - the dock is not a
 *     screen, so there is nothing to navigate away from.
 *   - {@link closeReport} does not aim at a bar, a screen or a referrer. It
 *     closes the overlay if that is how it was presented, otherwise pops
 *     history, otherwise lands on `DEFAULT_SCREEN`. None of those three
 *     branches names REPORT's entry point, so none of them broke when the
 *     entry point moved.
 *   - Nothing on the sheet is a "from any screen" affordance. There is no
 *     persistent bar, no docked action and no hue that follows the screen
 *     behind it: the sheet is crimson because a report is crimson.
 *
 * The one thing the sheet still SAYS about the dock is `HOLD REPORT BUTTON 1s
 * TO ONE-TAP DROP A PIN`, which v2 keeps verbatim under the submit button. It
 * describes the key's hold gesture. This screen does not implement it and must
 * not: the hold lives in `components/dock/ReportKey.tsx`.
 *
 * =============================================================================
 * THIS FILE IS WIRING
 * =============================================================================
 * Every value below arrives from a store selector or from the queue port, and
 * every string it renders is built by the pure functions in `reportDraft.ts`.
 * Like `RadarScreen.tsx` and the SWEEP components it embeds, this file:
 *
 *   - reads no sensor. No `navigator`, no `geolocation`, no permission prompt -
 *     on mount or ever. The position is the fix the app already has.
 *   - does no geospatial arithmetic. The bearing beside the dial is whatever
 *     the DRIVER pointed it at - nothing seeds it from the phone any more, see
 *     `seedBearing` below - and the lane sentence is a pure function of it.
 *   - fetches nothing, and there is no upload path behind `SUBMIT REPORT`. The
 *     report is signed and held. See `reportQueue.ts`.
 *   - renders no camera it was not given. Confirm mode with nothing nearby says
 *     so and refuses the submit instead of filing against a made-up id.
 *
 * The one browser API this file now reaches for is `URL.createObjectURL`, for
 * the attached photograph's thumbnail, and it is here rather than in a view
 * because whoever creates an object URL must be the one that revokes it - see
 * {@link PhotoSourcePort} and the revoke effect below.
 *
 * =============================================================================
 * ONE PHOTOGRAPH, PREPARED HERE, HELD - NEVER SENT
 * =============================================================================
 * The driver may attach one photo. `preparePhoto()` re-encodes it through a
 * canvas, so the output is built from pixels alone and the camera's EXIF - GPS
 * first among it - is not stripped so much as never written. This screen then:
 *
 *   1. hashes the prepared bytes (`photoDigest.ts`),
 *   2. puts that digest in the signed payload's `photo` field, and
 *   3. hands the bytes to the queue, which stores them in `reportPhotos` under
 *      the report's own id.
 *
 * The bytes are NOT in the signed record. A `SignedReportRecord` is frozen at
 * signing time and its immutability check diffs every field by
 * `JSON.stringify`; half a megabyte of JPEG has no business there. The
 * signature covers the digest, which is what lets `clearLocalData()` delete the
 * picture later without breaking a single chain link.
 *
 * The digest is NOT on `ReportDraft` either, and that is a correctness rule
 * rather than tidiness: a draft could then carry a hash whose bytes this screen
 * is not holding, and the app would sign a report claiming a photograph it
 * cannot produce. Bytes and digest live in one state value, {@link photo}, so
 * the two cannot drift apart.
 *
 * =============================================================================
 * MUTED CAMERAS ARE STILL CONFIRMABLE
 * =============================================================================
 * Nothing in this file filters by mute. `useNearestCamera()` is the engine's
 * answer intact, and a muted camera keeps its id, its place in confirm mode and
 * its record - muting silences an alert, it does not delete a camera.
 *
 * =============================================================================
 * NOTHING IS UPLOADED, LOGGED OR PUT IN THE URL
 * =============================================================================
 * The coordinates on this sheet are the most sensitive values in the product.
 * They are rendered, they are signed into a local record, and that is the whole
 * list. `screenState` carries a screen id and never a payload, so no part of
 * this draft can reach the query string; there is no `console` call on this
 * path; and the queue is IndexedDB, not a request.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';

import {
  DEFAULT_SCREEN,
  closeOverlay,
  goBack,
  openOverlay,
  openScreen,
} from '../../app/screenState.ts';
import type { Overlay } from '../../app/screenState.ts';
import { isScriptedPosition } from '../../stores/position.ts';
import { projectSubject, subjectSummary } from './subjectPosition.ts';
import type { SubjectOffsetFt, SubjectSide } from './subjectPosition.ts';
import {
  syncActions,
  useAccuracyM,
  useCurrentFix,
  useHeldReportCount,
  useNearestCamera,
  useSatellites,
  useHeadingDeg,
  useWifiOnlySync,
} from '../../stores';

import { createCameraCaptureAdapter } from '../../services/adapters/cameraCapture.ts';
import type { CapturedPhoto } from '../../services/adapters/cameraCapture.ts';

import { useOverlayDismiss } from '../../components/overlay/useOverlayDismiss.ts';
import { ReportView } from './components/ReportView.tsx';
import type { ReportViewProps } from './components/ReportView.tsx';
import type { PhotoAttachment, PhotoRejection, ReportViewModel } from './components/ReportView.tsx';
import { photoSha256 } from './photoDigest.ts';
import { MAX_BYTES, preparePhoto } from './preparePhoto.ts';
import { PHOTO_NOT_STORED, createReportQueue, describeQueueFailure } from './reportQueue.ts';
import type { ReportPhotoBytes, ReportQueuePort } from './reportQueue.ts';
import {
  FACING_LABEL,
  emptyDraft,
  makeModelIssue,
  positionDetail,
  reportCoordinates,
  reportPayload,
  reportStatus,
  seedFacing,
  submitBlocker,
  withFacing,
  withMakeModel,
  withMode,
  withMount,
} from './reportDraft.ts';
import type { FacingSource, ReportDraft } from './reportDraft.ts';

import './report.css';

/**
 * The sheet, as the overlay `screenState` already reserves for it: id `report`,
 * kind `sheet`. v2 titles the panel "SHEET FROM THE DOCK KEY": the REPORT key
 * is not a destination, so pressing it must put this OVER the screen the driver
 * is on rather than replacing it.
 */
export const REPORT_OVERLAY: Overlay = Object.freeze({ id: 'report', kind: 'sheet' });

/**
 * Open the sheet over whatever is on screen. THE one way in - see the file
 * header. The dock's REPORT key calls this.
 */
export function openReportSheet(): number {
  return openOverlay(REPORT_OVERLAY);
}

/**
 * Dismiss it, however it was presented: as the reserved sheet overlay, as a
 * pushed screen, or as the entry point itself.
 *
 * NONE OF THESE BRANCHES NAMES THE ENTRY POINT. v2 moved what raises the sheet
 * from a per-screen bar to the dock key, and this function never knew about
 * either - it unwinds whatever presentation it finds and falls back to the
 * default screen. A back-target aimed at the deleted bar would have broken; a
 * function that only ever unwinds cannot.
 */
export function closeReport(): void {
  if (closeOverlay(REPORT_OVERLAY.id)) return;
  if (goBack()) return;
  openScreen(DEFAULT_SCREEN, { replace: true });
}

/**
 * WHERE A PHOTOGRAPH COMES FROM. The fourth injectable, in the same idiom as
 * `queue` and `view`.
 *
 * This seam is not a convenience. `createImageBitmap` does not exist in the
 * jsdom environment this repo's unit tests run in, and `preparePhoto()`'s first
 * line returns null without it - so without an injectable source EVERY unit
 * test of this screen would silently take the "that is not a photo" branch and
 * prove nothing about the attach path. The real stripping is proven where it
 * can be, in `e2e/preparePhoto.spec.ts`, in a real browser.
 */
export interface PhotoSourcePort {
  /**
   * USER GESTURE ONLY - a file picker will not open outside one. Null when the
   * driver backed out, which is an ordinary outcome and not a rejection.
   */
  pick(): Promise<CapturedPhoto | null>;
}

/**
 * The attachment as this screen holds it: the view's {@link PhotoAttachment}
 * plus the bytes, which no view is given.
 *
 * One value, not a bytes state and a digest state, because two values can
 * disagree and the disagreement would be a signed report naming a photograph
 * that is not in hand.
 */
type PhotoState =
  | { readonly state: 'none' }
  | { readonly state: 'preparing' }
  | { readonly state: 'rejected'; readonly reason: PhotoRejection }
  | {
      readonly state: 'attached';
      /** Owned here. Revoked by the effect keyed on this object. */
      readonly previewUrl: string;
      readonly bytes: ReportPhotoBytes;
    };

const NO_PHOTO: PhotoState = { state: 'none' };

/**
 * The OS camera, wrapped to the one method this screen needs.
 *
 * `capture()` checks its own capability and resolves null when it cannot run,
 * so there is nothing to `start()` and no permission to ask for: the adapter
 * hands the job to a file input, which is why camera is deliberately not one of
 * the three permissions onboarding lists.
 */
function createDefaultPhotoSource(): PhotoSourcePort {
  const adapter = createCameraCaptureAdapter();
  return {
    pick: () => adapter.capture({ facing: 'environment' }),
  };
}

export interface ReportScreenProps {
  /**
   * WHICH VIEW DRAWS THE MODEL. Same seam as `SettingsScreen`: the fix, the
   * facing seed, the draft reducer, the queue write and every submit blocker
   * are the container's and v1 changes none of them. Defaults to v0's view.
   */
  readonly view?: ComponentType<ReportViewProps> | undefined;
  /**
   * Where a submitted report goes. Defaults to the install's own signed queue.
   * Injected by tests, which supply a deterministic evidence chain and their
   * own database name.
   */
  readonly queue?: ReportQueuePort | undefined;
  /** Which half of the toggle starts pressed. `NEW CAMERA`, as drawn. */
  readonly initialMode?: ReportDraft['mode'] | undefined;
  /**
   * Where an attached photograph comes from. Defaults to the OS camera. Injected
   * by tests, which cannot decode an image at all - see {@link PhotoSourcePort}.
   */
  readonly photos?: PhotoSourcePort | undefined;
  /** Called after a report is queued, with the receipt's report id. */
  readonly onQueued?: ((reportId: string) => void) | undefined;
}

export function ReportScreen({
  queue,
  photos,
  initialMode = 'new',
  onQueued,
  view: View = ReportView,
}: ReportScreenProps = {}): ReactElement {
  // Created once. A caller that supplies a port owns its lifetime; a port this
  // screen created is closed when the screen goes away.
  const [ownedQueue] = useState<ReportQueuePort | null>(() =>
    queue === undefined ? createReportQueue() : null,
  );
  const port = queue ?? ownedQueue;

  // Created once, like `ownedQueue`. The adapter builds a file input per
  // capture and tears it down again, so there is nothing to close.
  const [ownedSource] = useState<PhotoSourcePort>(() => photos ?? createDefaultPhotoSource());
  const source = photos ?? ownedSource;

  /**
   * EVERY WAY OUT OF THE SHEET, THROUGH ONE FUNCTION.
   *
   * The close key was the only one, it closed the overlay and it left focus on
   * the body. This adds Escape - the app is used in desktop browsers, where a
   * sheet a keyboard cannot leave is a trap - and puts focus back on whatever
   * raised the sheet, usually the dock's REPORT circle. See
   * components/overlay/useOverlayDismiss.ts.
   */
  const dismiss = useOverlayDismiss(closeReport);

  const [draft, setDraft] = useState<ReportDraft>(() => emptyDraft(initialMode));
  const [photo, setPhoto] = useState<PhotoState>(NO_PHOTO);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const live = useRef(true);

  /**
   * The attachment as of now, for the async attach pipeline to read.
   *
   * The pipeline spans four awaits and must not re-enter itself - a driver who
   * taps ADD A PHOTO twice while the encoder is running would otherwise open
   * two pickers and race two results into one slot. Closing over `photo` in the
   * callback would read whichever value existed when the callback was built,
   * which is exactly the stale answer.
   */
  const photoRef = useRef<PhotoState>(photo);
  photoRef.current = photo;

  /**
   * WHICH REPORT AN IN-FLIGHT ENCODE BELONGS TO.
   *
   * =========================================================================
   * THE BUG: A PHOTOGRAPH OF ONE CAMERA, SIGNED INTO A REPORT ABOUT ANOTHER
   * =========================================================================
   * Preparing a photograph is asynchronous - the OS picker, then a decode, a
   * resize, a quality ladder and a digest - and SUBMIT REPORT stays pressable
   * throughout, deliberately: `submitBlocker` does not know the `preparing`
   * state exists, because a camera is still worth filing without a picture.
   *
   * So this was reachable, and was proven reachable in review:
   *
   *   tap ADD A PHOTO -> picker returns -> encoder still running
   *   tap SUBMIT REPORT -> report 1 files with photo: null, sheet resets
   *   encoder resolves -> setPhoto({ state: 'attached' }) fires anyway
   *   tap SUBMIT REPORT -> report 2 is SIGNED carrying that digest, and the
   *                        bytes land in reportPhotos under report 2's id
   *
   * A photograph of the camera on the last street, cryptographically bound to
   * a report about this one. Nothing throws, both reports verify, and the
   * evidence is wrong in the way that is hardest to notice later.
   *
   * The counter is bumped by anything that ends the current report - a
   * successful submit, or the driver removing the photo. An encode that
   * finishes against a stale generation drops its result on the floor.
   */
  const photoGeneration = useRef(0);

  // --- what the device already knows ---------------------------------------
  const fix = useCurrentFix();
  const accuracyM = useAccuracyM();
  const satellites = useSatellites();
  const headingDeg = useHeadingDeg();

  // --- what the engine already answered ------------------------------------
  const nearest = useNearestCamera();

  // --- what the queue already holds ----------------------------------------
  const queuedReports = useHeldReportCount();
  const wifiOnly = useWifiOnlySync();

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (ownedQueue === null) return undefined;
    return () => {
      ownedQueue.close();
    };
  }, [ownedQueue]);

  /**
   * THE OBJECT URL IS REVOKED HERE AND NOWHERE ELSE.
   *
   * Keyed on the attachment OBJECT, so removing one revokes it, filing the
   * report revokes it, and replacing one with another WOULD revoke the first -
   * that last path is not reachable today, because `ReportViewV1` draws the
   * attach control only in the non-attached states, so the only control on an
   * attached photo is REMOVE. Handled anyway rather than asserted away: the
   * effect costs nothing and the alternative is a leak the day the sheet grows
   * a replace button,
   * and unmounting revokes it - four exits, one line, because they are all the
   * same event: this value stopped being the current attachment.
   *
   * A view must never do this. `URL.createObjectURL` pins the blob in memory
   * until the matching revoke, and a component that creates a URL while
   * rendering creates a new one on every re-render and leaks all but the last.
   */
  useEffect(() => {
    if (photo.state !== 'attached') return undefined;
    const url = photo.previewUrl;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [photo]);

  // Read the queue once, so the line above the button is a real number rather
  // than whatever the store happened to be left at.
  useEffect(() => {
    if (port === null) return;
    let cancelled = false;
    void port
      .counts()
      .then((counts) => {
        if (!cancelled) syncActions.setCounts(counts);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(describeQueueFailure(error));
      });
    return () => {
      cancelled = true;
    };
  }, [port]);

  /**
   * IS THERE A CAMERA TO CONFIRM? Asked without reference to the mode.
   *
   * =========================================================================
   * THE DEADLOCK THIS SPLIT EXISTS TO BREAK
   * =========================================================================
   * There was one value here, `cameraId`, and it read:
   *
   *     draft.mode === 'confirm' ? (nearest?.id ?? null) : null
   *
   * `ReportViewV1` disables the CONFIRM tab when `cameraId === null`. A draft
   * starts in `new`. So `cameraId` was null, so the tab was disabled, so the
   * mode could never become `confirm`, so `cameraId` stayed null. The tab was
   * unreachable FOR EVERY DRIVER, with a camera 30 feet away or none in the
   * state - the proximity never entered into it.
   *
   * It was silent too. The note explaining that nothing is near enough only
   * renders `draft.mode === 'confirm'`, a branch that could not be reached, so
   * the product's own explanation for the dead tab was itself unreachable.
   *
   * 2,764 tests passed over this. Every one of them drove the mode directly
   * instead of pressing the control a driver presses, which is the failure
   * mode worth remembering: a test that sets state cannot see a control that
   * refuses to set it.
   *
   * So: availability is a fact about the WORLD and is answered here.
   */
  const nearbyCameraId = nearest?.id ?? null;

  // The camera being confirmed. Muted or not - a muted camera is still there.
  // Still mode-gated, and correctly: a NEW-camera report must not carry the id
  // of some other camera that happens to be nearby.
  const cameraId = draft.mode === 'confirm' ? nearbyCameraId : null;
  const cameraMuted = draft.mode === 'confirm' && nearest !== null && nearest.muted;

  /**
   * WHERE THE FACING ARROW STARTS - and why it is no longer the phone.
   *
   * =========================================================================
   * THE CAMERA IS NOT THE CAR
   * =========================================================================
   * This seeded NEW reports from `headingDeg` and labelled the result
   * `FACING · FROM COMPASS`. `headingDeg` is the CAR's course over ground. The
   * camera is a separate object on a pole, usually pointing across the road
   * rather than along it, so the seed was an inference about one thing
   * presented as a measurement of another - and it was signed into the payload
   * as `facing_deg` whether or not the driver ever looked at the dial.
   *
   * It is the same defect the v2 schema split fixed for POSITION: reporting the
   * driver's own sensor reading as a fact about the camera.
   *
   * =========================================================================
   * AND THE READING WAS SOMETIMES NOT A BEARING AT ALL
   * =========================================================================
   * `services/adapters/orientation.ts:117-118` is explicit: when
   * `event.absolute` is false "the zero point is arbitrary: still emitted,
   * flagged, and the caller must not render it as a bearing." The flag it
   * emits, `headingAbsolute`, is written by `position.ts` at :170 and :183 and
   * read by NOTHING - no selector, no consumer anywhere in the app. So on a
   * device with no magnetometer the sheet took a number whose zero was
   * arbitrary, printed it as a compass bearing, signed it, and queued it for
   * publication to OpenStreetMap.
   *
   * =========================================================================
   * WHAT SEEDS NOW
   * =========================================================================
   * CONFIRM keeps the record bearing. That is a real prior fact about the
   * camera, from the archive, and starting the arc there saves the driver
   * confirming what is already known.
   *
   * NEW seeds NOTHING. The dial opens unset and the driver points it. Losing
   * the head start is the point: an unset arc asks a question, and a wrong arc
   * answers one nobody asked.
   */
  const seedBearing = draft.mode === 'confirm' ? (nearest?.directionDeg ?? null) : null;
  const seedSource: FacingSource =
    draft.mode === 'confirm' && nearest?.directionDeg !== null && nearest?.directionDeg !== undefined
      ? 'record'
      : 'none';

  /**
   * The seed as of the last time it changed, held in a ref.
   *
   * The effect below keys on the bearing VALUE, so it does not fire again while
   * the heading holds still. {@link submit} needs the seed at the moment a
   * report is filed, and it reads it from here rather than closing over it, so
   * that a compass ticking several times a second does not rebuild the submit
   * callback on every tick.
   */
  const seedRef = useRef<{ readonly bearingDeg: number | null; readonly source: FacingSource }>({
    bearingDeg: seedBearing,
    source: seedSource,
  });

  useEffect(() => {
    seedRef.current = { bearingDeg: seedBearing, source: seedSource };
    setDraft((current) => seedFacing(current, seedBearing, seedSource));
  }, [seedBearing, seedSource]);

  /*
   * WHERE THE CAMERA WAS, as two taps rather than one coordinate.
   *
   * Kept out of `ReportDraft` on purpose: the draft is the set of things that
   * go into the payload verbatim, and this pair does not - it is resolved
   * through `projectSubject` into a coordinate first. Storing both the answer
   * and its projection in the draft would be storing the same fact twice, with
   * the usual consequence.
   */
  const [side, setSide] = useState<SubjectSide | null>(null);
  const [offsetFt, setOffsetFt] = useState<SubjectOffsetFt | null>(null);

  // `overhead` needs no distance, so it is complete on its own. Every other
  // side is incomplete until the driver says how far over.
  const choice =
    side === null ? null : side === 'overhead' ? { side, offsetFt: 15 as SubjectOffsetFt } : offsetFt === null ? null : { side, offsetFt };

  const subjectPosition = projectSubject(
    fix === null ? null : { lat: fix.lat, lon: fix.lon },
    headingDeg,
    choice,
  );

  const blocker = submitBlocker({
    draft,
    hasPosition: fix !== null,
    cameraId,
    submitting,
    demoActive: isScriptedPosition(),
  });

  /**
   * ADD A PHOTO. Camera first, then every refusal.
   *
   * =========================================================================
   * WHY `pick()` IS CALLED BEFORE THE CAPACITY CHECK
   * =========================================================================
   * The capacity check is a database read, so awaiting it first would move
   * `pick()` into a promise continuation - and a file input clicked outside a
   * user gesture does not open a picker in any browser. The driver would press
   * ADD A PHOTO and nothing at all would happen. So the camera opens first and
   * the refusal comes after, which costs a driver at the cap one wasted shot
   * and costs every other driver nothing.
   *
   * Capacity is refused rather than made room for: `reportPhotos` is in
   * `EVICTION_EXEMPT_STORES`, because deleting a photograph to fit another
   * would leave a signed record citing a digest whose bytes the app itself
   * removed without being asked.
   *
   * A REFUSED PHOTO NEVER BLOCKS THE REPORT. `submitBlocker()` does not know
   * this state exists. The camera is still worth filing.
   */
  const attachPhoto = useCallback(() => {
    if (port === null) return;

    /*
     * A SECOND TAP SUPERSEDES THE FIRST; it does not bounce off it.
     *
     * This used to early-return while `preparing`, which sounds like the
     * obvious guard and strands the driver. `cameraCapture.capture()` resolves
     * on `change`, on `cancel`, on `abort()`, or when a later `capture()`
     * supersedes it - and `cancel` on `<input type=file>` is not universal
     * (older Android WebViews, Firefox). On those, backing out of the picker
     * settles nothing: the sheet says PREPARING... forever, and with the guard
     * in place the supersede route was closed too, so ADD A PHOTO was dead
     * until the driver left and re-entered the sheet.
     *
     * Bumping the generation makes the earlier encode a no-op, so letting the
     * second tap through is safe as well as necessary.
     */
    const generation = photoGeneration.current + 1;
    photoGeneration.current = generation;

    const settle = (next: PhotoState): void => {
      // Two conditions, and the second is the one that matters: still mounted,
      // and still the same report.
      if (live.current && photoGeneration.current === generation) setPhoto(next);
    };

    setPhoto({ state: 'preparing' });
    void (async () => {
      try {
        // Synchronous up to here: the async body runs to its first await
        // inside the click handler, so this call is still inside the gesture.
        const captured = await source.pick();
        // Backing out of the camera is not an error and must not be shown as
        // one - the tile goes back to how it was before the tap.
        if (captured === null) {
          settle(NO_PHOTO);
          return;
        }
        if (await port.photosAtCapacity()) {
          settle({ state: 'rejected', reason: 'no-room' });
          return;
        }
        const prepared = await preparePhoto(captured);
        // `preparePhoto` returns null for an undecodable file AND for a runtime
        // with no canvas, indistinguishably. `unreadable` covers both rather
        // than pretending to know which.
        if (prepared === null) {
          settle({ state: 'rejected', reason: 'unreadable' });
          return;
        }
        // The quality ladder has a floor: past it a photo of a small distant
        // object stops being evidence, so `preparePhoto` returns an oversized
        // file rather than degrading it further, and says so through its size.
        // Refusing is this screen's job.
        if (prepared.sizeBytes > MAX_BYTES) {
          settle({ state: 'rejected', reason: 'too-big' });
          return;
        }
        // Hash what gets STORED, never the file the camera handed over: the
        // payload's `photo` field names the row in `reportPhotos`, and
        // `preparePhoto` produced a different file from the original.
        const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
        const sha256 = await photoSha256(bytes);
        // CHECKED BEFORE THE URL IS MINTED, not after. `settle` would drop a
        // stale result correctly, but `URL.createObjectURL` in the argument
        // list runs first and the handle would leak for the life of the
        // document - one per superseded encode, each pinning its own copy of
        // the bytes.
        if (!live.current || photoGeneration.current !== generation) return;
        // Through `settle`, not `setPhoto`: this is the branch that filed a
        // photograph against the next report. See `photoGeneration`.
        settle({
          state: 'attached',
          previewUrl: URL.createObjectURL(new Blob([bytes], { type: prepared.mimeType })),
          bytes: {
            sha256,
            bytes,
            mimeType: prepared.mimeType,
            sizeBytes: prepared.sizeBytes,
            width: prepared.width,
            height: prepared.height,
          },
        });
      } catch {
        // Nothing is logged and nothing is interpolated: the thrown value on
        // this path can be a DOM exception naming the driver's own file.
        settle({ state: 'rejected', reason: 'unreadable' });
      }
    })();
  }, [port, source]);

  /**
   * Drop it. The URL is revoked by the effect above, not here.
   *
   * Bumps the generation because REMOVE is also an answer to "which photograph
   * does this report have": an encode still running was started for a photo the
   * driver has now said they do not want, and letting it land would put the
   * tile back to `attached` under their hands.
   */
  const removePhoto = useCallback(() => {
    photoGeneration.current += 1;
    setPhoto(NO_PHOTO);
  }, []);

  const submit = useCallback(() => {
    if (port === null || fix === null || submitting) return;
    // RE-CHECKED HERE, not trusted from the render above. The button being
    // enabled is a fact about the last render; this is a fact about now, and
    // the demo can start between the two.
    if (
      submitBlocker({
        draft,
        hasPosition: true,
        cameraId,
        submitting: false,
        demoActive: isScriptedPosition(),
      }) !== null
    )
      return;
    // Read once, so the digest that goes into the payload and the bytes that go
    // to the queue are the SAME attachment. Two reads could straddle a
    // re-attach and produce a record naming a photograph the queue never got.
    const attached = photo.state === 'attached' ? photo.bytes : null;
    const payload = reportPayload(
      draft,
      {
        cameraId,
        // THE PHONE, and named that way in the payload. What this is NOT is the
        // camera's position -- see `REPORT_PAYLOAD_SCHEMA`, which carries the
        // whole account of why the two were one field and should not have been.
        lat: fix.lat,
        lon: fix.lon,
        accuracyM,
        satellites,
        // THE CAMERA, when the driver said where it was. Null otherwise, and
        // null is allowed to reach the payload - a report with no camera
        // position is still worth filing locally, it is only unpublishable.
        subject:
          subjectPosition === null ? null : { ...subjectPosition, source: 'projected' as const },
        // Read at the moment of capture, because this is the last point in the
        // system where a demo fix is still distinguishable from a real one.
        synthetic: isScriptedPosition(),
      },
      // The DIGEST, not the picture. Null when nothing is attached, which is
      // what `photo` has always been in every record written before this.
      attached?.sha256 ?? null,
    );
    setSubmitting(true);
    setFailure(null);
    void port
      .submit(payload, attached ?? undefined)
      .then((receipt) => {
        if (!live.current) return;
        syncActions.setCounts(receipt.counts);
        /*
         * THE REPORT IS FILED EITHER WAY, AND THE SHEET SAYS WHICH.
         *
         * `photoStored` is false only when the body and the chain row landed
         * and the bytes did not. Reporting that as a failed submit would be a
         * lie a driver might act on by filing the same camera twice, so the
         * sentence leads with REPORT FILED and the draft resets as normal.
         */
        setFailure(receipt.photoStored ? null : PHOTO_NOT_STORED);
        // A filed report is finished. The next one starts empty, in the same
        // mode, and is RE-SEEDED HERE rather than by the effect above.
        //
        // The effect keys on the bearing value, so a heading that has not moved
        // since the last render will never fire it again. Resetting to
        // `emptyDraft()` alone therefore left the sheet reading
        // `FACING · NO COMPASS` with a live compass, and signed the NEXT report
        // with `facing_deg: null` - worst of all for the stationary driver
        // parked beside the camera, whose heading is exactly the one that does
        // not change. The bearing is a core field of the signed evidence; it is
        // put back from the same seed the effect would have used.
        const seed = seedRef.current;
        setDraft(seedFacing(emptyDraft(draft.mode), seed.bearingDeg, seed.source));
        // In the same block, for the same reason: the photograph belonged to
        // the report that was just filed and its bytes are now in
        // `reportPhotos` under that report's id. Leaving it attached would put
        // the same picture on the next report as well, under a second id, with
        // no way for either record to say they are the same photograph.
        //
        // AND THE GENERATION BUMPS HERE, which is the half that was missing.
        // Clearing the state is not enough on its own: an encode started before
        // this submit is still running, and it would land on the empty sheet and
        // attach itself to the NEXT report. See `photoGeneration`.
        photoGeneration.current += 1;
        setPhoto(NO_PHOTO);
        onQueued?.(receipt.reportId);
      })
      .catch((error: unknown) => {
        if (live.current) setFailure(describeQueueFailure(error));
      })
      .finally(() => {
        if (live.current) setSubmitting(false);
      });
    // `subjectPosition` is in here because leaving it out is silent: the
    // callback would close over the value from the render before the chips were
    // pressed, so the sheet would show `RIGHT · ONE LANE OVER` and file
    // `subject_position: null`. Nothing would throw and the report would look
    // filed. Two tests above submit AFTER tapping for exactly this reason.
  }, [
    accuracyM,
    cameraId,
    draft,
    fix,
    onQueued,
    // In the deps for the same reason `subjectPosition` is: a callback closing
    // over the previous render's attachment would sign the digest of a
    // photograph the driver had already replaced or removed.
    photo,
    port,
    satellites,
    subjectPosition,
    submitting,
  ]);

  /**
   * The attachment, minus the bytes.
   *
   * No view is given the image data. It needs the thumbnail, the numbers under
   * it and the digest; handing it half a megabyte as well would put a copy of
   * the photograph into a component's props on every render for nothing.
   */
  const photoModel: PhotoAttachment = useMemo(() => {
    if (photo.state !== 'attached') return photo;
    return {
      state: 'attached',
      previewUrl: photo.previewUrl,
      width: photo.bytes.width,
      height: photo.bytes.height,
      sizeBytes: photo.bytes.sizeBytes,
      sha256: photo.bytes.sha256,
    };
  }, [photo]);

  const model: ReportViewModel = useMemo(
    () => ({
      draft,
      coordinates: reportCoordinates(fix?.lat ?? null, fix?.lon ?? null),
      positionDetail: positionDetail({ accuracyM, satellites, place: cameraId }),
      hasFix: fix !== null,
      facingLabel: FACING_LABEL[draft.facingSource],
      cameraId,
      canConfirm: nearbyCameraId !== null,
      cameraMuted,
      /*
       * STILL FALSE, AND NO LONGER FOR THE REASON IT USED TO BE.
       *
       * It meant "no photo can be attached anywhere, because nothing can strip
       * a photo's metadata". That is no longer true: `preparePhoto()` strips it
       * by re-encode and the sheet attaches one photograph per report, through
       * `photo` below.
       *
       * What this flag actually gates is v0's `DetailTiles` PHOTO tile. The
       * build routes REPORT to `ReportViewV1` (`app/registry.v1.tsx`), the
       * attach affordance is v1's, and v0 has nothing behind that tile - so
       * enabling it would draw a pressable control that does nothing. It is
       * false because of v0's plumbing, not because of EXIF.
       */
      photoAvailable: false,
      photo: photoModel,
      makeModelIssue: makeModelIssue(draft.makeModel),
      status: reportStatus({ blocker, queuedReports, wifiOnly, failure }),
      submitDisabled: blocker !== null,
      side,
      offsetFt,
      // Not "does the device have a compass". `headingDeg` is course over
      // ground from the GPS, which is what the projection turns on, and it is
      // null while stationary.
      hasHeading: headingDeg !== null,
      whereSummary: subjectSummary(choice),
    }),
    [
      accuracyM,
      blocker,
      cameraId,
      cameraMuted,
      choice,
      draft,
      failure,
      fix,
      headingDeg,
      offsetFt,
      photoModel,
      queuedReports,
      satellites,
      side,
      wifiOnly,
    ],
  );

  return (
    <View
      model={model}
      onClose={dismiss}
      onSelectMode={(mode) => {
        setDraft((current) => withMode(current, mode));
      }}
      onAdjustFacing={(bearingDeg) => {
        setDraft((current) => withFacing(current, bearingDeg));
      }}
      onToggleMount={(mount) => {
        setDraft((current) => withMount(current, mount));
      }}
      onSelectSide={(next) => {
        // Pressing the pressed chip clears it, matching MountChips - the only
        // way back to "I have not said" after a mistaken tap.
        setSide((current) => (current === next ? null : next));
      }}
      onSelectOffset={(next) => {
        setOffsetFt((current) => (current === next ? null : next));
      }}
      onMakeModelChange={(value) => {
        setDraft((current) => withMakeModel(current, value));
      }}
      onAttachPhoto={attachPhoto}
      onRemovePhoto={removePhoto}
      onSubmit={submit}
    />
  );
}
