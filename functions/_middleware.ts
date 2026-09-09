/**
 * A DESK GETS THE CONSOLE; A PHONE GETS THE APP.
 *
 * "If a user visits darkroute.ai from their browser it should serve them
 * api.darkroute.ai for the desktop experience" -- owner, 2026-09-09. The
 * driving app is a phone surface: dock, alerts, drive states, glass. On a
 * 1600 px window with a pointer it is a phone in a picture frame, and the
 * console exists precisely so a desk reads the same archive without
 * pretending to be a phone.
 *
 * WHAT IS REDIRECTED, AND WHAT IS NOT. Only a GET of `/` that asks for HTML
 * from a browser that does not say it is mobile. Everything else passes
 * through untouched: every `/api/v1/*` and `/cameras/*` request, every asset,
 * every deep link -- `?screen=`, `?camera=` -- because a link into the app is
 * a request for the app wherever it is opened. `?app` is the explicit way to
 * ask for the app on a desk (the console's own key sends it), and it is
 * remembered in a cookie so the next plain visit is not bounced again.
 *
 * MOBILE IS DECIDED BY THE CLIENT'S OWN HINT FIRST. `sec-ch-ua-mobile: ?1` is
 * Chromium saying so; the user-agent regex is the fallback for everything
 * else. iPadOS reports itself as Macintosh and gets the console, which is
 * what a tablet with a keyboard should get; a tablet that wants the app has
 * `?app`.
 *
 * `vary: user-agent` and `cache-control: no-store` on the redirect, so an
 * edge cache cannot hand a phone a desk's answer.
 */

export const CONSOLE_URL = 'https://api.darkroute.ai/';
export const SURFACE_COOKIE = 'darkroute-surface';

const MOBILE_UA = /Mobi|Android|iPhone|iPod|Windows Phone|Silk|Kindle|webOS|BlackBerry|Opera Mini/iu;

/** Whether this request is a desk asking for the front door. */
export function wantsConsole(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const url = new URL(request.url);
  if (url.pathname !== '/') return false;
  /* `src=pwa` is the manifest's start_url: an installed app opening itself. */
  for (const key of ['app', 'screen', 'camera', 'source', 'src']) {
    if (url.searchParams.has(key)) return false;
  }
  const accept = request.headers.get('accept') ?? '';
  if (!accept.includes('text/html')) return false;
  const cookie = request.headers.get('cookie') ?? '';
  if (new RegExp(`(?:^|;\\s*)${SURFACE_COOKIE}=app(?:;|$)`, 'u').test(cookie)) return false;
  const hint = request.headers.get('sec-ch-ua-mobile');
  if (hint !== null) return hint.trim() !== '?1';
  const agent = request.headers.get('user-agent') ?? '';
  if (agent === '') return false;
  return !MOBILE_UA.test(agent);
}

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;
  const url = new URL(request.url);

  if (url.pathname === '/' && url.searchParams.has('app')) {
    /* A desk that asked for the app gets it, and is remembered. */
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.append(
      'set-cookie',
      `${SURFACE_COOKIE}=app; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (wantsConsole(request)) {
    return new Response(null, {
      status: 302,
      headers: {
        location: CONSOLE_URL,
        vary: 'user-agent, sec-ch-ua-mobile, cookie',
        'cache-control': 'no-store',
      },
    });
  }

  return context.next();
};
