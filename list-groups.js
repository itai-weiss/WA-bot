// Run with: npm run groups
// Connects to WhatsApp Web, prints every group you're in along with its ID,
// then exits. Use the printed ID (ends with @g.us) in schedules.json.

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: require('path').join(require('./dataDir'), '.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox'] },
});

client.on('qr', (qr) => {
  console.log('Scan this QR code with WhatsApp on your phone:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  const chats = await client.getChats();
  const groups = chats.filter((c) => c.isGroup);

  if (groups.length === 0) {
    console.log('No groups found for this account.');
  } else {
    console.log(`\nFound ${groups.length} group(s):\n`);
    for (const g of groups) {
      console.log(`  ${g.name}`);
      console.log(`    id: ${g.id._serialized}`);
      console.log('');
    }
  }

  await client.destroy();
  process.exit(0);
});

client.on('auth_failure', (msg) => {
  console.error('Auth failure:', msg);
  process.exit(1);
});

client.initialize();
