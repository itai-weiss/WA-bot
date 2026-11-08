// Schedule timings from WhatsApp itself, in the user's own "Message yourself" chat:
//
//   תזמון              <- opening message: starts a draft
//   מחר 18:00          <- when: HH:MM, היום/מחר/מחרתיים HH:MM, DD/MM[/YYYY] HH:MM
//   קבוצות: א, ב       <- metagroup names
//   ...1-10 messages (text, photo, file), sent later in this order...
//   תזמון: סוף         <- saves the timing (תזמון: ביטול drops the draft)
//
// Outside a draft: "רשימה" lists metagroups and pending timings, "בטל <קוד>" cancels
// one, "עזרה" shows the format. Anything else in that chat is ignored (people keep
// notes there), and no other chat is ever read.
const timings = require('./timings');
const metagroups = require('./metagroups');

const BOT = '🤖 '; // prefix on our replies, so we never read them back as input
const MAX_MESSAGES = 10;
const END = 'תזמון: סוף';
const CANCEL = 'תזמון: ביטול';
const END_RE = /^תזמון\s*:?\s*סוף$/;
const CANCEL_RE = /^תזמון\s*:?\s*ביטול$/;
const HEADER_RE = /^תזמון\s*:?$/;
const GROUPS_RE = /^(מטא-?)?קבוצ(ות|ה)\s*:/;

const HELP = [
  'כך קובעים תזמון מכאן:',
  '1. שולחים הודעה אחת עם 3 שורות:',
  'תזמון',
  'מחר 18:00',
  'קבוצות: שם, שם',
  '(בשורת הקבוצות כותבים שמות של מטא-קבוצות)',
  `2. שולחים 1-${MAX_MESSAGES} הודעות (טקסט, תמונה או קובץ), לפי הסדר שבו הן יישלחו.`,
  `3. שולחים: ${END}`,
  '',
  'זמן: 18:00, היום 18:00, מחר 18:00, מחרתיים 9:30, 25/11 18:00, 25/11/2027 18:00',
  `ביטול באמצע: ${CANCEL}`,
  'רשימה: המטא-קבוצות והתזמונים הממתינים',
  'בטל <קוד>: ביטול תזמון שכבר נשמר',
].join('\n');

let draft = null;
let myIds = new Set();
let queue = Promise.resolve();

