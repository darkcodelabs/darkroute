/**
 * EVERY CONSTRUCT THE DOCUMENTS ARE WRITTEN WITH, DRAWN AS ITSELF.
 *
 * The owner's screenshot of the terms page showed a literal `---` where a rule
 * belongs. That was one of eight constructs the published set uses that the
 * reader put on screen as its own source - the count is in `docMarkdown.tsx`.
 * Each case here is one construct, in the shape the documents actually write
 * it, and the assertion is what a reader sees: the rule, the number, the link -
 * and never the asterisks, brackets or dashes that spelt it.
 *
 * The fixtures are lifted from the real files where a real file has the shape
 * (the AUDITING step with a fence inside it, the DATA-CONTRACTS callout with a
 * numbered list in it), because those are the shapes that broke.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DOC_ANCHOR_PREFIX, docSlug, renderDocMarkdown } from './docMarkdown.tsx';

const SOURCE = 'https://github.com/darkcodelabs/darkroute/blob/main/docs/public/TERMS.md';

function draw(markdown: string): HTMLElement {
  const { container } = render(
    <div>{renderDocMarkdown(markdown, { onCopy: async () => true, source: SOURCE })}</div>,
  );
  return container;
}

/** The words on screen outside code, which is where markup residue would show. */
function proseOf(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('code, pre').forEach((node) => node.remove());
  return clone.textContent ?? '';
}

describe('a thematic break', () => {
  it('draws a rule where the document writes ---, and never the dashes', () => {
    // The owner's screenshot. TERMS.md has ten of these, one under each section.
    const c = draw('Some terms.\n\n---\n\nMore terms.');
    expect(c.querySelectorAll('hr.fwm-docview-rule')).toHaveLength(1);
    expect(proseOf(c)).not.toContain('---');
  });

  it('reads *** and ___ and a spaced - - - as rules too, not as a list or emphasis', () => {
    const c = draw('a\n\n***\n\n___\n\n- - -\n\nb');
    expect(c.querySelectorAll('hr')).toHaveLength(3);
    expect(c.querySelectorAll('ul, em, strong')).toHaveLength(0);
  });
});

describe('front matter', () => {
  it('never renders as text', () => {
    const c = draw('---\ntitle: Terms\nlayout: doc\n---\n\n# Terms');
    expect(proseOf(c)).not.toContain('title:');
    expect(c.querySelectorAll('hr')).toHaveLength(0);
    expect(screen.getByText('Terms').tagName).toBe('H2');
  });
});

describe('headings', () => {
  it('draws #### as a heading and drops a closing run of hashes', () => {
    const c = draw('#### `photo` — a digest, not an image ##');
    const h = c.querySelector('h5.fwm-docview-h4');
    expect(h?.textContent).toBe('photo — a digest, not an image');
  });

  it('gives each heading the anchor GitHub would, so the documents\u2019 own links land', () => {
    // DATA-PROVENANCE.md links to `#71-the-dataset-is-served-not-shipped`.
    expect(docSlug('7.1 The dataset is served, not shipped')).toBe('71-the-dataset-is-served-not-shipped');
    // ARCHITECTURE.md links to `#3-flow-a--from-openstreetmap-...`: two hyphens.
    expect(docSlug('3. Flow A — from OpenStreetMap')).toBe('3-flow-a--from-openstreetmap');
    const c = draw('### 7.1 The dataset is served, not shipped');
    expect(c.querySelector('h4')?.id).toBe(`${DOC_ANCHOR_PREFIX}71-the-dataset-is-served-not-shipped`);
  });

  it('numbers a repeated heading the way GitHub does', () => {
    const c = draw('## Notes\n\n## Notes');
    const ids = Array.from(c.querySelectorAll('h3')).map((h) => h.id);
    expect(ids).toEqual([`${DOC_ANCHOR_PREFIX}notes`, `${DOC_ANCHOR_PREFIX}notes-1`]);
  });

  it('marks # and ## at the top of the document as sections, and nothing inside a quote', () => {
    // The size line counts what `docOutline` counts; a heading in a callout
    // would be one the band scrolls past but the count never reaches.
    const c = draw('# Title\n\n## One\n\n> ## Not a section\n\n### Term');
    const marks = Array.from(c.querySelectorAll('[data-fwm-doc-section]')).map((h) => h.textContent);
    expect(marks).toEqual(['Title', 'One']);
  });
});

