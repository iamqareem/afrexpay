// src/db/pool.js — one shared connection pool, every module's service imports this.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 20,          // ceiling on concurrent connections to Postgres
  idleTimeoutMillis: 30000,                              // release idle clients back after 30s
  connectionTimeoutMillis: 5000,                         // fail fast if Postgres is unreachable, rather than hanging
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err);
});

module.exports = pool;
