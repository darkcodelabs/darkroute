/**
 * ASK - v1, as a binding. See `components/AskViewV1.tsx`.
 */

import type { ReactElement } from 'react';

import { AskScreen } from './AskScreen.tsx';
import { AskViewV1 } from './components/AskViewV1.tsx';

export function AskV1Screen(): ReactElement {
  return <AskScreen view={AskViewV1} />;
}
