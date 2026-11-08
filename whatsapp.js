const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const DATA_DIR = require('./dataDir');

const state = {
  ready: false,
  qrDataUrl: null,
  phase: 'starting',
  startupError: null,
  browserPath: null,
  syncPercent: null,
  syncUpdatedAt: 0,
};

function clearStartupError() {
  state.startupError = null;
}

function setStartupError(code, message) {
  state.ready = false;
  state.qrDataUrl = null;
  state.phase = 'error';
  state.startupError = { code, message };
}

function setInitializeError(err) {
  if (/browser is already running/i.test(err.message)) {
    setStartupError(
      'SESSION_IN_USE',
      'כבר פועל מופע אחר של האפליקציה או של WhatsApp Web. יש לסגור אותו או לחזור לחלון שכבר פתוח.'
    );
    return;
  }

  setStartupError(
    'INITIALIZE_FAILED',
    'לא ניתן היה להפעיל את WhatsApp Web. יש לסגור חלונות קשורים ולנסות שוב.'
  );
}

function findBrowserPath() {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    console.warn(`CHROME_PATH set but file not found: ${process.env.CHROME_PATH}`);
  }

  const local = process.env.LOCALAPPDATA;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    local && `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Puppeteer's own Chrome (installed in the Docker image). Preferred over distro
  // Chromium there: upstream reports the session-restore 'ready' hang is worse with it.
  try {
    const bundled = require('puppeteer').executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (_) {}
  return null;
}

function createClient() {
  const executablePath = findBrowserPath();
  if (!executablePath) {
    setStartupError(
      'BROWSER_NOT_FOUND',
      'לא נמצא Google Chrome או Microsoft Edge. יש להתקין אחד מהם, או להגדיר CHROME_PATH.'
    );
    console.error(
      'No Chrome or Edge install found. Install Google Chrome, ' +
        'or set CHROME_PATH in .env to your browser .exe.'
    );
    return { client: null, state };
  }
  state.phase = 'starting';
  state.browserPath = executablePath;
  clearStartupError();
  console.log(`Using browser: ${executablePath}`);

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, '.wwebjs_auth') }),
    webVersionCache: { type: 'local', path: path.join(DATA_DIR, '.wwebjs_cache') },
    puppeteer: {
      headless: true,
      executablePath,
      // getChats() on large accounts during first sync can exceed the 180s default.
      protocolTimeout: 600000,
      // --disable-dev-shm-usage: Docker's default /dev/shm is too small for Chrome.
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  client.on('loading_screen', (percent, message) => {
    // After 'ready', WhatsApp keeps reporting sync progress; record it instead of
    // flipping the app back to a loading phase.
    if (state.ready) {
      state.syncPercent = Number(percent);
      state.syncUpdatedAt = Date.now();
      console.log(`Syncing WhatsApp: ${percent}%`);
      return;
    }
    state.phase = 'loading';
    clearStartupError();
    console.log(`Loading WhatsApp Web: ${percent}% ${message || ''}`.trim());
  });

  client.on('authenticated', () => {
    state.phase = 'syncing';
    clearStartupError();
    console.log('Authenticated — syncing chats…');
  });

  client.on('qr', async (qr) => {
    state.ready = false;
    state.phase = 'awaiting_scan';
    clearStartupError();
    qrcodeTerminal.generate(qr, { small: true });
    try {
      state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    } catch (err) {
      console.error('Failed to render QR for admin page:', err.message);
    }
  });

  client.on('ready', async () => {
    state.syncPercent = null;
    state.syncUpdatedAt = 0;
    state.ready = true;
    state.qrDataUrl = null;
    state.phase = 'ready';
    clearStartupError();
    console.log('WhatsApp client ready');
    try {
      const chats = await client.getChats();
      const groups = chats.filter((c) => c.isGroup);
      console.log(`Initial sync: ${chats.length} chats (${groups.length} groups)`);
      if (groups.length === 0 && chats.length === 0) {
        console.log('Chats not synced yet — they should arrive shortly. Try Refresh in the UI.');
      }
    } catch (err) {
      console.warn('Initial chat fetch failed:', err.message);
    }
  });

  client.on('auth_failure', (msg) => {
    console.error('Auth failure:', msg);
    setStartupError(
      'AUTH_FAILURE',
      'החיבור ל-WhatsApp נכשל. יש לנסות להתחבר מחדש מתוך WhatsApp בטלפון.'
    );
  });

  client.on('disconnected', (reason) => {
    console.error('Client disconnected:', reason);
    setStartupError(
      'DISCONNECTED',
      'החיבור ל-WhatsApp נותק. אם צריך, יש לסרוק מחדש את קוד ה-QR.'
    );
  });

  return { client, state };
}

// Still syncing after 'ready' while progress is below 100%. Progress sometimes stops
// at 99% without a final event, so a quiet period also counts as done.
// ponytail: fixed 30 s quiet window; tune if large accounts stall longer mid-sync.
const SYNC_QUIET_MS = 30 * 1000;
function syncStatus() {
  const syncing =
    state.ready &&
    state.syncPercent !== null &&
    state.syncPercent < 100 &&
    Date.now() - state.syncUpdatedAt < SYNC_QUIET_MS;
  return { syncing, syncPercent: syncing ? state.syncPercent : null };
}

module.exports = { createClient, state, setInitializeError, syncStatus };
