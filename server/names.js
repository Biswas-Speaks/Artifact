/**
 * server/names.js
 * Subdomain / artifact name validation used by both the API and the
 * subdomain-check endpoint.
 *
 * Exports:
 *   validateSubdomain(name, isAdmin?)
 *     → { ok: true } | { ok: false, reason: string }
 */

'use strict';

const PROFANITY = require('./profanity');

// ── Reserved list ────────────────────────────────────────────────────────────
// Anything here can never be used by a regular user as a subdomain.
const RESERVED = Object.freeze(new Set([
  // Infrastructure / routing
  'www', 'api', 'mail', 'ftp', 'smtp', 'cdn', 'static', 'files',
  'assets', 'media', 'img', 'images', 'video', 'stream',
  // Auth / account
  'admin', 'login', 'signin', 'logout', 'signup', 'register',
  'secure', 'verify', 'account', 'auth', 'sso', 'oauth',
  // Support / billing
  'support', 'billing', 'help', 'status', 'docs', 'documentation',
  'legal', 'privacy', 'terms', 'abuse', 'dmca', 'report',
  // App routes
  'app', 'studio', 'root', 'dashboard', 'workspace', 'editor',
  // Well-known brands / squatting targets
  'paypal', 'google', 'apple', 'microsoft', 'amazon', 'bank',
  'wallet', 'facebook', 'twitter', 'instagram', 'tiktok', 'youtube',
  'netflix', 'github', 'gitlab',
  // Generic abusive / confusing
  'null', 'undefined', 'localhost', 'test', 'demo', 'example',
  'biswa', 'biswaio',
]));

// ── Pattern ──────────────────────────────────────────────────────────────────
// Allowed: lowercase letters, digits, single internal hyphens.
// 3–40 chars, no leading/trailing hyphen, no consecutive hyphens,
// no Punycode prefix (xn--).
const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9]|[a-z0-9]?)$/;

/**
 * Validate a proposed subdomain name.
 *
 * @param {string}  name     The proposed subdomain (already lower-cased).
 * @param {boolean} [isAdmin=false]  Admins bypass the "biswa" substring check.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validateSubdomain(name, isAdmin = false) {
  const n = String(name || '').toLowerCase().trim();

  // Length
  if (n.length < 3)  return { ok: false, reason: 'Subdomain must be at least 3 characters' };
  if (n.length > 40) return { ok: false, reason: 'Subdomain must be 40 characters or fewer' };

  // Character / format rules
  if (!SUBDOMAIN_RE.test(n)) {
    if (/[^a-z0-9-]/.test(n))         return { ok: false, reason: 'Only lowercase letters, numbers and hyphens are allowed' };
    if (n.startsWith('-') || n.endsWith('-')) return { ok: false, reason: 'Subdomain cannot start or end with a hyphen' };
    if (/--/.test(n))                  return { ok: false, reason: 'Subdomain cannot contain consecutive hyphens' };
    return { ok: false, reason: 'Invalid subdomain format' };
  }

  // Punycode IDNA prefix
  if (n.startsWith('xn--')) {
    return { ok: false, reason: 'Subdomain cannot begin with "xn--"' };
  }

  // Reserved list
  if (RESERVED.has(n)) {
    return { ok: false, reason: `"${n}" is a reserved subdomain` };
  }

  // "biswa" substring — admins are exempt (so admin can have "biswas-demo" etc.)
  if (!isAdmin && n.includes('biswa')) {
    return { ok: false, reason: `Subdomains containing "biswa" are reserved` };
  }

  // Profanity
  for (const word of PROFANITY) {
    if (n.includes(word)) {
      return { ok: false, reason: 'That subdomain is not allowed' };
    }
  }

  return { ok: true };
}

module.exports = { validateSubdomain, RESERVED };
