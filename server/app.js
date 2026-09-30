'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          objectSrc: ["'none'"],
          ...(config.publicUrl.startsWith('https://') ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: config.publicUrl.startsWith('https://'),
      referrerPolicy: { policy: 'no-referrer' }, // keeps ?token=… out of Referer headers
    }),
  );

  // Optional CORS for the API when the site is served from another origin.
  if (config.corsOrigins.length) {
    app.use('/api', (req, res, next) => {
      const origin = req.get('origin');
      if (origin && config.corsOrigins.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  app.use('/api', express.json({ limit: '10kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/oauth', require('./routes/oauth'));
  app.use('/api/download', require('./routes/download'));
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Pages with clean URLs.
  const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
  app.get(['/login', '/register', '/forgot-password', '/reset-password'], page('auth.html'));
  app.get('/dashboard', page('dashboard.html'));
  app.get('/imprint', page('imprint.html'));
  app.get('/privacy', page('privacy.html'));

  app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));

  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
