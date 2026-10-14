/**
 * server/config.js
 * Centralised configuration derived from environment variables.
 * All code should import this module instead of reading process.env directly.
 */

'use strict';

require('dotenv').config();

const E = process.env;

// ── Subdomains that cannot be used for published artifacts ──────────────────
// (The full canonical list lives in server/names.js; this is kept for
//  backward-compat in case any old code still reads C.RESERVED.)
const RESERVED = Object.freeze([
  'www', 'api', 'admin', 'app', 'mail', 'files', 'cdn',
  'static', 'login', 'studio', 'ftp', 'smtp',
]);

// ── Quota defaults ──────────────────────────────────────────────────────────
const MAX_PUBLISHED_PER_USER   = Number(E.MAX_PUBLISHED_PER_USER)   || 3;
const MAX_ARTIFACTS_PER_USER   = Number(E.MAX_ARTIFACTS_PER_USER)   || 20;
const MAX_ARTIFACT_BYTES       = Number(E.MAX_ARTIFACT_BYTES)       || 512_000;
const MAX_STORAGE_PER_USER_MB  = Number(E.MAX_STORAGE_PER_USER_MB)  || 100;
const MAX_IMAGES_PER_USER      = Number(E.MAX_IMAGES_PER_USER)      || 50;
const MAX_IMAGE_BYTES          = Number(E.MAX_IMAGE_BYTES)          || 10 * 1024 * 1024;

// ── New: per-user storage quotas (separate for images and files) ────────────
// MAX_IMAGE_STORAGE_MB: total Cloudinary image storage per user in MB
const MAX_IMAGE_STORAGE_MB     = Number(E.MAX_IMAGE_STORAGE_MB)     || 10;
// MAX_FILE_STORAGE_MB: total R2 file storage per user in MB
const MAX_FILE_STORAGE_MB      = Number(E.MAX_FILE_STORAGE_MB)      || 20;

// ── AI rate limit defaults ──────────────────────────────────────────────────
// AI_RATE_WINDOW_MIN: rolling window in minutes for per-user AI rate limit
const AI_RATE_WINDOW_MIN       = Number(E.AI_RATE_WINDOW_MIN)       || 10;
// AI_RATE_LIMIT: max AI generation requests per user per window
const AI_RATE_LIMIT            = Number(E.AI_RATE_LIMIT)            || 15;
// AI_RATE_LIMIT_DAY: max AI generation requests per user per day
const AI_RATE_LIMIT_DAY        = Number(E.AI_RATE_LIMIT_DAY)        || 150;

module.exports = {
  /** Raw environment variables (use sparingly — prefer named exports below). */
  E,

  /** Primary domain, e.g. "biswa.io". */
  BASE: (E.BASE_DOMAIN || 'localhost').toLowerCase(),

  /** TCP port the server listens on. */
  PORT: Number(E.PORT) || 3000,

  /** Public-facing protocol ("https" in production). */
  PROTO: E.PUBLIC_PROTO || 'https',

  /** Public-facing port string (empty = default for protocol). */
  PPORT: E.PUBLIC_PORT || '',

  /** Full public origin URL, no trailing slash. */
  SITE_URL: (E.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),

  /** JWT signing secret — must be 16+ characters. */
  SECRET: E.JWT_SECRET || '',

  /** True when NODE_ENV === "production". */
  PROD: E.NODE_ENV === 'production',

  /**
   * Whether to set Secure flag on cookies.
   * Defaults to true in production, false in dev.
   */
  COOKIE_SECURE: E.COOKIE_SECURE !== undefined
    ? E.COOKIE_SECURE !== 'false'
    : E.NODE_ENV === 'production',

  /** Reserved subdomains list (legacy — prefer names.js). */
  RESERVED,

  // ── New feature flags ─────────────────────────────────────────────────────

  /**
   * Approval mode: "manual" = first publish is held for admin review;
   *                "auto"   = all publishes go live immediately.
   */
  APPROVAL_MODE: (E.APPROVAL_MODE || 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto',

  /** Admin email — the user whose email matches this becomes admin on login. */
  ADMIN_EMAIL: (E.ADMIN_EMAIL || '').toLowerCase(),

  // ── Cloudflare Turnstile ──────────────────────────────────────────────────

  /** Turnstile widget site key (public — sent to the browser). */
  TURNSTILE_SITE_KEY: E.TURNSTILE_SITE_KEY || '',

  /** Turnstile secret key (server-side verification). */
  TURNSTILE_SECRET: E.TURNSTILE_SECRET || '',

  // ── Quotas ────────────────────────────────────────────────────────────────

  /** Max published artifacts per user. */
  MAX_PUBLISHED_PER_USER,

  /** Max total artifacts per user (draft + published). */
  MAX_ARTIFACTS_PER_USER,

  /** Max total bytes for a single artifact (sum of all pages + css + js). */
  MAX_ARTIFACT_BYTES,

  /** Max R2 storage per user in megabytes (legacy — alias for MAX_FILE_STORAGE_MB). */
  MAX_STORAGE_PER_USER_MB,

  /** Max images per user (Cloudinary count limit). */
  MAX_IMAGES_PER_USER,

  /** Max single image upload size in bytes. */
  MAX_IMAGE_BYTES,

  /** Max total Cloudinary image storage per user in megabytes. */
  MAX_IMAGE_STORAGE_MB,

  /** Max total Cloudflare R2 file storage per user in megabytes. */
  MAX_FILE_STORAGE_MB,

  // ── AI settings ───────────────────────────────────────────────────────────

  /**
   * 32-byte (base64-encoded) master key for AES-256-GCM encryption of BYOK API keys.
   * Must be set in production. Generate with: openssl rand -base64 32
   */
  KEY_ENCRYPTION_SECRET: E.KEY_ENCRYPTION_SECRET || '',

  /** Rolling window in minutes for per-user AI generation rate limiting. */
  AI_RATE_WINDOW_MIN,

  /** Max AI generation requests per user per rolling window. */
  AI_RATE_LIMIT,

  /** Max AI generation requests per user per calendar day. */
  AI_RATE_LIMIT_DAY,

  // ── IP hashing secret ─────────────────────────────────────────────────────

  /**
   * Salt used when hashing reporter IP addresses.
   * Falls back to JWT_SECRET if not set (acceptable — still never stores raw IPs).
   */
  IP_SALT: E.IP_SALT || E.JWT_SECRET || 'changeme',
};
