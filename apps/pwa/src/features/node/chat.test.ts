/**
 * Mesh chat puts text on an open radio. These pin the rules that make that
 * survivable, and the plate rule is the one that matters most: a plate
 * broadcast in the clear cannot be taken back.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_MESSAGE_CHARS,
  TRANSCRIPT_CAP,
  appendMessage,
  labelFor,
  refuseToSend,
} from './chat.ts';
import type { ChatMessage } from './chat.ts';

function message(text: string, at = 0): ChatMessage {
  return { key: `k${String(at)}`, from: 1, label: 'x', text, at, mine: false };
}

describe('refuseToSend', () => {
  it('allows ordinary text', () => {
    expect(refuseToSend('camera on the corner of 4th')).toBeNull();
  });

  it('refuses nothing at all', () => {
    expect(refuseToSend('   ')).toBe('empty');
  });

  it('refuses more than one lora message can carry', () => {
    expect(refuseToSend('x'.repeat(MAX_MESSAGE_CHARS + 1))).toBe('too-long');
    expect(refuseToSend('x'.repeat(MAX_MESSAGE_CHARS))).toBeNull();
  });

  it('REFUSES A PLATE', () => {
    // The whole reason this gate exists. Unencrypted, to every radio in range,
    // stored on each of them, and not recallable.
    expect(refuseToSend('saw HVK8842 parked there')).toBe('plate');
  });

  it('refuses a plate written with a separator', () => {
    expect(refuseToSend('ABC 1234')).toBe('plate');
    expect(refuseToSend('ABC-1234')).toBe('plate');
  });

  it('does not refuse ordinary sentences that merely contain a number', () => {
    // The vault's full detector glues adjacent runs, so "of" + "4th" becomes a
    // plate and normal speech gets refused. A check that fires on normal
    // speech is one people learn to work around.
    for (const ok of [
      'camera on the corner of 4th',
      'two of them at the exit',
      'new one at 5th and main',
      'moved about 200 feet north',
    ]) {
      expect(refuseToSend(ok), `refused: ${ok}`).toBeNull();
    }
  });

  it('still uses the vault detector for the single-token form', async () => {
    const { looksLikePlateToken } = await import('../../services/db/repositories/plateVault.ts');
    expect(looksLikePlateToken('HVK8842')).toBe(true);
    expect(refuseToSend('HVK8842')).toBe('plate');
  });

  it('checks the trimmed text, so padding cannot smuggle one through', () => {
    expect(refuseToSend('   HVK8842   ')).toBe('plate');
  });
});

describe('the transcript', () => {
  it('keeps the newest and drops the oldest at the cap', () => {
    let t: readonly ChatMessage[] = [];
    for (let i = 0; i < TRANSCRIPT_CAP + 10; i += 1) t = appendMessage(t, message(`m${String(i)}`, i));
    expect(t).toHaveLength(TRANSCRIPT_CAP);
    expect(t[0]?.text).toBe('m10');
    expect(t[t.length - 1]?.text).toBe(`m${String(TRANSCRIPT_CAP + 9)}`);
  });

  it('appends in order', () => {
    const t = appendMessage(appendMessage([], message('one', 1)), message('two', 2));
    expect(t.map((m) => m.text)).toStrictEqual(['one', 'two']);
  });
});

describe('labelFor', () => {
  it('prefers what a node calls itself', () => {
    expect(labelFor(1, 'Corner of 4th', 'C4TH')).toBe('Corner of 4th');
    expect(labelFor(1, null, 'C4TH')).toBe('C4TH');
  });

  it('falls back to the node id, written the way Meshtastic writes it', () => {
    expect(labelFor(0x433a1b2c, null, null)).toBe('!433a1b2c');
  });
});

describe('what this module does not do', () => {
  it('holds no connection and cannot send by itself', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const found = ['src/features/node/chat.ts', 'apps/pwa/src/features/node/chat.ts']
      .map((rel) => resolve(process.cwd(), rel))
      .find((path) => {
        try {
          readFileSync(path);
          return true;
        } catch {
          return false;
        }
      });
    const text = readFileSync(found as string, 'utf8');
    // The decision to transmit belongs to a person pressing a button, not to
    // this module. It validates and formats; the screen sends.
    for (const forbidden of ['sendText(', 'sendPacket(', 'BleConnection', 'setInterval']) {
      expect(text, `chat.ts references ${forbidden}`).not.toContain(forbidden);
    }
  });
});
