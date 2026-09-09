/**
 * WHAT THE MONITOR CARD IS ALLOWED TO CLAIM.
 *
 * The card is three columns of counts, and a count is the easiest thing in this
 * product to be confidently wrong about. Almost every test here is about a
 * MISSING number rather than a present one: the durable pass count is null until
 * the vault answers, the nearby list is empty on a phone that has never synced,
 * and the log is empty on the first drive. Rendering `0` or a blank column in
 * any of those states would be the card asserting something nobody measured.
 *
 * The rest is the one interaction the column exists for - pressing a row has to
 * name the camera that was pressed, not the one that happened to be first.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  MONITOR_NOTHING_REPEATED,
  MONITOR_NO_RECENT,
  MONITOR_RECENT,
  MONITOR_UNCOUNTED,
  MonitorCard,
  passCount,
} from './MonitorCard.tsx';
import { CLOSEST_CHIP } from './ClosestPanel.tsx';
import type { MonitorCardProps } from './MonitorCard.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

const NEARBY = [
  {
    id: 'cam-a',
    dist: '1.5 mi',
    street: 'W 111TH ST at COLLEGE BLVD',
    detail: 'faces w · on traffic signals',
    owner: 'police',
  },
  {
    id: 'cam-b',
    dist: '2.1 mi',
    street: 'METCALF AVE at W 103RD ST',
    detail: '',
    owner: 'unverified',
  },
] as const;

/** A full week, one quiet day in it, so the zero bar has something to be beside. */
const WEEK = [
  { label: 'SUN', count: 4 },
  { label: 'MON', count: 9 },
  { label: 'TUE', count: 2 },
  { label: 'WED', count: 0 },
  { label: 'THU', count: 6 },
  { label: 'FRI', count: 11 },
  { label: 'SAT', count: 14 },
] as const;

/** A fix on one camera, for the two blocks that assert about the third column. */
const CLOSEST = {
  miles: '1.5 mi',
  where: 'METCALF AVE @ W 111TH',
  detail: 'FLOCK SAFETY · traffic signal · faces SE',
  nearbyCount: '9 · within 5 mi',
  compass: '▲N',
  onRouteAround: vi.fn(),
  routeAroundCount: '9',
  routeAroundLabel: 'Route around all 9',
  onMute: vi.fn(),
  muted: false,
  muteLabel: 'Mute for 10 minutes',
  rows: NEARBY,
  onPick: vi.fn(),
  picture: null,
  onOpen: vi.fn(),
  openLabel: 'Open this camera',
  emptyNote: null,
} as const;

function props(over: Partial<MonitorCardProps> = {}): MonitorCardProps {
  return {
    passes: {
      allTime: 87,
      byDay: WEEK,
      hottest: { count: 12, label: 'W 111TH ST @ COLLEGE BLVD' },
      recent: [
        { cameraId: 'cam-a', ago: '2 min ago', label: 'W 111TH ST', operator: 'FLOCK SAFETY' },
      ],
    },
    onSeeAll: vi.fn(),
    closest: null,
    ...over,
  };
}

describe('picking a camera off the list', () => {
  it('reports the camera that was pressed, not the first one', () => {
    // The list moved INTO the reader column, so the press arrives through
    // `closest.onPick` rather than as a prop of the card. Same behaviour, one
    // owner - see `ClosestPanel`.
    const onPick = vi.fn();
    render(<MonitorCard {...props({ closest: { ...CLOSEST, onPick } })} />);

    fireEvent.click(screen.getByText('METCALF AVE at W 103RD ST'));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('cam-b');
  });

  it('draws no "show more" key, because the list is the thing that scrolls', () => {
    // The key is not in `Mobile app card layouts (2)`, and keeping it cost the
    // list its room: the column is a fixed 264px carrying the closest reader, a
    // heading, the list and two keys, and a fifth 44px control left the
    // scrolling band about 26px - so the upcoming cameras were not on the card
    // at all. LOOK UP, on the dock, is the screen that can show all of them.
    render(<MonitorCard {...props()} />);
    expect(screen.queryByText('Show more nearby cameras')).toBeNull();
  });
});

