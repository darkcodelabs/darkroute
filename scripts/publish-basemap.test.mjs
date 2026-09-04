import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

import {
  BASEMAP_BUCKET,
  BROWSER_ORIGINS,
  assertBasemapBucket,
  checkBucketPosture,
  resolvePublishIdentity,
  verifyCors,
  verifyLive,
} from './publish-basemap.mjs';

const execFileAsync = promisify(execFile);

const PUBLIC_BASE = 'https://tiles.example.test';
const OBJECT_KEY = 'basemap-us-20260901.pmtiles';
const OBJECT_URL = `${PUBLIC_BASE}/${OBJECT_KEY}`;

function responseFor(url, origin, overrides = {}) {
  const bodyBytes = overrides.bodyBytes ?? 16;
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'access-control-allow-origin': origin,
    'access-control-expose-headers': 'ETag, Content-Range, Accept-Ranges, Content-Length',
    'content-length': '16',
    'content-range': 'bytes 0-15/4952557419',
    etag: '"archive-etag-74"',
    vary: 'Accept-Encoding, Origin',
    ...overrides.headers,
  });
  return {
    status: overrides.status ?? 206,
    redirected: overrides.redirected ?? false,
    url: overrides.url ?? url,
    headers,
    body: null,
    arrayBuffer: async () => new Uint8Array(bodyBytes).buffer,
  };
}

function passingFetch(overridesForOrigin = () => ({})) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const origin = options.headers.Origin;
    return responseFor(url, origin, overridesForOrigin(origin));
  };
  return { calls, fetchImpl };
}

function listingClient(value = { Contents: [{ Key: OBJECT_KEY }] }) {
  const commands = [];
  return {
    commands,
    client: {
      async send(command) {
        commands.push(command);
        if (value instanceof Error) throw value;
        return value;
      },
    },
  };
}

