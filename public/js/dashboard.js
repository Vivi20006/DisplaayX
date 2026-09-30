// Account dashboard: download, account details, password, 2FA, sessions, deletion.
(function () {
  'use strict';

  const { api, token, apiBase, $, $$, setLoading } = window.DX;

  let user = null;
  let recoveryCodes = [];

  const PROVIDERS = { email: 'Email', google: 'Google', discord: 'Discord' };

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  }

  function setAlert(box, type, message) {
    if (typeof box === 'string') box = $(box);
    if (!box) return;
    box.replaceChildren();
    if (!message) return;
    const div = document.createElement('div');
    div.className = `alert ${type}`;
    div.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const p = document.createElement('p');
    p.textContent = message;
    div.appendChild(p);
    box.appendChild(div);
  }

  function signOut(query = '') {
    token.clear();
    location.replace(`/login${query}`);
  }

  /** Authenticated call that signs out on 401. */
  async function authed(method, path, body) {
    const r = await api(method, path, body, { auth: true });
    if (r.status === 401) {
      signOut('?session=expired');
      return new Promise(() => {}); // navigation pending
    }
    return r;
  }

  // ---------- render ----------

  function fill(name, value) {
    $$(`[data-f="${name}"]`).forEach((el) => { el.textContent = value; });
  }

  function render() {
    fill('username', user.username);
    fill('email', user.email);
    const linked = (user.linked_providers || []).filter((p) => p !== user.auth_provider).map((p) => PROVIDERS[p]);
    fill('provider', `${PROVIDERS[user.auth_provider] || user.auth_provider}${linked.length ? ` (also linked: ${linked.join(', ')})` : ''}`);
    fill('created', formatDate(user.created_at));
    fill('lastLogin', formatDate(user.last_login));

    const verified = $('[data-f="verified"]');
    verified.replaceChildren();
    const badge = document.createElement('span');
    badge.className = user.email_verified ? 'badge ok' : 'badge warn';
    badge.textContent = user.email_verified ? 'Verified' : 'Not verified';
    verified.appendChild(badge);

    // Password card: change vs. set (OAuth-only accounts).
    $$('[data-needs-password]').forEach((el) => { el.hidden = !user.has_password; });
    $$('[data-needs-2fa]').forEach((el) => { el.hidden = !user.two_factor_enabled; });
    if (user.has_password) {
      $('[data-pw-title]').textContent = 'Change password';
      $('[data-pw-sub]').textContent = 'Other devices will be signed out.';
      $('[data-pw-submit]').textContent = 'Change password';
    } else {
      $('[data-pw-title]').textContent = 'Set a password';
      $('[data-pw-sub]').textContent = `You signed up with ${PROVIDERS[user.auth_provider]}. Set a password to also sign in with email and password — in the app, too.`;
      $('[data-pw-submit]').textContent = 'Set password';
    }

    showTwoFactor(user.two_factor_enabled ? 'on' : 'off');
  }

  async function showTwoFactor(stateName) {
    $$('[data-twofa]').forEach((el) => { el.hidden = el.dataset.twofa !== stateName; });
    if (stateName === 'on') {
      const r = await authed('GET', '/api/auth/2fa');
      if (r.ok) {
        const n = r.data.recoveryCodesLeft;
        $('[data-codes-left]').textContent = `${n} recovery code${n === 1 ? '' : 's'} left`;
      }
    }
  }

  // ---------- download ----------

  async function initDownload() {
    const r = await api('GET', '/api/download/info');
    if (r.ok) {
      $('[data-dl-meta]').textContent = `Version ${r.data.version} · ${r.data.size} · ${r.data.os}`;
      if (!r.data.available) {
        setAlert('[data-dl-alert]', 'warn', 'The download is being prepared. Please check back shortly.');
      }
    }
    $('[data-download]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setLoading(btn, true);
      const link = await authed('POST', '/api/download/link');
      setLoading(btn, false);
      if (!link.ok) return setAlert('[data-dl-alert]', 'error', link.data.error || 'Download failed. Please try again.');
      setAlert('[data-dl-alert]', 'success', 'Your download is starting. Run DisplayX.exe when it’s done.');
      location.href = apiBase + link.data.url;
    });
  }

  // ---------- password ----------

  function initPassword() {
    const form = $('[data-form="password"]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = form.elements.currentPassword.value;
      const newPassword = form.elements.newPassword.value;
      if (user.has_password && !currentPassword) return setAlert('[data-pw-alert]', 'error', 'Enter your current password.');
      if (newPassword.length < 6) return setAlert('[data-pw-alert]', 'error', 'The new password must be at least 6 characters.');
      if (newPassword !== form.elements.confirm.value) return setAlert('[data-pw-alert]', 'error', 'The new passwords don’t match.');

      const btn = $('button[type="submit"]', form);
      setLoading(btn, true);
      const body = user.has_password ? { currentPassword, newPassword } : { newPassword };
      const r = await authed('POST', '/api/auth/change-password', body);
      setLoading(btn, false);
      if (!r.ok) return setAlert('[data-pw-alert]', 'error', r.data.error || 'Couldn’t save the password.');
      if (r.data.token) token.set(r.data.token);
      const wasSet = user.has_password;
      user.has_password = true;
      form.reset();
      render();
      setAlert('[data-pw-alert]', 'success', wasSet ? 'Password changed. Other devices were signed out.' : 'Password set. You can now sign in with email and password.');
    });
  }

  // ---------- two-factor ----------

  function renderCodes(codes) {
    recoveryCodes = codes;
    const list = $('[data-codes]');
    list.replaceChildren(...codes.map((c) => {
      const li = document.createElement('li');
      li.textContent = c;
      return li;
    }));
    showTwoFactor('codes');
  }

  function initTwoFactor() {
    const alertBox = '[data-twofa-alert]';

    $('[data-form="twofa-start"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const password = form.elements.password.value;
      if (user.has_password && !password) return setAlert(alertBox, 'error', 'Enter your current password.');
      const btn = $('button[type="submit"]', form);
      setLoading(btn, true);
      const r = await authed('POST', '/api/auth/2fa/setup', user.has_password ? { password } : {});
      setLoading(btn, false);
      if (!r.ok) return setAlert(alertBox, 'error', r.data.error || 'Couldn’t start the setup.');
      form.reset();
      setAlert(alertBox, '', '');
      $('[data-qr]').src = r.data.qr;
      $('[data-secret]').textContent = r.data.secret.replace(/(.{4})/g, '$1 ').trim();
      showTwoFactor('setup');
      $('#tf-enable-code').focus();
    });

    $('[data-form="twofa-enable"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const code = form.elements.code.value.replace(/\s/g, '');
      if (!/^\d{6}$/.test(code)) return setAlert(alertBox, 'error', 'Enter the 6-digit code from your app.');
      const btn = $('button[type="submit"]', form);
      setLoading(btn, true);
      const r = await authed('POST', '/api/auth/2fa/enable', { code });
      setLoading(btn, false);
      if (!r.ok) return setAlert(alertBox, 'error', r.data.error || 'That code didn’t work.');
      form.reset();
      user.two_factor_enabled = true;
      setAlert(alertBox, 'success', 'Two-factor authentication is on.');
      $$('[data-needs-2fa]').forEach((el) => { el.hidden = false; });
      renderCodes(r.data.recoveryCodes);
    });

    $('[data-twofa-cancel]').addEventListener('click', () => {
      setAlert(alertBox, '', '');
      showTwoFactor('off');
    });

    $('[data-copy-codes]').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(recoveryCodes.join('\n'));
        e.currentTarget.textContent = 'Copied';
      } catch {
        e.currentTarget.textContent = 'Copy failed — select them manually';
      }
    });

    $('[data-save-codes]').addEventListener('click', () => {
      const text = `DisplayX recovery codes for ${user.email}\nEach code works once.\n\n${recoveryCodes.join('\n')}\n`;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'displayx-recovery-codes.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    $('[data-codes-done]').addEventListener('click', () => {
      recoveryCodes = [];
      $('[data-codes]').replaceChildren();
      $('[data-copy-codes]').textContent = 'Copy';
      setAlert(alertBox, '', '');
      showTwoFactor('on');
    });

    const manage = $('[data-form="twofa-manage"]');
    manage.addEventListener('submit', async (e) => {
      e.preventDefault();
      const action = e.submitter && e.submitter.dataset.action;
      const password = manage.elements.password.value;
      const code = manage.elements.code.value.trim();
      if (action === 'disable' && user.has_password && !password) return setAlert(alertBox, 'error', 'Enter your current password.');
      if (!code) return setAlert(alertBox, 'error', 'Enter a code from your authenticator app or a recovery code.');

      setLoading(e.submitter, true);
      const r = action === 'disable'
        ? await authed('POST', '/api/auth/2fa/disable', { password, code })
        : await authed('POST', '/api/auth/2fa/recovery-codes', { code });
      setLoading(e.submitter, false);
      if (!r.ok) return setAlert(alertBox, 'error', r.data.error || 'That didn’t work.');
      manage.reset();
      if (action === 'disable') {
        user.two_factor_enabled = false;
        $$('[data-needs-2fa]').forEach((el) => { el.hidden = true; });
        setAlert(alertBox, 'success', 'Two-factor authentication is off.');
        showTwoFactor('off');
      } else {
        setAlert(alertBox, 'success', 'New recovery codes created. The old ones no longer work.');
        renderCodes(r.data.recoveryCodes);
      }
    });
  }

  // ---------- sessions & deletion ----------

  function initSessions() {
    $$('[data-signout]').forEach((b) => b.addEventListener('click', () => {
      token.clear();
      location.replace('/');
    }));

    $('[data-logout-all]').addEventListener('click', async (e) => {
      if (!window.confirm('Sign out on all devices, including this one and the app?')) return;
      setLoading(e.currentTarget, true);
      const r = await authed('POST', '/api/auth/logout-all');
      if (r.ok) signOut('?signedout=1');
      else setLoading(e.currentTarget, false);
    });

    const del = $('[data-form="delete"]');
    del.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        confirm: del.elements.confirm.value.trim(),
        password: del.elements.password.value,
        code: del.elements.code.value.trim(),
      };
      if (body.confirm.toLowerCase() !== user.username.toLowerCase()) {
        return setAlert('[data-del-alert]', 'error', 'Type your username exactly to confirm.');
      }
      const btn = $('button[type="submit"]', del);
      setLoading(btn, true);
      const r = await authed('DELETE', '/api/auth/account', body);
      setLoading(btn, false);
      if (!r.ok) return setAlert('[data-del-alert]', 'error', r.data.error || 'Couldn’t delete the account.');
      signOut('?deleted=1');
    });
  }

  // ---------- start ----------

  document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(location.search);

    // Returning from Google / Discord: /dashboard?token=…&email=…
    if (params.get('token')) token.set(params.get('token'));
    if (location.search) history.replaceState(null, '', '/dashboard');

    if (!token.get()) {
      location.replace('/login');
      return;
    }

    const r = await authed('GET', '/api/auth/me');
    if (r.status === 403 && r.data.needsVerification) {
      token.clear();
      location.replace('/login');
      return;
    }
    if (!r.ok) {
      $('[data-loading]').textContent = r.data.error || 'Couldn’t load your account. Please refresh.';
      return;
    }

    user = r.data.user;
    render();
    initDownload();
    initPassword();
    initTwoFactor();
    initSessions();

    $('[data-loading]').hidden = true;
    $('[data-content]').hidden = false;

    const download = params.get('download');
    if (download === 'expired') setAlert('[data-dl-alert]', 'warn', 'That download link expired. Click the button again.');
    if (download === 'unavailable') setAlert('[data-dl-alert]', 'warn', 'The download is being prepared. Please check back shortly.');
    if (params.has('recovery')) {
      const left = Number(params.get('recovery'));
      setAlert('[data-alert]', left <= 3 ? 'warn' : 'success',
        `You signed in with a recovery code. ${left} left${left <= 3 ? ' — create new ones in the two-factor section.' : '.'}`);
    }
  });
})();
