import { useEffect, useSyncExternalStore } from 'react';
import { ATLAS_REFRESH_INTERVAL_MS, atlasCounties } from './atlasCounties.ts';

/** Share one county index across surfaces and refresh visible, long-lived sessions. */
export function useAtlasRevision(): number {
  const revision = useSyncExternalStore(atlasCounties.subscribe, atlasCounties.getRevision);
  useEffect(() => {
    const refreshVisible = (): void => {
      if (document.visibilityState !== 'hidden') void atlasCounties.refreshIfStale();
    };
    refreshVisible();
    const timer = globalThis.setInterval(refreshVisible, ATLAS_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshVisible);
    globalThis.addEventListener('online', refreshVisible);
    return () => {
      globalThis.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      globalThis.removeEventListener('online', refreshVisible);
    };
  }, []);
  return revision;
}
