/**
 * server/api.js
 * REST API router — mounted at /api by server/app.js.
 *
 * Sections:
 *   Auth          POST /auth/login  /auth/logout  /auth/signup  /auth/forgot  /auth/reset
 *   Verification  POST /auth/resend-verification
 *   Session       GET  /me          GET /config
 *   Subdomains    GET  /subdomain-check
 *   Artifacts     CRUD + publish / unpublish / versions / revert
 *   Files         Cloudflare R2 presigned-URL upload flow
 *   Images        Cloudinary direct upload
 *   Settings      Profile + password change
 *   Admin         User management + artifact moderation + reports
 */

'use strict';

const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const multer     = require('multer');
const rateLimit  = require('express-rate-limit');
const cloudinary = require('cloudinary').v2;

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const { q, isReady }             = require('./db');
const C                          = require('./config');
const mail                       = require('./mail');
const TPL                        = require('./templates');
const { validateSubdomain }      = require('./names');

const router = express.Router();

// ── Shared helpers ──────────────────────────────────────────────────────────

const wrap        = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const badRequest  = (res, msg, code = 400) => res.status(code).json({ error: msg });
const UUID_RE     = /^[0-9a-f-]{36}$/i;
const sha256      = (s) => crypto.createHash('sha256').update(s).digest('hex');
const requireUUID = (req, res, next) =>
  UUID_RE.test(req.params.id) ? next() : badRequest(res, 'Invalid id', 404);

/** Escape HTML entities in a string (for injecting user content into HTML). */
const esc = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/** One-way hash of an IP address with our secret salt. Never store raw IPs. */
const hashIp = (ip) =>
  crypto.createHmac('sha256', C.IP_SALT).update(String(ip || '')).digest('hex').slice(0, 32);

/** Middleware: reject requests that need the DB when it isn't ready yet. */
const requireDB = (_req, res, next) => {
  if (isReady()) return next();
  res.status(503).json({ error: 'Database not ready yet. Please try again shortly.' });
};

// ── Auth middleware ─────────────────────────────────────────────────────────

const requireAuth = (req, res, next) => {
  try {
    req.uid = jwt.verify(req.cookies.sid, C.SECRET).uid;
    next();
  } catch {
    badRequest(res, 'Not signed in', 401);
  }
};

const requireAdmin = wrap(async (req, res, next) => {
  const { rows } = await q('SELECT is_admin FROM users WHERE id = $1', [req.uid]);
  if (!rows[0]?.is_admin) return badRequest(res, 'Admin only', 403);
  next();
});

const requireVerified = wrap(async (req, res, next) => {
  const { rows } = await q('SELECT email_verified FROM users WHERE id = $1', [req.uid]);
  if (!rows[0]?.email_verified) {
    return res.status(403).json({ error: 'Please verify your email address before publishing.', code: 'EMAIL_UNVERIFIED' });
  }
  next();
});

// ── Rate limiters ───────────────────────────────────────────────────────────

const makeLimit = (windowMs, limit, msg) => rateLimit({
  windowMs, limit,
  standardHeaders: true, legacyHeaders: false, validate: false,
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
  message: { error: msg || 'Too many attempts. Try again later.' },
});

const authLimiter         = makeLimit(15 * 60 * 1000, 40);
const reportLimiter       = makeLimit(60 * 60 * 1000, 5,  'Too many reports from this IP. Try later.');
const resendLimiter       = makeLimit(60 * 60 * 1000, 3,  'Too many resend requests. Try later.');
const subdomainCheckLimit = makeLimit(60 * 1000,       60, 'Too many checks. Slow down.');
const publishLimiter      = makeLimit(60 * 1000,       10, 'Too many publish requests. Try later.');

// ── Cookie helper ───────────────────────────────────────────────────────────

const setSessionCookie = (res, userId) =>
  res.cookie(
    'sid',
    jwt.sign({ uid: userId }, C.SECRET, { expiresIn: '7d' }),
    { httpOnly: true, sameSite: 'lax', secure: C.COOKIE_SECURE, maxAge: 7 * 864e5 }
  );

// ── Draft hash (lightweight change detection) ───────────────────────────────

/** Compute a short hash of the current draft content. */
const draftHash = (pages, css, js) =>
  crypto.createHash('sha1')
    .update(JSON.stringify(pages) + css + js)
    .digest('hex')
    .slice(0, 16);

// ── Turnstile verification ──────────────────────────────────────────────────

/**
 * Verify a Cloudflare Turnstile token server-side.
 * Falls back to IP-rate-limiting when keys are not configured (local dev).
 * Returns { ok: boolean }.
 */
async function verifyTurnstile(token, ip) {
  if (!C.TURNSTILE_SECRET) return { ok: true }; // dev fallback — caller handles rate limit

  try {
    const body = new URLSearchParams({
      secret:   C.TURNSTILE_SECRET,
      response: token || '',
      remoteip: ip || '',
    });
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v1/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await resp.json();
    return { ok: !!data.success };
  } catch (err) {
    console.error('[turnstile] verification error:', err.message);
    return { ok: false };
  }
}

// ══════════════════════════════════════════════════════════════════
//  PUBLIC ENDPOINTS
// ══════════════════════════════════════════════════════════════════

