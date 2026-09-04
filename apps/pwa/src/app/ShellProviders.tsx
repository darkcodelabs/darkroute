/**
 * The provider stack, in one place, so `App.tsx` reads as composition.
 *
 * There is exactly one provider today: TanStack Query. Navigation is a store
 * (`screenState.ts`), not a context, because the alert takeover has to be able
 * to read and write it from outside React - a camera coming into range does not
 * arrive through a component tree.
 *
 * THE QUERY CLIENT IS CONFIGURED FOR A CAR, NOT A DESK
 *   `networkMode: 'offlineFirst'` - a query runs against its cache first and
 *   is not marked "paused" the moment the radio drops. Half of this product's
 *   value is what it can still answer in a dead zone.
 *
 *   Retries are bounded and backed off. A phone on one bar retrying forever is
 *   a phone with a flat battery, and the queued-evidence path in
 *   `services/db/repositories/pendingReports.ts` already owns durable retry -
 *   this layer must not become a second, invisible one.
 *
 *   `refetchOnWindowFocus` is off. On Android, returning to the app after a
 *   screen lock fires focus; refetching the whole board at that moment costs
 *   data and shows a spinner over a screen the driver was reading.
 *
 * NOTHING HERE FETCHES ON MOUNT. Queries belong to the screens that need them.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

/** Milliseconds. Not a design value: nothing is animated or sized by these. */
const ONE_MINUTE = 60_000;
const RETRY_BASE_DELAY = 500;
const RETRY_MAX_DELAY = 30_000;
const MAX_RETRIES = 3;

export function createShellQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        staleTime: 5 * ONE_MINUTE,
        gcTime: 60 * ONE_MINUTE,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: MAX_RETRIES,
        retryDelay: (attempt) => Math.min(RETRY_BASE_DELAY * 2 ** attempt, RETRY_MAX_DELAY),
      },
      mutations: {
        // `vite.config.ts` gives Workbox no POST route or background-sync
        // queue. Signed reports have one durable owner instead:
        // `services/db/repositories/pendingReports.ts`. Retrying mutations here
        // would add a second, invisible attempt path for the same evidence.
        networkMode: 'online',
        retry: 0,
      },
    },
  });
}

export interface ShellProvidersProps {
  readonly children: ReactNode;
  /** Inject a client in tests. The app creates its own once, in `App.tsx`. */
  readonly queryClient?: QueryClient;
}

export function ShellProviders({ children, queryClient }: ShellProvidersProps): ReactNode {
  // Lazy state initialiser, not a bare call: a QueryClient built during render
  // would be a NEW client on every render, throwing away every cached camera
  // tile the moment anything above it re-renders.
  const [fallback] = useState(createShellQueryClient);
  const client = queryClient ?? fallback;
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
