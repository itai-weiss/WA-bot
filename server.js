require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const { createClient, state, setInitializeError } = require('./whatsapp');
const timings = require('./timings');
const metagroups = require('./metagroups');
const keepAwake = require('./keepAwake');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_PORT_ATTEMPTS = 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024, files: 30 },
});

const { client } = createClient();

if (client) {
  client.on('ready', () => {
    try {
      timings.init(client, () => state.ready);
    } catch (err) {
      console.warn('Could not initialize timings:', err.message);
    }
  });

  client.initialize().catch((err) => {
    console.error('WhatsApp initialize failed:', err.message);
    setInitializeError(err);
  });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let boundPort = null;

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
  });
});

app.get('/api/groups', async (req, res) => {
  if (!state.ready) return res.status(503).json({ error: getClientUnavailableMessage() });

  try {
    const chats = await client.getChats();
    const groups = chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({ id: chat.id._serialized, name: chat.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    console.log(`[/api/groups] ${chats.length} chats, ${groups.length} groups`);
    res.json({ groups, totalChats: chats.length });
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
    const chats = await client.getChats();
    for (const chat of chats) {
      if (chat.isGroup) groupNames[chat.id._serialized] = chat.name;
    }
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
