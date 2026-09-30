'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db, tx } = require('../db');
const totp = require('./totp');
const { decrypt } = require('./crypto');

const RECOVERY_COUNT = 10;

/** Recovery codes look like "k7f3-9xq2" – short enough to type, 40 bits each. */
function makeRecoveryCode() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function normalizeRecovery(code) {
  return String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function generateRecoveryCodes(userId) {
  const codes = Array.from({ length: RECOVERY_COUNT }, makeRecoveryCode);
  tx(() => {
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
    const insert = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
    for (const c of codes) insert.run(userId, bcrypt.hashSync(normalizeRecovery(c), 8));
  });
  return codes;
}

function remainingRecoveryCodes(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId).n;
}

/**
 * Check a 6-digit TOTP code or a recovery code for a user with 2FA enabled.
 * Consumes recovery codes and blocks TOTP replays. Returns 'totp' | 'recovery' | null.
 */
function checkSecondFactor(user, code) {
  if (!user.totp_enabled || !user.totp_secret) return null;
  const raw = String(code || '').trim();

  if (/^\d{3}\s?\d{3}$/.test(raw)) {
    const step = totp.verify(decrypt(user.totp_secret), raw);
    if (step === null) return null;
    // Only accept codes newer than the last one used.
    const res = db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?').run(step, user.id, step);
    return res.changes === 1 ? 'totp' : null;
  }

  const normalized = normalizeRecovery(raw);
  if (normalized.length !== 8) return null;
  const rows = db.prepare('SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').all(user.id);
  for (const row of rows) {
    if (bcrypt.compareSync(normalized, row.code_hash)) {
      const res = db.prepare("UPDATE recovery_codes SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND used_at IS NULL").run(row.id);
      return res.changes === 1 ? 'recovery' : null;
    }
  }
  return null;
}

module.exports = { generateRecoveryCodes, remainingRecoveryCodes, checkSecondFactor };
