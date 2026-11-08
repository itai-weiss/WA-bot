require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { createClient, state, setInitializeError, syncStatus } = require('./whatsapp');
const timings = require('./timings');
const metagroups = require('./metagroups');
const keepAwake = require('./keepAwake');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_ATTEMPTS = 10;
// Checked before the WhatsApp client starts, so an exit here never leaves Chrome behind.
const APP_PASSWORD = process.env.APP_PASSWORD || '';
if (!APP_PASSWORD && !['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  console.error(`Refusing to listen on ${HOST} without APP_PASSWORD: the admin UI would be open to anyone.`);
  process.exit(1);
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 30 },
});

const { client } = createClient();

// whatsapp-web.js sometimes never fires 'ready' when restoring a saved session
// (upstream wwebjs/whatsapp-web.js#127084). Unattended, that means no sends at all,
// so restart the client if 'ready' hasn't come a few minutes after 'authenticated'.
// ponytail: blind restart with no cap; add backoff if it ever loops for long.
const READY_TIMEOUT_MS = 3 * 60 * 1000;
let readyTimer = null;

async function restartClient() {
  console.warn('[watchdog] WhatsApp authenticated but not ready after 3 min; restarting client');
  try {
    await client.destroy();
  } catch (err) {
    console.warn('[watchdog] destroy failed:', err.message);
  }
  client.initialize().catch((err) => {
    console.error('WhatsApp initialize failed:', err.message);
    setInitializeError(err);
  });
}

if (client) {
  client.on('authenticated', () => {
    clearTimeout(readyTimer);
    readyTimer = setTimeout(restartClient, READY_TIMEOUT_MS);
  });

  client.on('ready', () => {
    clearTimeout(readyTimer);
    try {
      timings.init(client, () => state.ready);
    } catch (err) {
      console.warn('Could not initialize timings:', err.message);
    }
  });

  // Scheduling from the user's own "Message yourself" chat (see chatCommands.js).
  require('./chatCommands').attach(client);

  client.initialize().catch((err) => {
    console.error('WhatsApp initialize failed:', err.message);
    setInitializeError(err);
  });

  // `docker stop` sends SIGTERM. Puppeteer's own handler closes Chrome but never
  // exits node, so Docker would SIGKILL us mid-write; close cleanly and exit.
  process.once('SIGTERM', async () => {
    console.log('SIGTERM: closing WhatsApp client');
    try {
      await client.destroy();
    } catch (_) {}
    process.exit(0);
  });
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const passwordDigest = sha256(APP_PASSWORD);

const app = express();

// HTTP Basic auth on every route when APP_PASSWORD is set. Any username is accepted.
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    const decoded = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
    const given = decoded.slice(decoded.indexOf(':') + 1);
    if (decoded.includes(':') && crypto.timingSafeEqual(sha256(given), passwordDigest)) return next();
    res.set('WWW-Authenticate', 'Basic realm="WA-bot", charset="UTF-8"').status(401).send('Password required');
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let boundPort = null;

// Group ids and names, read straight from WhatsApp Web's in-memory chat list.
// client.getChats() also asks WhatsApp's servers for every group's metadata (one
// request per group), which takes minutes on accounts with hundreds of groups.
function readGroups() {
  return client.pupPage.evaluate(() => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    return {
      totalChats: chats.length,
      groups: chats
        .filter((chat) => chat.groupMetadata)
        .map((chat) => ({ id: chat.id._serialized || chat.id.$1, name: chat.formattedTitle || '' })),
    };
  });
}

// WhatsApp Web sometimes reloads its page (right after linking, or while syncing);
// calls made meanwhile fail until the page is back, so retry those briefly.
const PAGE_RELOADING_RE = /Execution context was destroyed|Cannot find context|detached Frame|window\.require is not a function|reading 'Chat'/i;

