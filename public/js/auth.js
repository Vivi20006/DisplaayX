// Sign in / register / verify / 2FA / password reset.
(function () {
  'use strict';

  const { api, token, apiBase, $, $$, setLoading, alertIn, segmented, otp, strength, revealButtons } = window.DX;

  const PATH_VIEW = { '/login': 'login', '/register': 'register', '/forgot-password': 'forgot', '/reset-password': 'reset' };
  const VIEW_PATH = { login: '/login', register: '/register', forgot: '/forgot-password', reset: '/reset-password' };
  const TITLES = { login: 'Sign in', register: 'Create account', 'check-email': 'Check your inbox', twofa: 'Two-factor check', forgot: 'Forgot password', reset: 'New password' };

  const QUERY_MESSAGES = {
    'verified=1': ['success', 'Email verified. You can sign in now.'],
    'verified=0': ['error', 'This verification link is invalid or has expired. Sign in with your email and password to get a new one.'],
    'error=provider_unavailable': ['error', 'This sign-in option isn’t available right now. Please use email instead.'],
    'error=oauth_cancelled': ['warn', 'Sign-in was cancelled.'],
    'error=oauth_state': ['error', 'That sign-in took too long or was opened in another browser. Please try again.'],
    'error=oauth_failed': ['error', 'Couldn’t sign you in with that provider. Please try again.'],
    'error=oauth_no_email': ['error', 'Your account didn’t share an email address. Allow email access, or sign up with email.'],
    'error=oauth_unverified': ['error', 'Your email isn’t verified with that provider yet. Verify it there first, or sign up with email.'],
    'signedout=1': ['success', 'You’ve been signed out on all devices.'],
    'deleted=1': ['success', 'Your account has been deleted.'],
    'session=expired': ['warn', 'Your session has expired. Please sign in again.'],
    'reset=1': ['success', 'Password changed. Sign in with your new password.'],
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

  const state = { pendingEmail: '', twoFactorToken: '', resetToken: '' };
  let tabs = null;
  let code = null;

  // ---------- views ----------

  function show(view, { push = false } = {}) {
    $$('[data-view]').forEach((el) => {
      const on = el.dataset.view === view;
      el.hidden = !on;
      el.classList.toggle('view-enter', on);
    });
    const tabbed = view === 'login' || view === 'register';
    $('#auth-tabs').hidden = !tabbed;
    if (tabbed && tabs) tabs.select(view === 'login' ? 0 : 1, false);
    document.title = `${TITLES[view] || 'Account'} — DisplayX`;
    if (push && VIEW_PATH[view] && location.pathname !== VIEW_PATH[view]) history.pushState({ view }, '', VIEW_PATH[view]);
    if (window.matchMedia('(min-width: 720px)').matches) {
      if (view === 'twofa') code.focus();
      else { const first = $(`[data-view="${view}"] input`); if (first) first.focus({ preventScroll: true }); }
    }
  }

  const setAlert = (view, type, msg, action) => alertIn($(`[data-view="${view}"] [data-alert]`), type, msg, action);
  const clearAlerts = () => $$('[data-alert]').forEach((b) => b.replaceChildren());

  function markInvalid(form, names) {
    $$('.input', form).forEach((i) => i.removeAttribute('aria-invalid'));
    names.forEach((n) => form.elements[n] && form.elements[n].setAttribute('aria-invalid', 'true'));
    if (names.length && form.elements[names[0]]) form.elements[names[0]].focus();
  }

  // ---------- flows ----------

  function signedIn(sessionToken, extra = '') {
    token.set(sessionToken);
    location.replace(`/dashboard${extra}`);
  }

  async function resend(view, email, btn) {
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/resend-verification', { email });
    setLoading(btn, false);
    if (!r.ok) return setAlert(view, 'error', r.data.error || 'Couldn’t send the email. Please try again.');
    setAlert(view, 'success', `Sent. Check the inbox of ${email}.`);
  }

  async function onLogin(form) {
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const bad = [];
    if (!EMAIL_RE.test(email)) bad.push('email');
    if (!password) bad.push('password');
    if (bad.length) { markInvalid(form, bad); return setAlert('login', 'error', 'Enter your email and password.'); }
    markInvalid(form, []);
    const btn = $('button[type="submit"]', form);
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/login', { email, password });
    setLoading(btn, false);

    if (r.ok && r.data.needs2fa) {
      state.twoFactorToken = r.data.twoFactorToken;
      form.elements.password.value = '';
      clearAlerts();
      return show('twofa');
    }
    if (r.ok && r.data.token) return signedIn(r.data.token);
    if (r.status === 403 && r.data.needsVerification) {
      return setAlert('login', 'warn', 'Please verify your email before signing in.', {
        label: 'Resend verification email',
        onClick: (e) => resend('login', email, e.currentTarget),
      });
    }
    setAlert('login', 'error', r.data.error || 'Sign-in failed. Please try again.');
  }

  async function onRegister(form) {
    const email = form.elements.email.value.trim();
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    const bad = [], msgs = [];
    if (!EMAIL_RE.test(email)) { bad.push('email'); msgs.push('Enter a valid email address.'); }
    if (!USERNAME_RE.test(username)) { bad.push('username'); msgs.push('Username: 3–24 characters, letters, numbers, _ . -'); }
    if (password.length < 6) { bad.push('password'); msgs.push('Password must be at least 6 characters.'); }
    if (bad.length) { markInvalid(form, bad); return setAlert('register', 'error', msgs.join(' ')); }
    markInvalid(form, []);
    const btn = $('button[type="submit"]', form);
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/register', { email, username, password });
    setLoading(btn, false);

    if (r.ok) {
      state.pendingEmail = email;
      $('[data-email-target]').textContent = email;
      form.reset();
      $('[data-meter]', form).dataset.score = '0';
      clearAlerts();
      return show('check-email');
    }
    if (r.status === 409) markInvalid(form, /username/i.test(r.data.error || '') ? ['username'] : ['email']);
    setAlert('register', 'error', r.data.error || 'Couldn’t create the account. Please try again.');
  }

  async function onTwoFactor(form) {
    const recovery = !$('[data-recovery-field]').hidden;
    const value = recovery ? form.elements.recovery.value.trim() : code.value();
    if (recovery ? !value : value.length !== 6) {
      if (!recovery) code.shake();
      return setAlert('twofa', 'error', recovery ? 'Enter one of your recovery codes.' : 'Enter all 6 digits.');
    }
    if (!state.twoFactorToken) {
      show('login', { push: true });
      return setAlert('login', 'warn', 'Please sign in again.');
    }
    const btn = $('button[type="submit"]', form);
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/2fa/verify', { twoFactorToken: state.twoFactorToken, code: value });
    setLoading(btn, false);

    if (r.ok && r.data.token) {
      const left = r.data.recoveryCodesLeft;
      return signedIn(r.data.token, typeof left === 'number' ? `?recovery=${left}` : '');
    }
    if (r.data.expired) {
      state.twoFactorToken = '';
      show('login', { push: true });
      return setAlert('login', 'warn', r.data.error);
    }
    code.clear();
    form.elements.recovery.value = '';
    if (!recovery) { code.shake(); code.focus(); }
    setAlert('twofa', 'error', r.data.error || 'That code didn’t work.');
  }

  async function onForgot(form) {
    const email = form.elements.email.value.trim();
    if (!EMAIL_RE.test(email)) { markInvalid(form, ['email']); return setAlert('forgot', 'error', 'Enter a valid email address.'); }
    markInvalid(form, []);
    const btn = $('button[type="submit"]', form);
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/forgot-password', { email });
    setLoading(btn, false);
    if (!r.ok) return setAlert('forgot', 'error', r.data.error || 'Please try again.');
    setAlert('forgot', 'success', `If an account exists for ${email}, we’ve sent a reset link. It’s valid for 1 hour.`);
  }

  async function onReset(form) {
    const password = form.elements.password.value;
    if (password.length < 6) { markInvalid(form, ['password']); return setAlert('reset', 'error', 'Password must be at least 6 characters.'); }
    if (password !== form.elements.confirm.value) { markInvalid(form, ['confirm']); return setAlert('reset', 'error', 'The passwords don’t match.'); }
    markInvalid(form, []);
    const btn = $('button[type="submit"]', form);
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/reset-password', { token: state.resetToken, newPassword: password });
    setLoading(btn, false);
    if (!r.ok) return setAlert('reset', 'error', r.data.error || 'Couldn’t save the password.');
    token.clear();
    form.reset();
    show('login', { push: true });
    setAlert('login', ...QUERY_MESSAGES['reset=1']);
  }

  async function enterReset() {
    const form = $('[data-form="reset"]');
    const invalid = (msg) => { form.hidden = true; setAlert('reset', 'error', msg); };
    if (!state.resetToken) return invalid('This page needs the link from your reset email. Request a new one below.');
    const r = await api('GET', `/api/auth/reset-password/check?token=${encodeURIComponent(state.resetToken)}`);
    if (!r.ok || !r.data.valid) return invalid('This reset link is invalid or has expired. Request a new one below.');
    form.hidden = false;
  }

  // ---------- wiring ----------

  function initUi() {
    $$('[data-oauth]').forEach((a) => { a.href = `${apiBase}/api/oauth/${a.dataset.oauth}`; });
    revealButtons();
    $$('[data-meter]').forEach((m) => strength($('input', m.closest('.field')), m));

    tabs = segmented($('#auth-tabs'), (view) => {
      clearAlerts();
      show(view, { push: true });
    });

    $$('[data-go]').forEach((a) => a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      clearAlerts();
      if (a.dataset.go === 'forgot' && $('#login-email').value.trim()) $('#forgot-email').value = $('#login-email').value.trim();
      show(a.dataset.go, { push: true });
    }));

    const handlers = { login: onLogin, register: onRegister, twofa: onTwoFactor, forgot: onForgot, reset: onReset };
    $$('[data-form]').forEach((form) => form.addEventListener('submit', (e) => {
      e.preventDefault();
      handlers[form.dataset.form](form);
    }));

    code = otp($('#login-otp'), () => $('[data-form="twofa"]').requestSubmit());

    $('[data-toggle-recovery]').addEventListener('click', (e) => {
      const field = $('[data-recovery-field]');
      const useRecovery = field.hidden;
      field.hidden = !useRecovery;
      $('#login-otp').hidden = useRecovery;
      e.currentTarget.textContent = useRecovery ? 'Use your authenticator app instead' : 'Use a recovery code instead';
      $('[data-twofa-sub]').textContent = useRecovery
        ? 'Enter one of the recovery codes you saved when you turned on 2FA. Each works once.'
        : 'Enter the 6-digit code from your authenticator app.';
      if (useRecovery) $('#twofa-recovery').focus(); else code.focus();
    });

    let cooldown = 0;
    $('[data-resend]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!state.pendingEmail || cooldown) return;
      await resend('check-email', state.pendingEmail, btn);
      cooldown = 60;
      btn.disabled = true;
      const tick = setInterval(() => {
        cooldown--;
        btn.textContent = cooldown ? `Resend email (${cooldown}s)` : 'Resend email';
        if (!cooldown) { clearInterval(tick); btn.disabled = false; }
      }, 1000);
    });

    window.addEventListener('popstate', () => {
      clearAlerts();
      const view = PATH_VIEW[location.pathname] || 'login';
      show(view);
      if (view === 'reset') enterReset();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initUi();
    const params = new URLSearchParams(location.search);
    let view = PATH_VIEW[location.pathname] || 'login';
    if (params.has('twofa')) { state.twoFactorToken = params.get('twofa'); view = 'twofa'; }
    if (params.has('token') && view === 'reset') state.resetToken = params.get('token');

    if (!location.search && (view === 'login' || view === 'register') && token.get()) {
      location.replace('/dashboard');
      return;
    }
    // Keep tokens and one-off flags out of the address bar and history.
    if (location.search) history.replaceState(null, '', location.pathname);

    show(view);
    for (const [key, value] of params) {
      const msg = QUERY_MESSAGES[`${key}=${value}`];
      if (!msg) continue;
      if (key === 'signedout' || key === 'deleted' || key === 'session') token.clear();
      setAlert(view, msg[0], msg[1]);
    }
    if (view === 'reset') enterReset();
  });
})();
