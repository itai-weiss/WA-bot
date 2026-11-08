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

There is no immediate-send workflow. Attachments are only sent as part of a saved timing.

Timings are stored locally in `timings.json`.

## Leaving it running

- While any timing is pending, the app asks Windows not to idle-sleep (`keepAwake.js`). The screen may turn off; closing the lid, choosing Sleep, or shutting down still stops sending.
- If the PC was asleep or the app closed at send time, the timing is sent as soon as the app is running again, if it is at most 6 hours late. Older ones are shown as missed instead.
- The phone can be off: WhatsApp linked devices work without it (for up to about 14 days).

## Test

```powershell
npm test
```

Runs `test-timings.js` against a temp copy with a fake WhatsApp client; nothing is sent and real data is untouched.

## Notes

- The admin UI binds to `127.0.0.1` by default and has no authentication. Do not expose it publicly without adding auth.
- This drives your personal WhatsApp account via WhatsApp Web. It is suitable for personal/light use, not commercial bulk sending.
- The phone does not need to stay online; WhatsApp logs out linked devices after about 14 days without the phone connecting.
