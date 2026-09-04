import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const ROOT = new URL('../', import.meta.url);
const FONT_DIR = new URL('apps/pwa/public/fonts/', ROOT);
const manifest = readFileSync(new URL('LICENSES.md', FONT_DIR), 'utf8');
const license = readFileSync(new URL('OFL-1.1.txt', FONT_DIR), 'utf8');
const notice = readFileSync(new URL('NOTICE.md', ROOT), 'utf8');
const runtimeTypefaceSources = [
  readFileSync(new URL('apps/pwa/index.html', ROOT), 'utf8'),
  readFileSync(new URL('apps/pwa/src/app/typeface.ts', ROOT), 'utf8'),
  readFileSync(new URL('apps/pwa/src/styles/tokens.css', ROOT), 'utf8'),
].join('\n');

const FONTS = new Map([
  [
    'chakra-petch-400.woff2',
    {
      sha256: '7d75be85dd1627e27ec151e9a3701e661bc4f8c2a93611bdd92f3a05d6bbd942',
      copyright: 'Copyright 2018 The Chakra Petch Project Authors',
    },
  ],
  [
    'chakra-petch-500.woff2',
    {
      sha256: '36ad966cb653de70ba37355c41003b02de8940b2df6cbcd46480a6ad8cadd65d',
      copyright: 'Copyright 2018 The Chakra Petch Project Authors',
    },
  ],
  [
    'chakra-petch-600.woff2',
    {
      sha256: 'a5888696e9eb1b4bbbecc8eb3922b8369f49d4bddb72263e033cbd17f399be76',
      copyright: 'Copyright 2018 The Chakra Petch Project Authors',
    },
  ],
  [
    'chakra-petch-700.woff2',
    {
      sha256: 'ce5095dc1cb200aaa939e38067a0677018d10e9f26ec38cdcf1557ac524fc775',
      copyright: 'Copyright 2018 The Chakra Petch Project Authors',
    },
  ],
  [
    'jetbrains-mono-400.woff2',
    {
      sha256: '83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be',
      copyright: 'Copyright 2020 The JetBrains Mono Project Authors',
    },
  ],
  [
    'jetbrains-mono-500.woff2',
    {
      sha256: '83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be',
      copyright: 'Copyright 2020 The JetBrains Mono Project Authors',
    },
  ],
  [
    'jetbrains-mono-700.woff2',
    {
      sha256: '83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be',
      copyright: 'Copyright 2020 The JetBrains Mono Project Authors',
    },
  ],
  [
    'google-sans-latin.woff2',
    {
      sha256: '3f43e613a4176decfb0ab2e4cf68bfcfbebe9eee1a3de080c4115426258fa32f',
      copyright: 'Copyright 2025 The Google Sans Project Authors',
    },
  ],
]);

describe('bundled font licensing', () => {
  it('maps every WOFF2 byte stream to a copyright notice and source', () => {
    const files = readdirSync(FONT_DIR)
      .filter((name) => name.endsWith('.woff2'))
      .sort();
    assert.deepEqual(files, [...FONTS.keys()].sort());

    for (const [name, expected] of FONTS) {
      const bytes = readFileSync(new URL(name, FONT_DIR));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, name);
      const heading = `### \`${name}\``;
      const start = manifest.indexOf(heading);
      assert.notEqual(start, -1, `${name} has no human-readable mapping`);
      const next = manifest.indexOf('\n### `', start + heading.length);
      const block = manifest.slice(start, next === -1 ? undefined : next);
      assert.ok(block.includes(`\`${expected.sha256}\``), `${name} has no bound digest`);
      assert.match(
        manifest,
        new RegExp(expected.copyright.replaceAll(' ', '\\s+')),
        `${name} has no copyright notice`,
      );
      assert.match(
        block,
        /\[Google Fonts CDN\]\(https:\/\/fonts\.gstatic\.com\/s\/[^)]+\.woff2\)/,
        `${name} has no exact distribution source`,
      );
    }
  });

  it('distributes the OFL text and names both font families in NOTICE', () => {
    assert.match(license, /^SIL OPEN FONT LICENSE Version 1\.1/);
    assert.match(license, /each copy\s+contains the above copyright notice and this license/);
    assert.match(license, /THE FONT SOFTWARE IS PROVIDED "AS IS"/);

    for (const family of ['Chakra Petch', 'JetBrains Mono', 'Google Sans']) {
      assert.match(notice, new RegExp(`\\|\\s+${family}\\s+[^|]*\\|\\s+OFL-1\\.1\\s+\\|`));
    }
    assert.match(notice, /apps\/pwa\/public\/fonts\/LICENSES\.md/);
    assert.match(notice, /apps\/pwa\/public\/fonts\/OFL-1\.1\.txt/);
  });

  it('ships Google Sans as a documented OFL face, and self-hosts it', () => {
    /*
     * This test used to assert the OPPOSITE - that the asset was withdrawn and
     * referenced nowhere. It was written when the family was believed to be
     * Google's closed brand font and therefore not redistributable. That is no
     * longer true: it is published under the OFL, and the binary says so itself
     * - nameID 0 carries "Copyright 2025 The Google Sans Project Authors" and
     * nameID 14 points at openfontlicense.org.
     *
     * So the assertion is inverted rather than deleted. What has to stay true is
     * the part that never depended on the licence: the face is SELF-HOSTED. A
     * runtime `fonts.googleapis.com` reference would hand Google the IP of every
     * driver on every cold start and leave the type missing offline, which is
     * the exposure this product exists to reduce.
     */
    assert.match(manifest, /google-sans-latin\.woff2/);
    assert.match(notice, /Google Sans/);
    assert.match(runtimeTypefaceSources, /'Google Sans'/);
    /*
     * The LINK, not the word. `tokens.css` names `fonts.googleapis.com` in prose
     * to explain why the app does not link it, and a bare hostname match flags
     * that explanation - failing the test on the comment that documents the very
     * rule it is enforcing. So this matches the shapes that would actually fetch:
     * a stylesheet link, an @import, or a url() in a src.
     */
    assert.doesNotMatch(runtimeTypefaceSources, /<link[^>]+fonts\.(?:googleapis|gstatic)\.com/i);
    assert.doesNotMatch(runtimeTypefaceSources, /@import[^;]*fonts\.(?:googleapis|gstatic)\.com/i);
    assert.doesNotMatch(
      runtimeTypefaceSources,
      /url\(\s*['"]?https:\/\/fonts\.(?:googleapis|gstatic)\.com/i,
    );
  });
});
