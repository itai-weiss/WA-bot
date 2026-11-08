# WA-bot

Schedule future text messages to WhatsApp groups from a small local admin UI. Built on [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js), so it authenticates by scanning a QR with your phone.

## Requirements

- Node.js 20+
- A WhatsApp account on your phone

## Setup

```powershell
npm install
copy .env.example .env
```

Edit `.env` only if you need a different host, port, timezone, or browser path.

## Run

```powershell
npm start
```

Open **http://127.0.0.1:3000**. On first run, scan the QR from WhatsApp on your phone: **Settings -> Linked devices -> Link a device**.

Once connected, the UI only supports timings:

- create meta-groups (a saved list of one or more groups) with the "create meta-group" button
- pick one or more meta-groups as the recipients of a timing (meta-groups are the only way to choose recipients)
- write one or more messages (sent in order), each with optional attachments
- choose a future send time
- save or cancel upcoming timings

A Hebrew guide opens from the "מדריך" button and the `?` next to each step. `HOW_TO_USE.txt` (English) and `HOW_TO_USE_HE.txt` (Hebrew) are the end-user setup guides shipped with the friend zip.

Timings can also be created from WhatsApp, in your own "Message yourself" chat: a `תזמון` / time / `קבוצות: …` message, then 1-10 messages, then `תזמון: סוף`. `רשימה`, `בטל <code>` and `עזרה` work there too. See `chatCommands.js` for the format. No other chat is read.

There is no immediate-send workflow. Attachments are only sent as part of a saved timing.

Timings are stored locally in `timings.json`.

## Leaving it running

- While any timing is pending, the app asks Windows not to idle-sleep (`keepAwake.js`). The screen may turn off; closing the lid, choosing Sleep, or shutting down still stops sending.
- If the PC was asleep or the app closed at send time, the timing is sent as soon as the app is running again, if it is at most 6 hours late. Older ones are shown as missed instead.
- The phone can be off: WhatsApp linked devices work without it (for up to about 14 days).

## Cloud server

To send while your PC is off, run it on a small VPS with Docker: see [DEPLOY.md](DEPLOY.md). There, `DATA_DIR` points timings, metagroups, attachments and the WhatsApp session at a volume, and `APP_PASSWORD` puts a password on the UI.

## Test

```powershell
npm test
```

Runs `test-timings.js` against a temp copy with a fake WhatsApp client; nothing is sent and real data is untouched.

## Notes

- The admin UI binds to `127.0.0.1` by default and has no authentication unless `APP_PASSWORD` is set (HTTP Basic auth, any username). The server refuses to listen on any other `HOST` without it.
- This drives your personal WhatsApp account via WhatsApp Web. It is suitable for personal/light use, not commercial bulk sending.
- The phone does not need to stay online; WhatsApp logs out linked devices after about 14 days without the phone connecting.
