/**
 * A PHOTO ATTACHED TO A SUBMISSION.
 *
 * =============================================================================
 * WHY A PHOTO CHANGES THE VALUE OF A REPORT
 * =============================================================================
 * "the brand is wrong on this one" is a claim. A photograph of the unit with
 * the maker's name on it is evidence, and it turns a submission a reviewer has
 * to travel to verify into one they can settle from a desk.
 *
 * That is the whole reason this exists. It is not a gallery.
 *
 * =============================================================================
 * WHAT IS DELIBERATELY NOT KEPT
 * =============================================================================
 * The key is a hash of the BYTES, so the same photo uploaded twice is one
 * object rather than two. Nothing else is recorded: no uploader, no address, no
 * time of upload beyond what R2 keeps of its own accord.
 *
 * EXIF IS NOT STRIPPED HERE and the app must strip it before uploading - see
 * the note on the upload path. Doing it server-side would mean the original,
 * with its GPS tag and its camera serial, arriving here first. On a product
 * about not being tracked, the moment to remove that is before it leaves the
 * phone, not after it lands.
 */

interface Env {
  readonly SUBMISSION_PHOTOS?: R2Bucket;
}

export const MAX_BYTES = 6 * 1024 * 1024;

/** Media type -> stored extension. Exported so the spec and the tests read the same list. */
export const TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** The only key shape this service ever issues: 32 hex of the content hash plus the extension. */
export const PHOTO_KEY = /^[0-9a-f]{32}\.(jpg|png|webp)$/;

function json(status: number, body: unknown): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

/** Store one photo. Returns the key a submission refers to it by. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const bucket = context.env.SUBMISSION_PHOTOS;
  if (bucket === undefined) {
    return json(503, {
      error: 'photos_unconfigured',
      detail: 'this deployment has nowhere to put a photo; nothing was stored',
    });
  }

  // The bare media type, decided once: it picks the extension AND is what gets
  // stored, so deriving it twice is how those two drift apart.
  const mediaType = (context.request.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  const extension = TYPES[mediaType];
  if (extension === undefined) {
    return json(415, {
      error: 'unsupported_type',
      detail: `send image/jpeg, image/png or image/webp — got ${mediaType || 'nothing'}`,
    });
  }

  const bytes = await context.request.arrayBuffer();
  if (bytes.byteLength === 0) return json(400, { error: 'empty', detail: 'no bytes' });
  if (bytes.byteLength > MAX_BYTES) {
    return json(413, {
      error: 'too_large',
      detail: `a photo may be at most ${String(MAX_BYTES / 1024 / 1024)} MB`,
    });
  }

  /*
   * KEYED BY CONTENT. The same photo sent twice is one object, which matters
   * because a flaky roadside connection retries - and because it means the key
   * carries no information about who sent it or when.
   */
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const id = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  const key = `${id}.${extension}`;

  await bucket.put(key, bytes, { httpMetadata: { contentType: mediaType } });

  return json(200, { ok: true, key, bytes: bytes.byteLength });
};

/** Serve one back, so a pull request can show it inline. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const bucket = context.env.SUBMISSION_PHOTOS;
  if (bucket === undefined) return json(503, { error: 'photos_unconfigured', detail: 'no store' });

  const key = String(context.params['key'] ?? '');
  // The key shape this service issues, and nothing else. A key that came from
  // a URL must never become an arbitrary object read.
  if (!PHOTO_KEY.test(key)) {
    return json(404, { error: 'not_found', detail: 'not a key this service issued' });
  }

  const object = await bucket.get(key);
  if (object === null) return json(404, { error: 'not_found', detail: 'no such photo' });

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      // Content-addressed, so it can never change under this key.
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
};
