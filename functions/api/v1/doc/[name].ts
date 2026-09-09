/**
 * A PUBLISHED DOCUMENT, FETCHED FROM GITHUB AND SERVED SAME-ORIGIN.
 *
 * =============================================================================
 * WHY A PROXY AND NOT A DIRECT FETCH
 * =============================================================================
 * The app's Content-Security-Policy is `connect-src 'self'
 * https://tiles.darkroute.ai`. Reading raw.githubusercontent.com from the page
 * would need that line widened, and that line is the enforcement boundary this
 * whole product advertises - it is tight enough that Cloudflare's own beacon
 * fails against it. Loosening it so a documentation screen can be prettier
 * would be a spectacularly bad trade.
 *
 * So the document is fetched HERE, server-side, and handed back from our own
 * origin. The bytes are still GitHub's: nothing is transformed, nothing is
 * summarised, and nothing is authored in this file. The app renders what the
 * repository says, which is the point - a documentation screen that paraphrases
 * its own repository is a second source of truth waiting to disagree.
 *
 * =============================================================================
 * WHY AN ALLOWLIST
 * =============================================================================
 * `name` comes from a URL. Without an allowlist this is an open proxy pointed
 * at GitHub with our origin's reputation attached, and a path parameter that
 * reaches a fetch is how a service ends up fetching something on somebody
 * else's behalf. The list below is the complete set; anything else is 404, not
 * an attempt.
 */

import { json } from '../_middleware.ts';

interface Env {
  readonly CAMERA_TILES?: R2Bucket;
}

const RAW = 'https://raw.githubusercontent.com/darkcodelabs/darkroute/main/docs/public';

/**
 * Every document this route will serve, and nothing else.
 *
 * Keyed by the short name the app uses so a URL never carries a path, only a
 * token this file already knows.
 */
export const DOCS: Readonly<Record<string, string>> = {
  /* The whole product in one document, written from the code that runs it and
     held to it by `scripts/writeup-currency.test.mjs`. Listed first because it
     is where a reader starts. */
  'what-darkroute-is': 'WHAT-DARKROUTE-IS.md',
  'data-contracts': 'DATA-CONTRACTS.md',
  taxonomy: 'TAXONOMY.md',
  legal: 'LEGAL.md',
  transparency: 'TRANSPARENCY.md',
  architecture: 'ARCHITECTURE.md',
  auditing: 'AUDITING.md',
  'threat-model': 'THREAT-MODEL.md',
  'data-provenance': 'DATA-PROVENANCE.md',
  api: 'API.md',
  security: 'SECURITY.md',
  terms: 'TERMS.md',
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const name = String(context.params['name'] ?? '');
  const file = DOCS[name];
  if (file === undefined) {
    return json(404, {
      error: 'unknown_document',
      detail: `no such document. available: ${Object.keys(DOCS).join(', ')}`,
    });
  }

  const upstream = await fetch(`${RAW}/${file}`, {
    headers: { accept: 'text/plain' },
    // A published document changes on a release, not on a request.
    cf: { cacheTtl: 900, cacheEverything: true },
  });

  if (!upstream.ok) {
    return json(502, {
      error: 'document_unavailable',
      detail:
        `the published repository did not return ${file} (HTTP ${String(upstream.status)}). ` +
        'nothing is served from a cached copy here - a stale document about what the app does ' +
        'is worse than saying it could not be read.',
    });
  }

  const text = await upstream.text();

  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=900',
      /* Said in a header so a caller who never reads the docs still learns the
         bytes are not ours to relicense. */
      'x-darkroute-source': `${RAW}/${file}`,
    },
  });
};
