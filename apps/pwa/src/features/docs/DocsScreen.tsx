/**
 * DOCS - the route from the app to the thing that makes its claims checkable.
 *
 * See `docs.ts` for why an app like this carries a documentation index at all,
 * and why the documents are linked rather than embedded.
 *
 * ONE DESIGN NOTE. Every row here leaves the app, and each says so with the
 * same affordance, because a link that looks like a screen and then opens a
 * browser is a small lie about where you are going. There is no in-app reader:
 * a cached copy of a document that disagrees with the code would be worse than
 * no copy at all.
 */

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';

import { BUILD, buildLabel } from '../../app/buildInfo.ts';
import { cameraOverview } from '../../services/cameras/overview.ts';
import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../components/nav';

import {
  INTEGRATIONS_LEDE,
  INTEGRATIONS_TITLE,
  POI_BODY,
  POI_DETECTOR_NOTE,
  POI_STALE_NOTE,
  POI_TITLE,
  COMMIT_DEV_NOTE,
  COMMIT_NOTE,
  DOCS_LEDE,
  DOCS_TITLE,
  DOC_ENTRIES,
  REPO_PRIVATE_NOTE,
  REPO_PUBLIC,
  REPO_URL,
  commitUrl,
  docUrl,
} from './docs.ts';

import { POI_FORMATS, POI_FORMAT_LABEL, POI_FORMAT_NOTE, poiFilename, renderPoi } from './poiExport.ts';
import type { PoiFormat } from './poiExport.ts';

import './docs.css';

export const REPO_LABEL = 'The whole repository';
export const REPO_SUB =
  'the published source, every test, and public history from the squashed release root';

export const POI_FAIL = 'could not read the camera archive on this device.';

