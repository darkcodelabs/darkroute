/**
 * SENDING ONE CORRECTION TO THE PUBLIC ARCHIVE, DELIBERATELY.
 *
 * =============================================================================
 * WHAT THIS IS NOT
 * =============================================================================
 * It is not a sync. Nothing in this file runs on a timer, on a queue drain, or
 * on app start. A driver's filed reports stay signed and hash-chained in local
 * storage and are never uploaded - that property is load-bearing and this does
 * not touch it.
 *
 * This is one function, called from one button, that sends ONE correction the
 * person is looking at, once, because they pressed it. If it ever acquires a
 * caller that is not a direct user action, that is a bug.
 *
 * =============================================================================
 * WHY IT EXISTS
 * =============================================================================
 * Drivers standing at a camera were finding the archive had the brand wrong,
 * and had nowhere to say so. The honest answer was "open a pull request", which
 * needs a GitHub account, a fork and a JSON schema, at the roadside.
 *
 * `functions/api/v1/submit.ts` opens the pull request for them. The
 * contribution still lands somewhere public and reviewable - that is the whole
 * reason the archive is worth reading - and the person does not have to know
 * git to make it.
 *
 * =============================================================================
 * THE PHOTO GOES FIRST, AND ONLY AFTER IT IS STRIPPED
 * =============================================================================
 * `features/report/preparePhoto.ts` re-encodes a photograph through a canvas,
 * so the output is built from pixels alone and no EXIF block - GPS, timestamp,
 * device serial, or the embedded thumbnail that carries its own GPS - exists in
 * it to begin with.
 *
 * THAT MUST HAVE HAPPENED BEFORE THE BYTES REACH THIS FILE. A photograph taken
 * on a phone carries the driver's exact position welded into it, and uploading
 * one on THIS product would be the worst bug available. So this refuses any
 * attachment not marked as stripped, rather than trusting a caller to remember.
 */

const SUBMIT_URL = '/api/v1/submit';
const PHOTO_URL = '/api/v1/photo';

/** What a driver can say is wrong. Mirrors the API's own allowlist. */
export type CorrectionField =
  | 'operator'
  | 'brand'
  | 'ownerType'
  | 'direction'
  | 'position'
  | 'mount'
  | 'gone'
  | 'other';

export type CorrectionKind = 'correction' | 'new-camera' | 'removed';

export interface StrippedPhoto {
  readonly bytes: Blob;
  /**
   * Proof the re-encode happened. Not a hint - this is refused when false, and
   * `preparePhoto` is the only thing that may set it.
   */
  readonly metadataStripped: true;
}

export interface Correction {
  readonly kind: CorrectionKind;
  readonly cameraId?: string | undefined;
  readonly lat?: number | undefined;
  readonly lon?: number | undefined;
  readonly field?: CorrectionField | undefined;
  /** What the archive currently says, so a reviewer can see the delta. */
  readonly wrong?: string | undefined;
  readonly right?: string | undefined;
  readonly note?: string | undefined;
  readonly contact?: string | undefined;
  readonly photo?: StrippedPhoto | undefined;
}

export interface Shared {
  /** The pull request. The receipt, and the thing a person can watch. */
  readonly url: string;
  readonly duplicate: boolean;
}

export class ShareRefused extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(detail);
    this.name = 'ShareRefused';
    this.code = code;
  }
}

async function readError(response: Response): Promise<ShareRefused> {
  let code = 'unknown';
  let detail = `the archive answered ${String(response.status)}`;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;
      if (typeof record['error'] === 'string') code = record['error'];
      /*
       * The server's own sentence, not a generic one. Those messages say the
       * specific constraint that failed - a box too wide, a field not on the
       * allowlist - and replacing them with "submission failed" throws away
       * the only part a person can act on.
       */
      if (typeof record['detail'] === 'string') detail = record['detail'];
    }
  } catch {
    // A non-JSON error body is itself worth reporting as the status alone.
  }
  return new ShareRefused(code, detail);
}

/**
 * Upload the photograph, and return the key the submission refers to it by.
 *
 * Separate from the submission so a photo that fails to upload does not lose
 * the correction: the caller can still send the text, and a correction with no
 * picture is worth strictly more than nothing.
 */
async function uploadPhoto(photo: StrippedPhoto, fetchImpl: typeof fetch): Promise<string> {
  if (photo.metadataStripped !== true) {
    throw new ShareRefused(
      'photo_not_stripped',
      'this photograph still carries its original metadata and will not be sent',
    );
  }
  const response = await fetchImpl(PHOTO_URL, {
    method: 'PUT',
    headers: { 'content-type': photo.bytes.type || 'image/jpeg' },
    body: photo.bytes,
  });
  if (!response.ok) throw await readError(response);
  const body = (await response.json()) as { key?: unknown };
  if (typeof body.key !== 'string') {
    throw new ShareRefused('photo_no_key', 'the archive stored the photo but returned no key');
  }
  return body.key;
}

/**
 * Send one correction. Resolves with the pull request it opened.
 *
 * Throws `ShareRefused` carrying the server's own explanation, so the sheet can
 * show a person what to change rather than "something went wrong".
 */
export async function shareCorrection(
  correction: Correction,
  fetchImpl: typeof fetch = fetch,
): Promise<Shared> {
  let photoKey: string | null = null;
  if (correction.photo !== undefined) {
    photoKey = await uploadPhoto(correction.photo, fetchImpl);
  }

  const response = await fetchImpl(SUBMIT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: correction.kind,
      cameraId: correction.cameraId ?? null,
      lat: correction.lat ?? null,
      lon: correction.lon ?? null,
      field: correction.field ?? null,
      wrong: correction.wrong ?? null,
      right: correction.right ?? null,
      note: correction.note ?? '',
      photoKey,
      contact: correction.contact ?? null,
    }),
  });

  if (!response.ok) throw await readError(response);

  const body = (await response.json()) as { url?: unknown; duplicate?: unknown };
  return {
    url: typeof body.url === 'string' ? body.url : '',
    /*
     * The API keys a branch on the CONTENT, so the same correction sent twice
     * lands on one pull request. Saying "you already sent this" is friendlier
     * and more accurate than a second success that quietly did nothing.
     */
    duplicate: body.duplicate === true,
  };
}
