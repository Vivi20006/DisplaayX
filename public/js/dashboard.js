// Account dashboard: download, profile, password, 2FA, sessions, deletion.
(function () {
  'use strict';

  const { api, token, apiBase, $, $$, setLoading, alertIn, toast, otp, strength, revealButtons } = window.DX;
  const PROVIDERS = { email: 'Email', google: 'Google', discord: 'Discord' };

  let user = null;
  let recoveryCodes = [];
  let enableCode = null;

  const formatDate = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
      : '—';
  };

  function signOut(query = '') {
    token.clear();
    location.replace(`/login${query}`);
  }

  /** Authenticated call; a 401 signs out. */
  async function authed(method, path, body) {
    const r = await api(method, path, body, { auth: true });
    if (r.status === 401) {
      signOut('?session=expired');
      return new Promise(() => {});
    }
    return r;
  }

  // ---------- render ----------

  const fill = (name, value) => $$(`[data-f="${name}"]`).forEach((el) => { el.textContent = value; });

  function pill(cls, text, dot) {
    const s = document.createElement('span');
    s.className = `pill ${cls}`;
    if (dot) { const d = document.createElement('span'); d.className = 'dot'; s.appendChild(d); }
    s.append(text);
    return s;
  }

  function render() {
    fill('initial', user.username.charAt(0));
    fill('username', user.username);
    fill('email', user.email);
    const linked = (user.linked_providers || []).filter((p) => p !== user.auth_provider).map((p) => PROVIDERS[p]);
    fill('provider', `${PROVIDERS[user.auth_provider] || user.auth_provider}${linked.length ? ` + ${linked.join(', ')}` : ''}`);
    fill('created', formatDate(user.created_at));
    fill('lastLogin', formatDate(user.last_login));

    $('[data-badges]').replaceChildren(
      user.email_verified ? pill('good', 'Verified', true) : pill('warn', 'Not verified', true),
      user.two_factor_enabled ? pill('accent', '2FA on', true) : pill('', '2FA off'),
    );

    $$('[data-needs-password]').forEach((el) => { el.hidden = !user.has_password; });
    $$('[data-needs-2fa]').forEach((el) => { el.hidden = !user.two_factor_enabled; });
    const has = user.has_password;
    $('[data-pw-title]').textContent = has ? 'Change password' : 'Set a password';
    $('[data-pw-sub]').textContent = has
      ? 'Other devices will be signed out.'
      : `You signed up with ${PROVIDERS[user.auth_provider]}. Set a password to also sign in with email — in the app, too.`;
    $('[data-pw-submit]').textContent = has ? 'Change password' : 'Set password';
  }

  async function showTf(name) {
    $$('[data-tf]').forEach((el) => { el.hidden = el.dataset.tf !== name; });
    if (name === 'on') {
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
      $('[data-dl="version"]').textContent = r.data.version;
      $('[data-dl="size"]').textContent = r.data.size;
      $('[data-dl="os"]').textContent = r.data.os;
      if (!r.data.available) alertIn('[data-dl-alert]', 'warn', 'The download is being prepared. Please check back shortly.');
    }
    $('[data-download]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setLoading(btn, true);
      const link = await authed('POST', '/api/download/link');
      setLoading(btn, false);
      if (!link.ok) return alertIn('[data-dl-alert]', 'error', link.data.error || 'Download failed. Please try again.');
      alertIn('[data-dl-alert]', '', '');
      toast('Download starting — run DisplayX.exe when it’s done.');
      location.href = apiBase + link.data.url;
    });
  }

  // ---------- password ----------

  function initPassword() {
    const form = $('[data-form="password"]');
    strength(form.elements.newPassword, $('[data-meter]', form));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = form.elements.currentPassword.value;
      const newPassword = form.elements.newPassword.value;
      const box = '[data-pw-alert]';
      if (user.has_password && !currentPassword) return alertIn(box, 'error', 'Enter your current password.');
      if (newPassword.length < 6) return alertIn(box, 'error', 'The new password must be at least 6 characters.');
      if (newPassword !== form.elements.confirm.value) return alertIn(box, 'error', 'The new passwords don’t match.');
      const btn = $('button[type="submit"]', form);
      setLoading(btn, true);
      const r = await authed('POST', '/api/auth/change-password', user.has_password ? { currentPassword, newPassword } : { newPassword });
      setLoading(btn, false);
      if (!r.ok) return alertIn(box, 'error', r.data.error || 'Couldn’t save the password.');
      if (r.data.token) token.set(r.data.token);
      const wasSet = user.has_password;
      user.has_password = true;
      form.reset();
      $('[data-meter]', form).dataset.score = '0';
      alertIn(box, '', '');
      render();
      toast(wasSet ? 'Password changed. Other devices were signed out.' : 'Password set — you can now sign in with email too.');
    });
  }

  // ---------- two-factor ----------

  function renderCodes(codes) {
    recoveryCodes = codes;
    $('[data-codes]').replaceChildren(...codes.map((c) => { const li = document.createElement('li'); li.textContent = c; return li; }));
    showTf('codes');
  }

  function initTwoFactor() {
    const box = '[data-tf-alert]';
    enableCode = otp($('#enable-otp'), () => $('[data-form="tf-enable"]').requestSubmit());

    $('[data-form="tf-start"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const password = form.elements.password.value;
      if (user.has_password && !password) return alertIn(box, 'error', 'Enter your current password.');
      const btn = $('button[type="submit"]', form);
      setLoading(btn, true);
      const r = await authed('POST', '/api/auth/2fa/setup', user.has_password ? { password } : {});
      setLoading(btn, false);
      if (!r.ok) return alertIn(box, 'error', r.data.error || 'Couldn’t start the setup.');
      form.reset();
      alertIn(box, '', '');
      $('[data-qr]').src = r.data.qr;
      $('[data-secret]').textContent = r.data.secret.replace(/(.{4})/g, '$1 ').trim();
      enableCode.clear();
      await showTf('setup');
      enableCode.focus();
    });

    $('[data-form="tf-enable"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = enableCode.value();
      if (code.length !== 6) { enableCode.shake(); return alertIn(box, 'error', 'Enter all 6 digits.'); }
      const btn = $('button[type="submit"]', e.currentTarget);
      setLoading(btn, true);
      const r = await authed('POST', '/api/auth/2fa/enable', { code });
      setLoading(btn, false);
      if (!r.ok) { enableCode.clear(); enableCode.shake(); enableCode.focus(); return alertIn(box, 'error', r.data.error || 'That code didn’t work.'); }
      alertIn(box, '', '');
      user.two_factor_enabled = true;
      render();
      toast('Two-factor authentication is on.');
      renderCodes(r.data.recoveryCodes);
    });

    $('[data-tf-cancel]').addEventListener('click', () => { alertIn(box, '', ''); showTf('off'); });

    $('[data-copy-codes]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(recoveryCodes.join('\n')); toast('Recovery codes copied.'); }
      catch { toast('Copy failed — select the codes manually.', 'error'); }
    });
    $('[data-save-codes]').addEventListener('click', () => {
      const text = `DisplayX recovery codes for ${user.email}\nEach code works once.\n\n${recoveryCodes.join('\n')}\n`;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'displayx-recovery-codes.txt' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    $('[data-codes-done]').addEventListener('click', () => {
      recoveryCodes = [];
      $('[data-codes]').replaceChildren();
      showTf('on');
    });

    const manage = $('[data-form="tf-manage"]');
    manage.addEventListener('submit', async (e) => {
      e.preventDefault();
      const action = e.submitter && e.submitter.dataset.action;
      const password = manage.elements.password.value;
      const code = manage.elements.code.value.trim();
      if (action === 'disable' && user.has_password && !password) return alertIn(box, 'error', 'Enter your current password.');
      if (!code) return alertIn(box, 'error', 'Enter a code from your authenticator app or a recovery code.');
      setLoading(e.submitter, true);
      const r = action === 'disable'
        ? await authed('POST', '/api/auth/2fa/disable', { password, code })
        : await authed('POST', '/api/auth/2fa/recovery-codes', { code });
      setLoading(e.submitter, false);
      if (!r.ok) return alertIn(box, 'error', r.data.error || 'That didn’t work.');
      manage.reset();
      alertIn(box, '', '');
      if (action === 'disable') {
        user.two_factor_enabled = false;
        render();
        toast('Two-factor authentication is off.');
        showTf('off');
      } else {
        toast('New recovery codes created — the old ones no longer work.');
        renderCodes(r.data.recoveryCodes);
      }
    });
  }

  // ---------- sessions & deletion ----------

  function initSessions() {
    $('[data-logout-all]').addEventListener('click', async (e) => {
      if (!window.confirm('Sign out on all devices, including this one and the app?')) return;
      setLoading(e.currentTarget, true);
      const r = await authed('POST', '/api/auth/logout-all');
      if (r.ok) signOut('?signedout=1'); else setLoading(e.currentTarget, false);
    });

    const del = $('[data-form="delete"]');
    del.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { confirm: del.elements.confirm.value.trim(), password: del.elements.password.value, code: del.elements.code.value.trim() };
      if (body.confirm.toLowerCase() !== user.username.toLowerCase()) return alertIn('[data-del-alert]', 'error', 'Type your username exactly to confirm.');
      const btn = $('button[type="submit"]', del);
      setLoading(btn, true);
      const r = await authed('DELETE', '/api/auth/account', body);
      setLoading(btn, false);
      if (!r.ok) return alertIn('[data-del-alert]', 'error', r.data.error || 'Couldn’t delete the account.');
      signOut('?deleted=1');
    });
  }

  // ---------- start ----------

  document.addEventListener('DOMContentLoaded', async () => {
    $$('[data-signout]').forEach((b) => b.addEventListener('click', () => { token.clear(); location.replace('/'); }));

    const params = new URLSearchParams(location.search);
    if (params.get('token')) token.set(params.get('token')); // back from Google / Discord
    if (location.search) history.replaceState(null, '', '/dashboard');
    if (!token.get()) { location.replace('/login'); return; }

    const r = await authed('GET', '/api/auth/me');
    if (r.status === 403 && r.data.needsVerification) { token.clear(); location.replace('/login'); return; }
    if (!r.ok) { $('[data-loading]').textContent = r.data.error || 'Couldn’t load your account. Please refresh.'; return; }

    user = r.data.user;
    render();
    revealButtons();
    initDownload();
    initPassword();
    initTwoFactor();
    initSessions();
    showTf(user.two_factor_enabled ? 'on' : 'off');

    $('[data-loading]').hidden = true;
    $('[data-content]').hidden = false;

    const dl = params.get('download');
    if (dl === 'expired') alertIn('[data-dl-alert]', 'warn', 'That download link expired. Click the button again.');
    if (dl === 'unavailable') alertIn('[data-dl-alert]', 'warn', 'The download is being prepared. Please check back shortly.');
    if (params.has('recovery')) {
      const left = Number(params.get('recovery'));
      alertIn('[data-alert]', left <= 3 ? 'warn' : 'success',
        `You signed in with a recovery code — ${left} left.${left <= 3 ? ' Create new ones in the 2FA section.' : ''}`);
    }
  });
})();
