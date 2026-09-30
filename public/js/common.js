// Shared helpers: API client, token storage, navigation.
(function () {
  'use strict';

  const TOKEN_KEY = 'dx_token';
  const apiBase = ((window.DX_CONFIG && window.DX_CONFIG.apiBase) || '').replace(/\/+$/, '');

  const token = {
    get() {
      try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
    },
    set(value) {
      try { localStorage.setItem(TOKEN_KEY, value); } catch { /* storage blocked */ }
    },
    clear() {
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
    },
  };

  /**
   * JSON API call. Resolves to { ok, status, data } and never throws for HTTP errors.
   * Network failures resolve to status 0 with a readable error.
   */
  async function api(method, path, body, { auth = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const t = token.get();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    try {
      const res = await fetch(apiBase + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let data = {};
      try { data = await res.json(); } catch { /* empty body */ }
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: 'Can’t reach the server. Check your connection and try again.' } };
    }
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function setLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle('is-loading', loading);
    btn.disabled = loading;
  }

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Mobile menu
  function initNav() {
    const nav = $('.nav');
    const toggle = $('.nav-toggle');
    if (!nav || !toggle) return;
    const close = () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    };
    toggle.addEventListener('click', () => {
      const open = !nav.classList.contains('open');
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    $$('.nav-menu a').forEach((a) => a.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 1020) close(); });
  }

  // Signed-in visitors go straight to their dashboard from every "get / download" link.
  function initAuthLinks() {
    const signedIn = !!token.get();
    $$('[data-auth-link]').forEach((a) => {
      if (signedIn) a.setAttribute('href', '/dashboard');
    });
    $$('[data-account-label]').forEach((el) => {
      el.textContent = signedIn ? 'Account' : 'Sign in';
    });
  }

  function initYear() {
    $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initAuthLinks();
    initYear();
  });

  window.DX = { api, token, apiBase, $, $$, setLoading, reducedMotion };
})();
