'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;
if (config.mail.host) {
  transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  });
}

/** Mails "sent" without SMTP are kept here (tests read them) and printed in dev. */
const outbox = [];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function layout({ heading, intro, buttonLabel, url, outro }) {
  const text = `${heading}\n\n${intro}\n\n${buttonLabel}: ${url}\n\n${outro}\n\n— DisplayX · ${config.publicUrl}`;
  const html = `<!doctype html><html><body style="margin:0;background:#0d1420;font-family:'Segoe UI',system-ui,sans-serif;color:#f4f7fb">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1a2334;border:1px solid rgba(255,255,255,.11);border-radius:16px;padding:32px">
      <tr><td>
        <div style="font-weight:700;font-size:18px;margin-bottom:24px"><span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:#2563eb;border-radius:7px;color:#fff;margin-right:8px">X</span>DisplayX</div>
        <h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(heading)}</h1>
        <p style="color:#9fb0c8;line-height:1.6;margin:0 0 24px">${escapeHtml(intro)}</p>
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:11px;font-weight:600">${escapeHtml(buttonLabel)}</a>
        <p style="color:#6f819b;font-size:13px;line-height:1.6;margin:24px 0 0">${escapeHtml(outro)}<br><br>Link not working? Copy this into your browser:<br><span style="color:#9fb0c8;word-break:break-all">${escapeHtml(url)}</span></p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { text, html };
}

async function send(to, subject, body) {
  const message = { from: config.mail.from, to, subject, ...body };
  if (transport) {
    await transport.sendMail(message);
    return;
  }
  outbox.push(message);
  if (outbox.length > 50) outbox.shift();
  if (!config.isTest) {
    console.log(`\n[mail] SMTP not configured – would send to ${to}: "${subject}"\n${body.text}\n`);
  }
}

function sendVerification(to, url) {
  return send(to, 'Verify your DisplayX email', layout({
    heading: 'Confirm your email',
    intro: 'Click the button to verify your email address. After that you can sign in and download DisplayX.',
    buttonLabel: 'Verify email',
    url,
    outro: 'The link is valid for 24 hours. If you didn’t create a DisplayX account, ignore this email.',
  }));
}

function sendPasswordReset(to, url) {
  return send(to, 'Reset your DisplayX password', layout({
    heading: 'Reset your password',
    intro: 'Someone (hopefully you) asked to reset the password for your DisplayX account.',
    buttonLabel: 'Choose a new password',
    url,
    outro: 'The link is valid for 1 hour. If you didn’t ask for this, ignore this email – your password stays the same.',
  }));
}

module.exports = { sendVerification, sendPasswordReset, outbox };