/** App configuration for the SPA. */
router.get('/config', (_req, res) =>
  res.json({
    base:              C.BASE,
    proto:             C.PROTO,
    port:              C.PPORT,
    signup:            true,
    turnstileSiteKey:  C.TURNSTILE_SITE_KEY,
    approvalMode:      C.APPROVAL_MODE,
    quotas: {
      maxPublished:    C.MAX_PUBLISHED_PER_USER,
      maxArtifacts:    C.MAX_ARTIFACTS_PER_USER,
      maxArtifactBytes: C.MAX_ARTIFACT_BYTES,
      maxStorageMb:    C.MAX_STORAGE_PER_USER_MB,
      maxImages:       C.MAX_IMAGES_PER_USER,
    },
  })
);

/** Return the currently signed-in user, or null. */
router.get('/me', wrap(async (req, res) => {
  if (!isReady()) return res.json({ user: null });
  try {
    const uid = jwt.verify(req.cookies.sid, C.SECRET).uid;
    const { rows } = await q(
      `SELECT id, username, email, full_name, role, must_change_password,
              email_verified, trusted, banned, is_admin
       FROM   users WHERE id = $1 AND active = TRUE AND banned = FALSE`,
      [uid]
    );
    return res.json({ user: rows[0] || null });
  } catch {
    res.json({ user: null });
  }
}));

// ── Subdomain availability check ────────────────────────────────────────────

router.get('/subdomain-check', requireDB, subdomainCheckLimit, wrap(async (req, res) => {
  const name = String(req.query.name || '').toLowerCase().trim();

  // Structural validation
  const v = validateSubdomain(name, false);
  if (!v.ok) return res.json({ available: false, reason: v.reason });

  // Check DB for conflicts (ignore the current artifact if id provided)
  const excludeId = UUID_RE.test(req.query.exclude || '') ? req.query.exclude : null;
  const { rows } = await q(
    `SELECT id FROM artifacts WHERE subdomain = $1 ${excludeId ? 'AND id != $2' : ''}`,
    excludeId ? [name, excludeId] : [name]
  );

  if (rows.length > 0) return res.json({ available: false, reason: 'That subdomain is already taken' });
  res.json({ available: true });
}));

// ── Authentication ──────────────────────────────────────────────────────────

/** Public signups — sends verification email. */
router.post('/auth/signup', requireDB, authLimiter, wrap(async (req, res) => {
  const { username = '', email = '', password = '', full_name = '' } = req.body || {};

  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return badRequest(res, 'Username: 3–30 characters, letters/numbers/. _ -');
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return badRequest(res, 'Enter a valid email address');
  }
  if (String(password).length < 8) {
    return badRequest(res, 'Password must be at least 8 characters');
  }

  const hash = await bcrypt.hash(String(password), 10);

  let user;
  try {
    const { rows } = await q(
      `INSERT INTO users (username, email, password_hash, full_name, active, email_verified)
       VALUES ($1, $2, $3, $4, TRUE, FALSE)
       RETURNING id, username, email, full_name, role, must_change_password, email_verified, trusted, banned, is_admin`,
      [username.toLowerCase(), email.toLowerCase(), hash, String(full_name).slice(0, 80)]
    );
    user = rows[0];
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'Username or email already exists', 409);
    throw err;
  }

  // Auto-promote if ADMIN_EMAIL matches
  if (C.ADMIN_EMAIL && user.email === C.ADMIN_EMAIL) {
    await q(
      `UPDATE users SET role = 'admin', is_admin = TRUE, trusted = TRUE, email_verified = TRUE WHERE id = $1`,
      [user.id]
    );
    user.role = 'admin'; user.is_admin = true; user.trusted = true; user.email_verified = true;
  }

  // Send verification email (fire-and-forget — don't fail signup if mail fails)
  sendVerificationEmail(user.id, user.email).catch((err) =>
    console.error('[mail] verification email on signup:', err.message)
  );

  setSessionCookie(res, user.id);
  res.json({ user });
}));

router.post('/auth/login', requireDB, authLimiter, wrap(async (req, res) => {
  const { username = '', password = '' } = req.body || {};

  const { rows } = await q(
    `SELECT id, username, email, full_name, role, password_hash, active,
            must_change_password, email_verified, trusted, banned, is_admin
     FROM   users WHERE username = $1 OR email = $1`,
    [String(username).toLowerCase()]
  );
  const user = rows[0];

  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    return badRequest(res, 'Wrong username or password', 401);
  }
  if (!user.active) {
    return badRequest(res, 'Your account has been deactivated. Contact admin.', 403);
  }
  if (user.banned) {
    return badRequest(res, 'Your account has been suspended.', 403);
  }

  // Auto-promote if ADMIN_EMAIL matches
  if (C.ADMIN_EMAIL && user.email.toLowerCase() === C.ADMIN_EMAIL && !user.is_admin) {
    await q(
      `UPDATE users SET role = 'admin', is_admin = TRUE, trusted = TRUE, email_verified = TRUE WHERE id = $1`,
      [user.id]
    );
    user.role = 'admin'; user.is_admin = true; user.trusted = true; user.email_verified = true;
  }

  setSessionCookie(res, user.id);
  res.json({
    user: {
      id:                   user.id,
      username:             user.username,
      email:                user.email,
      full_name:            user.full_name,
      role:                 user.role,
      must_change_password: user.must_change_password,
      email_verified:       user.email_verified,
      trusted:              user.trusted,
      banned:               user.banned,
      is_admin:             user.is_admin,
    },
  });
}));

router.post('/auth/logout', (_req, res) => {
  res.clearCookie('sid');
  res.json({ ok: true });
});

