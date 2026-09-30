// Shared helpers: API client, token storage, navigation, cursor, reveal, toasts, controls.
(function () {
  'use strict';

  const TOKEN_KEY = 'dx_token';
  const apiBase = ((window.DX_CONFIG && window.DX_CONFIG.apiBase) || '').replace(/\/+$/, '');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const token = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch { /* storage blocked */ } },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } },
  };

  /** JSON API call → { ok, status, data }. Never throws; network errors give status 0. */
  async function api(method, path, body, { auth = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && token.get()) headers.Authorization = `Bearer ${token.get()}`;
    try {
      const res = await fetch(apiBase + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      let data = {};
      try { data = await res.json(); } catch { /* empty body */ }
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: 'Can’t reach the server. Check your connection and try again.' } };
    }
  }

  function setLoading(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-loading', on);
    btn.disabled = on;
  }

  /** Render an alert into a container. `action` = { label, onClick } adds an inline button. */
  function alertIn(box, type, message, action) {
    if (typeof box === 'string') box = $(box);
    if (!box) return;
    box.replaceChildren();
    if (!message) return;
    const div = document.createElement('div');
    div.className = `alert ${type}`;
    div.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const p = document.createElement('p');
    p.textContent = message;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link-btn';
      b.textContent = action.label;
      b.addEventListener('click', action.onClick);
      p.append(' ', b);
    }
    div.appendChild(p);
    box.appendChild(div);
  }

  function toast(message, type = 'success') {
    let host = $('.toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toasts';
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    host.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3600);
  }

  /** Segmented control: buttons inside .seg with a .seg-glider. onChange(value, index). */
  function segmented(seg, onChange) {
    const buttons = $$('button', seg);
    const attr = buttons[0] && buttons[0].hasAttribute('aria-selected') ? 'aria-selected' : 'aria-pressed';
    seg.style.setProperty('--cols', String(buttons.length));
    const select = (i, fire = true) => {
      seg.style.setProperty('--i', String(i));
      buttons.forEach((b, j) => b.setAttribute(attr, String(i === j)));
      if (fire && onChange) onChange(buttons[i].dataset.value, i);
    };
    buttons.forEach((b, i) => b.addEventListener('click', () => select(i)));
    const start = Math.max(0, buttons.findIndex((b) => b.getAttribute(attr) === 'true'));
    select(start, false);
    return { select };
  }

  /** Six single-digit boxes. Returns { value(), clear(), shake(), focus() }. */
  function otp(container, onComplete) {
    container.replaceChildren();
    const boxes = Array.from({ length: 6 }, (_, i) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = i === 0 ? 'one-time-code' : 'off';
      input.setAttribute('aria-label', `Digit ${i + 1}`);
      container.appendChild(input);
      return input;
    });
    const value = () => boxes.map((b) => b.value).join('');
    const sync = () => boxes.forEach((b) => b.classList.toggle('filled', !!b.value));
    const fill = (digits, from) => {
      digits.split('').forEach((d, k) => { if (boxes[from + k]) boxes[from + k].value = d; });
      sync();
      const next = boxes[Math.min(from + digits.length, 5)];
      next.focus();
      if (value().length === 6 && onComplete) onComplete(value());
    };
    boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        const digits = box.value.replace(/\D/g, '');
        box.value = '';
        if (digits) fill(digits.slice(0, 6 - i), i); else sync();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); sync(); e.preventDefault(); }
        if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
        if (e.key === 'ArrowRight' && i < 5) boxes[i + 1].focus();
      });
      box.addEventListener('paste', (e) => {
        const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!digits) return;
        e.preventDefault();
        boxes.forEach((b) => { b.value = ''; });
        fill(digits, 0);
      });
      box.addEventListener('focus', () => box.select());
    });
    return {
      value,
      clear() { boxes.forEach((b) => { b.value = ''; }); sync(); },
      focus() { boxes[0].focus(); },
      shake() {
        container.classList.remove('shake');
        void container.offsetWidth;
        container.classList.add('shake');
        setTimeout(() => container.classList.remove('shake'), 450);
      },
    };
  }

  /** Password strength meter (.meter with 4 <i>). */
  function strength(input, meter) {
    input.addEventListener('input', () => {
      const v = input.value;
      let s = 0;
      if (v.length >= 6) s++;
      if (v.length >= 10) s++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)) s++;
      if (/[^A-Za-z0-9]/.test(v) || v.length >= 16) s++;
      meter.dataset.score = v ? String(s) : '0';
    });
  }

  function revealButtons(root = document) {
    $$('[data-reveal]', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = $('input', btn.parentElement);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
  }

  // ---------- page chrome ----------

  function initTopbar() {
    const bar = $('.topbar');
    const burger = $('.burger');
    if (!bar || !burger) return;
    const close = () => { bar.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); };
    burger.addEventListener('click', () => {
      const open = !bar.classList.contains('open');
      bar.classList.toggle('open', open);
      burger.setAttribute('aria-expanded', String(open));
    });
    $$('.menu a').forEach((a) => a.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', () => { if (window.innerWidth > 1060) close(); });

    // Scroll-spy for in-page links
    const links = $$('.topnav a[href^="#"]');
    const sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
    if (!sections.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => io.observe(s));
  }

  function initAuthLinks() {
    const signedIn = !!token.get();
    $$('[data-auth-link]').forEach((a) => { if (signedIn) a.setAttribute('href', '/dashboard'); });
    $$('[data-account-label]').forEach((el) => { el.textContent = signedIn ? 'Account' : 'Sign in'; });
  }

  function initReveal() {
    const items = $$('.reveal');
    if (!items.length) return;
    if (!('IntersectionObserver' in window) || reducedMotion()) {
      items.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => io.observe(el));
  }

  // Glowing violet cursor for mouse / trackpad.
  function initCursor() {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const root = document.documentElement;
    const reduced = reducedMotion();
    const dot = document.createElement('div');
    const glow = document.createElement('div');
    dot.className = 'cursor-dot';
    glow.className = 'cursor-glow';
    dot.setAttribute('aria-hidden', 'true');
    glow.setAttribute('aria-hidden', 'true');
    document.body.append(glow, dot);
    root.classList.add('has-cursor');

    const HOVER = 'a, button, summary, label, [role="slider"], input[type="range"], .compare, .zoom-view, .lab-view';
    const TEXT = 'input:not([type="range"]), textarea';
    const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    const d = { ...mouse };
    const g = { ...mouse };
    let raf = 0;
    let seen = false;
    const place = (el, p) => { el.style.translate = `${p.x}px ${p.y}px`; };
    const frame = () => {
      const kd = reduced ? 1 : 0.34;
      const kg = reduced ? 1 : 0.13;
      d.x += (mouse.x - d.x) * kd; d.y += (mouse.y - d.y) * kd;
      g.x += (mouse.x - g.x) * kg; g.y += (mouse.y - g.y) * kg;
      place(dot, d); place(glow, g);
      raf = Math.abs(mouse.x - g.x) < 0.1 && Math.abs(mouse.y - g.y) < 0.1 ? 0 : requestAnimationFrame(frame);
    };
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      mouse.x = e.clientX; mouse.y = e.clientY;
      if (!seen) { seen = true; d.x = g.x = mouse.x; d.y = g.y = mouse.y; }
      root.classList.add('cursor-visible');
      if (!raf) raf = requestAnimationFrame(frame);
    }, { passive: true });
    document.addEventListener('mouseover', (e) => {
      const t = e.target;
      root.classList.toggle('cursor-text', !!(t.closest && t.closest(TEXT)));
      const el = t.closest && t.closest(HOVER);
      root.classList.toggle('cursor-hover', !!el && !el.disabled && !root.classList.contains('cursor-text'));
    });
    document.addEventListener('mouseleave', () => root.classList.remove('cursor-visible'));
    window.addEventListener('blur', () => root.classList.remove('cursor-visible'));
    window.addEventListener('pointerdown', () => root.classList.add('cursor-down'));
    window.addEventListener('pointerup', () => root.classList.remove('cursor-down'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTopbar();
    initAuthLinks();
    initReveal();
    initCursor();
    $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
  });

  window.DX = { api, token, apiBase, $, $$, setLoading, reducedMotion, alertIn, toast, segmented, otp, strength, revealButtons };
})();
