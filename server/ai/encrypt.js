/**
 * server/ai/encrypt.js
 * AES-256-GCM encryption/decryption helpers for BYOK API keys.
 *
 * Design decisions:
 *  - Master key comes from KEY_ENCRYPTION_SECRET (base64-encoded 32-byte value).
 *  - Each record gets a random 12-byte IV (GCM nonce). The IV is stored alongside
 *    the ciphertext so decryption does not require state beyond the record.
 *  - The GCM auth tag (16 bytes) is stored separately for explicit integrity check.
 *  - A key_version field is stored so we can rotate the master key later without
 *    breaking existing records (just re-encrypt them when loading).
 *  - The current key version is "1". Future rotation would bump this to "2", etc.
 *
 * Storage format (three separate columns in user_ai_settings):
 *   key_cipher  — hex-encoded ciphertext
 *   key_iv      — hex-encoded 12-byte nonce
 *   key_tag     — hex-encoded 16-byte GCM auth tag
 *
 * The key_version column (int) indicates which version of KEY_ENCRYPTION_SECRET
 * was used. Currently always 1; used by future rotation logic.
 */

'use strict';

const crypto = require('crypto');

const ALGORITHM    = 'aes-256-gcm';
const IV_BYTES     = 12; // 96-bit nonce — recommended for GCM
const KEY_VERSION  = 1;

/**
 * Derive the 32-byte encryption key from the environment.
 * Fails loudly if the secret is missing or malformed.
 * @returns {Buffer}
 */
function getMasterKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET || '';
  if (!secret) throw new Error('KEY_ENCRYPTION_SECRET is not set');

  let buf;
  try {
    buf = Buffer.from(secret, 'base64');
  } catch {
    throw new Error('KEY_ENCRYPTION_SECRET must be valid base64');
  }
  if (buf.length !== 32) {
    throw new Error(`KEY_ENCRYPTION_SECRET must decode to exactly 32 bytes (got ${buf.length})`);
  }
  return buf;
}

/**
 * Encrypt an API key.
 *
 * @param {string} plaintext  The raw API key string
 * @returns {{ cipher: string, iv: string, tag: string, version: number }}
 */
function encryptKey(plaintext) {
  const masterKey = getMasterKey();
  const iv        = crypto.randomBytes(IV_BYTES);
  const cipher    = crypto.createCipheriv(ALGORITHM, masterKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // 16 bytes

  return {
    cipher:  encrypted.toString('hex'),
    iv:      iv.toString('hex'),
    tag:     tag.toString('hex'),
    version: KEY_VERSION,
  };
}

/**
 * Decrypt an API key.
 *
 * @param {{ cipher: string, iv: string, tag: string }} record
 * @returns {string} The raw API key
 * @throws {Error} If decryption or auth-tag verification fails
 */
function decryptKey({ cipher, iv, tag }) {
  if (!cipher || !iv || !tag) {
    throw new Error('Incomplete encryption record — cannot decrypt');
  }
  const masterKey   = getMasterKey();
  const ivBuf       = Buffer.from(iv, 'hex');
  const tagBuf      = Buffer.from(tag, 'hex');
  const cipherBuf   = Buffer.from(cipher, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, ivBuf);
  decipher.setAuthTag(tagBuf); // throws if tampered

  const decrypted = Buffer.concat([
    decipher.update(cipherBuf),
    decipher.final(), // throws if auth tag mismatch
  ]);

  return decrypted.toString('utf8');
}

/**
 * Return the last 4 characters of a key for safe display.
 * Returns '••••' if the key is too short.
 *
 * @param {string} key
 * @returns {string}
 */
function keyLast4(key) {
  if (!key || key.length < 4) return '••••';
  return key.slice(-4);
}

/**
 * Validate that KEY_ENCRYPTION_SECRET is present and decodes to 32 bytes.
 * Called at startup. Throws on failure.
 */
function validateSecret() {
  getMasterKey(); // will throw with a clear message if wrong
}

module.exports = { encryptKey, decryptKey, keyLast4, validateSecret };
