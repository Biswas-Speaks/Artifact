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
 *   Files         Cloudflare R2 presigned-URL upload flow  (Part 1: status + quota)
 *   Images        Cloudinary direct upload                 (Part 1: bytes + quota)
 *   Usage         GET  /usage                              (Part 1)
 *   AI Settings   GET/POST/PUT/PATCH/DELETE /ai/settings   (Part 3)
 *                 POST /ai/verify   POST /ai/recheck
 *   AI Generate   POST /artifacts/:id/ai                   (Part 3)
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
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const { q, isReady }             = require('./db');
const C                          = require('./config');
const mail                       = require('./mail');
const TPL                        = require('./templates');
const { validateSubdomain }      = require('./names');
const { encryptKey, decryptKey, keyLast4 } = require('./ai/encrypt');
const { verifyKey, generate }    = require('./ai/providers');
const SYSTEM_PROMPT              = require('./ai/systemPrompt');

const router = express.Router();

// ── Shared helpers ──────────────────────────────────────────────────────────

const wrap        = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const badRequest  = (res, msg, code = 400) => res.status(code).json({ error: msg });
const UUID_RE     = /^[0-9a-f-]{36}$/i;
const sha256      = (s) => crypto.createHash('sha256').update(s).digest('hex');
const requireUUID = (req, res, next) =>
  UUID_RE.test(req.params.id) ? next() : badRequest(res, 'Invalid id', 404);

const esc = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const hashIp = (ip) =>
  crypto.createHmac('sha256', C.IP_SALT).update(String(ip || '')).digest('hex').slice(0, 32);

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
  const { rows } = await q('SELECT is_admin FROM users WHERE id=$1', [req.uid]);
  if (!rows[0]?.is_admin) return badRequest(res, 'Admin only', 403);
  next();
});

const requireVerified = wrap(async (req, res, next) => {
  const { rows } = await q('SELECT email_verified FROM users WHERE id=$1', [req.uid]);
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
const aiVerifyLimiter     = makeLimit(60 * 1000,       10, 'Too many AI verify attempts. Try later.');

// ── Per-user AI rate limit (in-memory, resets on restart — acceptable for 1-instance) ──
// Stores { count, dayCount, windowStart, dayStart } keyed by user_id.
const aiRateLimitMap = new Map();

function checkAiRateLimit(uid) {
  const now       = Date.now();
  const windowMs  = C.AI_RATE_WINDOW_MIN * 60 * 1000;
  const dayMs     = 24 * 60 * 60 * 1000;
  const entry     = aiRateLimitMap.get(uid) || { count: 0, dayCount: 0, windowStart: now, dayStart: now };

  // Reset window counter
  if (now - entry.windowStart > windowMs) {
    entry.count = 0;
    entry.windowStart = now;
  }
  // Reset daily counter
  if (now - entry.dayStart > dayMs) {
    entry.dayCount = 0;
    entry.dayStart = now;
  }

  if (entry.count >= C.AI_RATE_LIMIT) {
    return { ok: false, error: `AI rate limit reached (${C.AI_RATE_LIMIT} requests per ${C.AI_RATE_WINDOW_MIN} minutes). Try again shortly.` };
  }
  if (entry.dayCount >= C.AI_RATE_LIMIT_DAY) {
    return { ok: false, error: `Daily AI limit reached (${C.AI_RATE_LIMIT_DAY} requests per day). Come back tomorrow.` };
  }

  entry.count++;
  entry.dayCount++;
  aiRateLimitMap.set(uid, entry);
  return { ok: true };
}

// ── Per-user AI concurrency lock ────────────────────────────────────────────
const aiInFlight = new Set(); // uid strings

// ── Cookie helper ───────────────────────────────────────────────────────────

const setSessionCookie = (res, userId) =>
  res.cookie(
    'sid',
    jwt.sign({ uid: userId }, C.SECRET, { expiresIn: '7d' }),
    { httpOnly: true, sameSite: 'lax', secure: C.COOKIE_SECURE, maxAge: 7 * 864e5 }
  );

// ── Draft hash ──────────────────────────────────────────────────────────────

const draftHash = (pages, css, js) =>
  crypto.createHash('sha1')
    .update(JSON.stringify(pages) + css + js)
    .digest('hex')
    .slice(0, 16);

// ── Turnstile verification ──────────────────────────────────────────────────

async function verifyTurnstile(token, ip) {
  if (!C.TURNSTILE_SECRET) return { ok: true };
  try {
    const body = new URLSearchParams({ secret: C.TURNSTILE_SECRET, response: token || '', remoteip: ip || '' });
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

// ── S3 / R2 client ──────────────────────────────────────────────────────────

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

// ══════════════════════════════════════════════════════════════════
//  PUBLIC ENDPOINTS
// ══════════════════════════════════════════════════════════════════

router.get('/config', (_req, res) =>
  res.json({
    base:             C.BASE,
    proto:            C.PROTO,
    port:             C.PPORT,
    signup:           true,
    turnstileSiteKey: C.TURNSTILE_SITE_KEY,
    approvalMode:     C.APPROVAL_MODE,
    quotas: {
      maxPublished:      C.MAX_PUBLISHED_PER_USER,
      maxArtifacts:      C.MAX_ARTIFACTS_PER_USER,
      maxArtifactBytes:  C.MAX_ARTIFACT_BYTES,
      maxStorageMb:      C.MAX_STORAGE_PER_USER_MB,
      maxImages:         C.MAX_IMAGES_PER_USER,
      maxImageStorageMb: C.MAX_IMAGE_STORAGE_MB,
      maxFileStorageMb:  C.MAX_FILE_STORAGE_MB,
    },
  })
);

router.get('/me', wrap(async (req, res) => {
  if (!isReady()) return res.json({ user: null });
  try {
    const uid = jwt.verify(req.cookies.sid, C.SECRET).uid;
    const { rows } = await q(
      `SELECT id, username, email, full_name, role, must_change_password,
              email_verified, trusted, banned, is_admin
       FROM   users WHERE id=$1 AND active=TRUE AND banned=FALSE`,
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
  const v = validateSubdomain(name, false);
  if (!v.ok) return res.json({ available: false, reason: v.reason });

  const excludeId = UUID_RE.test(req.query.exclude || '') ? req.query.exclude : null;
  const { rows } = await q(
    `SELECT id FROM artifacts WHERE subdomain=$1 ${excludeId ? 'AND id!=$2' : ''}`,
    excludeId ? [name, excludeId] : [name]
  );
  if (rows.length > 0) return res.json({ available: false, reason: 'That subdomain is already taken' });
  res.json({ available: true });
}));

// ── Authentication ──────────────────────────────────────────────────────────

router.post('/auth/signup', requireDB, authLimiter, wrap(async (req, res) => {
  const { username = '', email = '', password = '', full_name = '' } = req.body || {};
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) return badRequest(res, 'Username: 3–30 characters, letters/numbers/. _ -');
  if (!/^\S+@\S+\.\S+$/.test(email))             return badRequest(res, 'Enter a valid email address');
  if (String(password).length < 8)               return badRequest(res, 'Password must be at least 8 characters');

  const hash = await bcrypt.hash(String(password), 10);
  let user;
  try {
    const { rows } = await q(
      `INSERT INTO users (username,email,password_hash,full_name,active,email_verified)
       VALUES ($1,$2,$3,$4,TRUE,FALSE)
       RETURNING id,username,email,full_name,role,must_change_password,email_verified,trusted,banned,is_admin`,
      [username.toLowerCase(), email.toLowerCase(), hash, String(full_name).slice(0, 80)]
    );
    user = rows[0];
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'Username or email already exists', 409);
    throw err;
  }

  if (C.ADMIN_EMAIL && user.email === C.ADMIN_EMAIL) {
    await q(`UPDATE users SET role='admin',is_admin=TRUE,trusted=TRUE,email_verified=TRUE WHERE id=$1`, [user.id]);
    user.role = 'admin'; user.is_admin = true; user.trusted = true; user.email_verified = true;
  }

  sendVerificationEmail(user.id, user.email).catch(err => console.error('[mail] verification:', err.message));
  setSessionCookie(res, user.id);
  res.json({ user });
}));

router.post('/auth/login', requireDB, authLimiter, wrap(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const { rows } = await q(
    `SELECT id,username,email,full_name,role,password_hash,active,
            must_change_password,email_verified,trusted,banned,is_admin
     FROM   users WHERE username=$1 OR email=$1`,
    [String(username).toLowerCase()]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) return badRequest(res, 'Wrong username or password', 401);
  if (!user.active) return badRequest(res, 'Your account has been deactivated. Contact admin.', 403);
  if (user.banned)  return badRequest(res, 'Your account has been suspended.', 403);

  if (C.ADMIN_EMAIL && user.email.toLowerCase() === C.ADMIN_EMAIL && !user.is_admin) {
    await q(`UPDATE users SET role='admin',is_admin=TRUE,trusted=TRUE,email_verified=TRUE WHERE id=$1`, [user.id]);
    user.role = 'admin'; user.is_admin = true; user.trusted = true; user.email_verified = true;
  }
  if ((user.role === 'admin') !== user.is_admin) {
    const synced = user.role === 'admin';
    await q(`UPDATE users SET is_admin=$1 WHERE id=$2`, [synced, user.id]);
    user.is_admin = synced;
  }

  setSessionCookie(res, user.id);
  res.json({ user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name,
    role: user.role, must_change_password: user.must_change_password, email_verified: user.email_verified,
    trusted: user.trusted, banned: user.banned, is_admin: user.is_admin } });
}));

router.post('/auth/logout', (_req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });

router.post('/auth/forgot', authLimiter, wrap(async (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase();
  const { rows } = await q('SELECT id FROM users WHERE email=$1', [email]);
  if (rows[0]) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(token);
    await q('DELETE FROM reset_tokens WHERE user_id=$1', [rows[0].id]);
    await q(`INSERT INTO reset_tokens (token_hash,user_id,expires_at) VALUES ($1,$2,now()+INTERVAL '30 minutes')`,
      [tokenHash, rows[0].id]);
    const resetLink = `${C.SITE_URL}/reset?token=${token}`;
    mail.send(email, 'Reset your Biswa Artifacts password',
      `<p>Click below to set a new password. The link expires in 30 minutes.</p>
       <p><a href="${resetLink}" style="background:#6d5df6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Reset password</a></p>
       <p style="color:#888">If you did not request this, you can ignore this email.</p>`
    ).catch(err => console.error('[mail] forgot:', err.message));
  }
  res.json({ ok: true });
}));

router.post('/auth/reset', authLimiter, wrap(async (req, res) => {
  const { token = '', password = '' } = req.body || {};
  if (String(password).length < 8) return badRequest(res, 'Password must be at least 8 characters');
  const { rows } = await q(
    'SELECT user_id FROM reset_tokens WHERE token_hash=$1 AND expires_at>now()',
    [sha256(String(token))]
  );
  if (!rows[0]) return badRequest(res, 'This reset link is invalid or has expired');
  const hash = await bcrypt.hash(String(password), 10);
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, rows[0].user_id]);
  await q('DELETE FROM reset_tokens WHERE user_id=$1', [rows[0].user_id]);
  res.json({ ok: true });
}));

