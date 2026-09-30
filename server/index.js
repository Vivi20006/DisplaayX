'use strict';

const config = require('./config');
const { createApp } = require('./app');

createApp().listen(config.port, () => {
  console.log(`DisplayX site running on ${config.publicUrl} (port ${config.port})`);
  if (!config.mail.host) console.log('[mail] SMTP not configured – emails are printed to this console.');
  for (const name of ['google', 'discord']) {
    if (!config[name].clientId) console.log(`[oauth] ${name} sign-in disabled (no client id/secret).`);
  }
});
