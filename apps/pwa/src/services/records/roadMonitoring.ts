import { MONITORING_MAX_BYTES, parseMonitoringSnapshot } from '../../stores/fwmCore.ts';
import type { MonitoringSnapshot } from '../../stores/fwmCore.ts';

export const MONITORING_REFRESH_MS = 5 * 60 * 1000;
export async function fetchMonitoring(signal?: AbortSignal): Promise<MonitoringSnapshot> {
  const response = await fetch('/records/road-monitoring.json', {
    credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error('Inventory unavailable');
  if (Number(response.headers.get('content-length')) > MONITORING_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Inventory too large');
  }
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('Missing inventory');
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MONITORING_MAX_BYTES) {
        await reader.cancel();
        throw new Error('Inventory too large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const parsed = parseMonitoringSnapshot(JSON.parse(text));
  if (parsed === null) throw new Error('Invalid inventory');
  return parsed;
}

export interface MonitoringState {
  readonly data: MonitoringSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
}
/** Public inventory only. Reader locations and activity never enter this store. */
export function createMonitoringStore(read: typeof fetchMonitoring = fetchMonitoring) {
  let state: MonitoringState = { data: null, loading: false, error: null };
  let pending: Promise<void> | null = null;
  let attemptedAt: number | null = null;
  const listeners = new Set<() => void>();
  const update = (next: MonitoringState): void => { state = next; for (const listener of listeners) listener(); };
  const refresh = (): Promise<void> => {
    if (pending !== null) return pending;
    attemptedAt = Date.now();
    update({ ...state, loading: true, error: null });
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => { controller.abort(); }, 15_000);
    pending = Promise.resolve().then(() => read(controller.signal)).then(
      (data) => { update({ data, loading: false, error: null }); },
      () => { update({ ...state, loading: false, error: 'Could not refresh road monitoring.' }); },
    ).finally(() => { globalThis.clearTimeout(timer); pending = null; });
    return pending;
  };
  return {
    getSnapshot: (): MonitoringState => state,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    refreshIfStale(): Promise<void> {
      if (pending !== null) return pending;
      return attemptedAt === null || Date.now() - attemptedAt >= MONITORING_REFRESH_MS ? refresh() : Promise.resolve();
    },
  };
}
export const roadMonitoring = createMonitoringStore();
