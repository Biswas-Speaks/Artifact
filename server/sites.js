/**
 * server/sites.js
 * Subdomain middleware — serves published artifacts on <subdomain>.BASE_DOMAIN.
 *
 * Changes from original:
 *  - Serves live_pages / live_css / live_js (not the draft copy)
 *  - Shows "pending review" page for review_status = 'pending'
 *  - Shows "removed" page for status = 'suspended'
 *  - Injects a small unobtrusive "Report" link before </body>
 *  - Adds security headers (X-Content-Type-Options, Referrer-Policy, CSP)
 *  - POST /__report forwards to the /api/report handler
 */

'use strict';

const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const { q }    = require('./db');
const C        = require('./config');

// ── HTML helpers ────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/** Minimal "info page" wrapper. */
const infoPage = (title, body) => `<!doctype html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       background:#0a0c14;color:#eef0f8;font-family:system-ui;text-align:center}
  .box{max-width:400px;padding:40px 24px}
  .icon{font-size:40px;margin-bottom:12px}
  h1{font-size:22px;margin:0 0 8px}
  p{color:#97a0b8;font-size:14px;margin:0}
</style>
</head><body><div class="box">${body}</div></body></html>`;

const pendingPage = (name) => infoPage('Under review',
  `<div class="icon">🔍</div>
   <h1>${esc(name)}</h1>
   <p>This page is currently under review and will be available shortly.</p>`
);

const suspendedPage = () => infoPage('Page removed',
  `<div class="icon">🚫</div>
   <h1>This page has been removed</h1>
   <p>It was found to violate our content guidelines.</p>`
);

/** Password gate HTML. */
const gate = (name, err) => `<!doctype html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Protected — ${esc(name)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       background:#0a0c14;color:#eef0f8;font-family:system-ui}
  form{background:#141826;border:1px solid #242a3d;border-radius:20px;
       padding:30px;width:min(340px,90vw);text-align:center}
  input,button{width:100%;padding:11px;border-radius:10px;border:1px solid #242a3d;
               font:inherit;margin-top:12px;box-sizing:border-box}
  input{background:#0a0c14;color:#fff}
  button{background:linear-gradient(135deg,#6d5df6,#e84fb0);color:#fff;
         border:0;font-weight:600;cursor:pointer}
  .e{color:#fb7185;font-size:13px;margin:8px 0 0}
</style></head><body>
<form method="post" action="/__unlock">
  <div style="font-size:36px">🔒</div>
  <h3 style="margin:6px 0 0">${esc(name)}</h3>
  <p style="color:#97a0b8;margin:4px 0 0;font-size:14px">This page is password protected</p>
  ${err ? `<p class="e">${esc(err)}</p>` : ''}
  <input type="password" name="password" placeholder="Enter password" autofocus required>
  <button type="submit">Open</button>
</form></body></html>`;

/** Report page HTML. */
const reportPage = (artifactName, siteKey, err, success) => `<!doctype html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Report — ${esc(artifactName)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       background:#0a0c14;color:#eef0f8;font-family:system-ui;padding:20px;box-sizing:border-box}
  form{background:#141826;border:1px solid #242a3d;border-radius:20px;
       padding:30px;width:min(400px,100%)}
  h2{margin:0 0 4px;font-size:18px}
  p{color:#97a0b8;font-size:13px;margin:0 0 20px}
  label{display:block;font-size:13px;margin-bottom:6px;color:#97a0b8}
  select,textarea,button{width:100%;padding:10px 12px;border-radius:10px;
    border:1px solid #242a3d;background:#0a0c14;color:#eef0f8;font:inherit;
    margin-bottom:14px;box-sizing:border-box}
  textarea{resize:vertical;min-height:80px}
  button{background:linear-gradient(135deg,#6d5df6,#e84fb0);border:0;
         font-weight:600;cursor:pointer;color:#fff}
  .e{color:#fb7185;font-size:13px;margin:-8px 0 10px}
  .ok{color:#4ade80;font-size:14px;margin:0}
  a{color:#a5b4fc}
</style>
${siteKey ? `<script src="https://challenges.cloudflare.com/turnstile/v1/api.js" async defer></script>` : ''}
</head><body>
<form method="post" action="/__report">
  <h2>Report this page</h2>
  <p>Reporting <b>${esc(artifactName)}</b>. This will be reviewed by our team.</p>
  ${success ? `<p class="ok">✓ Report submitted. Thank you.</p>` : ''}
  ${err     ? `<p class="e">${esc(err)}</p>` : ''}
  ${!success ? `
  <label for="reason">Reason</label>
  <select id="reason" name="reason" required>
    <option value="">Select a reason…</option>
    <option value="spam">Spam</option>
    <option value="phishing">Phishing / scam</option>
    <option value="malware">Malware / harmful links</option>
    <option value="misinformation">Misinformation</option>
    <option value="illegal">Illegal content</option>
    <option value="harassment">Harassment / abuse</option>
    <option value="other">Other</option>
  </select>
  <label for="msg">Additional details <span style="font-size:11px">(optional)</span></label>
  <textarea id="msg" name="message" maxlength="500" placeholder="Describe the issue…"></textarea>
  ${siteKey ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}"></div><br>` : ''}
  <button type="submit">Submit report</button>` : ''}
  <p style="margin-top:10px"><a href="/">← Back to page</a></p>
</form></body></html>`;

