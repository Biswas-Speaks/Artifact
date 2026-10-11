/**
 * server/api.js
 * REST API router — mounted at /api by server/app.js.
 *
 * Sections:
 *   Auth          POST /auth/login  /auth/logout  /auth/forgot  /auth/reset
 *   Session       GET  /me          GET /config
 *   Artifacts     CRUD + publish/unpublish
 *   Files         Cloudflare R2 presigned-URL upload flow
 *   Images        Cloudinary direct upload
 *   Settings      Profile + password change
 *   Admin         User management (admin role only)
 */

'use strict';

const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const cloudinary = require('cloudinary').v2;

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const { q, isReady } = require('./db');
const C              = require('./config');

/** Middleware: reject requests that need the DB when it isn't ready yet. */
const requireDB = (_req, res, next) => {
  if (isReady()) return next();
  res.status(503).json({ error: 'Database not ready yet. Please try again shortly.' });
};
const mail    = require('./mail');
const TPL     = require('./templates');

const router = express.Router();

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Wrap an async route handler so thrown errors reach the error middleware. */
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** Send a JSON error response. */
const badRequest = (res, msg, code = 400) => res.status(code).json({ error: msg });

/** UUID v4 pattern for route param validation. */
const UUID_RE = /^[0-9a-f-]{36}$/i;

/** SHA-256 hex digest (for token hashing). */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Validate that :id looks like a UUID before hitting the DB. */
const requireUUID = (req, res, next) =>
  UUID_RE.test(req.params.id) ? next() : badRequest(res, 'Invalid id', 404);

// ── Auth middleware ─────────────────────────────────────────────────────────

/**
 * Verify the session cookie and attach req.uid.
 * Returns 401 if missing or invalid.
 */
const requireAuth = (req, res, next) => {
  try {
    req.uid = jwt.verify(req.cookies.sid, C.SECRET).uid;
    next();
  } catch {
    badRequest(res, 'Not signed in', 401);
  }
};

/**
 * Verify that req.uid belongs to an admin user.
 * Must be used after requireAuth.
 */
const requireAdmin = wrap(async (req, res, next) => {
  const { rows } = await q('SELECT role FROM users WHERE id = $1', [req.uid]);
  if (rows[0]?.role !== 'admin') return badRequest(res, 'Admin only', 403);
  next();
});

// ── Rate limiter for auth endpoints ────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
  message: { error: 'Too many attempts. Try again later.' },
});

// ── Cookie helper ───────────────────────────────────────────────────────────

/** Set a 7-day HttpOnly session cookie containing a signed JWT. */
const setSessionCookie = (res, userId) =>
  res.cookie(
    'sid',
    jwt.sign({ uid: userId }, C.SECRET, { expiresIn: '7d' }),
    { httpOnly: true, sameSite: 'lax', secure: C.COOKIE_SECURE, maxAge: 7 * 864e5 }
  );

// ══════════════════════════════════════════════════════════════════
//  PUBLIC ENDPOINTS
// ══════════════════════════════════════════════════════════════════

/** App configuration for the SPA (base domain, protocol, etc.). */
router.get('/config', (_req, res) =>
  res.json({ base: C.BASE, proto: C.PROTO, port: C.PPORT, signup: false })
);

/** Return the currently signed-in user, or null. */
router.get('/me', wrap(async (req, res) => {
  // If DB isn't ready, just say not signed in — homepage still loads fine
  if (!isReady()) return res.json({ user: null });
  try {
    const uid = jwt.verify(req.cookies.sid, C.SECRET).uid;
    const { rows } = await q(
      'SELECT id, username, email, full_name, role, must_change_password FROM users WHERE id = $1 AND active = TRUE',
      [uid]
    );
    return res.json({ user: rows[0] || null });
  } catch {
    res.json({ user: null });
  }
}));

// ── Authentication ──────────────────────────────────────────────────────────

/** Signups are disabled — accounts are created by admin only. */
router.post('/auth/signup', (_req, res) =>
  badRequest(res, 'Sign-ups are closed. Contact your admin.', 403)
);

