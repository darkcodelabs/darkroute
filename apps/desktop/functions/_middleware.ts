/**
 * The console's root, and only its root, sends a browser to the browsing app.
 *
 * `api.darkroute.ai` serves the API under `/v1`; everything else on the
 * hostname is the console itself, which is the thing a person arriving in a
 * browser wants. This exists only so the hostname is useful in both hands -
 * curl gets JSON from `/v1`, a person gets a page from `/`.
 */
export const onRequest: PagesFunction = async (context) => context.next();
