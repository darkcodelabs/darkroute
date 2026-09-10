import { MONITORING_MAX_BYTES, parseMonitoringSnapshot } from '../../../packages/core/src/roadMonitoring.ts';
import type { MonitoringSnapshot } from '../../../packages/core/src/roadMonitoring.ts';

export const MONITORING_KEY = 'records/road-monitoring.json';

/** Bound the stream before parsing; a missing inventory must never look like an empty one. */
export async function readMonitoringResponse(response: Response): Promise<MonitoringSnapshot | null> {
  if (response.body === null) return null;
  if (Number(response.headers.get('content-length')) > MONITORING_MAX_BYTES) { await response.body.cancel(); return null; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MONITORING_MAX_BYTES) { await reader.cancel(); return null; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return parseMonitoringSnapshot(JSON.parse(text));
  } catch { return null; } finally { reader.releaseLock(); }
}