// ── Email verification ──────────────────────────────────────────────────────

async function sendVerificationEmail(userId, email) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  await q('DELETE FROM email_tokens WHERE user_id=$1', [userId]);
  await q(`INSERT INTO email_tokens (token_hash,user_id,expires_at) VALUES ($1,$2,now()+INTERVAL '24 hours')`,
    [tokenHash, userId]);
  const link = `${C.SITE_URL}/verify?token=${token}`;
  return mail.send(email, 'Confirm your Biswa Artifacts email',
    `<div style="font-family:system-ui;max-width:480px;margin:auto;padding:32px">
      <h2>✦ Confirm your email</h2>
      <p>Click the button below to verify your email address. The link expires in 24 hours.</p>
      <p><a href="${esc(link)}" style="background:#6d5df6;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block">Confirm email →</a></p>
      <p style="color:#888;font-size:13px">If you did not sign up for Biswa Artifacts, you can ignore this.</p>
    </div>`
  );
}

router.get('/verify-token', requireDB, wrap(async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return badRequest(res, 'Missing token');
  const { rows } = await q(
    `SELECT user_id FROM email_tokens WHERE token_hash=$1 AND expires_at>now() AND used=FALSE`,
    [sha256(token)]
  );
  if (!rows[0]) return badRequest(res, 'This verification link is invalid or has expired');
  await q('UPDATE email_tokens SET used=TRUE WHERE token_hash=$1', [sha256(token)]);
  await q('UPDATE users SET email_verified=TRUE WHERE id=$1', [rows[0].user_id]);
  res.json({ ok: true });
}));

router.post('/auth/resend-verification', requireDB, requireAuth, resendLimiter, wrap(async (req, res) => {
  const { rows } = await q('SELECT email,email_verified FROM users WHERE id=$1', [req.uid]);
  if (!rows[0]) return badRequest(res, 'User not found', 404);
  if (rows[0].email_verified) return badRequest(res, 'Email already verified');
  await sendVerificationEmail(req.uid, rows[0].email);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  ARTIFACTS
// ══════════════════════════════════════════════════════════════════

const ARTIFACT_COLS = `
  id, name, type, subdomain, status, review_status,
  (pw_hash IS NOT NULL) AS locked,
  updated_at, published_at,
  CASE WHEN draft_hash IS DISTINCT FROM live_hash THEN true ELSE false END AS has_changes
`;

router.get('/artifacts', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT ${ARTIFACT_COLS} FROM artifacts WHERE user_id=$1 ORDER BY updated_at DESC`,
    [req.uid]
  );
  const publishedCount = rows.filter(r => r.status === 'published').length;
  const { rows: uq } = await q('SELECT max_published,max_artifacts FROM users WHERE id=$1', [req.uid]);
  const maxPublished = uq[0]?.max_published ?? C.MAX_PUBLISHED_PER_USER;
  const maxTotal     = uq[0]?.max_artifacts ?? C.MAX_ARTIFACTS_PER_USER;
  res.json({ items: rows, quota: { published: publishedCount, maxPublished, total: rows.length, maxTotal } });
}));

router.post('/artifacts', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows: uq } = await q('SELECT max_artifacts FROM users WHERE id=$1', [req.uid]);
  const maxArtifacts = uq[0]?.max_artifacts ?? C.MAX_ARTIFACTS_PER_USER;
  const { rows: cnt } = await q('SELECT COUNT(*) AS n FROM artifacts WHERE user_id=$1', [req.uid]);
  if (Number(cnt[0].n) >= maxArtifacts) return badRequest(res, `Artifact limit reached (max ${maxArtifacts})`);

  const { name = 'Untitled', type = 'web' } = req.body || {};
  if (!TPL[type]) return badRequest(res, 'Unknown artifact type');
  const template = TPL[type]();
  const hash = draftHash(template.pages, template.css, template.js);
  const { rows } = await q(
    `INSERT INTO artifacts (user_id,name,type,pages,css,js,draft_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.uid, String(name).slice(0, 80) || 'Untitled', type, JSON.stringify(template.pages), template.css, template.js, hash]
  );
  res.json({ id: rows[0].id });
}));

router.get('/artifacts/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT ${ARTIFACT_COLS}, pages, css, js FROM artifacts WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.uid]
  );
  rows[0] ? res.json(rows[0]) : badRequest(res, 'Artifact not found', 404);
}));