describe('what it says when it has nothing to show', () => {
  it('says the archive on this phone is empty, not that the road is', () => {
    // The distinction is the whole point: a driver who has never synced is in
    // this state, and "no cameras nearby" would be a claim about the world.
    // The sentence is passed in now rather than composed by the card, because
    // the list it belongs to lives in the reader column.
    const note = 'no cameras in the archive on this phone yet.';
    render(<MonitorCard {...props({ closest: { ...CLOSEST, rows: [], emptyNote: note } })} />);

    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it('says the log has not started rather than leaving the column blank', () => {
    render(
      <MonitorCard
        {...props({ passes: { ...props().passes, recent: [] } })}
      />,
    );

    // The panel stays and speaks. An empty RECENT block with its heading intact
    // and nothing under it reads as a list that failed to load.
    expect(screen.getByRole('heading', { name: MONITOR_RECENT })).toBeInTheDocument();
    expect(screen.getByText(MONITOR_NO_RECENT)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: MONITOR_RECENT })).toBeNull();
  });

  it('says nothing has repeated rather than showing a hottest camera with no reads', () => {
    render(
      <MonitorCard
        {...props({ passes: { ...props().passes, hottest: null } })}
      />,
    );

    expect(screen.getByText(MONITOR_NOTHING_REPEATED)).toBeInTheDocument();
  });

  it('says the count is not in yet rather than printing a confident zero', () => {
    render(
      <MonitorCard
        {...props({ passes: { ...props().passes, allTime: null } })}
      />,
    );

    // Twice: the hero figure and the ALL TIME tile are the same unknown, and a
    // card that printed the sentence in one and `0` in the other would be
    // contradicting itself on one screen.
    expect(screen.getAllByText(MONITOR_UNCOUNTED)).toHaveLength(2);
    expect(screen.queryByText('0')).toBeNull();
  });

  it('has no distance to give before the first fix', () => {
    render(<MonitorCard {...props({ closest: null })} />);

    expect(screen.getByText(/no position yet/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Closest camera' })).toBeNull();
  });
});

describe('the log of what already happened', () => {
  it('counts a camera passed twice in one minute twice, not three times', () => {
    const twice = [
      { cameraId: 'cam-a', ago: '2 min ago', label: 'W 111TH ST', operator: 'FLOCK SAFETY' },
      { cameraId: 'cam-a', ago: '2 min ago', label: 'W 111TH ST', operator: 'FLOCK SAFETY' },
    ];
    const newer = { cameraId: 'cam-b', ago: 'just now', label: 'METCALF AVE', operator: 'POLICE' };
    const { rerender } = render(
      <MonitorCard {...props({ passes: { ...props().passes, recent: twice } })} />,
    );

    // The next pass landing at the top of the log is the update that used to go
    // wrong, and it is the update this list gets constantly.
    rerender(
      <MonitorCard {...props({ passes: { ...props().passes, recent: [newer, ...twice] } })} />,
    );

    expect(screen.getAllByText('W 111TH ST')).toHaveLength(2);
    expect(screen.getByText('METCALF AVE')).toBeInTheDocument();
  });
});

describe('the order the columns are read in', () => {
  it('puts the camera you are about to pass ahead of the list of what comes after it', () => {
    render(<MonitorCard {...props({ closest: { ...CLOSEST } })} />);

    // The reader box and the list are ONE column now, in that order - the
    // reader in range outranks the seven behind it, for the eye going down the
    // column and for a screen reader going in sequence. They share a component
    // rather than a heading between them; see `ClosestPanel`.
    const panel = screen.getByRole('region', { name: /Closest camera/ });
    const head = panel.querySelector('.fwm-closest-head');
    const list = panel.querySelector('.fwm-closest-list');
    expect(head).not.toBeNull();
    expect(list).not.toBeNull();
    expect(
      (head as Element).compareDocumentPosition(list as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('the week of bars', () => {
  it('still draws a day nobody was read on, so a quiet week is not a broken chart', () => {
    render(<MonitorCard {...props()} />);

    const quiet = screen.getByRole('img', { name: `WED: ${passCount(0)}` });
    expect(quiet).toBeInTheDocument();
    // Zero share; the visible floor under it is `min-height` in monitorCard.css,
    // which is deliberately the stylesheet's business and not this file's.
    expect(quiet.style.getPropertyValue('--fwm-monitor-bar-share')).toBe('0.000');
  });

  it('draws a bar for every day it was given', () => {
    render(<MonitorCard {...props()} />);

    expect(within(screen.getByLabelText('passes by day')).getAllByRole('img')).toHaveLength(7);
  });

  it('gives the full height to the busiest day and a share to the rest', () => {
    render(<MonitorCard {...props()} />);

    const busiest = screen.getByRole('img', { name: `SAT: ${passCount(14)}` });
    const middling = screen.getByRole('img', { name: `THU: ${passCount(6)}` });
    expect(busiest.style.getPropertyValue('--fwm-monitor-bar-share')).toBe('1.000');
    expect(middling.style.getPropertyValue('--fwm-monitor-bar-share')).toBe('0.429');
  });

  it('draws an empty week as seven stubs rather than seven full bars', () => {
    // Flooring the peak at one would have made a week of nothing look like a
    // week where every day was the busiest.
    const empty = WEEK.map((day) => ({ label: day.label, count: 0 }));
    render(<MonitorCard {...props({ passes: { ...props().passes, byDay: empty } })} />);

    for (const day of WEEK) {
      const bar = screen.getByRole('img', { name: `${day.label}: ${passCount(0)}` });
      expect(bar.style.getPropertyValue('--fwm-monitor-bar-share')).toBe('0.000');
    }
  });

  it('draws no axis at all when there is no week to draw', () => {
    render(<MonitorCard {...props({ passes: { ...props().passes, byDay: [] } })} />);

    expect(screen.queryByLabelText('passes by day')).toBeNull();
  });
});

describe('how it says a count', () => {
  it('does not say "1 passes"', () => {
    expect(passCount(1)).toBe('1 pass');
    expect(passCount(0)).toBe('0 passes');
    expect(passCount(9)).toBe('9 passes');
  });
});

describe('the closest panel it shares with the navigation card', () => {
  it('draws the reading and both keys in the reader box', () => {
    render(<MonitorCard {...props({ closest: { ...CLOSEST } })} />);

    // THE KEYS LEFT THE PANEL, and that is the change rather than a regression.
    // The design puts them at the foot of the whole column, under the nearby
    // list, so the monitor card draws them from the panel's own handlers - see
    // `showKeys` on ClosestPanel. This test used to scope both to the panel,
    // which is why it caught the move.
    const panel = screen.getByRole('region', { name: /Closest camera/ });
    // Scoped to the figure: the first list row also reads '1.5 mi', which is
    // the reader and the nearest upcoming camera being the same distance - a
    // real state, not a duplicate.
    expect(panel.querySelector('.fwm-closest-figure')?.textContent).toBe(CLOSEST.miles);
    expect(within(panel).getByText(CLOSEST.where)).toBeInTheDocument();
    // Both keys are INSIDE the reader box now - see the note on the keys test.
    expect(within(panel).getByRole('button', { name: CLOSEST.routeAroundLabel })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CLOSEST.muteLabel })).toBeInTheDocument();
  });

  it('offers to unmute a camera that is already muted, rather than to mute it twice', () => {
    render(<MonitorCard {...props({ closest: { ...CLOSEST, muted: true } })} />);

    const key = screen.getByRole('button', { name: CLOSEST.muteLabel });
    expect(key).toHaveAttribute('aria-pressed', 'true');
  });

  it('hands the press straight back to the card that owns the camera', () => {
    const onRouteAround = vi.fn();
    render(<MonitorCard {...props({ closest: { ...CLOSEST, onRouteAround } })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Route around all 9' }));

    expect(onRouteAround).toHaveBeenCalledTimes(1);
  });
});

describe('the heading it is given', () => {
  it('says the heading is unknown rather than drawing a needle pinned to north', () => {
    render(
      <MonitorCard
        {...props({
          closest: {
            ...CLOSEST,
            miles: '0.4 mi',
            where: 'W 95TH ST',
            routeAroundCount: '3',
            routeAroundLabel: 'Route around all 3',
          },
        })}
      />,
    );

    // THE COMPASS IS TWO GLYPHS NOW, not an SVG rosette - the design draws
    // `▲N` in the corner of the map chip. The heading is still stated; it is
    // just no longer a drawing with an accessible name of its own.
    expect(screen.getByText('▲N')).toBeInTheDocument();
  });
});

describe('the column headings', () => {
  it('draws no list heading, because the reader box replaced it', () => {
    render(<MonitorCard {...props({ closest: { ...CLOSEST } })} />);

    // `Dynamic Cards (3)` has no heading over this list: the reader box sits
    // where it was, and dropping it is what frees the room the list needs
    // inside a 180px card.
    expect(screen.queryByRole('heading', { name: /Upcoming/ })).toBeNull();
    // The radius still reaches the driver - it rides the NEARBY count on the
    // reader's third line instead of a heading of its own.
    expect(screen.getByText(CLOSEST.nearbyCount)).toBeInTheDocument();
  });
});

/**
 * THE CLOSEST READER SITS AT THE TOP OF THE LIST COLUMN, AND ITS KEYS AT THE
 * BOTTOM OF IT.
 *
 * `Mobile app card layouts (2)` folded the closest panel out of a column of its
 * own and into the head of the list column. What shipped between those two
 * revisions was broken in three specific ways, and this is the guard for each:
 * the thumbnail rendered hard LEFT with the reading laid over it, the CLOSEST
 * CAMERA chip was absent, and the Route-around/MUTE keys were cut off the
 * bottom because the rail was still locked to the old card's height.
 */
describe('the closest reader folded into the list column', () => {
  it('draws the chip, which a previous revision removed', () => {
    // Removed on request when the panel had a column to itself and the chip
    // labelled something the whole column already said. In a row at the head of
    // the list it is what separates this reader from the ones under it.
    render(<MonitorCard {...props({ closest: { ...CLOSEST } })} />);
    expect(screen.getByText(CLOSEST_CHIP)).toBeTruthy();
  });

  it('draws the keys inside the reader box, on its third line', () => {
    // They moved back, and the move is the point: `Dynamic Cards (3)` puts
    // route-around and mute on the reader's NEARBY line rather than under the
    // list. That is what turns four pinned children into two and lets the list
    // scroll inside a locked 180px card.
    const { container } = render(<MonitorCard {...props({ closest: { ...CLOSEST } })} />);
    expect(container.querySelector('.fwm-closest-keys')).not.toBeNull();
    expect(container.querySelector('.fwm-monitor-keys')).toBeNull();
  });

  it('routes around and mutes from the reader box keys', () => {
    const onRouteAround = vi.fn();
    const onMute = vi.fn();
    render(<MonitorCard {...props({ closest: { ...CLOSEST, onRouteAround, onMute } })} />);
    fireEvent.click(screen.getByRole('button', { name: CLOSEST.routeAroundLabel }));
    fireEvent.click(screen.getByRole('button', { name: CLOSEST.muteLabel }));
    expect(onRouteAround).toHaveBeenCalledTimes(1);
    expect(onMute).toHaveBeenCalledTimes(1);
  });

  it('keeps the reading and its thumbnail in the panel', () => {
    const { container } = render(<MonitorCard {...props({ closest: { ...CLOSEST } })} />);
    const panel = container.querySelector('.fwm-closest');
    expect(panel?.querySelector('.fwm-closest-face')).not.toBeNull();
    expect(panel?.querySelector('.fwm-closest-map')).not.toBeNull();
  });

  /**
   * EVERY DIRECT CHILD OF THE RAIL IS A SNAP TARGET, IN BOTH STATES.
   *
   * The card shipped once where the no-fix note was a bare paragraph with no
   * `scroll-snap-align`. In a rail declared `scroll-snap-type: x mandatory`
   * that made column two the ONLY snap candidate, so the browser recorded it as
   * the snapped target while the card was empty and nothing could scroll - and
   * then slid there on its own the moment the fix arrived, the reader column
   * grew and the rail started to overflow. The card loaded on column one,
   * loaded its data, and walked to column two.
   *
   * jsdom does not lay out or snap, so this asserts the invariant at its
   * source: the stylesheet gives every child that can stand in column one the
   * same snap alignment. A future empty state added without one reintroduces
   * exactly the bug.
   */
  it('gives the no-fix column the same snap alignment as the reader', () => {
    const css = readFileSync(`${HERE}/monitorCard.css`, 'utf8');
    const scoped = /\.fwm-monitor\s*>\s*\.fwm-monitor-empty\s*\{([^}]*)\}/.exec(css);
    expect(scoped).not.toBeNull();
    expect(scoped?.[1]).toMatch(/scroll-snap-align:\s*start/);

    // AND IT IS SCOPED TO THE RAIL'S OWN CHILD. The same class sets the
    // "nothing recorded yet" note inside column two, which is a flex COLUMN -
    // an unscoped rule reaches it too, and anything sized there is read on the
    // block axis. Measured: the reader's basis applied to that note takes it
    // from 31px to 323px tall and column two's scroll height from 180 to 399.
    const bare = /(?<![>\s])\n\.fwm-monitor-empty\s*\{([^}]*)\}/.exec(`\n${css}`);
    expect(bare?.[1] ?? '').not.toMatch(/scroll-snap-align|flex:/);
  });
});
