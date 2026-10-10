/**
 * server/mail.js
 * Thin wrapper around Nodemailer for Gmail SMTP delivery.
 *
 * Uses a Google App Password (16 chars) — not the account password.
 * Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.
 */

'use strict';

const nodemailer = require('nodemailer');
const { E }      = require('./config');

const transport = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: E.GMAIL_USER,
    // App passwords may include spaces — strip them
    pass: (E.GMAIL_APP_PASSWORD || '').replace(/\s/g, ''),
  },
});

/**
 * Send an HTML email.
 * @param {string} to      Recipient address
 * @param {string} subject Email subject line
 * @param {string} html    HTML body
 * @returns {Promise<void>}
 */
exports.send = (to, subject, html) =>
  transport.sendMail({
    from: `Biswa Artifacts <${E.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