router.post('/auth/login', requireDB, authLimiter, wrap(async (req, res) => {
  const { username = '', password = '' } = req.body || {};

  const { rows } = await q(
    'SELECT id, username, email, full_name, role, password_hash, active, must_change_password FROM users WHERE username = $1 OR email = $1',
    [String(username).toLowerCase()]
  );
  const user = rows[0];

  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    return badRequest(res, 'Wrong username or password', 401);
  }
  if (!user.active) {
    return badRequest(res, 'Your account has been deactivated. Contact admin.', 403);
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
    const token    = crypto.randomBytes(32).toString('hex');
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

  // Always respond 200 — prevents email enumeration
  res.json({ ok: true });
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

// ══════════════════════════════════════════════════════════════════
//  ARTIFACTS
// ══════════════════════════════════════════════════════════════════

/** Columns returned for list views (no page content). */
const ARTIFACT_COLS = 'id, name, type, subdomain, status, (pw_hash IS NOT NULL) AS locked, updated_at';

router.get('/artifacts', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT ${ARTIFACT_COLS} FROM artifacts WHERE user_id = $1 ORDER BY updated_at DESC`,
    [req.uid]
  );
  res.json({ items: rows });
}));

router.post('/artifacts', requireDB, requireAuth, wrap(async (req, res) => {
  const { name = 'Untitled', type = 'web' } = req.body || {};

  if (!TPL[type]) return badRequest(res, 'Unknown artifact type');

  const template = TPL[type]();
  const { rows } = await q(
    `INSERT INTO artifacts (user_id, name, type, pages, css, js)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [req.uid, String(name).slice(0, 80) || 'Untitled', type, JSON.stringify(template.pages), template.css, template.js]
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

  const { rowCount } = await q(
    `UPDATE artifacts
     SET name = $1, pages = $2, css = $3, js = $4, updated_at = now()
     WHERE id = $5 AND user_id = $6`,
    [String(name || 'Untitled').slice(0, 80), JSON.stringify(pages.map((p) => ({ n: p.n, h: p.h }))), String(css), String(js), req.params.id, req.uid]
  );
  rowCount ? res.json({ ok: true }) : badRequest(res, 'Artifact not found', 404);
}));

router.post('/artifacts/:id/publish', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  const { subdomain = '', protect = false, password = '' } = req.body || {};
  const sub = String(subdomain).toLowerCase().trim();

  if (!/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(sub)) {
    return badRequest(res, 'Subdomain: letters, numbers and hyphens only (max 40 chars)');
  }
  if (C.RESERVED.includes(sub)) {
    return badRequest(res, `"${sub}" is a reserved subdomain`);
  }

  const { rows: cur } = await q(
    'SELECT pw_hash FROM artifacts WHERE id = $1 AND user_id = $2',
    [req.params.id, req.uid]
  );
  if (!cur[0]) return badRequest(res, 'Artifact not found', 404);

  let pwHash = null;
  if (protect) {
    if (password)         pwHash = await bcrypt.hash(String(password), 10);
    else if (cur[0].pw_hash) pwHash = cur[0].pw_hash; // keep existing
    else return badRequest(res, 'A password is required when protect is true');
  }

  try {
    await q(
      `UPDATE artifacts
       SET subdomain = $1, status = 'published', pw_hash = $2, updated_at = now()
       WHERE id = $3 AND user_id = $4`,
      [sub, pwHash, req.params.id, req.uid]
    );
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'That subdomain is already taken', 409);
    throw err;
  }

  res.json({ ok: true, subdomain: sub, locked: !!pwHash });
}));