describe('basemap browser CORS contract', () => {
  it('pins publication and CORS changes to the bucket behind tiles.darkroute.ai', () => {
    assert.equal(BASEMAP_BUCKET, 'flockys-tiles');
    assert.equal(assertBasemapBucket('flockys-tiles'), 'flockys-tiles');
    assert.throws(() => assertBasemapBucket('darkroute-cameras'), /reviewed basemap bucket/);
  });

  it('checks in an R2 policy with no duplicate and no retired origin', () => {
    /*
     * THE RULES, NOT A TRANSCRIPT.
     *
     * This asserted a literal copy of the list, so a rebrand sweep that
     * rewrote the origins rewrote the assertion too - and the test went on
     * passing while the policy had gained two duplicate entries and lost the
     * `*.pages.dev` origin the Pages project actually serves. A test that has
     * to be hand-edited alongside the thing it checks is checking nothing.
     */
    const policy = JSON.parse(
      readFileSync(new URL('basemap-r2-cors.json', import.meta.url), 'utf8'),
    );
    const origins = policy.rules[0].allowed.origins;

    assert.equal(new Set(origins).size, origins.length, 'duplicate origin in the policy');
    for (const dead of ['flockpick', 'flockyswatchingme']) {
      assert.ok(
        !origins.some((o) => o.includes(dead)),
        `retired origin still granted: ${dead}`,
      );
    }
    // The four that must be able to read tiles, or somebody gets a black map.
    for (const required of [
      'https://darkroute.ai',
      'https://www.darkroute.ai',
      'https://dev.darkroute.ai',
      // The URL `wrangler pages deploy` prints. Ungranted for the whole life
      // of this project, which meant every pre-domain deploy check saw a map
      // that could not load its own ground.
      'https://darkroute.pages.dev',
    ]) {
      assert.ok(origins.includes(required), `origin not granted: ${required}`);
    }
    // Local development must keep working.
    assert.ok(origins.some((o) => o.startsWith('http://localhost:')));
    assert.deepEqual(policy.rules[0].allowed.methods, ['GET', 'HEAD']);
  });

  it('takes the immutable key from the verified receipt and rejects legacy flag drift', () => {
    const receipt = {
      publish: {
        objectKey: 'basemap-us-20260901-full-us.pmtiles',
        osm: '2026-09-01T04:00:00Z',
        suffix: 'full-us',
      },
    };
    assert.deepEqual(resolvePublishIdentity(receipt, ['--dry-run']), {
      dryRun: true,
      objectKey: 'basemap-us-20260901-full-us.pmtiles',
      osm: '2026-09-01T04:00:00Z',
    });
    assert.deepEqual(
      resolvePublishIdentity(receipt, ['--osm', '2026-09-01T04:00:00Z', '--suffix', 'full-us']),
      {
        dryRun: false,
        objectKey: 'basemap-us-20260901-full-us.pmtiles',
        osm: '2026-09-01T04:00:00Z',
      },
    );
    assert.throws(
      () => resolvePublishIdentity(receipt, ['--suffix', 'conus']),
      /disagrees with verified receipt/,
    );
    assert.throws(
      () => resolvePublishIdentity(receipt, ['--osm', '2026-09-02T00:00:00Z']),
      /disagrees with verified receipt/,
    );
    assert.throws(() => resolvePublishIdentity(receipt, ['--force']), /unknown publish argument/);
  });

  it('refuses an archive without a verified receipt before credentials or R2 are consulted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'basemap-publish-gate-'));
    const archive = join(directory, 'unverified.pmtiles');
    writeFileSync(archive, 'not publishable');
    await assert.rejects(
      execFileAsync(process.execPath, ['scripts/publish-basemap.mjs', archive, '--dry-run'], {
        cwd: new URL('..', import.meta.url),
        env: {
          PATH: process.env.PATH,
        },
      }),
      (error) => {
        assert.match(error.stderr, /verified basemap receipt is missing/);
        assert.doesNotMatch(error.stderr, /credentials|R2_ACCOUNT_ID/);
        return true;
      },
    );
  });

  it('derives its origins from the checked-in policy rather than keeping a copy', () => {
    // Two hand-maintained copies drifted: the sweep that fixed one duplicated
    // entries in the other, and this script is the one that WRITES the policy
    // to the bucket - so running it would have restored the broken list over a
    // corrected one. There is one list now, and this proves it is that list.
    const policy = JSON.parse(
      readFileSync(new URL('basemap-r2-cors.json', import.meta.url), 'utf8'),
    );
    assert.deepEqual(BROWSER_ORIGINS, policy.rules[0].allowed.origins);
  });

  it('proves every origin with an exact, non-redirecting 16-byte range read', async () => {
    const { calls, fetchImpl } = passingFetch();
    const { client, commands } = listingClient();

    assert.equal(await checkBucketPosture(PUBLIC_BASE, client, 'tiles', fetchImpl), null);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].input.Prefix, 'basemap-us-');
    assert.equal(commands[0].input.MaxKeys, 1);
    assert.deepEqual(
      calls.map(({ options }) => options.headers.Origin),
      BROWSER_ORIGINS,
    );
    for (const { url, options } of calls) {
      assert.equal(url, OBJECT_URL);
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Range, 'bytes=0-15');
    }
  });

  it('blocks a publish when only darkroute.ai is absent from the live allowlist', async () => {
    const { fetchImpl } = passingFetch((origin) =>
      origin === 'https://darkroute.ai' ? { headers: { 'access-control-allow-origin': '' } } : {},
    );
    const { client } = listingClient();

    const problem = await checkBucketPosture(PUBLIC_BASE, client, 'tiles', fetchImpl);
    assert.match(problem, /BUCKET NOT FIT TO SERVE/);
    assert.match(problem, /https:\/\/darkroute\.ai: access-control-allow-origin ""/);
    assert.doesNotMatch(problem, /https:\/\/dev\.darkroute\.ai:/);
  });

  it('fails closed when posture cannot be listed or a probe cannot be fetched', async () => {
    const { client } = listingClient(new Error('access denied'));
    assert.match(
      await checkBucketPosture(PUBLIC_BASE, client, 'tiles', async () => {
        throw new Error('unreachable');
      }),
      /BUCKET POSTURE UNKNOWN.*access denied/s,
    );

    await assert.rejects(
      verifyCors(PUBLIC_BASE, OBJECT_KEY, async () => {
        throw new Error('network down');
      }),
      /PUBLISHED OBJECT FAILED CORS VERIFICATION.*network down/s,
    );
  });

  it('rejects redirects, final-URL drift, incomplete exposure, and short bodies', async () => {
    const { fetchImpl } = passingFetch((origin) =>
      origin === 'https://www.darkroute.ai'
        ? {
            bodyBytes: 15,
            redirected: true,
            url: 'https://wrong.example.test/archive.pmtiles',
            headers: {
              'access-control-expose-headers': 'ETag, Content-Range, Accept-Ranges',
            },
          }
        : {},
    );

    await assert.rejects(verifyCors(PUBLIC_BASE, OBJECT_KEY, fetchImpl), (error) => {
      assert.match(error.message, /response followed a redirect/);
      assert.match(error.message, /final URL "https:\/\/wrong\.example\.test/);
      assert.match(error.message, /content-length is not exposed/);
      assert.match(error.message, /body contained 15 bytes/);
      return true;
    });
  });

  it('refuses a live manifest that redirects or points outside R2_PUBLIC_BASE', async () => {
    await assert.rejects(
      verifyLive(PUBLIC_BASE, async (url) =>
        responseFor(url, '', {
          status: 302,
          redirected: true,
          url: 'https://wrong.example.test/basemap.json',
        }),
      ),
      /LIVE BASEMAP MANIFEST: HTTP 302/,
    );

    const body = JSON.stringify({ url: 'https://wrong.example.test/archive.pmtiles' });
    await assert.rejects(
      verifyLive(PUBLIC_BASE, async (url) => ({
        ...responseFor(url, ''),
        status: 200,
        headers: new Headers({
          'content-length': String(Buffer.byteLength(body)),
          'content-type': 'application/json',
        }),
        arrayBuffer: async () => Buffer.from(body),
      })),
      /is not under https:\/\/tiles\.example\.test\//,
    );
  });

  it('runs --verify-live end to end without credentials or writes', async () => {
    const requests = [];
    const server = createServer((request, response) => {
      requests.push({ headers: request.headers, url: request.url });
      if (request.url === '/basemap.json') {
        const address = server.address();
        const body = JSON.stringify({
          url: `http://127.0.0.1:${String(address.port)}/${OBJECT_KEY}`,
        });
        response.writeHead(200, {
          'content-length': String(Buffer.byteLength(body)),
          'content-type': 'application/json',
        });
        response.end(body);
        return;
      }
      if (request.url === `/${OBJECT_KEY}`) {
        const origin = request.headers.origin;
        response.writeHead(206, {
          'accept-ranges': 'bytes',
          'access-control-allow-origin': origin,
          'access-control-expose-headers': 'ETag, Content-Range, Accept-Ranges, Content-Length',
          'content-length': '16',
          'content-range': 'bytes 0-15/4952557419',
          etag: '"archive-etag-74"',
          vary: 'Origin',
        });
        response.end(Buffer.alloc(16, 7));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      const base = `http://127.0.0.1:${String(address.port)}`;
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['scripts/publish-basemap.mjs', '--verify-live'],
        {
          cwd: new URL('..', import.meta.url),
          env: { ...process.env, R2_PUBLIC_BASE: base },
        },
      );
      assert.equal(stderr, '');
      // The COUNT comes from the policy, not from a number typed here: this
      // said 5 while the policy held 12, and a literal has to be re-typed
      // every time an origin is added, which is when it stops being checked.
      assert.match(stdout, new RegExp(`${String(BROWSER_ORIGINS.length)} origins x 16 exact bytes`));
      assert.match(stdout, new RegExp(`archive : ${base}/${OBJECT_KEY}`));
      // One probe per granted origin, counted from the policy for the same
      // reason as above.
      assert.equal(
        requests.filter(({ url }) => url === `/${OBJECT_KEY}`).length,
        BROWSER_ORIGINS.length,
      );
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });
});