router.post('/auth/forgot', authLimiter, wrap(async (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase();
  const { rows } = await q('SELECT id FROM users WHERE email = $1', [email]);

  if (rows[0]) {
    const token     = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(token);

    await q('DELETE FROM reset_tokens WHERE user_id = $1', [rows[0].id]);
    await q(
      `INSERT INTO reset_tokens (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + INTERVAL '30 minutes')`,
      [tokenHash, rows[0].id]
    );

    const resetLink = `${C.SITE_URL}/reset?token=${token}`;
    mail.send(
      email,
      'Reset your Biswa Artifacts password',
      `<p>Click below to set a new password. The link expires in 30 minutes.</p>
       <p><a href="${resetLink}" style="background:#6d5df6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Reset password</a></p>
       <p style="color:#888">If you did not request this, you can ignore this email.</p>`
    ).catch((err) => console.error('[mail] forgot password:', err.message));
  }

  res.json({ ok: true }); // always 200 — prevents email enumeration
}));

router.post('/auth/reset', authLimiter, wrap(async (req, res) => {
  const { token = '', password = '' } = req.body || {};

  if (String(password).length < 8) {
    return badRequest(res, 'Password must be at least 8 characters');
  }

  const { rows } = await q(
    'SELECT user_id FROM reset_tokens WHERE token_hash = $1 AND expires_at > now()',
    [sha256(String(token))]
  );
  if (!rows[0]) return badRequest(res, 'This reset link is invalid or has expired');

  const hash = await bcrypt.hash(String(password), 10);
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, rows[0].user_id]);
  await q('DELETE FROM reset_tokens WHERE user_id = $1', [rows[0].user_id]);

  res.json({ ok: true });
}));

// ── Email verification ──────────────────────────────────────────────────────

/**
 * Send a verification email to the user.
 * @param {string} userId
 * @param {string} email
 */
async function sendVerificationEmail(userId, email) {
  const token     = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);

  // Invalidate previous tokens for this user
  await q('DELETE FROM email_tokens WHERE user_id = $1', [userId]);
  await q(
    `INSERT INTO email_tokens (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + INTERVAL '24 hours')`,
    [tokenHash, userId]
  );

  const link = `${C.SITE_URL}/verify?token=${token}`;
  return mail.send(
    email,
    'Confirm your Biswa Artifacts email',
    `<div style="font-family:system-ui;max-width:480px;margin:auto;padding:32px">
      <h2>✦ Confirm your email</h2>
      <p>Click the button below to verify your email address. The link expires in 24 hours.</p>
      <p><a href="${esc(link)}" style="background:#6d5df6;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block">Confirm email →</a></p>
      <p style="color:#888;font-size:13px">If you did not sign up for Biswa Artifacts, you can ignore this.</p>
    </div>`
  );
}

/** GET /verify?token=... — handled in app.js but the helper lives here too. */
router.get('/verify-token', requireDB, wrap(async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return badRequest(res, 'Missing token');

  const { rows } = await q(
    `SELECT user_id FROM email_tokens
     WHERE  token_hash = $1 AND expires_at > now() AND used = FALSE`,
    [sha256(token)]
  );
  if (!rows[0]) return badRequest(res, 'This verification link is invalid or has expired');

  await q('UPDATE email_tokens SET used = TRUE WHERE token_hash = $1', [sha256(token)]);
  await q('UPDATE users SET email_verified = TRUE WHERE id = $1', [rows[0].user_id]);

  res.json({ ok: true });
}));

/** POST /auth/resend-verification */
router.post('/auth/resend-verification', requireDB, requireAuth, resendLimiter, wrap(async (req, res) => {
  const { rows } = await q(
    'SELECT email, email_verified FROM users WHERE id = $1',
    [req.uid]
  );
  if (!rows[0]) return badRequest(res, 'User not found', 404);
  if (rows[0].email_verified) return badRequest(res, 'Email already verified');

  await sendVerificationEmail(req.uid, rows[0].email);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  ARTIFACTS
// ══════════════════════════════════════════════════════════════════

/** Columns returned for list views (no page content). */
const ARTIFACT_COLS = `
  id, name, type, subdomain, status, review_status,
  (pw_hash IS NOT NULL) AS locked,
  updated_at, published_at,
  CASE WHEN draft_hash IS DISTINCT FROM live_hash THEN true ELSE false END AS has_changes
`;

router.get('/artifacts', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT ${ARTIFACT_COLS} FROM artifacts WHERE user_id = $1 ORDER BY updated_at DESC`,
    [req.uid]
  );

  // Attach quota usage
  const publishedCount = rows.filter(r => r.status === 'published').length;
  res.json({
    items: rows,
    quota: {
      published:    publishedCount,
      maxPublished: C.MAX_PUBLISHED_PER_USER,
      total:        rows.length,
      maxTotal:     C.MAX_ARTIFACTS_PER_USER,
    },
  });
}));

router.post('/artifacts', requireDB, requireAuth, wrap(async (req, res) => {
  // Quota: total artifacts
  const { rows: cnt } = await q(
    'SELECT COUNT(*) AS n FROM artifacts WHERE user_id = $1',
    [req.uid]
  );
  if (Number(cnt[0].n) >= C.MAX_ARTIFACTS_PER_USER) {
    return badRequest(res, `Artifact limit reached (max ${C.MAX_ARTIFACTS_PER_USER})`);
  }

  const { name = 'Untitled', type = 'web' } = req.body || {};
  if (!TPL[type]) return badRequest(res, 'Unknown artifact type');

  const template = TPL[type]();
  const hash     = draftHash(template.pages, template.css, template.js);

  const { rows } = await q(
    `INSERT INTO artifacts (user_id, name, type, pages, css, js, draft_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [req.uid, String(name).slice(0, 80) || 'Untitled', type,
     JSON.stringify(template.pages), template.css, template.js, hash]
  );
  res.json({ id: rows[0].id });
}));

router.get('/artifacts/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT ${ARTIFACT_COLS}, pages, css, js FROM artifacts WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.uid]
  );
  rows[0] ? res.json(rows[0]) : badRequest(res, 'Artifact not found', 404);
}));

