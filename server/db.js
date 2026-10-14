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

const q = (text, params) => pool.query(text, params);

async function init() {
  // ── Compatibility check ────────────────────────────────────────────────
  const { rows: [tableRow] } = await q(`SELECT to_regclass('public.users') AS t`);

  if (tableRow.t) {
    const { rows: cols } = await q(`
      SELECT column_name FROM information_schema.columns
      WHERE  table_schema='public' AND table_name='users' AND column_name='username'
    `);
    if (cols.length === 0) {
      const { rows: allCols } = await q(`
        SELECT column_name FROM information_schema.columns
        WHERE  table_schema='public' AND table_name='users' ORDER BY ordinal_position
      `);
      console.warn('[db] Incompatible users schema (' + allCols.map(r => r.column_name).join(', ') + ') — recreating…');
      for (const tbl of [
        'ai_messages','artifact_versions','user_ai_settings',
        'email_tokens','reports','images','files','artifacts','reset_tokens','users',
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
  for (const sql of [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name            TEXT    NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role                 TEXT    NOT NULL DEFAULT 'user'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS active               BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted              BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS banned               BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin             BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS max_published    INTEGER`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS max_artifacts    INTEGER`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS max_storage_mb   INTEGER`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS max_images       INTEGER`,
  ]) await q(sql);

  // ── Email tokens ──────────────────────────────────────────────────────
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
  for (const sql of [
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS review_status TEXT        NOT NULL DEFAULT 'approved'`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS live_pages    JSONB`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS live_css      TEXT`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS live_js       TEXT`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS draft_hash    TEXT`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS live_hash     TEXT`,
    `ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ`,
  ]) await q(sql);

  await q(`
    UPDATE artifacts SET live_pages=pages, live_css=css, live_js=js,
           live_hash=draft_hash, published_at=COALESCE(published_at,updated_at)
    WHERE  status='published' AND live_pages IS NULL
  `);
  await q(`UPDATE artifacts SET review_status='approved' WHERE status='published' AND review_status='pending'`);

  // ── Artifact versions — extended with AI fields ────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS artifact_versions (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      artifact_id  UUID        REFERENCES artifacts(id) ON DELETE CASCADE,
      pages        JSONB       NOT NULL,
      css          TEXT        NOT NULL DEFAULT '',
      js           TEXT        NOT NULL DEFAULT '',
      source       TEXT        NOT NULL DEFAULT 'manual',
      prompt       TEXT,
      size_bytes   INTEGER     NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  for (const sql of [
    `ALTER TABLE artifact_versions ADD COLUMN IF NOT EXISTS source       TEXT    NOT NULL DEFAULT 'manual'`,
    `ALTER TABLE artifact_versions ADD COLUMN IF NOT EXISTS prompt       TEXT`,
    `ALTER TABLE artifact_versions ADD COLUMN IF NOT EXISTS size_bytes   INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE artifact_versions ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ NOT NULL DEFAULT now()`,
  ]) await q(sql);
  await q(`CREATE INDEX IF NOT EXISTS artifact_versions_artifact_id_idx ON artifact_versions(artifact_id, created_at DESC)`);

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

  // ── Files (Cloudflare R2) — add status column ──────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS files (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
      key         TEXT        NOT NULL,
      name        TEXT        NOT NULL,
      size        BIGINT      DEFAULT 0,
      mime        TEXT,
      confirmed   BOOLEAN     NOT NULL DEFAULT TRUE,
      status      TEXT        NOT NULL DEFAULT 'ready',
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `);
  await q(`ALTER TABLE files ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT TRUE`);
  await q(`ALTER TABLE files ADD COLUMN IF NOT EXISTS status    TEXT    NOT NULL DEFAULT 'ready'`);
  // Backfill existing rows
  await q(`UPDATE files SET status='ready'   WHERE confirmed=TRUE  AND (status IS NULL OR status='')`);
  await q(`UPDATE files SET status='pending' WHERE confirmed=FALSE AND (status IS NULL OR status='')`);

  // ── Images (Cloudinary) — add bytes column ─────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS images (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
      public_id   TEXT        NOT NULL,
      name        TEXT        NOT NULL,
      url         TEXT        NOT NULL,
      bytes       BIGINT      NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `);
  await q(`ALTER TABLE images ADD COLUMN IF NOT EXISTS bytes BIGINT NOT NULL DEFAULT 0`);

  // ── User AI settings (BYOK) ────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS user_ai_settings (
      user_id       UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider      TEXT        NOT NULL,
      model         TEXT        NOT NULL,
      key_cipher    TEXT        NOT NULL,
      key_iv        TEXT        NOT NULL,
      key_tag       TEXT        NOT NULL,
      key_last4     TEXT        NOT NULL DEFAULT '',
      key_version   INTEGER     NOT NULL DEFAULT 1,
      status        TEXT        NOT NULL DEFAULT 'verified',
      verified_at   TIMESTAMPTZ,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // ── AI messages (prompts + assistant notes only — never keys) ──────────
  await q(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      artifact_id  UUID        REFERENCES artifacts(id) ON DELETE CASCADE,
      role         TEXT        NOT NULL,
      content      TEXT        NOT NULL,
      version_id   UUID,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await q(`CREATE INDEX IF NOT EXISTS ai_messages_artifact_id_idx ON ai_messages(artifact_id, created_at ASC)`);

  console.log('[db] Tables ready');
}

let _ready = false;
const isReady  = () => _ready;
const setReady = (v) => { _ready = v; };

module.exports = { q, init, isReady, setReady };
