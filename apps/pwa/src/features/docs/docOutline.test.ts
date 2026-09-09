/**
 * THE SIZE LINE MUST NOT LIE ABOUT THE DOCUMENT.
 *
 * The reader's `§N of M · <words> · FILE.md` exists because a reader has no way
 * to judge how long a document is from its title. Every one of those numbers is
 * a measurement, and a measurement that is wrong is worse than no line at all -
 * it makes somebody close a two-screen document because it claimed to be forty,
 * or start an eight-thousand-word one believing it is short.
 *
 * The two failures pinned here are the ones that are easy to ship and hard to
 * notice:
 *
 *   FENCES. `# ` is a comment in shell and `docs/public/TAXONOMY.md` has
 *   fourteen `bash` blocks. A heading scan that does not track the fence state
 *   finds those comments and reports seventeen sections where there are nine,
 *   and nothing on screen looks broken - the number is simply wrong.
 *
 *   THE THIRD HEADING LEVEL. `###` outnumbers `##` five to one in that file. A
 *   count that includes it says "§0 of 49", which is not the spine of the
 *   document and is not what a reader is asking.
 *
 * The fixture at the bottom is shaped like the real file rather than minimal on
 * purpose: both bugs above only appear in a document that HAS fenced shell in
 * it, so a two-line fixture would pass either way.
 */

import { describe, expect, it } from 'vitest';

import { docOutline, docProgress, docSection, docSize } from './docOutline.ts';

/**
 * A document with the three traps in it: a `#` comment inside a bash fence, a
 * `##` comment inside another, and four `###` under one `##`.
 */
const DOC = [
  '# Taxonomy and export',
  '',
  'What DarkRoute calls things, and how each maps onto OpenStreetMap.',
  '',
  '## 0. The shortest possible orientation',
  '',
  'One entity type: an ALPR camera, at a point.',
  '',
  '```bash',
  '# Fetch the index. This is a comment, not a heading.',
  'curl -s https://darkroute.ai/cameras/index.json',
  '## Neither is this one.',
  '```',
  '',
  '## 1. The canonical vocabulary',
  '',
  '### 1.1 Camera',
  '',
  'A device that reads plates.',
  '',
  '### 1.2 Mount',
  '',
  'What it is bolted to.',
  '',
  '### 1.3 Facing',
  '',
  'Which way it looks.',
  '',
  '### 1.4 Owner type',
  '',
  'Whose hardware it is.',
].join('\n');

describe('the document spine', () => {
  it('counts the two top levels and no third one', () => {
    // One `#` and two `##`. The four `###` are terms inside a section, not
    // sections: including them would report seven.
    expect(docOutline(DOC).headings.map((h) => h.level)).toEqual([1, 2, 2]);
  });

  it('does not read a shell comment inside a fence as a heading', () => {
    // The single most likely way for this number to be wrong. `# Fetch the
    // index` and `## Neither is this one.` are both inside a ```bash block.
    const texts = docOutline(DOC).headings.map((h) => h.text);
    expect(texts).toEqual([
      'Taxonomy and export',
      '0. The shortest possible orientation',
      '1. The canonical vocabulary',
    ]);
  });

  it('gives the spec page its own §0 of 9 on a file shaped like the real one', () => {
    // `docs/public/TAXONOMY.md` measures 1 `#` + 8 `##`, which is where the
    // spec page's `§0 of 9` comes from: §0 is the title, 1..8 are the `##`.
    const shaped = ['# Title', ...Array.from({ length: 8 }, (_, n) => `## ${String(n)}. Part`)].join(
      '\n\n',
    );
    expect(docOutline(shaped).headings).toHaveLength(9);
  });
});

describe('the prose length', () => {
  it('counts no word that is inside a fenced code block', () => {
    const fenced = ['One two three.', '', '```bash', 'curl -s https://example.test/a/b/c', '```'].join(
      '\n',
    );
    // Three words of prose. The curl line is four more if the fence is ignored.
    expect(docOutline(fenced).words).toBe(3);
  });

  it('counts no heading as prose either', () => {
    // A heading is structure and is already counted as one; counting its words
    // again would inflate a document with 49 headings by a couple of hundred.
    expect(docOutline('# A B C\n\nOne two.').words).toBe(2);
  });

  it('rounds to a hundred, because which cells are words is a judgement', () => {
    expect(docSize(8308)).toBe('8,300 words');
    expect(docSize(8351)).toBe('8,400 words');
  });

  it('states a short document exactly rather than rounding it to zero', () => {
    expect(docSize(40)).toBe('40 words');
    expect(docSize(1)).toBe('1 word');
  });
});

describe('where the reader is', () => {
  const offsets = [0, 400, 1200, 2000];

  it('is in section zero until the first heading has passed the top', () => {
    expect(docSection(offsets, 0)).toBe(0);
    expect(docSection(offsets, 399)).toBe(0);
  });

  it('counts a heading exactly at the top of the band as entered', () => {
    // `<=`, not `<`. Anything else makes the number flicker by one as a reader
    // rests on a boundary.
    expect(docSection(offsets, 400)).toBe(1);
  });

  it('holds the last section at the foot of the document', () => {
    expect(docSection(offsets, 9999)).toBe(3);
  });

  it('says zero sections in when the document has no headings at all', () => {
    expect(docSection([], 500)).toBe(0);
  });
});

describe('how far through', () => {
  it('runs nought to one across the scrollable height', () => {
    expect(docProgress(0, 2000, 800)).toBe(0);
    expect(docProgress(600, 2000, 800)).toBe(0.5);
    expect(docProgress(1200, 2000, 800)).toBe(1);
  });

  it('reads as finished when the whole document already fits', () => {
    // Dividing by a zero scrollable height gives Infinity or NaN, and a rail
    // drawn from either is a rail nobody can explain. A document you can see
    // all of is one you have reached the end of.
    expect(docProgress(0, 600, 800)).toBe(1);
    expect(docProgress(0, 800, 800)).toBe(1);
  });

  it('never leaves the rail, whatever the browser reports mid-bounce', () => {
    // iOS reports a negative `scrollTop` during a rubber-band overscroll and an
    // over-large one at the bottom of the same gesture.
    expect(docProgress(-120, 2000, 800)).toBe(0);
    expect(docProgress(5000, 2000, 800)).toBe(1);
  });
});
