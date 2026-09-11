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
 * a Postgres/Neon storage integration in the project dashboard (Storage
 * tab -> Create Database -> Postgres). That integration auto-injects
 * POSTGRES_URL (and friends) as project env vars; nothing else to
 * configure. Every table below is created lazily and idempotently on
 * first use (CREATE TABLE IF NOT EXISTS), so there's no separate
 * migration step to remember to run.
 */

import { sql } from "@vercel/postgres";

/** True once a Postgres connection string is actually present in the environment. */
export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env["POSTGRES_URL"] ||
      process.env["POSTGRES_URL_NON_POOLING"] ||
      process.env["DATABASE_URL"],
  );
}

type SqlTag = typeof sql;

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
  return sql;
}
