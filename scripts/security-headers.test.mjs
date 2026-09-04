/**
 * THE BROWSER BOUNDARY IS SOURCE-CONTROLLED.
 *
 * Cloudflare Pages parses `public/_headers`; without this file the application
 * has no project-defined CSP, framing policy or Permissions Policy. These
 * assertions pin the capabilities the shipped app needs while refusing the
 * sensitive ones it deliberately does not use.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { verifySecurityHeaders } from './check-security-headers.mjs';

const source = readFileSync(new URL('../apps/pwa/public/_headers', import.meta.url), 'utf8');

function header(name) {
  const match = new RegExp(`^\\s+${name}:\\s*(.+)$`, 'im').exec(source);
  assert.ok(match, `${name} must be present in apps/pwa/public/_headers`);
  return match[1].trim();
}

function directive(policy, name) {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`).exec(policy);
  assert.ok(match, `${name} must be present in the Content-Security-Policy`);
  return match[1].trim().split(/\s+/);
}

describe('the static application security headers', () => {
  it('has a post-build artifact gate', () => {
    assert.ok(verifySecurityHeaders() > 0);
    const pkg = JSON.parse(
      readFileSync(new URL('../apps/pwa/package.json', import.meta.url), 'utf8'),
    );
    assert.match(pkg.scripts.build, /check-security-headers\.mjs --dist/);
  });

  it('refuses framing, MIME guessing and referrer disclosure', () => {
    assert.equal(header('Referrer-Policy'), 'no-referrer');
    assert.equal(header('X-Content-Type-Options'), 'nosniff');
    assert.equal(header('X-Frame-Options'), 'DENY');

    const policy = header('Content-Security-Policy');
    assert.deepEqual(directive(policy, 'frame-ancestors'), ["'none'"]);
    assert.deepEqual(directive(policy, 'object-src'), ["'none'"]);
    assert.deepEqual(directive(policy, 'base-uri'), ["'none'"]);
  });

  it('allows network reads only from this app and its disclosed tile host', () => {
    assert.deepEqual(directive(header('Content-Security-Policy'), 'connect-src'), [
      "'self'",
      'https://tiles.darkroute.ai',
    ]);
  });

  it('keeps the blob allowances MapLibre and photo previews require', () => {
    const policy = header('Content-Security-Policy');
    assert.deepEqual(directive(policy, 'worker-src'), ["'self'", 'blob:']);
    assert.deepEqual(directive(policy, 'img-src'), ["'self'", 'data:', 'blob:']);
  });

  it('keeps used device capabilities and refuses unused capture hardware', () => {
    const policy = header('Permissions-Policy');
    for (const feature of [
      'accelerometer=(self)',
      'bluetooth=(self)',
      'clipboard-write=(self)',
      'fullscreen=(self)',
      'geolocation=(self)',
      'gyroscope=(self)',
      'magnetometer=(self)',
      'microphone=(self)',
      'screen-wake-lock=(self)',
      'serial=(self)',
      'web-share=(self)',
    ]) {
      assert.match(policy, new RegExp(`(?:^|, )${feature.replace(/[()]/g, '\\$&')}(?:,|$)`));
    }
    for (const feature of ['camera=()', 'display-capture=()', 'payment=()', 'usb=()']) {
      assert.match(policy, new RegExp(`(?:^|, )${feature.replace(/[()]/g, '\\$&')}(?:,|$)`));
    }
  });
});
