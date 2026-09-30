'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

if (config.dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}

const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    username          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash     TEXT,
    role              TEXT NOT NULL DEFAULT 'user',
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_login        TEXT,
    email_verified    INTEGER NOT NULL DEFAULT 0,
    auth_provider     TEXT NOT NULL DEFAULT 'email',
    google_id         TEXT UNIQUE,
    discord_id        TEXT UNIQUE,
    totp_secret       TEXT,
    totp_pending      TEXT,
    totp_enabled      INTEGER NOT NULL DEFAULT 0,
    totp_last_step    INTEGER NOT NULL DEFAULT 0,
    token_version     INTEGER NOT NULL DEFAULT 0
  );

  -- One-time tokens for email verification and password reset (stored hashed).
  CREATE TABLE IF NOT EXISTS email_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recovery_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    used_at     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, purpose);
  CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);
`);

/** Run fn inside a transaction. */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, tx };
