/**
 * CONVERSATIONS: channels and direct messages, kept apart.
 *
 * =============================================================================
 * WHY THREADING IS NOT COSMETIC HERE
 * =============================================================================
 * The old chat was one stream. Every broadcast on every channel and every
 * direct message landed in the same list, in arrival order, with a sender label
 * and nothing else. Two consequences, and the second one is the reason this
 * module exists:
 *
 *   1. Unusable on a real mesh. A busy channel buries a reply within seconds.
 *   2. MISLEADING ABOUT PRIVACY. A direct message and a public broadcast looked
 *      identical. Somebody reading a sealed DM in a list that also contains
 *      LongFast traffic has no way to tell which of their own replies is about
 *      to go out to everybody in range - and the send box was shared.
 *
 * A thread is therefore a routing fact, not a display grouping: a channel index
 * or a peer node number, decided by whether the packet was addressed to this
 * radio. Getting it wrong files a private message into a public room, so the
 * decision is made once, in `mesh.ts`, where `selfNum` actually lives, and
 * arrives here already made.
 *
 * =============================================================================
 * NOTHING HERE IS PERSISTED
 * =============================================================================
 * Threads live for the session. Meshtastic already stores recent traffic on the
 * radio, and a transcript on the phone is a written record of who a person
 * talks to - the thing this whole product exists to avoid producing. Closing
 * the app forgets it, deliberately.
 */

import type { HeardMessage } from '../node/mesh.ts';

/** Meshtastic's broadcast address: every node in range. */
export const BROADCAST_NUM = 0xffff_ffff;

/** How many messages a thread keeps. Oldest fall off the top. */
export const THREAD_CAP = 200;

/**
 * WHICH conversation. A channel index, or one peer.
 *
 * The two are not interchangeable and the union is what stops them being
 * confused: a `channel` thread goes to everyone, a `direct` thread goes to one
 * radio and is sealed on firmware 2.5+.
 */
export type ThreadId =
  | { readonly kind: 'channel'; readonly index: number }
  | { readonly kind: 'direct'; readonly node: number };

export function threadKey(id: ThreadId): string {
  return id.kind === 'channel' ? `ch:${String(id.index)}` : `dm:${String(id.node)}`;
}

export interface ThreadMessage {
  readonly key: string;
  /** Node number of the sender, or null when it is ours. */
  readonly from: number | null;
  readonly text: string;
  readonly at: number;
  readonly mine: boolean;
}

export interface Thread {
  readonly id: ThreadId;
  readonly key: string;
  readonly messages: readonly ThreadMessage[];
  /** Messages heard since this thread was last opened. */
  readonly unread: number;
}

export type ThreadMap = Readonly<Record<string, Thread>>;

/** Which thread a heard message belongs to. */
export function threadFor(message: HeardMessage): ThreadId {
  // `direct` was decided in `mesh.ts` against `selfNum`. It is not recomputed
  // here, because this module does not know which radio it is.
  return message.direct
    ? { kind: 'direct', node: message.from }
    : { kind: 'channel', index: message.channel };
}

function push(thread: Thread, message: ThreadMessage, unread: boolean): Thread {
  const messages = [...thread.messages, message].slice(-THREAD_CAP);
  return { ...thread, messages, unread: unread ? thread.unread + 1 : thread.unread };
}

function blank(id: ThreadId): Thread {
  return { id, key: threadKey(id), messages: [], unread: 0 };
}

/**
 * File a heard message.
 *
 * `openKey` is the thread currently on screen; a message arriving there is read
 * on arrival and does not raise a badge. Anything else does.
 */
export function receive(
  threads: ThreadMap,
  message: HeardMessage,
  openKey: string | null,
): ThreadMap {
  const id = threadFor(message);
  const key = threadKey(id);
  const existing = threads[key] ?? blank(id);
  const entry: ThreadMessage = {
    key: `${key}:${String(message.at)}:${String(existing.messages.length)}`,
    from: message.from,
    text: message.text,
    at: message.at,
    mine: false,
  };
  return { ...threads, [key]: push(existing, entry, key !== openKey) };
}

/**
 * File something we sent.
 *
 * Recorded on the SEND rather than on the radio's echo, because the echo comes
 * back looking like traffic from a stranger. `mesh.ts` drops that echo; this is
 * what replaces it, and it is why a sent message never raises an unread count.
 */
export function sent(threads: ThreadMap, id: ThreadId, text: string, at: number): ThreadMap {
  const key = threadKey(id);
  const existing = threads[key] ?? blank(id);
  const entry: ThreadMessage = {
    key: `${key}:${String(at)}:${String(existing.messages.length)}:mine`,
    from: null,
    text,
    at,
    mine: true,
  };
  return { ...threads, [key]: push(existing, entry, false) };
}

/** Opening a thread reads it. */
export function markRead(threads: ThreadMap, key: string): ThreadMap {
  const thread = threads[key];
  if (thread === undefined || thread.unread === 0) return threads;
  return { ...threads, [key]: { ...thread, unread: 0 } };
}

/**
 * Threads for the list: most recently active first, and never a thread with
 * nothing in it.
 *
 * Channels the radio knows about but nobody has spoken on are supplied by the
 * caller as `seedChannels`, so an empty channel is still enterable - otherwise
 * there would be no way to start the first conversation on one.
 */
export function threadList(
  threads: ThreadMap,
  seedChannels: readonly number[] = [],
): readonly Thread[] {
  const merged: Record<string, Thread> = { ...threads };
  for (const index of seedChannels) {
    const id: ThreadId = { kind: 'channel', index };
    const key = threadKey(id);
    merged[key] ??= blank(id);
  }
  return Object.values(merged).sort((a, b) => {
    const at = a.messages[a.messages.length - 1]?.at ?? 0;
    const bt = b.messages[b.messages.length - 1]?.at ?? 0;
    if (at !== bt) return bt - at;
    // Stable and meaningful when both are silent: channels before DMs, then by
    // index, so the list does not reshuffle on every render.
    if (a.id.kind !== b.id.kind) return a.id.kind === 'channel' ? -1 : 1;
    const an = a.id.kind === 'channel' ? a.id.index : a.id.node;
    const bn = b.id.kind === 'channel' ? b.id.index : b.id.node;
    return an - bn;
  });
}

/** Total unread across every thread, for the tab badge. */
export function totalUnread(threads: ThreadMap): number {
  return Object.values(threads).reduce((sum, thread) => sum + thread.unread, 0);
}

/** The last thing said, for the list row. */
export function preview(thread: Thread): string | null {
  const last = thread.messages[thread.messages.length - 1];
  return last === undefined ? null : last.text;
}
