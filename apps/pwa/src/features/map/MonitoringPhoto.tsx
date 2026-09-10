import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

/** Only the open inventory record requests a photo; publisher URLs stay server-side. */
export function MonitoringPhoto({ id, name, credit }: { readonly id: string; readonly name: string; readonly credit: string }): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null);
    setUnavailable(false);
    void fetch(`/api/v1/monitoring/image?id=${encodeURIComponent(id)}`, {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok || !/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Photo unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => { controller.abort(); if (objectUrl !== null) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  return <figure className="fwm-monitoring-photo">
    {unavailable ? <p role="status">Camera photo is unavailable.</p> : url === null ? <p role="status">Loading camera photo…</p>
      : <img src={url} alt={`Published camera view: ${name}`} onError={() => { setUnavailable(true); }} />}
    <figcaption>Published snapshot · capture time may differ from the inventory date. {credit}</figcaption>
  </figure>;
}
