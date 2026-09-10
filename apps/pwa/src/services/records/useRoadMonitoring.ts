import { useEffect, useSyncExternalStore } from 'react';
import { MONITORING_REFRESH_MS, roadMonitoring } from './roadMonitoring.ts';
import type { MonitoringState } from './roadMonitoring.ts';

export function useRoadMonitoring(enabled: boolean): MonitoringState {
  const state = useSyncExternalStore(roadMonitoring.subscribe, roadMonitoring.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    const refresh = (): void => {
      if (document.visibilityState !== 'hidden') void roadMonitoring.refreshIfStale();
    };
    refresh();
    const timer = globalThis.setInterval(refresh, MONITORING_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    globalThis.addEventListener('online', refresh);
    return () => {
      globalThis.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      globalThis.removeEventListener('online', refresh);
    };
  }, [enabled]);
  return state;
}
