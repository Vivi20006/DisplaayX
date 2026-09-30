// Sign in / register / verify / 2FA / password reset.
(function () {
  'use strict';

  const { api, token, apiBase, $, $$, setLoading } = window.DX;

  const PATH_VIEW = {
    '/login': 'login',
    '/register': 'register',
    '/forgot-password': 'forgot',
    '/reset-password': 'reset',
  };
  const VIEW_PATH = { login: '/login', register: '/register', forgot: '/forgot-password', reset: '/reset-password' };
  const TITLES = {
    login: 'Sign in',
    register: 'Create account',
    'check-email': 'Check your email',
    twofa: 'Two-factor authentication',
    forgot: 'Reset password',
    reset: 'New password',
  };

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

  const state = {
    view: null,
    pendingEmail: '',
    twoFactorToken: '',
    resetToken: '',
  };

  // ---------- view + alerts ----------

  function show(view, { push = false } = {}) {
    state.view = view;
    $$('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== view; });
    document.title = `${TITLES[view] || 'Account'} — DisplayX`;
    if (push && VIEW_PATH[view] && location.pathname !== VIEW_PATH[view]) {
      history.pushState({ view }, '', VIEW_PATH[view]);
    }
    const panel = $(`[data-view="${view}"]`);
    const first = panel && $('input:not([type="hidden"])', panel);
    if (first && window.matchMedia('(min-width: 720px)').matches) first.focus({ preventScroll: true });
  }

  function alertBox(view) {
    return $(`[data-view="${view}"] [data-alert]`);
  }

  /** Show an alert inside a view. `action` = { label, onClick } adds an inline button. */
  function setAlert(view, type, message, action) {
    const box = alertBox(view);
    if (!box) return;
    box.replaceChildren();
    if (!message) return;
    const div = document.createElement('div');
    div.className = `alert ${type}`;
    div.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const p = document.createElement('p');
    p.textContent = message;
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'link-btn';
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      p.append(' ', btn);
    }
    div.appendChild(p);
    box.appendChild(div);
  }

  function clearAlerts() {
    $$('[data-alert]').forEach((b) => b.replaceChildren());
  }

  function markInvalid(form, names) {
    $$('.input', form).forEach((i) => i.removeAttribute('aria-invalid'));
    names.forEach((n) => {
      const input = form.elements[n];
      if (input) input.setAttribute('aria-invalid', 'true');
    });
    const first = names.length && form.elements[names[0]];
    if (first) first.focus();
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

  // ---------- flows ----------

  function signedIn(sessionToken, extra = '') {
    token.set(sessionToken);
    location.replace(`/dashboard${extra}`);
  }

  async function resendVerification(view, email, btn) {
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/resend-verification', { email });
    setLoading(btn, false);
    if (r.status === 429) return setAlert(view, 'error', r.data.error);
    if (!r.ok) return setAlert(view, 'error', r.data.error || 'Couldn’t send the email. Please try again.');
    setAlert(view, 'success', `Sent. Check the inbox of ${email}.`);
  }

  async function onLogin(form) {
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const invalid = [];
    if (!EMAIL_RE.test(email)) invalid.push('email');
    if (!password) invalid.push('password');
    if (invalid.length) {
      markInvalid(form, invalid);
      return setAlert('login', 'error', 'Enter your email and password.');
    }
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
        onClick: (e) => resendVerification('login', email, e.currentTarget),
      });
    }
    setAlert('login', 'error', r.data.error || 'Sign-in failed. Please try again.');
  }

  async function onRegister(form) {
    const email = form.elements.email.value.trim();
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    const invalid = [];
    const problems = [];
    if (!EMAIL_RE.test(email)) { invalid.push('email'); problems.push('Enter a valid email address.'); }
    if (!USERNAME_RE.test(username)) { invalid.push('username'); problems.push('Username: 3–24 characters, letters, numbers, _ . -'); }
    if (password.length < 6) { invalid.push('password'); problems.push('Password must be at least 6 characters.'); }
    if (invalid.length) {
      markInvalid(form, invalid);
      return setAlert('register', 'error', problems.join(' '));
    }
    markInvalid(form, []);
    const btn = $('button[type="submit"]', form);
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/register', { email, username, password });
    setLoading(btn, false);

    if (r.ok) {
      state.pendingEmail = email;
      $('[data-email-target]').textContent = email;
      form.reset();
      updateStrength(form.elements.password);
      clearAlerts();
      return show('check-email');
    }
    if (r.status === 409) markInvalid(form, /username/i.test(r.data.error || '') ? ['username'] : ['email']);
    setAlert('register', 'error', r.data.error || 'Couldn’t create the account. Please try again.');
  }

  async function onTwoFactor(form) {
    const recoveryMode = !$('[data-recovery-field]').hidden;
    const code = (recoveryMode ? form.elements.recovery.value : form.elements.code.value).trim();
    if (!code) {
      markInvalid(form, [recoveryMode ? 'recovery' : 'code']);
      return setAlert('twofa', 'error', recoveryMode ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code.');
    }
    if (!state.twoFactorToken) {
      show('login', { push: true });
      return setAlert('login', 'warn', 'Please sign in again.');
    }
    const btn = $('button[type="submit"]', form);
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/2fa/verify', { twoFactorToken: state.twoFactorToken, code });
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
    form.elements.code.value = '';
    form.elements.recovery.value = '';
    markInvalid(form, [recoveryMode ? 'recovery' : 'code']);
    setAlert('twofa', 'error', r.data.error || 'That code didn’t work.');
  }

  async function onForgot(form) {
    const email = form.elements.email.value.trim();
    if (!EMAIL_RE.test(email)) {
      markInvalid(form, ['email']);
      return setAlert('forgot', 'error', 'Enter a valid email address.');
    }
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
    const confirm = form.elements.confirm.value;
    if (password.length < 6) {
      markInvalid(form, ['password']);
      return setAlert('reset', 'error', 'Password must be at least 6 characters.');
    }
    if (password !== confirm) {
      markInvalid(form, ['confirm']);
      return setAlert('reset', 'error', 'The passwords don’t match.');
    }
    markInvalid(form, []);
    const btn = $('button[type="submit"]', form);
    setLoading(btn, true);
    const r = await api('POST', '/api/auth/reset-password', { token: state.resetToken, newPassword: password });
    setLoading(btn, false);
    if (!r.ok) return setAlert('reset', 'error', r.data.error || 'Couldn’t save the password.');
    token.clear();
    form.reset();
    show('login', { push: true });
    const [type, msg] = QUERY_MESSAGES['reset=1'];
    setAlert('login', type, msg);
  }

  async function enterReset() {
    const form = $('[data-form="reset"]');
    if (!state.resetToken) {
      form.hidden = true;
      return setAlert('reset', 'error', 'This page needs the link from your reset email. Request a new one below.');
    }
    const r = await api('GET', `/api/auth/reset-password/check?token=${encodeURIComponent(state.resetToken)}`);
    if (!r.ok || !r.data.valid) {
      form.hidden = true;
      return setAlert('reset', 'error', 'This reset link is invalid or has expired. Request a new one below.');
    }
    form.hidden = false;
  }

  // ---------- small UI helpers ----------

  function updateStrength(input) {
    const meter = input.closest('.field') && $('[data-strength]', input.closest('.field'));
    if (!meter) return;
    const v = input.value;
    let score = 0;
    if (v.length >= 6) score++;
    if (v.length >= 10) score++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v) || v.length >= 16) score++;
    meter.dataset.score = String(score);
    $('span', meter).style.width = `${(score / 4) * 100}%`;
  }

  function initUi() {
    // OAuth buttons go to the API host.
    $$('[data-oauth]').forEach((a) => { a.href = `${apiBase}/api/oauth/${a.dataset.oauth}`; });

    $$('[data-reveal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = $('input', btn.parentElement);
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        btn.textContent = hidden ? 'Hide' : 'Show';
        btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
      });
    });

    $$('[data-strength]').forEach((meter) => {
      const input = $('input', meter.closest('.field'));
      input.addEventListener('input', () => updateStrength(input));
    });

    $$('[data-go]').forEach((a) => {
      a.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        clearAlerts();
        const target = a.dataset.go;
        if (target === 'forgot') {
          const email = $('#login-email').value.trim();
          if (email) $('#forgot-email').value = email;
        }
        show(target, { push: true });
      });
    });

    const handlers = { login: onLogin, register: onRegister, twofa: onTwoFactor, forgot: onForgot, reset: onReset };
    $$('[data-form]').forEach((form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handlers[form.dataset.form](form);
      });
    });

    // Auto-submit a complete 6-digit code.
    const codeInput = $('#twofa-code');
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/[^\d]/g, '').slice(0, 6);
      if (codeInput.value.length === 6) $('[data-form="twofa"]').requestSubmit();
    });

    $('[data-toggle-recovery]').addEventListener('click', (e) => {
      const recoveryField = $('[data-recovery-field]');
      const useRecovery = recoveryField.hidden;
      recoveryField.hidden = !useRecovery;
      $('[data-totp-field]').hidden = useRecovery;
      e.currentTarget.textContent = useRecovery ? 'Use your authenticator app instead' : 'Use a recovery code instead';
      $('[data-twofa-sub]').textContent = useRecovery
        ? 'Enter one of the recovery codes you saved when you turned on 2FA. Each code works once.'
        : 'Enter the 6-digit code from your authenticator app.';
      (useRecovery ? $('#twofa-recovery') : codeInput).focus();
    });

    let cooldown = 0;
    $('[data-resend]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!state.pendingEmail || cooldown) return;
      await resendVerification('check-email', state.pendingEmail, btn);
      cooldown = 60;
      btn.disabled = true;
      const tick = setInterval(() => {
        cooldown--;
        btn.textContent = cooldown ? `Resend email (${cooldown}s)` : 'Resend email';
        if (!cooldown) {
          clearInterval(tick);
          btn.disabled = false;
        }
      }, 1000);
    });

    window.addEventListener('popstate', () => {
      clearAlerts();
      const view = PATH_VIEW[location.pathname] || 'login';
      show(view);
      if (view === 'reset') enterReset();
    });
  }

  // ---------- start ----------

  document.addEventListener('DOMContentLoaded', () => {
    initUi();

    const params = new URLSearchParams(location.search);
    let view = PATH_VIEW[location.pathname] || 'login';

    if (params.has('twofa')) {
      state.twoFactorToken = params.get('twofa');
      view = 'twofa';
    }
    if (params.has('token') && view === 'reset') state.resetToken = params.get('token');

    // Signed-in visitors landing on sign-in / register go straight to their account.
    if (!location.search && (view === 'login' || view === 'register') && token.get()) {
      location.replace('/dashboard');
      return;
    }

    // Strip tokens and one-off flags from the address bar.
    if (location.search) history.replaceState(null, '', location.pathname);

    show(view);
    for (const [key, value] of params) {
      const msg = QUERY_MESSAGES[`${key}=${value}`];
      if (msg) {
        if (key === 'signedout' || key === 'deleted' || key === 'session') token.clear();
        setAlert(view, msg[0], msg[1]);
      }
    }
    if (view === 'reset') enterReset();
  });
})();
