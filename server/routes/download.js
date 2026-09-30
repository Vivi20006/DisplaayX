'use strict';

const fs = require('node:fs');
const express = require('express');
const config = require('../config');
const { requireAuth } = require('../lib/auth');
const users = require('../lib/users');

const router = express.Router();

const available = () => !!config.download.url || fs.existsSync(config.download.file);

router.get('/info', (req, res) => {
  const { version, sizeLabel, os } = config.download;
  res.json({ version, size: sizeLabel, os, available: available() });
});

/**
 * The session token lives in localStorage, so a plain <a href> can't carry it.
 * The dashboard asks for a short-lived signed link and navigates to it.
 */
router.post('/link', requireAuth, (req, res) => {
  if (!available()) return res.status(503).json({ error: 'The download is not available right now. Please try again later.' });
  res.json({ url: `/api/download/file?t=${encodeURIComponent(users.signDownload(req.user))}` });
});

router.get('/file', (req, res) => {
  const user = users.userFromToken(String(req.query.t || ''), 'dl');
  if (!user) return res.redirect(302, '/dashboard?download=expired');
  if (config.download.url) return res.redirect(302, config.download.url);
  if (!fs.existsSync(config.download.file)) return res.redirect(302, '/dashboard?download=unavailable');
  res.download(config.download.file, 'DisplayX.exe');
});

module.exports = router;
