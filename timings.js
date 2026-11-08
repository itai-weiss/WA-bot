const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MessageMedia } = require('whatsapp-web.js');

const eventLog = require('./eventLog');
const keepAwake = require('./keepAwake');

const TIMINGS_PATH = path.join(__dirname, 'timings.json');
const ATTACHMENTS_DIR = path.join(__dirname, 'timing-attachments');
const INTER_SEND_DELAY_MS = 1500;
const CHECK_INTERVAL_MS = 15 * 1000;
// A timing found overdue (PC was off/asleep, app closed) is still sent if it is
// at most this late; older ones are marked missed instead of arriving hours late.
// ponytail: fixed grace window, make it a per-timing setting if users ask.
const LATE_GRACE_MS = 6 * 60 * 60 * 1000;
const MAX_MESSAGES = 10;

let timings = [];
let waClient = null;
let isClientReady = () => true;
let checkHandle = null;
const sending = new Set();

function readJsonArray(filePath, label) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  const parsed = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`);
  return parsed;
}

// Timings saved before multi-message support have a single message + attachments.
function normalize(timing) {
  if (Array.isArray(timing.messages)) return timing;
  const { message, attachments, ...rest } = timing;
  return { ...rest, messages: [{ text: message || '', attachments: attachments || [] }] };
}

function load() {
  timings = fs.existsSync(TIMINGS_PATH)
    ? readJsonArray(TIMINGS_PATH, 'timings.json').map(normalize)
    : [];
}

function persist() {
  fs.writeFileSync(TIMINGS_PATH, JSON.stringify(timings, null, 2));
}

function validate(input, filesByMessage) {
  const errors = [];
  if (!Array.isArray(input.groupIds) || input.groupIds.length === 0) {
    errors.push('select at least one group');
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    errors.push('add at least one message');
  } else if (input.messages.length > MAX_MESSAGES) {
    errors.push(`at most ${MAX_MESSAGES} messages per timing`);
  } else {
    input.messages.forEach((message, i) => {
      const text = typeof message?.text === 'string' ? message.text.trim() : '';
      if (!text && !(filesByMessage[i] || []).length) {
        errors.push(`message ${i + 1} needs text or an attachment`);
      }
    });
  }
  if (!input.scheduledAt) {
    errors.push('scheduledAt is required');
  } else {
    const when = new Date(input.scheduledAt);
    if (Number.isNaN(when.getTime())) {
      errors.push('scheduledAt is not a valid date');
    } else if (when.getTime() <= Date.now()) {
      errors.push('scheduledAt must be in the future');
    }
  }
  return errors;
}

function safeAttachmentName(file) {
  const original = path.basename(file.originalname || 'attachment');
  return original.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'attachment';
}

function saveAttachments(timingId, messageIndex, files = []) {
  if (!files.length) return [];

  const dir = path.join(ATTACHMENTS_DIR, timingId);
  fs.mkdirSync(dir, { recursive: true });
  return files.map((file, index) => {
    const id = 'att_' + crypto.randomBytes(4).toString('hex');
    const filename = `m${messageIndex + 1}-${String(index + 1).padStart(2, '0')}-${id}-${safeAttachmentName(file)}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, file.buffer);
    return {
      id,
      originalName: file.originalname || filename,
      mimetype: file.mimetype || 'application/octet-stream',
      size: file.size || file.buffer.length,
      path: filePath,
    };
  });
}

function removeAttachments(timing) {
  if (!timing?.id) return;
  fs.rmSync(path.join(ATTACHMENTS_DIR, timing.id), { recursive: true, force: true });
}

function publicTiming(timing) {
  return {
    ...timing,
    messages: timing.messages.map((message) => ({
      text: message.text,
      attachments: (message.attachments || []).map(({ id, originalName, mimetype, size }) => ({
        id,
        originalName,
        mimetype,
        size,
      })),
    })),
  };
}

function isPending(timing) {
  return timing.enabled && !timing.firedAt && !timing.missedAt;
}

