'use strict';

const express = require('express');
const { db } = require('../db');
const config = require('../config');
const users = require('../lib/users');
const { randomToken, safeEqual } = require('../lib/crypto');

const router = express.Router();

const STATE_COOKIE = 'dx_oauth_state';

const providers = {
  google: {
    ...config.google,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    extraAuthParams: { prompt: 'select_account' },
    async profile(accessToken) {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) throw new Error(`google userinfo ${r.status}`);
      const p = await r.json();
      return { id: p.sub, email: p.email, verified: p.email_verified === true, name: p.given_name || p.name || p.email?.split('@')[0] };
    },
  },
  discord: {
    ...config.discord,
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    extraAuthParams: { prompt: 'none' },
    async profile(accessToken) {
      const r = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!r.ok) throw new Error(`discord users/@me ${r.status}`);
      const p = await r.json();
      return { id: p.id, email: p.email, verified: p.verified === true, name: p.username || p.global_name };
    },
  },
};

const redirectUri = (name) => `${config.publicUrl}/api/oauth/${name}/callback`;

function readCookie(req, name) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https://'),
    path: '/api/oauth',
    maxAge: 10 * 60 * 1000,
  };
}

const fail = (res, code) => res.redirect(302, `/login?error=${code}`);

/** Find or create the local account for a provider identity. */
function upsertOAuthUser(name, profile) {
  const idColumn = name === 'google' ? 'google_id' : 'discord_id';
  const email = users.normalizeEmail(profile.email);

  let user = db.prepare(`SELECT * FROM users WHERE ${idColumn} = ?`).get(profile.id);
  if (user) return user;

  user = users.findByEmail(email);
  if (user) {
    if (!user.email_verified) {
      // Whoever registered this address never proved they own it. The provider just did,
      // so drop the unproven password to prevent a pre-registered account takeover.
      db.prepare(`UPDATE users SET ${idColumn} = ?, email_verified = 1, password_hash = NULL, auth_provider = ? WHERE id = ?`)
        .run(profile.id, name, user.id);
    } else {
      db.prepare(`UPDATE users SET ${idColumn} = ? WHERE id = ?`).run(profile.id, user.id);
    }
    return users.findById(user.id);
  }

  const username = users.uniqueUsername(profile.name || email.split('@')[0]);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO users (email, username, auth_provider, email_verified, ${idColumn}) VALUES (?, ?, ?, 1, ?)`)
    .run(email, username, name, profile.id);
  return users.findById(Number(lastInsertRowid));
}

router.get('/:provider', (req, res) => {
  const p = providers[req.params.provider];
  if (!p) return res.status(404).json({ error: 'Unknown provider.' });
  if (!p.clientId || !p.clientSecret) return fail(res, 'provider_unavailable');

  const state = randomToken(24);
  res.cookie(STATE_COOKIE, state, stateCookieOptions());
  const params = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: redirectUri(req.params.provider),
    response_type: 'code',
    scope: p.scope,
    state,
    ...p.extraAuthParams,
  });
  res.redirect(302, `${p.authorizeUrl}?${params}`);
});

router.get('/:provider/callback', async (req, res) => {
  const name = req.params.provider;
  const p = providers[name];
  if (!p) return res.status(404).json({ error: 'Unknown provider.' });

  const expected = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, { ...stateCookieOptions(), maxAge: undefined });

  if (req.query.error) return fail(res, 'oauth_cancelled');
  const { code, state } = req.query;
  if (!code || !state || !expected || !safeEqual(state, expected)) return fail(res, 'oauth_state');

  let profile;
  try {
    const tokenRes = await fetch(p.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: p.clientId,
        client_secret: p.clientSecret,
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(name),
      }),
    });
    if (!tokenRes.ok) throw new Error(`${name} token ${tokenRes.status}`);
    const { access_token: accessToken } = await tokenRes.json();
    profile = await p.profile(accessToken);
  } catch (err) {
    console.error('[oauth]', err.message);
    return fail(res, 'oauth_failed');
  }

  if (!profile.id || !profile.email || !users.validateEmail(users.normalizeEmail(profile.email))) {
    return fail(res, 'oauth_no_email');
  }
  if (!profile.verified) return fail(res, 'oauth_unverified');

  const user = upsertOAuthUser(name, profile);

  if (user.totp_enabled) {
    return res.redirect(302, `/login?twofa=${encodeURIComponent(users.signTwoFactor(user))}`);
  }
  const fresh = users.touchLogin(user.id);
  const params = new URLSearchParams({ token: users.signSession(fresh), email: fresh.email });
  res.redirect(302, `/dashboard?${params}`);
});

module.exports = router;
module.exports.upsertOAuthUser = upsertOAuthUser;
