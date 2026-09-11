// SPDX-License-Identifier: MIT
/**
 * CORS helpers for the buyer-facing endpoints (/health, /v1/profiles/query)
 * that external AI agents call directly, from arbitrary origins — unlike
 * the wallet-owner routes (/v1/wallets/**), which are only ever called
 * same-origin by this project's own dashboard now that frontend and
 * backend are merged, so they intentionally do NOT get permissive CORS
 * headers (a small security improvement over the original standalone
 * backend, which applied wide-open CORS to every route).
 */
import { CORS_ORIGIN } from "./singletons";

export function withCors(response: Response): Response {
  response.headers.set("access-control-allow-origin", CORS_ORIGIN);
  response.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type, x-payment");
  return response;
}

export function corsPreflightResponse(): Response {
  return withCors(new Response(null, { status: 204 }));
}