router.put('/artifacts/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { name, pages, css = '', js = '' } = req.body || {};

  const isValidPages =
    Array.isArray(pages) &&
    pages.length >= 1 &&
    pages.length <= 30 &&
    pages.every((p) => p && /^[a-z0-9-]{1,40}\.html$/.test(p.n) && typeof p.h === 'string');

  if (!isValidPages) return badRequest(res, 'Invalid pages array');

  // Quota: artifact size
  const totalBytes = pages.reduce((s, p) => s + p.h.length, 0) + css.length + js.length;
  if (totalBytes > C.MAX_ARTIFACT_BYTES) {
    return badRequest(res, `Artifact too large (max ${C.MAX_ARTIFACT_BYTES / 1024} KB)`);
  }

  const cleanPages = pages.map((p) => ({ n: p.n, h: p.h }));
  const hash       = draftHash(cleanPages, String(css), String(js));

  const { rowCount } = await q(
    `UPDATE artifacts
     SET name = $1, pages = $2, css = $3, js = $4,
         draft_hash = $5, updated_at = now()
     WHERE id = $6 AND user_id = $7`,
    [String(name || 'Untitled').slice(0, 80),
     JSON.stringify(cleanPages), String(css), String(js),
     hash, req.params.id, req.uid]
  );
  rowCount ? res.json({ ok: true }) : badRequest(res, 'Artifact not found', 404);
}));

// ── Publish ──────────────────────────────────────────────────────────────────

router.post('/artifacts/:id/publish', requireDB, requireAuth, requireVerified, publishLimiter, requireUUID, wrap(async (req, res) => {
  const { subdomain = '', protect = false, password = '' } = req.body || {};
  const sub = String(subdomain).toLowerCase().trim();

  // Validate subdomain
  const { rows: userRow } = await q('SELECT is_admin FROM users WHERE id = $1', [req.uid]);
  const isAdmin = !!userRow[0]?.is_admin;
  const v = validateSubdomain(sub, isAdmin);
  if (!v.ok) return badRequest(res, v.reason);

  // Fetch artifact
  const { rows: cur } = await q(
    `SELECT id, pages, css, js, pw_hash, status, review_status, subdomain AS current_sub
     FROM   artifacts WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.uid]
  );
  if (!cur[0]) return badRequest(res, 'Artifact not found', 404);

  // Quota: published
  if (cur[0].status !== 'published') {
    const { rows: pubCnt } = await q(
      `SELECT COUNT(*) AS n FROM artifacts WHERE user_id = $1 AND status = 'published'`,
      [req.uid]
    );
    if (Number(pubCnt[0].n) >= C.MAX_PUBLISHED_PER_USER) {
      return badRequest(res, `Published artifact limit reached (max ${C.MAX_PUBLISHED_PER_USER})`);
    }
  }

  // Password handling
  let pwHash = null;
  if (protect) {
    if (password)              pwHash = await bcrypt.hash(String(password), 10);
    else if (cur[0].pw_hash)  pwHash = cur[0].pw_hash;
    else                      return badRequest(res, 'A password is required when protect is true');
  }

  // Approval logic
  const { rows: userTrust } = await q('SELECT trusted FROM users WHERE id = $1', [req.uid]);
  const isTrusted = isAdmin || !!userTrust[0]?.trusted;
  const isFirstPublish = cur[0].status !== 'published';
  const needsReview    = !isTrusted && C.APPROVAL_MODE === 'manual' && isFirstPublish;
  const newReviewStatus = needsReview ? 'pending' : 'approved';
  const newStatus       = needsReview ? 'draft' : 'published'; // stays draft while pending

  const hash = draftHash(cur[0].pages, cur[0].css, cur[0].js);

  // If this is a "Publish update" (already published), save a version snapshot first
  if (!isFirstPublish) {
    await saveVersion(req.params.id);
  }

  try {
    await q(
      `UPDATE artifacts
       SET subdomain     = $1,
           status        = $2,
           review_status = $3,
           pw_hash       = $4,
           live_pages    = pages,
           live_css      = css,
           live_js       = js,
           live_hash     = draft_hash,
           published_at  = CASE WHEN $2 = 'published' THEN now() ELSE published_at END,
           updated_at    = now()
       WHERE id = $5 AND user_id = $6`,
      [sub, newStatus, newReviewStatus, pwHash, req.params.id, req.uid]
    );
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'That subdomain is already taken', 409);
    throw err;
  }

  // If first publish and trusted, mark user as trusted for future publishes
  if (isFirstPublish && isTrusted && !userTrust[0]?.trusted) {
    await q('UPDATE users SET trusted = TRUE WHERE id = $1', [req.uid]);
  }

  // If first publish passed review (auto mode or trusted) — also mark trusted now
  if (!needsReview && isFirstPublish) {
    await q('UPDATE users SET trusted = TRUE WHERE id = $1', [req.uid]);
  }

  if (needsReview) {
    // Notify admin
    if (C.ADMIN_EMAIL) {
      mail.send(
        C.ADMIN_EMAIL,
        'New artifact awaiting review — Biswa Artifacts',
        `<p>A new artifact is waiting for approval.</p>
         <p>Artifact ID: <code>${esc(req.params.id)}</code><br>
         Subdomain: <code>${esc(sub)}</code></p>
         <p><a href="${esc(C.SITE_URL)}/admin">Review in admin panel →</a></p>`
      ).catch((e) => console.error('[mail] admin review notify:', e.message));
    }
    return res.json({ ok: true, pending: true, subdomain: sub });
  }

  res.json({ ok: true, subdomain: sub, locked: !!pwHash, review_status: newReviewStatus });
}));

router.post('/artifacts/:id/unpublish', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  // Unpublish keeps subdomain reserved but hides the site
  await q(
    `UPDATE artifacts SET status = 'draft', review_status = 'approved' WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.uid]
  );
  res.json({ ok: true });
}));

