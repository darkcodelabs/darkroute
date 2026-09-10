import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { V1_SCREENS } from '../../app/registry.v1.tsx';
import { disposeScreenState, getScreenState, initScreenState, openScreen, screenFromSearch } from '../../app/screenState.ts';
import { setMisuseCasesOnly, useMisuseCasesOnly } from '../misuse/misuseView.ts';
import { ReportsScreen } from './ReportsScreen.tsx';

vi.mock('../misuse/MisuseScreen.tsx', () => ({
  LOADING: 'Loading…',
  MisuseScreen: ({ embedded, onViewNews }: { embedded: boolean; onViewNews?: () => void }) =>
    <section aria-label="abuse content" data-embedded={String(embedded)}>
      Recent abuse reporting, documented cases and EFF Atlas
      <button onClick={onViewNews}>View all news</button>
    </section>,
}));
vi.mock('../news/NewsScreen.tsx', () => ({
  NewsScreen: ({ embedded }: { embedded: boolean }) =>
    <section aria-label="news content" data-embedded={String(embedded)}>ALPR news coverage</section>,
}));

beforeEach(() => {
  initScreenState({ initialScreen: 'radar' });
  setMisuseCasesOnly(false);
});
afterEach(() => { disposeScreenState(); setMisuseCasesOnly(false); });

describe('the Reports page', () => {
  it('opens Abuse first with one page heading and switches to News without adding navigation steps', () => {
    openScreen('reports');
    render(<ReportsScreen />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Abuse', 'News']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'abuse content' })).toHaveAttribute('data-embedded', 'true');
    expect(screen.queryByRole('region', { name: 'news content' })).toBeNull();
    const depth = getScreenState().depth;
    fireEvent.click(screen.getByRole('tab', { name: 'News' }));
    expect(screen.getByRole('region', { name: 'news content' })).toHaveAttribute('data-embedded', 'true');
    expect(screen.getByRole('tabpanel', { name: 'News' })).toBeInTheDocument();
    expect(getScreenState().depth).toBe(depth);
    fireEvent.click(screen.getByRole('tab', { name: 'Abuse' }));
    expect(screen.getByRole('region', { name: 'abuse content' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'back to drive' }));
    expect(getScreenState().screen).toBe('radar');
  });

  it('supports keyboard tab navigation and opens View all news in the same page', () => {
    render(<ReportsScreen />);
    const abuse = screen.getByRole('tab', { name: 'Abuse' });
    const news = screen.getByRole('tab', { name: 'News' });
    fireEvent.keyDown(abuse, { key: 'ArrowRight' });
    expect(news).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(news);
    fireEvent.keyDown(news, { key: 'Home' });
    expect(abuse).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'View all news' }));
    expect(news).toHaveAttribute('aria-selected', 'true');
  });

  it('includes all abuse content on a new visit after a previous cases-only selection', () => {
    setMisuseCasesOnly(true);
    const { result } = renderHook(useMisuseCasesOnly);
    render(<ReportsScreen />);
    expect(result.current).toBe(false);
  });

  it.each([['reports', 'Abuse'], ['misuse', 'Abuse'], ['news', 'News']] as const)(
    'keeps ?screen=%s linked to Reports with %s selected', (legacy, expected) => {
      const id = screenFromSearch(`?screen=${legacy}`);
      const Component = V1_SCREENS[id];
      expect(Component).toBeDefined();
      if (!Component) throw new Error(`Missing ${id} screen`);
      render(<Component />);
      expect(screen.getByRole('region', { name: 'Reports' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: expected })).toHaveAttribute('aria-selected', 'true');
    },
  );
});
