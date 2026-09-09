/**
 * LOOK UP GROUPS ITS RESULTS BY STREET, AND THE BADGE COUNTS WHAT IT DREW.
 *
 * =============================================================================
 * WHY THIS IS A RENDER TEST AND NOT ONLY `streetGroups.test.ts`
 * =============================================================================
 * The grouping itself is a pure function and is asserted there, one array in,
 * one array of groups out. What that cannot see is the half of this feature
 * that lives in JSX: whether the number painted in the badge is the length of
 * the list rendered beneath it, or a length computed somewhere else that
 * happens to agree today. A badge that says 6 over four rows is the single
 * worst outcome available here - it is the app miscounting cameras on a screen
 * whose entire claim is that it knows what is on this phone - and only a mount
 * can rule it out.
 *
 * It also holds the two facts the owner asked for by name: the camera with no
 * street is still on the screen, and the owner is still on every row now that
 * it is no longer what the list is grouped by.
 *
 * This mounts the v1 component, for the reason `LookupV1Screen.ownerFilter.
 * test.tsx` gives: `lookup` maps to `LookupV1Screen` in `app/registry.v1.tsx`,
 * so a test against anything else asserts about a screen the build never draws.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useCamerasStore } from '../../stores/cameras.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import type { CameraRecord } from '../../services/db/schema.ts';

import { LookupV1Screen, OWNER_CHIP_LABELS } from './LookupV1Screen.tsx';
import { NO_STREET_LABEL } from './streetGroups.ts';

/**
 * TWO CAMERAS ON ONE ROAD, one on another, and one the archive has no street
 * for - which is not an edge case but 26.67% of the shipped archive.
 *
 * The two on METCALF have different owners on purpose: it is what lets the
 * filter test prove a chip shrank a card rather than removed one.
 *
 * There is no fix in a mount, so `searchCameras` orders by id, which is why the
 * ids sort into the order the cards are expected in below.
 */
const ARCHIVE: readonly CameraRecord[] = [
  {
    id: 'osm:a-metcalf-75',
    lat: 38.91,
    lon: -94.67,
    directionDeg: 180,
    ownerType: 'police',
    street: 'METCALF AVE',
    cross: '75TH ST',
  },
  {
    id: 'osm:b-metcalf-79',
    lat: 38.92,
    lon: -94.67,
    directionDeg: 180,
    ownerType: 'hoa',
    street: 'METCALF AVE',
    cross: '79TH ST',
  },
  {
    id: 'osm:c-nall',
    lat: 38.93,
    lon: -94.64,
    directionDeg: null,
    ownerType: 'police',
    street: 'NALL AVE',
  },
  { id: 'osm:d-nowhere', lat: 38.94, lon: -94.61, directionDeg: null },
];

function putArchive(): void {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras: ARCHIVE,
      fetchedAtMs: 1_700_000_000_000,
      freshness: 'fresh',
      source: 'network',
    },
  ]);
}

function results(): HTMLElement {
  return screen.getByRole('list', { name: 'results' });
}

/** The street cards, in the order LOOK UP drew them. */
function cards(): readonly HTMLElement[] {
  return [...results().querySelectorAll<HTMLElement>('.fwm-lookupv1-group')];
}

function headingOf(card: HTMLElement): string {
  return card.querySelector('.fwm-lookupv1-street')?.textContent ?? '';
}

/** What the badge says. A string, because what is being checked is what a
 *  driver reads, not what a number coerces to. */
function badgeOf(card: HTMLElement): string {
  return card.querySelector('.fwm-lookupv1-tally')?.textContent ?? '';
}

/** The rows actually rendered under a card. Every one of them is a button. */
function rowsOf(card: HTMLElement): readonly HTMLElement[] {
  return within(card).getAllByRole('button');
}

/** An owner chip, by the label the driver reads. */
function chip(name: string): HTMLElement {
  return within(screen.getByRole('group', { name: 'owner' })).getByRole('button', { name });
}

afterEach(() => {
  useCamerasStore.getState().reset();
  useSettingsStore.getState().reset();
});

