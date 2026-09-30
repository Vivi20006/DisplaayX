// Home page: screenshot fallback, zoom demo, equalizer demo, live colour demo.
(function () {
  'use strict';

  const { $, $$, reducedMotion } = window.DX;

  // ---------- App screenshot: show a neutral frame until app.png exists ----------

  function initShot() {
    const fig = $('[data-shot]');
    if (!fig) return;
    const img = $('.shot-img', fig);
    const missing = () => fig.classList.add('is-missing');
    if (img.complete && img.naturalWidth === 0) missing();
    img.addEventListener('error', missing);
  }

  // ---------- Scene loading: prefer real screenshots (.jpg), fall back to the bundled SVGs ----------

  const sceneCache = new Map();

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function loadScene(name) {
    if (!sceneCache.has(name)) {
      sceneCache.set(
        name,
        loadImage(`/assets/scenes/${name}.jpg`).catch(() => loadImage(`/assets/scenes/${name}.svg`)),
      );
    }
    return sceneCache.get(name);
  }

  // ---------- Ultra-zoom demo ----------

  function initZoom() {
    const stage = $('#zoom-stage');
    if (!stage) return;
    const img = $('img', stage);
    const badge = $('#zoom-badge');
    let factor = 3;
    let zoomed = false;
    let origin = { x: 50, y: 50 };

    img.style.transition = 'transform 0.32s cubic-bezier(0.2, 0.7, 0.2, 1), transform-origin 0.12s linear';

    function point(e) {
      const r = stage.getBoundingClientRect();
      return {
        x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)),
        y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)),
      };
    }
    function apply() {
      img.style.transformOrigin = `${origin.x}% ${origin.y}%`;
      img.style.transform = zoomed ? `scale(${factor})` : 'scale(1)';
      stage.classList.toggle('is-zoomed', zoomed);
    }
    function zoomIn() { zoomed = true; apply(); }
    function zoomOut() { zoomed = false; apply(); }

    stage.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      origin = point(e);
      zoomIn();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!zoomed && e.pointerType !== 'mouse') return;
      origin = point(e);
      if (zoomed) apply();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => stage.addEventListener(t, zoomOut));
    stage.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard: focus the stage and hold C (the app observes the key, it never swallows it).
    stage.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'c' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        zoomIn();
      }
    });
    stage.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'c') zoomOut(); });
    stage.addEventListener('blur', zoomOut);

    $$('[data-zoom]').forEach((chip) => {
      chip.addEventListener('click', () => {
        factor = Number(chip.dataset.zoom);
        badge.textContent = `${factor}×`;
        $$('[data-zoom]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        if (zoomed) apply();
      });
    });
  }

  // ---------- Equalizer demo ----------

  const BANDS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  // Illustrative curves for the browser preview.
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
    if (!svg || !bandsEl) return;
    const preampEl = $('#eq-preamp');
    const NS = 'http://www.w3.org/2000/svg';
    const W = 600, H = 220, PL = 38, PR = 16, PT = 14, PB = 28;
    const xs = BANDS.map((_, i) => PL + (i * (W - PL - PR)) / (BANDS.length - 1));
    const y = (g) => PT + ((12 - g) / 24) * (H - PT - PB);

    const el = (name, attrs, parent = svg) => {
      const n = document.createElementNS(NS, name);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      parent.appendChild(n);
      return n;
    };

    [12, 6, 0, -6, -12].forEach((g) => {
      el('line', { x1: PL, x2: W - PR, y1: y(g), y2: y(g), class: g === 0 ? 'zero-line' : 'grid-line' });
      const t = el('text', { x: PL - 8, y: y(g) + 4, 'text-anchor': 'end', class: 'axis-label' });
      t.textContent = g > 0 ? `+${g}` : g < 0 ? `−${-g}` : '0';
    });
    BANDS.forEach((b, i) => {
      const t = el('text', { x: xs[i], y: H - 8, 'text-anchor': 'middle', class: 'axis-label' });
      t.textContent = b;
    });
    const fill = el('path', { class: 'curve-fill' });
    const curve = el('path', { class: 'curve' });
    const knobs = BANDS.map((_, i) => el('circle', { cx: xs[i], r: 5, class: 'knob' }));

    // Sliders
    const inputs = BANDS.map((b, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'eq-band';
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '-12';
      input.max = '12';
      input.step = '1';
      input.id = `eq-${i}`;
      input.setAttribute('aria-label', `${b}${/k$/.test(b) ? 'Hz' : ' Hz'} gain in dB`);
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = b;
      wrap.append(out, input, label);
      bandsEl.appendChild(wrap);
      input.addEventListener('input', () => {
        gains[i] = Number(input.value);
        setPresetChip(null);
        draw(gains);
      });
      return { input, out };
    });

    let gains = PRESETS.footsteps.slice();

    function smoothPath(pts) {
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1].toFixed(1)}`;
      }
      return d;
    }

    function draw(g) {
      const pts = g.map((v, i) => [xs[i], y(v)]);
      const d = smoothPath(pts);
      curve.setAttribute('d', d);
      fill.setAttribute('d', `${d} L${xs[xs.length - 1]},${y(0)} L${xs[0]},${y(0)} Z`);
      knobs.forEach((k, i) => k.setAttribute('cy', pts[i][1].toFixed(1)));
      const max = Math.max(...gains);
      preampEl.textContent = max > 0 ? `−${max} dB` : '0 dB';
    }

    function syncInputs() {
      inputs.forEach(({ input, out }, i) => {
        input.value = String(gains[i]);
        out.textContent = gains[i] > 0 ? `+${gains[i]}` : String(gains[i]).replace('-', '−');
      });
    }
    // Keep outputs in sync while dragging.
    inputs.forEach(({ input, out }) => input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = v > 0 ? `+${v}` : String(v).replace('-', '−');
    }));

    function setPresetChip(name) {
      $$('[data-preset]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === name)));
    }

    let anim = 0;
    function animateTo(target) {
      cancelAnimationFrame(anim);
      const from = gains.slice();
      gains = target.slice();
      syncInputs();
      if (reducedMotion()) return draw(gains);
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / 260);
        const e = 1 - Math.pow(1 - t, 3);
        draw(from.map((f, i) => f + (target[i] - f) * e));
        if (t < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }

    $$('[data-preset]').forEach((chip) => {
      chip.addEventListener('click', () => {
        setPresetChip(chip.dataset.preset);
        animateTo(PRESETS[chip.dataset.preset]);
      });
    });

    syncInputs();
    draw(gains);
  }

  // ---------- Live colour demo ----------

  const NEUTRAL = { vibrance: 100, saturation: 100, brightness: 0, gamma: 100, contrast: 100, temperature: 0 };
  const START = { ...NEUTRAL, vibrance: 170 };

  const FORMAT = {
    vibrance: (v) => String(v),
    saturation: (v) => `${v}%`,
    brightness: (v) => (v > 0 ? `+${v}` : String(v).replace('-', '−')),
    gamma: (v) => (v / 100).toFixed(2),
    contrast: (v) => `${v}%`,
    temperature: (v) => (v === 0 ? '0' : v > 0 ? `+${v}` : String(v).replace('-', '−')),
  };

  function initColor() {
    const canvas = $('#color-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const monitor = $('#monitor');
    const W = canvas.width;
    const H = canvas.height;
    const state = { ...START };
    let original = null;
    let output = ctx.createImageData(W, H);
    let showOriginal = false;
    let queued = false;
    let currentScene = 'grass';

    const inputs = $$('#sliders input[type="range"]');

    function paintFill(input) {
      const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
      input.style.setProperty('--fill', `${pct}%`);
    }

    function syncInputs() {
      inputs.forEach((input) => {
        const key = input.dataset.key;
        input.value = String(state[key]);
        $(`#o-${key}`).textContent = FORMAT[key](state[key]);
        paintFill(input);
      });
    }

    function buildLut() {
      const k = (state.temperature / 100) * 0.12;
      const mul = [1 + k, 1 + k * 0.15, 1 - k];
      const bright = (state.brightness / 100) * 0.4;
      const contrast = state.contrast / 100;
      const invGamma = 100 / state.gamma;
      const luts = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
      for (let c = 0; c < 3; c++) {
        for (let i = 0; i < 256; i++) {
          let v = (i / 255) * mul[c];
          v += bright;
          v = (v - 0.5) * contrast + 0.5;
          v = Math.min(1, Math.max(0, v));
          v = Math.pow(v, invGamma);
          luts[c][i] = Math.round(v * 255);
        }
      }
      return luts;
    }

    function render() {
      queued = false;
      if (!original) return;
      monitor.classList.toggle('show-original', showOriginal);
      if (showOriginal) {
        ctx.putImageData(original, 0, 0);
        return;
      }
      const [lr, lg, lb] = buildLut();
      const sat = state.saturation / 100;
      const vib = (state.vibrance - 100) / 100;
      const src = original.data;
      const dst = output.data;
      for (let p = 0; p < src.length; p += 4) {
        const r = lr[src[p]];
        const g = lg[src[p + 1]];
        const b = lb[src[p + 2]];
        const max = r > g ? (r > b ? r : b) : g > b ? g : b;
        const min = r < g ? (r < b ? r : b) : g < b ? g : b;
        // Vibrance lifts muted colours more than already-saturated ones.
        const f = sat * (1 + vib * (1 - (max - min) / 255));
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        dst[p] = lum + (r - lum) * f;
        dst[p + 1] = lum + (g - lum) * f;
        dst[p + 2] = lum + (b - lum) * f;
        dst[p + 3] = 255;
      }
      ctx.putImageData(output, 0, 0);
    }

    function schedule() {
      if (!queued) {
        queued = true;
        requestAnimationFrame(render);
      }
    }

    async function setScene(name) {
      currentScene = name;
      try {
        const img = await loadScene(name);
        if (currentScene !== name) return;
        // Cover-fit into the canvas.
        const scale = Math.max(W / img.naturalWidth || W / img.width, H / img.naturalHeight || H / img.height);
        const w = (img.naturalWidth || img.width) * scale;
        const h = (img.naturalHeight || img.height) * scale;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        original = ctx.getImageData(0, 0, W, H);
        output = ctx.createImageData(W, H);
        render();
      } catch (err) {
        console.warn('Scene failed to load', name, err);
      }
    }

    inputs.forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.key;
        state[key] = Number(input.value);
        $(`#o-${key}`).textContent = FORMAT[key](state[key]);
        paintFill(input);
        schedule();
      });
    });

    $$('[data-scene-pick]').forEach((chip) => {
      chip.addEventListener('click', () => {
        $$('[data-scene-pick]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        setScene(chip.dataset.scenePick);
      });
    });

    $('#reset-colors').addEventListener('click', () => {
      Object.assign(state, NEUTRAL);
      syncInputs();
      schedule();
    });

    // Hold-for-original: on the button (pointer or Space/Enter) and on the image itself.
    const hold = (on) => {
      if (showOriginal === on) return;
      showOriginal = on;
      schedule();
    };
    const holdBtn = $('#hold-original');
    for (const target of [holdBtn, monitor]) {
      target.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        target.setPointerCapture(e.pointerId);
        hold(true);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => target.addEventListener(t, () => hold(false)));
    }
    monitor.addEventListener('contextmenu', (e) => e.preventDefault());
    holdBtn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        hold(true);
      }
    });
    holdBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hold(false); });
    holdBtn.addEventListener('blur', () => hold(false));

    syncInputs();
    setScene('grass');
  }

  document.addEventListener('DOMContentLoaded', () => {
    initShot();
    initZoom();
    initEq();
    initColor();
  });
})();
