/**
 * WHAT THE NAVIGATION CARD IS ALLOWED TO CLAIM, AND WHAT IT MUST NOT DROP.
 *
 * Two failures these hold the line on, both of which have shipped before in
 * this product:
 *
 *   A card that reports only the readers it avoided and not the ones still on
 *   the line is a card that lies about the one thing the app is for. So the
 *   "could not be" half is asserted, singular and plural, and so is the phrase
 *   itself - "1 readers" is the sort of thing nobody notices in review and
 *   every driver notices at a light.
 *
 *   A route the router returned no maneuvers for is a legitimate answer, not an
 *   error, and the card still has to say where the drive ends. An empty turn
 *   column reads as a card that failed to load rather than as a straight line.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ClosestPanelProps } from './ClosestPanel.tsx';
import {
  avoidedLine,
  milesLabel,
  NAV_CLEAR,
  NAV_END,
  NavigationCard,
  onTheWayLine,
  readers,
  NAV_FAILED,
  NAV_PLANNING,
} from './NavigationCard.tsx';
import type { NavigationCardProps } from './NavigationCard.tsx';

const CLOSEST: ClosestPanelProps = {
  miles: '1.5 mi',
  where: 'METCALF AVE @ W 111TH',
  detail: 'FLOCK SAFETY · traffic signal · faces SE',
  nearbyCount: '9 · within 5 mi',
  compass: '▲N',
  onRouteAround: () => undefined,
  routeAroundCount: '9',
  routeAroundLabel: 'Route around all 9',
  onMute: () => undefined,
  muted: false,
  muteLabel: 'Mute for 10 minutes',
  rows: [],
  onPick: () => undefined,
  picture: null,
  onOpen: () => undefined,
  openLabel: 'Open this camera',
  emptyNote: null,
};

function card(over: Partial<NavigationCardProps> = {}): NavigationCardProps {
  return {
    destination: { name: 'Walmart Supercenter', detail: '11701 W 135th St, Overland Park' },
    eta: '34 min',
    miles: '23.0',
    status: 'ready',
    error: null,
    onLine: 1,
    cleared: 4,
    cost: '1.2 mi further · 6 min longer',
    turns: [
      { key: 't1', turn: 'right', instruction: 'Turn right onto W 111th St', miles: '1.2' },
      { key: 't2', turn: 'merge', instruction: 'Merge onto US-69 S', miles: '8.4' },
    ],
    arrival: {
      name: 'Walmart Supercenter',
      detail: '11701 W 135th St, Overland Park',
      eta: '34 min',
      miles: '23.0',
    },
    onReroute: () => undefined,
    rerouteLabel: 'Reroute · 1 reader still on it',
    onEnd: () => undefined,
    closest: null,
    ...over,
  };
}

describe('how the card counts readers', () => {
  it('never says "1 readers"', () => {
    expect(readers(1)).toBe('1 reader');
    expect(readers(0)).toBe('0 readers');
    expect(readers(9)).toBe('9 readers');
  });

  it('names what is on the way, in the singular when there is one', () => {
    expect(onTheWayLine(1)).toBe('1 reader on the way');
    expect(onTheWayLine(4)).toBe('4 readers on the way');
  });

  it('says the route is clear rather than saying nothing', () => {
    // An empty space cannot be told apart from a check that never ran.
    expect(onTheWayLine(0)).toBe(NAV_CLEAR);
  });

  it('says what it could not avoid', () => {
    expect(avoidedLine(4, 1)).toBe('4 readers avoided · 1 reader could not be');
    expect(avoidedLine(1, 2)).toBe('1 reader avoided · 2 readers could not be');
  });

  it('claims a clear line only when the line came back clear', () => {
    expect(avoidedLine(4, 0)).toBe('4 readers avoided · clear');
  });

  it('says nothing about avoidance before anything has been avoided', () => {
    expect(avoidedLine(0, 3)).toBeNull();
    expect(avoidedLine(0, 0)).toBeNull();
  });

  it('writes the unit on a distance the caller handed over bare', () => {
    expect(milesLabel('23.0')).toBe('23.0 mi');
  });
});

describe('what the card puts on screen', () => {
  it('leads with the destination, the time and the distance', () => {
    // Queried inside the first column rather than across the card: the arrival
    // row at the foot of the turn list repeats both figures, deliberately, and
    // a bare text query would pass on either one of them.
    const { container } = render(<NavigationCard {...card()} />);
    const plan = container.querySelector('.fwm-nav-plan');
    expect(plan?.querySelector('.fwm-nav-name')?.textContent).toBe('Walmart Supercenter');
    expect(plan?.querySelector('.fwm-nav-eta')?.textContent).toBe('34 min');
    expect(plan?.querySelector('.fwm-nav-miles')?.textContent).toBe('23.0 mi');
  });

  it('says how many readers are still on the line, and how many it cleared', () => {
    render(<NavigationCard {...card({ onLine: 1, cleared: 4 })} />);
    expect(screen.getByText('1 reader on the way')).toBeInTheDocument();
    expect(screen.getByText('4 readers avoided · 1 reader could not be')).toBeInTheDocument();
  });

  it('says the route came back clear rather than leaving the line blank', () => {
    // The helper is unit-tested above; this is the half that ships. A driver
    // who sees nothing there cannot tell a clear road from a check that never
    // ran, and the clear flag is what moves the line off the warning hue.
    const { container } = render(<NavigationCard {...card({ onLine: 0, cleared: 4 })} />);
    expect(screen.getByText(NAV_CLEAR)).toBeInTheDocument();
    expect(container.querySelector('.fwm-nav-online'))
      .toHaveAttribute('data-fwm-nav-clear', 'true');
    expect(screen.getByText('4 readers avoided · clear')).toBeInTheDocument();
  });

  it('repeats the time and the distance on the row where the drive ends', () => {
    // The arrival row is where a driver checks what the whole trip costs
    // without scrolling the turn list back to the top, so it carries both
    // figures itself rather than pointing at the head of the card.
    const { container } = render(<NavigationCard {...card()} />);
    const arrive = container.querySelector('.fwm-nav-arrive');
    expect(arrive?.querySelector('.fwm-nav-arrive-eta')?.textContent).toBe('34 min');
    expect(arrive?.querySelector('.fwm-nav-arrive-miles')?.textContent).toBe('23.0 mi');
    expect(arrive?.textContent).toContain('11701 W 135th St, Overland Park');
  });

  it('still says where the drive ends when the router gave no turns', () => {
    // An empty maneuver list is an answer, not a failure - a fixture route and
    // some router builds return one, and the line is still drivable.
    const { container } = render(<NavigationCard {...card({ turns: [] })} />);
    expect(screen.getByText('Arrive at Walmart Supercenter')).toBeInTheDocument();
    expect(container.querySelectorAll('.fwm-nav-turn')).toHaveLength(1);
  });

  it('joins the cost onto the address line, and leaves it out when there is none', () => {
    // The design gives the address and the detour's price ONE quiet line
    // instead of two, so the cost no longer has an element of its own. Both
    // halves still matter: the first plan of a drive has no plain route to
    // price against, and a dangling middot reads as a number that failed to
    // load.
    const { container } = render(<NavigationCard {...card({ cost: null })} />);
    const bare = container.querySelector('.fwm-nav-detail')?.textContent ?? '';
    expect(bare).not.toContain('·');

    const { container: priced } = render(<NavigationCard {...card()} />);
    expect(priced.querySelector('.fwm-nav-detail')?.textContent)
      .toContain('1.2 mi further · 6 min longer');
  });

  it('draws an arrow for every turn, including a kind it has never heard of', () => {
    // The kind comes off the router. A row with no picture loses its shape and
    // breaks the connector, and the instruction beside it was never wrong.
    const { container } = render(
      <NavigationCard
        {...card({
          turns: [{ key: 't1', turn: 'wormhole', instruction: 'Keep going', miles: '0.4' }],
        })}
      />,
    );
    // One for the turn, one for the checkered flag on the arrival row.
    expect(container.querySelectorAll('.fwm-nav-glyph')).toHaveLength(2);
  });

  it('puts the closest camera ahead of the destination in the source', () => {
    // Stacked on a phone - which is most of the time - the reader you are about
    // to pass outranks the destination you reach in half an hour, and source
    // order is what a screen reader and a keyboard follow.
    // The reader column IS `.fwm-closest` now - the shared component monitor
    // column one also uses - and it has no wrapper of its own. It leads the
    // markup and `navigationCard.css` orders it to third in the picture.
    const { container } = render(<NavigationCard {...card({ closest: CLOSEST })} />);
    const cols = container.querySelector('.fwm-nav-cols');
    expect(cols?.firstElementChild?.classList.contains('fwm-closest')).toBe(true);
  });

  it('leaves the closest column out entirely when there is no camera to show', () => {
    // Absent entirely rather than an empty third track: two columns of three
    // is what the rail should carry when there is no reader to show, and a
    // blank column would take a swipe to reach and say nothing.
    const { container } = render(<NavigationCard {...card({ closest: null })} />);
    expect(container.querySelector('.fwm-closest')).toBeNull();
  });
});

describe('the two keys', () => {
  it('reports a press on reroute, and only when it is pressed', () => {
    const onReroute = vi.fn();
    render(<NavigationCard {...card({ onReroute })} />);
    expect(onReroute).not.toHaveBeenCalled();

    // The key's face leads with the design's arrow, so it is found by a
    // substring rather than by the whole string.
    fireEvent.click(screen.getByRole('button', { name: /Reroute/ }));
    expect(onReroute).toHaveBeenCalledTimes(1);
  });

  it('reports a press on end', () => {
    const onEnd = vi.fn();
    render(<NavigationCard {...card({ onEnd })} />);
    expect(onEnd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: NAV_END }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('the three states of a plan', () => {
  it('says it is looking rather than printing a route it does not have', () => {
    // Setting a destination plans immediately, and for the second or two that
    // takes there are no figures. A zero would be a lie, and falling back to
    // the monitor card would flick between the two modes on a press.
    const { container } = render(
      <NavigationCard {...card({ status: 'planning', eta: '', miles: '' })} />,
    );

    expect(screen.getByText(NAV_PLANNING)).toBeTruthy();
    // Scoped to the plan column: the TURN list and the arrival row carry their
    // own distances and are not what this is about.
    expect(container.querySelector('.fwm-nav-plan .fwm-nav-eta')).toBeNull();
    expect(container.querySelector('.fwm-nav-plan .fwm-nav-miles')).toBeNull();
  });

  it("prints the router's own refusal, not a generic failure", () => {
    const detail = 'no driving route avoids all of those. try again with fewer of them.';
    render(<NavigationCard {...card({ status: 'failed', error: detail, eta: '', miles: '' })} />);

    expect(screen.getByText(detail)).toBeTruthy();
  });

  it('has something to say even when the refusal carried no sentence', () => {
    render(<NavigationCard {...card({ status: 'failed', error: null, eta: '', miles: '' })} />);

    expect(screen.getByText(NAV_FAILED)).toBeTruthy();
  });

  it('counts no readers while there is no route to count them on', () => {
    render(<NavigationCard {...card({ status: 'planning', onLine: 4, eta: '', miles: '' })} />);

    expect(screen.queryByText(/reader/)).toBeNull();
  });
});
