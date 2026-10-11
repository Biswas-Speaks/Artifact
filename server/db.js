/**
 * server/db.js
 * PostgreSQL connection pool (Neon-compatible) and schema initialiser.
 *
 * Exports:
 *   q(text, params?) → Promise<QueryResult>  — execute a parameterised query
 *   init()           → Promise<void>          — create/migrate tables on startup
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:  { rejectUnauthorized: false },
  max:  4,
  idleTimeoutMillis: 20_000,
});

pool.on('error', (err) => console.error('[db] idle client error:', err.message));

/**
 * Execute a SQL query.
 * @param {string}   text   Parameterised SQL
 * @param {any[]}   [params] Bind parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
const q = (text, params) => pool.query(text, params);

/**
 * Initialise the database schema.
 * Drops and recreates the users table if it exists with an incompatible
 * schema (i.e. missing the "username" column from a previous project).
 * All other tables cascade from users, so they are dropped too.
 * @returns {Promise<void>}
 */
async function init() {
  // ── Compatibility check ────────────────────────────────────────────────
  const { rows: [tableRow] } = await q(`SELECT to_regclass('public.users') AS t`);

  if (tableRow.t) {
    const { rows: cols } = await q(`
      SELECT column_name
      FROM   information_schema.columns
      WHERE  table_schema = 'public'
        AND  table_name   = 'users'
        AND  column_name  = 'username'
    `);

    if (cols.length === 0) {
      // Existing table from a different project — log columns and drop cascade
      const { rows: allCols } = await q(`
        SELECT column_name
        FROM   information_schema.columns
        WHERE  table_schema = 'public' AND table_name = 'users'
        ORDER  BY ordinal_position
      `);
      console.warn(
        '[db] Existing users table has incompatible schema (' +
        allCols.map((r) => r.column_name).join(', ') +
        ') — recreating…'
      );

      for (const tbl of ['images', 'files', 'artifacts', 'reset_tokens', 'users']) {
        await q(`DROP TABLE IF EXISTS ${tbl} CASCADE`);
      }
    }
  }

  // ── Users ─────────────────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      username            TEXT        UNIQUE NOT NULL,
      email               TEXT        UNIQUE NOT NULL,
      password_hash       TEXT        NOT NULL,
      full_name           TEXT        NOT NULL DEFAULT '',
      role                TEXT        NOT NULL DEFAULT 'user',
      active              BOOLEAN     NOT NULL DEFAULT TRUE,
      must_change_password BOOLEAN    NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Add columns that may be missing in older deployments
  const alterations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name            TEXT    NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role                 TEXT    NOT NULL DEFAULT 'user'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS active               BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`,
  ];
  for (const sql of alterations) await q(sql);

  // ── Reset tokens ───────────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      token_hash  TEXT        PRIMARY KEY,
      user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL
    )
  `);

  // ── Artifacts ──────────────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT        NOT NULL,
      type        TEXT        NOT NULL,
      pages       JSONB       NOT NULL,
      css         TEXT        NOT NULL DEFAULT '',
      js          TEXT        NOT NULL DEFAULT '',
      subdomain   TEXT        UNIQUE,
      status      TEXT        NOT NULL DEFAULT 'draft',
      pw_hash     TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    )
  `);

  // ── Files (Cloudflare R2) ──────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS files (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
      key         TEXT        NOT NULL,
      name        TEXT        NOT NULL,
      size        BIGINT      DEFAULT 0,
      mime        TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `);

  // ── Images (Cloudinary) ────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS images (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
      public_id   TEXT        NOT NULL,
      name        TEXT        NOT NULL,
      url         TEXT        NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `);

  console.log('[db] Tables ready');
}

// ── Readiness flag ─────────────────────────────────────────────────────────
let _ready = false;

/** Returns true once the DB has been initialised successfully. */
const isReady = () => _ready;

/** Called by server/index.js after init() + seedAdmin() succeed. */
const setReady = (v) => { _ready = v; };

module.exports = { q, init, isReady, setReady };
