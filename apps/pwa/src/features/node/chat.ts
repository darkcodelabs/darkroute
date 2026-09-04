/**
 * MESH CHAT: text over LoRa, to whoever is in range.
 *
 * =============================================================================
 * WHAT THIS ACTUALLY IS, SAID PLAINLY
 * =============================================================================
 * This is not messaging. It is a radio broadcast. A message goes out to every
 * Meshtastic node within range, it is stored in each of their message
 * databases, and on the default channel the encryption key is published in
 * Meshtastic's own source. There is no delivery, no recipient, and no recall.
 *
 * That is worth stating in the module rather than only in the UI, because the
 * next person to touch this file needs to know it before they add a feature to
 * it. Nothing here should ever become automatic.
 *
 * =============================================================================
 * THE TWO RULES
 * =============================================================================
 * 1. NOTHING SENDS WITHOUT A PRESS. No timer, no position update, no retry.
 *    Every transmission is a person deciding to transmit.
 *
 * 2. NO PLATES. The app already refuses to STORE a plate-shaped handle, and
 *    broadcasting one is strictly worse than storing it. See `carriesPlate`
 *    for why this uses the vault's narrower single-run check plus explicit
 *    plate layouts, rather than the vault's full detector: the full one glues
 *    adjacent words and refuses ordinary sentences, and a check that fires on
 *    normal speech is one people learn to route around.
 *
 * =============================================================================
 * NOT PERSISTED
 * =============================================================================
 * The transcript lives in memory for the session and is gone on reload. This
 * app tells drivers it keeps nothing; a chat log on the device would be a
 * record of who was near them and when, which is exactly the kind of thing it
 * exists to avoid creating.
 */

import { looksLikePlateToken } from '../../services/db/repositories/plateVault.ts';

/** The most characters one LoRa text can carry comfortably. */
export const MAX_MESSAGE_CHARS = 180;

export interface ChatMessage {
  /** Stable within a session; not persisted and not meaningful across one. */
  readonly key: string;
  /** Node number of the sender, or null for one of ours. */
  readonly from: number | null;
  /** How the sender is known: a name if announced, otherwise `!id`. */
  readonly label: string;
  readonly text: string;
  readonly at: number;
  readonly mine: boolean;
}

/** Why a message was refused. Null means it is fine to send. */
export type SendRefusal = 'empty' | 'too-long' | 'plate';

/**
 * Whether this text may go on the air.
 *
 * Returns the reason rather than a boolean so the screen can say WHICH rule
 * stopped it. "Blocked" with no reason is how people conclude software is
 * broken and go around it.
 */
export function refuseToSend(text: string): SendRefusal | null {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > MAX_MESSAGE_CHARS) return 'too-long';
  if (carriesPlate(trimmed)) return 'plate';
  return null;
}

/**
 * A PLATE IN FREE TEXT, which is not the same problem the vault solves.
 *
 * `looksLikePlate` glues ADJACENT runs together before testing, because a
 * handle field is one short string and a plate split across a space is the
 * obvious way to sneak one in. Its own docstring calls the false positives
 * deliberate.
 *
 * Applied to a sentence that is wrong. "camera on the corner of 4th" glues
 * "of" and "4th" into "OF4TH", which is five mixed characters and therefore a
 * plate, so ordinary prose gets refused. A check that fires on normal speech
 * is a check people learn to work around, which leaves them worse protected
 * than a narrower one they trust.
 *
 * So: the vault's SINGLE-RUN check, which catches the common form somebody
 * actually types (`HVK8842`), plus the two spaced layouts a real plate takes.
 * Deliberately not "any two adjacent runs".
 */
const SPACED_PLATE = [
  // ABC 1234, AB-1234
  /\b[A-Z]{2,3}[ -][0-9]{3,4}\b/,
  // 123 ABC
  /\b[0-9]{1,3}[ -][A-Z]{3}\b/,
];

function carriesPlate(text: string): boolean {
  if (looksLikePlateToken(text)) return true;
  const upper = text.toUpperCase();
  return SPACED_PLATE.some((re) => re.test(upper));
}

export const REFUSAL_TEXT: Readonly<Record<SendRefusal, string>> = {
  empty: 'nothing to send.',
  'too-long': `too long for one lora message. keep it under ${String(MAX_MESSAGE_CHARS)} characters.`,
  // Says what it thinks it saw and why it matters, because the check is
  // deliberately eager and will sometimes be wrong about an ordinary word.
  plate:
    'that looks like a plate. this goes out unencrypted to every radio in range and is stored on ' +
    'each of them, so it is the one thing that must not travel. reword it.',
};

/** Cap on the in-memory transcript. Old messages fall off the top. */
export const TRANSCRIPT_CAP = 100;

export function appendMessage(
  transcript: readonly ChatMessage[],
  message: ChatMessage,
): readonly ChatMessage[] {
  return [...transcript, message].slice(-TRANSCRIPT_CAP);
}

/** How a sender is shown, preferring what they call themselves. */
export function labelFor(
  from: number,
  name: string | null,
  shortName: string | null,
): string {
  return name ?? shortName ?? `!${(from >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * THE SYSTEM STREAM: what the RADIO did, as opposed to what people said.
 *
 * Kept apart from the transcript on purpose. A node coming into range and
 * somebody typing a sentence are different kinds of event, and a single list
 * that mixes them stops being readable exactly when it matters, which is when
 * a lot is happening at once.
 */
export interface StreamEvent {
  readonly key: string;
  readonly at: number;
  readonly text: string;
}

/** Shorter than the transcript: this is context, not content. */
export const STREAM_CAP = 30;

export function appendEvent(
  stream: readonly StreamEvent[],
  event: StreamEvent,
): readonly StreamEvent[] {
  return [...stream, event].slice(-STREAM_CAP);
}

/** `19:04`. Wall clock, because it is read against the world outside the car. */
export function clockOf(at: number, date = new Date(at)): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
