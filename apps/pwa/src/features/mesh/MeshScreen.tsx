/**
 * MESH - the v1 replacement for NODE.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isMesh` block.
 *
 * Two tabs over one screen: RADIOS is what the mesh is and who is reachable,
 * CHAT is the thread. v0 NODE stacked install, pairing, instrument and chat
 * down one page; this splits the "what is this" half from the "use it" half,
 * which is the same split the firmware installer already lives behind.
 *
 * WHAT LEAVES YOUR CAR is the panel worth keeping honest. The design lists it
 * as four rows of SENT and NEVER, and every one of those claims is checked by
 * `mesh.privacy.test.ts`, which reads the whole feature and fails on any
 * transmit path other than the single deliberate one.
 */

import { useState } from 'react';
import type { ReactElement } from 'react';

import { MeshConfig } from './MeshConfig.tsx';
import { MeshConversations } from './MeshConversations.tsx';
import { MeshRadios } from './MeshRadios.tsx';
import { ReloadTitle } from '../../components/nav';

import './mesh.css';

export const MESH_TITLE = 'Mesh';
export const TAB_RADIOS = 'Radios';
export const TAB_CHAT = 'Chat';
export const TAB_CONFIG = 'Config';

export const MESH_PITCH_TITLE = 'Warn the drivers near you without telling anyone who you are.';
export const MESH_PITCH_BODY =
  'a small lora radio in your car carries short typed messages to cars a few miles out. no sim, ' +
  'no account, no server - nothing to subpoena and no number tied to you.';

/**
 * WHAT LEAVES YOUR CAR.
 *
 * Written as claims because that is what they are, and every one is enforced
 * by a test rather than by intention. `sent` is what the product transmits;
 * `never` is what it will not, and `mesh.privacy.test.ts` fails the build if
 * a second transmit path or any position field appears in this feature.
 *
 * ONE CLAIM WAS DELETED FROM THIS LIST, AND THE REASON MATTERS MORE THAN THE
 * CLAIM. It read "camera pins you choose to share", and it was false: the
 * encoder for that (`node/sighting.ts`) has never had a production caller -
 * its only importers are its own test and the privacy test that EXCLUDES it
 * (`mesh.privacy.test.ts` asserts `not.toContain('sighting.ts')`). So the
 * paragraph three lines above, promising every claim here is test-enforced,
 * was sitting directly over a claim no test could enforce because the feature
 * did not exist.
 *
 * That is the worst shape a defect can take in this product. Nothing else in
 * the app is worth anything if this list is aspirational, so the rule is now
 * explicit: a line goes in LEAVES when the transmit path is wired and a test
 * covers it, never when it is planned.
 */
export const LEAVES = [
  { state: 'SENT', text: 'short typed messages. no attachments, no voice.' },
  { state: 'NEVER', text: 'your position, speed, route, or how long you have been on the mesh.' },
  { state: 'NEVER', text: 'a stable identity. nothing ties two messages together.' },
] as const;

export function MeshScreen(): ReactElement {
  /**
   * CHAT FIRST.
   *
   * RADIOS is the explainer - what a LoRa radio is, what leaves your car, how
   * to pair one. It is a thing you read ONCE. CHAT is what the screen is for
   * every time after that, and opening on the manual is making everybody
   * re-enter the tutorial to reach the room.
   */
  const [tab, setTab] = useState<'radios' | 'chat' | 'config'>('chat');

  return (
    <section className="fwm-mesh" data-fwm-tab={tab} aria-label="mesh">
      <header className="fwm-mesh-header">
        <ReloadTitle title={MESH_TITLE} className="fwm-mesh-title" />
      </header>

      <div className="fwm-mesh-tabs" role="tablist" aria-label="mesh">
        {[
          { key: 'radios' as const, label: TAB_RADIOS },
          { key: 'chat' as const, label: TAB_CHAT },
          { key: 'config' as const, label: TAB_CONFIG },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className="fwm-mesh-tab fwm-data"
            data-fwm-selected={String(tab === t.key)}
            onClick={() => {
              setTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'config' ? (
        /* CONFIG.
         *
         * The RADIOS tab could already tell somebody their region was wrong,
         * their preset did not match, or their node had no name - and then
         * offered no way to change any of it. A screen that diagnoses and
         * cannot treat sends people to another app, which is the opposite of
         * one pane of glass. Four panels, not Meshtastic's twenty-five: see the
         * file header for what is deliberately absent and why. */
        <MeshConfig />
      ) : tab === 'radios' ? (
        <>
          {/* THE PITCH, once, in the product's own words. It is the only
              screen that has to explain what a LoRa radio is for. */}
          <div className="fwm-mesh-pitch">
            <h2 className="fwm-mesh-pitch-title">{MESH_PITCH_TITLE}</h2>
            <p className="fwm-mesh-pitch-body">{MESH_PITCH_BODY}</p>
          </div>

          <ul className="fwm-mesh-leaves" aria-label="what leaves your car">
            {LEAVES.map((row) => (
              <li className="fwm-mesh-leaf" key={row.text}>
                <span className="fwm-mesh-leaf-state fwm-data" data-fwm-state={row.state}>
                  {row.state}
                </span>
                <span className="fwm-mesh-leaf-text">{row.text}</span>
              </li>
            ))}
          </ul>

          {/* RADIOS, IN THIS APP'S OWN MATERIAL.
              This rendered `<NodeScreen />` - a v0 surface inside a v1 tab,
              with flat panels, its own type scale and none of the glass. Since
              the firmware installer was retired it also had almost nothing in
              it. `MeshRadios` answers the questions somebody with a radio
              actually has, on the app's own cards. */}
          <MeshRadios />
        </>
      ) : (
        /* CHAT IS A THREAD.
         *
         * This rendered the whole of `<NodeScreen />` - installer, pairing,
         * instrument, four accordions, and a text field somewhere under all of
         * it. The justification was keeping one transcript rather than two, and
         * the concern was right: the answer was to move the transcript out to
         * `node/transcript.ts`, where both surfaces read the same one, rather
         * than to render a whole screen twice. */
        <MeshConversations />
      )}
    </section>
  );
}
