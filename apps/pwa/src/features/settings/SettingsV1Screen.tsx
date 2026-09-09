/**
 * SETTINGS - v1, as a two-line binding rather than a second screen.
 *
 * The container keeps every rule it enforces; only the view changes. See
 * `components/SettingsViewV1.tsx` for what v1 draws and what it deliberately
 * does not.
 */

import type { ReactElement } from 'react';

import { SettingsScreen } from './SettingsScreen.tsx';
import { SettingsViewV1 } from './components/SettingsViewV1.tsx';

export function SettingsV1Screen(): ReactElement {
  return <SettingsScreen view={SettingsViewV1} />;
}
