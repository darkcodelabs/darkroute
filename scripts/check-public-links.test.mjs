/**
 * THE TWO RULES THAT ARE EASY TO GET BACKWARDS.
 *
 *   1. A 200 is not reachability. `darkroute.ai` answers 200 with the same
 *      parking page for every path, including one that cannot exist. The gate
 *      exists partly because a status-code check would have certified a licence
 *      obligation against that page.
 *   2. An allowance that starts WORKING is a failure. That reads wrong until
 *      you remember what the allowance is for: it is a note saying six
 *      documents are hedged around a private repository. When the repository
 *      opens, somebody has to go unhedge them, and this is the only thing that
 *      will tell them.
 *
 * No network here. `classify` and `verdict` are pure, which is why the probing
 * was split away from them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  allowanceFor,
  classify,
  declaredRepoPublic,
  missingRequiredPublicUrls,
  ownedUrls,
  parseArgs,
  PUBLIC_LIVE_URLS,
  repoFlagVerdict,
  repoStateFromProbe,
  verdict,
} from './check-public-links.mjs';

const ALLOWED = 'https://github.com/darkcodelabs/darkroute';
const NOT_ALLOWED = 'https://darkroute.ai/docs';

const res = (status, bytes, extra = {}) => ({ status, bytes, redirect: null, ...extra });

describe('classify', () => {
  it('calls a real page reachable when it differs from a path that cannot exist', () => {
    assert.equal(classify(res(200, 4096), res(404, 120)).state, 'reachable');
  });

  it('calls a catch-all host soft-404, however green its status code is', () => {
    // The live case: Squarespace parking, 200 text/html for every path.
    assert.equal(classify(res(200, 2310), res(200, 2310)).state, 'soft-404');
  });

  it('separates gated from missing, because they need opposite fixes', () => {
    // Behind Cloudflare Access is a deployment decision. A 404 is a defect.
    assert.equal(
      classify(res(302, 0, { redirect: 'https://x.cloudflareaccess.com/login' }), res(302, 0))
        .state,
      'gated',
    );
    assert.equal(classify(res(403, 0), res(404, 0)).state, 'gated');
    assert.equal(classify(res(404, 0), res(404, 0)).state, 'missing');
  });

  it('reports a transport failure as error rather than as a missing page', () => {
    assert.equal(classify({ error: 'ENOTFOUND', status: 0, bytes: 0 }, res(0, 0)).state, 'error');
  });
});

describe('verdict', () => {
  it('fails an undeclared URL that does not resolve', () => {
    assert.equal(verdict(NOT_ALLOWED, 'missing').ok, false);
    assert.equal(verdict(NOT_ALLOWED, 'soft-404').ok, false);
  });

  it('fails a transport error instead of turning an unchecked URL green', () => {
    assert.equal(verdict(NOT_ALLOWED, 'error').ok, false);
  });

  it('requires the production security contact to be public at cutover', () => {
    const [securityTxt] = PUBLIC_LIVE_URLS;
    assert.equal(verdict(securityTxt, 'reachable', [], PUBLIC_LIVE_URLS).ok, true);
    assert.equal(verdict(securityTxt, 'gated', [], PUBLIC_LIVE_URLS).ok, false);
    assert.equal(verdict(securityTxt, 'soft-404', [], PUBLIC_LIVE_URLS).ok, false);

    // A gated development URL remains valid in the ordinary pre-release check.
    assert.equal(verdict('https://dev.darkroute.ai/docs', 'gated').ok, true);
  });

  it('passes a declared pre-release gap', () => {
    assert.equal(verdict(ALLOWED, 'missing').ok, true);
  });

  it('FAILS a declared gap that has started resolving', () => {
    // The forcing function. Release day breaks this gate on purpose.
    const { ok, note } = verdict(ALLOWED, 'reachable');
    assert.equal(ok, false);
    assert.match(note, /STALE ALLOWANCE/);
  });

  it('matches an allowance by prefix, so sub-paths inherit it', () => {
    assert.notEqual(allowanceFor(`${ALLOWED}/blob/main/docs/public/AUDITING.md`), null);
    assert.equal(allowanceFor('https://github.com/darkcodelabs/something-else'), null);
  });
});

describe('ownedUrls', () => {
  it('strips the punctuation a sentence leaves on the end of a URL', () => {
    // Otherwise the gate reports a 404 that belongs to the regex.
    assert.deepEqual(ownedUrls(`see ${ALLOWED}.`), [ALLOWED]);
    assert.deepEqual(ownedUrls(`see ${ALLOWED},`), [ALLOWED]);
  });

  it('keeps a .git suffix, which is a real path and not punctuation', () => {
    assert.deepEqual(ownedUrls(`git clone ${ALLOWED}.git`), [`${ALLOWED}.git`]);
  });

  it('ignores hosts this project cannot fix', () => {
    // A gate that fails on somebody else's outage gets switched off.
    assert.deepEqual(
      ownedUrls('https://www.openstreetmap.org/copyright and https://osmfoundation.org'),
      [],
    );
  });

  it('finds a URL inside a markdown link and inside a code fence', () => {
    assert.deepEqual(ownedUrls(`[docs](${ALLOWED})`), [ALLOWED]);
    assert.deepEqual(ownedUrls(`\`${ALLOWED}\``), [ALLOWED]);
  });
});

describe('repoFlagVerdict', () => {
  it('passes when the app agrees with the world, in both directions', () => {
    assert.equal(repoFlagVerdict(false, 'missing').ok, true);
    assert.equal(repoFlagVerdict(true, 'reachable').ok, true);
  });

  it('fails when the app says public and the repository 404s', () => {
    // The worse direction: users are told to go read documents that are gone.
    assert.equal(repoFlagVerdict(true, 'missing').ok, false);
  });

  it('fails when the repository opened and nobody told the app', () => {
    const { ok, note } = repoFlagVerdict(false, 'reachable');
    assert.equal(ok, false);
    assert.match(note, /Set it true/);
  });

  it('fails rather than assuming when the constant cannot be read', () => {
    assert.equal(repoFlagVerdict(null, 'missing').ok, false);
  });
});

describe('repoStateFromProbe', () => {
  it('keeps checking the canonical repo after the pre-release allowance is removed', () => {
    assert.equal(repoStateFromProbe(ALLOWED, 'reachable'), 'reachable');
    assert.equal(repoStateFromProbe(`${ALLOWED}.git`, 'reachable'), null);
    assert.equal(repoStateFromProbe(NOT_ALLOWED, 'missing'), null);
  });
});

describe('declaredRepoPublic', () => {
  it('reads the constant out of the module source', () => {
    assert.equal(declaredRepoPublic('export const REPO_PUBLIC = false;'), false);
    assert.equal(declaredRepoPublic('export const REPO_PUBLIC = true;'), true);
    assert.equal(declaredRepoPublic('nothing here'), null);
  });
});

describe('parseArgs', () => {
  it('makes the public-production requirement explicit and fail-closed', () => {
    assert.deepEqual(parseArgs([]), { requirePublicLive: false });
    assert.deepEqual(parseArgs(['--require-public-live']), { requirePublicLive: true });
    assert.throws(() => parseArgs(['--unknown']), /unknown or duplicate/);
    assert.throws(
      () => parseArgs(['--require-public-live', '--require-public-live']),
      /unknown or duplicate/,
    );
  });
});

describe('missingRequiredPublicUrls', () => {
  it('fails closed if the required launch URL disappears from the source scan', () => {
    assert.deepEqual(missingRequiredPublicUrls([], PUBLIC_LIVE_URLS), PUBLIC_LIVE_URLS);
    assert.deepEqual(missingRequiredPublicUrls(PUBLIC_LIVE_URLS, PUBLIC_LIVE_URLS), []);
  });
});