// ── Brute-force limiter for password unlock ─────────────────────────────────

const hits = new Map();
const tooMany = (k) => {
  const n = (hits.get(k) || 0) + 1;
  hits.set(k, n);
  setTimeout(() => hits.delete(k), 15 * 60 * 1000).unref();
  return n > 10;
};

// ── Security headers for served artifact pages ─────────────────────────────

function setArtifactHeaders(res) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Allow the artifact to frame external sites, but not the main biswa.io app.
  // The main app sets its own frame-ancestors 'self' separately.
  res.set(
    'Content-Security-Policy',
    "frame-ancestors *; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;"
  );
}

// ── Main serve function ─────────────────────────────────────────────────────

async function serve(req, res) {
  const sub = req.sub;
  if (!/^[a-z0-9-]{1,40}$/.test(sub)) return res.status(404).send('Not found');

  const { rows } = await q(
    `SELECT id, name, live_pages, live_css, live_js, pw_hash, status, review_status
     FROM   artifacts
     WHERE  subdomain = $1`,
    [sub]
  );
  const a = rows[0];

  // No published artifact at this subdomain
  if (!a) {
    return res.status(404).send(infoPage('Not found',
      `<div class="icon">🔍</div><h1>Not found</h1><p>This site is not published.</p>`
    ));
  }

  // Pending review
  if (a.review_status === 'pending') {
    return res.status(200).send(pendingPage(a.name));
  }

  // Suspended
  if (a.status === 'suspended') {
    return res.status(200).send(suspendedPage());
  }

  // Not live (unpublished or draft)
  if (a.status !== 'published' || !a.live_pages) {
    return res.status(404).send(infoPage('Not found',
      `<div class="icon">🌐</div><h1>Not published</h1><p>This site is not currently available.</p>`
    ));
  }

  // ── Password gate ─────────────────────────────────────────────────────────
  if (a.pw_hash) {
    let unlocked = false;
    try { unlocked = jwt.verify(req.cookies.ap, C.SECRET).aid === a.id; } catch { /* not unlocked */ }

    if (!unlocked && req.method === 'POST' && req.path === '/__unlock') {
      const ip = req.headers['cf-connecting-ip'] || req.ip;
      if (tooMany(ip + sub)) {
        return res.status(429).send(gate(a.name, 'Too many attempts. Try later.'));
      }
      if (await bcrypt.compare(String((req.body || {}).password || ''), a.pw_hash)) {
        res.cookie(
          'ap',
          jwt.sign({ aid: a.id }, C.SECRET, { expiresIn: '12h' }),
          { httpOnly: true, sameSite: 'lax', secure: C.COOKIE_SECURE, maxAge: 12 * 3600e3 }
        );
        return res.redirect('/');
      }
      return res.status(401).send(gate(a.name, 'Wrong password'));
    }

    if (!unlocked) return res.status(401).send(gate(a.name));
  }

  // ── Report form ────────────────────────────────────────────────────────────
  if (req.path === '/__report') {
    if (req.method === 'GET') {
      return res.send(reportPage(a.name, C.TURNSTILE_SITE_KEY, null, false));
    }
    if (req.method === 'POST') {
      // Forward to API router handler (reuse the rate limiter and logic there)
      req.artifactId = a.id;
      // Make the body available as parsed JSON for the API handler
      req.body = { ...req.body, artifactId: a.id };

      // Call the /api/report logic inline (avoids circular dependency)
      return handleReport(req, res, a);
    }
  }

  // ── Static assets ──────────────────────────────────────────────────────────
  setArtifactHeaders(res);
  res.set('Cache-Control', 'no-cache');

  const p = decodeURIComponent(req.path);

  if (p === '/style.css') return res.type('css').send(a.live_css || '');
  if (p === '/script.js') return res.type('js').send(a.live_js || '');

  // ── HTML pages ─────────────────────────────────────────────────────────────
  let name = p === '/' ? 'index.html' : p.slice(1);
  if (!name.endsWith('.html')) name += '.html';

  const page = a.live_pages.find((x) => x.n === name);
  if (!page) return res.status(404).send('Page not found');

  // Inject report link just before </body>
  const reportLink = `<div style="position:fixed;bottom:8px;right:10px;font-size:11px;opacity:.45;z-index:9999;font-family:system-ui">
<a href="/__report" style="color:inherit;text-decoration:none" rel="nofollow">Report this page</a>
</div>`;

  const html = `<!doctype html><html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(a.name)}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
${page.h}
<script src="/script.js"></script>
${reportLink}
</body></html>`;

  res.type('html').send(html);
}