// ── Version history ─────────────────────────────────────────────────────────

/** Save the current live copy as a version snapshot (max 5 per artifact). */
async function saveVersion(artifactId) {
  const { rows } = await q(
    `SELECT live_pages, live_css, live_js FROM artifacts WHERE id = $1`,
    [artifactId]
  );
  if (!rows[0] || !rows[0].live_pages) return;

  await q(
    `INSERT INTO artifact_versions (artifact_id, pages, css, js)
     VALUES ($1, $2, $3, $4)`,
    [artifactId, JSON.stringify(rows[0].live_pages), rows[0].live_css || '', rows[0].live_js || '']
  );

  // Prune to last 5
  await q(`
    DELETE FROM artifact_versions
    WHERE  artifact_id = $1
      AND  id NOT IN (
        SELECT id FROM artifact_versions
        WHERE  artifact_id = $1
        ORDER  BY published_at DESC
        LIMIT  5
      )
  `, [artifactId]);
}

router.get('/artifacts/:id/versions', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  // Verify ownership
  const { rows: own } = await q(
    'SELECT id FROM artifacts WHERE id = $1 AND user_id = $2',
    [req.params.id, req.uid]
  );
  if (!own[0]) return badRequest(res, 'Artifact not found', 404);

  const { rows } = await q(
    `SELECT id, published_at FROM artifact_versions
     WHERE  artifact_id = $1
     ORDER  BY published_at DESC`,
    [req.params.id]
  );
  res.json({ versions: rows });
}));

/** Restore a version into the draft (never straight to live). */
router.post('/artifacts/:id/versions/:vid/restore', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.vid)) return badRequest(res, 'Invalid version id', 404);

  // Verify ownership
  const { rows: own } = await q(
    'SELECT id FROM artifacts WHERE id = $1 AND user_id = $2',
    [req.params.id, req.uid]
  );
  if (!own[0]) return badRequest(res, 'Artifact not found', 404);

  const { rows: ver } = await q(
    'SELECT pages, css, js FROM artifact_versions WHERE id = $1 AND artifact_id = $2',
    [req.params.vid, req.params.id]
  );
  if (!ver[0]) return badRequest(res, 'Version not found', 404);

  const hash = draftHash(ver[0].pages, ver[0].css, ver[0].js);
  await q(
    `UPDATE artifacts SET pages = $1, css = $2, js = $3, draft_hash = $4, updated_at = now()
     WHERE id = $5`,
    [JSON.stringify(ver[0].pages), ver[0].css, ver[0].js, hash, req.params.id]
  );

  res.json({ ok: true });
}));

/** Revert draft to the current live copy. */
router.post('/artifacts/:id/revert', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT live_pages, live_css, live_js, live_hash
     FROM   artifacts WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.uid]
  );
  if (!rows[0]) return badRequest(res, 'Artifact not found', 404);
  if (!rows[0].live_pages) return badRequest(res, 'No live version to revert to');

  await q(
    `UPDATE artifacts
     SET pages = live_pages, css = live_css, js = live_js,
         draft_hash = live_hash, updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.uid]
  );

  res.json({ ok: true });
}));

router.delete('/artifacts/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  await q('DELETE FROM artifacts WHERE id = $1 AND user_id = $2', [req.params.id, req.uid]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  FILES — Cloudflare R2
// ══════════════════════════════════════════════════════════════════

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${C.E.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     C.E.R2_ACCESS_KEY_ID     || '',
    secretAccessKey: C.E.R2_SECRET_ACCESS_KEY || '',
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const sanitiseFileName = (name) =>
  String(name || '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-').slice(0, 120);

const filePublicUrl = (key) =>
  C.E.R2_PUBLIC_URL
    ? `${C.E.R2_PUBLIC_URL.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
    : getSignedUrl(s3, new GetObjectCommand({ Bucket: C.E.R2_BUCKET, Key: key }), { expiresIn: 7 * 86_400 });

router.post('/files/presign', requireDB, requireAuth, wrap(async (req, res) => {
  const name = sanitiseFileName(req.body.name);
  const size = Number(req.body.size) || 0;
  const mime = String(req.body.type || 'application/octet-stream').slice(0, 100);

  if (!name) return badRequest(res, 'File name is required');
  if (size > 200 * 1024 * 1024) return badRequest(res, 'File too large (max 200 MB)');

  // Quota: total R2 storage per user
  const { rows: sizeRows } = await q(
    'SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE user_id = $1',
    [req.uid]
  );
  const usedMb = Number(sizeRows[0].total) / (1024 * 1024);
  if (usedMb + size / (1024 * 1024) > C.MAX_STORAGE_PER_USER_MB) {
    return badRequest(res, `Storage limit reached (max ${C.MAX_STORAGE_PER_USER_MB} MB)`);
  }

  const key = `${req.uid}/${crypto.randomBytes(4).toString('hex')}/${name}`;

  const { rows } = await q(
    'INSERT INTO files (user_id, key, name, size, mime) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.uid, key, name, size, mime]
  );

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: C.E.R2_BUCKET, Key: key, ContentType: mime }),
    { expiresIn: 900 }
  );

  res.json({ id: rows[0].id, url: uploadUrl, type: mime });
}));

