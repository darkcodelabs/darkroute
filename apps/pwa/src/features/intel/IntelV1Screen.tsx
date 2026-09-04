/**
 * INTEL - v1, as a binding. See `components/IntelViewV1.tsx`.
 */

import type { ReactElement } from 'react';

import { IntelScreen } from './IntelScreen.tsx';
import { IntelViewV1 } from './components/IntelViewV1.tsx';

export function IntelV1Screen(): ReactElement {
  return <IntelScreen view={IntelViewV1} />;
}
