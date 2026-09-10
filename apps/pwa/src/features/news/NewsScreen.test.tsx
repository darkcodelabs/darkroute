import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsFeed, NewsFeedState } from '../../services/records/newsFeed.ts';
import { LatestAbuseNews } from './LatestAbuseNews.tsx';
import { NewsScreen } from './NewsScreen.tsx';
import { useNewsFeed } from './useNewsFeed.ts';

vi.mock('./useNewsFeed.ts', () => ({ useNewsFeed: vi.fn() }));

const articles: NewsFeed['articles'] = [
  { id: 'abuse', title: 'Audit raises concerns about plate reader searches', publisher: 'City Journal',
    url: 'https://city.test/report', publishedAt: '2026-09-10T02:00:00Z', topic: 'abuse' },
  { id: 'news', title: 'Town considers new ALPR rules', publisher: 'Town News',
    url: 'https://town.test/story', publishedAt: '2026-09-09T02:00:00Z', topic: 'news' },
];
const feed: NewsFeed = { schema: 'darkroute-news/v1', updatedAt: '2026-09-10T03:00:00Z',
  lastAttemptAt: '2026-09-10T04:00:00Z', coverage: { status: 'partial', attempted: 4, succeeded: 2 }, articles };
const refresh = vi.fn().mockResolvedValue(undefined);
function state(value: Partial<NewsFeedState> = {}): void {
  vi.mocked(useNewsFeed).mockReturnValue({ data: feed, loading: false, error: null, refresh, ...value });
}
beforeEach(() => { state(); refresh.mockClear(); });

describe('news screen', () => {
  it('offers source links, observation dates and honest partial collection status', () => {
    render(<NewsScreen />);
    expect(screen.getByRole('button', { name: 'back to everything else' })).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://city.test/report');
    expect(links[0]).toHaveAttribute('rel', 'noreferrer noopener');
    expect(links[0]).toHaveTextContent('Seen Sep 10, 2026');
    expect(screen.getByText(/Partial update: 2 of 4/)).toBeInTheDocument();
    expect(screen.getByText(/^Last collection attempt/)).toBeInTheDocument();
    expect(screen.getByText(/^Updated/)).toBeInTheDocument();
    expect(document.querySelector('img, iframe')).toBeNull();
  });

  it('filters by reporting topic and searches titles or publishers on the device', () => {
    render(<NewsScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Abuse reporting' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('Town considers new ALPR rules')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Other news' }));
    expect(screen.getByText('Town considers new ALPR rules')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'CITY JOURNAL' } });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no such story' } });
    expect(screen.getByText('No headlines match these filters.')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('distinguishes loading, fetch failure, and an empty successful snapshot', () => {
    state({ data: null, loading: true });
    const { rerender } = render(<NewsScreen />);
    expect(screen.getByText('Loading ALPR reporting…')).toBeInTheDocument();
    expect(screen.queryByText(/No headlines/)).toBeNull();
    state({ data: null, loading: false, error: 'Could not refresh the news feed.' });
    rerender(<NewsScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent('Try again when you have a connection.');
    expect(screen.queryByText(/No headlines/)).toBeNull();
    state({ data: { ...feed, coverage: { status: 'complete', attempted: 2, succeeded: 2 }, articles: [] } });
    rerender(<NewsScreen />);
    expect(screen.getByText('No headlines in this snapshot yet.')).toBeInTheDocument();
  });

  it('keeps previous headlines visible when a refresh fails and offers retry', () => {
    state({ error: 'Could not refresh the news feed.' });
    render(<NewsScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent('Showing the previous snapshot.');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh news' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('labels unavailable collection rather than implying all sources were checked', () => {
    state({ data: { ...feed, coverage: { status: 'unavailable', attempted: 4, succeeded: 0 } } });
    render(<NewsScreen />);
    expect(screen.getByText(/latest collection could not reach its sources/)).toBeInTheDocument();
  });
});

it('the misuse addition shows only reporting and keeps its claim separate from documented cases', () => {
  render(<LatestAbuseNews />);
  expect(screen.getByRole('heading', { name: 'Latest abuse reporting' })).toBeInTheDocument();
  expect(screen.getByText(/Documented case records follow below/)).toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.queryByText('Town considers new ALPR rules')).toBeNull();
  expect(screen.getByRole('button', { name: 'View all news' })).toBeInTheDocument();
});
