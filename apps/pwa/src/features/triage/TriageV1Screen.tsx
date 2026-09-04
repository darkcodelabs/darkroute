/**
 * TRIAGE - v1, as a binding. See `components/TriageViewV1.tsx`.
 */

import type { ReactElement } from 'react';

import { TriageScreen } from './TriageScreen.tsx';
import { TriageViewV1 } from './components/TriageViewV1.tsx';

export function TriageV1Screen(): ReactElement {
  return <TriageScreen view={TriageViewV1} />;
}
