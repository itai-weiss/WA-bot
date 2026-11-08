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

- pick one or more groups
- save a reusable meta-group and apply it later with one click
- write a text message and optionally attach files
- choose a future send time
- save or cancel upcoming timings

There is no immediate-send workflow. Attachments are only sent as part of a saved timing.

Timings are stored locally in `timings.json`.

## Notes

- The admin UI binds to `127.0.0.1` by default and has no authentication. Do not expose it publicly without adding auth.
- This drives your personal WhatsApp account via WhatsApp Web. It is suitable for personal/light use, not commercial bulk sending.
- The phone with your WhatsApp must stay online for the linked-device session to work.
