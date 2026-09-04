/**
 * OFFLINE - v1.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isOffline` block.
 *
 * A capability list: for each half of the product, whether it still works with
 * no signal. This is the one screen in the v1 file that ships real degraded
 * states, and it is the right shape, because the question somebody has here is
 * not "am I offline" - the phone already told them that - it is "what still
 * works".
 *
 * Every state is READ, not asserted. The design's row values (WORKING, QUEUED,
 * CACHED, PAUSED) are conclusions about live things: what is cached, what is
 * queued, when the last sync was. Where the product cannot tell, the row says
 * so rather than claiming WORKING.
 */

import type { ReactElement } from 'react';

import {
  useCachedCameraCount,
  useCachedTileCount,
  useHeldReportCount,
  useIsOnline,
  useLastSyncAtMs,
  usePendingSyncCount,
} from '../../stores/index.ts';
import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../components/nav';

import './offlineV1.css';

export const NO_VALUE = '—';

export const OFFLINE_TITLE = 'Offline';
export const OFFLINE_HEADLINE = 'You are still being warned.';
export const OFFLINE_BODY =
  'the alerting has never needed a network. it runs off the copy of the camera archive on this ' +
  'phone, which is why this screen is a list of what still works rather than an apology.';

/**
 * The words a row can say.
 *
 * THESE ARE ANSWERS, NOT STATUS CODES. The first version used the design's
 * `LIMITED`, which says nothing at all: limited how, and what do I do about
 * it? A driver reading a status word should not have to infer the sentence
 * behind it, and on this screen the sentence is the whole point - somebody is
 * here because they want to know what still works.
 *
 *   WORKING     it does what it normally does.
 *   QUEUED      it is working and holding something to send later.
 *   CACHED      it works where you have already been, and nowhere else.
 *   NOT CHECKED it has not run, so there is nothing to report.
 *   PAUSED      it needs a network and there is not one.
 *   UNKNOWN     the app genuinely cannot tell.
 */
type RowState = 'WORKING' | 'QUEUED' | 'CACHED' | 'NOT CHECKED' | 'PAUSED' | 'UNKNOWN';

/** How long before a cached archive is worth calling stale. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function ago(atMs: number | null): string {
  if (atMs === null) return NO_VALUE;
  const mins = Math.max(0, Math.round((Date.now() - atMs) / 60_000));
  if (mins < 60) return `${String(mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${String(hours)} h ago`;
  return `${String(Math.round(hours / 24))} d ago`;
}

export function OfflineV1Screen(): ReactElement {
  const online = useIsOnline();
  const cameras = useCachedCameraCount();
  const tiles = useCachedTileCount();
  const held = useHeldReportCount();
  const pending = usePendingSyncCount();
  const lastSync = useLastSyncAtMs();

  const queued = held + pending;
  const stale = lastSync === null || Date.now() - lastSync > STALE_AFTER_MS;

  const rows: readonly { label: string; sub: string; state: RowState }[] = [
    {
      label: 'Camera alerts',
      sub:
        cameras === null || cameras === 0
          ? 'no cameras held yet, so nothing can be warned about.'
          : `from ${String(cameras)} cameras held on this phone. no network involved.`,
      // The only row that can be WORKING with no network, and the one that
      // matters most. It is UNKNOWN rather than WORKING when nothing is cached.
      state: cameras === null || cameras === 0 ? 'UNKNOWN' : 'WORKING',
    },
    {
      label: 'Exposure log',
      sub: 'recording every pass. it never leaves this phone either way.',
      state: 'WORKING',
    },
    {
      label: 'Reports you file',
      sub:
        queued === 0
          ? 'nothing waiting. a report filed now is held until you have signal.'
          : `${String(queued)} waiting. they send themselves when signal returns.`,
      state: queued === 0 ? 'WORKING' : 'QUEUED',
    },
    {
      label: 'Map tiles',
      // WHAT `CACHED` ACTUALLY MEANS, said out loud. The alerting does not need
      // the map at all - that is the row above - so a blank map is a cosmetic
      // problem, and the row should say which kind of problem it is.
      sub:
        tiles === null || tiles === 0
          ? 'none held. the map draws blank until you have a signal once.'
          : `${String(tiles)} square${tiles === 1 ? '' : 's'} held. the map draws where you have ` +
            'already been and blank everywhere else.',
      state: tiles === null || tiles === 0 ? 'PAUSED' : 'CACHED',
    },
    {
      label: 'Mesh channel',
      sub: 'runs on the lora radio, so a dead phone signal changes nothing.',
      state: 'WORKING',
    },
    {
      label: 'New camera data',
      sub:
        lastSync === null
          ? 'not checked yet on this device.'
          : `last checked ${ago(lastSync)}.${stale ? ' cameras added since then are invisible.' : ''}`,
      // NEVER `WORKING` ON A SYNC THAT HAS NEVER RUN. Being online means it CAN
      // check, not that it HAS, and those are different answers to the question
      // this screen exists to ask.
      state: lastSync === null ? 'NOT CHECKED' : online ? 'WORKING' : stale ? 'PAUSED' : 'CACHED',
    },
  ];

  return (
    <section className="fwm-offlinev1" aria-label="offline">
      <header className="fwm-offlinev1-header">
        {/* Reached from MORE's "Offline readiness" row and from nowhere else,
            so MORE is where back goes. The header is already a flex row with
            the title claiming `margin-right: auto`, which puts the arrow at
            the left and the ONLINE badge at the right with nothing else to
            change. */}
        <BackKey to="more" label={BACK_TO_MORE} />
        <ReloadTitle title={OFFLINE_TITLE} className="fwm-offlinev1-title" />
        <span className="fwm-offlinev1-net fwm-data" data-fwm-online={String(online)}>
          {online ? 'ONLINE' : 'NO SIGNAL'}
        </span>
      </header>

      <div className="fwm-offlinev1-hero">
        <h2 className="fwm-offlinev1-headline">{OFFLINE_HEADLINE}</h2>
        <p className="fwm-offlinev1-body">{OFFLINE_BODY}</p>
      </div>

      <ul className="fwm-offlinev1-list" aria-label="what still works">
        {rows.map((row) => (
          <li className="fwm-offlinev1-row" key={row.label}>
            <span className="fwm-offlinev1-row-where">
              <span className="fwm-offlinev1-row-label">{row.label}</span>
              <span className="fwm-offlinev1-row-sub fwm-data">{row.sub}</span>
            </span>
            <span className="fwm-offlinev1-state fwm-data" data-fwm-state={row.state}>
              {row.state}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
