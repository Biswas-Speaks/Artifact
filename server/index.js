/**
 * server/index.js
 * Application entry point.
 *
 * Startup sequence:
 *   1. Validate required environment variables
 *   2. Start HTTP server immediately (so the homepage loads right away)
 *   3. Connect to DB and seed admin in the background
 *   4. Mark DB as ready once connected — API routes become fully functional
 */

'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const C      = require('./config');
const db     = require('./db');

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
async function seedAdmin() {
  const { rows: schemaCols } = await db.q(`
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

  const { rows } = await db.q(`SELECT id FROM users WHERE username = 'biswas'`);
  if (rows.length > 0) return;

  const hash = await bcrypt.hash('Biswas@2026', 10);
  await db.q(
    `INSERT INTO users (username, email, password_hash, full_name, role, active, must_change_password)
     VALUES ($1, $2, $3, $4, 'admin', TRUE, FALSE)`,
    ['biswas', 'Biswajitshial@outlook.com', hash, 'Biswas']
  );

  console.log('[startup] Admin account created — username: biswas');
}

// ── Start HTTP server immediately ──────────────────────────────────────────
const app  = require('./app');
const host = C.PROD ? '0.0.0.0' : '127.0.0.1';

app.listen(C.PORT, host, () => {
  console.log(`[startup] Biswa Artifacts running on http://${host}:${C.PORT}  (base domain: ${C.BASE})`);
  console.log('[startup] Connecting to database in background…');
});

// ── Connect DB in background (non-blocking) ────────────────────────────────
(async () => {
  let retries = 0;
  const MAX_RETRIES = 10;
  const RETRY_DELAY_MS = 5000;

  while (retries < MAX_RETRIES) {
    try {
      await db.init();
      await seedAdmin();
      db.setReady(true);
      console.log('[startup] Database ready — all API routes active');
      return;
    } catch (err) {
      retries++;
      console.warn(`[startup] DB connection failed (attempt ${retries}/${MAX_RETRIES}): ${err.message}`);
      if (retries < MAX_RETRIES) {
        console.warn(`[startup] Retrying in ${RETRY_DELAY_MS / 1000}s…`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        console.error('[startup] Could not connect to database after all retries. API routes requiring DB will return 503.');
      }
    }
  }
})();