router.put('/artifacts/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { name, pages, css = '', js = '' } = req.body || {};
  const isValidPages = Array.isArray(pages) && pages.length >= 1 && pages.length <= 30 &&
    pages.every(p => p && /^[a-z0-9-]{1,40}\.html$/.test(p.n) && typeof p.h === 'string');
  if (!isValidPages) return badRequest(res, 'Invalid pages array');

  const totalBytes = pages.reduce((s, p) => s + p.h.length, 0) + css.length + js.length;
  if (totalBytes > C.MAX_ARTIFACT_BYTES) return badRequest(res, `Artifact too large (max ${C.MAX_ARTIFACT_BYTES / 1024} KB)`);

  const cleanPages = pages.map(p => ({ n: p.n, h: p.h }));
  const hash = draftHash(cleanPages, String(css), String(js));
  const { rowCount } = await q(
    `UPDATE artifacts SET name=$1,pages=$2,css=$3,js=$4,draft_hash=$5,updated_at=now() WHERE id=$6 AND user_id=$7`,
    [String(name || 'Untitled').slice(0, 80), JSON.stringify(cleanPages), String(css), String(js), hash, req.params.id, req.uid]
  );
  rowCount ? res.json({ ok: true }) : badRequest(res, 'Artifact not found', 404);
}));

// ── Publish ──────────────────────────────────────────────────────────────────

router.post('/artifacts/:id/publish', requireDB, requireAuth, requireVerified, publishLimiter, requireUUID, wrap(async (req, res) => {
  const { subdomain = '', protect = false, password = '' } = req.body || {};
  const sub = String(subdomain).toLowerCase().trim();

  const { rows: userRow } = await q('SELECT is_admin FROM users WHERE id=$1', [req.uid]);
  const isAdmin = !!userRow[0]?.is_admin;
  const v = validateSubdomain(sub, isAdmin);
  if (!v.ok) return badRequest(res, v.reason);

  const { rows: cur } = await q(
    `SELECT id,pages,css,js,pw_hash,status,review_status,subdomain AS current_sub FROM artifacts WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.uid]
  );
  if (!cur[0]) return badRequest(res, 'Artifact not found', 404);

  if (cur[0].status !== 'published') {
    const { rows: uq } = await q('SELECT max_published FROM users WHERE id=$1', [req.uid]);
    const maxPublished = uq[0]?.max_published ?? C.MAX_PUBLISHED_PER_USER;
    const { rows: pubCnt } = await q(`SELECT COUNT(*) AS n FROM artifacts WHERE user_id=$1 AND status='published'`, [req.uid]);
    if (Number(pubCnt[0].n) >= maxPublished) return badRequest(res, `Published artifact limit reached (max ${maxPublished})`);
  }

  let pwHash = null;
  if (protect) {
    if (password)            pwHash = await bcrypt.hash(String(password), 10);
    else if (cur[0].pw_hash) pwHash = cur[0].pw_hash;
    else                     return badRequest(res, 'A password is required when protect is true');
  }

  const { rows: userTrust } = await q('SELECT trusted FROM users WHERE id=$1', [req.uid]);
  const isTrusted = isAdmin || !!userTrust[0]?.trusted;
  const isFirstPublish = cur[0].status !== 'published';
  const needsReview = !isTrusted && C.APPROVAL_MODE === 'manual' && isFirstPublish;
  const newReviewStatus = needsReview ? 'pending' : 'approved';
  const newStatus = needsReview ? 'draft' : 'published';

  if (!isFirstPublish) await saveVersion(req.params.id, 'manual');

  try {
    await q(
      `UPDATE artifacts SET subdomain=$1,status=$2,review_status=$3,pw_hash=$4,
              live_pages=pages,live_css=css,live_js=js,live_hash=draft_hash,
              published_at=CASE WHEN $2='published' THEN now() ELSE published_at END,
              updated_at=now()
       WHERE id=$5 AND user_id=$6`,
      [sub, newStatus, newReviewStatus, pwHash, req.params.id, req.uid]
    );
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'That subdomain is already taken', 409);
    throw err;
  }

  if (!needsReview && isFirstPublish) await q('UPDATE users SET trusted=TRUE WHERE id=$1', [req.uid]);

  if (needsReview && C.ADMIN_EMAIL) {
    mail.send(C.ADMIN_EMAIL, 'New artifact awaiting review — Biswa Artifacts',
      `<p>Artifact ID: <code>${esc(req.params.id)}</code><br>Subdomain: <code>${esc(sub)}</code></p>
       <p><a href="${esc(C.SITE_URL)}/admin">Review →</a></p>`
    ).catch(e => console.error('[mail] admin review notify:', e.message));
    return res.json({ ok: true, pending: true, subdomain: sub });
  }

  res.json({ ok: true, subdomain: sub, locked: !!pwHash, review_status: newReviewStatus });
}));

router.post('/artifacts/:id/unpublish', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  await q(`UPDATE artifacts SET status='draft',review_status='approved' WHERE id=$1 AND user_id=$2`, [req.params.id, req.uid]);
  res.json({ ok: true });
}));

// ── Version history ─────────────────────────────────────────────────────────

/** Save the current draft as a version snapshot (max 30 per artifact). */
async function saveVersion(artifactId, source, prompt = null) {
  const { rows } = await q(`SELECT pages,css,js FROM artifacts WHERE id=$1`, [artifactId]);
  if (!rows[0]) return null;

  const sizeBytes = JSON.stringify(rows[0].pages).length + (rows[0].css || '').length + (rows[0].js || '').length;

  const { rows: inserted } = await q(
    `INSERT INTO artifact_versions (artifact_id,pages,css,js,source,prompt,size_bytes,created_at,published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now()) RETURNING id`,
    [artifactId, JSON.stringify(rows[0].pages), rows[0].css || '', rows[0].js || '', source, prompt, sizeBytes]
  );

  // Prune to newest 30
  await q(`
    DELETE FROM artifact_versions
    WHERE  artifact_id=$1
      AND  id NOT IN (
        SELECT id FROM artifact_versions WHERE artifact_id=$1
        ORDER BY created_at DESC LIMIT 30
      )
  `, [artifactId]);

  return inserted[0]?.id || null;
}

router.get('/artifacts/:id/versions', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows: own } = await q('SELECT id FROM artifacts WHERE id=$1 AND user_id=$2', [req.params.id, req.uid]);
  if (!own[0]) return badRequest(res, 'Artifact not found', 404);

  const { rows } = await q(
    `SELECT id, source, prompt, size_bytes, created_at
     FROM   artifact_versions
     WHERE  artifact_id=$1
     ORDER  BY created_at DESC`,
    [req.params.id]
  );
  res.json({ versions: rows });
}));

/** Restore a version into the draft — saves current draft first. */
router.post('/artifacts/:id/versions/:vid/restore', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.vid)) return badRequest(res, 'Invalid version id', 404);

  const { rows: own } = await q('SELECT id FROM artifacts WHERE id=$1 AND user_id=$2', [req.params.id, req.uid]);
  if (!own[0]) return badRequest(res, 'Artifact not found', 404);

  const { rows: ver } = await q(
    'SELECT pages,css,js FROM artifact_versions WHERE id=$1 AND artifact_id=$2',
    [req.params.vid, req.params.id]
  );
  if (!ver[0]) return badRequest(res, 'Version not found', 404);

  // Save current draft before overwriting
  await saveVersion(req.params.id, 'rollback');

  const hash = draftHash(ver[0].pages, ver[0].css, ver[0].js);
  await q(
    `UPDATE artifacts SET pages=$1,css=$2,js=$3,draft_hash=$4,updated_at=now() WHERE id=$5`,
    [JSON.stringify(ver[0].pages), ver[0].css, ver[0].js, hash, req.params.id]
  );
  res.json({ ok: true });
}));

router.post('/artifacts/:id/revert', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT live_pages,live_css,live_js,live_hash FROM artifacts WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.uid]
  );
  if (!rows[0]) return badRequest(res, 'Artifact not found', 404);
  if (!rows[0].live_pages) return badRequest(res, 'No live version to revert to');
  await q(
    `UPDATE artifacts SET pages=live_pages,css=live_css,js=live_js,draft_hash=live_hash,updated_at=now() WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.uid]
  );
  res.json({ ok: true });
}));

