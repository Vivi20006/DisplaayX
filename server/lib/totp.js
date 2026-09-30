'use strict';

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) – compatible with Google Authenticator, Authy, 1Password, etc.

const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = str.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP);
}

/**
 * Check a code against the current step ± window.
 * Returns the matched step (so callers can block replays) or null.
 */
function verify(secret, code, { window = 1, now = Date.now() } = {}) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(secret, step + i);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(clean))) return step + i;
  }
  return null;
}

function otpauthUrl(secret, account, issuer = 'DisplayX') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP) });
  return `otpauth://totp/${label}?${params}`;
}

module.exports = { generateSecret, verify, otpauthUrl, hotp, currentStep, base32Encode, base32Decode };