router.get('/files', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    'SELECT id, key, name, size, created_at FROM files WHERE user_id = $1 ORDER BY created_at DESC',
    [req.uid]
  );

  const items = await Promise.all(
    rows.map(async (f) => ({
      id:         f.id,
      name:       f.name,
      size:       Number(f.size),
      created_at: f.created_at,
      link:       await filePublicUrl(f.key),
    }))
  );

  res.json({ items });
}));

router.delete('/files/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows } = await q(
    'DELETE FROM files WHERE id = $1 AND user_id = $2 RETURNING key',
    [req.params.id, req.uid]
  );

  if (rows[0]) {
    await s3
      .send(new DeleteObjectCommand({ Bucket: C.E.R2_BUCKET, Key: rows[0].key }))
      .catch((err) => console.error('[r2] delete failed:', err.message));
  }

  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  IMAGES — Cloudinary
// ══════════════════════════════════════════════════════════════════

cloudinary.config({
  cloud_name: C.E.CLOUDINARY_CLOUD_NAME,
  api_key:    C.E.CLOUDINARY_API_KEY,
  api_secret: C.E.CLOUDINARY_API_SECRET,
  secure:     true,
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: C.MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) =>
    /^image\//.test(file.mimetype)
      ? cb(null, true)
      : cb(Object.assign(new Error('Images only'), { status: 400 })),
});

const toSlug = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

router.get('/images', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    'SELECT id, name, url FROM images WHERE user_id = $1 ORDER BY created_at DESC',
    [req.uid]
  );
  res.json({ items: rows });
}));

router.post('/images', requireDB, requireAuth, imageUpload.single('file'), wrap(async (req, res) => {
  if (!req.file) return badRequest(res, 'No image received');

  // Quota: image count
  const { rows: cnt } = await q(
    'SELECT COUNT(*) AS n FROM images WHERE user_id = $1',
    [req.uid]
  );
  if (Number(cnt[0].n) >= C.MAX_IMAGES_PER_USER) {
    return badRequest(res, `Image limit reached (max ${C.MAX_IMAGES_PER_USER})`);
  }

  const baseName = toSlug(req.file.originalname.replace(/\.[^.]+$/, '')) || 'image';
  const publicId = `biswa-artifacts/${req.uid}/${baseName}-${crypto.randomBytes(2).toString('hex')}`;

  const result = await new Promise((resolve, reject) =>
    cloudinary.uploader
      .upload_stream({ public_id: publicId, resource_type: 'image' }, (err, data) =>
        err ? reject(err) : resolve(data)
      )
      .end(req.file.buffer)
  );

  const { rows } = await q(
    'INSERT INTO images (user_id, public_id, name, url) VALUES ($1, $2, $3, $4) RETURNING id, name, url',
    [req.uid, result.public_id, baseName, result.secure_url]
  );

  res.json(rows[0]);
}));

router.put('/images/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const name = toSlug((req.body || {}).name);
  if (!name) return badRequest(res, 'Name is required');

  const { rows: cur } = await q(
    'SELECT public_id FROM images WHERE id = $1 AND user_id = $2',
    [req.params.id, req.uid]
  );
  if (!cur[0]) return badRequest(res, 'Image not found', 404);

  let renamed;
  try {
    renamed = await cloudinary.uploader.rename(
      cur[0].public_id,
      `biswa-artifacts/${req.uid}/${name}`,
      { overwrite: false }
    );
  } catch {
    return badRequest(res, 'That name is already in use', 409);
  }

  const { rows } = await q(
    'UPDATE images SET public_id = $1, name = $2, url = $3 WHERE id = $4 RETURNING id, name, url',
    [renamed.public_id, name, renamed.secure_url, req.params.id]
  );

  res.json(rows[0]);
}));

router.delete('/images/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows } = await q(
    'DELETE FROM images WHERE id = $1 AND user_id = $2 RETURNING public_id',
    [req.params.id, req.uid]
  );

  if (rows[0]) {
    await cloudinary.uploader
      .destroy(rows[0].public_id)
      .catch((err) => console.error('[cloudinary] destroy failed:', err.message));
  }

  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  USER SETTINGS
// ══════════════════════════════════════════════════════════════════

