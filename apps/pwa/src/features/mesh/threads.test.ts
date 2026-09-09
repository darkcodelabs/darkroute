/**
 * A PRIVATE MESSAGE NEVER LANDS IN A PUBLIC ROOM.
 *
 * The old chat was one stream, so a sealed direct message and a LongFast
 * broadcast rendered identically and shared a send box. Somebody replying to
 * what looked like a private message could put it out to every radio in range.
 *
 * That is the failure these tests exist for. Everything else here - ordering,
 * unread counts, the cap - is ordinary; the separation is not.
 */

import { describe, expect, it } from 'vitest';

import {
  THREAD_CAP,
  markRead,
  preview,
  receive,
  sent,
  threadFor,
  threadKey,
  threadList,
  totalUnread,
} from './threads.ts';
import type { ThreadMap } from './threads.ts';
import type { HeardMessage } from '../node/mesh.ts';

const ME = 0xa0cc_cf24;
const PEER = 0x597c_b855;
const OTHER = 0xb03b_3704;

function heard(over: Partial<HeardMessage> = {}): HeardMessage {
  return {
    from: PEER,
    to: 0xffff_ffff,
    channel: 0,
    direct: false,
    text: 'Morning mesh',
    at: 1_800_000_000_000,
    ...over,
  };
}

describe('a message goes to exactly one thread', () => {
  it('files a broadcast by CHANNEL and a direct message by PEER', () => {
    expect(threadFor(heard({ channel: 2, direct: false }))).toEqual({ kind: 'channel', index: 2 });
    expect(threadFor(heard({ direct: true, to: ME }))).toEqual({ kind: 'direct', node: PEER });
  });

  it('KEEPS A DM OUT OF THE CHANNEL IT ARRIVED ON', () => {
    /*
     * The whole point. A DM packet still carries a channel index, so a naive
     * `groupBy(channel)` files somebody's private message into the public
     * thread - where the next reply goes out to everyone in range.
     */
    const dm = heard({ direct: true, to: ME, channel: 0, text: 'here is the key' });
    const threads = receive({}, dm, null);

    expect(threads[threadKey({ kind: 'channel', index: 0 })]).toBeUndefined();
    const direct = threads[threadKey({ kind: 'direct', node: PEER })];
    expect(direct?.messages.map((m) => m.text)).toEqual(['here is the key']);
  });

  it('keeps two peers apart even on the same channel', () => {
    let threads: ThreadMap = {};
    threads = receive(threads, heard({ from: PEER, direct: true, to: ME, text: 'a' }), null);
    threads = receive(threads, heard({ from: OTHER, direct: true, to: ME, text: 'b' }), null);
    expect(threads[threadKey({ kind: 'direct', node: PEER })]?.messages).toHaveLength(1);
    expect(threads[threadKey({ kind: 'direct', node: OTHER })]?.messages).toHaveLength(1);
  });

  it('keeps two channels apart', () => {
    let threads: ThreadMap = {};
    threads = receive(threads, heard({ channel: 0, text: 'public' }), null);
    threads = receive(threads, heard({ channel: 3, text: 'darkroute' }), null);
    expect(preview(threads['ch:0'] as never)).toBe('public');
    expect(preview(threads['ch:3'] as never)).toBe('darkroute');
  });
});

describe('unread', () => {
  it('counts a message in a thread that is not open', () => {
    const threads = receive({}, heard(), null);
    expect(totalUnread(threads)).toBe(1);
  });

  it('does NOT count one arriving in the thread being read', () => {
    // Otherwise a badge appears for a message the person is looking at.
    const threads = receive({}, heard({ channel: 0 }), 'ch:0');
    expect(totalUnread(threads)).toBe(0);
  });

  it('never counts our own message', () => {
    // Recorded on the send, not on the radio echo, so it cannot self-badge.
    const threads = sent({}, { kind: 'channel', index: 0 }, 'hello', 1);
    expect(totalUnread(threads)).toBe(0);
    expect(threads['ch:0']?.messages[0]?.mine).toBe(true);
  });

  it('clears on open and is idempotent', () => {
    let threads = receive({}, heard(), null);
    threads = markRead(threads, 'ch:0');
    expect(totalUnread(threads)).toBe(0);
    expect(markRead(threads, 'ch:0')).toBe(threads);
    // A thread that does not exist is not an error.
    expect(markRead(threads, 'dm:999')).toBe(threads);
  });
});

describe('the thread list', () => {
  it('puts the most recently active first', () => {
    let threads: ThreadMap = {};
    threads = receive(threads, heard({ channel: 0, at: 1000 }), null);
    threads = receive(threads, heard({ channel: 1, at: 5000 }), null);
    expect(threadList(threads).map((t) => t.key)).toEqual(['ch:1', 'ch:0']);
  });

  it('shows a channel nobody has spoken on, so a first message is possible', () => {
    // Without the seed there is no row to tap, and therefore no way to start
    // the first conversation on a channel the radio already holds.
    const list = threadList({}, [0, 1]);
    expect(list.map((t) => t.key)).toEqual(['ch:0', 'ch:1']);
    expect(list[0]?.messages).toEqual([]);
  });

  it('does not reshuffle silent threads between renders', () => {
    const once = threadList({}, [2, 0, 1]).map((t) => t.key);
    const twice = threadList({}, [2, 0, 1]).map((t) => t.key);
    expect(once).toEqual(twice);
    expect(once).toEqual(['ch:0', 'ch:1', 'ch:2']);
  });

  it('does not lose a live thread when seeds are supplied', () => {
    const threads = receive({}, heard({ channel: 5, text: 'live' }), null);
    const list = threadList(threads, [0]);
    expect(list.map((t) => t.key)).toContain('ch:5');
    expect(preview(list.find((t) => t.key === 'ch:5') as never)).toBe('live');
  });
});

describe('the cap', () => {
  it('keeps the newest and drops the oldest', () => {
    let threads: ThreadMap = {};
    for (let i = 0; i < THREAD_CAP + 25; i += 1) {
      threads = receive(threads, heard({ text: `m${String(i)}`, at: 1000 + i }), 'ch:0');
    }
    const messages = threads['ch:0']?.messages ?? [];
    expect(messages).toHaveLength(THREAD_CAP);
    expect(messages[messages.length - 1]?.text).toBe(`m${String(THREAD_CAP + 24)}`);
    expect(messages[0]?.text).toBe('m25');
  });

  it('gives every message a distinct key, including same-millisecond arrivals', () => {
    // Two packets can land in the same millisecond. Duplicate React keys drop
    // messages from the render silently.
    let threads: ThreadMap = {};
    for (let i = 0; i < 5; i += 1) {
      threads = receive(threads, heard({ text: `m${String(i)}`, at: 1000 }), 'ch:0');
    }
    const keys = (threads['ch:0']?.messages ?? []).map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
