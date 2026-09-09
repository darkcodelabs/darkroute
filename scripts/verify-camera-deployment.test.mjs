import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  approvedCameraSourceFixture,
  makeCameraFixture,
} from './camera-generation-test-helpers.mjs';
import {
  accessHeaders,
  parseVerificationArgs,
  verifiedOrigin,
  verifyCameraDeployment,
} from './verify-camera-deployment.mjs';

test('verification CLI requires explicit target, state, and an exact owned origin', () => {
  assert.deepEqual(
    parseVerificationArgs([
      '--target=/tmp/cameras',
      '--state-file=/tmp/state.json',
      '--origin=https://dev.darkroute.ai',
    ]),
    {
      target: '/tmp/cameras',
      stateFile: '/tmp/state.json',
      origin: 'https://dev.darkroute.ai',
    },
  );
  assert.throws(() => parseVerificationArgs([]), /--target is required/);
  assert.throws(
    () => verifiedOrigin('https://attacker.invalid/'),
    /not an exact approved DarkRoute origin/,
  );
  assert.throws(
    () => verifiedOrigin('https://dev.darkroute.ai/other'),
    /not an exact approved DarkRoute origin/,
  );
});

test('Access service-token headers are all-or-nothing', () => {
  assert.deepEqual(accessHeaders({}), {});
  assert.deepEqual(
    accessHeaders({
      CF_ACCESS_SERVICE_CLIENT_ID: 'client-id',
      CF_ACCESS_SERVICE_CLIENT_SECRET: 'client-secret',
    }),
    {
      'CF-Access-Client-Id': 'client-id',
      'CF-Access-Client-Secret': 'client-secret',
    },
  );
  assert.throws(
    () => accessHeaders({ CF_ACCESS_SERVICE_CLIENT_ID: 'client-id' }),
    /set both/,
  );
});

test('post-publish verification binds the route header and bytes to a deep hydrated generation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'camera-deployment-verify-'));
  try {
    const approved = approvedCameraSourceFixture();
    const basePointer = {
      schema: 'darkroute-camera-pointer/v1',
      slot: 'a',
      generation: '3'.repeat(64),
      manifestSha256: '4'.repeat(64),
      previous: null,
      updatedAt: '2026-09-01T10:00:00.000Z',
    };
    const fixture = await makeCameraFixture(root, {
      versionsKnown: true,
      osmVersion: 1,
      cameraSource: approved.marker,
      baseUpstream: approved.minimumOsmBase,
      basePointer,
    });
    const expected = new Map([
      ['/cameras/index.json', readFileSync(join(fixture.archive, 'index.json'))],
      ['/cameras/continuity.json', readFileSync(join(fixture.archive, 'continuity.json'))],
    ]);
    const requests = [];
    const result = await verifyCameraDeployment({
      target: fixture.archive,
      stateFile: fixture.stateFile,
      origin: 'https://dev.darkroute.ai',
      nonce: 'fixed',
      env: {
        CF_ACCESS_SERVICE_CLIENT_ID: 'id',
        CF_ACCESS_SERVICE_CLIENT_SECRET: 'secret',
      },
      validation: {
        minTiles: 1,
        minCameras: 1,
        trustedReviewBytes: approved.trustedReviewBytes,
      },
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return {
          ok: true,
          status: 200,
          url,
          headers: new Headers({
            'content-type': 'application/json; charset=utf-8',
            'x-darkroute-camera-generation': basePointer.generation,
          }),
          arrayBuffer: async () => expected.get(new URL(url).pathname),
        };
      },
    });
    assert.equal(result.generation, basePointer.generation);
    assert.equal(
      requests[0].url,
      `https://dev.darkroute.ai/cameras/index.json?generation=${basePointer.generation}&verify=fixed`,
    );
    assert.equal(
      requests[1].url,
      `https://dev.darkroute.ai/cameras/continuity.json?generation=${basePointer.generation}&verify=fixed`,
    );
    assert.equal(requests[0].init.redirect, 'error');
    assert.equal(requests[0].init.headers['CF-Access-Client-Id'], 'id');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verification rejects static fallback, stale generation, wrong bytes, and redirects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'camera-deployment-reject-'));
  try {
    const approved = approvedCameraSourceFixture();
    const basePointer = {
      schema: 'darkroute-camera-pointer/v1',
      slot: 'a',
      generation: '3'.repeat(64),
      manifestSha256: '4'.repeat(64),
      previous: null,
      updatedAt: '2026-09-01T10:00:00.000Z',
    };
    const fixture = await makeCameraFixture(root, {
      versionsKnown: true,
      osmVersion: 1,
      cameraSource: approved.marker,
      baseUpstream: approved.minimumOsmBase,
      basePointer,
    });
    const expected = readFileSync(join(fixture.archive, 'index.json'));
    const expectedContinuity = readFileSync(join(fixture.archive, 'continuity.json'));
    const options = {
      target: fixture.archive,
      stateFile: fixture.stateFile,
      origin: 'https://dev.darkroute.ai',
      nonce: 'fixed',
      env: {},
      validation: {
        minTiles: 1,
        minCameras: 1,
        trustedReviewBytes: approved.trustedReviewBytes,
      },
    };
    const response = (body, generation, url) => ({
      ok: true,
      status: 200,
      url:
        url ??
        `https://dev.darkroute.ai/cameras/index.json?generation=${basePointer.generation}&verify=fixed`,
      headers: new Headers({
        'content-type': 'application/json',
        ...(generation === null ? {} : { 'x-darkroute-camera-generation': generation }),
      }),
      arrayBuffer: async () => body,
    });
    await assert.rejects(
      verifyCameraDeployment({
        ...options,
        fetchImpl: async () => response(expected, null),
      }),
      /did not serve the freshly hydrated generation/,
    );
    await assert.rejects(
      verifyCameraDeployment({
        ...options,
        fetchImpl: async () => response(expected, 'a'.repeat(64)),
      }),
      /did not serve the freshly hydrated generation/,
    );
    await assert.rejects(
      verifyCameraDeployment({
        ...options,
        fetchImpl: async () => response(Buffer.from('{}\n'), basePointer.generation),
      }),
      /bytes do not match/,
    );
    await assert.rejects(
      verifyCameraDeployment({
        ...options,
        fetchImpl: async () =>
          response(expected, basePointer.generation, 'https://attacker.invalid/index.json'),
      }),
      /resolved to an unreviewed URL/,
    );
    let calls = 0;
    await assert.rejects(
      verifyCameraDeployment({
        ...options,
        fetchImpl: async (url) => {
          calls += 1;
          const body = new URL(url).pathname.endsWith('/index.json')
            ? expected
            : Buffer.from('{}\n');
          return {
            ok: true,
            status: 200,
            url,
            headers: new Headers({
              'content-type': 'application/json',
              'x-darkroute-camera-generation': basePointer.generation,
            }),
            arrayBuffer: async () => body,
          };
        },
      }),
      /continuity\.json bytes do not match/,
    );
    assert.equal(calls, 2);
    assert.ok(expectedContinuity.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