router.delete('/artifacts/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  await q('DELETE FROM artifacts WHERE id=$1 AND user_id=$2', [req.params.id, req.uid]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  USAGE — Part 1
// ══════════════════════════════════════════════════════════════════

router.get('/usage', requireDB, requireAuth, wrap(async (req, res) => {
  const [pubRes, artRes, imgRes, fileRes, uqRes] = await Promise.all([
    q(`SELECT COUNT(*) AS n FROM artifacts WHERE user_id=$1 AND status='published'`, [req.uid]),
    q(`SELECT COUNT(*) AS n FROM artifacts WHERE user_id=$1`, [req.uid]),
    q(`SELECT COALESCE(SUM(bytes),0) AS total FROM images WHERE user_id=$1`, [req.uid]),
    q(`SELECT COALESCE(SUM(size),0) AS total FROM files WHERE user_id=$1 AND status='ready'`, [req.uid]),
    q('SELECT max_published,max_artifacts,max_storage_mb,max_images FROM users WHERE id=$1', [req.uid]),
  ]);

  const uq = uqRes.rows[0] || {};
  const maxPublished  = uq.max_published  ?? C.MAX_PUBLISHED_PER_USER;
  const maxArtifacts  = uq.max_artifacts  ?? C.MAX_ARTIFACTS_PER_USER;
  const maxImageBytes = (uq.max_storage_mb ?? C.MAX_IMAGE_STORAGE_MB) * 1024 * 1024;
  const maxFileBytes  = C.MAX_FILE_STORAGE_MB * 1024 * 1024;

  res.json({
    published: { used: Number(pubRes.rows[0].n), max: maxPublished },
    artifacts: { used: Number(artRes.rows[0].n), max: maxArtifacts },
    images:    { usedBytes: Number(imgRes.rows[0].total), maxBytes: maxImageBytes },
    files:     { usedBytes: Number(fileRes.rows[0].total), maxBytes: maxFileBytes },
  });
}));

// ══════════════════════════════════════════════════════════════════
//  FILES — Cloudflare R2  (Part 1: status + real-size confirm)
// ══════════════════════════════════════════════════════════════════

const sanitiseFileName = (name) =>
  String(name || '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-').slice(0, 120);

const filePublicUrl = async (key) => {
  if (C.E.R2_PUBLIC_URL) {
    return `${C.E.R2_PUBLIC_URL.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: C.E.R2_BUCKET, Key: key }), { expiresIn: 7 * 86_400 });
  } catch (err) {
    console.error('[r2] signed url error for key:', key, err.message);
    return null;
  }
};

router.post('/files/presign', requireDB, requireAuth, wrap(async (req, res) => {
  const name = sanitiseFileName(req.body.name);
  const size = Number(req.body.size) || 0;
  const mime = String(req.body.type || 'application/octet-stream').slice(0, 100);

  if (!name) return badRequest(res, 'File name is required');
  if (size > 200 * 1024 * 1024) return badRequest(res, 'File too large (max 200 MB)');

  // Purge stale pending rows for this user (older than 1 hour)
  await q(
    `DELETE FROM files WHERE user_id=$1 AND status='pending' AND created_at < now() - INTERVAL '1 hour'`,
    [req.uid]
  ).catch(() => {});

  // Quota: total R2 storage — count ready + pending
  const maxFileBytes = C.MAX_FILE_STORAGE_MB * 1024 * 1024;
  const { rows: sizeRows } = await q(
    `SELECT COALESCE(SUM(size),0) AS total FROM files WHERE user_id=$1 AND status IN ('ready','pending')`,
    [req.uid]
  );
  const usedBytes = Number(sizeRows[0].total);
  if (usedBytes + size > maxFileBytes) {
    return badRequest(res, `Storage limit reached (max ${C.MAX_FILE_STORAGE_MB} MB)`);
  }

  const key = `${req.uid}/${crypto.randomBytes(4).toString('hex')}/${name}`;

  const { rows } = await q(
    `INSERT INTO files (user_id,key,name,size,mime,confirmed,status) VALUES ($1,$2,$3,$4,$5,FALSE,'pending') RETURNING id`,
    [req.uid, key, name, size, mime]
  );

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: C.E.R2_BUCKET, Key: key, ContentType: mime }),
    { expiresIn: 900 }
  );

  res.json({ id: rows[0].id, url: uploadUrl, type: mime });
}));

/** Confirm upload — HeadObject to verify real size against quota, then mark ready. */
router.post('/files/:id/confirm', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT id,key,size,user_id FROM files WHERE id=$1 AND user_id=$2 AND status='pending'`,
    [req.params.id, req.uid]
  );
  if (!rows[0]) return badRequest(res, 'File not found or already confirmed', 404);

  const fileRec = rows[0];

  // HeadObject to get real size from R2
  let realSize = Number(fileRec.size);
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: C.E.R2_BUCKET, Key: fileRec.key }));
    if (head.ContentLength != null) realSize = head.ContentLength;
  } catch (err) {
    // If HeadObject fails, the file wasn't uploaded — delete the pending row
    await q('DELETE FROM files WHERE id=$1', [fileRec.id]);
    console.error('[r2] HeadObject failed for confirm:', err.message);
    return badRequest(res, 'Upload not found in storage. Please try again.');
  }

  // Re-check quota with real size (other files may have been uploaded concurrently)
  const maxFileBytes = C.MAX_FILE_STORAGE_MB * 1024 * 1024;
  const { rows: sizeRows } = await q(
    `SELECT COALESCE(SUM(size),0) AS total FROM files WHERE user_id=$1 AND status='ready'`,
    [req.uid]
  );
  const usedReady = Number(sizeRows[0].total);
  if (usedReady + realSize > maxFileBytes) {
    // Over quota with real size — delete from R2 and DB
    await s3.send(new DeleteObjectCommand({ Bucket: C.E.R2_BUCKET, Key: fileRec.key }))
      .catch(err => console.error('[r2] delete over-quota file:', err.message));
    await q('DELETE FROM files WHERE id=$1', [fileRec.id]);
    return badRequest(res, `Storage limit exceeded with actual file size. File removed. (max ${C.MAX_FILE_STORAGE_MB} MB)`);
  }

  await q(
    `UPDATE files SET confirmed=TRUE, status='ready', size=$1 WHERE id=$2`,
    [realSize, fileRec.id]
  );
  res.json({ ok: true, size: realSize });
}));

