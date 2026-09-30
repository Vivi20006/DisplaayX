'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const config = require('../config');
const { randomToken, sha256 } = require('./crypto');

const BCRYPT_COST = config.isTest ? 4 : 12;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateEmail(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

function validateUsername(username) {
  return USERNAME_RE.test(username);
}

/** Returns an error message or null. min 6 is part of the API contract. */
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 6) return 'Password must be at least 6 characters.';
  // bcrypt only looks at the first 72 bytes – refuse longer ones instead of silently truncating.
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password is too long (max 72 bytes).';
  return null;
}

const hashPassword = (pw) => bcrypt.hash(pw, BCRYPT_COST);
const checkPassword = (pw, hash) => (hash ? bcrypt.compare(String(pw || ''), hash) : Promise.resolve(false));

// A fixed hash to compare against when the user doesn't exist, so response time doesn't reveal it.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

const findById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const findByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
const findByUsername = (name) => db.prepare('SELECT * FROM users WHERE username = ?').get(name);

/** Public shape returned by /me, /login etc. */
function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    created_at: u.created_at,
    last_login: u.last_login,
    email_verified: !!u.email_verified,
    auth_provider: u.auth_provider,
    has_password: !!u.password_hash,
    two_factor_enabled: !!u.totp_enabled,
    linked_providers: [u.google_id && 'google', u.discord_id && 'discord'].filter(Boolean),
  };
}

function touchLogin(userId) {
  db.prepare("UPDATE users SET last_login = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(userId);
  return findById(userId);
}

// ---- tokens ---------------------------------------------------------------

function signSession(user) {
  return jwt.sign({ sub: String(user.id), tv: user.token_version, typ: 'session' }, config.jwtSecret, {
    expiresIn: config.sessionTtl,
  });
}

/** Short-lived token proving "password/OAuth step passed, 2FA still pending". */
function signTwoFactor(user) {
  return jwt.sign({ sub: String(user.id), tv: user.token_version, typ: '2fa' }, config.jwtSecret, { expiresIn: '5m' });
}

function signDownload(user) {
  return jwt.sign({ sub: String(user.id), typ: 'dl' }, config.jwtSecret, { expiresIn: '2m' });
}

/** Verify a JWT of the given type; returns the user or null. */
function userFromToken(token, typ) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.typ !== typ) return null;
    const user = findById(Number(payload.sub));
    if (!user) return null;
    if (payload.tv !== undefined && payload.tv !== user.token_version) return null;
    return user;
  } catch {
    return null;
  }
}

/** Invalidate every session/2FA token issued so far. */
function bumpTokenVersion(userId) {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  return findById(userId);
}

// ---- one-time email tokens ------------------------------------------------

function createEmailToken(userId, purpose, ttlMs) {
  const token = randomToken();
  db.prepare('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
  db.prepare('INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(
    userId, purpose, sha256(token), Date.now() + ttlMs,
  );
  return token;
}

/** Consume a token; returns the user id or null. */
function consumeEmailToken(token, purpose) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const row = db.prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ?').get(sha256(token), purpose);
  if (!row) return null;
  db.prepare('DELETE FROM email_tokens WHERE id = ?').run(row.id);
  return row.expires_at > Date.now() ? row.user_id : null;
}

function peekEmailToken(token, purpose) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return false;
  const row = db.prepare('SELECT expires_at FROM email_tokens WHERE token_hash = ? AND purpose = ?').get(sha256(token), purpose);
  return !!row && row.expires_at > Date.now();
}

/** Derive a free, valid username from a provider name / email. */
function uniqueUsername(base) {
  let clean = String(base || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .slice(0, 20);
  if (clean.length < 3) clean = `player${clean}`;
  if (!findByUsername(clean)) return clean;
  for (let i = 0; i < 50; i++) {
    const candidate = `${clean.slice(0, 19)}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!findByUsername(candidate)) return candidate;
  }
  return `player${randomToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`;
}

module.exports = {
  normalizeEmail, validateEmail, validateUsername, passwordProblem,
  hashPassword, checkPassword, DUMMY_HASH,
  findById, findByEmail, findByUsername, publicUser, touchLogin,
  signSession, signTwoFactor, signDownload, userFromToken, bumpTokenVersion,
  createEmailToken, consumeEmailToken, peekEmailToken, uniqueUsername,
};
