import type { ReactElement } from 'react';
import type { IntelAtlasContext } from '../intelState.ts';

import '../intelAtlas.css';

/** Both camera views read the same county context and state its limits. */
export function IntelAtlasDetails({ atlas }: {
  readonly atlas: IntelAtlasContext | null;
}): ReactElement | null {
  if (atlas === null || !atlas.ready || atlas.coverage === 'unknown') return null;
  if (atlas.coverage === 'recorded' && atlas.county === null) return null;
  const county = atlas.coverage === 'recorded' ? atlas.county : null;
  const retrievedMs = atlas.fetchedAt === null ? NaN : Date.parse(atlas.fetchedAt);
  const retrieved = Number.isFinite(retrievedMs)
    ? new Date(retrievedMs).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
      })
    : null;

  return (
    <details className="fwm-intel-atlas">
      <summary>County agencies and source</summary>
      <p>{atlas.countyLabel ?? 'This camera’s county'} · EFF Atlas ALPR records</p>
      <p>These records describe agencies in this county. They do not identify this camera’s owner or sharing arrangements.</p>
      {county === null ? (
        <p>No agency is listed here. The Atlas is compiled from public records, not a complete census; an unlisted agency may still use ALPR.</p>
      ) : (
        <>
          <ul aria-label="agencies recorded using ALPR in this county">
            {county.agencies.map((agency) => <li key={agency}>{agency}</li>)}
          </ul>
          <p>Vendors recorded: {county.vendors.length === 0 ? 'not recorded' : county.vendors.join(', ')}. Vendor information is available for {county.vendorKnown} of {county.deployments} deployment records.</p>
        </>
      )}
      <p className="fwm-intel-atlas-credit">
        {atlas.attribution ?? 'EFF Atlas of Surveillance'}
        {retrieved === null ? null : ` · retrieved ${retrieved}`}
      </p>
      <a href="https://atlasofsurveillance.org/" target="_blank" rel="noopener noreferrer">Open EFF Atlas of Surveillance</a>
    </details>
  );
}
