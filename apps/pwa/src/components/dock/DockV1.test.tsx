import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { disposeScreenState } from '../../app/screenState.ts';

import { DOCK_V1_KEYS, DockV1 } from './DockV1.tsx';

afterEach(() => {
  disposeScreenState();
});

describe('the v1 dock search key', () => {
  it('puts Search at the far right of the pill', () => {
    const { container } = render(<DockV1 active="radar" onSelect={vi.fn()} />);
    const bar = container.querySelector('.fwm-dockv1-bar');
    const destinations = Array.from(bar?.querySelectorAll<HTMLButtonElement>('button') ?? []);

    expect(DOCK_V1_KEYS.map((key) => key.screen)).toEqual([
      'radar',
      'log',
      'node',
      'more',
      'lookup',
    ]);
    expect(destinations.at(-1)).toHaveAttribute('data-fwm-dock-key', 'lookup');
    expect(destinations.at(-1)).toHaveAccessibleName('Search');
  });

  it('selects the same lookup screen as the LOOK UP tile in More', () => {
    const onSelect = vi.fn();
    render(<DockV1 active="radar" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('lookup');
  });

  it('lights Search, not More, on the lookup screen', () => {
    const { container } = render(<DockV1 active="lookup" onSelect={vi.fn()} />);
    const search = container.querySelector('[data-fwm-dock-key="lookup"]');
    const more = container.querySelector('[data-fwm-dock-key="more"]');

    expect(search).toHaveAttribute('data-fwm-active', 'true');
    expect(search).toHaveAttribute('aria-current', 'page');
    expect(more).toHaveAttribute('data-fwm-active', 'false');
    expect(more).not.toHaveAttribute('aria-current');
  });
});
