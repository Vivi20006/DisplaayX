// Colour engine for the browser previews: vibrance, saturation, brightness, gamma, contrast, temperature.
(function () {
  'use strict';

  const NEUTRAL = { vibrance: 100, saturation: 100, brightness: 0, gamma: 100, contrast: 100, temperature: 0 };
  const cache = new Map();

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /** Real screenshots (.jpg) win; the bundled SVG illustrations are the fallback. */
  function loadScene(name) {
    if (!cache.has(name)) {
      cache.set(name, loadImage(`/assets/scenes/${name}.jpg`).catch(() => loadImage(`/assets/scenes/${name}.svg`)));
    }
    return cache.get(name);
  }

  /** Draw a scene cover-fitted into a canvas and return its ImageData. */
  async function sceneData(name, canvas) {
    const img = await loadScene(name);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const W = canvas.width, H = canvas.height;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.max(W / iw, H / ih);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    return ctx.getImageData(0, 0, W, H);
  }

  function luts(st) {
    const k = (st.temperature / 100) * 0.12;
    const mul = [1 + k, 1 + k * 0.15, 1 - k];
    const bright = (st.brightness / 100) * 0.4;
    const contrast = st.contrast / 100;
    const invGamma = 100 / st.gamma;
    return mul.map((m) => {
      const lut = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) {
        let v = (i / 255) * m + bright;
        v = (v - 0.5) * contrast + 0.5;
        v = Math.pow(Math.min(1, Math.max(0, v)), invGamma);
        lut[i] = Math.round(v * 255);
      }
      return lut;
    });
  }

  /** Apply settings to `src` ImageData, writing into `dst` ImageData. */
  function process(src, dst, settings) {
    const st = { ...NEUTRAL, ...settings };
    const [lr, lg, lb] = luts(st);
    const sat = st.saturation / 100;
    const vib = (st.vibrance - 100) / 100;
    const s = src.data, d = dst.data;
    for (let p = 0; p < s.length; p += 4) {
      const r = lr[s[p]], g = lg[s[p + 1]], b = lb[s[p + 2]];
      const max = r > g ? (r > b ? r : b) : g > b ? g : b;
      const min = r < g ? (r < b ? r : b) : g < b ? g : b;
      // Vibrance lifts muted colours more than colours that are already strong.
      const f = sat * (1 + vib * (1 - (max - min) / 255));
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      d[p] = l + (r - l) * f;
      d[p + 1] = l + (g - l) * f;
      d[p + 2] = l + (b - l) * f;
      d[p + 3] = 255;
    }
    return dst;
  }

  window.DXColor = { NEUTRAL, loadScene, sceneData, process };
})();