export function DocsScreen(): ReactElement {
  const commit = commitUrl();
  const [busy, setBusy] = useState<PoiFormat | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * BUILT HERE, FROM WHAT IS ALREADY ON THE PHONE.
   *
   * `overview.json` is the file the map already fetches and the service worker
   * already holds, so this reads bytes that are on the device rather than
   * downloading anything - which is why it works with no signal, and why the
   * file is exactly as current as the warnings the driver has been getting.
   *
   * BOTH HALVES OF THAT SENTENCE USED TO BE FALSE. This screen and the map each
   * fetched `/cameras/overview.json` raw, on a URL no service-worker route
   * matched, so the export downloaded a megabyte over the network - or failed
   * outright with no signal - and could come from a different generation than
   * the warnings. Both now read `services/cameras/overview.ts`, which binds the
   * file to the working generation, and the worker holds that exact URL.
   *
   * A generation the app has not reached is a REFUSAL, not an empty export: a
   * POI file that silently omitted half the archive would be carried into
   * another device and trusted there.
   *
   * The blob is revoked immediately after the click. An object URL that
   * outlives its use keeps 10 MB of camera positions alive in the page for no
   * reason, on the one screen whose whole subject is what this app holds.
   */
  const build = useCallback(async (format: PoiFormat): Promise<void> => {
    setBusy(format);
    setFailure(null);
    try {
      const overview = await cameraOverview.settled();
      if (overview === null) throw new Error('unavailable');

      const text = renderPoi(format, {
        coords: overview.coords,
        ...(overview.attribution === null ? {} : { attribution: overview.attribution }),
        ...(overview.licence === null ? {} : { licence: overview.licence }),
      });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = poiFilename(format, BUILD.built === 'dev' ? null : BUILD.built);
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setFailure(POI_FAIL);
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <section className="fwm-docs" aria-label="how this works">
      <header className="fwm-docs-header">
        {/* THE ONE HEADER THAT IS A COLUMN, because the lede sits under the
            title rather than beside it. So the arrow gets a row of its own
            above them both rather than the title row being turned sideways -
            it keeps the 44px circle at the same top-left corner every other
            screen puts it, and leaves the title/lede pair exactly as drawn. */}
        <div className="fwm-docs-header-nav">
          <BackKey to="more" label={BACK_TO_MORE} />
        </div>
        <ReloadTitle title={DOCS_TITLE} className="fwm-docs-title" />
        <p className="fwm-docs-lede">{DOCS_LEDE}</p>
      </header>

      {/* THE BUILD STAMP, ABOVE THE DOCUMENTS.
          It goes first because it is the fact the others depend on: without
          knowing which commit produced this bundle, "the source is public" is
          not something a reader can act on. */}
      <div className="fwm-docs-build">
        <span className="fwm-docs-build-label fwm-data">RUNNING</span>
        <span className="fwm-docs-build-line fwm-data">{buildLabel()}</span>
        <p className="fwm-docs-build-note fwm-data">
          {commit === null ? COMMIT_DEV_NOTE : COMMIT_NOTE}
        </p>
        {commit === null ? null : (
          <a
            className="fwm-docs-link"
            href={commit}
            target="_blank"
            rel="noreferrer noopener"
            data-fwm-docs-key="primary"
          >
            {`OPEN COMMIT ${BUILD.commit}`}
          </a>
        )}
      </div>

      {REPO_PUBLIC ? null : (
        <p className="fwm-docs-notice fwm-data" role="note">
          {REPO_PRIVATE_NOTE}
        </p>
      )}

      <ul className="fwm-docs-list" aria-label="documents">
        {DOC_ENTRIES.map((entry) => (
          <li key={entry.file}>
            <a
              className="fwm-docs-row"
              href={docUrl(entry.file)}
              target="_blank"
              rel="noreferrer noopener"
              data-fwm-docs-start={entry.start === true ? 'true' : undefined}
            >
              <span className="fwm-docs-row-head">
                <span className="fwm-docs-row-title">{entry.title}</span>
                {entry.start === true ? (
                  <span className="fwm-docs-row-flag fwm-data">START HERE</span>
                ) : null}
              </span>
              <span className="fwm-docs-row-sub">{entry.sub}</span>
              <span className="fwm-docs-row-file fwm-data">{entry.file}</span>
            </a>
          </li>
        ))}
      </ul>

      {/* --- integrations ------------------------------------------------- */}
      <section className="fwm-docs-integrations" aria-label="integrations">
        <h2 className="fwm-docs-section">{INTEGRATIONS_TITLE}</h2>
        <p className="fwm-docs-lede">{INTEGRATIONS_LEDE}</p>

        <div className="fwm-docs-build">
          <span className="fwm-docs-build-label fwm-data">{POI_TITLE}</span>
          <p className="fwm-docs-build-note fwm-data">{POI_BODY}</p>

          <div className="fwm-docs-formats" role="group" aria-label="file format">
            {POI_FORMATS.map((format) => (
              <button
                key={format}
                type="button"
                className="fwm-docs-link"
                data-fwm-docs-key="primary"
                disabled={busy !== null}
                onClick={() => {
                  void build(format);
                }}
              >
                {busy === format ? 'BUILDING…' : POI_FORMAT_LABEL[format]}
              </button>
            ))}
          </div>
          <p className="fwm-docs-build-note fwm-data">
            {POI_FORMAT_NOTE[POI_FORMATS[0] as PoiFormat]}
          </p>

          {/* The two things a driver needs told BEFORE they try, not after. */}
          <p className="fwm-docs-build-note fwm-data" data-fwm-docs-warn="true">
            {POI_DETECTOR_NOTE}
          </p>
          <p className="fwm-docs-build-note fwm-data">{POI_STALE_NOTE}</p>
          {failure === null ? null : (
            <p className="fwm-docs-build-note fwm-data" data-fwm-docs-warn="true">
              {failure}
            </p>
          )}
        </div>
      </section>

      <a
        className="fwm-docs-link"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer noopener"
        data-fwm-docs-key="quiet"
      >
        {REPO_LABEL}
      </a>
      <p className="fwm-docs-build-note fwm-data">{REPO_SUB}</p>
    </section>
  );
}
