/**
 * WHO IS ASKING - verifying the Cloudflare Access identity, server-side.
 *
 * =============================================================================
 * WHY THE CLIENT CANNOT BE TRUSTED TO SAY WHO IT IS
 * =============================================================================
 * The obvious shape for "an admin page only I see" is a check in the app: read
 * the signed-in email, compare it to a list, render the screen. That is fine for
 * DECIDING WHAT TO DRAW and worthless for deciding what may be done, because
 * everything the browser knows, the browser's owner can change. A page hidden by
 * a client-side `if` is hidden the way a door is locked by a sign.
 *
 * So the client's opinion is never consulted here. Every request that manages
 * access re-derives the caller's identity from the `Cf-Access-Jwt-Assertion`
 * header that Cloudflare Access injects at the edge, verifies that token's
 * signature against Cloudflare's published keys, and reads the email out of the
 * verified payload. A request that arrives without a valid assertion is refused,
 * whatever it claims about itself.
 *
 * =============================================================================
 * WHY THE SIGNATURE IS CHECKED AND NOT JUST THE HEADER'S PRESENCE
 * =============================================================================
 * Access strips client-supplied copies of its own headers on the way in, so in
 * practice the header's presence already implies the edge put it there. Relying
 * on that is still wrong: it makes the whole authorisation rest on a header
 * filter behaving exactly as documented forever, and on nothing ever reaching
 * this Function by another path. Verifying the signature costs one cached fetch
 * of a JWKS document and removes the assumption entirely.
 *
 * Checked, in order, and all of them must hold:
 *   SIGNATURE   against the team's public keys, RS256.
 *   aud         the Access application's own audience tag. Without this, a
 *               token minted for ANY other app on the same team would be
 *               accepted here -- which is the classic way this goes wrong.
 *   exp / nbf   the token is currently valid.
 *   iss         the team domain that issued it.
 */

export interface AccessIdentity {
  readonly email: string;
  readonly sub: string;
}

interface Jwk {
  readonly kid: string;
  readonly kty: string;
  readonly alg?: string;
  readonly n: string;
  readonly e: string;
}

/** Cloudflare rotates these; a short cache keeps a rotation from locking us out. */
const JWKS_TTL_MS = 10 * 60 * 1000;
let cached: { at: number; keys: readonly Jwk[]; team: string } | null = null;

/**
 * `Uint8Array<ArrayBuffer>`, not bare `Uint8Array`.
 *
 * Modern TypeScript makes the view generic over its backing buffer, and
 * `BufferSource` -- what WebCrypto takes -- excludes `SharedArrayBuffer`. A
 * bare `Uint8Array` is `ArrayBufferLike`, which includes it, so passing one to
 * `crypto.subtle.verify` fails to typecheck for a reason that has nothing to do
 * with this code. Being explicit about the buffer says what is actually true.
 */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as Record<string, unknown>;
}

async function jwks(teamDomain: string): Promise<readonly Jwk[]> {
  const now = Date.now();
  if (cached !== null && cached.team === teamDomain && now - cached.at < JWKS_TTL_MS) {
    return cached.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`jwks: HTTP ${String(res.status)}`);
  const body = (await res.json()) as { keys?: readonly Jwk[] };
  const keys = body.keys ?? [];
  cached = { at: now, keys, team: teamDomain };
  return keys;
}

/**
 * The verified caller, or null.
 *
 * Null for every failure, deliberately, and the caller turns that into one
 * generic refusal. Telling an unauthenticated request WHICH check it failed --
 * bad signature, wrong audience, expired -- is free reconnaissance.
 */
export async function verifyAccess(
  request: Request,
  teamDomain: string,
  audience: string,
): Promise<AccessIdentity | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (token === null || teamDomain === '' || audience === '') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(rawHeader);
    payload = decodeJson(rawPayload);
  } catch {
    return null;
  }

  if (header['alg'] !== 'RS256') return null;
  const kid = typeof header['kid'] === 'string' ? header['kid'] : null;
  if (kid === null) return null;

  const key = (await jwks(teamDomain)).find((candidate) => candidate.kid === kid);
  if (key === undefined) return null;

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    base64UrlToBytes(rawSignature),
    signed,
  );
  if (!valid) return null;

  // AUDIENCE. A token minted for any other Access app on the same team is a
  // valid, correctly-signed token -- it is simply not for us. Skipping this is
  // the standard way an Access-protected admin endpoint gets opened up by a
  // completely unrelated application.
  const aud = payload['aud'];
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(audience)) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = typeof payload['exp'] === 'number' ? payload['exp'] : 0;
  const nbf = typeof payload['nbf'] === 'number' ? payload['nbf'] : 0;
  if (exp <= nowSeconds) return null;
  if (nbf > nowSeconds + 60) return null;

  // EQUALITY, NOT CONTAINMENT. This was `iss.includes(teamDomain)`, which any
  // issuer with the team domain as a SUBSTRING satisfies --
  // `https://evil-hackdev.cloudflareaccess.com.attacker.example` passes a
  // containment check and fails this one. The issuer is a known, exact string;
  // there is no reason to match it loosely.
  const iss = typeof payload['iss'] === 'string' ? payload['iss'] : '';
  if (iss !== `https://${teamDomain}`) return null;

  const email = typeof payload['email'] === 'string' ? payload['email'] : '';
  const sub = typeof payload['sub'] === 'string' ? payload['sub'] : '';
  if (email === '') return null;

  return { email: email.toLowerCase(), sub };
}

/**
 * The people who may manage access.
 *
 * A list in the environment rather than in the code: adding an administrator
 * should not be a deploy, and more importantly the list should not be readable
 * from the published bundle. Compared case-insensitively because an email
 * address is not case-sensitive in its domain and nobody types consistently.
 */
export function isAdmin(identity: AccessIdentity | null, admins: string): boolean {
  if (identity === null) return false;
  const allowed = admins
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
  return allowed.includes(identity.email);
}

/** One refusal shape for every failure. See `verifyAccess`. */
export function refuse(): Response {
  return new Response(JSON.stringify({ error: 'not authorised' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
