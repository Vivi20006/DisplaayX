'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function list(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  if (isProd) {
    throw new Error('JWT_SECRET must be set to at least 32 characters in production.');
  }
  // Development only: a random secret means every restart signs everyone out.
  jwtSecret = crypto.randomBytes(48).toString('hex');
  if (!isTest) console.warn('[config] JWT_SECRET not set – using a random secret for this run.');
}

const publicUrl = (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, '');

module.exports = {
  isProd,
  isTest,
  port: Number(env.PORT) || 3000,
  publicUrl,
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
  corsOrigins: list(env.CORS_ORIGINS),

  jwtSecret,
  // Separate key for encrypting TOTP secrets at rest; derived from JWT_SECRET if not given.
  encryptionKey: crypto
    .createHash('sha256')
    .update(env.DATA_ENCRYPTION_KEY || `dx-totp:${jwtSecret}`)
    .digest(),
  sessionTtl: env.SESSION_TTL || '30d',

  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'displayx.db'),

  mail: {
    from: env.MAIL_FROM || 'DisplayX <no-reply@displayx.lol>',
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },

  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  },
  discord: {
    clientId: env.DISCORD_CLIENT_ID || '',
    clientSecret: env.DISCORD_CLIENT_SECRET || '',
  },

  download: {
    version: env.APP_VERSION || '1.1.0',
    sizeLabel: env.APP_SIZE_LABEL || '~69 MB',
    os: 'Windows 10 & 11, 64-bit',
    // Either serve a local file …
    file: env.DOWNLOAD_FILE || path.join(__dirname, '..', 'downloads', 'DisplayX.exe'),
    // … or redirect to a URL (e.g. a CDN / release asset). The URL wins if set.
    url: env.DOWNLOAD_URL || '',
  },
};