describe('a numbered list', () => {
  it('draws its numbers, starting where the document starts', () => {
    const c = draw('3. three\n4. four');
    const ol = c.querySelector('ol.fwm-docview-list-ordered');
    expect(ol).toHaveAttribute('start', '3');
    expect(Array.from(ol?.querySelectorAll('li') ?? []).map((li) => li.textContent)).toEqual(['three', 'four']);
    expect(proseOf(c)).not.toMatch(/\d\./);
  });

  it('keeps an indented continuation line inside its item', () => {
    // DATA-CONTRACTS.md, item 10 of §8: 250 lines across the set are shaped
    // like this, and every one was pasted into a paragraph after the list.
    const c = draw(
      '10. **The port is convention, not allocation.** Another\n' +
        '    application could collide; the magic byte and the strict\n' +
        '    decoder are what make that survivable.\n' +
        '11. **`osmId` is truncated to 32 bits** in the frame.',
    );
    const items = Array.from(c.querySelectorAll('li'));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe(
      'The port is convention, not allocation. Another application could collide; the magic byte and the strict decoder are what make that survivable.',
    );
    expect(c.querySelectorAll('p')).toHaveLength(0);
  });

  it('nests a bullet list inside the numbered item that owns it', () => {
    // AUDITING.md §2.4 step 4.
    const c = draw('4. What you should see:\n   - `GET /a`\n   - `GET /b`\n5. Sort by size.');
    const outer = c.querySelector('ol');
    expect(outer?.children).toHaveLength(2);
    const nested = outer?.querySelector('li > ul.fwm-docview-list');
    expect(nested?.querySelectorAll('li')).toHaveLength(2);
    expect(proseOf(c)).not.toContain('- ');
  });

  it('keeps a fenced block inside the step that owns it', () => {
    // AUDITING.md §2.4 step 1: a blank line, then a fence indented to the item.
    const c = draw('1. Build and serve:\n\n   ```bash\n   pnpm build\n   ```\n\n2. Open DevTools.');
    const first = c.querySelector('li');
    expect(first?.querySelector('pre')?.textContent).toBe('pnpm build');
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(c.querySelectorAll('ol')).toHaveLength(1);
    expect(c.querySelectorAll('li')).toHaveLength(2);
  });

  it('leaves -word and 1.word as the prose they are', () => {
    const c = draw('-foo is a flag and 1.5 is a number');
    expect(c.querySelectorAll('ul, ol')).toHaveLength(0);
    expect(c.querySelector('p')?.textContent).toBe('-foo is a flag and 1.5 is a number');
  });
});

describe('a link', () => {
  it('draws [words](https://…) as a link that opens away from the app', () => {
    const c = draw('See [the wiki](https://wiki.openstreetmap.org/wiki/Key:man_made).');
    const a = c.querySelector('a.fwm-docview-link');
    expect(a?.textContent).toBe('the wiki');
    expect(a).toHaveAttribute('href', 'https://wiki.openstreetmap.org/wiki/Key:man_made');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noreferrer noopener');
    expect(proseOf(c)).not.toContain('](');
  });

  it('resolves ./OTHER.md and ../../path#L12 against where this file lives in the repository', () => {
    const c = draw('[LEGAL.md](./LEGAL.md) and [the adapter](../../apps/pwa/src/x.ts#L115)');
    const hrefs = Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://github.com/darkcodelabs/darkroute/blob/main/docs/public/LEGAL.md',
      'https://github.com/darkcodelabs/darkroute/blob/main/apps/pwa/src/x.ts#L115',
    ]);
  });

  it('turns a #fragment into a jump to the heading on this screen, not a change of page URL', () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const c = draw('[Index](#8-index-of-dead-ends)\n\n## 8. Index of dead ends');
    const a = c.querySelector('a') as HTMLAnchorElement;
    expect(a).not.toHaveAttribute('target');
    fireEvent.click(a);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(c.querySelector('h3'));
  });

  it('draws <https://…> and <name@host> autolinks', () => {
    const c = draw('At <https://osmfoundation.org/wiki/Licence> or <cory@darkcode.ai>.');
    const hrefs = Array.from(c.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://osmfoundation.org/wiki/Licence', 'mailto:cory@darkcode.ai']);
    expect(proseOf(c)).not.toContain('<');
  });

  it('refuses a javascript: destination and keeps only the words', () => {
    // The bytes came off the network. A link is the one place they become
    // something the browser acts on, so only three schemes ever become one.
    const c = draw('[press me](javascript:alert(1)) and [data](data:text/html,x)');
    expect(c.querySelectorAll('a')).toHaveLength(0);
    expect(c.querySelector('p')?.textContent).toBe('press me and data');
  });

  it('keeps inline code inside the link words', () => {
    // 84 links in the set are written `[`FILE.md` §6.3](./FILE.md)`.
    const c = draw('[`DATA-PROVENANCE.md` §6.3](./DATA-PROVENANCE.md)');
    const a = c.querySelector('a');
    expect(a?.querySelector('code')?.textContent).toBe('DATA-PROVENANCE.md');
    expect(a?.textContent).toBe('DATA-PROVENANCE.md §6.3');
  });

  it('draws an image as a link to it, with the alt text as the words', () => {
    // The app's img-src would refuse the fetch; the words say more than a broken icon.
    const c = draw('![the flow](./flow.png)');
    const a = c.querySelector('a');
    expect(a?.textContent).toBe('the flow');
    expect(c.querySelectorAll('img')).toHaveLength(0);
  });
});

