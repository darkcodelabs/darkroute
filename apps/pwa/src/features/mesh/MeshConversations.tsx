/**
 * CONVERSATIONS - channels and direct messages, as separate rooms.
 *
 * =============================================================================
 * WHY THIS REPLACES A SINGLE STREAM
 * =============================================================================
 * The chat tab showed one list: every broadcast on every channel and every
 * direct message, in arrival order, under one send box. On a real mesh that is
 * unreadable within a minute, but the reason it had to change is the other one:
 *
 *   A SEALED DIRECT MESSAGE AND A PUBLIC BROADCAST LOOKED THE SAME.
 *
 * Somebody answering what read as a private message had no way to know their
 * reply was about to go to every radio in range. The composer is now inside a
 * thread and carries the thread's own warning, so the destination of a reply is
 * never a guess.
 *
 * =============================================================================
 * TWO SCREENS, ONE COMPONENT
 * =============================================================================
 * A list of rooms, and one room. Kept in one file because the second is
 * meaningless without the first and the state they share - which thread is
 * open - is the thing that decides what "send" does.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { liveSession, subscribeMesh } from '../node/mesh.ts';
import type { MeshNode, MeshState } from '../node/mesh.ts';
import { REFUSAL_TEXT, clockOf, refuseToSend } from '../node/chat.ts';
import type { SendRefusal } from '../node/chat.ts';

import { setOpenThread, recordSentTo, subscribeThreads } from './threadStore.ts';
import { preview, threadKey, threadList } from './threads.ts';
import type { Thread, ThreadId, ThreadMap } from './threads.ts';

import './meshRadios.css';

export const CONVERSATIONS_EMPTY = 'nothing heard yet. the radio is listening.';
export const CONVERSATIONS_OFFLINE = 'no node paired. connect one on RADIOS.';

/** What a reply to this thread will actually do. Shown above the composer. */
export const CHANNEL_WARNING = 'goes to every radio in range on this channel';
export const DIRECT_WARNING = 'sealed to this node on firmware 2.5+, and to nobody else';

const NO_VALUE = '—';

/** `LongFast`, `darkroute`, or `CHANNEL 3` when the node named none. */
function channelName(index: number, mesh: MeshState | null): string {
  const named = mesh?.channels.find((c) => c.index === index);
  if (named !== undefined && named.name !== '') return named.name;
  return `CHANNEL ${String(index)}`;
}

/** A peer's own name, falling back to the id form Meshtastic prints. */
function peerName(num: number, nodes: readonly MeshNode[]): string {
  const id = `!${(num >>> 0).toString(16).padStart(8, '0')}`;
  const node = nodes.find((n) => n.id === id);
  return node?.name ?? node?.shortName ?? id;
}

function titleOf(id: ThreadId, mesh: MeshState | null): string {
  return id.kind === 'channel'
    ? channelName(id.index, mesh)
    : peerName(id.node, mesh?.nodes ?? []);
}

