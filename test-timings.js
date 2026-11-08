// Run with: npm test
// Exercises timings.js with a fake WhatsApp client in a temp copy, so the real
// timings.json / attachments are never touched and nothing is sent.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-timings-'));
for (const f of ['timings.js', 'eventLog.js', 'dataDir.js']) fs.copyFileSync(path.join(__dirname, f), path.join(dir, f));
fs.writeFileSync(path.join(dir, 'keepAwake.js'), 'let on=false; module.exports={set:(v)=>{on=v},active:()=>on};');
module.paths.unshift(path.join(__dirname, 'node_modules'));
process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('module').Module._initPaths();

const timings = require(path.join(dir, 'timings.js'));
const keepAwake = require(path.join(dir, 'keepAwake.js'));

const sent = [];
let ready = true;
const client = {
  sendMessage: async (to, body, opts) => sent.push({ to, body: typeof body === 'string' ? body : body.filename, opts }),
  getChatById: async (id) => ({ name: `name-${id}` }),
};

const tick = () => new Promise((r) => setTimeout(r, 50));

(async () => {
  // Legacy single-message timing is upgraded on load.
  const legacy = timings._test.normalize({ id: 'x', message: 'hi', attachments: [] });
  assert.deepStrictEqual(legacy.messages, [{ text: 'hi', attachments: [] }]);

  timings.init(client, () => ready);
  const future = new Date(Date.now() + 60000).toISOString();

  assert.throws(() => timings.create({ groupIds: ['g1'], messages: [{ text: ' ' }], scheduledAt: future }), /message 1/);

  const t = timings.create(
    { groupIds: ['g1', 'g2'], messages: [{ text: 'first' }, { text: '' }], scheduledAt: future },
    [[], [{ originalname: 'a.txt', mimetype: 'text/plain', buffer: Buffer.from('x'), size: 1 }]]
  );
  assert.strictEqual(keepAwake.active(), true, 'keep awake while pending');

  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'timings.json'), 'utf8'));
  const due = stored.find((x) => x.id === t.id);
  // Make it due now and add a long-overdue one; rewrite file and reload via init.
  due.scheduledAt = new Date(Date.now() - 1000).toISOString();
  stored.push({ ...due, id: 'old', scheduledAt: new Date(Date.now() - timings._test.LATE_GRACE_MS - 60000).toISOString(), messages: [{ text: 'stale', attachments: [] }] });
  fs.writeFileSync(path.join(dir, 'timings.json'), JSON.stringify(stored));

  ready = false;
  timings.init(client, () => ready);
  await tick();
  assert.strictEqual(sent.length, 0, 'nothing sent while WhatsApp is not ready');

  ready = true;
  timings._test.checkDue();
  for (let i = 0; i < 100 && !timings.list().find((x) => x.id === t.id).firedAt; i++) await tick();

  assert.deepStrictEqual(
    sent.map((s) => `${s.to}:${s.body}`),
    ['g1:first', 'g1:a.txt', 'g2:first', 'g2:a.txt'],
    'each group gets all messages in order'
  );
  const after = timings.list();
  assert.ok(after.find((x) => x.id === 'old').missedAt, 'long-overdue timing is marked missed');
  assert.ok(!sent.some((s) => s.body === 'stale'), 'missed timing is not sent');
  assert.strictEqual(keepAwake.active(), false, 'keep awake released when nothing pending');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('test-timings: all checks passed');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
