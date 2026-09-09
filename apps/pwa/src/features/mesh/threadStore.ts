/**
 * THE THREADED CONVERSATION STORE.
 *
 * A sibling of `node/transcript.ts` rather than a replacement for it. That file
 * holds one flat stream and v0's NODE screen renders it; this one holds the
 * same traffic split into channels and direct messages for v1's CONVERSATIONS
 * tab. Both are fed from the same handler, so neither screen can show a message
 * the other missed.
 *
 * IN MEMORY, DELIBERATELY. Nothing here reaches IndexedDB. Meshtastic already
 * keeps recent traffic on the radio, and a durable transcript on the phone is a
 * written record of who somebody talks to - the exact artefact this product
 * exists to avoid creating. Closing the app forgets it.
 */

import { markRead, receive, sent, totalUnread } from './threads.ts';
import type { ThreadId, ThreadMap } from './threads.ts';
import type { HeardMessage } from '../node/mesh.ts';

type Listener = (threads: ThreadMap) => void;

let threads: ThreadMap = {};
/** Which thread is on screen, so a message arriving there is not unread. */
let openKey: string | null = null;
const listeners = new Set<Listener>();

function publish(next: ThreadMap): void {
  threads = next;
  for (const listener of listeners) listener(threads);
}

/** Called immediately, so a tab mounting mid-conversation sees it. */
export function subscribeThreads(listener: Listener): () => void {
  listeners.add(listener);
  listener(threads);
  return () => {
    listeners.delete(listener);
  };
}

/** Which thread the screen is showing. Null when the list is up. */
export function setOpenThread(key: string | null): void {
  openKey = key;
  if (key !== null) publish(markRead(threads, key));
}

export function heard(message: HeardMessage): void {
  publish(receive(threads, message, openKey));
}

/**
 * Recorded on the SEND, after the radio accepts it.
 *
 * Not on the echo: the radio repeats what it transmits, and that echo arrives
 * looking like traffic from a stranger. `mesh.ts` drops it, and this is what
 * takes its place.
 */
export function recordSentTo(id: ThreadId, text: string, at: number): void {
  publish(sent(threads, id, text, at));
}

export function unreadCount(): number {
  return totalUnread(threads);
}

/** Forget everything. Used by the removal path and by tests. */
export function resetThreads(): void {
  openKey = null;
  publish({});
}
