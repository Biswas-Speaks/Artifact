/**
 * server/app.js
 * Express application factory.
 *
 * Routing order:
 *   1. Subdomain middleware  – serves published artifacts on <sub>.biswa.io
 *   2. /api/*               – REST API (JSON)
 *   3. Static files         – /public  (JS, CSS, images, favicon)
 *   4. SPA fallback         – everything else → index.html
 */

'use strict';

const express    = require('express');
const cookieParser = require('cookie-parser');
const path       = require('path');
const sites      = require('./sites');
const api        = require('./api');

const PUBLIC_DIR = path.join(__dirname, '../public');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cookieParser());

// ── Subdomain sites (must come before static/API) ───────────────────────────
app.use(sites);

// ── REST API ────────────────────────────────────────────────────────────────
app.use('/api', express.json({ limit: '2mb' }), api);

// ── Static assets ───────────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR, {
  index: false,       // don't auto-serve index.html (SPA fallback handles it)
  maxAge: '1h',
  etag: true,
}));

// ── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

module.exports = app;
