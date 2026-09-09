/**
 * THE WHOLE CARD IS THE TAP TARGET, AND EVERY NUMBER ON THE SCREEN IS MEASURED.
 *
 * =============================================================================
 * TWO FAILURES, BOTH OF WHICH THIS SCREEN HAS ALREADY SHIPPED
 * =============================================================================
 * A TARGET THE SIZE OF A LINE OF 12px TEXT. The card was an `<li>` with the
 * citation anchor buried at the bottom of a fourteen-line body, so the only
 * reachable thing on a card about somebody's misconduct was one line of source
 * text. Brief 4 makes the card itself the target; this asserts there is exactly
 * one interactive element per card and that it goes to the record's own source.
 * Nesting an anchor inside a card-level target -- the obvious way to keep both
 * -- is invalid markup and unreachable by keyboard, so it is asserted against.
 *
 * A COUNT THAT IS A CONSTANT. The component's own file header said "47 entries
 * across 38 counties" while the file it reads had grown to 93 records and 125
 * incidents. The hero prints those numbers, so the risk is that somebody types
 * one in. These read the shipped record file and compare the hero to it.
 *
 * The record file is the REAL one, read off disk, for the reason
 * `MisuseScreen.nearMe.test.tsx` gives: a fixture would prove the wiring and say
 * nothing about whether the screen the app ships tells the truth about the data
 * the app ships.
 *
 * =============================================================================
 * WHY THE FETCH STUB IS HOISTED
 * =============================================================================
 * `createCountyRecords` captures `globalThis.fetch.bind(globalThis)` when the
 * module is evaluated, and the app's one index is created at the bottom of that
 * module - so the singleton is holding the REAL fetch before any `beforeEach`
 * runs, and a `vi.stubGlobal` after the import reaches nothing. `vi.hoisted`
 * runs above the imports, which is the only place a stub can still be seen.
 *
 * This is worth knowing about rather than working around: it is also why
 * `MisuseScreen.nearMe.test.tsx` can stub in a `beforeEach` and still pass --
 * everything it asserts comes from `countyLocate`, which reads `fetch` lazily.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Installed above the imports, and it reads the files LAZILY: the hoisted body
 * runs before every import in this file has been evaluated, so the `node:fs`
 * binding at the top is still in its temporal dead zone here. A `fetch` returns
 * a promise anyway, so the read can wait until the first call, by which time
 * everything is up.
 */
vi.hoisted(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const { readFileSync: read } = await import('node:fs');
    const { resolve: from } = await import('node:path');
    const served = (file: string): Response =>
      new Response(read(from(process.cwd(), 'public/records', file), 'utf8'), { status: 200 });
    if (url.includes('/records/counties.json')) return served('counties.json');
    if (url.includes('county-index.json')) return served('county-index.json');
    // Everything else -- the atlas file above all -- is a 404, which the atlas
    // block renders as "the atlas file could not be read" rather than as an
    // empty atlas. That distinction is its own service's test, not this one's.
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
});

import { positionActions } from '../../stores/position.ts';

import { MisuseScreen } from './MisuseScreen.tsx';

/** The same bytes the stub above serves, for comparing the screen against. */
const RECORDS_JSON = readFileSync(
  resolve(process.cwd(), 'public/records/counties.json'),
  'utf8',
);

interface ShippedRecord {
  readonly agency: string;
  readonly year: number;
  readonly incidents: number;
  readonly summary: string;
  readonly sourceUrl: string;
}

/** The file as the app reads it, newest first -- the order the index sorts to. */
function shipped(): readonly ShippedRecord[] {
  const parsed = JSON.parse(RECORDS_JSON) as { records?: ShippedRecord[] };
  return [...(parsed.records ?? [])].sort((a, b) => b.year - a.year);
}

/** Renders and waits for the record file to land. */
async function drawLoaded(): Promise<HTMLElement[]> {
  render(<MisuseScreen />);
  await waitFor(() => {
    expect(screen.getByLabelText('records').children.length).toBeGreaterThan(0);
  });
  return Array.from(screen.getByLabelText('records').children) as HTMLElement[];
}

