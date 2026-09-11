// SPDX-License-Identifier: MIT
/**
 * Postgres-backed persistence for ProfileStore / SplitterSimulator /
 * ActivityLog — the fix for the "wallet data disappears on Vercel" bug
 * described at length in singletons.ts's doc comment: those three
 * classes used to be plain in-memory Maps/arrays, which is NOT durable
 * across Vercel serverless function instances. A wallet registered via
 * POST /v1/wallets/import on one instance was invisible to a GET
 * .../profile that happened to land on a different (or later, cold)
 * instance — reproduced live on tryhazefi.com: import succeeded, then
 * five straight profile reads all 404'd.
 *
 * This module is the one place that decides whether the DB-backed path
 * is even active. Local dev keeps working with zero setup (falls back to
 * the original in-memory behavior) — Postgres only turns on once a
 * connection string is actually present, which on Vercel means attaching
 * a Postgres storage integration in the project dashboard. Every table
 * below is created lazily and idempotently on first use (CREATE TABLE IF
 * NOT EXISTS), so there's no separate migration step to remember to run.
 *
 * ---------------------------------------------------------------------
 * CLIENT LIBRARY — this database is Supabase, not Neon. Read this before
 * "fixing" this file again.
 * ---------------------------------------------------------------------
 * This project's attached database is a Supabase Postgres instance
 * (reached via Vercel's Supabase marketplace integration — confirmed by
 * the project owner directly; the Vercel dashboard just labels the
 * integration "Postgres" either way, which is what caused the original
 * confusion). It used to be wired up with `@vercel/postgres`, which
 * looked like the obviously-correct choice given the name — but that
 * package's `sql`/`createPool` are thin wrappers around
 * `@neondatabase/serverless`, which does NOT speak normal Postgres wire
 * protocol at all: it ships its own HTTP-over-fetch SQL protocol that
 * only Neon's own servers implement. Pointed at Supabase, every query
 * failed the same way regardless of how correct the connection string
 * was: `NeonDbError: Error connecting to database: fetch failed`
 * (reproduced live via a temporary /health diagnostic on tryhazefi.com).
 * No connection-string fix could ever have solved that — the transport
 * itself doesn't exist on the other end.
 *
 * The fix is this module now uses `postgres` (aka "postgres.js"), a
 * standard TCP-based Postgres client with no provider lock-in — it talks
 * real Postgres wire protocol, which every Postgres host (Supabase
 * included) supports. It connects through Supabase's Supavisor pooler
 * (the same POSTGRES_URL env var Vercel's integration already sets), and
 * `{ prepare: false }` below is required for that: Supavisor's
 * "transaction pooling" mode (the serverless-friendly one, and the one
 * Vercel's pooled connection string uses) hands out a different backend
 * connection per query, so server-side prepared statements — which
 * postgres.js uses by default for speed — can't be relied on to survive
 * from one query to the next. Disabling them trades a small amount of
 * per-query overhead for correctness under pooling, which is the right
 * trade for a serverless function that only runs a handful of queries
 * per invocation anyway.
 *
 * postgres.js's tagged-template call resolves to an array-like `Result`
 * (the rows themselves, plus a `.count`) rather than @vercel/postgres's
 * `{rows, rowCount}` shape. Rather than touch every call site in
 * store.ts / splitterSimulator.ts / activityLog.ts (which were written
 * against the `{rows, rowCount}` shape), `sqlTag` below adapts
 * postgres.js's return value into that same shape, so those three files
 * did not need to change across this rewrite.
 *
 * Env var name note: resolveConnectionString() checks every name
 * Vercel's various Postgres integrations have used, since which one(s)
 * get set depends on which integration (and when) it was attached
 * through.
 */

import postgres from "postgres";

/** Checks every env var name a Vercel Postgres integration has used — see the module comment above. */
function resolveConnectionString(): string | undefined {
  return (
    process.env["POSTGRES_URL"] ||
    process.env["POSTGRES_URL_NON_POOLING"] ||
    process.env["DATABASE_URL"] ||
    process.env["DATABASE_URL_UNPOOLED"]
  );
}

