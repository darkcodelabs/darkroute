/**
 * CAMERA CAPTURE - one still photo of a camera, for a report.
 *
 * Screens: "DROP PHOTO OF CAMERA" on the intel card, the PHOTO tile in the
 * report sheet, "HELD FOR SYNC · ADD PHOTO" on the watch.
 *
 * WHY A FILE INPUT AND NOT getUserMedia
 *   `<input type="file" accept="image/*" capture="environment">` hands the job
 *   to the OS camera app. It needs no web permission, works inside a TWA,
 *   survives the app being backgrounded mid-shot, and gives the user the
 *   viewfinder they already know. `getUserMedia` would mean holding a live
 *   video stream and a camera permission for a single still - more permission,
 *   more battery, worse photo. Onboarding lists three permissions (location,
 *   notifications, motion); camera is deliberately not one of them, and this
 *   adapter is why that is true.
 *
 * EXIF - READ THIS BEFORE UPLOADING ANYTHING
 *   A photo from a phone camera usually carries GPS coordinates in its EXIF.
 *   That is the single most sensitive artefact this product can produce, and
 *   this adapter does NOT strip it: stripping means re-encoding through a
 *   canvas, which belongs to the report pipeline that also compresses and
 *   signs. `CapturedPhoto.metadataStripped` is therefore `false`, always, and
 *   any upload path must treat a photo with that flag false as unsendable.
 *   The flag exists so that nothing downstream can assume otherwise.
 *
 * CANCELLATION
 *   Browsers that implement the `cancel` event on file inputs resolve to null
 *   when the user backs out. Browsers that do not fire nothing at all, and
 *   there is no reliable way to detect it - so the promise stays pending until
 *   `abort()` is called or another capture supersedes it. That is stated rather
 *   than papered over with a focus-and-timeout guess.
 */

import { createCore } from './core';
import { doc, no, ok, type Adapter, type Capability } from './types';

export interface CapturedPhoto {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Always false here. GAP: see DESIGN-GAPS.md#photo-exif-is-not-stripped */
  readonly metadataStripped: false;
  readonly capturedAt: number;
}

export type CameraFacing = 'environment' | 'user';

export interface CaptureOptions {
  readonly facing?: CameraFacing;
  /** Comma-separated accept list. Defaults to any image. */
  readonly accept?: string;
}

export interface CameraCaptureAdapter extends Adapter<CapturedPhoto, CaptureOptions> {
  /** USER GESTURE ONLY - a file picker will not open outside one. */
  capture(opts?: CaptureOptions): Promise<CapturedPhoto | null>;
  /** Resolve a pending capture with null. Safe when nothing is pending. */
  abort(): void;
}

export function cameraCaptureCapability(): Capability {
  const document = doc();
  if (document === undefined) return no('no document in this runtime');
  if (typeof document.createElement !== 'function') {
    return no('this runtime cannot create a file input');
  }
  const input = document.createElement('input');
  if (!('files' in input)) {
    return no('this browser does not support file inputs');
  }
  return ok();
}

export function createCameraCaptureAdapter(): CameraCaptureAdapter {
  const core = createCore<CapturedPhoto>();
  let pending: ((photo: CapturedPhoto | null) => void) | null = null;
  let input: HTMLInputElement | null = null;

  const teardown = (): void => {
    if (input?.parentNode) input.parentNode.removeChild(input);
    input = null;
  };

  const settle = (photo: CapturedPhoto | null): void => {
    const resolve = pending;
    pending = null;
    teardown();
    if (resolve) resolve(photo);
  };

  return {
    name: 'cameraCapture',

    capability: cameraCaptureCapability,

    // No permission(): the OS camera app owns that decision and the web has no
    // API to read it. Faking one here would be a lie about what we know.

    /** Idempotent. Enables capture; there is nothing to hold open. */
    start(): void {
      const capability = cameraCaptureCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'photo capture is not available');
        return;
      }
      core.clearError();
      core.setRunning(true);
    },

    /** Idempotent. Cancels anything pending. */
    stop(): void {
      settle(null);
      core.setRunning(false);
    },

    abort(): void {
      settle(null);
    },

    async capture(opts?: CaptureOptions): Promise<CapturedPhoto | null> {
      const capability = cameraCaptureCapability();
      const document = doc();
      if (!capability.supported || document === undefined) {
        core.fail('unsupported', capability.reason ?? 'photo capture is not available');
        return null;
      }
      // A second capture supersedes the first rather than racing it.
      settle(null);

      const element = document.createElement('input');
      element.type = 'file';
      element.accept = opts?.accept ?? 'image/*';
      element.setAttribute('capture', opts?.facing ?? 'environment');
      element.style.setProperty('display', 'none');

      element.addEventListener('change', () => {
        const file = element.files?.[0];
        if (!file) {
          settle(null);
          return;
        }
        const photo: CapturedPhoto = {
          blob: file,
          mimeType: file.type,
          sizeBytes: file.size,
          metadataStripped: false,
          capturedAt: Date.now(),
        };
        core.clearError();
        const resolve = pending;
        pending = null;
        teardown();
        core.emit(photo);
        if (resolve) resolve(photo);
      });
      // Fires only where implemented. Where it is not, `abort()` is the exit.
      element.addEventListener('cancel', () => {
        settle(null);
      });

      document.body.appendChild(element);
      input = element;

      const result = new Promise<CapturedPhoto | null>((resolve) => {
        pending = resolve;
      });
      element.click();
      return result;
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
  };
}
