// SPDX-License-Identifier: MIT
/**
 * Wallet-ownership authentication for every /v1/wallets/:address/* route.
 *
 * Before this module existed, every one of those routes trusted the
 * `:address` URL segment as given — anyone who knew a wallet address
 * could read or change that wallet's data controls, see its earnings, or
 * even delete its profile. See the project README's "Security" section,
 * item #2 (now resolved by this module) for that history.
 *
 * The proof of ownership is a standard signed-message challenge: the
 * client asks the wallet to `personal_sign` a short, human-readable
 * message (src/shared/authMessage.ts) naming the address and a
 * timestamp; a valid signature over that exact message recovering to the
 * claimed address is only producible by whoever holds that address's
 * private key. See src/lib/walletProviders.ts's signInWithWallet() for
 * the client side, and POST /v1/auth/verify for where this gets called.
 *
 * SESSION MECHANISM — stateless, httpOnly cookie:
 * Requiring a fresh signature on every single request would mean a
 * wallet popup on every dashboard action, which is unusable. Instead,
 * one successful verification issues a session: an httpOnly cookie
 * (invisible to page JavaScript, so an XSS bug elsewhere on the page
 * can't just read it and impersonate the user) whose value is
 * `${address}.${expiresAt}.${hmac}` — an HMAC-SHA256 over the address +
 * expiry, keyed by a server-only secret (HAZE_SESSION_SECRET). Verifying
 * a session is just recomputing that HMAC and comparing — no database
 * lookup, no shared state between serverless instances to keep
 * consistent (a lesson learned the hard way earlier in this project: see
 * singletons.ts's persistence comment for the same class of bug in a
 * different subsystem). The tradeoff that comes with statelessness:
 * there's no server-side revocation list, so "sign out" can only clear
 * the cookie in the browser that has it — a session token that somehow
 * leaked elsewhere would remain cryptographically valid until it
 * naturally expires (24h). Acceptable for this project's stage; revisit
 * with a real session store if that ever needs to change.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "viem";
import { buildSignInMessage, SIGN_IN_MESSAGE_MAX_AGE_MS } from "../../shared/authMessage";

const SESSION_COOKIE_NAME = "haze_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function resolveSessionSecret(): string {
  const fromEnv = process.env["HAZE_SESSION_SECRET"];
  if (fromEnv) return fromEnv;

  if (process.env["NODE_ENV"] !== "production") {
    // Fine for a single local `npm run dev` process — there's only ever
    // one instance to be consistent with. Never reached in production;
    // see the throw below for why that path is fatal instead of doing
    // the equivalent thing there.
    return "dev-only-insecure-session-secret-do-not-use-in-production";
  }

  // Deliberately fatal rather than silently falling back to a random
  // per-process secret: on Vercel that would mean every serverless
  // instance mints/verifies sessions with a DIFFERENT secret, so a
  // session cookie set by one instance would fail verification against
  // another — the exact same per-instance-inconsistency bug class that
  // broke wallet persistence earlier in this project, just relocated
  // from storage to auth. Failing loudly at first use beats shipping
  // something that "mostly works" depending on which instance you hit.
  throw new Error(
    "HAZE_SESSION_SECRET is not set. Set it in Vercel's Project Settings -> Environment Variables " +
      "(any long random string, e.g. `openssl rand -hex 32`) before wallet sign-in can work in production.",
  );
}

function signPayload(payload: string): string {
  return createHmac("sha256", resolveSessionSecret()).update(payload).digest("base64url");
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, and a length check up front leaks only the length, not which
  // byte differs — the same tradeoff every timing-safe-compare wrapper
  // makes.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function cookieAttributes(maxAgeSeconds: number): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

/** Set-Cookie header value for a fresh 24h session on `address`. */
export function createSessionCookie(address: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${address.toLowerCase()}.${expiresAt}`;
  const token = `${payload}.${signPayload(payload)}`;
  return `${SESSION_COOKIE_NAME}=${token}; ${cookieAttributes(Math.floor(SESSION_TTL_MS / 1000))}`;
}

/** Set-Cookie header value that immediately expires the session cookie (sign-out). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes(0)}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/** True if `request` carries a still-valid session cookie for `address`. */
export function hasValidSession(request: Request, address: string): boolean {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenAddress, expiresAtStr, signature] = parts as [string, string, string];

  const expected = signPayload(`${tokenAddress}.${expiresAtStr}`);
  if (!timingSafeEqualStrings(signature, expected)) return false;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  return tokenAddress === address.toLowerCase();
}

/**
 * The actual security boundary. Call this first in every
 * /v1/wallets/:address/* route handler (POST /v1/auth/verify itself and
 * its logout counterpart are the only wallet-related routes that don't)
 * and return its result immediately when non-null.
 */
export function requireWalletSession(request: Request, address: string): Response | null {
  if (hasValidSession(request, address)) return null;
  return Response.json(
    { error: "unauthenticated", message: "sign in with this wallet first — see POST /v1/auth/verify" },
    { status: 401 },
  );
}

/**
 * Verifies a client-submitted {address, issuedAt, signature} against the
 * message this server would have asked that address to sign. The
 * message is rebuilt here from `address` + `issuedAt` rather than trusted
 * as given from the client — see shared/authMessage.ts's doc comment.
 */
export async function verifySignIn(address: string, issuedAt: string, signature: string): Promise<boolean> {
  const issuedAtMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedAtMs)) return false;

  const ageMs = Date.now() - issuedAtMs;
  if (ageMs < 0 || ageMs > SIGN_IN_MESSAGE_MAX_AGE_MS) return false; // too old, or clock-skewed into the future

  const message = buildSignInMessage(address, issuedAt);
  try {
    return await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
