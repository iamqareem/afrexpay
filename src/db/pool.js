// src/db/pool.js — one shared connection pool, every module's service imports this.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 20,          // ceiling on concurrent connections to Postgres
  idleTimeoutMillis: 30000,                              // release idle clients back after 30s
  connectionTimeoutMillis: 5000,                         // fail fast if Postgres is unreachable, rather than hanging
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 30000, // kill runaway queries before they exhaust the pool
  // Managed Postgres (Neon/Supabase/RDS) with sslmode=require fails with a
  // cryptic TLS error otherwise. Opt-in via PGSSL=require (self-signed /
  // pooler certs skip verification — same tradeoff as psql sslmode=require
  // without a root cert, and documented in .env.example).
  ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err);
});

module.exports = pool;
