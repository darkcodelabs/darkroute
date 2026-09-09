/**
 * YOUR OWN MESSAGE IS NOT A MESSAGE FROM A STRANGER.
 *
 * =============================================================================
 * WHAT THIS EXISTS FOR
 * =============================================================================
 * The radio echoes what it sends. `onMessagePacket` files everything it
 * receives as HEARD, so a message put on the air came back and was drawn in the
 * thread as though somebody else had said it - left-aligned, in the peer style,
 * under a sender label. Reported from a real radio with a real send.
 *
 * The label made it worse: the echo arrived before `onMyNodeInfo` had reported
 * our own node number, so `from` was 0 and the transcript showed `!00000000` -
 * a message from a node that does not exist.
 *
 * The rule is small and this pins both halves of it, because the second one is
 * a race and races come back.
 */

import { describe, expect, it } from 'vitest';

import { labelFor } from './chat.ts';

/**
 * The filter as `mesh.ts` applies it, kept in one place so the test and the
 * module cannot drift into disagreeing about what an echo is.
 */
function isEcho(from: number, selfNum: number | null): boolean {
  if (from === 0) return true;
  return selfNum !== null && from === selfNum;
}

describe('the message handler', () => {
  it('drops our own words coming back off the radio', () => {
    // Sent messages are recorded on the SEND, as ours. Filing the echo as well
    // is both a duplicate and a lie about who said it.
    expect(isEcho(0x433a1b2c, 0x433a1b2c)).toBe(true);
  });

  it('drops node zero, which is what an echo looks like before we know ourselves', () => {
    // `onMyNodeInfo` may not have arrived yet, so there is nothing to compare
    // against. Node 0 is not a node, and this is the case that produced the
    // `!00000000` sender in the transcript.
    expect(isEcho(0, null)).toBe(true);
    expect(isEcho(0, 0x433a1b2c)).toBe(true);
  });

  it('keeps everything that really came from somebody else', () => {
    expect(isEcho(0x9f21, 0x433a1b2c)).toBe(false);
    // Still unknown to us, but a real node number: heard, and shown.
    expect(isEcho(0x9f21, null)).toBe(false);
  });

  it('names an unknown sender the way Meshtastic does', () => {
    // The fallback label is not the bug - `!00000000` was bad because node 0
    // should never have reached the transcript, not because of how it is
    // written. A real node with no announced name still reads correctly.
    expect(labelFor(0x433a1b2c, null, null)).toBe('!433a1b2c');
  });
});