/** True once a Postgres connection string is actually present in the environment. */
export function isDatabaseConfigured(): boolean {
  return Boolean(resolveConnectionString());
}

/**
 * The shape every DB-backed method in store.ts / splitterSimulator.ts /
 * activityLog.ts expects back from a query — matches @vercel/postgres's
 * QueryResult, which is what those files were originally written
 * against (see the module comment above for why this project keeps that
 * shape instead of adopting postgres.js's native return type).
 */
export interface QueryResultShape<T> {
  rows: T[];
  rowCount: number;
}

/** Callable the same way @vercel/postgres's `sql` tag was: `` await sql`SELECT ...` ``. */
export type SqlTag = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<QueryResultShape<T>>;

let client: ReturnType<typeof postgres> | null = null;
function getClient(): ReturnType<typeof postgres> {
  if (!client) {
    const connectionString = resolveConnectionString();
    if (!connectionString) {
      throw new Error(
        "getClient() called with no Postgres connection string configured — callers must check isDatabaseConfigured() first",
      );
    }
    client = postgres(connectionString, {
      // Required under Supavisor's transaction-pooling mode — see the
      // module comment above.
      prepare: false,
      // Supabase requires TLS. "require" encrypts the connection without
      // verifying the server certificate against a CA bundle — the same
      // level `sslmode=require` gives libpq, and the standard choice for
      // a serverless function that doesn't ship a custom CA bundle.
      ssl: "require",
    });
  }
  return client;
}

/** Adapts postgres.js's array-like `Result` (rows + `.count`) into the `{rows, rowCount}` shape this project's query call sites expect — see the module comment above. */
const sqlTag: SqlTag = async (strings, ...values) => {
  const result = await getClient()(strings, ...values);
  return { rows: [...result] as unknown[], rowCount: result.count } as QueryResultShape<never>;
};

let schemaReady: Promise<void> | null = null;

/**
 * Creates every table this project needs, if they don't already exist.
 * Memoized per process/instance so repeated calls (one per request, from
 * every DB-backed method below) don't re-run the DDL every time — but
 * it's still safe if two cold instances race to run it simultaneously,
 * since every statement is idempotent (`IF NOT EXISTS`).
 */
async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = sqlTag;
      await sql`
        CREATE TABLE IF NOT EXISTS wallet_profiles (
          wallet_address TEXT PRIMARY KEY,
          profile_id TEXT UNIQUE NOT NULL,
          fingerprint JSONB NOT NULL,
          weight DOUBLE PRECISION NOT NULL,
          excluded_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
          synthetic BOOLEAN NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS splitter_deposits (
          id BIGSERIAL PRIMARY KEY,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          amount_usdc DOUBLE PRECISION NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS splitter_claims (
          wallet_address TEXT PRIMARY KEY,
          claimed_usdc DOUBLE PRECISION NOT NULL DEFAULT 0
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS activity_events (
          id BIGSERIAL PRIMARY KEY,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          buyer_type TEXT NOT NULL,
          price_usdc DOUBLE PRECISION NOT NULL,
          included_wallets JSONB NOT NULL
        )
      `;
      // GIN index makes ActivityLog.forWallet()'s JSONB containment lookup
      // (`included_wallets @> '["0x..."]'`) fast even once this table has
      // real query volume, instead of a full sequential scan per lookup.
      await sql`CREATE INDEX IF NOT EXISTS activity_events_included_wallets_idx ON activity_events USING GIN (included_wallets)`;
    })();
  }
  return schemaReady;
}

/**
 * Resolves to the `sql` tagged-template query function once the schema is
 * confirmed to exist. Every Postgres-backed method in store.ts /
 * splitterSimulator.ts / activityLog.ts calls this first instead of
 * importing `sql` directly, so none of them can run a query against
 * tables that don't exist yet.
 */
export async function getSql(): Promise<SqlTag> {
  await ensureSchema();
  return sqlTag;
}
