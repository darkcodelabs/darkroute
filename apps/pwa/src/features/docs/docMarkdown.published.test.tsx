/**
 * EVERY PUBLISHED DOCUMENT, RENDERED, WITH NOTHING LEFT AS MARKUP.
 *
 * `docMarkdown.test.tsx` proves each construct on a fixture. This proves the
 * set: every file the API will serve is read from `docs/public` and rendered
 * through the same function the screen calls, and the words on screen outside
 * code are searched for the residue the owner saw - a `---`, a `[text](url)`,
 * a `**`, a `<br>`, a pipe row, a numbered line - and for the marks of the
 * constructs the old renderer did not know.
 *
 * The set is read from the API's own allowlist rather than typed here, and
 * cross-checked against the index the docs screen lists, so a document added
 * to one and not the other fails here before it fails in front of a reader.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DOC_ENTRIES } from './docs.ts';
import { renderDocMarkdown } from './docMarkdown.tsx';
import { docOutline } from './docOutline.ts';

// Off `process.cwd()` rather than `import.meta.url`: under jsdom that is not a
// file: URL. Vitest runs with `apps/pwa` as its working directory.
const ROOT = `${resolve(process.cwd(), '../..')}/`;
const DOCS = `${ROOT}docs/public/`;
const REPO_DOCS = 'https://github.com/darkcodelabs/darkroute/blob/main/docs/public';

/** `name: 'FILE.md'` pairs from `functions/api/v1/doc/[name].ts`. */
function served(): Map<string, string> {
  const source = readFileSync(`${ROOT}functions/api/v1/doc/[name].ts`, 'utf8');
  const body = /const DOCS[^{]*\{([\s\S]*?)\};/.exec(source)?.[1] ?? '';
  const out = new Map<string, string>();
  for (const m of body.matchAll(/'?([\w-]+)'?:\s*'([^']+\.md)'/g)) {
    out.set(m[1] ?? '', m[2] ?? '');
  }
  return out;
}

/** Text outside code and pre, where residue would be visible as prose. */
function proseNodes(root: HTMLElement): string[] {
  const out: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    if (node.parentElement?.closest('code, pre') === null) out.push(node.textContent ?? '');
    node = walker.nextNode();
  }
  return out;
}

/** Lines of the source outside fenced blocks, for the counts the render must match. */
function proseLines(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^ {0,3}(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) out.push(line);
  }
  return out;
}

const SERVED = served();

describe('the set', () => {
  it('is the same eleven files in the API allowlist, the docs index and docs/public', () => {
    const files = readdirSync(DOCS).filter((f) => f.endsWith('.md'));
    const listed = DOC_ENTRIES.map((e) => e.file).sort();
    const servedFiles = Array.from(SERVED.values()).sort();
    expect(servedFiles).toEqual(listed);
    for (const file of servedFiles) expect(files).toContain(file);
  });
});

describe.each(Array.from(SERVED.entries()))('%s', (name, file) => {
  const markdown = readFileSync(`${DOCS}${file}`, 'utf8');
  const lines = proseLines(markdown);

  it(`renders ${file} (served as ${name}) with no markup left on screen`, () => {
    const { container } = render(
      <div>{renderDocMarkdown(markdown, { onCopy: async () => true, source: `${REPO_DOCS}/${file}` })}</div>,
    );
    const prose = proseNodes(container);
    const joined = prose.join('\n');

    // The residue the owner saw, and the rest of the family.
    expect(prose.filter((t) => /^\s*-{3,}\s*$/.test(t)), 'a literal ---').toEqual([]);
    expect(prose.filter((t) => t.includes('](')), 'an unrendered [text](url)').toEqual([]);
    expect(prose.filter((t) => t.includes('**')), 'a ** left on screen').toEqual([]);
    expect(prose.filter((t) => /<br/i.test(t)), 'a <br> as text').toEqual([]);
    expect(prose.filter((t) => /\|.*\|/.test(t)), 'a raw pipe row').toEqual([]);
    expect(prose.filter((t) => /<https?:/.test(t)), 'an unrendered autolink').toEqual([]);
    expect(
      prose.filter((t) => /(^|[\s("])[*_][^*_\s][^*_]*[^*_\s][*_]([\s).,;:!?"]|$)/.test(t)),
      'italics still wearing their marks',
    ).toEqual([]);

    // Paragraphs that begin with a marker are a list the parser did not see.
    const paragraphs = Array.from(container.querySelectorAll('p')).map((p) => p.textContent ?? '');
    expect(paragraphs.filter((t) => /^(\d+[.)] |[-*+] |> |#{1,6} )/.test(t)), 'a marker at the head of a paragraph').toEqual([]);

    // And the constructs the source carries are the constructs on screen.
    const rules = lines.filter((l) => /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(l)).length;
    expect(container.querySelectorAll('hr')).toHaveLength(rules);
    const autolinks = lines.join('\n').match(/<https?:[^>\s]+>/g)?.length ?? 0;
    const inlineLinks = lines.join('\n').match(/\]\([^)\s]+\)/g)?.length ?? 0;
    expect(container.querySelectorAll('a').length).toBeGreaterThanOrEqual(autolinks + inlineLinks);
    if (/^\d+[.)] /m.test(lines.join('\n'))) expect(container.querySelector('ol')).not.toBeNull();

    // The size line's `§N of M` is measured by `docOutline`; the marks the
    // band scrolls through are stamped by the renderer. One rule, two walkers.
    expect(container.querySelectorAll('[data-fwm-doc-section]')).toHaveLength(docOutline(markdown).headings.length);
    expect(joined.length).toBeGreaterThan(0);
  });
});
