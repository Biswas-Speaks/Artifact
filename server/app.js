/**
 * server/app.js
 * Express application factory.
 *
 * Routing order:
 *   1. Subdomain middleware  – serves published artifacts on <sub>.biswa.io
 *   2. GET /verify           – email verification (redirect to SPA with result)
 *   3. /api/*                – REST API (JSON)
 *   4. Static files          – /public/dist  (React SPA assets)
 *   5. SPA fallback          – everything else → dist/index.html
 */

'use strict';

const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');
const crypto       = require('crypto');
const sites        = require('./sites');
const api          = require('./api');
const { q, isReady } = require('./db');

const DIST_DIR = path.join(__dirname, '../public/dist');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ── Security headers for the main app ──────────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Prevent the main app from being framed by other origins
  res.set('Content-Security-Policy', "frame-ancestors 'self'");
  next();
});

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cookieParser());

// ── Subdomain sites (must come before static/API) ───────────────────────────
app.use(sites);

// ── Email verification redirect ─────────────────────────────────────────────
// The user clicks the link in their email → this route verifies the token
// and redirects them to the SPA with a success/failure flag.
app.get('/verify', express.json({ limit: '1kb' }), async (req, res) => {
  const token = String(req.query.token || '');

  if (!token || !isReady()) {
    return res.redirect('/?verified=fail');
  }

  try {
    const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

    const { rows } = await q(
      `SELECT user_id FROM email_tokens
       WHERE  token_hash = $1 AND expires_at > now() AND used = FALSE`,
      [sha256(token)]
    );

    if (!rows[0]) return res.redirect('/?verified=fail');

    await q('UPDATE email_tokens SET used = TRUE WHERE token_hash = $1', [sha256(token)]);
    await q('UPDATE users SET email_verified = TRUE WHERE id = $1', [rows[0].user_id]);

    res.redirect('/?verified=ok');
  } catch (err) {
    console.error('[verify] error:', err.message);
    res.redirect('/?verified=fail');
  }
});

// ── REST API ────────────────────────────────────────────────────────────────
app.use('/api', express.json({ limit: '2mb' }), api);

// ── Static assets (React SPA build) ─────────────────────────────────────────
app.use(express.static(DIST_DIR, {
  index: false,
  maxAge: '1d',
  immutable: false,
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      // Revalidate every visit — ETag ensures no re-download if unchanged
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
  },
}));

// ── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (_req, res) =>
  res.sendFile(path.join(DIST_DIR, 'index.html')));

module.exports = app;
