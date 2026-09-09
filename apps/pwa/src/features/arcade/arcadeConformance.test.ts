/**
 * THE ARCADE'S HOUSE RULES, ASSERTED OVER THE SOURCE FILES.
 *
 * `dockConformance.test.ts`'s pattern: read the files off disk -- vitest stubs
 * stylesheet imports to '' -- blank the comments with offsets preserved, and
 * ask whether they still say what the rules say. None of these fails loudly on
 * its own: a hex that is right in one skin and wrong in sixteen, a `:hover` a
 * thumb can never reach, a token that resolves to nothing, an import that
 * quietly gives a toy a way off the phone.
 */

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const DIR = 'apps/pwa/src/features/arcade';

interface SourceFile {
  readonly name: string;
  readonly text: string;
}

function blankComments(source: string, js: boolean): string {
  const blocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
  if (!js) return blocks;
  return blocks.replace(/(^|[^:\w])\/\/[^\n]*/g, (whole: string, keep: string) =>
    keep.concat(' '.repeat(whole.length - keep.length)),
  );
}

const SOURCES: readonly SourceFile[] = readdirSync(HERE)
  .filter((name) => /\.(css|ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
  .sort((a, b) => a.localeCompare(b))
  .map((name) => ({
    name,
    text: blankComments(readFileSync(`${HERE}/${name}`, 'utf8'), !name.endsWith('.css')),
  }));

const TOKENS_CSS = blankComments(readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8'), false);

function at(file: SourceFile, index: number, detail: string): string {
  const line = file.text.slice(0, index).split('\n').length;
  return `${DIR}/${file.name}:${line}  ${detail}`;
}

function findAll(file: SourceFile, pattern: RegExp): string[] {
  const out: string[] = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(file.text);
  while (match !== null) {
    out.push(at(file, match.index, match[0]));
    match = pattern.exec(file.text);
  }
  return out;
}

const CSS = SOURCES.find((file) => file.name === 'arcade.css');

describe('the arcade names no raw value', () => {
  it('has every file the design lists', () => {
    const names = SOURCES.map((file) => file.name);
    for (const expected of [
      'ArcadeKey.tsx',
      'ArcadeOverlay.tsx',
      'arcade.css',
      'offer.ts',
      'palette.ts',
      'score.ts',
      'sim.ts',
      'useArcadeLoop.ts',
      'useArcadeStandDown.ts',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('writes no hex colour', () => {
    for (const file of SOURCES) {
      expect(findAll(file, /(?<![&\w])#[0-9a-fA-F]{3,8}(?![\w])/g)).toEqual([]);
    }
  });

  it('writes no colour function', () => {
    for (const file of SOURCES) {
      expect(findAll(file, /\b(rgba?|hsla?|color-mix|oklch)\s*\(/g)).toEqual([]);
    }
  });

  it('writes no literal length or duration outside a var()', () => {
    for (const file of SOURCES) {
      expect(findAll(file, /(?<![\w.#-])\d+(?:\.\d+)?(px|rem|em|vh|vw|ms|s)(?![\w-])/g)).toEqual([]);
    }
  });

  it('writes no bare easing word', () => {
    for (const file of SOURCES) {
      expect(findAll(file, /(?<![\w-])(ease|linear|ease-in|ease-out|ease-in-out|cubic-bezier)(?![\w-])/g)).toEqual([]);
    }
  });

  it('resolves every token it reads to tokens.css or to a local it declares', () => {
    const declared = new Set<string>();
    for (const match of TOKENS_CSS.matchAll(/(--(?:fwm|dr)-[a-z0-9-]+)\s*:/g)) declared.add(match[1] ?? '');
    for (const file of SOURCES) {
      const locals = new Set<string>();
      for (const match of file.text.matchAll(/(--fwm-arc-[a-z0-9-]+)\s*:/g)) locals.add(match[1] ?? '');
      const dangling: string[] = [];
      for (const match of file.text.matchAll(/--(?:fwm|dr)-[a-z0-9-]+/g)) {
        const name = match[0];
        if (declared.has(name) || locals.has(name)) continue;
        dangling.push(at(file, match.index ?? 0, name));
      }
      expect(dangling).toEqual([]);
    }
  });
});

describe('the arcade is a thumb surface with no way off the phone', () => {
  it('never styles :hover', () => {
    for (const file of SOURCES) expect(findAll(file, /:hover(?![\w-])/g)).toEqual([]);
  });

  it('never claims essential motion', () => {
    for (const file of SOURCES) expect(findAll(file, /data-fwm-motion=["']essential["']/g)).toEqual([]);
  });

  it('imports nothing from services/ or stores/persist.ts, and never persists', () => {
    for (const file of SOURCES) {
      expect(findAll(file, /from\s+['"][^'"]*\/services\//g)).toEqual([]);
      expect(findAll(file, /from\s+['"][^'"]*stores\/persist(?:Port)?[^'"]*['"]/g)).toEqual([]);
      expect(findAll(file, /\b(localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket)\b/g)).toEqual([]);
      expect(findAll(file, /navigator\.vibrate|speechSynthesis/g)).toEqual([]);
    }
  });

  it('never records, selects, mutes, routes or moves the map', () => {
    for (const file of SOURCES) {
      expect(
        findAll(file, /\b(historyActions|alertActions|routeActions|camerasActions|settingsActions|currentMap)\b/g),
      ).toEqual([]);
    }
  });

  it('draws the close key and both end-card keys at --fwm-touch-min', () => {
    if (CSS === undefined) throw new Error('arcade.css missing');
    for (const selector of ['.fwm-arcade-close', '.fwm-arcade-end-key']) {
      const block = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(CSS.text);
      expect(block?.[1]).toMatch(/height:\s*var\(--fwm-touch-min\)/);
    }
  });

  it('draws the dock key 44 by 44 in the neutral ink, above the pane tap', () => {
    if (CSS === undefined) throw new Error('arcade.css missing');
    const block = /\.fwm-arcade-key\s*\{([^}]*)\}/.exec(CSS.text)?.[1] ?? '';
    expect(block).toMatch(/--fwm-arc-key-h:\s*calc\(var\(--fwm-space-1\)\s*\*\s*11\)/);
    expect(block).toMatch(/width:\s*var\(--fwm-arc-key-h\)/);
    expect(block).toMatch(/height:\s*var\(--fwm-arc-key-h\)/);
    expect(block).toMatch(/color:\s*var\(--dr-ink\)/);
    expect(block).toMatch(/position:\s*relative/);
  });

  it('frames the arena in the alert band with the four-layer glass', () => {
    if (CSS === undefined) throw new Error('arcade.css missing');
    const root = /\.fwm-arcade\s*\{([^}]*)\}/.exec(CSS.text)?.[1] ?? '';
    expect(root).toMatch(/top:\s*var\(--fwm-drive-row-2\)/);
    expect(root).toMatch(/bottom:\s*var\(--fwm-dock-h\)/);
    const frame = /\.fwm-arcade-frame\s*\{([^}]*)\}/.exec(CSS.text)?.[1] ?? '';
    expect(frame).toMatch(/background:\s*var\(--dr-grain\),\s*var\(--dr-surface-thin\)/);
    expect(frame).toMatch(/backdrop-filter:\s*var\(--dr-blur\)/);
    expect(frame).toMatch(/border:\s*var\(--fwm-rule-w\)\s+solid\s+var\(--dr-hairline\)/);
    expect(frame).toMatch(/box-shadow:\s*var\(--dr-lift\),\s*var\(--dr-specular\)/);
  });
});