async function listGroups(attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readGroups();
    } catch (err) {
      if (attempt >= attempts || !state.ready || !PAGE_RELOADING_RE.test(err.message)) throw err;
      console.warn(`[groups] WhatsApp page reloading, retry ${attempt}/${attempts - 1}: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

function getClientUnavailableMessage() {
  return state.startupError?.message || 'WhatsApp עדיין לא מוכן';
}

app.get('/api/status', (req, res) => {
  res.json({
    ready: state.ready,
    qr: state.qrDataUrl || null,
    phase: state.phase,
    error: state.startupError,
    browserPath: state.browserPath,
    tz: process.env.TZ || 'Asia/Jerusalem',
    host: HOST,
    port: boundPort,
    keepAwake: keepAwake.active(),
    nextAt: timings.nextPendingAt(),
    ...syncStatus(),
  });
});

app.get('/api/groups', async (req, res) => {
  if (!state.ready) return res.status(503).json({ error: getClientUnavailableMessage() });

  try {
    const started = Date.now();
    const { groups, totalChats } = await listGroups();
    groups.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`[/api/groups] ${totalChats} chats, ${groups.length} groups (${Date.now() - started} ms)`);
    res.json({ groups, totalChats });
  } catch (err) {
    console.error('[/api/groups] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/timings', async (req, res) => {
  if (!state.ready) return res.status(503).json({ error: getClientUnavailableMessage() });

  const items = timings.list();
  const groupNames = {};

  try {
    const { groups } = await listGroups();
    for (const group of groups) groupNames[group.id] = group.name;
  } catch (_) {}

  res.json(
    items.map((item) => ({
      ...item,
      groupNames: item.groupIds.map((id) => groupNames[id] || id),
    }))
  );
});

app.get('/api/metagroups', (req, res) => {
  if (!state.ready) return res.status(503).json({ error: getClientUnavailableMessage() });
  res.json(metagroups.list());
});

app.post('/api/metagroups', (req, res) => {
  if (!state.ready) return res.status(503).json({ error: getClientUnavailableMessage() });

  try {
    const metagroup = metagroups.create(req.body);
    res.status(201).json(metagroup);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/metagroups/:id', (req, res) => {
  if (!state.ready) return res.status(503).json({ error: getClientUnavailableMessage() });

  try {
    metagroups.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Body: metagroupIds[], scheduledAt, messages (JSON [{text}]); files for message i in field files_<i>.
// Recipients are resolved from metagroups now, so deleting a metagroup later
// does not change timings that were already saved.
app.post('/api/timings', upload.any(), (req, res) => {
  if (!state.ready) return res.status(503).json({ error: getClientUnavailableMessage() });

  try {
    const metagroupIds = [].concat(req.body.metagroupIds || []).filter(Boolean);
    const chosen = metagroups.list().filter((m) => metagroupIds.includes(m.id));
    if (!chosen.length || chosen.length !== new Set(metagroupIds).size) {
      return res.status(400).json({ error: 'select at least one existing metagroup' });
    }
    const groupIds = [...new Set(chosen.flatMap((m) => m.groupIds))];
    const metagroupNames = chosen.map((m) => m.name);
    let messages;
    try {
      messages = JSON.parse(req.body.messages || '[]');
    } catch (_) {
      return res.status(400).json({ error: 'messages must be JSON' });
    }
    const filesByMessage = [];
    for (const file of req.files || []) {
      const match = /^files_(\d+)$/.exec(file.fieldname);
      if (!match) continue;
      (filesByMessage[Number(match[1])] ||= []).push(file);
    }
    const timing = timings.create({ ...req.body, groupIds, metagroupNames, messages }, filesByMessage);
    res.status(201).json(timing);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/timings/:id', (req, res) => {
  if (!state.ready) return res.status(503).json({ error: getClientUnavailableMessage() });

  try {
    timings.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function startServer(port, attempt = 0) {
  const server = app.listen(port, HOST);

  server.once('listening', () => {
    boundPort = port;
    if (port !== PORT) {
      console.warn(`Port ${PORT} busy, using ${port} instead.`);
    }
    console.log(`Admin UI: http://${HOST}:${port}`);
  });

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
      startServer(port + 1, attempt + 1);
      return;
    }

    console.error('Server failed to start:', err.message);
    process.exit(1);
  });
}

startServer(PORT);
