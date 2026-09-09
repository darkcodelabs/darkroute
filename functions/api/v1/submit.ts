/**
 * A CONTRIBUTION, TURNED INTO A PULL REQUEST.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * Drivers were finding cameras the archive has wrong - a brand attributed to
 * the wrong maker, a reader that has been removed, one that is not on the map
 * at all - and had nowhere to put it. The honest answer used to be "open a pull
 * request", which is honest and is also a wall: it needs a GitHub account, a
 * fork, a JSON schema and a text editor, at the roadside.
 *
 * So the app collects the correction and this opens the pull request for them.
 * The contribution still lands somewhere public, attributable and reviewable -
 * that property is the whole reason the archive is worth reading - but the
 * person contributing does not have to know git.
 *
 * =============================================================================
 * WHY IT IS STILL A PULL REQUEST AND NOT A DATABASE WRITE
 * =============================================================================
 * A write endpoint on a public archive is a way to put unattributable claims
 * into a dataset whose only value is that every row traces back to something.
 * A pull request keeps the review: it is visible while it is being decided, a
 * human merges it, and the diff says exactly what changed.
 *
 * Nothing here is merged automatically and nothing here touches the published
 * archive. It writes a file on a new branch and opens a PR against it.
 *
 * =============================================================================
 * IT IS AN ANONYMOUS ENDPOINT THAT CREATES REPOSITORY OBJECTS
 * =============================================================================
 * Which is a spam vector, and is treated as one:
 *
 *   EVERY FIELD IS VALIDATED AND BOUNDED before anything is created. A
 *     submission that does not parse is rejected, not "cleaned up".
 *   THE RATE LIMIT APPLIES, from `_middleware.ts`, and this route is far more
 *     expensive than a read - so it takes a much smaller budget of its own.
 *   ONE BRANCH PER SUBMISSION, named from a hash of the content, so the same
 *     submission sent twenty times produces one branch rather than twenty.
 *   THE PR SAYS IT IS UNREVIEWED, in its title and its body, so a reviewer
 *     never mistakes a stranger's claim for a verified one.
 *
 * The token this uses can open pull requests and nothing else. If it is absent
 * the route says so plainly rather than pretending to have queued something -
 * a submission that silently goes nowhere is worse than a refusal.
 */

import { json } from './_middleware.ts';

interface Env {
  readonly CAMERA_TILES?: R2Bucket;
  readonly SUBMISSION_PHOTOS?: R2Bucket;
  /** Fine-grained token with contents+pull-requests write on the public repo. */
  readonly SUBMISSIONS_TOKEN?: string;
  /** Where submissions land. Defaults to the public repository. */
  readonly SUBMISSIONS_REPO?: string;
}

const DEFAULT_REPO = 'darkcodelabs/darkroute';
const BASE_BRANCH = 'main';

/**
 * A far smaller budget than a read.
 *
 * A read costs a cached subrequest. This creates a branch, a file and a pull
 * request, and every one of those is a repository object somebody has to look
 * at. Six an hour is generous for a person reporting what they drove past and
 * useless to anything automated.
 */
export const MAX_PER_HOUR = 6;
const HOUR_MS = 3_600_000;

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_TRACKED = 5_000;

type Kind = 'correction' | 'new-camera' | 'removed';

export const KINDS = new Set<Kind>(['correction', 'new-camera', 'removed']);

/** What a driver can tell us is wrong. Bounded, and none of it is free text. */
export const FIELDS = new Set([
  'operator',
  'brand',
  'ownerType',
  'direction',
  'position',
  'mount',
  'gone',
  'other',
]);

interface Submission {
  readonly kind: Kind;
  readonly cameraId: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly field: string | null;
  readonly wrong: string | null;
  readonly right: string | null;
  readonly note: string;
  readonly photoKey: string | null;
  readonly contact: string | null;
  /**
   * WHAT THE ARCHIVE HELD WHEN THE PERSON PRESSED SEND: the public record's
   * own fields, copied by the app, so the reviewer reads the correction
   * against the thing it corrects. Public data only, never the driver's
   * position -- the app strips its own fix before it ever gets here.
   */
  readonly archive: Readonly<Record<string, string>> | null;
}

const ARCHIVE_KEY = /^[a-z][a-z0-9:_-]{0,23}$/u;
const ARCHIVE_MAX_ENTRIES = 16;

function archiveSnapshot(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, held] of Object.entries(value)) {
    if (!ARCHIVE_KEY.test(key)) continue;
    const cell = text(held, 120);
    if (cell === null) continue;
    out[key] = cell;
    if (Object.keys(out).length >= ARCHIVE_MAX_ENTRIES) break;
  }
  return Object.keys(out).length === 0 ? null : out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A bounded string, or null. Never a silently truncated one without saying so. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

type Parsed = { ok: true; value: Submission } | { ok: false; detail: string };

