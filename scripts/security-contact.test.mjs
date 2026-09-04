import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const ROOT = new URL('../', import.meta.url);
const WELL_KNOWN = new URL('apps/pwa/public/.well-known/', ROOT);
const FINGERPRINT = '1833C30517BD656DBFA61418238827E913E5D960';
const DISPLAY_FINGERPRINT = '1833 C305 17BD 656D BFA6 1418 2388 27E9 13E5 D960';

function read(relative) {
  return readFileSync(new URL(relative, ROOT), 'utf8');
}

describe('the private security-reporting channel', () => {
  it('publishes one canonical contact document with a renewal deadline', () => {
    const security = readFileSync(new URL('security.txt', WELL_KNOWN), 'utf8');

    assert.match(security, /^Contact: https:\/\/github\.com\/darkcodelabs\/darkroute\/security\/advisories\/new$/m);
    assert.match(security, /^Contact: mailto:cory@darkcode\.ai$/m);
    assert.match(security, /^Encryption: https:\/\/darkroute\.ai\/\.well-known\/security-key\.asc$/m);
    assert.match(security, /^Canonical: https:\/\/darkroute\.ai\/\.well-known\/security\.txt$/m);

    const expiry = /^Expires: (.+)$/m.exec(security)?.[1];
    assert.ok(expiry, 'security.txt has no Expires field');
    assert.ok(
      Date.parse(expiry) - Date.now() > 30 * 24 * 60 * 60 * 1000,
      'security.txt expires in under 30 days; renew it before release',
    );
  });

  it('pins the public key that belongs to the documented fingerprint', () => {
    const key = readFileSync(new URL('security-key.asc', WELL_KNOWN));
    assert.equal(
      createHash('sha256').update(key).digest('hex'),
      '2ed7504fb8ec364464d829be2581b7cb1bea53c7d97fba731abfaae6c0772277',
      `the security key changed; verify and update the documented fingerprint ${FINGERPRINT}`,
    );

    for (const policy of ['.github/SECURITY.md', 'docs/public/SECURITY.md']) {
      assert.match(read(policy), new RegExp(DISPLAY_FINGERPRINT.replaceAll(' ', '\\s+')));
    }
  });

  it('leaves no reporting placeholders in the public community files', () => {
    const publicCommunity = [
      '.github/CODEOWNERS',
      '.github/SECURITY.md',
      '.github/SUPPORT.md',
      'docs/CODE_OF_CONDUCT.md',
    ].map(read).join('\n');

    assert.doesNotMatch(publicCommunity, /INSERT CONTACT|<your-org>|<owner>|your-handle/i);
  });
});
