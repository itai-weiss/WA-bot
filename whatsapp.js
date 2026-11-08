const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');

const state = {
  ready: false,
  qrDataUrl: null,
  phase: 'starting',
  startupError: null,
  browserPath: null,
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
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
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
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('loading_screen', (percent, message) => {
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

module.exports = { createClient, state, setInitializeError };
