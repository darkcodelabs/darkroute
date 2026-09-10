import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRoadMonitoring } from './useRoadMonitoring.ts';
import { MONITORING_REFRESH_MS, roadMonitoring } from './roadMonitoring.ts';

describe('optional inventory refresh', () => {
  it('does no work until enabled and stops foreground refreshes once disabled', () => {
    vi.useFakeTimers();
    const refresh = vi.spyOn(roadMonitoring, 'refreshIfStale').mockResolvedValue();
    const hook = renderHook(({ enabled }) => useRoadMonitoring(enabled), { initialProps: { enabled: false } });
    act(() => { window.dispatchEvent(new Event('online')); vi.advanceTimersByTime(MONITORING_REFRESH_MS); });
    expect(refresh).not.toHaveBeenCalled();
    hook.rerender({ enabled: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(MONITORING_REFRESH_MS); });
    expect(refresh).toHaveBeenCalledTimes(2);
    hook.rerender({ enabled: false });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); vi.advanceTimersByTime(MONITORING_REFRESH_MS); });
    expect(refresh).toHaveBeenCalledTimes(2);
    hook.unmount();
    vi.useRealTimers();
  });
});