router.get('/settings', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT id, username, email, full_name, role, must_change_password,
            email_verified, trusted, is_admin
     FROM   users WHERE id = $1`,
    [req.uid]
  );
  rows[0] ? res.json(rows[0]) : badRequest(res, 'User not found', 404);
}));

router.put('/settings/profile', requireDB, requireAuth, wrap(async (req, res) => {
  const { full_name = '', email = '' } = req.body || {};

  if (!/^\S+@\S+\.\S+$/.test(email)) return badRequest(res, 'Enter a valid email address');

  try {
    const { rows } = await q(
      `UPDATE users SET full_name = $1, email = $2 WHERE id = $3
       RETURNING id, username, email, full_name, role`,
      [String(full_name).slice(0, 80), String(email).toLowerCase(), req.uid]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'That email is already in use', 409);
    throw err;
  }
}));

router.put('/settings/password', requireDB, requireAuth, wrap(async (req, res) => {
  const { current_password = '', new_password = '' } = req.body || {};

  if (String(new_password).length < 8) {
    return badRequest(res, 'New password must be at least 8 characters');
  }

  const { rows } = await q(
    'SELECT password_hash, must_change_password FROM users WHERE id = $1',
    [req.uid]
  );
  if (!rows[0]) return badRequest(res, 'User not found', 404);

  if (!rows[0].must_change_password) {
    const ok = await bcrypt.compare(String(current_password), rows[0].password_hash);
    if (!ok) return badRequest(res, 'Current password is incorrect', 401);
  }

  const hash = await bcrypt.hash(String(new_password), 10);
  await q(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
    [hash, req.uid]
  );

  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════════

// ── Users ──────────────────────────────────────────────────────────────────

router.get('/admin/users', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT id, username, email, full_name, role, active, trusted, banned,
            email_verified, is_admin, created_at
     FROM   users ORDER BY created_at ASC`
  );
  res.json({ users: rows });
}));

router.post('/admin/users', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { username = '', email = '', full_name = '', role = 'user' } = req.body || {};

  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return badRequest(res, 'Username: 3–30 characters, letters/numbers/. _ -');
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return badRequest(res, 'Enter a valid email address');
  }
  if (!['user', 'admin'].includes(role)) {
    return badRequest(res, 'Role must be "user" or "admin"');
  }

  const tempPassword = crypto.randomBytes(8).toString('hex');
  const hash         = await bcrypt.hash(tempPassword, 10);

  let newUser;
  try {
    const { rows } = await q(
      `INSERT INTO users (username, email, password_hash, full_name, role, active,
                          must_change_password, email_verified, is_admin, trusted)
       VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, TRUE, $6, $7)
       RETURNING id, username, email, full_name, role, active, email_verified`,
      [username.toLowerCase(), email.toLowerCase(), hash, String(full_name).slice(0, 80),
       role, role === 'admin', role === 'admin']
    );
    newUser = rows[0];
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'Username or email already exists', 409);
    throw err;
  }

  mail.send(
    email,
    'Your Biswa Artifacts Account',
    `<div style="font-family:system-ui;max-width:480px;margin:auto;padding:32px;background:#0a0c14;color:#eef0f8;border-radius:16px">
      <h2 style="margin:0 0 8px">✦ Biswa Artifacts</h2>
      <p style="color:#97a0b8;margin:0 0 24px">Your account has been created.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:8px 0;color:#97a0b8;font-size:13px">Username</td><td style="padding:8px 0;font-weight:600">${esc(newUser.username)}</td></tr>
        <tr><td style="padding:8px 0;color:#97a0b8;font-size:13px">Temp Password</td><td style="padding:8px 0;font-family:monospace;font-size:15px;letter-spacing:2px">${esc(tempPassword)}</td></tr>
      </table>
      <a href="${esc(C.SITE_URL)}/login" style="display:inline-block;background:linear-gradient(135deg,#6d5df6,#e84fb0);color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600">Sign in →</a>
      <p style="color:#97a0b8;font-size:12px;margin-top:24px">You will be asked to change your password on first login.</p>
    </div>`
  ).catch((err) => console.error('[mail] welcome email:', err.message));

  res.json(newUser);
}));

router.patch('/admin/users/:id/active', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  if (req.params.id === req.uid) {
    return badRequest(res, 'You cannot deactivate your own account');
  }
  const { active } = req.body || {};
  const { rows } = await q(
    'UPDATE users SET active = $1 WHERE id = $2 RETURNING id, username, active',
    [!!active, req.params.id]
  );
  rows[0] ? res.json(rows[0]) : badRequest(res, 'User not found', 404);
}));

/** Ban a user — marks banned=true, suspends all their artifacts. */
router.patch('/admin/users/:id/ban', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  if (req.params.id === req.uid) return badRequest(res, 'You cannot ban yourself');

  const { banned = true } = req.body || {};
  await q('UPDATE users SET banned = $1 WHERE id = $2', [!!banned, req.params.id]);

  if (banned) {
    await q(
      `UPDATE artifacts SET status = 'suspended' WHERE user_id = $1`,
      [req.params.id]
    );
  }

  res.json({ ok: true });
}));

