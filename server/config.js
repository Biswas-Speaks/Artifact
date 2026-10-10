/**
 * server/config.js
 * Centralised configuration derived from environment variables.
 * All code should import this module instead of reading process.env directly.
 */

'use strict';

require('dotenv').config();

const E = process.env;

/** Subdomains that cannot be used for published artifacts. */
const RESERVED = Object.freeze([
  'www', 'api', 'admin', 'app', 'mail', 'files', 'cdn',
  'static', 'login', 'studio', 'ftp', 'smtp',
]);

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

  /** Reserved subdomains list. */
  RESERVED,
};
