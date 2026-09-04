/**
 * RADIOS - v1, and what the node screen should have been.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * The RADIOS tab rendered `<NodeScreen />`, a v0 surface: flat panels, its own
 * type scale, none of the glass, and - once the firmware installer was retired
 * - almost nothing in it. Reported plainly: "that node screen fucking blows,
 * there are no options."
 *
 * Meshtastic's own web client is a full device manager: Connections, Map,
 * Messages, Nodes, and a Settings tree of nine device panels and sixteen module
 * panels. This is not that and should not be - it is a driving app, and the
 * relevant question is never "what is my ambient lighting config".
 *
 * What it takes from that client is the set of questions a person with a radio
 * ACTUALLY has, in the order they have them:
 *
 *   what is this thing        identity, hardware, firmware
 *   why can it not hear       region, modem preset, hop limit
 *   who is out there          the roster, with the numbers that explain it
 *   how do I reach my people  the channel table, and the darkroute join
 *
 * =============================================================================
 * EVERYTHING HERE IS FREE, AND ALMOST EVERYTHING IS READ-ONLY
 * =============================================================================
 * Every value arrives on connect without a request: the client sends
 * `wantConfig` and the node dumps its identity, its config and its channel
 * table down the cable. Nothing on this screen costs radio time.
 *
 * The ONE thing that writes is the darkroute join, and it writes a SECONDARY
 * channel - which the protobuf defines as ignoring radio settings and using
 * only its PSK, so a driver's own primary channel, frequency, region and preset
 * are untouched. `setConfig`, `setOwner` and `factoryReset` remain banned by
 * `mesh.privacy.test.ts`; this screen reports, it does not reconfigure.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { canMesh, connectMesh, liveSession, subscribeMesh } from '../node/mesh.ts';
import {
  ROSTER_SORTS,
  SORT_LABEL,
  buildRoster,
  heardAgo,
  hopsLine,
  isOnline,
  powerLine,
  rosterCounts,
} from './roster.ts';
import type { RosterSort } from './roster.ts';
import type { MeshChannel, MeshNode, MeshState } from '../node/mesh.ts';

import './meshRadios.css';

export const RADIOS_PAIR = 'Connect over Bluetooth';
export const RADIOS_DROP = 'Disconnect';
export const RADIOS_NONE = 'No node paired';
export const RADIOS_NONE_NOTE =
  'a meshtastic radio, over bluetooth. it needs firmware on it already - flash it with meshtastic’s own installer, we do not build any.';

/** The dash. Nothing here ever guesses a value it was not told. */
const NO_VALUE = '—';

/** The channel this app joins, and the group it names. */
export const DARKROUTE_CHANNEL = 'darkroute';

export const DEAF_HEADING = 'Why it might hear nothing';
export const DEAF_NOTE =
  'these three have to match the people you are trying to reach. a radio set to the wrong region or preset is not broken, it is just somewhere else.';

function show(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return NO_VALUE;
  return String(value);
}


function Row({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="fwm-radios-row">
      <span className="fwm-radios-row-label fwm-data">{label}</span>
      <span className="fwm-radios-row-value fwm-data">{value}</span>
    </div>
  );
}

