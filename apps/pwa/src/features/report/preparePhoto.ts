/**
 * PREPARING A PHOTO - re-encode it, and lose everything that was not the image.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * `cameraCapture` deliberately hands back the OS camera's file untouched, with
 * `metadataStripped: false`, and everything downstream is required to treat a
 * photo carrying that flag as unsendable. That is the right default and it is
 * why the PHOTO tile has been dark: a phone photo carries GPS coordinates in
 * its EXIF, and for THIS product -- one whose entire purpose is reducing what
 * gets recorded about where a driver has been -- uploading a file with the
 * driver's exact position welded into it would be the worst possible bug.
 *
 * This is the missing step. It is not a workaround for the flag; it is the
 * thing the flag was waiting for.
 *
 * =============================================================================
 * HOW STRIPPING ACTUALLY WORKS
 * =============================================================================
 * There is no "delete the EXIF" call. What there is, is a re-encode: decode the
 * image to pixels, draw those pixels onto a canvas, and ask the canvas for a
 * new file. The output is constructed from the pixel data alone, so EVERY
 * ancillary block -- GPS, timestamp, device make and model, serial number,
 * orientation, thumbnail (which is itself a second copy of the image and has
 * its own GPS) -- simply does not exist in it. Nothing is being removed, so
 * nothing can be missed.
 *
 * The one thing that must NOT be lost with it is orientation: EXIF rotation is
 * how phones record which way up the photo is, and dropping it silently rotates
 * portrait shots. `createImageBitmap` is asked to bake the rotation into the
 * pixels first, so the discarded tag is one the image no longer needs.
 *
 * =============================================================================
 * WHAT THIS DOES NOT TRY TO DO
 * =============================================================================
 * It does not check the photo against the map, the GPS or anything else. A
 * report is a person saying "there is a camera here", and the photo is their
 * evidence for it; cross-examining the file's metadata against the device's
 * position would be both useless -- the metadata is gone by then, on purpose --
 * and the wrong relationship to have with somebody volunteering data.
 *
 * It trusts the person. It just does not trust the FILE.
 */

import type { CapturedPhoto } from '../../services/adapters/cameraCapture';

/**
 * The longest edge kept, in pixels.
 *
 * A report photo has one job: let a reviewer tell what the thing on the pole
 * is. 1600 px reads a Flock camera's housing and mount clearly at any sane
 * crop, and it is roughly a fifth the pixels of a modern phone's 12 MP frame.
 * Above this the extra detail is of the sky and the tree behind it.
 */
export const MAX_EDGE_PX = 1600;

/** Where the encoder starts. Dropped in steps if the file comes out too big. */
export const START_QUALITY = 0.82;
export const MIN_QUALITY = 0.5;
export const QUALITY_STEP = 0.12;

/**
 * The size a prepared photo has to come in under, in bytes.
 *
 * These are queued on a phone, often on mobile data, and a report may sit in
 * the queue for days before it syncs. 600 KB is generous for a 1600 px JPEG of
 * a pole against the sky and small enough that a driver with a dozen queued
 * reports has not quietly accumulated ten megabytes of upload.
 */
export const MAX_BYTES = 600 * 1024;

/** JPEG, not PNG: this is a photograph, and PNG would be several times larger. */
export const OUTPUT_TYPE = 'image/jpeg';

export interface PreparedPhoto {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  /**
   * True, and it is a FACT about this object rather than a hope: the blob was
   * built from pixels by an encoder that had nothing else to write.
   */
  readonly metadataStripped: true;
  readonly capturedAt: number;
}

/** The scaled size, keeping the aspect ratio, never enlarging. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE_PX,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  // Never upscale. A small photo is a small photo; enlarging it adds bytes and
  // no information whatsoever.
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * The quality ladder, tried in order.
 *
 * Stepping down rather than binary-searching: each step is another full encode
 * of a multi-megapixel image, and on a mid-range phone that is not free. Three
 * or four tries reaches a sane answer, and the last rung is a floor rather than
 * a target -- past `MIN_QUALITY` a photo of a small distant object stops being
 * evidence, so a file that is still too big is returned anyway rather than
 * degraded into uselessness. The size is reported; the caller can refuse it.
 */
export function qualityLadder(
  start: number = START_QUALITY,
  min: number = MIN_QUALITY,
  step: number = QUALITY_STEP,
): readonly number[] {
  const rungs: number[] = [];
  for (let q = start; q >= min - 1e-9; q -= step) {
    rungs.push(Math.round(q * 100) / 100);
  }
  return rungs;
}

/**
 * The drawing surface, preferring the one that does not touch the DOM.
 *
 * `OffscreenCanvas` keeps a multi-megapixel bitmap off the document entirely,
 * which matters on a phone that is also running the map. The DOM canvas is the
 * fallback for browsers without it.
 */
interface Surface {
  readonly width: number;
  readonly height: number;
  draw(bitmap: CanvasImageSource, width: number, height: number): boolean;
  encode(type: string, quality: number): Promise<Blob | null>;
}

function createSurface(width: number, height: number): Surface | null {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null) return null;
    return {
      width,
      height,
      draw: (bitmap, w, h) => {
        context.drawImage(bitmap, 0, 0, w, h);
        return true;
      },
      encode: async (type, quality) => canvas.convertToBlob({ type, quality }),
    };
  }

  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  return {
    width,
    height,
    draw: (bitmap, w, h) => {
      context.drawImage(bitmap, 0, 0, w, h);
      return true;
    },
    encode: async (type, quality) =>
      new Promise((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob);
        }, type, quality);
      }),
  };
}

/**
 * Decode, resize, re-encode. Null when the file is not a decodable image.
 *
 * Null rather than a throw for an undecodable file: a driver picking the wrong
 * thing out of their gallery is an ordinary mistake and the report sheet should
 * say "that is not a photo", not fall over.
 */
export async function preparePhoto(
  photo: CapturedPhoto,
  maxEdge: number = MAX_EDGE_PX,
): Promise<PreparedPhoto | null> {
  if (typeof createImageBitmap !== 'function') return null;

  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: 'from-image'` BAKES the EXIF rotation into the pixels.
    // Without it the tag is discarded with the rest of the metadata and every
    // portrait photo arrives on its side.
    bitmap = await createImageBitmap(photo.blob, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }

  const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
  if (size.width === 0 || size.height === 0) {
    bitmap.close();
    return null;
  }

  const surface = createSurface(size.width, size.height);
  if (surface === null) {
    bitmap.close();
    return null;
  }
  surface.draw(bitmap, size.width, size.height);
  bitmap.close();

  let best: Blob | null = null;
  for (const quality of qualityLadder()) {
    const blob = await surface.encode(OUTPUT_TYPE, quality);
    if (blob === null) continue;
    best = blob;
    if (blob.size <= MAX_BYTES) break;
  }
  if (best === null) return null;

  return {
    blob: best,
    mimeType: OUTPUT_TYPE,
    sizeBytes: best.size,
    width: size.width,
    height: size.height,
    metadataStripped: true,
    capturedAt: photo.capturedAt,
  };
}
