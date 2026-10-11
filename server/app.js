/**
 * server/app.js
 * Express application factory.
 *
 * Routing order:
 *   1. Subdomain middleware  – serves published artifacts on <sub>.biswa.io
 *   2. /api/*               – REST API (JSON)
 *   3. Static files         – /public/dist  (React SPA assets)
 *   4. SPA fallback         – everything else → dist/index.html
 */

'use strict';

const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');
const sites        = require('./sites');
const api          = require('./api');

const DIST_DIR = path.join(__dirname, '../public/dist');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cookieParser());

// ── Subdomain sites (must come before static/API) ───────────────────────────
app.use(sites);

// ── REST API ────────────────────────────────────────────────────────────────
app.use('/api', express.json({ limit: '2mb' }), api);

// ── Static assets (React SPA build) ─────────────────────────────────────────
// Hashed asset files get 1-year immutable cache; HTML gets no-cache.
app.use(express.static(DIST_DIR, {
  index: false,       // SPA fallback below handles index.html
  maxAge: '1y',
  immutable: true,
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ── SPA fallback ─────────────────────────────────────────────────────────────
// All non-API, non-subdomain routes serve index.html so React Router handles them.
app.get('*', (_req, res) =>
  res.sendFile(path.join(DIST_DIR, 'index.html')));

module.exports = app;
