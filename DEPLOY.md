# Running WA-bot on a cloud server (VPS)

With the bot on a server, you set timings from your phone's browser and then the
phone and PC can both sleep: the server sends at the scheduled time.

Each user gets their own container (own WhatsApp session, timings and password)
at `https://<name>.<server-ip-with-dashes>.sslip.io`. [sslip.io](https://sslip.io)
maps that name to your IP, so Caddy can get a free Let's Encrypt certificate
without you buying a domain.

## Before you start

- `whatsapp-web.js` is unofficial. WhatsApp can ban accounts that look automated,
  and datacenter IPs carry a higher risk than a home PC. Keep volumes personal and light.
- The phone that owns each WhatsApp account must come online at least about every
  14 days, or WhatsApp logs the server out and you have to scan the QR again.
- Linking the server adds a new linked device. If the PC app is also linked and
  running, both send their own timings; stop the PC app once the server works.

## 1. Create the server

Any small Ubuntu 24.04 VPS with 4 GB RAM works for two or three users, for example
Hetzner's smallest shared-vCPU plan (CX22 / CX23). Each WhatsApp user needs about
up to 1 GB. In the provider's firewall, allow inbound TCP 22, 80 and 443.

Note the server's public IP, for example `203.0.113.7`. Your `SERVER_HOST` is then
`203-0-113-7.sslip.io`.

## 2. Install Docker and the app

SSH into the server (`ssh root@203.0.113.7`), then:

```bash
curl -fsSL https://get.docker.com | sh
git clone -b whatsapp-web-app https://github.com/itai-weiss/WA-bot.git
cd WA-bot/deploy
cp .env.example .env
nano .env
```

If the repository is private, `git clone` asks for a GitHub login; use a
[personal access token](https://github.com/settings/tokens) as the password.
After PR #2 is merged, drop `-b whatsapp-web-app`.

In `.env`, set `SERVER_HOST` and a long random password for each user
(`openssl rand -base64 18` makes one).

The users are defined in `docker-compose.yml` (`wa-itai`, `wa-friend`) and
`Caddyfile` (`itai.…`, `friend.…`). Rename or remove them before the first start.

Optional: to keep your existing metagroups and timings, copy `metagroups.json`
(and `timings.json` plus the `timing-attachments` folder) from the PC into
`deploy/data/<name>/` before starting. Do not copy `.wwebjs_auth`; link
the server as a new device instead.

## 3. Start it

```bash
docker compose up -d --build
docker compose logs -f wa-itai
```

The first build downloads Chrome and takes a few minutes. Wait for
`Admin UI: http://0.0.0.0:3000`.

## 4. Link WhatsApp

Open `https://itai.203-0-113-7.sslip.io` **on a computer or tablet** (the phone
has to scan the code, so it can't also be showing it). The browser asks for a
username and password: any username, and that user's password from `.env`.

On the phone: WhatsApp → Settings → Linked devices → Link a device, and scan the
QR. The QR is also printed in `docker compose logs wa-itai` if you prefer the
terminal.

From then on, use the same address from the phone to create timings.

## Adding a user

1. In `docker-compose.yml`, copy the `wa-friend` block, renaming `wa-friend`,
   `APP_PASSWORD_FRIEND` and `./data/friend`.
2. Add the password to `.env`.
3. In `Caddyfile`, copy a site block with the new name and service.
4. `docker compose up -d --build`, then link that user's WhatsApp as above.

## Backups

All user data is in `deploy/data/<name>/`: the WhatsApp session (`.wwebjs_auth`),
`metagroups.json`, `timings.json` and `timing-attachments/`. Copy that folder to
back it up, preferably with the container stopped:

```bash
docker compose stop && tar czf ~/wa-backup-$(date +%F).tgz data && docker compose start
```

## Updates

```bash
cd ~/WA-bot/deploy && git pull && docker compose up -d --build
```

## Known weak point: restarts

On recent WhatsApp Web builds, `whatsapp-web.js` sometimes never reaches *ready*
when it restores a saved session (upstream issue #127084). The app restarts the
WhatsApp client if *ready* hasn't arrived 3 minutes after *authenticated*. Check
`docker compose logs` after a restart or update. If it keeps logging
`[watchdog] … restarting client`, the reliable fix is to scan the QR again.

---

## בעברית בקצרה

1. שוכרים שרת קטן (Ubuntu, ‏4GB RAM, למשל Hetzner), ופותחים בחומת האש את הפורטים 22, 80, 443.
2. מתחברים ב-SSH ומריצים את הפקודות בשלב 2 למעלה. ב-`deploy/.env` ממלאים את כתובת השרת (ה-IP עם מקפים במקום נקודות, ואחריו `.sslip.io`) וסיסמה לכל משתמש.
3. מריצים `docker compose up -d --build`.
4. פותחים במחשב את `https://<שם>.<כתובת>.sslip.io`, מקלידים את הסיסמה (שם משתמש לא משנה), וסורקים את קוד ה-QR מהטלפון: WhatsApp ← הגדרות ← מכשירים מקושרים ← קישור מכשיר.
5. מעכשיו אפשר לקבוע תזמונים מהטלפון באותה כתובת, והטלפון והמחשב יכולים לישון.

חשוב: הטלפון צריך להתחבר לאינטרנט לפחות פעם בכ-14 יום. זו ספרייה לא רשמית, ויש סיכון לחסימה, גבוה יותר מכתובת של שרת בענן.