export function MeshRadios(): ReactElement {
  const [mesh, setMesh] = useState<MeshState | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<RosterSort>('heard');

  useEffect(() => subscribeMesh(setMesh), []);

  /**
   * A CLOCK ONLY WHILE THERE IS SOMETHING TO AGE.
   *
   * "Heard 4m ago" goes stale sitting on screen, so it ticks - but a timer on a
   * screen with no roster is a timer draining a phone for nothing.
   */
  useEffect(() => {
    if (mesh?.status !== 'connected') return undefined;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(id);
    };
  }, [mesh?.status]);

  const connected = mesh?.status === 'connected';
  const device = mesh?.device ?? null;

  const onPair = useCallback(() => {
    setBusy(true);
    void connectMesh({ silent: false }).finally(() => {
      setBusy(false);
    });
  }, []);

  const onDrop = useCallback(() => {
    setBusy(true);
    void liveSession()
      ?.disconnect()
      .finally(() => {
        setBusy(false);
      });
  }, []);

  const others: readonly MeshNode[] = (mesh?.nodes ?? []).filter((n) => !n.isSelf);
  const roster = buildRoster(others, query, sort);
  const counts = rosterCounts(others, roster, now);
  const self = (mesh?.nodes ?? []).find((n) => n.isSelf) ?? null;
  const channels: readonly MeshChannel[] = mesh?.channels ?? [];
  const joined = channels.some((c) => c.name === DARKROUTE_CHANNEL);

  return (
    <div className="fwm-radios">
      {/* --- the link ----------------------------------------------------- */}
      <div className="fwm-radios-card">
        <div className="fwm-radios-head">
          <h2 className="fwm-radios-title">{connected ? show(self?.name) : RADIOS_NONE}</h2>
          <span className="fwm-radios-state fwm-data" data-fwm-radios-on={String(connected)}>
            {connected ? 'LINKED' : (mesh?.status ?? 'idle').toUpperCase()}
          </span>
        </div>
        <p className="fwm-radios-note fwm-data">{connected ? show(mesh?.message) : RADIOS_NONE_NOTE}</p>
        <button
          type="button"
          className="fwm-radios-key"
          data-fwm-key={connected ? 'quiet' : 'primary'}
          disabled={busy || !canMesh()}
          onClick={connected ? onDrop : onPair}
        >
          {connected ? RADIOS_DROP : RADIOS_PAIR}
        </button>
      </div>

      {/* --- what it is --------------------------------------------------- */}
      {connected ? (
        <div className="fwm-radios-card">
          <h2 className="fwm-radios-title">This radio</h2>
          <Row label="NODE" value={show(self?.id)} />
          <Row label="HARDWARE" value={show(device?.hardware)} />
          <Row label="FIRMWARE" value={show(device?.firmware)} />
          <Row label="BATTERY" value={self?.batteryPercent === null || self?.batteryPercent === undefined ? NO_VALUE : `${String(self.batteryPercent)}%`} />
          {/* The one fact that decides whether a direct message can be sealed. */}
          <Row label="CAN SEAL DMS" value={device?.hasKeypair === true ? 'YES' : 'NO KEY'} />
        </div>
      ) : null}

      {/* --- why it might be deaf ----------------------------------------- */}
      {connected ? (
        <div className="fwm-radios-card">
          <div className="fwm-radios-head">
            <h2 className="fwm-radios-title">{DEAF_HEADING}</h2>
          </div>
          <p className="fwm-radios-note fwm-data">{DEAF_NOTE}</p>
          <Row label="REGION" value={show(device?.region)} />
          <Row label="PRESET" value={show(device?.preset)} />
          <Row label="HOPS" value={show(device?.hopLimit)} />
        </div>
      ) : null}

      {/* --- the roster ---------------------------------------------------- */}
      {connected ? (
        <div className="fwm-radios-card">
          <div className="fwm-radios-head">
            <h2 className="fwm-radios-title">Who is out there</h2>
            {/* THREE NUMBERS, because they answer different questions and
                routinely disagree. `total` is everything the radio has ever
                heard - Meshtastic nodes never announce that they left - so a
                single count would claim a mesh that is not there. */}
            <span className="fwm-radios-count fwm-data">
              {`${String(counts.online)} LIVE · ${String(counts.shown)} SHOWN · ${String(counts.total)} TOTAL`}
            </span>
          </div>

          <input
            className="fwm-radios-filter fwm-data"
            type="search"
            value={query}
            placeholder="filter by name, id, board or role"
            aria-label="filter nodes"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />

          <div className="fwm-radios-sorts" role="group" aria-label="sort nodes">
            {ROSTER_SORTS.map((option) => (
              <button
                key={option}
                type="button"
                className="fwm-radios-sort"
                aria-pressed={sort === option}
                onClick={() => {
                  setSort(option);
                }}
              >
                {SORT_LABEL[option]}
              </button>
            ))}
          </div>

          {roster.length === 0 ? (
            <p className="fwm-radios-note fwm-data">
              {others.length === 0
                ? 'nobody has announced themselves yet. the radio is listening; whether anything is in range is a different question.'
                : 'nothing matches that filter.'}
            </p>
          ) : (
            <ul className="fwm-radios-nodes">
              {roster.map((node) => {
                const power = powerLine(node);
                const hops = hopsLine(node);
                return (
                  <li
                    className="fwm-radios-node"
                    key={node.id}
                    data-fwm-node-live={String(isOnline(node, now))}
                  >
                    <div className="fwm-radios-node-head">
                      {/* The short name is how a node identifies itself on its
                          own screen, so it is the handle people actually use. */}
                      <span className="fwm-radios-node-tag fwm-data">
                        {node.shortName ?? node.id.slice(-4)}
                      </span>
                      <span className="fwm-radios-node-name">{show(node.name ?? node.id)}</span>
                      <span className="fwm-radios-node-age fwm-data">
                        {heardAgo(node.lastHeard, now)}
                      </span>
                    </div>

                    <div className="fwm-radios-node-facts fwm-data">
                      {power === null ? null : <span>{power}</span>}
                      {node.snr === null ? null : <span>{`SNR ${node.snr.toFixed(1)}`}</span>}
                      {hops === null ? null : <span>{hops}</span>}
                      {node.altitudeM === null ? null : (
                        <span>{`${String(Math.round(node.altitudeM))} M`}</span>
                      )}
                      {node.channelUtilization === null ? null : (
                        <span>{`CH ${node.channelUtilization.toFixed(1)}%`}</span>
                      )}
                      {node.airUtilTx === null ? null : (
                        <span>{`AIR ${node.airUtilTx.toFixed(1)}%`}</span>
                      )}
                    </div>

                    <div className="fwm-radios-node-tail fwm-data">
                      {node.hardware === null ? null : <span>{node.hardware}</span>}
                      {node.role === null ? null : <span>{node.role}</span>}
                      <span className="fwm-radios-node-id">{node.id}</span>
                      {/* Two facts a mesh screen must not hide. Without a key a
                          DM cannot be sealed; over MQTT the node is not evidence
                          that anything is in radio range. */}
                      {node.hasKey ? null : <span data-fwm-node-warn="true">NO KEY</span>}
                      {node.viaMqtt ? <span data-fwm-node-warn="true">VIA MQTT</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {/* --- channels ----------------------------------------------------- */}
      {connected ? (
        <div className="fwm-radios-card">
          <div className="fwm-radios-head">
            <h2 className="fwm-radios-title">Channels</h2>
            <span className="fwm-radios-count fwm-data">{joined ? 'JOINED' : String(channels.length)}</span>
          </div>
          <p className="fwm-radios-note fwm-data">
            a channel is a name and a key. two radios hear each other when both hold the same one.
            joining writes to your node over this cable and puts nothing on the air.
          </p>
          {channels.length === 0 ? (
            <p className="fwm-radios-note fwm-data">the node has not sent its channel table yet.</p>
          ) : (
            <ul className="fwm-radios-channels">
              {channels.map((channel) => (
                <li className="fwm-radios-channel" key={channel.index} data-fwm-role={channel.role}>
                  <span className="fwm-radios-channel-name">
                    {channel.name === '' ? NO_VALUE : channel.name}
                  </span>
                  <span className="fwm-radios-channel-role fwm-data">{channel.role}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