// ── Inline report handler (mirrors /api/report but without Express Router) ───

const { createHmac, createHash } = require('crypto');
const hashIp = (ip) =>
  createHmac('sha256', C.IP_SALT).update(String(ip || '')).digest('hex').slice(0, 32);

async function handleReport(req, res, artifact) {
  const { reason = '', message = '', 'cf-turnstile-response': tsToken = '' } = req.body || {};

  const VALID_REASONS = ['spam', 'phishing', 'malware', 'misinformation', 'illegal', 'harassment', 'other'];
  if (!VALID_REASONS.includes(reason)) {
    return res.send(reportPage(artifact.name, C.TURNSTILE_SITE_KEY, 'Please select a reason.', false));
  }

  // Turnstile check
  if (C.TURNSTILE_SECRET) {
    const ip = req.headers['cf-connecting-ip'] || req.ip || '';
    try {
      const body = new URLSearchParams({ secret: C.TURNSTILE_SECRET, response: tsToken, remoteip: ip });
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v1/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const d = await r.json();
      if (!d.success) {
        return res.send(reportPage(artifact.name, C.TURNSTILE_SITE_KEY, 'Bot check failed. Please try again.', false));
      }
    } catch (e) {
      console.error('[turnstile] sites.js check error:', e.message);
    }
  }

  const ip     = req.headers['cf-connecting-ip'] || req.ip || '';
  const ipHash = hashIp(ip);

  try {
    await q(
      `INSERT INTO reports (artifact_id, reason, message, reporter_ip_hash)
       VALUES ($1, $2, $3, $4)`,
      [artifact.id, reason, String(message).slice(0, 500), ipHash]
    );

    // Count distinct IPs
    const { rows } = await q(
      `SELECT COUNT(DISTINCT reporter_ip_hash) AS n
       FROM   reports WHERE artifact_id = $1 AND status = 'open'`,
      [artifact.id]
    );
    if (Number(rows[0].n) >= 3) {
      await q(
        `UPDATE artifacts SET status = 'suspended' WHERE id = $1 AND status != 'suspended'`,
        [artifact.id]
      );
    }

    // Notify admin
    if (C.ADMIN_EMAIL) {
      const mail = require('./mail');
      mail.send(
        C.ADMIN_EMAIL,
        `Report received: ${artifact.name} — Biswa Artifacts`,
        `<p>New report: <b>${artifact.name}</b><br>Reason: ${reason}</p>
         <p><a href="${C.SITE_URL}/admin">Review →</a></p>`
      ).catch((e) => console.error('[mail] report notify:', e.message));
    }
  } catch (e) {
    console.error('[sites] report insert error:', e.message);
    return res.send(reportPage(artifact.name, C.TURNSTILE_SITE_KEY, 'An error occurred. Please try again.', false));
  }

  return res.send(reportPage(artifact.name, C.TURNSTILE_SITE_KEY, null, true));
}

// ── Middleware export ───────────────────────────────────────────────────────

const { isReady } = require('./db');

module.exports = (req, res, next) => {
  const host = req.hostname.toLowerCase();
  if (host === C.BASE || host === 'www.' + C.BASE || !host.endsWith('.' + C.BASE)) return next();

  req.sub = host.slice(0, -(C.BASE.length + 1));

  // Return a friendly page if the DB hasn't connected yet
  if (!isReady()) {
    return res.status(503).send(infoPage('Starting up',
      `<div class="icon">⏳</div><h1>Starting up</h1><p>The server is connecting to the database. Please try again in a moment.</p>`
    ));
  }

  // Parse URL-encoded body for password unlock and report form submissions
  express.urlencoded({ extended: false, limit: '4kb' })(req, res, () =>
    serve(req, res).catch((e) => {
      console.error('[sites] error:', e);
      res.status(500).send('Server error');
    })
  );
};