router.get('/files', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT id,key,name,size,created_at FROM files WHERE user_id=$1 AND status='ready' ORDER BY created_at DESC`,
    [req.uid]
  );
  const items = (await Promise.all(
    rows.map(async (f) => {
      const link = await filePublicUrl(f.key);
      if (!link) return null;
      return { id: f.id, name: f.name, size: Number(f.size), created_at: f.created_at, link };
    })
  )).filter(Boolean);
  res.json({ items });
}));

router.delete('/files/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows } = await q('DELETE FROM files WHERE id=$1 AND user_id=$2 RETURNING key', [req.params.id, req.uid]);
  if (rows[0]) {
    await s3.send(new DeleteObjectCommand({ Bucket: C.E.R2_BUCKET, Key: rows[0].key }))
      .catch(err => console.error('[r2] delete failed:', err.message));
  }
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  IMAGES — Cloudinary  (Part 1: bytes + image storage quota)
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
    'SELECT id,name,url,bytes FROM images WHERE user_id=$1 ORDER BY created_at DESC',
    [req.uid]
  );
  res.json({ items: rows });
}));

router.post('/images', requireDB, requireAuth, imageUpload.single('file'), wrap(async (req, res) => {
  if (!req.file) return badRequest(res, 'No image received');

  // Part 1: pre-check image storage quota using multer file.size
  const maxImageBytes = C.MAX_IMAGE_STORAGE_MB * 1024 * 1024;
  const { rows: usageRows } = await q(
    'SELECT COALESCE(SUM(bytes),0) AS total FROM images WHERE user_id=$1',
    [req.uid]
  );
  const usedBytes = Number(usageRows[0].total);
  if (usedBytes + req.file.size > maxImageBytes) {
    return badRequest(res, `Image storage limit reached (max ${C.MAX_IMAGE_STORAGE_MB} MB). Delete images to free space.`);
  }

  // Count limit still enforced
  const { rows: cnt } = await q('SELECT COUNT(*) AS n FROM images WHERE user_id=$1', [req.uid]);
  if (Number(cnt[0].n) >= C.MAX_IMAGES_PER_USER) {
    return badRequest(res, `Image count limit reached (max ${C.MAX_IMAGES_PER_USER})`);
  }

  const baseName = toSlug(req.file.originalname.replace(/\.[^.]+$/, '')) || 'image';
  const publicId = `biswa-artifacts/${req.uid}/${baseName}-${crypto.randomBytes(2).toString('hex')}`;

  let result;
  try {
    result = await new Promise((resolve, reject) =>
      cloudinary.uploader
        .upload_stream({ public_id: publicId, resource_type: 'image' }, (err, data) =>
          err ? reject(err) : resolve(data)
        )
        .end(req.file.buffer)
    );
  } catch (err) {
    console.error('[cloudinary] upload error:', err.message);
    return badRequest(res, 'Image upload failed. Please try again.');
  }

  // Re-check quota with real bytes from Cloudinary result
  const realBytes = result.bytes || req.file.size;
  if (usedBytes + realBytes > maxImageBytes) {
    // Over quota with real size — delete from Cloudinary and return error
    await cloudinary.uploader.destroy(result.public_id).catch(() => {});
    return badRequest(res, `Image storage limit exceeded. File removed. (max ${C.MAX_IMAGE_STORAGE_MB} MB)`);
  }

  const { rows } = await q(
    'INSERT INTO images (user_id,public_id,name,url,bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,url,bytes',
    [req.uid, result.public_id, baseName, result.secure_url, realBytes]
  );
  res.json(rows[0]);
}));

router.put('/images/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const name = toSlug((req.body || {}).name);
  if (!name) return badRequest(res, 'Name is required');

  const { rows: cur } = await q('SELECT public_id FROM images WHERE id=$1 AND user_id=$2', [req.params.id, req.uid]);
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
    'UPDATE images SET public_id=$1,name=$2,url=$3 WHERE id=$4 RETURNING id,name,url,bytes',
    [renamed.public_id, name, renamed.secure_url, req.params.id]
  );
  res.json(rows[0]);
}));

router.delete('/images/:id', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows } = await q('DELETE FROM images WHERE id=$1 AND user_id=$2 RETURNING public_id', [req.params.id, req.uid]);
  if (rows[0]) {
    await cloudinary.uploader.destroy(rows[0].public_id)
      .catch(err => console.error('[cloudinary] destroy failed:', err.message));
  }
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  AI SETTINGS — Part 3
// ══════════════════════════════════════════════════════════════════

/** GET /api/ai/settings — returns safe fields only (never the key). */
router.get('/ai/settings', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT provider, model, key_last4, status, verified_at
     FROM   user_ai_settings WHERE user_id=$1`,
    [req.uid]
  );
  if (!rows[0]) return res.json({ connected: false });
  res.json({
    connected:  true,
    provider:   rows[0].provider,
    model:      rows[0].model,
    status:     rows[0].status,
    last4:      rows[0].key_last4,
    verifiedAt: rows[0].verified_at,
  });
}));

/**
 * POST /api/ai/verify — verify key with provider; return model list.
 * Does NOT store anything.
 */
router.post('/ai/verify', requireDB, requireAuth, aiVerifyLimiter, wrap(async (req, res) => {
  const { provider, apiKey } = req.body || {};
  if (!provider || !apiKey) return badRequest(res, 'provider and apiKey are required');
  if (!['gemini', 'openai'].includes(provider)) return badRequest(res, 'provider must be "gemini" or "openai"');

  const key = String(apiKey).trim();
  if (key.length < 10) return badRequest(res, 'API key looks too short');

  const result = await verifyKey(provider, key);
  if (!result.ok) return badRequest(res, result.error, 422);

  // Return model list and default — key is NOT stored here
  res.json({ ok: true, models: result.models, default: result.default });
}));

/**
 * PUT /api/ai/settings — re-verify, check model, encrypt and save.
 */
router.put('/ai/settings', requireDB, requireAuth, aiVerifyLimiter, wrap(async (req, res) => {
  const { provider, apiKey, model } = req.body || {};
  if (!provider || !apiKey || !model) return badRequest(res, 'provider, apiKey and model are required');
  if (!['gemini', 'openai'].includes(provider)) return badRequest(res, 'provider must be "gemini" or "openai"');

  const key = String(apiKey).trim();
  if (key.length < 10) return badRequest(res, 'API key looks too short');

  const result = await verifyKey(provider, key);
  if (!result.ok) return badRequest(res, result.error, 422);

  if (!result.models.includes(model)) {
    return badRequest(res, `Model "${model}" is not available for this key. Choose from: ${result.models.slice(0, 5).join(', ')}`);
  }

  const enc = encryptKey(key);
  const last4 = keyLast4(key);

  await q(`
    INSERT INTO user_ai_settings (user_id,provider,model,key_cipher,key_iv,key_tag,key_last4,key_version,status,verified_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'verified',now(),now())
    ON CONFLICT (user_id) DO UPDATE SET
      provider=EXCLUDED.provider, model=EXCLUDED.model,
      key_cipher=EXCLUDED.key_cipher, key_iv=EXCLUDED.key_iv,
      key_tag=EXCLUDED.key_tag, key_last4=EXCLUDED.key_last4,
      key_version=EXCLUDED.key_version, status='verified',
      verified_at=now(), updated_at=now()
  `, [req.uid, provider, model, enc.cipher, enc.iv, enc.tag, last4, enc.version]);

  res.json({ ok: true, provider, model, last4, status: 'verified' });
}));

/**
 * PATCH /api/ai/settings — change model only (no key needed, but model must
 * be validated against the provider's current list using the stored key).
 */
router.patch('/ai/settings', requireDB, requireAuth, wrap(async (req, res) => {
  const { model } = req.body || {};
  if (!model) return badRequest(res, 'model is required');

  const { rows } = await q(
    `SELECT provider,key_cipher,key_iv,key_tag FROM user_ai_settings WHERE user_id=$1`,
    [req.uid]
  );
  if (!rows[0]) return badRequest(res, 'No AI key configured. Use PUT /api/ai/settings first.', 404);

  // Decrypt and re-verify to confirm model is still valid
  let plainKey;
  try {
    plainKey = decryptKey({ cipher: rows[0].key_cipher, iv: rows[0].key_iv, tag: rows[0].key_tag });
  } catch {
    return badRequest(res, 'Could not read stored key. Please re-enter your API key.', 500);
  }

  const result = await verifyKey(rows[0].provider, plainKey);
  if (!result.ok) {
    await q(`UPDATE user_ai_settings SET status='invalid', updated_at=now() WHERE user_id=$1`, [req.uid]);
    return badRequest(res, result.error, 422);
  }
  if (!result.models.includes(model)) {
    return badRequest(res, `Model "${model}" is not available. Choose from: ${result.models.slice(0, 5).join(', ')}`);
  }

  await q(`UPDATE user_ai_settings SET model=$1, updated_at=now() WHERE user_id=$2`, [model, req.uid]);
  res.json({ ok: true, model });
}));

/**
 * POST /api/ai/recheck — decrypt and re-verify the stored key; update status.
 */
