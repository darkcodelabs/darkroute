import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const pwa = JSON.parse(readFileSync(new URL('../apps/pwa/package.json', import.meta.url), 'utf8'));
const deploy = readFileSync(new URL('deploy.mjs', import.meta.url), 'utf8');
const mapRender = readFileSync(new URL('check-map-render.mjs', import.meta.url), 'utf8');

describe('deployment toolchain', () => {
  it('pins Wrangler and never lets npx select a release under deploy credentials', () => {
    assert.equal(pkg.devDependencies.wrangler, '4.128.0');
    assert.match(deploy, /run\('pnpm', \[\s*'exec',\s*'wrangler',/);
    assert.doesNotMatch(deploy, /run\(['"]npx['"]/);
  });

  it('deploys a prebuilt tree without invoking a package or build script under credentials', () => {
    assert.match(deploy, /const prebuilt = args\.has\('--prebuilt'\)/);
    assert.match(deploy, /if \(prebuilt\) \{[\s\S]*bundle = validatePrebuilt\(\)[\s\S]*\} else \{/);
    const prebuiltBranch = deploy.slice(
      deploy.indexOf('if (prebuilt) {'),
      deploy.indexOf('} else {', deploy.indexOf('if (prebuilt) {')),
    );
    assert.doesNotMatch(prebuiltBranch, /\brun\(|\bpnpm\b.*\b(?:build|ship)\b/);
    assert.match(deploy, /prebuilt basemap inventory differs/);
    assert.match(deploy, /prebuilt _headers differs/);
    assert.match(deploy, /prebuilt index names a missing or empty bundle/);
    assert.match(deploy, /prebuilt output contains a symlink/);
    assert.match(deploy, /Wrangler must be pinned to one exact version/);
  });

  it('checks copied map assets after build and served sprite/glyph bodies after deploy', () => {
    assert.match(
      pwa.scripts.build,
      /check-basemap-assets\.mjs --dist/,
      'the deployable tree must be compared with the reviewed public assets',
    );
    assert.match(deploy, /SPRITE_FLAVORS\.flatMap/);
    assert.match(deploy, /validSpriteIndex/);
    assert.match(deploy, /validSpritePng/);
    assert.match(deploy, /FONT_STACKS\.flatMap/);
    assert.match(deploy, /GLYPH_PROBE_RANGES\.map/);
    assert.match(deploy, /matchesBuiltAsset/);
    assert.match(
      deploy,
      /headers: \{ 'cache-control': 'no-cache', \.\.\.accessHeaders\(\) \}/,
      'live sprite requests must pass through the same Access boundary as the document',
    );
  });

  it('makes the browser map probe fail on HTML fallbacks and missing style images', () => {
    assert.match(mapRender, /Unexpected token/);
    assert.match(mapRender, /could not be loaded/);
    assert.match(mapRender, /Unimplemented type/);
    assert.match(mapRender, /MAP PREFLIGHT FAILED/);
    assert.match(mapRender, /process\.exitCode = 1/);
  });
});
