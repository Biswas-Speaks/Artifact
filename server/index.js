/**
 * server/index.js
 * Application entry point.
 *
 * Startup sequence:
 *   1. Validate required environment variables
 *   2. Initialise database schema
 *   3. Seed the admin account (first run only)
 *   4. Start the HTTP server
 */

'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const C      = require('./config');
const { init, q } = require('./db');

// ── Environment validation ─────────────────────────────────────────────────
if (!C.SECRET || C.SECRET.length < 16) {
  console.error('[startup] JWT_SECRET must be at least 16 characters. Set it in .env');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('[startup] DATABASE_URL is required. Set it in .env');
  process.exit(1);
}

// ── Admin seed ─────────────────────────────────────────────────────────────
/**
 * Create the default admin account on first run.
 * Skips silently if the account already exists or if the schema is
 * not yet in the expected shape.
 * @returns {Promise<void>}
 */
async function seedAdmin() {
  // Confirm the users table has the expected username column
  const { rows: schemaCols } = await q(`
    SELECT column_name
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'users'
      AND  column_name  = 'username'
  `);

  if (schemaCols.length === 0) {
    console.error('[startup] users table is missing "username" column after init — check db.js');
    return;
  }

  // Idempotent — do nothing if the admin already exists
  const { rows } = await q(`SELECT id FROM users WHERE username = 'biswas'`);
  if (rows.length > 0) return;

  const hash = await bcrypt.hash('Biswas@2026', 10);
  await q(
    `INSERT INTO users (username, email, password_hash, full_name, role, active, must_change_password)
     VALUES ($1, $2, $3, $4, 'admin', TRUE, FALSE)`,
    ['biswas', 'Biswajitshial@outlook.com', hash, 'Biswas']
  );

  console.log('[startup] Admin account created — username: biswas');
}

// ── Boot ───────────────────────────────────────────────────────────────────
init()
  .then(seedAdmin)
  .then(() => {
    const app  = require('./app');
    const host = C.PROD ? '0.0.0.0' : '127.0.0.1';

    app.listen(C.PORT, host, () => {
      console.log(`[startup] Biswa Artifacts running on http://${host}:${C.PORT}  (base domain: ${C.BASE})`);
    });
  })
  .catch((err) => {
    console.error('[startup] Fatal error:', err.message);
    process.exit(1);
  });