router.post('/ai/recheck', requireDB, requireAuth, aiVerifyLimiter, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT provider,model,key_cipher,key_iv,key_tag FROM user_ai_settings WHERE user_id=$1`,
    [req.uid]
  );
  if (!rows[0]) return badRequest(res, 'No AI key configured.', 404);

  let plainKey;
  try {
    plainKey = decryptKey({ cipher: rows[0].key_cipher, iv: rows[0].key_iv, tag: rows[0].key_tag });
  } catch {
    return badRequest(res, 'Could not decrypt stored key. Please re-enter your API key.', 500);
  }

  const result = await verifyKey(rows[0].provider, plainKey);
  const newStatus = result.ok ? 'verified' : 'invalid';
  await q(`UPDATE user_ai_settings SET status=$1, verified_at=CASE WHEN $1='verified' THEN now() ELSE verified_at END, updated_at=now() WHERE user_id=$2`,
    [newStatus, req.uid]);

  if (!result.ok) return badRequest(res, result.error, 422);
  res.json({ ok: true, status: 'verified', models: result.models });
}));

/**
 * DELETE /api/ai/settings — remove stored key and settings.
 */
router.delete('/ai/settings', requireDB, requireAuth, wrap(async (req, res) => {
  await q('DELETE FROM user_ai_settings WHERE user_id=$1', [req.uid]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  AI GENERATION — Part 3
// ══════════════════════════════════════════════════════════════════

const PAGE_NAME_RE  = /^[a-z0-9-]{1,40}\.html$/;
const UNSAFE_RE     = /\/api\/|document\.cookie|localStorage\.getItem|window\.parent\b|parent\.postMessage/;
const MAX_CONTEXT_BYTES = 60_000;

/**
 * Build the context string: artifact files + recent chat history.
 * Caps total at ~60 KB.
 */
function buildContext(artifact, messages) {
  const parts = [];

  // Current files
  const pages = Array.isArray(artifact.pages) ? artifact.pages : [];
  for (const p of pages) {
    const content = `=== FILE: ${p.n} ===\n${p.h}`;
    parts.push(content);
  }
  parts.push(`=== FILE: style.css ===\n${artifact.css || ''}`);
  parts.push(`=== FILE: script.js ===\n${artifact.js || ''}`);

  let ctx = parts.join('\n\n');
  if (ctx.length > MAX_CONTEXT_BYTES) {
    ctx = ctx.slice(0, MAX_CONTEXT_BYTES) + '\n\n[... context truncated to 60 KB — remaining files omitted]';
  }

  // Recent chat (last 6 messages)
  const recentMsgs = (messages || []).slice(-6);
  if (recentMsgs.length > 0) {
    const chatStr = recentMsgs.map(m => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`).join('\n');
    ctx += `\n\n=== RECENT CHAT ===\n${chatStr}`;
  }

  return ctx;
}

/**
 * Validate and apply the structured JSON output from the AI.
 * Returns { ok, error, updatedArtifact } — never mutates the DB.
 */
function applyAiOutput(parsed, artifact) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Response is not a JSON object.' };
  if (typeof parsed.note !== 'string') return { ok: false, error: 'Response missing "note" field.' };
  if (!Array.isArray(parsed.files))    return { ok: false, error: 'Response missing "files" array.' };

  const note = String(parsed.note).slice(0, 200);
  if (parsed.files.length > 12) return { ok: false, error: 'Response specifies too many files (max 12).' };

  // Deep-clone current artifact state
  let pages = JSON.parse(JSON.stringify(artifact.pages));
  let css   = artifact.css || '';
  let js    = artifact.js  || '';

  const changedFiles = [];

  for (const fileOp of parsed.files) {
    const path   = String(fileOp.path   || '').trim();
    const action = String(fileOp.action || '').trim();

    // Validate path
    if (path !== 'style.css' && path !== 'script.js' && !PAGE_NAME_RE.test(path)) {
      return { ok: false, error: `Invalid file path: "${path}". Only .html page names, style.css, and script.js are allowed.` };
    }

    // Cannot delete index.html
    if (action === 'delete' && path === 'index.html') {
      return { ok: false, error: 'index.html cannot be deleted.' };
    }

    // Validate action
    if (!['create', 'replace', 'edit', 'delete'].includes(action)) {
      return { ok: false, error: `Unknown action "${action}" for file "${path}".` };
    }

    // Get current content
    let currentContent = '';
    if (path === 'style.css')  currentContent = css;
    else if (path === 'script.js') currentContent = js;
    else {
      const existing = pages.find(p => p.n === path);
      currentContent = existing ? existing.h : '';
    }

    // Apply action
    if (action === 'delete') {
      pages = pages.filter(p => p.n !== path);
      changedFiles.push(path);
      continue;
    }

    if (action === 'create' || action === 'replace') {
      const content = String(fileOp.content || '');

      // HTML pages: reject if content contains html/head/body structure tags
      if (PAGE_NAME_RE.test(path)) {
        if (/<(!doctype|html|head|body)[^>]*>/i.test(content)) {
          return { ok: false, error: `File "${path}": HTML pages must contain body markup only — no <!doctype>, <html>, <head>, or <body> tags.` };
        }
      }

      // Security check
      if (UNSAFE_RE.test(content)) {
        return { ok: false, error: `File "${path}" contains references to platform APIs or cookies. Generation rejected.` };
      }

      if (path === 'style.css')       css = content;
      else if (path === 'script.js')  js  = content;
      else {
        const idx = pages.findIndex(p => p.n === path);
        if (idx >= 0) pages[idx] = { n: path, h: content };
        else          pages.push({ n: path, h: content });
      }
      changedFiles.push(path);
      continue;
    }

    if (action === 'edit') {
      if (!Array.isArray(fileOp.edits) || fileOp.edits.length === 0) {
        return { ok: false, error: `File "${path}": action "edit" requires a non-empty "edits" array.` };
      }
      let working = currentContent;
      for (const edit of fileOp.edits) {
        const find    = String(edit.find    || '');
        const replace = String(edit.replace || '');
        if (!find) return { ok: false, error: `File "${path}": edit has empty "find" string.` };

        // find must appear EXACTLY ONCE
        const firstIdx = working.indexOf(find);
        if (firstIdx === -1) {
          return { ok: false, error: `File "${path}": edit "find" string not found. The AI's edit does not match the current file content.` };
        }
        const secondIdx = working.indexOf(find, firstIdx + 1);
        if (secondIdx !== -1) {
          return { ok: false, error: `File "${path}": edit "find" string appears more than once. Edit is ambiguous.` };
        }
        working = working.slice(0, firstIdx) + replace + working.slice(firstIdx + find.length);
      }

      if (UNSAFE_RE.test(working)) {
        return { ok: false, error: `File "${path}" after edits contains references to platform APIs or cookies. Generation rejected.` };
      }

      if (path === 'style.css')       css = working;
      else if (path === 'script.js')  js  = working;
      else {
        const idx = pages.findIndex(p => p.n === path);
        if (idx >= 0)     pages[idx] = { n: path, h: working };
        else if (working) pages.push({ n: path, h: working });
      }
      changedFiles.push(path);
    }
  }

  // Ensure index.html always exists
  if (!pages.find(p => p.n === 'index.html')) {
    return { ok: false, error: 'index.html was removed by the AI output — operation rejected.' };
  }

  // Size check
  const totalBytes = pages.reduce((s, p) => s + p.h.length, 0) + css.length + js.length;
  if (totalBytes > C.MAX_ARTIFACT_BYTES) {
    return { ok: false, error: `Resulting artifact is too large (${Math.round(totalBytes / 1024)} KB, max ${C.MAX_ARTIFACT_BYTES / 1024} KB).` };
  }

  return { ok: true, note, changedFiles, pages, css, js };
}