function nextPendingAt() {
  const times = timings.filter(isPending).map((timing) => new Date(timing.scheduledAt).getTime());
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

function updateKeepAwake() {
  keepAwake.set(timings.some(isPending));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polling instead of one long setTimeout per timing: timers don't reliably
// survive Windows sleep, while a periodic check catches up right after wake.
function checkDue() {
  if (!waClient || !isClientReady()) return;
  const now = Date.now();
  let changed = false;

  for (const timing of timings) {
    if (!isPending(timing) || sending.has(timing.id)) continue;
    const late = now - new Date(timing.scheduledAt).getTime();
    if (late < 0) continue;

    if (late > LATE_GRACE_MS) {
      timing.missedAt = new Date().toISOString();
      changed = true;
      removeAttachments(timing);
      console.warn(`[timing] missed "${timing.name}" (${Math.round(late / 60000)} min late)`);
      continue;
    }

    sending.add(timing.id);
    fire(timing.id, late > CHECK_INTERVAL_MS * 2 ? 'late' : 'timing')
      .catch((err) => console.error(`[timing] scheduled send failed: ${err.message}`))
      .finally(() => sending.delete(timing.id));
  }

  if (changed) {
    persist();
    updateKeepAwake();
  }
}

async function sendMessageTo(groupId, message) {
  const attachments = message.attachments || [];
  if (!attachments.length) {
    await waClient.sendMessage(groupId, message.text);
    return;
  }
  for (let j = 0; j < attachments.length; j++) {
    const attachment = attachments[j];
    const data = fs.readFileSync(attachment.path).toString('base64');
    const media = new MessageMedia(attachment.mimetype, data, attachment.originalName);
    const options = j === 0 && message.text ? { caption: message.text } : {};
    await waClient.sendMessage(groupId, media, options);
  }
}

async function fire(timingId, trigger = 'timing') {
  const timing = timings.find((item) => item.id === timingId);
  if (!timing) throw new Error(`timing ${timingId} not found`);
  if (!waClient) throw new Error('WhatsApp client unavailable');

  console.log(
    `[timing] firing "${timing.name}" -> ${timing.groupIds.length} group(s), ${timing.messages.length} message(s)`
  );

  const results = [];
  for (let i = 0; i < timing.groupIds.length; i++) {
    const groupId = timing.groupIds[i];
    let groupName = groupId;
    try {
      const chat = await waClient.getChatById(groupId);
      groupName = chat.name || groupId;
    } catch (_) {}

    try {
      for (let m = 0; m < timing.messages.length; m++) {
        await sendMessageTo(groupId, timing.messages[m]);
        if (m < timing.messages.length - 1) await sleep(INTER_SEND_DELAY_MS);
      }
      eventLog.push({
        ok: true,
        source: `timing:${timing.name}`,
        trigger,
        group: groupName,
        groupId,
        messages: timing.messages.length,
      });
      results.push({ groupId, groupName, ok: true });
      console.log(`[timing] sent to ${groupName}`);
    } catch (err) {
      eventLog.push({
        ok: false,
        source: `timing:${timing.name}`,
        trigger,
        group: groupName,
        groupId,
        error: err.message,
      });
      results.push({ groupId, groupName, ok: false, error: err.message });
      console.error(`[timing] failed for ${groupName}: ${err.message}`);
    }

    if (i < timing.groupIds.length - 1) await sleep(INTER_SEND_DELAY_MS);
  }

  timing.firedAt = new Date().toISOString();
  timing.lastTrigger = trigger;
  timing.failedGroups = results.filter((r) => !r.ok).map((r) => r.groupName);
  persist();
  removeAttachments(timing);
  updateKeepAwake();
  return results;
}

function list() {
  return timings.map(publicTiming);
}

// filesByMessage[i] holds the uploaded files for input.messages[i].
function create(input, filesByMessage = []) {
  const errors = validate(input, filesByMessage);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

  const when = new Date(input.scheduledAt);
  const timingId = 'tm_' + crypto.randomBytes(4).toString('hex');
  const timing = {
    id: timingId,
    name: input.name?.trim() || `Timing ${when.toISOString()}`,
    groupIds: input.groupIds.map(String),
    metagroupNames: Array.isArray(input.metagroupNames) ? input.metagroupNames.map(String) : [],
    messages: input.messages.map((message, i) => ({
      text: (message.text || '').trim(),
      attachments: saveAttachments(timingId, i, filesByMessage[i] || []),
    })),
    scheduledAt: when.toISOString(),
    enabled: true,
    firedAt: null,
    missedAt: null,
    lastTrigger: null,
    createdAt: new Date().toISOString(),
  };

  timings.push(timing);
  persist();
  updateKeepAwake();
  return publicTiming(timing);
}

function remove(id) {
  const timing = timings.find((item) => item.id === id);
  if (!timing) throw Object.assign(new Error('timing not found'), { status: 404 });
  if (sending.has(id)) throw Object.assign(new Error('timing is being sent right now'), { status: 409 });
  timings = timings.filter((item) => item.id !== id);
  removeAttachments(timing);
  persist();
  updateKeepAwake();
}

function init(client, readyFn) {
  waClient = client;
  if (readyFn) isClientReady = readyFn;
  load();
  updateKeepAwake();
  if (!checkHandle) checkHandle = setInterval(checkDue, CHECK_INTERVAL_MS);
  const upcoming = timings.filter(isPending).length;
  console.log(`Timings loaded: ${timings.length} total, ${upcoming} upcoming`);
  checkDue();
}

module.exports = {
  init,
  list,
  create,
  remove,
  nextPendingAt,
  _test: { checkDue, normalize, LATE_GRACE_MS },
};
