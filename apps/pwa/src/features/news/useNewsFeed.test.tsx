import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEWS_REFRESH_INTERVAL_MS, newsFeed } from '../../services/records/newsFeed.ts';
import { useNewsFeed } from './useNewsFeed.ts';

afterEach(() => { vi.useRealTimers(); });

describe('automatic news refresh', () => {
  it('checks stale data while visible and on return, and stops after leaving the screen', () => {
    vi.useFakeTimers();
    const refresh = vi.spyOn(newsFeed, 'refreshIfStale').mockResolvedValue(undefined);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { unmount } = renderHook(useNewsFeed);
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(NEWS_REFRESH_INTERVAL_MS); });
    expect(refresh).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('hidden');
    act(() => { vi.advanceTimersByTime(NEWS_REFRESH_INTERVAL_MS); });
    expect(refresh).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(refresh).toHaveBeenCalledTimes(3);
    act(() => { globalThis.dispatchEvent(new Event('online')); });
    expect(refresh).toHaveBeenCalledTimes(4);
    unmount();
    act(() => {
      vi.advanceTimersByTime(NEWS_REFRESH_INTERVAL_MS);
      document.dispatchEvent(new Event('visibilitychange'));
      globalThis.dispatchEvent(new Event('online'));
    });
    expect(refresh).toHaveBeenCalledTimes(4);
  });
});