/** POST /api/artifacts/:id/ai */
router.post('/artifacts/:id/ai', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { prompt = '' } = req.body || {};
  const cleanPrompt = String(prompt).trim();

  // Prompt validation
  if (!cleanPrompt || cleanPrompt.length < 1)    return badRequest(res, 'Prompt is required');
  if (cleanPrompt.length > 4000)                 return badRequest(res, 'Prompt is too long (max 4000 characters)');

  // Ownership check
  const { rows: artRows } = await q(
    `SELECT id,pages,css,js,name FROM artifacts WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.uid]
  );
  if (!artRows[0]) return badRequest(res, 'Artifact not found', 404);
  const artifact = artRows[0];

  // AI config check
  const { rows: aiRows } = await q(
    `SELECT provider,model,key_cipher,key_iv,key_tag,status FROM user_ai_settings WHERE user_id=$1`,
    [req.uid]
  );
  if (!aiRows[0] || aiRows[0].status !== 'verified') {
    return res.status(409).json({ error: 'AI key not connected. Configure it in AI Settings.', code: 'AI_NOT_CONNECTED' });
  }

  // Concurrency lock — one in-flight generation per user
  if (aiInFlight.has(req.uid)) {
    return res.status(409).json({ error: 'A generation is already in progress. Wait for it to finish.', code: 'AI_IN_FLIGHT' });
  }

  // Rate limit
  const rl = checkAiRateLimit(req.uid);
  if (!rl.ok) return res.status(429).json({ error: rl.error });

  // Decrypt key — map DB column names (key_cipher/key_iv/key_tag) to what decryptKey expects
  let plainKey;
  try {
    plainKey = decryptKey({
      cipher: aiRows[0].key_cipher,
      iv:     aiRows[0].key_iv,
      tag:    aiRows[0].key_tag,
    });
  } catch (err) {
    console.error('[ai] decrypt error for user', req.uid, ':', err.message);
    return badRequest(res, 'Could not read stored API key. Please re-enter it in AI Settings.', 500);
  }

  // Load recent chat messages
  const { rows: msgRows } = await q(
    `SELECT role,content FROM ai_messages WHERE artifact_id=$1 ORDER BY created_at ASC`,
    [req.params.id]
  );

  // Build context
  const contextText = buildContext(artifact, msgRows);

  // Mark in-flight
  aiInFlight.add(req.uid);

  // AbortController for 60s timeout
  const ac = new AbortController();
  const timeoutHandle = setTimeout(() => ac.abort(), 60_000);

  let genResult;
  try {
    genResult = await generate({
      provider:     aiRows[0].provider,
      model:        aiRows[0].model,
      apiKey:       plainKey,
      systemPrompt: SYSTEM_PROMPT,
      contextText,
      userPrompt:   cleanPrompt,
      signal:       ac.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
    aiInFlight.delete(req.uid);
  }

  // Handle invalid key during generation
  if (!genResult.ok && genResult.invalidKey) {
    await q(`UPDATE user_ai_settings SET status='invalid', updated_at=now() WHERE user_id=$1`, [req.uid]);
    return res.status(422).json({ error: genResult.error + ' Your key has been marked invalid — please replace it in AI Settings.', code: 'AI_KEY_INVALID' });
  }

  if (!genResult.ok) {
    return badRequest(res, genResult.error, 502);
  }

  // Parse structured JSON
  let parsed;
  try {
    // Strip any accidental markdown code fences
    const raw = genResult.raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    parsed = JSON.parse(raw);
  } catch {
    return badRequest(res, 'AI returned invalid JSON. Please try again.', 502);
  }

  // Validate and apply changes (in memory only)
  const applied = applyAiOutput(parsed, artifact);
  if (!applied.ok) return badRequest(res, applied.error, 422);

  // Commit in a single transaction
  const client = await require('pg').Pool; // won't work — use q() with manual transaction
  // Use explicit transaction via sequential queries in the pool (Neon doesn't support sessions well)
  // We achieve atomicity by doing all inserts before the final UPDATE
  const newHash = draftHash(applied.pages, applied.css, applied.js);

  // 1. Save snapshot of current draft (before changes) — source = 'manual' if no prior version
  const preVersionId = await saveVersion(req.params.id, 'manual');

  // 2. Apply changes to the draft
  await q(
    `UPDATE artifacts SET pages=$1,css=$2,js=$3,draft_hash=$4,updated_at=now() WHERE id=$5`,
    [JSON.stringify(applied.pages), applied.css, applied.js, newHash, req.params.id]
  );

  // 3. Save AI version
  const sizeBytes = applied.pages.reduce((s, p) => s + p.h.length, 0) + applied.css.length + applied.js.length;
  const { rows: aiVer } = await q(
    `INSERT INTO artifact_versions (artifact_id,pages,css,js,source,prompt,size_bytes,created_at,published_at)
     VALUES ($1,$2,$3,$4,'ai',$5,$6,now(),now()) RETURNING id`,
    [req.params.id, JSON.stringify(applied.pages), applied.css, applied.js, cleanPrompt, sizeBytes]
  );
  const versionId = aiVer[0]?.id;

  // Prune versions
  await q(`
    DELETE FROM artifact_versions WHERE artifact_id=$1
      AND id NOT IN (SELECT id FROM artifact_versions WHERE artifact_id=$1 ORDER BY created_at DESC LIMIT 30)
  `, [req.params.id]);

  // 4. Append chat messages
  await q(
    `INSERT INTO ai_messages (artifact_id,role,content,version_id) VALUES ($1,'user',$2,NULL)`,
    [req.params.id, cleanPrompt]
  );
  await q(
    `INSERT INTO ai_messages (artifact_id,role,content,version_id) VALUES ($1,'assistant',$2,$3)`,
    [req.params.id, applied.note, versionId]
  );

  // 5. Return updated artifact (fresh from DB)
  const { rows: fresh } = await q(
    `SELECT id,name,type,subdomain,status,review_status,(pw_hash IS NOT NULL) AS locked,
            updated_at,published_at,pages,css,js,
            CASE WHEN draft_hash IS DISTINCT FROM live_hash THEN true ELSE false END AS has_changes
     FROM artifacts WHERE id=$1`,
    [req.params.id]
  );

  res.json({
    note:         applied.note,
    changedFiles: applied.changedFiles,
    versionId,
    artifact:     fresh[0],
  });
}));

// ── AI message history ──────────────────────────────────────────────────────

router.get('/artifacts/:id/ai/messages', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { rows: own } = await q('SELECT id FROM artifacts WHERE id=$1 AND user_id=$2', [req.params.id, req.uid]);
  if (!own[0]) return badRequest(res, 'Artifact not found', 404);

  const { rows } = await q(
    `SELECT id,role,content,version_id,created_at FROM ai_messages WHERE artifact_id=$1 ORDER BY created_at ASC`,
    [req.params.id]
  );
  res.json({ messages: rows });
}));

// ══════════════════════════════════════════════════════════════════
//  USER SETTINGS
// ══════════════════════════════════════════════════════════════════

router.get('/settings', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT id,username,email,full_name,role,must_change_password,email_verified,trusted,is_admin FROM users WHERE id=$1`,
    [req.uid]
  );
  rows[0] ? res.json(rows[0]) : badRequest(res, 'User not found', 404);
}));

