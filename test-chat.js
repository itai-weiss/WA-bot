// Self-check for chatCommands.js: a fake WhatsApp client in a temp DATA_DIR.
// Nothing is sent; replies are collected in memory.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-chat-'));
process.env.DATA_DIR = dir;
fs.writeFileSync(
  path.join(dir, 'metagroups.json'),
  JSON.stringify([
    { id: 'mg_1', name: 'הורים', groupIds: ['g1@g.us', 'g2@g.us'] },
    { id: 'mg_2', name: 'Neighbors', groupIds: ['g2@g.us', 'g3@g.us'] },
  ])
);
const keepAwakePath = require.resolve('./keepAwake');
require.cache[keepAwakePath] = { id: keepAwakePath, filename: keepAwakePath, loaded: true, exports: { set() {}, active: () => false } };

const timings = require('./timings');
const chat = require('./chatCommands');

const ME = '972500000000@c.us';
const handlers = {};
const sent = [];
const client = {
  info: { wid: { _serialized: ME } },
  on: (event, fn) => (handlers[event] = fn),
  getContactLidAndPhone: async () => [{ lid: '111@lid', pn: ME }],
  sendMessage: async (to, text) => sent.push({ to, text }),
};
chat.attach(client);

const settle = () => new Promise((r) => setTimeout(r, 20));
async function say(body, extra = {}) {
  handlers.message_create({ fromMe: true, from: ME, to: ME, body, hasMedia: false, ...extra });
  await settle();
  return sent.at(-1)?.text || '';
}
const pending = () => timings.list().filter((t) => !t.firedAt);

(async () => {
  await handlers.ready();

  // parseWhen
  const now = new Date(2026, 10, 8, 20, 0); // 8 Nov 2026 20:00 local
  const { parseWhen } = chat._test;
  assert.deepStrictEqual(parseWhen('21:30', now), new Date(2026, 10, 8, 21, 30));
  assert.deepStrictEqual(parseWhen('מחר 9:05', now), new Date(2026, 10, 9, 9, 5));
  assert.deepStrictEqual(parseWhen('מחרתיים 08:00', now), new Date(2026, 10, 10, 8, 0));
  assert.deepStrictEqual(parseWhen('25/11 18:00', now), new Date(2026, 10, 25, 18, 0));
  assert.deepStrictEqual(parseWhen('5.1 18:00', now), new Date(2027, 0, 5, 18, 0)); // next year
  assert.deepStrictEqual(parseWhen('1/2/27 10:00', now), new Date(2027, 1, 1, 10, 0));
  assert.throws(() => parseWhen('19:00', now), /כבר עבר/);
  assert.throws(() => parseWhen('31/2 10:00', now), /לא קיים/);
  assert.throws(() => parseWhen('25:00', now), /לא קיימת/);
  assert.throws(() => parseWhen('בערב', now), /לא הבנתי/);

  // Other chats, our own replies and plain notes are ignored.
  handlers.message_create({ fromMe: true, from: ME, to: 'g1@g.us', body: 'תזמון\nמחר 10:00\nקבוצות: הורים' });
  handlers.message_create({ fromMe: false, from: 'x@c.us', to: ME, body: 'רשימה' });
  handlers.message_create({ fromMe: true, from: ME, to: ME, body: '🤖 רשימה' });
  await say('note to self: buy milk');
  assert.strictEqual(sent.length, 0);

  // Bad headers reply with the error and start nothing.
  assert.match(await say('תזמון\nמחר 10:00\nקבוצות: אין כזו'), /לא מצאתי מטא-קבוצה בשם: אין כזו/);
  assert.match(await say('תזמון\nמחר 10:00'), /בדיוק 3 שורות/);
  assert.match(await say(chatEnd()), /אין תזמון פתוח/);

  // Full flow: header, text + photo + text, end. Self-chat addressed by LID works too.
  assert.match(await say('תזמון\nקבוצות: הורים, neighbors\nמחר 10:00'), /3 קבוצות/);
  await say('ראשונה');
  handlers.message_create({
    fromMe: true, from: '111@lid', to: '111@lid', body: 'כיתוב', hasMedia: true,
    downloadMedia: async () => ({ mimetype: 'image/jpeg', data: Buffer.from('jpg').toString('base64'), filename: null }),
  });
  await settle();
  await say('שלישית');
  const done = await say('תזמון:סוף');
  assert.match(done, /נקבע ✓\n3 הודעות/);
  assert.strictEqual(sent.every((s) => s.text.startsWith('🤖 ') && (s.to === ME || s.to === '111@lid')), true);

  const [t] = pending();
  assert.deepStrictEqual(t.groupIds, ['g1@g.us', 'g2@g.us', 'g3@g.us']);
  assert.deepStrictEqual(t.metagroupNames, ['הורים', 'Neighbors']);
  assert.deepStrictEqual(t.messages.map((m) => m.text), ['ראשונה', 'כיתוב', 'שלישית']);
  assert.deepStrictEqual(t.messages.map((m) => m.attachments.length), [0, 1, 0]);
  assert.strictEqual(t.messages[1].attachments[0].originalName, 'attachment.jpeg');
  assert.match(await say('רשימה'), new RegExp(`${t.id.slice(3, 7)} · .* · הורים, Neighbors · 3 הודעות · "ראשונה"`));

  // Max 10 messages; empty draft can't be saved; cancel drops the draft.
  await say('תזמון\nמחר 11:00\nקבוצות: הורים');
  assert.match(await say(chatEnd()), /עדיין אין הודעות/);
  for (let i = 1; i <= 10; i++) await say(`m${i}`);
  assert.match(await say('m11'), /המקסימום/);
  assert.match(await say('תזמון: ביטול'), /בוטלה/);
  assert.strictEqual(pending().length, 1);

  // Cancel by code.
  assert.match(await say('בטל zzzz'), /לא מצאתי/);
  assert.match(await say(`בטל ${t.id.slice(3, 7)}`), /^🤖 בוטל/);
  assert.strictEqual(pending().length, 0);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('test-chat: all checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

function chatEnd() {
  return 'תזמון: סוף';
}