router.delete('/admin/users/:id', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  if (req.params.id === req.uid) return badRequest(res, 'You cannot delete your own account');
  await q('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Artifacts (admin) ─────────────────────────────────────────────────────

router.get('/admin/artifacts', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT a.id, a.name, a.type, a.subdomain, a.status, a.review_status,
           a.updated_at, a.published_at,
           u.username, u.email
    FROM   artifacts a
    JOIN   users u ON u.id = a.user_id
    ORDER  BY a.updated_at DESC
    LIMIT  200
  `);
  res.json({ artifacts: rows });
}));

/** Approve a pending artifact */
router.post('/admin/artifacts/:id/approve', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(
    `UPDATE artifacts
     SET status = 'published', review_status = 'approved', published_at = now()
     WHERE id = $1
     RETURNING id, user_id`,
    [req.params.id]
  );
  if (!rows[0]) return badRequest(res, 'Artifact not found', 404);

  // Trust the user going forward
  await q('UPDATE users SET trusted = TRUE WHERE id = $1', [rows[0].user_id]);

  // Backfill live copy if not set
  await q(`
    UPDATE artifacts
    SET live_pages = pages, live_css = css, live_js = js, live_hash = draft_hash
    WHERE id = $1 AND live_pages IS NULL
  `, [req.params.id]);

  res.json({ ok: true });
}));

/** Suspend an artifact */
router.post('/admin/artifacts/:id/suspend', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  await q(
    `UPDATE artifacts SET status = 'suspended' WHERE id = $1`,
    [req.params.id]
  );
  res.json({ ok: true });
}));

/** Restore a suspended artifact */
router.post('/admin/artifacts/:id/restore', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  await q(
    `UPDATE artifacts SET status = 'published', review_status = 'approved' WHERE id = $1`,
    [req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/admin/artifacts/:id', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  await q('DELETE FROM artifacts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Reports (admin) ──────────────────────────────────────────────────────

router.get('/admin/reports', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT r.id, r.reason, r.message, r.created_at, r.status,
           a.id AS artifact_id, a.name AS artifact_name, a.subdomain
    FROM   reports r
    JOIN   artifacts a ON a.id = r.artifact_id
    ORDER  BY r.created_at DESC
    LIMIT  500
  `);
  res.json({ reports: rows });
}));

router.patch('/admin/reports/:id/close', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  await q(`UPDATE reports SET status = 'closed' WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

// ── Pending approvals ──────────────────────────────────────────────────────

router.get('/admin/pending', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT a.id, a.name, a.type, a.subdomain, a.updated_at,
           u.username, u.email
    FROM   artifacts a
    JOIN   users u ON u.id = a.user_id
    WHERE  a.review_status = 'pending'
    ORDER  BY a.updated_at ASC
  `);
  res.json({ artifacts: rows });
}));

// ══════════════════════════════════════════════════════════════════
//  REPORT (public — artifact subdomains POST here)
// ══════════════════════════════════════════════════════════════════

const VALID_REASONS = Object.freeze([
  'spam', 'phishing', 'malware', 'misinformation', 'illegal', 'harassment', 'other',
]);

// This route is called from the artifact subdomain via sites.js,
// which sets req.artifactId before forwarding.
router.post('/report', requireDB, reportLimiter, wrap(async (req, res) => {
  const { reason = '', message = '', 'cf-turnstile-response': turnstileToken = '' } = req.body || {};
  const artifactId = req.artifactId; // set by sites.js

  if (!artifactId) return badRequest(res, 'Bad request');
  if (!VALID_REASONS.includes(reason)) {
    return badRequest(res, 'Invalid reason');
  }

  const ip = req.headers['cf-connecting-ip'] || req.ip || '';
  const ipHash = hashIp(ip);

  // Turnstile verification (falls back gracefully when keys not configured)
  if (C.TURNSTILE_SECRET) {
    const { ok } = await verifyTurnstile(turnstileToken, ip);
    if (!ok) return res.status(403).json({ error: 'Bot check failed. Please try again.' });
  }

  // Insert report
  await q(
    `INSERT INTO reports (artifact_id, reason, message, reporter_ip_hash)
     VALUES ($1, $2, $3, $4)`,
    [artifactId, reason, String(message).slice(0, 500), ipHash]
  );

  // Count distinct reporter IPs for this artifact
  const { rows } = await q(
    `SELECT COUNT(DISTINCT reporter_ip_hash) AS n
     FROM   reports WHERE artifact_id = $1 AND status = 'open'`,
    [artifactId]
  );

  // Auto-suspend after 3 distinct reporters
  if (Number(rows[0].n) >= 3) {
    await q(
      `UPDATE artifacts SET status = 'suspended' WHERE id = $1 AND status != 'suspended'`,
      [artifactId]
    );
  }

  // Notify admin
  if (C.ADMIN_EMAIL) {
    const { rows: art } = await q('SELECT name, subdomain FROM artifacts WHERE id = $1', [artifactId]);
    if (art[0]) {
      mail.send(
        C.ADMIN_EMAIL,
        `Report received: ${esc(art[0].name)} — Biswa Artifacts`,
        `<p>A new report was submitted.</p>
         <p><b>Artifact:</b> ${esc(art[0].name)} (<code>${esc(art[0].subdomain)}.${esc(C.BASE)}</code>)<br>
         <b>Reason:</b> ${esc(reason)}<br>
         <b>Message:</b> ${esc(String(message).slice(0, 200))}</p>
         <p><a href="${esc(C.SITE_URL)}/admin">Review in admin panel →</a></p>`
      ).catch((e) => console.error('[mail] report notify:', e.message));
    }
  }

  res.json({ ok: true });
}));

// ── 404 + error handler ─────────────────────────────────────────────────────

router.use((_req, res) => badRequest(res, 'API endpoint not found', 404));

// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return badRequest(res, `Image too large (max ${C.MAX_IMAGE_BYTES / (1024 * 1024)} MB)`);
  if (err.status === 400)             return badRequest(res, err.message);
  console.error('[api] unhandled error:', err);
  badRequest(res, 'An unexpected error occurred', 500);
});

module.exports = router;
