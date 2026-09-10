import { useEffect, useSyncExternalStore } from 'react';
import { NEWS_REFRESH_INTERVAL_MS, newsFeed } from '../../services/records/newsFeed.ts';
import type { NewsFeedState } from '../../services/records/newsFeed.ts';

export function useNewsFeed(): NewsFeedState & { readonly refresh: () => Promise<void> } {
  const state = useSyncExternalStore(newsFeed.subscribe, newsFeed.getSnapshot);
  useEffect(() => {
    const refreshVisible = (): void => {
      if (document.visibilityState !== 'hidden') void newsFeed.refreshIfStale();
    };
    refreshVisible();
    const timer = globalThis.setInterval(refreshVisible, NEWS_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshVisible);
    globalThis.addEventListener('online', refreshVisible);
    return () => {
      globalThis.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      globalThis.removeEventListener('online', refreshVisible);
    };
  }, []);
  return { ...state, refresh: newsFeed.refresh };
}
