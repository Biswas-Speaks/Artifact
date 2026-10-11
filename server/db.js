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
 * All alterations are idempotent ("ADD COLUMN IF NOT EXISTS").
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
      // Existing table from a different project — log and drop cascade
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

      for (const tbl of [
        'artifact_versions', 'email_tokens', 'reports',
        'images', 'files', 'artifacts', 'reset_tokens', 'users',
      ]) {
        await q(`DROP TABLE IF EXISTS ${tbl} CASCADE`);
      }
    }
  }

  // ── Users ─────────────────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      username             TEXT        UNIQUE NOT NULL,
      email                TEXT        UNIQUE NOT NULL,
      password_hash        TEXT        NOT NULL,
      full_name            TEXT        NOT NULL DEFAULT '',
      role                 TEXT        NOT NULL DEFAULT 'user',
      active               BOOLEAN     NOT NULL DEFAULT TRUE,
      must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
      email_verified       BOOLEAN     NOT NULL DEFAULT FALSE,
      trusted              BOOLEAN     NOT NULL DEFAULT FALSE,
      banned               BOOLEAN     NOT NULL DEFAULT FALSE,
      is_admin             BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at           TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Idempotent alterations for existing deployments
  const userAlterations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name            TEXT    NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role                 TEXT    NOT NULL DEFAULT 'user'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS active               BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted              BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS banned               BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin             BOOLEAN NOT NULL DEFAULT FALSE`,
  ];
  for (const sql of userAlterations) await q(sql);

  // ── Email verification tokens ─────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS email_tokens (
      token_hash  TEXT        PRIMARY KEY,
      user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL,
      used        BOOLEAN     NOT NULL DEFAULT FALSE
    )
  `);

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
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID        REFERENCES users(id) ON DELETE CASCADE,
      name           TEXT        NOT NULL,
      type           TEXT        NOT NULL,
      pages          JSONB       NOT NULL,
      css            TEXT        NOT NULL DEFAULT '',
      js             TEXT        NOT NULL DEFAULT '',
      subdomain      TEXT        UNIQUE,
      status         TEXT        NOT NULL DEFAULT 'draft',
      pw_hash        TEXT,
      review_status  TEXT        NOT NULL DEFAULT 'approved',
      live_pages     JSONB,
      live_css       TEXT,
      live_js        TEXT,
      draft_hash     TEXT,
      live_hash      TEXT,
      published_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ DEFAULT now(),
      updated_at     TIMESTAMPTZ DEFAULT now()
    )
  `);

  // Idempotent alterations for artifacts
  const artifactAlterations = [
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS review_status TEXT        NOT NULL DEFAULT 'approved'`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS live_pages    JSONB`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS live_css      TEXT`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS live_js       TEXT`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS draft_hash    TEXT`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS live_hash     TEXT`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ`,
  ];
  for (const sql of artifactAlterations) await q(sql);

  // ── Backfill: copy current pages/css/js → live_* for already-published artifacts
  await q(`
    UPDATE artifacts
    SET    live_pages   = pages,
           live_css     = css,
           live_js      = js,
           live_hash    = draft_hash,
           published_at = COALESCE(published_at, updated_at)
    WHERE  status = 'published'
      AND  live_pages IS NULL
  `);

  // ── Backfill: set review_status = 'approved' for already-published artifacts
  await q(`
    UPDATE artifacts
    SET    review_status = 'approved'
    WHERE  status = 'published'
      AND  review_status = 'pending'
  `);

  // ── Artifact versions (last 5 live snapshots) ─────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS artifact_versions (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      artifact_id  UUID        REFERENCES artifacts(id) ON DELETE CASCADE,
      pages        JSONB       NOT NULL,
      css          TEXT        NOT NULL DEFAULT '',
      js           TEXT        NOT NULL DEFAULT '',
      published_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await q(`CREATE INDEX IF NOT EXISTS artifact_versions_artifact_id_idx ON artifact_versions(artifact_id, published_at DESC)`);

  // ── Reports ───────────────────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS reports (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      artifact_id      UUID        REFERENCES artifacts(id) ON DELETE CASCADE,
      reason           TEXT        NOT NULL,
      message          TEXT        NOT NULL DEFAULT '',
      reporter_ip_hash TEXT        NOT NULL,
      created_at       TIMESTAMPTZ DEFAULT now(),
      status           TEXT        NOT NULL DEFAULT 'open'
    )
  `);
  await q(`CREATE INDEX IF NOT EXISTS reports_artifact_id_idx ON reports(artifact_id)`);

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
