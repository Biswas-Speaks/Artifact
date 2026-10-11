/**
 * server/profanity.js
 * Basic profanity blocklist used by subdomain validation.
 *
 * This is intentionally a modest list covering the most common slurs/insults.
 * It checks whether any listed word is contained anywhere in the subdomain,
 * so "myass" and "asshole" are both blocked.
 *
 * Add words freely — all matching is done in lower-case.
 */

'use strict';

/** @type {string[]} */
const PROFANITY = [
  // English slurs & insults
  'fuck', 'shit', 'cunt', 'cock', 'dick', 'pussy', 'ass', 'bitch',
  'bastard', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'slut',
  'whore', 'piss', 'porn', 'sex', 'nude', 'naked', 'xxx',
  'dildo', 'anal', 'penis', 'vagina', 'sperm',

  // Hate / extremism
  'nazi', 'isis', 'jihad', 'terrorist',

  // Scam / abuse signals
  'phishing', 'malware', 'ransomware', 'botnet',
];

module.exports = PROFANITY;
