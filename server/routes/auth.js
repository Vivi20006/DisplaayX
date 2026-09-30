'use strict';

const express = require('express');
const QRCode = require('qrcode');
const { db } = require('../db');
const config = require('../config');
const mailer = require('../lib/mailer');
const totp = require('../lib/totp');
const { encrypt, decrypt } = require('../lib/crypto');
const { rateLimit } = require('../lib/rateLimit');
const { requireAuth } = require('../lib/auth');
const users = require('../lib/users');
const twoFactor = require('../lib/twoFactor');

const router = express.Router();

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const emailKey = (req) => users.normalizeEmail(req.body?.email);

function str(v, max = 500) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

async function sendVerificationMail(user) {
  const token = users.createEmailToken(user.id, 'verify', 24 * HOUR);
  const url = `${config.publicUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  try {
    await mailer.sendVerification(user.email, url);
  } catch (err) {
    console.error('[mail] verification mail failed:', err.message);
  }
}

/** Either the finished session or the "enter your 2FA code" step. */
function loginResponse(user) {
  if (user.totp_enabled) {
    return { needs2fa: true, twoFactorToken: users.signTwoFactor(user) };
  }
  const fresh = users.touchLogin(user.id);
  return { token: users.signSession(fresh), user: users.publicUser(fresh) };
}

/** Re-authentication for sensitive actions: password (if set) and 2FA code (if enabled). */
async function reauth(user, body) {
  if (user.password_hash && !(await users.checkPassword(str(body.password, 200), user.password_hash))) {
    return 'Your current password is incorrect.';
  }
  if (user.totp_enabled && !twoFactor.checkSecondFactor(user, str(body.code, 40))) {
    return 'The authentication code is incorrect.';
  }
  return null;
}

// ---- register / login -----------------------------------------------------

router.post('/register', rateLimit({ name: 'register', max: 10, windowMs: HOUR }), async (req, res) => {
  const email = users.normalizeEmail(req.body?.email);
  const username = str(req.body?.username, 100).trim();
  const password = req.body?.password;

  if (!users.validateEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!users.validateUsername(username)) {
    return res.status(400).json({ error: 'Username: 3–24 characters, letters, numbers, _ . - only.' });
  }
  const pwProblem = users.passwordProblem(password);
  if (pwProblem) return res.status(400).json({ error: pwProblem });

  if (users.findByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
  if (users.findByUsername(username)) return res.status(409).json({ error: 'This username is taken.' });

  const hash = await users.hashPassword(password);
  let user;
  try {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO users (email, username, password_hash, auth_provider) VALUES (?, ?, ?, 'email')")
      .run(email, username, hash);
    user = users.findById(Number(lastInsertRowid));
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return res.status(409).json({ error: 'Email or username already in use.' });
    throw err;
  }

  await sendVerificationMail(user);
  res.status(201).json({ token: users.signSession(user), user: users.publicUser(user), needsVerification: true });
});

router.post(
  '/login',
  rateLimit({ name: 'login-ip', max: 30, windowMs: 15 * MIN }),
  rateLimit({ name: 'login', max: 8, windowMs: 15 * MIN, key: emailKey }),
  async (req, res) => {
    const user = users.findByEmail(req.body?.email);
    const password = str(req.body?.password, 200);

    const ok = user?.password_hash
      ? await users.checkPassword(password, user.password_hash)
      : (await users.checkPassword(password, users.DUMMY_HASH), false);

    if (!ok) {
      return res.status(401).json({
        error: 'Wrong email or password. If you signed up with Google or Discord, use that button instead.',
      });
    }
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email before signing in.', needsVerification: true });
    }
    res.json(loginResponse(user));
  },
);

/** Second login step when 2FA is on (email login and OAuth). */
router.post('/2fa/verify', rateLimit({ name: '2fa-login', max: 10, windowMs: 15 * MIN }), (req, res) => {
  const user = users.userFromToken(str(req.body?.twoFactorToken, 2000), '2fa');
  if (!user) return res.status(401).json({ error: 'This sign-in expired. Please sign in again.', expired: true });
  const method = twoFactor.checkSecondFactor(user, str(req.body?.code, 40));
  if (!method) return res.status(401).json({ error: 'That code didn’t work. Check your authenticator app and try again.' });

  const fresh = users.touchLogin(user.id);
  res.json({
    token: users.signSession(fresh),
    user: users.publicUser(fresh),
    ...(method === 'recovery' ? { recoveryCodesLeft: twoFactor.remainingRecoveryCodes(user.id) } : {}),
  });
});

// ---- email verification ---------------------------------------------------

router.post(
  '/resend-verification',
  rateLimit({ name: 'resend', max: 5, windowMs: HOUR, key: emailKey }),
  async (req, res) => {
    const user = users.findByEmail(req.body?.email);
    if (user && !user.email_verified) await sendVerificationMail(user);
    // Same answer either way – don't reveal which emails have accounts.
    res.json({ sent: true });
  },
);

router.get('/verify', (req, res) => {
  const userId = users.consumeEmailToken(String(req.query.token || ''), 'verify');
  if (!userId) return res.redirect(302, '/login?verified=0');
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  res.redirect(302, '/login?verified=1');
});

// ---- password reset -------------------------------------------------------

router.post(
  '/forgot-password',
  rateLimit({ name: 'forgot', max: 5, windowMs: HOUR, key: emailKey }),
  async (req, res) => {
    const user = users.findByEmail(req.body?.email);
    if (user) {
      const token = users.createEmailToken(user.id, 'reset', HOUR);
      const url = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
      try {
        await mailer.sendPasswordReset(user.email, url);
      } catch (err) {
        console.error('[mail] reset mail failed:', err.message);
      }
    }
    res.json({ sent: true });
  },
);

router.get('/reset-password/check', (req, res) => {
  res.json({ valid: users.peekEmailToken(String(req.query.token || ''), 'reset') });
});

router.post('/reset-password', rateLimit({ name: 'reset', max: 10, windowMs: HOUR }), async (req, res) => {
  const pwProblem = users.passwordProblem(req.body?.newPassword);
  if (pwProblem) return res.status(400).json({ error: pwProblem });
  const userId = users.consumeEmailToken(str(req.body?.token, 300), 'reset');
  if (!userId) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });

  const hash = await users.hashPassword(req.body.newPassword);
  // The link proves ownership of the inbox, so the address counts as verified now.
  db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(hash, userId);
  users.bumpTokenVersion(userId); // sign out all existing sessions
  res.json({ success: true });
});

// ---- signed-in account ----------------------------------------------------

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: users.publicUser(req.user) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const user = req.user;
  const pwProblem = users.passwordProblem(req.body?.newPassword);
  if (pwProblem) return res.status(400).json({ error: pwProblem });

  if (user.password_hash) {
    const ok = await users.checkPassword(str(req.body?.currentPassword, 200), user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  const hash = await users.hashPassword(req.body.newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  // Other devices get signed out; this one receives a fresh token.
  const fresh = users.bumpTokenVersion(user.id);
  res.json({ success: true, token: users.signSession(fresh) });
});

router.post('/logout-all', requireAuth, (req, res) => {
  users.bumpTokenVersion(req.user.id);
  res.json({ success: true });
});

router.delete('/account', requireAuth, async (req, res) => {
  const user = req.user;
  if (str(req.body?.confirm, 100).toLowerCase() !== user.username.toLowerCase()) {
    return res.status(400).json({ error: 'Type your username to confirm.' });
  }
  const problem = await reauth(user, req.body || {});
  if (problem) return res.status(400).json({ error: problem });
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ success: true });
});

// ---- two-factor management ------------------------------------------------

router.get('/2fa', requireAuth, (req, res) => {
  res.json({
    enabled: !!req.user.totp_enabled,
    recoveryCodesLeft: req.user.totp_enabled ? twoFactor.remainingRecoveryCodes(req.user.id) : 0,
  });
});

router.post('/2fa/setup', requireAuth, async (req, res) => {
  const user = req.user;
  if (user.totp_enabled) return res.status(400).json({ error: 'Two-factor authentication is already on.' });
  if (user.password_hash && !(await users.checkPassword(str(req.body?.password, 200), user.password_hash))) {
    return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  const secret = totp.generateSecret();
  db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(encrypt(secret), user.id);
  const otpauthUrl = totp.otpauthUrl(secret, user.email);
  const qr = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220, color: { dark: '#0d1420', light: '#ffffff' } });
  res.json({ secret, otpauthUrl, qr });
});

router.post('/2fa/enable', requireAuth, rateLimit({ name: '2fa-enable', max: 10, windowMs: 15 * MIN }), (req, res) => {
  const user = req.user;
  if (user.totp_enabled) return res.status(400).json({ error: 'Two-factor authentication is already on.' });
  if (!user.totp_pending) return res.status(400).json({ error: 'Start the setup first.' });
  const secret = decrypt(user.totp_pending);
  const step = totp.verify(secret, str(req.body?.code, 20));
  if (step === null) return res.status(400).json({ error: 'That code didn’t work. Check the time on your phone and try again.' });

  db.prepare('UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1, totp_last_step = ? WHERE id = ?')
    .run(user.totp_pending, step, user.id);
  const recoveryCodes = twoFactor.generateRecoveryCodes(user.id);
  res.json({ enabled: true, recoveryCodes });
});

router.post('/2fa/disable', requireAuth, rateLimit({ name: '2fa-disable', max: 10, windowMs: 15 * MIN }), async (req, res) => {
  const user = req.user;
  if (!user.totp_enabled) return res.status(400).json({ error: 'Two-factor authentication is not on.' });
  const problem = await reauth(user, req.body || {});
  if (problem) return res.status(400).json({ error: problem });
  db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_last_step = 0 WHERE id = ?').run(user.id);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
  res.json({ enabled: false });
});

router.post('/2fa/recovery-codes', requireAuth, rateLimit({ name: '2fa-codes', max: 10, windowMs: 15 * MIN }), (req, res) => {
  const user = req.user;
  if (!user.totp_enabled) return res.status(400).json({ error: 'Two-factor authentication is not on.' });
  if (!twoFactor.checkSecondFactor(user, str(req.body?.code, 40))) {
    return res.status(400).json({ error: 'The authentication code is incorrect.' });
  }
  res.json({ recoveryCodes: twoFactor.generateRecoveryCodes(user.id) });
});

module.exports = router;