/** The card element itself, which is the anchor. */
function cardOf(item: HTMLElement | undefined): HTMLElement {
  if (item === undefined) throw new Error('no case card rendered');
  return within(item).getByRole('link');
}

beforeEach(() => {
  positionActions.reset();
});

afterEach(() => {
  positionActions.reset();
});

describe('the case card', () => {
  it('is one target, and that target is the citation', async () => {
    const cards = await drawLoaded();
    const card = cardOf(cards[0]);

    expect(within(cards[0] as HTMLElement).getAllByRole('link')).toHaveLength(1);

    // Opened away from the app, with no referrer, so the outlet's logs do not
    // record which of our screens sent them.
    expect(card).toHaveAttribute('target', '_blank');
    expect(card.getAttribute('rel') ?? '').toContain('noreferrer');
    expect((card.getAttribute('href') ?? '').startsWith('http')).toBe(true);
  });

  it('has no interactive element nested inside that target', async () => {
    // The obvious way to keep the whole card pressable AND the old source
    // anchor is to put one inside the other. That is invalid markup, and the
    // inner one is unreachable by keyboard in every browser.
    const cards = await drawLoaded();
    expect(cardOf(cards[0]).querySelectorAll('a, button')).toHaveLength(0);
  });

  it('leads with the incident count and the year, and names the agency', async () => {
    const cards = await drawLoaded();
    const card = cardOf(cards[0]);
    // Found by its own href rather than by assuming which record sorts first:
    // the index sorts newest-first and ties within a year keep file order, and
    // pinning that here would be testing the sort rather than the card.
    const href = card.getAttribute('href') ?? '';
    const record = shipped().find((r) => r.sourceUrl === href);
    if (record === undefined) throw new Error(`no shipped record for ${href}`);

    const plural = record.incidents === 1 ? 'incident' : 'incidents';
    expect(within(card).getByText(`${String(record.incidents)} ${plural}`)).toBeInTheDocument();
    expect(within(card).getByText(String(record.year))).toBeInTheDocument();
    expect(within(card).getByText(record.agency)).toBeInTheDocument();
  });

  it('renders every summary in full and clamps it visually, never in the text', async () => {
    // The clamp is three lines of CSS. Truncating the STRING would mean a
    // reader who copies a card gets a sentence that stops mid-clause, and this
    // screen makes public allegations about named agencies. The longest
    // summary in the shipped file is over a thousand characters.
    await drawLoaded();
    const longest = [...shipped()].sort((a, b) => b.summary.length - a.summary.length)[0];
    if (longest === undefined) throw new Error('the record file is empty');
    expect(longest.summary.length).toBeGreaterThan(500);
    expect(screen.getByText(longest.summary)).toBeInTheDocument();
  });
});

describe('the hero count', () => {
  it('counts the records and the incidents in the file it just read', async () => {
    await drawLoaded();
    const records = shipped();
    const incidents = records.reduce((sum, r) => sum + r.incidents, 0);
    // Not a constant anywhere: the component's own header said "47 entries"
    // while the file held 93.
    expect(
      screen.getByText(
        new RegExp(`${String(records.length)} cases · ${String(incidents)} incidents`),
      ),
    ).toBeInTheDocument();
  });

  it('offers one year chip per year the file actually holds, newest first', async () => {
    await drawLoaded();
    const years = [...new Set(shipped().map((r) => r.year))].sort((a, b) => b - a);
    expect(years.length).toBeGreaterThan(1);
    for (const year of years) {
      expect(screen.getByRole('button', { name: String(year) })).toBeInTheDocument();
    }
    // And no year the file does not hold. 2021 is absent from the shipped set.
    expect(years).not.toContain(2021);
    expect(screen.queryByRole('button', { name: '2021' })).toBeNull();
  });

  it('keeps Near me a disabled button with no fix, which is the honest state', async () => {
    // Pinned here as well as in `MisuseScreen.nearMe.test.tsx` because the chip
    // moved into a horizontal scroller in this pass: `disabled`, not
    // `aria-disabled`, because with no county there is genuinely nothing to
    // compare against.
    await drawLoaded();
    const chip = screen.getByRole('button', { name: 'Near me' });
    expect(chip).toBeDisabled();
  });
});
