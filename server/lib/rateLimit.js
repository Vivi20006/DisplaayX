'use strict';

// Small in-memory fixed-window limiter. Good enough for a single instance;
// put a shared store (Redis) behind it if the site ever runs on several.

const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.reset <= now) buckets.delete(key);
}, 60_000).unref();

/**
 * @param {object} opts
 * @param {number} opts.max        requests per window
 * @param {number} opts.windowMs   window length
 * @param {(req) => string} [opts.key] extra key part (e.g. the email being tried)
 */
function rateLimit({ name, max, windowMs, key }) {
  return (req, res, next) => {
    const id = `${name}:${req.ip}:${key ? key(req) : ''}`;
    const now = Date.now();
    let b = buckets.get(id);
    if (!b || b.reset <= now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(id, b);
    }
    b.count++;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please wait a moment and try again.' });
    }
    next();
  };
}

function resetRateLimits() {
  buckets.clear();
}

module.exports = { rateLimit, resetRateLimits };