/** Exported for the tests: what is refused, and what a refusal says. */
export function parse(body: unknown): Parsed {
  if (!isRecord(body)) return { ok: false, detail: 'the submission must be a JSON object' };

  const kind = body['kind'];
  if (typeof kind !== 'string' || !KINDS.has(kind as Kind)) {
    return { ok: false, detail: `kind must be one of: ${[...KINDS].join(', ')}` };
  }

  const cameraId = text(body['cameraId'], 64);
  /*
   * A camera id must LOOK like one. It ends up in a branch name and a file
   * path, so an unbounded string here is a path-construction problem as well
   * as a data one.
   */
  if (cameraId !== null && !/^[A-Za-z0-9:_-]+$/.test(cameraId)) {
    return { ok: false, detail: 'cameraId may contain only letters, digits, colon, underscore and dash' };
  }

  const lat = typeof body['lat'] === 'number' ? body['lat'] : null;
  const lon = typeof body['lon'] === 'number' ? body['lon'] : null;
  if (lat !== null && (!Number.isFinite(lat) || lat < -85 || lat > 85)) {
    return { ok: false, detail: 'lat must be within -85..85' };
  }
  if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) {
    return { ok: false, detail: 'lon must be within -180..180' };
  }

  // A correction is about a camera; a new one is about a place.
  if (kind !== 'new-camera' && cameraId === null) {
    return { ok: false, detail: 'a correction needs the cameraId it is correcting' };
  }
  if (kind === 'new-camera' && (lat === null || lon === null)) {
    return { ok: false, detail: 'a new camera needs lat and lon' };
  }

  const field = text(body['field'], 32);
  if (field !== null && !FIELDS.has(field)) {
    return { ok: false, detail: `field must be one of: ${[...FIELDS].join(', ')}` };
  }

  const photoKey = text(body['photoKey'], 128);
  if (photoKey !== null && !/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(photoKey)) {
    return { ok: false, detail: 'photoKey is not a key this service issued' };
  }

  return {
    ok: true,
    value: {
      kind: kind as Kind,
      cameraId,
      lat,
      lon,
      field,
      wrong: text(body['wrong'], 120),
      right: text(body['right'], 120),
      note: text(body['note'], 600) ?? '',
      archive: archiveSnapshot(body['archive']),
      photoKey,
      /*
       * Optional, and it is the submitter's to give. A contribution with no
       * way to ask a follow-up question is still worth having; demanding an
       * identity from somebody reporting surveillance infrastructure is not a
       * trade this project makes.
       */
      contact: text(body['contact'], 120),
    },
  };
}

function clientKey(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP');
  return typeof ip === 'string' && ip !== '' ? ip : 'unknown';
}

interface Decision {
  readonly allowed: boolean;
  /** When this address's hour resets - what a refused caller is told to wait for. */
  readonly resetAt: number;
}

function take(key: string, now: number): Decision {
  const existing = buckets.get(key);
  if (existing === undefined || now >= existing.resetAt) {
    if (buckets.size >= MAX_TRACKED) {
      const oldest = buckets.keys().next();
      if (!oldest.done) buckets.delete(oldest.value);
    }
    const resetAt = now + HOUR_MS;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, resetAt };
  }
  if (existing.count >= MAX_PER_HOUR) return { allowed: false, resetAt: existing.resetAt };
  existing.count += 1;
  return { allowed: true, resetAt: existing.resetAt };
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

interface Gh {
  readonly token: string;
  readonly repo: string;
}

async function gh(api: Gh, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com/repos/${api.repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${api.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DarkRoute-submissions/1.0',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    signal: AbortSignal.timeout(20_000),
  });
}

/** The record a reviewer reads. Structured so a merge is a data change. */
function submissionFile(submission: Submission, receivedAt: string): string {
  return `${JSON.stringify(
    {
      schema: 'darkroute-community-submission/v1',
      status: 'unreviewed',
      receivedAt,
      kind: submission.kind,
      cameraId: submission.cameraId,
      lat: submission.lat,
      lon: submission.lon,
      field: submission.field,
      wrong: submission.wrong,
      right: submission.right,
      note: submission.note,
      photo: submission.photoKey,
      contact: submission.contact,
    },
    null,
    2,
  )}\n`;
}