router.put('/settings/profile', requireDB, requireAuth, wrap(async (req, res) => {
  const { full_name = '', email = '' } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email)) return badRequest(res, 'Enter a valid email address');
  try {
    const { rows } = await q(
      `UPDATE users SET full_name=$1,email=$2 WHERE id=$3 RETURNING id,username,email,full_name,role`,
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
  if (String(new_password).length < 8) return badRequest(res, 'New password must be at least 8 characters');

  const { rows } = await q('SELECT password_hash,must_change_password FROM users WHERE id=$1', [req.uid]);
  if (!rows[0]) return badRequest(res, 'User not found', 404);

  if (!rows[0].must_change_password) {
    const ok = await bcrypt.compare(String(current_password), rows[0].password_hash);
    if (!ok) return badRequest(res, 'Current password is incorrect', 401);
  }

  const hash = await bcrypt.hash(String(new_password), 10);
  await q('UPDATE users SET password_hash=$1,must_change_password=FALSE WHERE id=$2', [hash, req.uid]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════════

router.get('/admin/users', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT id,username,email,full_name,role,active,trusted,banned,
            email_verified,is_admin,created_at,max_published,max_artifacts,max_storage_mb,max_images
     FROM   users ORDER BY created_at ASC`
  );
  res.json({ users: rows });
}));

router.post('/admin/users', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { username = '', email = '', full_name = '', role = 'user' } = req.body || {};
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) return badRequest(res, 'Username: 3–30 characters, letters/numbers/. _ -');
  if (!/^\S+@\S+\.\S+$/.test(email))             return badRequest(res, 'Enter a valid email address');
  if (!['user','admin'].includes(role))           return badRequest(res, 'Role must be "user" or "admin"');

  const tempPassword = crypto.randomBytes(8).toString('hex');
  const hash = await bcrypt.hash(tempPassword, 10);
  let newUser;
  try {
    const { rows } = await q(
      `INSERT INTO users (username,email,password_hash,full_name,role,active,must_change_password,email_verified,is_admin,trusted)
       VALUES ($1,$2,$3,$4,$5,TRUE,TRUE,TRUE,$6,$7) RETURNING id,username,email,full_name,role,active,email_verified`,
      [username.toLowerCase(), email.toLowerCase(), hash, String(full_name).slice(0, 80), role, role==='admin', role==='admin']
    );
    newUser = rows[0];
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'Username or email already exists', 409);
    throw err;
  }
  mail.send(email, 'Your Biswa Artifacts Account',
    `<div style="font-family:system-ui;max-width:480px;margin:auto;padding:32px;background:#0a0c14;color:#eef0f8;border-radius:16px">
      <h2>✦ Biswa Artifacts</h2><p style="color:#97a0b8">Your account has been created.</p>
      <p>Username: <strong>${esc(newUser.username)}</strong><br>Temp Password: <code>${esc(tempPassword)}</code></p>
      <a href="${esc(C.SITE_URL)}/login" style="display:inline-block;background:linear-gradient(135deg,#6d5df6,#e84fb0);color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600">Sign in →</a>
    </div>`
  ).catch(err => console.error('[mail] welcome:', err.message));
  res.json(newUser);
}));

router.patch('/admin/users/:id/active', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  if (req.params.id === req.uid) return badRequest(res, 'You cannot deactivate your own account');
  const { active } = req.body || {};
  const { rows } = await q('UPDATE users SET active=$1 WHERE id=$2 RETURNING id,username,active', [!!active, req.params.id]);
  rows[0] ? res.json(rows[0]) : badRequest(res, 'User not found', 404);
}));

router.patch('/admin/users/:id/ban', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  if (req.params.id === req.uid) return badRequest(res, 'You cannot ban yourself');
  const { banned = true } = req.body || {};
  await q('UPDATE users SET banned=$1 WHERE id=$2', [!!banned, req.params.id]);
  if (banned) await q(`UPDATE artifacts SET status='suspended' WHERE user_id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

router.delete('/admin/users/:id', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  if (req.params.id === req.uid) return badRequest(res, 'You cannot delete your own account');
  await q('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

router.patch('/admin/users/:id/limits', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  const { max_published, max_artifacts, max_storage_mb, max_images } = req.body || {};
  const toInt = (v) => (v === null || v === '' || v === undefined) ? null : Math.max(0, parseInt(v, 10) || 0);
  const { rows } = await q(
    `UPDATE users SET max_published=$1,max_artifacts=$2,max_storage_mb=$3,max_images=$4 WHERE id=$5
     RETURNING id,max_published,max_artifacts,max_storage_mb,max_images`,
    [toInt(max_published), toInt(max_artifacts), toInt(max_storage_mb), toInt(max_images), req.params.id]
  );
  if (!rows[0]) return badRequest(res, 'User not found', 404);
  res.json({ ok: true, ...rows[0] });
}));

router.patch('/admin/users/:id/role', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  if (req.params.id === req.uid) return badRequest(res, 'You cannot change your own role');
  const { role } = req.body || {};
  if (!['user','admin'].includes(role)) return badRequest(res, 'Role must be "user" or "admin"');
  const isAdmin = role === 'admin';
  const { rows } = await q(`UPDATE users SET role=$1,is_admin=$2 WHERE id=$3 RETURNING id,role,is_admin`, [role, isAdmin, req.params.id]);
  if (!rows[0]) return badRequest(res, 'User not found', 404);
  res.json({ ok: true, ...rows[0] });
}));

router.patch('/admin/users/:id/trust', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  const { trusted = true } = req.body || {};
  const { rows } = await q(`UPDATE users SET trusted=$1 WHERE id=$2 RETURNING id,trusted`, [!!trusted, req.params.id]);
  if (!rows[0]) return badRequest(res, 'User not found', 404);
  res.json({ ok: true, trusted: rows[0].trusted });
}));

router.get('/admin/artifacts', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT a.id,a.name,a.type,a.subdomain,a.status,a.review_status,a.updated_at,a.published_at,u.username,u.email
    FROM artifacts a JOIN users u ON u.id=a.user_id ORDER BY a.updated_at DESC LIMIT 200
  `);
  res.json({ artifacts: rows });
}));

router.post('/admin/artifacts/:id/approve', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(
    `UPDATE artifacts SET status='published',review_status='approved',published_at=now() WHERE id=$1 RETURNING id,user_id`,
    [req.params.id]
  );
  if (!rows[0]) return badRequest(res, 'Artifact not found', 404);
  await q('UPDATE users SET trusted=TRUE WHERE id=$1', [rows[0].user_id]);
  await q(`UPDATE artifacts SET live_pages=pages,live_css=css,live_js=js,live_hash=draft_hash WHERE id=$1 AND live_pages IS NULL`, [req.params.id]);
  res.json({ ok: true });
}));

router.post('/admin/artifacts/:id/suspend', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  await q(`UPDATE artifacts SET status='suspended' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

router.post('/admin/artifacts/:id/restore', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  await q(`UPDATE artifacts SET status='published',review_status='approved' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

router.delete('/admin/artifacts/:id', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  await q('DELETE FROM artifacts WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

router.get('/admin/reports', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT r.id,r.reason,r.message,r.created_at,r.status,
           a.id AS artifact_id,a.name AS artifact_name,a.subdomain
    FROM reports r JOIN artifacts a ON a.id=r.artifact_id
    ORDER BY r.created_at DESC LIMIT 500
  `);
  res.json({ reports: rows });
}));

router.patch('/admin/reports/:id/close', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  await q(`UPDATE reports SET status='closed' WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

router.get('/admin/pending', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT a.id,a.name,a.type,a.subdomain,a.updated_at,u.username,u.email
    FROM artifacts a JOIN users u ON u.id=a.user_id
    WHERE a.review_status='pending' ORDER BY a.updated_at ASC
  `);
  res.json({ artifacts: rows });
}));

// ══════════════════════════════════════════════════════════════════
//  REPORT (public — artifact subdomains POST here)
// ══════════════════════════════════════════════════════════════════

const VALID_REASONS = Object.freeze(['spam','phishing','malware','misinformation','illegal','harassment','other']);

router.post('/report', requireDB, reportLimiter, wrap(async (req, res) => {
  const { reason = '', message = '', 'cf-turnstile-response': turnstileToken = '' } = req.body || {};
  const artifactId = req.artifactId;
  if (!artifactId) return badRequest(res, 'Bad request');
  if (!VALID_REASONS.includes(reason)) return badRequest(res, 'Invalid reason');

  const ip = req.headers['cf-connecting-ip'] || req.ip || '';
  const ipHash = hashIp(ip);

  if (C.TURNSTILE_SECRET) {
    const { ok } = await verifyTurnstile(turnstileToken, ip);
    if (!ok) return res.status(403).json({ error: 'Bot check failed. Please try again.' });
  }

  await q(`INSERT INTO reports (artifact_id,reason,message,reporter_ip_hash) VALUES ($1,$2,$3,$4)`,
    [artifactId, reason, String(message).slice(0, 500), ipHash]);

  const { rows } = await q(
    `SELECT COUNT(DISTINCT reporter_ip_hash) AS n FROM reports WHERE artifact_id=$1 AND status='open'`,
    [artifactId]
  );
  if (Number(rows[0].n) >= 3) {
    await q(`UPDATE artifacts SET status='suspended' WHERE id=$1 AND status!='suspended'`, [artifactId]);
  }

  if (C.ADMIN_EMAIL) {
    const { rows: art } = await q('SELECT name,subdomain FROM artifacts WHERE id=$1', [artifactId]);
    if (art[0]) {
      mail.send(C.ADMIN_EMAIL, `Report received: ${esc(art[0].name)} — Biswa Artifacts`,
        `<p>New report. Artifact: ${esc(art[0].name)} (${esc(art[0].subdomain)}.${esc(C.BASE)})<br>Reason: ${esc(reason)}</p>
         <p><a href="${esc(C.SITE_URL)}/admin">Review →</a></p>`
      ).catch(e => console.error('[mail] report notify:', e.message));
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
