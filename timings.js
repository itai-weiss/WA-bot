const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MessageMedia } = require('whatsapp-web.js');

const eventLog = require('./eventLog');

const TIMINGS_PATH = path.join(__dirname, 'timings.json');
const ATTACHMENTS_DIR = path.join(__dirname, 'timing-attachments');
const INTER_SEND_DELAY_MS = 1500;
const MAX_TIMEOUT_MS = 2147483647; // ~24.8 days, setTimeout limit

let timings = [];
let waClient = null;
const timers = new Map();

function readJsonArray(filePath, label) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  const parsed = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`);
  return parsed;
}

function load() {
  if (fs.existsSync(TIMINGS_PATH)) {
    timings = readJsonArray(TIMINGS_PATH, 'timings.json');
    return;
  }

  timings = [];
}

function persist() {
  fs.writeFileSync(TIMINGS_PATH, JSON.stringify(timings, null, 2));
}

function validate(input, files = []) {
  const errors = [];
  if (!Array.isArray(input.groupIds) || input.groupIds.length === 0) {
    errors.push('select at least one group');
  }
  if ((!input.message || typeof input.message !== 'string' || !input.message.trim()) && files.length === 0) {
    errors.push('provide a message or at least one attachment');
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

function ensureAttachmentDir(timingId) {
  const dir = path.join(ATTACHMENTS_DIR, timingId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeAttachmentName(file) {
  const original = path.basename(file.originalname || 'attachment');
  return original.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'attachment';
}

function saveAttachments(timingId, files = []) {
  if (!files.length) return [];

  const dir = ensureAttachmentDir(timingId);
  return files.map((file, index) => {
    const id = 'att_' + crypto.randomBytes(4).toString('hex');
    const filename = `${String(index + 1).padStart(2, '0')}-${id}-${safeAttachmentName(file)}`;
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
    attachments: (timing.attachments || []).map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      mimetype: attachment.mimetype,
      size: attachment.size,
    })),
  };
}

function clearTimer(id) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function unscheduleAll() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

function scheduleOne(timing) {
  clearTimer(timing.id);
  if (!timing.enabled || timing.firedAt) return;

  const when = new Date(timing.scheduledAt).getTime();
  const delay = when - Date.now();
  if (delay <= 0) return;

  const chunk = Math.min(delay, MAX_TIMEOUT_MS);
  const handle = setTimeout(() => {
    timers.delete(timing.id);
    if (chunk < delay) {
      scheduleOne(timing);
      return;
    }
    fire(timing.id, 'timing').catch((err) =>
      console.error(`[timing] scheduled send failed: ${err.message}`)
    );
  }, chunk);
  timers.set(timing.id, handle);
}

function rescheduleAll() {
  unscheduleAll();
  for (const timing of timings) scheduleOne(timing);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fire(timingId, trigger = 'timing') {
  const timing = timings.find((item) => item.id === timingId);
  if (!timing) throw new Error(`timing ${timingId} not found`);
  if (!waClient) throw new Error('WhatsApp client unavailable');

  console.log(`[timing] firing "${timing.name}" -> ${timing.groupIds.length} group(s)`);

  const results = [];
  for (let i = 0; i < timing.groupIds.length; i++) {
    const groupId = timing.groupIds[i];
    let groupName = groupId;
    try {
      const chat = await waClient.getChatById(groupId);
      groupName = chat.name || groupId;
    } catch (_) {}

    try {
      const attachments = timing.attachments || [];
      if (!attachments.length) {
        await waClient.sendMessage(groupId, timing.message);
      } else {
        for (let j = 0; j < attachments.length; j++) {
          const attachment = attachments[j];
          const data = fs.readFileSync(attachment.path).toString('base64');
          const media = new MessageMedia(attachment.mimetype, data, attachment.originalName);
          const options = j === 0 && timing.message ? { caption: timing.message } : {};
          await waClient.sendMessage(groupId, media, options);
        }
      }
      eventLog.push({
        ok: true,
        source: `timing:${timing.name}`,
        trigger,
        group: groupName,
        groupId,
        chars: timing.message.length,
        files: (timing.attachments || []).length,
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
  persist();
  clearTimer(timing.id);
  removeAttachments(timing);
  return results;
}

function list() {
  return timings.map(publicTiming);
}

function create(input, files = []) {
  const errors = validate(input, files);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });

  const when = new Date(input.scheduledAt);
  const timingId = 'tm_' + crypto.randomBytes(4).toString('hex');
  const timing = {
    id: timingId,
    name: input.name?.trim() || `Timing ${when.toISOString()}`,
    groupIds: input.groupIds.map(String),
    message: (input.message || '').trim(),
    attachments: saveAttachments(timingId, files),
    scheduledAt: when.toISOString(),
    enabled: true,
    firedAt: null,
    lastTrigger: null,
    createdAt: new Date().toISOString(),
  };

  timings.push(timing);
  persist();
  scheduleOne(timing);
  return publicTiming(timing);
}

function remove(id) {
  const timing = timings.find((item) => item.id === id);
  const before = timings.length;
  timings = timings.filter((timing) => timing.id !== id);
  if (timings.length === before) {
    throw Object.assign(new Error('timing not found'), { status: 404 });
  }
  clearTimer(id);
  removeAttachments(timing);
  persist();
}

function init(client) {
  waClient = client;
  load();
  rescheduleAll();
  const upcoming = timings.filter(
    (timing) => !timing.firedAt && timing.enabled && new Date(timing.scheduledAt).getTime() > Date.now()
  ).length;
  console.log(`Timings loaded: ${timings.length} total, ${upcoming} upcoming`);
}

module.exports = {
  init,
  list,
  create,
  remove,
};
