/**
 * CONFIG - the four panels that decide whether the radio works at all.
 *
 * =============================================================================
 * WHY THERE ARE FOUR AND NOT TWENTY-FIVE
 * =============================================================================
 * The Meshtastic web client ships nine device panels and sixteen module panels.
 * Reproducing all twenty-five here would be a worse copy of an app that already
 * exists and is better at it, in a product whose actual job is warning a driver
 * about cameras.
 *
 * These four are the ones where NOT having them made this app dishonest: the
 * RADIOS screen would tell somebody their region was wrong, their preset did
 * not match, or their node had no name, and then offer no way to change it. A
 * screen that diagnoses and cannot treat sends people to another app, and the
 * whole point of a single pane of glass is that it does not.
 *
 * =============================================================================
 * WHAT IS DELIBERATELY ABSENT
 * =============================================================================
 * `setModuleConfig` stays banned by `mesh.privacy.test.ts`, so no module panel
 * is reachable from here. Several of those modules - MQTT, Serial, External
 * Notification - can start republishing this radio's traffic off the mesh
 * entirely, and a counter-surveillance app should not be the thing that turns
 * that on by accident. Somebody who wants it can use Meshtastic's own client,
 * deliberately, having read what it does.
 *
 * `factoryReset` and `deleteMyNode` are absent for a simpler reason: they are
 * unrecoverable from here, and one of them takes the owner's keypair with it.
 *
 * =============================================================================
 * EVERY WRITE IS A BUTTON, AND EVERY BUTTON SAYS WHAT IT WILL DO
 * =============================================================================
 * Nothing on this screen saves as you type. A radio config write goes to
 * hardware somebody owns and can take it off the air; committing on a keystroke
 * would make a stray tap a network event. The panels stage a change and the
 * button commits it, and the button names the consequence rather than saying
 * SAVE.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import {
  PRESET_NAME,
  REGION_NAME,
  liveSession,
  presetCode,
  regionCode,
  subscribeMesh,
} from '../node/mesh.ts';
import type { MeshState } from '../node/mesh.ts';

import './meshRadios.css';

export const CONFIG_OFFLINE = 'no node paired. connect one on RADIOS.';

/** Said before the name field, because it is not obvious and it is permanent-ish. */
export const NAME_NOTE =
  'the long name rides every announcement this radio makes, so everyone on the mesh sees it. it is not a login and it is not private.';

export const LORA_NOTE =
  'these three decide who this radio can hear. changing them does not break anything, but a node on the wrong region or preset is not on your mesh at all - it is on a different one.';

export const REGION_WARNING =
  'region sets the frequency this radio transmits on. the legal one depends on where you are.';

const NO_VALUE = '—';

type Busy = null | 'name' | 'lora';