const key = (s) => s.trim().toLowerCase();
const code = (timing) => timing.id.slice(3, 7);
const isPending = (t) => t.enabled && !t.firedAt && !t.missedAt;
const fmt = (date) =>
  new Date(date).toLocaleString('he-IL', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Local time of this process (TZ=Asia/Jerusalem in Docker).
function parseWhen(text, now = new Date()) {
  const m = /^(?:(היום|מחרתיים|מחר)\s+|(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?\s+)?(\d{1,2}):(\d{2})$/.exec(
    text.trim()
  );
  if (!m) throw new Error(`לא הבנתי את הזמן "${text}". דוגמאות: 18:00, מחר 18:00, 25/11 18:00`);
  const [, word, d, mo, y, hh, mm] = m;
  const h = Number(hh);
  const min = Number(mm);
  if (h > 23 || min > 59) throw new Error(`השעה ${hh}:${mm} לא קיימת`);

  let when;
  if (d) {
    const year = y ? Number(y.length === 2 ? `20${y}` : y) : now.getFullYear();
    when = new Date(year, Number(mo) - 1, Number(d), h, min);
    if (when.getDate() !== Number(d) || when.getMonth() !== Number(mo) - 1) {
      throw new Error(`התאריך ${d}/${mo} לא קיים`);
    }
    // "5/1" written in December means next January.
    if (!y && when <= now) when.setFullYear(year + 1);
  } else {
    const days = { מחר: 1, מחרתיים: 2 }[word] || 0;
    when = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, min);
  }
  if (when <= now) throw new Error(`הזמן ${fmt(when)} כבר עבר`);
  return when;
}

function parseHeader(body) {
  const lines = body.split('\n').map((s) => s.trim()).filter(Boolean);
  const groupsLine = lines.find((l) => GROUPS_RE.test(l));
  const rest = lines.slice(1).filter((l) => l !== groupsLine);
  if (!groupsLine || rest.length !== 1) {
    throw new Error('בהודעת הפתיחה צריכות להיות בדיוק 3 שורות: תזמון, זמן, וקבוצות: ...');
  }
  const when = parseWhen(rest[0]);
  const names = groupsLine.replace(/^[^:]*:/, '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.length) throw new Error('לא כתבתם אף מטא-קבוצה אחרי "קבוצות:"');
  const all = metagroups.list();
  const missing = names.filter((n) => !all.some((mg) => key(mg.name) === key(n)));
  if (missing.length) {
    throw new Error(`לא מצאתי מטא-קבוצה בשם: ${missing.join(', ')}. שלחו "רשימה" כדי לראות את השמות.`);
  }
  return { when, chosen: all.filter((mg) => names.some((n) => key(n) === key(mg.name))) };
}

const recipients = (chosen) => [...new Set(chosen.flatMap((mg) => mg.groupIds))];

async function addToDraft(msg, body, reply) {
  if (draft.messages.length >= MAX_MESSAGES) {
    return reply(`כבר יש ${MAX_MESSAGES} הודעות, וזה המקסימום. שלחו ${END} כדי לשמור, או ${CANCEL}.`);
  }
  const files = [];
  if (msg.hasMedia) {
    let media = null;
    try {
      media = await msg.downloadMedia();
    } catch (_) {}
    if (!media) return reply('לא הצלחתי להוריד את הקובץ, ולכן ההודעה לא נוספה. נסו לשלוח אותו שוב.');
    const ext = (media.mimetype.split('/')[1] || 'bin').split(';')[0];
    files.push({
      buffer: Buffer.from(media.data, 'base64'),
      originalname: media.filename || `attachment.${ext}`,
      mimetype: media.mimetype,
    });
  }
  if (!body && !files.length) return; // system notices, deleted messages
  draft.messages.push({ text: body, files });
}

async function finish(reply) {
  if (!draft.messages.length) {
    return reply(`עדיין אין הודעות בתזמון. שלחו לפחות הודעה אחת, ואז ${END}`);
  }
  const d = draft;
  draft = null;
  if (d.when <= new Date()) {
    return reply(`הזמן ${fmt(d.when)} עבר בזמן שכתבתם, ולכן התזמון לא נשמר. התחילו מחדש.`);
  }
  try {
    const groupIds = recipients(d.chosen);
    const timing = timings.create(
      {
        groupIds,
        metagroupNames: d.chosen.map((mg) => mg.name),
        scheduledAt: d.when.toISOString(),
        messages: d.messages.map((m) => ({ text: m.text })),
      },
      d.messages.map((m) => m.files)
    );
    await reply(
      `נקבע ✓\n${d.messages.length} הודעות, ${fmt(d.when)}, אל ${d.chosen.map((mg) => mg.name).join(', ')} ` +
        `(${groupIds.length} קבוצות).\nקוד: ${code(timing)}. לביטול: בטל ${code(timing)}`
    );
  } catch (err) {
    await reply(`התזמון לא נשמר: ${err.message}`);
  }
}

function listText() {
  const mgs = metagroups.list();
  const pending = timings
    .list()
    .filter(isPending)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const preview = (t) => {
    const text = t.messages.find((m) => m.text)?.text || 'קובץ';
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  };
  return [
    'מטא-קבוצות:',
    ...(mgs.length ? mgs.map((mg) => `• ${mg.name} (${mg.groupIds.length} קבוצות)`) : ['(אין עדיין)']),
    '',
    'תזמונים ממתינים:',
    ...(pending.length
      ? pending.map(
          (t) =>
            `• ${code(t)} · ${fmt(t.scheduledAt)} · ${(t.metagroupNames || []).join(', ')} · ` +
            `${t.messages.length} הודעות · "${preview(t)}"`
        )
      : ['(אין)']),
  ].join('\n');
}

async function cancelTiming(given, reply) {
  const matches = timings.list().filter((t) => isPending(t) && t.id.slice(3).startsWith(given.toLowerCase()));
  if (!matches.length) return reply(`לא מצאתי תזמון ממתין עם הקוד ${given}. שלחו "רשימה".`);
  if (matches.length > 1) return reply(`יותר מתזמון אחד מתאים לקוד ${given}. שלחו "רשימה" וכתבו קוד מלא.`);
  try {
    timings.remove(matches[0].id);
    await reply(`בוטל: ${fmt(matches[0].scheduledAt)}, "${matches[0].messages[0]?.text || 'קובץ'}"`);
  } catch (err) {
    await reply(`לא ניתן לבטל: ${err.message}`);
  }
}

async function handle(msg, reply) {
  const body = (msg.body || '').trim();

  if (HEADER_RE.test(body.split('\n')[0].trim())) {
    try {
      const header = parseHeader(body);
      const replaced = draft;
      draft = { ...header, messages: [] };
      await reply(
        `${replaced ? 'הטיוטה הקודמת נמחקה.\n' : ''}מתחילים תזמון ל-${fmt(header.when)}, אל ` +
          `${header.chosen.map((mg) => mg.name).join(', ')} (${recipients(header.chosen).length} קבוצות).\n` +
          `שלחו עכשיו 1-${MAX_MESSAGES} הודעות (טקסט, תמונה או קובץ), ובסוף: ${END}\nלביטול: ${CANCEL}`
      );
    } catch (err) {
      await reply(`${err.message}\n\n${HELP}`);
    }
    return;
  }

  if (draft) {
    if (END_RE.test(body)) return finish(reply);
    if (CANCEL_RE.test(body)) {
      draft = null;
      return reply('הטיוטה בוטלה. שום דבר לא תוזמן.');
    }
    return addToDraft(msg, body, reply);
  }

  if (END_RE.test(body) || CANCEL_RE.test(body)) return reply('אין תזמון פתוח. שלחו "עזרה" כדי לראות איך מתחילים.');
  if (body === 'רשימה') return reply(listText());
  if (body === 'עזרה') return reply(HELP);
  const cancel = /^בטל\s+(\S+)$/.exec(body);
  if (cancel) return cancelTiming(cancel[1], reply);
}

// ponytail: the draft lives in memory; a restart mid-draft loses it (the user just starts over).
function attach(client) {
  client.on('ready', async () => {
    const wid = client.info?.wid?._serialized;
    myIds = new Set([wid].filter(Boolean));
    // Newer WhatsApp accounts may address the self-chat by LID instead of phone number.
    try {
      const [ids] = await client.getContactLidAndPhone([wid]);
      for (const id of [ids?.lid, ids?.pn]) if (id) myIds.add(id);
    } catch (_) {}
  });

  client.on('message_create', (msg) => {
    if (!msg.fromMe || !(msg.from === msg.to || myIds.has(msg.to))) return;
    if ((msg.body || '').startsWith(BOT)) return;
    const reply = (text) => client.sendMessage(msg.to, BOT + text);
    // One at a time, so messages keep their order while media downloads.
    queue = queue
      .then(() => handle(msg, reply))
      .catch((err) => console.error('[chat] command failed:', err.message));
  });
}

module.exports = { attach, _test: { handle, parseWhen, reset: () => (draft = null) } };
