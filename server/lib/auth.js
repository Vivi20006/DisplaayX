'use strict';

const { userFromToken } = require('./users');

function bearer(req) {
  const h = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Requires a valid session token of a verified account. Sets req.user. */
function requireAuth(req, res, next) {
  const token = bearer(req);
  const user = token && userFromToken(token, 'session');
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  if (!user.email_verified) {
    return res.status(403).json({ error: 'Please verify your email first.', needsVerification: true });
  }
  req.user = user;
  next();
}

module.exports = { requireAuth, bearer };