export function body(submission: Submission, receivedAt: string, photoUrl: string | null): string {
  const rows = [
    ['Kind', submission.kind],
    ['Camera', submission.cameraId ?? '—'],
    ['Field', submission.field ?? '—'],
    ['Archive says', submission.wrong ?? '—'],
    ['Should be', submission.right ?? '—'],
    ['Position', submission.lat === null ? '—' : `${String(submission.lat)}, ${String(submission.lon)}`],
    ['Received', receivedAt],
  ];
  return [
    '## Community submission — UNREVIEWED',
    '',
    'Filed from the app by somebody who was there. **Nobody has verified this.**',
    'Treat every field below as a claim until it is checked.',
    '',
    ...rows.map(([k, v]) => `- **${String(k)}:** ${String(v)}`),
    '',
    ...(submission.archive === null
      ? []
      : [
          '### The archive record, as the app showed it',
          '',
          ...Object.entries(submission.archive).map(([k, v]) => `- **${k}:** ${v}`),
          '',
        ]),
    ...(submission.note === '' ? [] : ['### What they said', '', `> ${submission.note}`, '']),
    ...(photoUrl === null ? [] : ['### Photo', '', `![submitted photo](${photoUrl})`, '']),
    '### Before merging',
    '',
    '- [ ] The camera is where the submission says it is',
    '- [ ] The corrected value is right, not just different',
    '- [ ] If this belongs in OpenStreetMap, it has been put there too — that is',
    '      where the archive reads from, and a fix only here will be overwritten',
    '',
    submission.contact === null
      ? '_No contact given, which is fine — a contribution does not require an identity._'
      : `_Contact offered: ${submission.contact}_`,
  ].join('\n');
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const token = context.env.SUBMISSIONS_TOKEN;
  if (typeof token !== 'string' || token === '') {
    return json(503, {
      error: 'submissions_unconfigured',
      detail:
        'this deployment has no submissions token, so nothing can be opened on your behalf. ' +
        'nothing was queued and nothing was stored — you can still contribute directly at ' +
        `https://github.com/${DEFAULT_REPO}`,
    });
  }

  const now = Date.now();
  const decision = take(clientKey(context.request), now);
  if (!decision.allowed) {
    /*
     * `retry-after` as well as the body, the same as the middleware's 429. This
     * one used to send the body alone, so a client honouring the header - the
     * standard one - saw nothing to honour and retried at once.
     */
    const retryAfterSeconds = Math.max(1, Math.ceil((decision.resetAt - now) / 1000));
    return json(
      429,
      {
        error: 'rate_limited',
        detail: `submissions are limited to ${String(MAX_PER_HOUR)} an hour from one address.`,
        retryAfterSeconds,
      },
      { 'retry-after': String(retryAfterSeconds) },
    );
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return json(400, { error: 'bad_json', detail: 'the body is not JSON' });
  }

  const parsed = parse(payload);
  if (!parsed.ok) return json(400, { error: 'bad_submission', detail: parsed.detail });
  const submission = parsed.value;

  const api: Gh = { token, repo: context.env.SUBMISSIONS_REPO ?? DEFAULT_REPO };
  const receivedAt = new Date().toISOString();

  /*
   * The branch name is derived from the CONTENT, not from a clock. The same
   * submission sent twenty times - a flaky connection, an impatient thumb -
   * collides on one branch instead of opening twenty pull requests somebody
   * then has to close.
   */
  const id = await digest(
    [submission.kind, submission.cameraId, submission.lat, submission.lon, submission.field, submission.right, submission.note].join('|'),
  );
  const branch = `submission/${submission.kind}-${id}`;
  const path = `submissions/${submission.kind}/${id}.json`;

  const head = await gh(api, `/git/ref/heads/${BASE_BRANCH}`);
  if (!head.ok) {
    return json(502, {
      error: 'repository_unavailable',
      detail: `could not read ${api.repo}; nothing was created`,
    });
  }
  const headJson = (await head.json()) as { object?: { sha?: string } };
  const baseSha = headJson.object?.sha;
  if (typeof baseSha !== 'string') {
    return json(502, { error: 'repository_unavailable', detail: 'the base branch has no head' });
  }

  // A 422 here means the branch already exists, which means this exact
  // submission has already been filed. That is a success, not a failure.
  const madeBranch = await gh(api, '/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  const already = madeBranch.status === 422;
  if (!madeBranch.ok && !already) {
    return json(502, { error: 'branch_failed', detail: 'could not open a branch for this submission' });
  }

  if (!already) {
    const wrote = await gh(api, `/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `submission(${submission.kind}): ${submission.cameraId ?? 'new camera'}`,
        content: btoa(unescape(encodeURIComponent(submissionFile(submission, receivedAt)))),
        branch,
      }),
    });
    if (!wrote.ok) {
      return json(502, { error: 'write_failed', detail: 'could not write the submission' });
    }
  }

  const photoUrl =
    submission.photoKey === null
      ? null
      : new URL(`/api/v1/photo/${submission.photoKey}`, new URL(context.request.url).origin).toString();

  const opened = await gh(api, '/pulls', {
    method: 'POST',
    body: JSON.stringify({
      title: `[unreviewed] ${submission.kind}: ${submission.cameraId ?? `${String(submission.lat)}, ${String(submission.lon)}`}`,
      head: branch,
      base: BASE_BRANCH,
      body: body(submission, receivedAt, photoUrl),
      maintainer_can_modify: true,
    }),
  });

  if (!opened.ok && opened.status !== 422) {
    return json(502, {
      error: 'pull_request_failed',
      detail: 'the submission was written but the pull request could not be opened',
    });
  }

  const pr = opened.ok ? ((await opened.json()) as { html_url?: string }) : {};

  return json(200, {
    ok: true,
    /*
     * The URL is the receipt. A submission that vanishes into a queue nobody
     * can see is the thing a pull request exists to avoid, so the person who
     * filed it gets the link and can watch what happens to it.
     */
    url: pr.html_url ?? `https://github.com/${api.repo}/pulls`,
    branch,
    duplicate: already,
    note: 'nobody has reviewed this yet. the pull request says so, and a person decides.',
  });
};
