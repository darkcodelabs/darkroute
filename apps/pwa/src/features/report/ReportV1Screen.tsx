/**
 * REPORT - v1, as a binding. See `components/ReportViewV1.tsx`.
 */

import type { ReactElement } from 'react';

import { ReportScreen } from './ReportScreen.tsx';
import { ReportViewV1 } from './components/ReportViewV1.tsx';

export function ReportV1Screen(): ReactElement {
  return <ReportScreen view={ReportViewV1} />;
}