describe('LOOK UP, grouped by street', () => {
  it('puts the two cameras on one road under a single heading badged 2', () => {
    putArchive();
    render(<LookupV1Screen />);

    const [metcalf] = cards();

    expect(metcalf).toBeDefined();
    expect(metcalf && headingOf(metcalf)).toBe('METCALF AVE');
    expect(metcalf && badgeOf(metcalf)).toBe('2');
    expect(metcalf && rowsOf(metcalf)).toHaveLength(2);
  });

  it('gives a road with one camera its own card rather than folding it in', () => {
    putArchive();
    render(<LookupV1Screen />);

    expect(cards().map(headingOf)).toEqual(['METCALF AVE', 'NALL AVE', NO_STREET_LABEL]);
  });

  it('says the archive has no street for a camera rather than dropping it', () => {
    putArchive();
    render(<LookupV1Screen />);

    const last = cards().at(-1);

    expect(last).toBeDefined();
    expect(last && headingOf(last)).toBe(NO_STREET_LABEL);
    // It is drawn as a note about the archive, NOT as a place. The stylesheet
    // reads this to stop `street not recorded` looking like a road name.
    expect(last).toHaveAttribute('data-fwm-street', 'false');
    // And the camera is genuinely on the screen, not merely counted.
    expect(last && within(last).getByText('osm:d-nowhere')).toBeInTheDocument();
  });

  it('does not tip the streetless camera into the first street it found', () => {
    putArchive();
    render(<LookupV1Screen />);

    const [metcalf] = cards();

    expect(metcalf && badgeOf(metcalf)).toBe('2');
    expect(metcalf && within(metcalf).queryByText('osm:d-nowhere')).toBeNull();
  });

  it('counts the rows it actually drew, on every card', () => {
    putArchive();
    render(<LookupV1Screen />);

    const drawn = cards();

    // A loop over nothing passes. The archive has four cameras on three
    // headings, so anything less than three cards is already the bug.
    expect(drawn).toHaveLength(3);
    for (const card of drawn) {
      expect(badgeOf(card), `${headingOf(card)} is badged wrong`).toBe(
        String(rowsOf(card).length),
      );
    }
  });

  it('badges add up to the figure at the top, which counts the same search', () => {
    putArchive();
    render(<LookupV1Screen />);

    const total = cards().reduce((sum, card) => sum + Number(badgeOf(card)), 0);

    expect(total).toBe(ARCHIVE.length);
    expect(screen.getByText(String(ARCHIVE.length))).toBeInTheDocument();
  });

  /*
   * =========================================================================
   * THE SECOND LINE CHANGED HANDS, AND THIS CASE CHANGED WITH IT
   * =========================================================================
   * It used to read `.fwm-lookupv1-owner` and assert one owner label per
   * camera. Brief 4 puts the camera id on that line instead - "the id goes
   * secondary in JetBrains Mono 11.5px faint" - and moves the owner to the 9px
   * mark at the head of the row.
   *
   * Both halves of that are asserted below rather than one, because dropping
   * the owner assertion would have quietly removed the only check that the
   * screen says who is watching at all. It still does; it says it in colour.
   */
  it('puts a context line on every row, secondary, and never the id as the name', () => {
    putArchive();
    render(<LookupV1Screen />);

    const context = [...results().querySelectorAll('.fwm-lookupv1-context')].map(
      (line) => line.textContent ?? '',
    );
    const names = [...results().querySelectorAll('.fwm-lookupv1-place')].map(
      (line) => line.textContent ?? '',
    );

    // One line per camera, and none of them empty: the record's maker, mount,
    // facing and town, or -- for a record that knows none of that -- its id.
    expect(context).toHaveLength(ARCHIVE.length);
    for (const line of context) expect(line).not.toBe('');
    // And no id is doing duty as the row's name.
    expect(names).toHaveLength(ARCHIVE.length);
    for (const name of names) expect(name).not.toContain('osm:');
  });

  it('keeps the owner on every row, as the mark rather than as a line', () => {
    putArchive();
    render(<LookupV1Screen />);

    const marks = [...results().querySelectorAll('.fwm-screen-dot')].map((dot) =>
      dot.getAttribute('data-fwm-owner'),
    );

    // One mark per camera, carrying the class the chips above filter on.
    expect(marks).toEqual(['police', 'hoa', 'police', 'unknown']);
    // ABSENT IS NOT UNVERIFIED. The record with no `ownerType` is `unknown`,
    // which the stylesheet draws grey - not the unverified purple, which is a
    // class somebody assigned rather than the absence of one.
    expect(marks).not.toContain('unverified');
  });

  it('narrows the cards when an owner chip is pressed, and the badge follows', () => {
    putArchive();
    render(<LookupV1Screen />);

    fireEvent.click(chip(OWNER_CHIP_LABELS.hoa));

    // METCALF loses one of its two and keeps the other; NALL and the streetless
    // camera are police and unrecorded, so their cards go entirely.
    expect(cards().map(headingOf)).toEqual(['METCALF AVE']);
    const [metcalf] = cards();
    expect(metcalf && badgeOf(metcalf)).toBe('1');
    expect(metcalf && rowsOf(metcalf)).toHaveLength(1);
  });

  it('draws no cards at all for a query nothing matches', () => {
    putArchive();
    render(<LookupV1Screen />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Look up' }), {
      target: { value: 'shawnee mission pkwy' },
    });

    // No empty card headed with a street nobody matched, and no trailing
    // "street not recorded" card standing on its own.
    expect(cards()).toEqual([]);
  });
});
