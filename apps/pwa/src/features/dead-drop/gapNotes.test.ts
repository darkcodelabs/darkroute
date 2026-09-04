/**
 * The public gap contract is a promise, and this is the test that keeps it.
 *
 * DEAD DROP renders four things the panel draws differently, publishes a shared
 * store field under a meaning that store does not document, and substitutes a
 * type step the token set does not carry. Every one of those is defensible and
 * every one of them is only defensible IN WRITING - a `GAP:` comment pointing
 * at an anchor that does not exist is worse than no comment, and a contract
 * that describes a state the code never renders is a claim nobody can check.
 *
 * So: every dead-drop gap anchor this feature cites must resolve in the
 * colocated public fixture, and the entries this screen's most contested
 * decisions rest on must actually say what the code does.
 *
 * The contract fixture and the sources are READ FROM DISK. vitest runs with
 * `css: false`, and a markdown file is not importable at all, so disk is the
 * only honest source for either. Keeping the fixture beside this test means the
 * public suite does not depend on the withheld internal gaps inbox.
 */

// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { VERDICT_LABELS } from './deadDropModel.ts';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

const contract: string = readFileSync(`${HERE}/gapNotes.fixture.md`, 'utf8');

/**
 * Every source file in this feature, tests included - except this one, which
 * quotes the reference pattern in its own prose and is the checker, not a
 * citer.
 */
function featureSources(): readonly string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }) as readonly {
      readonly name: string;
      isDirectory(): boolean;
    }[];
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name !== 'gapNotes.test.ts') files.push(path);
    }
  };
  walk(HERE);
  return files;
}

/** `<a id="…">` anchors the document actually defines. */
function definedAnchors(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const match of contract.matchAll(/<a id="([^"]+)"><\/a>/g)) {
    const id = match[1];
    if (id !== undefined) found.add(id);
  }
  return found;
}

/** `docs/gaps-inbox/dead-drop.md#…` references, with the file that cites them. */
function citedAnchors(): readonly (readonly [string, string])[] {
  const cited: [string, string][] = [];
  for (const path of featureSources()) {
    const text: string = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/docs\/gaps-inbox\/dead-drop\.md#([a-z0-9-]+)/g)) {
      const id = match[1];
      if (id !== undefined) cited.push([id, path.slice(HERE.length + 1)]);
    }
  }
  return cited;
}

describe('every gap note this feature cites resolves', () => {
  it('finds at least one citation, so an empty walk cannot pass silently', () => {
    expect(citedAnchors().length).toBeGreaterThan(8);
    expect(definedAnchors().size).toBeGreaterThan(8);
  });

  it('resolves every cited anchor to a heading in the document', () => {
    const defined = definedAnchors();
    const dangling = citedAnchors()
      .filter(([id]) => !defined.has(id))
      .map(([id, file]) => `${file} -> #${id}`);
    expect(dangling).toEqual([]);
  });
});

describe('the public contract describes the code that exists', () => {
  it('lists exactly the verdicts VERDICT_LABELS can render', () => {
    for (const label of Object.values(VERDICT_LABELS)) {
      expect(contract).toContain(`\`${label}\``);
    }
    // `CHECKING` was listed once as a fifth verdict. Nothing renders it, and it
    // must never come back as a table row.
    expect(contract).not.toMatch(/\|\s*`?CHECKING`?\s*\|/);
  });

  it('records the 13px action-key substitution with the other type steps', () => {
    const section = contract.slice(contract.indexOf('type-and-spacing-steps-the-token-set-misses'));
    expect(section).toContain('13px');
    expect(section).toContain('SEND NOW');
  });

  it('records that the shared QueuedDrop.label is written as a camera id', () => {
    const section = contract.slice(
      contract.indexOf('queueddrop-label-carries-a-camera-id-not-a-place'),
    );
    expect(section).toContain('stores/sync.ts');
    expect(section).toContain('camera_id');
  });

  it('records that an interior purge is a hole and not tampering', () => {
    const section = contract.slice(contract.indexOf('a-purge-can-leave-a-hole-in-the-middle'));
    expect(section).toContain('runs');
    expect(section).toContain('starting_chain_hash');
  });

  it('records that the chain is deliberately not pinned to this install’s key', () => {
    const section = contract.slice(contract.indexOf('the-signing-key-is-not-pinned'));
    expect(section).toContain('expectedPublicKeyId');
  });
});
