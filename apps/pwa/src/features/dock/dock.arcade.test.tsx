/**
 * THE PEW KEY ON THE DOCK. One slot, borrowed only when it is empty.
 *
 * `BrowseRow` is a renderer and draws the key wherever the `arcade` flag is
 * present; the GATE is `features/arcade/offer.ts`, which only ever sets it on
 * `dense`. These cases pin both halves and the one place they meet: the two
 * states that draw the map inset keep it whatever the flag says, because the
 * facing is a fact and the key is a toy.
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { isOfferable } from '../arcade/offer.ts';
import { BrowseRow } from './BrowseRow.tsx';
import { Dock } from './Dock.tsx';
import {
  DOCK_COLLAPSED_STATE_IDS,
  DOCK_FIXTURES,
  dockRerouteLabel,
  withArcadeOffer,
  withDetourCount,
} from './dockState.ts';
import type { DockActionKey, DockData } from './dockState.ts';

const ARCADE = '[data-fwm-action="arcade"]';
const INSET = '.fwm-dock-inset';

describe('BrowseRow and the arcade flag', () => {
  it('draws one PEW key on dense with the flag, and no inset', () => {
    const { container } = render(
      <BrowseRow state="dense" data={{ ...DOCK_FIXTURES.dense, arcade: true }} onAction={undefined} />,
    );
    expect(container.querySelectorAll(ARCADE)).toHaveLength(1);
    expect(container.querySelector(INSET)).toBeNull();
    const key = container.querySelector(ARCADE);
    expect(key).toHaveAccessibleName('Play pew at this reader');
    expect(key).toHaveTextContent('Pew');
  });

  it('draws neither without the flag', () => {
    const { container } = render(<BrowseRow state="dense" data={DOCK_FIXTURES.dense} onAction={undefined} />);
    expect(container.querySelector(ARCADE)).toBeNull();
    expect(container.querySelector(INSET)).toBeNull();
  });

  it('keeps the detour key and its label beside the PEW key', () => {
    const { container } = render(
      <BrowseRow state="dense" data={{ ...DOCK_FIXTURES.dense, arcade: true }} onAction={undefined} />,
    );
    const detour = container.querySelector('[data-fwm-action="around"]');
    expect(detour).toHaveTextContent(dockRerouteLabel(DOCK_FIXTURES.dense.around ?? 0));
    expect(detour).toHaveAccessibleName('Reroute around 9 readers');
  });

  it('lets the inset win on approaching and passing, and ignores the flag everywhere but dense at the gate', () => {
    for (const state of DOCK_COLLAPSED_STATE_IDS) {
      const data: DockData = { ...DOCK_FIXTURES[state], arcade: true };
      const { container, unmount } = render(<BrowseRow state={state} data={data} onAction={undefined} />);
      if (state === 'approaching' || state === 'passing') {
        expect(container.querySelector(INSET), state).not.toBeNull();
        expect(container.querySelector(ARCADE), state).toBeNull();
      }
      unmount();
      /* THE GATE. The hook never sets the flag on any of the other thirteen. */
      expect(
        isOfferable({
          stationary: true,
          speedMph: 0,
          inRange: true,
          accuracyGated: false,
          takeoverActive: false,
          shouldAlertUser: false,
          screen: 'radar',
          pane: 'collapsed',
          state,
          motionReduced: false,
        }),
        state,
      ).toBe(state === 'dense');
    }
  });

  it('fires onAction("arcade") exactly once per press and does not toggle the pane', () => {
    const onAction = vi.fn<(action: DockActionKey) => void>();
    const onExpand = vi.fn();
    const onCollapse = vi.fn();
    const { container } = render(
      <Dock
        pane="collapsed"
        state="dense"
        data={{ ...DOCK_FIXTURES.dense, arcade: true }}
        onAction={onAction}
        activeTab="map"
        onTab={vi.fn()}
        onReport={vi.fn()}
        onExpand={onExpand}
        onCollapse={onCollapse}
      />,
    );
    fireEvent.click(container.querySelector(ARCADE) as Element);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('arcade');
    expect(onExpand).not.toHaveBeenCalled();
    expect(onCollapse).not.toHaveBeenCalled();
  });
});

describe('withArcadeOffer', () => {
  it('puts the flag on with true and deletes the field with false', () => {
    const on = withArcadeOffer(DOCK_FIXTURES.dense, true);
    expect(on.arcade).toBe(true);
    const off = withArcadeOffer(on, false);
    expect('arcade' in off).toBe(false);
    expect(off.count).toBe(DOCK_FIXTURES.dense.count);
  });

  it('composes with withDetourCount without disturbing it', () => {
    const data = withArcadeOffer(withDetourCount(DOCK_FIXTURES.dense, 3), true);
    expect(data.around).toBe(3);
    expect(data.arcade).toBe(true);
    const cleared = withArcadeOffer(withDetourCount(data, null), false);
    expect('around' in cleared).toBe(false);
    expect('arcade' in cleared).toBe(false);
  });
});
