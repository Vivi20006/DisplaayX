'use strict';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-the-config-check';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { outbox } = require('../server/lib/mailer');
const totp = require('../server/lib/totp');
const { resetRateLimits } = require('../server/lib/rateLimit');
const { upsertOAuthUser } = require('../server/routes/oauth');

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => resetRateLimits());

async function api(method, path, { body, token, redirect = 'follow' } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
}

function lastLink(pattern) {
  const mail = outbox[outbox.length - 1];
  const m = mail.text.match(pattern);
  assert.ok(m, 'link in mail');
  return m[0];
}

async function registerVerified(email, username, password = 'secret123') {
  const r = await api('POST', '/api/auth/register', { body: { email, username, password } });
  assert.equal(r.status, 201);
  const link = lastLink(/https?:\/\/\S+\/api\/auth\/verify\?token=\S+/);
  const v = await api('GET', new URL(link).pathname + new URL(link).search, { redirect: 'manual' });
  assert.equal(v.status, 302);
  assert.equal(v.headers.get('location'), '/login?verified=1');
}

test('register → verify → login → me', async () => {
  const reg = await api('POST', '/api/auth/register', {
    body: { email: 'Alice@Example.com', username: 'alice', password: 'secret123' },
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.needsVerification, true);
  assert.ok(reg.data.token);
  assert.equal(reg.data.user.email, 'alice@example.com');

  // Unverified: login refused with needsVerification, /me refused too.
  const early = await api('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'secret123' } });
  assert.equal(early.status, 403);
  assert.equal(early.data.needsVerification, true);
  assert.equal((await api('GET', '/api/auth/me', { token: reg.data.token })).status, 403);

  // Duplicate email / username
  assert.equal((await api('POST', '/api/auth/register', { body: { email: 'alice@example.com', username: 'x_alice', password: 'secret123' } })).status, 409);
  assert.equal((await api('POST', '/api/auth/register', { body: { email: 'other@example.com', username: 'ALICE', password: 'secret123' } })).status, 409);

  const link = lastLink(/https?:\/\/\S+\/api\/auth\/verify\?token=\S+/);
  const url = new URL(link);
  const v = await api('GET', url.pathname + url.search, { redirect: 'manual' });
  assert.equal(v.headers.get('location'), '/login?verified=1');
  // Token is single-use
  const v2 = await api('GET', url.pathname + url.search, { redirect: 'manual' });
  assert.equal(v2.headers.get('location'), '/login?verified=0');

  const bad = await api('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'wrong-pass' } });
  assert.equal(bad.status, 401);

  const login = await api('POST', '/api/auth/login', { body: { email: 'ALICE@example.com', password: 'secret123' } });
  assert.equal(login.status, 200);
  assert.ok(login.data.token);

  const me = await api('GET', '/api/auth/me', { token: login.data.token });
  assert.equal(me.status, 200);
  const u = me.data.user;
  for (const k of ['id', 'email', 'username', 'role', 'created_at', 'last_login', 'email_verified', 'auth_provider', 'has_password']) {
    assert.ok(k in u, `user.${k}`);
  }
  assert.equal(u.email_verified, true);
  assert.equal(u.auth_provider, 'email');
  assert.equal(u.has_password, true);
  assert.ok(u.last_login);

  assert.equal((await api('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
  assert.equal((await api('GET', '/api/auth/me')).status, 401);
});

test('validation errors', async () => {
  assert.equal((await api('POST', '/api/auth/register', { body: { email: 'nope', username: 'abc', password: 'secret123' } })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { body: { email: 'a@b.co', username: 'a b', password: 'secret123' } })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { body: { email: 'a@b.co', username: 'abc', password: '12345' } })).status, 400);
});

test('resend verification never reveals accounts', async () => {
  const r = await api('POST', '/api/auth/resend-verification', { body: { email: 'nobody@example.com' } });
  assert.deepEqual(r.data, { sent: true });
});

test('change password rotates sessions', async () => {
  await registerVerified('bob@example.com', 'bob');
  const { data: { token } } = await api('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: 'secret123' } });

  const wrong = await api('POST', '/api/auth/change-password', { token, body: { currentPassword: 'nope', newPassword: 'newpass123' } });
  assert.equal(wrong.status, 400);

  const ok = await api('POST', '/api/auth/change-password', { token, body: { currentPassword: 'secret123', newPassword: 'newpass123' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.success, true);
  assert.equal((await api('GET', '/api/auth/me', { token })).status, 401, 'old token revoked');
  assert.equal((await api('GET', '/api/auth/me', { token: ok.data.token })).status, 200, 'new token works');

  const login = await api('POST', '/api/auth/login', { body: { email: 'bob@example.com', password: 'newpass123' } });
  assert.equal(login.status, 200);
});

test('forgot / reset password', async () => {
  await registerVerified('carol@example.com', 'carol');
  const r = await api('POST', '/api/auth/forgot-password', { body: { email: 'carol@example.com' } });
  assert.deepEqual(r.data, { sent: true });
  const link = new URL(lastLink(/https?:\/\/\S+\/reset-password\?token=\S+/));
  const token = link.searchParams.get('token');

  assert.equal((await api('GET', `/api/auth/reset-password/check?token=${token}`)).data.valid, true);
  const reset = await api('POST', '/api/auth/reset-password', { body: { token, newPassword: 'fresh-pass' } });
  assert.equal(reset.status, 200);
  assert.equal((await api('POST', '/api/auth/reset-password', { body: { token, newPassword: 'again-pass' } })).status, 400);
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'carol@example.com', password: 'fresh-pass' } })).status, 200);
});

test('two-factor: setup, login, recovery code, disable', async () => {
  await registerVerified('dave@example.com', 'dave');
  const { data: { token } } = await api('POST', '/api/auth/login', { body: { email: 'dave@example.com', password: 'secret123' } });

  const setupBad = await api('POST', '/api/auth/2fa/setup', { token, body: { password: 'wrong' } });
  assert.equal(setupBad.status, 400);
  const setup = await api('POST', '/api/auth/2fa/setup', { token, body: { password: 'secret123' } });
  assert.equal(setup.status, 200);
  assert.match(setup.data.qr, /^data:image\/png;base64,/);
  assert.match(setup.data.otpauthUrl, /^otpauth:\/\/totp\//);
  const secret = setup.data.secret;

  assert.equal((await api('POST', '/api/auth/2fa/enable', { token, body: { code: '000000' } })).status, 400);
  const prev = totp.hotp(secret, totp.currentStep() - 1);
  const enable = await api('POST', '/api/auth/2fa/enable', { token, body: { code: prev } });
  assert.equal(enable.status, 200);
  assert.equal(enable.data.recoveryCodes.length, 10);
  const recovery = enable.data.recoveryCodes;

  // Password login now stops at the 2FA step.
  const step1 = await api('POST', '/api/auth/login', { body: { email: 'dave@example.com', password: 'secret123' } });
  assert.equal(step1.data.needs2fa, true);
  assert.equal(step1.data.token, undefined);

  // Replaying the code used at enable time fails; the current one works once.
  assert.equal((await api('POST', '/api/auth/2fa/verify', { body: { twoFactorToken: step1.data.twoFactorToken, code: prev } })).status, 401);
  const now = totp.hotp(secret, totp.currentStep());
  const step2 = await api('POST', '/api/auth/2fa/verify', { body: { twoFactorToken: step1.data.twoFactorToken, code: now } });
  assert.equal(step2.status, 200);
  assert.ok(step2.data.token);
  assert.equal((await api('POST', '/api/auth/2fa/verify', { body: { twoFactorToken: step1.data.twoFactorToken, code: now } })).status, 401);

  // A 2FA token is not a session token.
  assert.equal((await api('GET', '/api/auth/me', { token: step1.data.twoFactorToken })).status, 401);

  // Recovery code works exactly once, in any formatting.
  const again = await api('POST', '/api/auth/login', { body: { email: 'dave@example.com', password: 'secret123' } });
  const rc = await api('POST', '/api/auth/2fa/verify', { body: { twoFactorToken: again.data.twoFactorToken, code: recovery[0].toUpperCase() } });
  assert.equal(rc.status, 200);
  assert.equal(rc.data.recoveryCodesLeft, 9);
  const rc2 = await api('POST', '/api/auth/2fa/verify', { body: { twoFactorToken: again.data.twoFactorToken, code: recovery[0] } });
  assert.equal(rc2.status, 401);

  const me = await api('GET', '/api/auth/me', { token: rc.data.token });
  assert.equal(me.data.user.two_factor_enabled, true);

  // Disable needs password + a code.
  const t = rc.data.token;
  assert.equal((await api('POST', '/api/auth/2fa/disable', { token: t, body: { password: 'secret123', code: '123456' } })).status, 400);
  const dis = await api('POST', '/api/auth/2fa/disable', { token: t, body: { password: 'secret123', code: recovery[1] } });
  assert.equal(dis.status, 200);
  const plain = await api('POST', '/api/auth/login', { body: { email: 'dave@example.com', password: 'secret123' } });
  assert.ok(plain.data.token);
});

test('oauth linking drops an unproven password on an unverified account', async () => {
  // Attacker pre-registers the victim's address but can't verify it.
  await api('POST', '/api/auth/register', { body: { email: 'victim@example.com', username: 'squatter', password: 'attacker1' } });
  const user = upsertOAuthUser('google', { id: 'g-123', email: 'victim@example.com', verified: true, name: 'Victim' });
  assert.equal(user.email_verified, 1);
  assert.equal(user.password_hash, null);
  assert.equal(user.google_id, 'g-123');
  const login = await api('POST', '/api/auth/login', { body: { email: 'victim@example.com', password: 'attacker1' } });
  assert.equal(login.status, 401);

  // A fresh Discord user gets a unique username.
  const d1 = upsertOAuthUser('discord', { id: 'd-1', email: 'x1@example.com', verified: true, name: 'victim' });
  assert.equal(d1.auth_provider, 'discord');
  assert.equal(d1.has_password, undefined);
  const d2 = upsertOAuthUser('discord', { id: 'd-2', email: 'x2@example.com', verified: true, name: 'victim' });
  assert.notEqual(d1.username, d2.username);
  assert.equal(upsertOAuthUser('discord', { id: 'd-1', email: 'x1@example.com', verified: true }).id, d1.id);
});

test('oauth start without credentials sends the user back to login', async () => {
  const r = await api('GET', '/api/oauth/google', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login?error=provider_unavailable');
});

test('delete account', async () => {
  await registerVerified('erin@example.com', 'erin');
  const { data: { token } } = await api('POST', '/api/auth/login', { body: { email: 'erin@example.com', password: 'secret123' } });
  assert.equal((await api('DELETE', '/api/auth/account', { token, body: { confirm: 'erin', password: 'bad' } })).status, 400);
  assert.equal((await api('DELETE', '/api/auth/account', { token, body: { confirm: 'erin', password: 'secret123' } })).status, 200);
  assert.equal((await api('GET', '/api/auth/me', { token })).status, 401);
});

test('download requires a signed link', async () => {
  const info = await api('GET', '/api/download/info');
  assert.equal(info.data.version, '1.1.0');
  const r = await api('GET', '/api/download/file?t=bogus', { redirect: 'manual' });
  assert.equal(r.headers.get('location'), '/dashboard?download=expired');
  assert.equal((await api('POST', '/api/download/link')).status, 401);
});

test('pages and 404', async () => {
  for (const p of ['/', '/login', '/register', '/dashboard', '/forgot-password', '/reset-password']) {
    const r = await api('GET', p);
    assert.equal(r.status, 200, p);
    assert.match(r.data, /<!doctype html>/i);
  }
  assert.equal((await api('GET', '/does-not-exist')).status, 404);
  assert.equal((await api('GET', '/api/nope')).status, 404);
});

test('login is rate limited per email', async () => {
  let last;
  for (let i = 0; i < 10; i++) {
    last = await api('POST', '/api/auth/login', { body: { email: 'target@example.com', password: `guess${i}xx` } });
  }
  assert.equal(last.status, 429);
});