export function MeshConversations(): ReactElement {
  const [mesh, setMesh] = useState<MeshState | null>(null);
  const [threads, setThreads] = useState<ThreadMap>({});
  const [open, setOpen] = useState<ThreadId | null>(null);
  const [draft, setDraft] = useState('');
  const [refusal, setRefusal] = useState<SendRefusal | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => subscribeMesh(setMesh), []);
  useEffect(() => subscribeThreads(setThreads), []);

  // Telling the store which thread is on screen is what stops a message the
  // person is currently reading from raising an unread badge.
  useEffect(() => {
    setOpenThread(open === null ? null : threadKey(open));
    return () => {
      setOpenThread(null);
    };
  }, [open]);

  const connected = mesh?.status === 'connected';

  /** Every channel the radio holds, so an empty one is still enterable. */
  const seedChannels = useMemo(
    () => (mesh?.channels ?? []).filter((c) => c.role !== 'DISABLED').map((c) => c.index),
    [mesh?.channels],
  );

  const list = useMemo(() => threadList(threads, seedChannels), [threads, seedChannels]);
  const current: Thread | null = open === null ? null : threads[threadKey(open)] ?? null;

  const onSend = useCallback(async (): Promise<void> => {
    if (open === null) return;
    const text = draft.trim();
    // GATED FIRST, always. `refuseToSend` is what keeps a plate off an open
    // radio, and the refusal is shown rather than swallowed so somebody knows
    // to reword instead of concluding the button is broken.
    const no = refuseToSend(text);
    if (no !== null) {
      setRefusal(no);
      return;
    }
    const session = liveSession();
    if (session === null) {
      setFailure('no node connected');
      return;
    }
    setSending(true);
    setRefusal(null);
    setFailure(null);
    try {
      if (open.kind === 'channel') await session.sendText(text);
      else await session.sendDirect(open.node, text);
      // Recorded here rather than from the radio's echo, which comes back
      // looking like traffic from a stranger.
      recordSentTo(open, text, Date.now());
      setDraft('');
    } catch {
      setFailure('the radio refused it. it is not on the air.');
    } finally {
      setSending(false);
    }
  }, [draft, open]);

  if (!connected) {
    return (
      <div className="fwm-radios">
        <div className="fwm-radios-card">
          <h2 className="fwm-radios-title">Conversations</h2>
          <p className="fwm-radios-note fwm-data">{CONVERSATIONS_OFFLINE}</p>
        </div>
      </div>
    );
  }

  // --- one room ------------------------------------------------------------
  if (open !== null && current !== null) {
    const direct = open.kind === 'direct';
    return (
      <div className="fwm-radios">
        <div className="fwm-radios-card">
          <div className="fwm-radios-head">
            <button
              type="button"
              className="fwm-radios-back"
              onClick={() => {
                setOpen(null);
                setDraft('');
                setRefusal(null);
              }}
            >
              {'‹ ALL'}
            </button>
            <h2 className="fwm-radios-title">{titleOf(open, mesh)}</h2>
          </div>
          {/* WHERE A REPLY GOES, stated before it is typed rather than after
              it has gone. This is the line the single-stream chat could not
              show, and the reason it had to be replaced. */}
          <p className="fwm-radios-note fwm-data" data-fwm-thread-kind={open.kind}>
            {direct ? DIRECT_WARNING : CHANNEL_WARNING}
          </p>
        </div>

        <div className="fwm-radios-card">
          {current.messages.length === 0 ? (
            <p className="fwm-radios-note fwm-data">{CONVERSATIONS_EMPTY}</p>
          ) : (
            <ul className="fwm-thread">
              {current.messages.map((message) => (
                <li
                  className="fwm-thread-line"
                  key={message.key}
                  data-fwm-mine={String(message.mine)}
                >
                  <span className="fwm-thread-who fwm-data">
                    {message.mine
                      ? 'you'
                      : message.from === null
                        ? NO_VALUE
                        : peerName(message.from, mesh?.nodes ?? [])}
                  </span>
                  <span className="fwm-thread-text">{message.text}</span>
                  <span className="fwm-thread-at fwm-data">{clockOf(message.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="fwm-radios-card">
          <textarea
            className="fwm-radios-composer fwm-data"
            value={draft}
            rows={2}
            aria-label="message"
            placeholder="say something"
            onChange={(event) => {
              setDraft(event.target.value);
              setRefusal(null);
            }}
          />
          {refusal === null ? null : (
            <p className="fwm-radios-note fwm-data" data-fwm-refusal="true">
              {REFUSAL_TEXT[refusal]}
            </p>
          )}
          {failure === null ? null : (
            <p className="fwm-radios-note fwm-data" data-fwm-refusal="true">
              {failure}
            </p>
          )}
          <button
            type="button"
            className="fwm-radios-key"
            data-fwm-key="primary"
            disabled={sending || draft.trim() === ''}
            onClick={() => {
              void onSend();
            }}
          >
            {direct ? 'SEND TO THIS NODE' : 'SEND TO THE CHANNEL'}
          </button>
        </div>
      </div>
    );
  }

  // --- the list ------------------------------------------------------------
  return (
    <div className="fwm-radios">
      <div className="fwm-radios-card">
        <div className="fwm-radios-head">
          <h2 className="fwm-radios-title">Conversations</h2>
          <span className="fwm-radios-count fwm-data">{String(list.length)}</span>
        </div>
        {list.length === 0 ? (
          <p className="fwm-radios-note fwm-data">{CONVERSATIONS_EMPTY}</p>
        ) : (
          <ul className="fwm-radios-nodes">
            {list.map((thread) => {
              const last = preview(thread);
              return (
                <li key={thread.key}>
                  <button
                    type="button"
                    className="fwm-thread-row"
                    data-fwm-thread-kind={thread.id.kind}
                    onClick={() => {
                      setOpen(thread.id);
                    }}
                  >
                    <span className="fwm-thread-row-head">
                      <span className="fwm-radios-node-name">{titleOf(thread.id, mesh)}</span>
                      {thread.unread === 0 ? null : (
                        <span className="fwm-thread-unread fwm-data">{String(thread.unread)}</span>
                      )}
                    </span>
                    <span className="fwm-thread-row-last fwm-data">
                      {last ?? (thread.id.kind === 'channel' ? 'no messages yet' : NO_VALUE)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
