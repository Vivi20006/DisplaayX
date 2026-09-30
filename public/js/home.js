// Home page: hero before/after, ultra-zoom, equalizer, optimizer preview, colour lab.
(function () {
  'use strict';

  const { $, $$, reducedMotion, segmented, toast } = window.DX;
  const { NEUTRAL, sceneData, process } = window.DXColor;

  // ---------- Hero: before / after ----------

  function initCompare() {
    const box = $('#hero-compare');
    if (!box) return;
    const after = $('canvas.after', box);
    const before = $('canvas.before', box);
    const handle = $('.compare-handle', box);
    const settings = { vibrance: Number(box.dataset.vibrance) || 200, contrast: 106 };
    let pos = 50;
    let touched = false;

    const setPos = (p) => {
      pos = Math.min(100, Math.max(0, p));
      box.style.setProperty('--pos', `${pos}%`);
      handle.setAttribute('aria-valuenow', String(Math.round(pos)));
    };

    async function show(scene) {
      try {
        const src = await sceneData(scene, before);
        const actx = after.getContext('2d');
        const out = actx.createImageData(after.width, after.height);
        actx.putImageData(process(src, out, settings), 0, 0);
      } catch (e) { console.warn('scene', scene, e); }
    }

    const fromEvent = (e) => {
      const r = box.getBoundingClientRect();
      setPos(((e.clientX - r.left) / r.width) * 100);
    };
    let dragging = false;
    box.addEventListener('pointerdown', (e) => {
      dragging = true;
      touched = true;
      box.setPointerCapture(e.pointerId);
      fromEvent(e);
    });
    box.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
    ['pointerup', 'pointercancel'].forEach((t) => box.addEventListener(t, () => { dragging = false; }));
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 4;
      if (e.key === 'ArrowLeft') { setPos(pos - step); e.preventDefault(); }
      if (e.key === 'ArrowRight') { setPos(pos + step); e.preventDefault(); }
      if (e.key === 'Home') setPos(0);
      if (e.key === 'End') setPos(100);
      touched = true;
    });

    segmented($('#hero-scenes'), (scene) => show(scene));
    setPos(50);
    show('grass');

    // A little sweep once it scrolls into view, so it's obvious it's draggable.
    if (!reducedMotion() && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(([en]) => {
        if (!en.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now() + 900;
        const tick = (now) => {
          if (touched) return;
          const t = Math.max(0, now - t0) / 1800;
          setPos(50 + Math.sin(t * Math.PI * 2) * 28 * Math.max(0, 1 - t / 1.6));
          if (t < 1.6) requestAnimationFrame(tick); else setPos(50);
        };
        requestAnimationFrame(tick);
      }, { threshold: 0.5 });
      io.observe(box);
    }
  }

  // ---------- Ultra-zoom ----------

  function initZoom() {
    const view = $('#zoom-view');
    if (!view) return;
    const img = $('img', view);
    const badge = $('#zoom-factor');
    let factor = 3;
    let zoomed = false;
    let ox = 50, oy = 50;
    img.style.transition = 'transform 0.34s cubic-bezier(0.2, 0.8, 0.2, 1), transform-origin 0.12s linear';

    const apply = () => {
      img.style.transformOrigin = `${ox}% ${oy}%`;
      img.style.transform = zoomed ? `scale(${factor})` : 'scale(1)';
      view.style.setProperty('--sx', `${ox}%`);
      view.style.setProperty('--sy', `${oy}%`);
      view.classList.toggle('zoomed', zoomed);
    };
    const point = (e) => {
      const r = view.getBoundingClientRect();
      ox = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
      oy = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
    };
    const zin = () => { zoomed = true; apply(); };
    const zout = () => { zoomed = false; apply(); };

    view.addEventListener('pointerdown', (e) => { e.preventDefault(); view.setPointerCapture(e.pointerId); point(e); zin(); });
    view.addEventListener('pointermove', (e) => { point(e); if (zoomed) apply(); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => view.addEventListener(t, zout));
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'c' && !e.repeat && !e.ctrlKey && !e.metaKey) zin(); });
    view.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'c') zout(); });
    view.addEventListener('blur', zout);

    segmented($('#zoom-seg'), (v) => {
      factor = Number(v);
      badge.textContent = `${factor}×`;
      if (zoomed) apply();
    });
  }

  // ---------- Equalizer ----------

  const BANDS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  // Illustrative curves for the preview.
  const PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    bassmax: [10, 9, 7, 4, 1, 0, 0, 0, 0, 0],
    gaming: [3, 2, 0, -1, -1, 1, 3, 4, 3, 1],
    footsteps: [-8, -6, -3, -1, 0, 1, 4, 6, 5, 1],
    voice: [-6, -4, -2, 0, 2, 3, 4, 3, 0, -2],
  };

  function initEq() {
    const svg = $('#eq-graph');
    const bandsEl = $('#eq-bands');
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    const W = 600, H = 230, PL = 40, PR = 18, PT = 16, PB = 30;
    const xs = BANDS.map((_, i) => PL + (i * (W - PL - PR)) / 9);
    const y = (g) => PT + ((12 - g) / 24) * (H - PT - PB);
    const el = (name, attrs, parent = svg) => {
      const n = document.createElementNS(NS, name);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      parent.appendChild(n);
      return n;
    };

    const defs = el('defs', {});
    const stroke = el('linearGradient', { id: 'eqStroke', x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
    el('stop', { offset: '0', 'stop-color': '#6d28d9' }, stroke);
    el('stop', { offset: '0.5', 'stop-color': '#c084fc' }, stroke);
    el('stop', { offset: '1', 'stop-color': '#e879f9' }, stroke);
    const fillG = el('linearGradient', { id: 'eqFill', x1: '0', x2: '0', y1: '0', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#a855f7', 'stop-opacity': '0.45' }, fillG);
    el('stop', { offset: '1', 'stop-color': '#a855f7', 'stop-opacity': '0' }, fillG);

    [12, 6, 0, -6, -12].forEach((g) => {
      el('line', { x1: PL, x2: W - PR, y1: y(g), y2: y(g), class: g === 0 ? 'zero-line' : 'grid-line' });
      el('text', { x: PL - 8, y: y(g) + 4, 'text-anchor': 'end', class: 'axis' }).textContent = g > 0 ? `+${g}` : g < 0 ? `−${-g}` : '0';
    });
    BANDS.forEach((b, i) => { el('text', { x: xs[i], y: H - 9, 'text-anchor': 'middle', class: 'axis' }).textContent = b; });
    const fill = el('path', { class: 'curve-fill' });
    const curve = el('path', { class: 'curve' });
    const knobs = BANDS.map((_, i) => el('circle', { cx: xs[i], r: 5, class: 'knob' }));

    let gains = PRESETS.footsteps.slice();
    const fmt = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

    const controls = BANDS.map((b, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'eq-band';
      const out = document.createElement('output');
      const input = document.createElement('input');
      Object.assign(input, { type: 'range', min: '-12', max: '12', step: '1', id: `eq-${i}` });
      input.setAttribute('aria-label', `${b} Hz band, dB`);
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = b;
      wrap.append(out, input, label);
      bandsEl.appendChild(wrap);
      input.addEventListener('input', () => {
        gains[i] = Number(input.value);
        out.textContent = fmt(gains[i]);
        input.style.setProperty('--fill', `${((gains[i] + 12) / 24) * 100}%`);
        setChip(null);
        draw(gains);
      });
      return { input, out };
    });

    function path(pts) {
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0]},${p2[1].toFixed(1)}`;
      }
      return d;
    }
    function draw(g) {
      const pts = g.map((v, i) => [xs[i], y(v)]);
      const d = path(pts);
      curve.setAttribute('d', d);
      fill.setAttribute('d', `${d} L${xs[9]},${H - PB} L${xs[0]},${H - PB} Z`);
      knobs.forEach((k, i) => k.setAttribute('cy', pts[i][1].toFixed(1)));
      const max = Math.max(...gains);
      $('#eq-preamp').textContent = max > 0 ? `−${max} dB` : '0 dB';
    }
    const paint = (input) => input.style.setProperty('--fill', `${((Number(input.value) + 12) / 24) * 100}%`);
    function sync() { controls.forEach(({ input, out }, i) => { input.value = String(gains[i]); out.textContent = fmt(gains[i]); paint(input); }); }
    function setChip(name) { $$('[data-preset]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === name))); }

    let anim = 0;
    function animateTo(target) {
      cancelAnimationFrame(anim);
      const from = gains.slice();
      gains = target.slice();
      sync();
      if (reducedMotion()) return draw(gains);
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / 380);
        const e = 1 - Math.pow(1 - t, 3);
        draw(from.map((f, i) => f + (target[i] - f) * e));
        if (t < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }
    $$('[data-preset]').forEach((chip) => chip.addEventListener('click', () => {
      setChip(chip.dataset.preset);
      animateTo(PRESETS[chip.dataset.preset]);
    }));
    sync();
    draw(gains);
  }

  // ---------- Optimizer preview ----------

  function initOptimizer() {
    const box = $('#opt');
    if (!box) return;
    const counts = [6, 4, 4, 2, 5, 8];
    const switches = $$('.switch', box);
    const update = () => {
      const on = switches.reduce((n, s, i) => n + (s.getAttribute('aria-checked') === 'true' ? counts[i] : 0), 0);
      $('#opt-count').textContent = `${on} / 29 tweaks on`;
    };
    switches.forEach((s) => s.addEventListener('click', () => {
      s.setAttribute('aria-checked', String(s.getAttribute('aria-checked') !== 'true'));
      update();
    }));
    let told = false;
    box.addEventListener('click', (e) => {
      if (!told && e.target.closest('.switch')) { told = true; toast('Preview only — in the app every change is backed up first.'); }
    });
    update();
  }

  // ---------- Colour lab ----------

  const START = { ...NEUTRAL, vibrance: 180 };
  const FORMAT = {
    vibrance: (v) => String(v),
    saturation: (v) => `${v}%`,
    brightness: (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'),
    gamma: (v) => (v / 100).toFixed(2),
    contrast: (v) => `${v}%`,
    temperature: (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'),
  };

  function initLab() {
    const view = $('#lab-view');
    if (!view) return;
    const canvas = $('canvas', view);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const flag = $('#lab-flag');
    const inputs = $$('#lab-controls input[type="range"]');
    const state = { ...START };
    let src = null;
    let out = ctx.createImageData(canvas.width, canvas.height);
    let original = false;
    let queued = false;
    let current = 'grass';

    const paint = (input) => input.style.setProperty('--fill', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
    const sync = () => inputs.forEach((i) => {
      i.value = String(state[i.dataset.key]);
      $(`#o-${i.dataset.key}`).textContent = FORMAT[i.dataset.key](state[i.dataset.key]);
      paint(i);
    });

    function render() {
      queued = false;
      if (!src) return;
      view.classList.toggle('orig', original);
      flag.textContent = original ? 'Original' : 'DisplayX';
      ctx.putImageData(original ? src : process(src, out, state), 0, 0);
    }
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(render); } };

    async function setScene(name) {
      current = name;
      try {
        const data = await sceneData(name, canvas);
        if (current !== name) return;
        src = data;
        out = ctx.createImageData(canvas.width, canvas.height);
        render();
      } catch (e) { console.warn('scene', name, e); }
    }

    inputs.forEach((i) => i.addEventListener('input', () => {
      state[i.dataset.key] = Number(i.value);
      $(`#o-${i.dataset.key}`).textContent = FORMAT[i.dataset.key](state[i.dataset.key]);
      paint(i);
      schedule();
    }));
    $('#reset-colors').addEventListener('click', () => { Object.assign(state, NEUTRAL); sync(); schedule(); });

    const hold = (on) => { if (original !== on) { original = on; schedule(); } };
    const btn = $('#hold-original');
    for (const t of [btn, view]) {
      t.addEventListener('pointerdown', (e) => { e.preventDefault(); t.setPointerCapture(e.pointerId); hold(true); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => t.addEventListener(ev, () => hold(false)));
    }
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hold(true); } });
    btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hold(false); });
    btn.addEventListener('blur', () => hold(false));

    segmented($('#lab-scenes'), (scene) => setScene(scene));
    sync();
    setScene('grass');
  }

  document.addEventListener('DOMContentLoaded', () => {
    initCompare();
    initZoom();
    initEq();
    initOptimizer();
    initLab();
  });
})();