export function MeshConfig(): ReactElement {
  const [mesh, setMesh] = useState<MeshState | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [longName, setLongName] = useState('');
  const [shortName, setShortName] = useState('');
  const [region, setRegion] = useState<number | null>(null);
  const [preset, setPreset] = useState<number | null>(null);
  const [hops, setHops] = useState<number | null>(null);

  useEffect(() => subscribeMesh(setMesh), []);

  const connected = mesh?.status === 'connected';
  const device = mesh?.device ?? null;
  const self = (mesh?.nodes ?? []).find((n) => n.isSelf) ?? null;
  // Primitive keys, so the seeding effect below depends on VALUES rather than
  // on object identities that change on every publish.
  const selfId = self?.id ?? null;
  const deviceRegion = device?.region ?? null;
  const devicePreset = device?.preset ?? null;
  const deviceHops = device?.hopLimit ?? null;

  /*
   * SEED FROM THE RADIO, ONCE PER CONNECT.
   *
   * Keyed on the node id rather than on every render: re-seeding on each state
   * publish would overwrite what somebody is halfway through typing every time
   * a telemetry packet arrived, which on a busy mesh is constantly.
   */
  useEffect(() => {
    if (!connected) return;
    setLongName(self?.name ?? '');
    setShortName(self?.shortName ?? '');
    setRegion(regionCode(device?.region ?? null));
    setPreset(presetCode(device?.preset ?? null));
    setHops(device?.hopLimit ?? null);
    // Depends on the identity of the connection, NOT on `device` or `self`.
    // Those objects are replaced on every telemetry publish, so listing them
    // would re-seed the fields several times a second and wipe out whatever
    // somebody is halfway through typing.
  }, [connected, selfId, deviceRegion, devicePreset, deviceHops]);

  const commitName = useCallback(async () => {
    const session = liveSession();
    if (session === null) return;
    setBusy('name');
    setFailure(null);
    setDone(null);
    try {
      await session.setOwnerName(longName.trim(), shortName.trim());
      setDone('name written to the radio');
    } catch {
      setFailure('the radio refused it. nothing changed.');
    } finally {
      setBusy(null);
    }
  }, [longName, shortName]);

  const commitLora = useCallback(async () => {
    const session = liveSession();
    if (session === null || region === null || preset === null || hops === null) return;
    setBusy('lora');
    setFailure(null);
    setDone(null);
    try {
      await session.setLora(region, preset, hops);
      setDone('radio settings written. it may drop and rejoin.');
    } catch {
      setFailure('the radio refused it. nothing changed.');
    } finally {
      setBusy(null);
    }
  }, [region, preset, hops]);

  if (!connected) {
    return (
      <div className="fwm-radios">
        <div className="fwm-radios-card">
          <h2 className="fwm-radios-title">Config</h2>
          <p className="fwm-radios-note fwm-data">{CONFIG_OFFLINE}</p>
        </div>
      </div>
    );
  }

  const nameChanged = longName.trim() !== (self?.name ?? '') || shortName.trim() !== (self?.shortName ?? '');
  const loraChanged =
    region !== regionCode(device?.region ?? null) ||
    preset !== presetCode(device?.preset ?? null) ||
    hops !== (device?.hopLimit ?? null);

  return (
    <div className="fwm-radios">
      {/* --- who this radio says it is ------------------------------------ */}
      <div className="fwm-radios-card">
        <h2 className="fwm-radios-title">Name</h2>
        <p className="fwm-radios-note fwm-data">{NAME_NOTE}</p>

        <label className="fwm-config-field">
          <span className="fwm-radios-row-label fwm-data">LONG NAME</span>
          <input
            className="fwm-config-input fwm-data"
            value={longName}
            maxLength={39}
            onChange={(event) => {
              setLongName(event.target.value);
            }}
          />
        </label>

        <label className="fwm-config-field">
          <span className="fwm-radios-row-label fwm-data">SHORT NAME</span>
          <input
            className="fwm-config-input fwm-data"
            value={shortName}
            maxLength={4}
            onChange={(event) => {
              setShortName(event.target.value);
            }}
          />
        </label>

        <button
          type="button"
          className="fwm-radios-key"
          data-fwm-key="primary"
          disabled={busy !== null || !nameChanged || longName.trim() === ''}
          onClick={() => {
            void commitName();
          }}
        >
          {busy === 'name' ? 'WRITING…' : 'WRITE NAME TO THE RADIO'}
        </button>
      </div>

      {/* --- why it might hear nothing ------------------------------------ */}
      <div className="fwm-radios-card">
        <h2 className="fwm-radios-title">Radio</h2>
        <p className="fwm-radios-note fwm-data">{LORA_NOTE}</p>

        <label className="fwm-config-field">
          <span className="fwm-radios-row-label fwm-data">REGION</span>
          <select
            className="fwm-config-input fwm-data"
            value={region === null ? '' : String(region)}
            onChange={(event) => {
              setRegion(event.target.value === '' ? null : Number(event.target.value));
            }}
          >
            <option value="">{NO_VALUE}</option>
            {Object.entries(REGION_NAME).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {/* The one field with a legal consequence, so it carries the warning. */}
        <p className="fwm-radios-note fwm-data" data-fwm-config-warn="true">
          {REGION_WARNING}
        </p>

        <label className="fwm-config-field">
          <span className="fwm-radios-row-label fwm-data">PRESET</span>
          <select
            className="fwm-config-input fwm-data"
            value={preset === null ? '' : String(preset)}
            onChange={(event) => {
              setPreset(event.target.value === '' ? null : Number(event.target.value));
            }}
          >
            <option value="">{NO_VALUE}</option>
            {Object.entries(PRESET_NAME).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="fwm-config-field">
          <span className="fwm-radios-row-label fwm-data">HOPS</span>
          <select
            className="fwm-config-input fwm-data"
            value={hops === null ? '' : String(hops)}
            onChange={(event) => {
              setHops(event.target.value === '' ? null : Number(event.target.value));
            }}
          >
            <option value="">{NO_VALUE}</option>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {String(n)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="fwm-radios-key"
          data-fwm-key="primary"
          disabled={busy !== null || !loraChanged || region === null || preset === null}
          onClick={() => {
            void commitLora();
          }}
        >
          {busy === 'lora' ? 'WRITING…' : 'WRITE RADIO SETTINGS'}
        </button>
      </div>

      {/* --- keys, read only ---------------------------------------------- */}
      <div className="fwm-radios-card">
        <h2 className="fwm-radios-title">Keys</h2>
        <p className="fwm-radios-note fwm-data">
          {device?.hasKeypair === true
            ? 'this radio holds a keypair, so a direct message to a node whose key it has is sealed to that node. the app reads whether a key EXISTS and never the key itself.'
            : 'this radio has no keypair, so it cannot seal a direct message. meshtastic generates one on recent firmware; this app will not, because a key it generated is a key it touched.'}
        </p>
        <div className="fwm-radios-row">
          <span className="fwm-radios-row-label fwm-data">CAN SEAL DMS</span>
          <span className="fwm-radios-row-value fwm-data">
            {device?.hasKeypair === true ? 'YES' : 'NO'}
          </span>
        </div>
      </div>

      {(failure ?? done) === null ? null : (
        <div className="fwm-radios-card">
          <p
            className="fwm-radios-note fwm-data"
            data-fwm-refusal={failure === null ? undefined : 'true'}
          >
            {failure ?? done}
          </p>
        </div>
      )}
    </div>
  );
}
