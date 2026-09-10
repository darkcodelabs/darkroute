import { useSyncExternalStore } from 'react';

// View context shared with the map menu. It lasts only for this app session.
let casesOnly = false;
const listeners = new Set<() => void>();

export function setMisuseCasesOnly(value: boolean): void {
  if (casesOnly === value) return;
  casesOnly = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useMisuseCasesOnly(): boolean {
  return useSyncExternalStore(subscribe, () => casesOnly, () => false);
}
