// Home intro: violet warp starfield, the X spins in, DISPLAYX types in, then a flash into the page.
// Plays once per browser session (boot.js decides); click, Enter, Esc or "Skip" leaves early.
(function () {
  'use strict';
  const root = document.documentElement;
  if (!root.classList.contains('intro-pending')) return;

  const AUTO_LEAVE = 3100;
  let leaving = false;
  let raf = 0;

  const el = document.createElement('div');
  el.className = 'intro';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'DisplayX intro');

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');

  const core = document.createElement('div');
  core.className = 'intro-core';
  const logo = document.createElement('img');
  logo.className = 'intro-logo';
  logo.src = '/assets/logo.svg';
  logo.alt = '';
  const word = document.createElement('div');
  word.className = 'intro-word';
  word.setAttribute('aria-label', 'DisplayX');
  'DISPLAYX'.split('').forEach((ch, k) => {
    const s = document.createElement('span');
    s.textContent = ch;
    s.style.setProperty('--k', String(k));
    if (k === 7) s.className = 'x';
    s.setAttribute('aria-hidden', 'true');
    word.appendChild(s);
  });
  const tag = document.createElement('div');
  tag.className = 'intro-tag';
  tag.textContent = 'COLOUR · ZOOM · SOUND · TWEAKS';
  const bar = document.createElement('div');
  bar.className = 'intro-bar';
  bar.appendChild(document.createElement('i'));
  core.append(logo, word, tag, bar);

  const flash = document.createElement('div');
  flash.className = 'intro-flash';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'intro-skip';
  skip.textContent = 'Skip intro';

  el.append(canvas, core, flash, skip);
  document.body.appendChild(el);

  // ---------- warp starfield ----------
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const stars = [];
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = Math.floor(innerWidth * dpr);
    H = canvas.height = Math.floor(innerHeight * dpr);
  };
  resize();
  window.addEventListener('resize', resize);
  const star = () => ({
    x: (Math.random() - 0.5) * 2,
    y: (Math.random() - 0.5) * 2,
    z: Math.random() * 0.9 + 0.1,
    pz: 0,
    hue: Math.random() < 0.7 ? 275 : 300,
  });
  for (let i = 0; i < 420; i++) stars.push(star());

  const start = performance.now();
  function frame(now) {
    const t = (now - start) / 1000;
    // Fast warp at first, settling into a slow drift behind the logo.
    const speed = leaving ? 0.09 : 0.004 + 0.05 * Math.max(0, 1 - t / 1.3);
    ctx.fillStyle = 'rgba(5, 4, 8, 0.32)';
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.45, f = Math.max(W, H) * 0.5;
    for (const s of stars) {
      s.pz = s.z;
      s.z -= speed;
      if (s.z <= 0.02) { Object.assign(s, star(), { z: 1 }); s.pz = 1; continue; }
      const x = cx + (s.x / s.z) * f, y = cy + (s.y / s.z) * f;
      const px = cx + (s.x / s.pz) * f, py = cy + (s.y / s.pz) * f;
      const a = Math.min(1, (1 - s.z) * 1.4);
      ctx.strokeStyle = `hsla(${s.hue}, 90%, ${70 + (1 - s.z) * 25}%, ${a})`;
      ctx.lineWidth = (1 - s.z) * 2.6 * dpr;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // ---------- leave ----------
  function leave() {
    if (leaving) return;
    leaving = true;
    try { sessionStorage.setItem('dx.intro', '1'); } catch { /* ignore */ }
    el.classList.add('leaving');
    setTimeout(() => {
      root.classList.remove('intro-pending');
      root.classList.add('intro-reveal');
      el.classList.add('gone');
    }, 320);
    setTimeout(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', onKey);
      el.remove();
      setTimeout(() => root.classList.remove('intro-reveal'), 1200);
    }, 1100);
  }
  const onKey = (e) => { if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); leave(); } };
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', leave);
  setTimeout(leave, AUTO_LEAVE);
})();
