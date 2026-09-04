/**
 * ONBOARDING - v1, as a binding. See `components/OnboardingViewV1.tsx`.
 */

import type { ReactElement } from 'react';

import { OnboardingScreen } from './OnboardingScreen.tsx';
import { OnboardingViewV1 } from './components/OnboardingViewV1.tsx';

export function OnboardingV1Screen(): ReactElement {
  return <OnboardingScreen view={OnboardingViewV1} />;
}