router.post('/artifacts/:id/unpublish', requireDB, requireAuth, requireUUID, wrap(async (req, res) => {
  await q(
    `UPDATE artifacts SET status = 'draft' WHERE id = $1 AND user_id = $2`,
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

/** Sanitise a file name for use as an R2 key segment. */
const sanitiseFileName = (name) =>
  String(name || '').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-').slice(0, 120);

/** Return a public URL or a 7-day signed GET URL for an R2 object key. */
const filePublicUrl = (key) =>
  C.E.R2_PUBLIC_URL
    ? `${C.E.R2_PUBLIC_URL.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`
    : getSignedUrl(s3, new GetObjectCommand({ Bucket: C.E.R2_BUCKET, Key: key }), { expiresIn: 7 * 86_400 });

router.post('/files/presign', requireDB, requireAuth, wrap(async (req, res) => {
  const name  = sanitiseFileName(req.body.name);
  const size  = Number(req.body.size) || 0;
  const mime  = String(req.body.type || 'application/octet-stream').slice(0, 100);

  if (!name) return badRequest(res, 'File name is required');
  if (size > 200 * 1024 * 1024) return badRequest(res, 'File too large (max 200 MB)');

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
  limits:  { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    /^image\//.test(file.mimetype)
      ? cb(null, true)
      : cb(Object.assign(new Error('Images only'), { status: 400 })),
});

/** Convert a name to a safe Cloudinary public_id slug. */
const toSlug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

router.get('/images', requireDB, requireAuth, wrap(async (req, res) => {
  const { rows } = await q(
    'SELECT id, name, url FROM images WHERE user_id = $1 ORDER BY created_at DESC',
    [req.uid]
  );
  res.json({ items: rows });
}));

router.post('/images', requireDB, requireAuth, imageUpload.single('file'), wrap(async (req, res) => {
  if (!req.file) return badRequest(res, 'No image received');

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
    'SELECT id, username, email, full_name, role, must_change_password FROM users WHERE id = $1',
    [req.uid]
  );
  rows[0] ? res.json(rows[0]) : badRequest(res, 'User not found', 404);
}));

router.put('/settings/profile', requireDB, requireAuth, wrap(async (req, res) => {
  const { full_name = '', email = '' } = req.body || {};

  if (!/^\S+@\S+\.\S+$/.test(email)) return badRequest(res, 'Enter a valid email address');

  try {
    const { rows } = await q(
      'UPDATE users SET full_name = $1, email = $2 WHERE id = $3 RETURNING id, username, email, full_name, role',
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

  // Skip current-password check only on a forced first-login change
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
//  ADMIN — user management
// ══════════════════════════════════════════════════════════════════

router.get('/admin/users', requireDB, requireAuth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await q(
    'SELECT id, username, email, full_name, role, active, created_at FROM users ORDER BY created_at ASC'
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
      `INSERT INTO users (username, email, password_hash, full_name, role, active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)
       RETURNING id, username, email, full_name, role, active`,
      [username.toLowerCase(), email.toLowerCase(), hash, String(full_name).slice(0, 80), role]
    );
    newUser = rows[0];
  } catch (err) {
    if (err.code === '23505') return badRequest(res, 'Username or email already exists', 409);
    throw err;
  }

  // Fire-and-forget welcome email
  mail.send(
    email,
    'Your Biswa Artifacts Account',
    `<div style="font-family:system-ui;max-width:480px;margin:auto;padding:32px;background:#0a0c14;color:#eef0f8;border-radius:16px">
      <h2 style="margin:0 0 8px">✦ Biswa Artifacts</h2>
      <p style="color:#97a0b8;margin:0 0 24px">Your account has been created.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr><td style="padding:8px 0;color:#97a0b8;font-size:13px">Username</td><td style="padding:8px 0;font-weight:600">${newUser.username}</td></tr>
        <tr><td style="padding:8px 0;color:#97a0b8;font-size:13px">Temp Password</td><td style="padding:8px 0;font-family:monospace;font-size:15px;letter-spacing:2px">${tempPassword}</td></tr>
      </table>
      <a href="${C.SITE_URL}/login" style="display:inline-block;background:linear-gradient(135deg,#6d5df6,#e84fb0);color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600">Sign in →</a>
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

router.delete('/admin/users/:id', requireDB, requireAuth, requireUUID, requireAdmin, wrap(async (req, res) => {
  if (req.params.id === req.uid) {
    return badRequest(res, 'You cannot delete your own account');
  }
  await q('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ── 404 + error handler ─────────────────────────────────────────────────────

router.use((_req, res) => badRequest(res, 'API endpoint not found', 404));

// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return badRequest(res, 'Image too large (max 10 MB)');
  if (err.status === 400)             return badRequest(res, err.message);
  console.error('[api] unhandled error:', err);
  badRequest(res, 'An unexpected error occurred', 500);
});

module.exports = router;
