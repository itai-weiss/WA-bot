const fs = require('fs');
const path = require('path');

// Where timings, metagroups, attachments and the WhatsApp session live.
// Defaults to the app folder; set DATA_DIR (e.g. a Docker volume) on a server.
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
fs.mkdirSync(DATA_DIR, { recursive: true });

module.exports = DATA_DIR;