describe('emphasis', () => {
  it('draws *this* and _this_ in italics, without the marks', () => {
    const c = draw('the *driver* is _not_ the owner');
    expect(Array.from(c.querySelectorAll('em')).map((e) => e.textContent)).toEqual(['driver', 'not']);
    expect(proseOf(c)).toBe('the driver is not the owner');
  });

  it('leaves snake_case and 2 * 3 alone', () => {
    const c = draw('if you snake_case those, 2 * 3 is 6 and a_b_c stays');
    expect(c.querySelectorAll('em, strong')).toHaveLength(0);
    expect(c.querySelector('p')?.textContent).toBe('if you snake_case those, 2 * 3 is 6 and a_b_c stays');
  });

  it('holds bold around inline code that has an asterisk in it', () => {
    // API.md: `- **`/api/*`** — no route matches`. The old renderer split
    // the bold on the code span's own asterisk.
    const c = draw('**`/api/*`** — no route matches');
    expect(c.querySelector('strong > code')?.textContent).toBe('/api/*');
    expect(proseOf(c)).not.toContain('*');
  });

  it('nests italics inside bold', () => {
    const c = draw('**Do *not* use printf**');
    expect(c.querySelector('strong')?.textContent).toBe('Do not use printf');
    expect(c.querySelector('strong > em')?.textContent).toBe('not');
  });

  it('strikes ~~this~~ through', () => {
    expect(draw('~~gone~~').querySelector('del')?.textContent).toBe('gone');
  });
});

describe('a table', () => {
  it('keeps an empty cell in its own column', () => {
    // DATA-CONTRACTS.md line 46: an empty first cell. The old renderer dropped
    // it and every cell after it moved one column left.
    const c = draw('| a | b | c |\n|---|---|---|\n|   | **x** | y |');
    const cells = Array.from(c.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(['', 'x', 'y']);
  });

  it('keeps an escaped pipe inside its cell', () => {
    const c = draw('| key | value |\n|---|---|\n| or | `a \\| b` |');
    const cells = Array.from(c.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(['or', 'a | b']);
    expect(c.querySelectorAll('td')).toHaveLength(2);
  });

  it('pads a short row to the header and drops the excess of a long one', () => {
    const c = draw('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
    const rows = Array.from(c.querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td').length);
    expect(rows).toEqual([2, 2]);
  });
});

describe('a callout', () => {
  it('stays the callout\u2019s own text when it is one paragraph', () => {
    const c = draw('> Written for somebody who has no reason to trust it.');
    expect(screen.getByText('Written for somebody who has no reason to trust it.')).toHaveClass(
      'fwm-docview-callout',
    );
    expect(c.querySelectorAll('blockquote p')).toHaveLength(0);
  });

  it('holds a paragraph break, a numbered list and a fence', () => {
    // DATA-CONTRACTS.md §3: "Two traps for a second implementation."
    const c = draw(
      '> **Two traps.**\n>\n> 1. The message is the **decoded** hash.\n> 2. The encoding is raw.\n>\n> ```bash\n> echo hi\n> ```',
    );
    const q = c.querySelector('blockquote');
    expect(q?.querySelectorAll('p')).toHaveLength(1);
    expect(q?.querySelectorAll('ol > li')).toHaveLength(2);
    expect(q?.querySelector('pre')?.textContent).toBe('echo hi');
    expect(c.querySelectorAll('blockquote')).toHaveLength(1);
  });
});

describe('breaks, escapes and raw text', () => {
  it('makes a line break from two trailing spaces and from <br>, and shows neither', () => {
    const c = draw('one  \ntwo<br>three');
    expect(c.querySelectorAll('br')).toHaveLength(2);
    expect(proseOf(c)).not.toContain('<br');
  });

  it('decodes &amp; and &#8212;, and leaves an unknown entity alone', () => {
    expect(draw('a &amp; b &#8212; c &nosuch; d').querySelector('p')?.textContent).toBe('a & b — c &nosuch; d');
  });

  it('lets a backslash escape punctuation', () => {
    expect(draw('\\*not bold\\* and \\[not a link\\]').querySelector('p')?.textContent).toBe(
      '*not bold* and [not a link]',
    );
  });

  it('hides an HTML comment and shows any other tag as the text it is', () => {
    const c = draw('<!-- for the author -->\n\nsee <b>this</b>');
    expect(c.querySelectorAll('b')).toHaveLength(0);
    expect(c.textContent).toBe('see <b>this</b>');
  });

  it('boxes an indented code block and a ~~~ fence like a ``` one', () => {
    const c = draw('text\n\n    indented();\n\n~~~json\n{ "a": 1 }\n~~~');
    const pres = Array.from(c.querySelectorAll('pre')).map((pre) => pre.textContent);
    expect(pres).toEqual(['indented();', '{ "a": 1 }']);
    expect(screen.getByText('json')).toBeInTheDocument();
  });
});
